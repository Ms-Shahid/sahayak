import { randomInt } from "node:crypto";
import { and, asc, desc, eq, isNotNull, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  GetStudentOverviewQueryParams, GetStudentOverviewResponse,
  GetStudentNotesQueryParams, GetStudentNotesResponse,
  SaveLearningPaceBody, SaveLearningPaceResponse,
  StartStudentSessionBody, GetStudentSessionParams, SubmitStudentSessionParams,
  SubmitStudentSessionBody, StartStudentSessionResponse,
  GetClassAttendanceQueryParams, GetClassAttendanceResponse,
  RecordClassAttendanceBody, RecordClassAttendanceResponse,
} from "@workspace/api-zod";
import {
  db, assignmentsTable, classMembershipsTable, membershipsTable,
  submissionsTable, learningPreferencesTable, learningSessionsTable, xpEventsTable,
  type LearningSession, type SessionQuestion,
} from "@workspace/db";
import { AccessError, assertClass, requireIdentity, requireMembership, requireRole, type Member } from "../lib/access";
import { adaptiveSequence, learningPlan, PACE_SIZE, rankLearners, scoreAnswers, XP, type Attempt, type Pace } from "../lib/student-learning";
import { learningSources } from "../lib/source-access";
import { questionResults } from "../lib/learning-evidence";
import { questionCitation } from "../lib/submission-evidence";

const router: IRouter = Router();
router.use(requireIdentity, requireMembership);
// Use Express path matching for guards too (case/trailing slash semantics must agree).
router.use("/attendance", requireRole("admin", "teacher"));
router.use(["/overview", "/notes", "/preferences", "/sessions"], requireRole("student"));

async function roster(classId: number, schoolId: number) {
  return db.select({ id: membershipsTable.id, name: membershipsTable.name, userId: membershipsTable.userId })
    .from(classMembershipsTable)
    .innerJoin(membershipsTable, eq(membershipsTable.id, classMembershipsTable.memberId))
    .where(and(eq(classMembershipsTable.classId, classId), eq(membershipsTable.schoolId, schoolId), eq(membershipsTable.role, "student")))
    .orderBy(asc(membershipsTable.id));
}

async function paceFor(memberId: number, classId: number): Promise<Pace> {
  const [preference] = await db.select().from(learningPreferencesTable)
    .where(and(eq(learningPreferencesTable.memberId, memberId), eq(learningPreferencesTable.classId, classId)));
  return preference?.pace ?? "steady";
}

async function bankFor(classId: number, schoolId: number): Promise<SessionQuestion[]> {
  const assignments = await db.select().from(assignmentsTable)
    .where(and(eq(assignmentsTable.classId, classId), eq(assignmentsTable.status, "published")));
  const sources = await learningSources(classId, schoolId);
  return assignments.flatMap(a => a.questions.filter(q => questionCitation(q, sources) &&
    q.options.length === 4 && Number.isInteger(q.answerIndex) && q.answerIndex >= 0 && q.answerIndex < 4,
  ).map(q => ({ ...q, id: `${a.id}:${q.id}`, topic: q.topic || a.topic, assignmentId: a.id })));
}

async function attemptsFor(member: Member, classId: number): Promise<Attempt[]> {
  const [sessions, submissions] = await Promise.all([
    db.select().from(learningSessionsTable).where(and(eq(learningSessionsTable.memberId, member.id),
      eq(learningSessionsTable.classId, classId), isNotNull(learningSessionsTable.submittedAt))),
    db.select({ questions: assignmentsTable.questions, assignmentId: assignmentsTable.id, submission: submissionsTable })
      .from(submissionsTable).innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(and(eq(assignmentsTable.classId, classId), eq(submissionsTable.studentUserId, member.userId))),
  ]);
  return [
    ...sessions.flatMap(s => s.questions.map((q, i) => ({ topic: q.topic, questionId: q.id, correct: s.answers?.[i] === q.answerIndex, at: s.submittedAt!.getTime() }))),
    ...submissions.flatMap(s => questionResults(s.questions, s.submission).map(q => ({
      topic: q.topic, questionId: `${s.assignmentId}:${q.questionId}`, correct: q.score >= 60, score: q.score,
      at: (s.submission.reviewedAt ?? s.submission.submittedAt).getTime(),
    }))),
  ];
}

function serializeSession(session: LearningSession) {
  return StartStudentSessionResponse.parse({
    id: session.id, classId: session.classId, mode: session.mode, topic: session.topic, pace: session.pace,
    questions: session.questions.map(q => ({ id: q.id, prompt: q.prompt, options: q.options, topic: q.topic, hint: q.sourceExcerpt || "Read your class notes for a clue." })),
    submitted: Boolean(session.submittedAt), score: session.score, xpEarned: session.xpEarned,
    feedback: session.submittedAt ? session.questions.map((q, i) => ({
      questionId: q.id, correct: session.answers?.[i] === q.answerIndex,
      selectedIndex: session.answers![i], answerIndex: q.answerIndex,
      explanation: q.explanation, sourceName: q.sourceName, sourceExcerpt: q.sourceExcerpt,
    })) : [],
  });
}

async function ownSession(id: number, memberId: number, classIds: number[]) {
  const [session] = await db.select().from(learningSessionsTable)
    .where(and(eq(learningSessionsTable.id, id), eq(learningSessionsTable.memberId, memberId)));
  if (!session) throw new AccessError(404, "Session not found.");
  assertClass(classIds, session.classId);
  return session;
}

router.get("/overview", async (req, res): Promise<void> => {
  const { classId } = GetStudentOverviewQueryParams.parse(req.query);
  assertClass(res.locals.classIds, classId);
  const member = res.locals.member;
  const [members, events, submitted, sessions, pace, bank, attempts] = await Promise.all([
    roster(classId, member.schoolId),
    db.select().from(xpEventsTable).where(eq(xpEventsTable.classId, classId)),
    db.select({ userId: submissionsTable.studentUserId }).from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(eq(assignmentsTable.classId, classId)),
    db.select().from(learningSessionsTable).where(and(eq(learningSessionsTable.classId, classId), eq(learningSessionsTable.memberId, member.id))).orderBy(desc(learningSessionsTable.id)),
    paceFor(member.id, classId), bankFor(classId, member.schoolId), attemptsFor(member, classId),
  ]);
  const ownEvents = events.filter(e => e.memberId === member.id);
  const assignmentCount = submitted.filter(s => s.userId === member.userId).length;
  const breakdown = {
    attendance: ownEvents.filter(e => e.kind === "attendance").reduce((sum, e) => sum + e.points, 0),
    practice: ownEvents.filter(e => e.kind === "practice").reduce((sum, e) => sum + e.points, 0),
    quiz: ownEvents.filter(e => e.kind === "quiz").reduce((sum, e) => sum + e.points, 0),
    assignment: assignmentCount * XP.assignment,
  };
  const xpTotal = Object.values(breakdown).reduce((sum, n) => sum + n, 0);
  const ranked = rankLearners(members.map(m => ({
    memberId: m.id,
    xp: events.filter(e => e.memberId === m.id && e.kind !== "assignment").reduce((sum, e) => sum + e.points, 0)
      + submitted.filter(s => s.userId === m.userId).length * XP.assignment,
  })), member.id);
  const myEntry = ranked.find(r => r.isMe);
  const leaderboard = ranked.slice(0, 20);
  if (myEntry && !leaderboard.some(r => r.isMe)) leaderboard.push(myEntry);
  res.json(GetStudentOverviewResponse.parse({
    xpTotal, level: Math.floor(xpTotal / 100) + 1, xpToNextLevel: 100 - xpTotal % 100,
    pace, activeSessionId: sessions.find(s => !s.submittedAt)?.id ?? null,
    counts: {
      classesAttended: ownEvents.filter(e => e.kind === "attendance").length,
      practiceCompleted: sessions.filter(s => s.mode === "practice" && s.submittedAt).length,
      quizzesSubmitted: sessions.filter(s => s.mode === "puzzle" && s.submittedAt).length,
      assignmentsCompleted: assignmentCount,
    },
    xpBreakdown: breakdown, topics: learningPlan(bank.map(q => q.topic), attempts, pace),
    leaderboard, myRank: myEntry?.rank ?? 1,
  }));
});

router.get("/notes", async (req, res): Promise<void> => {
  const { classId } = GetStudentNotesQueryParams.parse(req.query);
  assertClass(res.locals.classIds, classId);
  const notes = await learningSources(classId, res.locals.member.schoolId);
  res.json(GetStudentNotesResponse.parse(notes));
});

router.post("/preferences", async (req, res): Promise<void> => {
  const input = SaveLearningPaceBody.parse(req.body);
  assertClass(res.locals.classIds, input.classId);
  await db.insert(learningPreferencesTable).values({ ...input, memberId: res.locals.member.id })
    .onConflictDoUpdate({ target: [learningPreferencesTable.memberId, learningPreferencesTable.classId], set: { pace: input.pace } });
  res.json(SaveLearningPaceResponse.parse(input));
});

router.post("/sessions", async (req, res): Promise<void> => {
  const input = StartStudentSessionBody.parse(req.body);
  assertClass(res.locals.classIds, input.classId);
  const member = res.locals.member;
  const pace = await paceFor(member.id, input.classId);
  const bank = await bankFor(input.classId, member.schoolId);
  const attempts = await attemptsFor(member, input.classId);
  const plan = learningPlan(bank.map(q => q.topic), attempts, pace);
  const topic = input.topic ?? plan[0]?.topic;
  const available = bank.filter(q => q.topic === topic);
  if (!available.length) throw new AccessError(409, "Your teacher needs to publish questions for this topic before you can practise.");
  const recommendation = plan.find(p => p.topic === topic);
  // Fisher-Yates avoids repeating the same order while never inventing unreviewed questions.
  for (let i = available.length - 1; i > 0; i--) {
    const j = randomInt(i + 1); [available[i], available[j]] = [available[j], available[i]];
  }
  const [session] = await db.insert(learningSessionsTable).values({
    memberId: member.id, classId: input.classId, mode: input.mode, pace, topic: topic!,
    questions: adaptiveSequence(available, attempts, recommendation?.suggestedQuestions ?? PACE_SIZE[pace]),
  }).returning();
  res.status(201).json(serializeSession(session));
});

router.get("/sessions/:sessionId", async (req, res): Promise<void> => {
  const { sessionId } = GetStudentSessionParams.parse(req.params);
  res.json(serializeSession(await ownSession(sessionId, res.locals.member.id, res.locals.classIds)));
});

router.post("/sessions/:sessionId/submit", async (req, res): Promise<void> => {
  const { sessionId } = SubmitStudentSessionParams.parse(req.params);
  const { answers } = SubmitStudentSessionBody.parse(req.body);
  const session = await ownSession(sessionId, res.locals.member.id, res.locals.classIds);
  if (session.submittedAt) { res.json(serializeSession(session)); return; }
  if (answers.length !== session.questions.length) throw new AccessError(400, "Answer every question before submitting.");
  const { score } = scoreAnswers(session.questions, answers);
  const kind: "quiz" | "practice" = session.mode === "puzzle" ? "quiz" : "practice";
  const result = await db.transaction(async tx => {
    // Atomic claim serializes concurrent retries. XP and grading commit together.
    const [claimed] = await tx.update(learningSessionsTable).set({ answers, score, submittedAt: new Date() })
      .where(and(eq(learningSessionsTable.id, session.id), isNull(learningSessionsTable.submittedAt))).returning();
    if (!claimed) {
      const [existing] = await tx.select().from(learningSessionsTable).where(eq(learningSessionsTable.id, session.id));
      return existing;
    }
    // Engagement XP rewards completing work, not accuracy. Grades guide adaptation separately.
    const awarded = session.questions.map(q => ({
      memberId: session.memberId, classId: session.classId, kind,
      sourceKey: q.id, points: XP[kind],
    }));
    const inserted = awarded.length ? await tx.insert(xpEventsTable).values(awarded).onConflictDoNothing().returning() : [];
    const xpEarned = inserted.reduce((sum, e) => sum + e.points, 0);
    const [saved] = await tx.update(learningSessionsTable).set({ xpEarned })
      .where(eq(learningSessionsTable.id, session.id)).returning();
    return saved;
  });
  res.json(serializeSession(result));
});

function checkAttendanceDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value || value > new Date().toISOString().slice(0, 10)) {
    throw new AccessError(400, "Choose a valid attendance date, today or earlier.");
  }
}

router.get("/attendance", async (req, res): Promise<void> => {
  const { classId } = GetClassAttendanceQueryParams.parse(req.query);
  const date = typeof req.query.date === "string" ? req.query.date : "";
  assertClass(res.locals.classIds, classId);
  checkAttendanceDate(date);
  const [members, events] = await Promise.all([
    roster(classId, res.locals.member.schoolId),
    db.select().from(xpEventsTable).where(and(eq(xpEventsTable.classId, classId), eq(xpEventsTable.kind, "attendance"), eq(xpEventsTable.sourceKey, date))),
  ]);
  res.json(GetClassAttendanceResponse.parse(members.map(m => ({ memberId: m.id, name: m.name, present: events.some(e => e.memberId === m.id) }))));
});

router.post("/attendance", async (req, res): Promise<void> => {
  const parsed = RecordClassAttendanceBody.parse(req.body);
  const input = { ...parsed, date: typeof req.body.date === "string" ? req.body.date : "" };
  assertClass(res.locals.classIds, input.classId);
  checkAttendanceDate(input.date);
  const members = await roster(input.classId, res.locals.member.schoolId);
  const student = members.find(m => m.id === input.memberId);
  if (!student) throw new AccessError(404, "Student not found in this class.");
  const key = and(eq(xpEventsTable.memberId, student.id), eq(xpEventsTable.classId, input.classId),
    eq(xpEventsTable.kind, "attendance"), eq(xpEventsTable.sourceKey, input.date));
  if (input.present) {
    await db.insert(xpEventsTable).values({ memberId: student.id, classId: input.classId, kind: "attendance",
      sourceKey: input.date, points: XP.attendance }).onConflictDoNothing();
  } else {
    await db.delete(xpEventsTable).where(key);
  }
  res.json(RecordClassAttendanceResponse.parse({ memberId: student.id, name: student.name, present: input.present }));
});

export default router;
