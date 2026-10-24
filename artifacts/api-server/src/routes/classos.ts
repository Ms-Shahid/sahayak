import { randomUUID } from "node:crypto";
import { and, asc, count, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod/v4";
import {
  AskTutorBody,
  AskTutorResponse,
  CreateAssignmentBody,
  CreateAssignmentResponse,
  CreateClassBody,
  CreateClassResponse,
  CreateCurriculumEntryBody,
  CreateCurriculumEntryResponse,
  CreateMaterialBody,
  CreateMaterialResponse,
  GeneratePracticeBody,
  GeneratePracticeResponse,
  GetAssignmentsQueryParams,
  GetAssignmentsResponse,
  GetClassesResponse,
  GetCurriculumResponse,
  GetMaterialsQueryParams,
  GetMaterialsResponse,
  GetMasteryQueryParams,
  GetMasteryResponse,
  GetSchoolDashboardResponse,
  GetSubmissionsParams,
  GetSubmissionsResponse,
  SubmitAssignmentBody,
  SubmitAssignmentParams,
  SubmitAssignmentResponse,
} from "@workspace/api-zod";
import {
  assignmentsTable,
  classMaterialsTable,
  classesTable,
  curriculumEntriesTable,
  db,
  submissionsTable,
  classMembershipsTable,
  membershipsTable,
  schoolsTable,
  type ClassMaterial as ClassMaterialRecord,
  type PracticeQuestionRecord,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { AccessError, assertClass, requireIdentity, requireMembership } from "../lib/access";

const router: IRouter = Router();
router.use(requireIdentity, requireMembership);
// Every class-scoped endpoint is authorized before reading data or calling AI.
router.use(async (req, res, next) => {
  const role = res.locals.member.role;
  const staff = role === "admin" || role === "teacher";
  if ((req.path === "/school/dashboard" && role !== "admin") ||
      (req.method === "POST" && ["/classes", "/school/curriculum"].includes(req.path) && role !== "admin") ||
      (["/materials", "/learning/practice"].includes(req.path) && !staff) ||
      (req.path === "/assignments" && req.method === "POST" && !staff) ||
      (/^\/assignments\/[^/]+\/submissions$/.test(req.path) && req.method === "POST" && role !== "student")) {
    throw new AccessError(403, "You do not have permission for this action.");
  }
  if (/^\/assignments\/[^/]+\/submissions$/.test(req.path)) {
    const id = Number(req.path.split("/")[2]);
    if (!Number.isSafeInteger(id) || id <= 0) throw new AccessError(400, "Invalid assignment.");
    const [assignment] = await db.select().from(assignmentsTable).where(eq(assignmentsTable.id, id));
    if (!assignment) throw new AccessError(404, "Assignment not found.");
    assertClass(res.locals.classIds, assignment.classId);
    if (role === "student" && assignment.status !== "published") throw new AccessError(404, "Assignment not found.");
  } else if (["/materials", "/assignments", "/learning/practice", "/learning/tutor", "/learning/mastery"].includes(req.path)) {
    assertClass(res.locals.classIds, Number(req.method === "GET" ? req.query.classId : req.body?.classId));
  }
  next();
});

const GeneratedQuestionSchema = z.object({
  prompt: z.string().min(8),
  options: z.array(z.string().min(1)).length(4),
  answerIndex: z.number().int().min(0).max(3),
  explanation: z.string().min(8),
  materialId: z.coerce.number().int(),
  sourceExcerpt: z.string().min(12),
});

const GeneratedPracticeSchema = z.object({
  questions: z.array(GeneratedQuestionSchema).min(1),
});

const GeneratedTutorSchema = z.object({
  answer: z.string().min(10),
  citations: z.array(
    z.object({
      materialId: z.coerce.number().int(),
      excerpt: z.string().min(12),
    }),
  ),
});

function parseJsonResponse(content: string | null | undefined): unknown {
  if (!content) throw new Error("The learning assistant returned an empty response.");
  return JSON.parse(content) as unknown;
}

function chooseSources(
  materials: ClassMaterialRecord[],
  topic: string,
) {
  const needle = topic.trim().toLowerCase();
  const matches = materials.filter((material) =>
    `${material.topic} ${material.title} ${material.sourceText}`
      .toLowerCase()
      .includes(needle),
  );
  return matches;
}

function isExactExcerpt(source: string, excerpt: string): boolean {
  return excerpt.length <= 600 && source.includes(excerpt);
}

router.get("/school/dashboard", async (req, res): Promise<void> => {
  const schoolId = res.locals.member.schoolId;
  const ids = res.locals.classIds.length ? res.locals.classIds : [-1];
  const [curriculum, classes, materials, assignments, submittedRows] =
    await Promise.all([
      db.select({ total: count() }).from(curriculumEntriesTable).where(eq(curriculumEntriesTable.schoolId, schoolId)),
      db.select().from(classesTable).where(eq(classesTable.schoolId, schoolId)),
      db.select().from(classMaterialsTable).where(inArray(classMaterialsTable.classId, ids)).orderBy(desc(classMaterialsTable.createdAt)),
      db.select().from(assignmentsTable).where(inArray(assignmentsTable.classId, ids)),
      db
        .select({ assignmentId: submissionsTable.assignmentId, total: count() })
        .from(submissionsTable)
        .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
        .where(inArray(assignmentsTable.classId, ids))
        .groupBy(submissionsTable.assignmentId),
    ]);

  const members = await db.select().from(membershipsTable).where(eq(membershipsTable.schoolId, schoolId));
  const roster = await db.select().from(classMembershipsTable).innerJoin(membershipsTable,
    eq(membershipsTable.id, classMembershipsTable.memberId)).where(and(eq(membershipsTable.schoolId, schoolId),
      eq(membershipsTable.role, "student")));
  const teacherCount = members.filter((member) => member.role === "teacher").length;
  const studentCount = members.filter((member) => member.role === "student").length;
  const [school] = await db.select().from(schoolsTable).where(eq(schoolsTable.id, schoolId));
  const masteryAverage = classes.length
    ? Math.round(
        classes.reduce((sum, room) => sum + room.masteryAverage, 0) /
          classes.length,
      )
    : 0;
  const recentActivity = materials.slice(0, 5).map((material) => ({
    id: material.id,
    label: "Class source added",
    detail: `${material.title} · ${material.topic}`,
    happenedAt: material.createdAt.toISOString(),
    kind: "material",
  }));
  const submittedByAssignment = new Map(
    submittedRows.map((row) => [row.assignmentId, row.total]),
  );
  const result = {
    schoolName: school.name,
    teacherCount,
    studentCount,
    classCount: classes.length,
    sourceCount: materials.length,
    pendingSubmissions: assignments.reduce((sum, assignment) => {
      const room = classes.find((item) => item.id === assignment.classId);
      return (
        sum +
        Math.max(
          0,
          roster.filter((item) => item.classos_class_memberships.classId === room?.id).length -
            (submittedByAssignment.get(assignment.id) ?? 0),
        )
      );
    }, 0),
    masteryAverage,
    recentActivity,
  };
  res.json(GetSchoolDashboardResponse.parse(result));
});

router.get("/school/curriculum", async (_req, res): Promise<void> => {
  const rows = await db
    .select()
    .from(curriculumEntriesTable)
    .where(eq(curriculumEntriesTable.schoolId, res.locals.member.schoolId))
    .orderBy(asc(curriculumEntriesTable.grade), asc(curriculumEntriesTable.subject));
  res.json(GetCurriculumResponse.parse(rows));
});

router.post("/school/curriculum", async (req, res): Promise<void> => {
  const parsed = CreateCurriculumEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(curriculumEntriesTable)
    .values({
      ...parsed.data,
      schoolId: res.locals.member.schoolId,
      standard: parsed.data.standard || "School standard",
    })
    .returning();
  res.status(201).json(CreateCurriculumEntryResponse.parse(row));
});

router.get("/classes", async (_req, res): Promise<void> => {
  const rows = await db.select().from(classesTable)
    .where(inArray(classesTable.id, res.locals.classIds.length ? res.locals.classIds : [-1])).orderBy(asc(classesTable.grade));
  const roster = await db.select({ classId: classMembershipsTable.classId, role: membershipsTable.role, name: membershipsTable.name })
    .from(classMembershipsTable).innerJoin(membershipsTable, eq(membershipsTable.id, classMembershipsTable.memberId))
    .where(eq(membershipsTable.schoolId, res.locals.member.schoolId));
  res.json(GetClassesResponse.parse(rows.map((row) => ({
    ...row, studentCount: res.locals.member.role === "student" ? 0 : roster.filter((m) => m.classId === row.id && m.role === "student").length,
    teacherName: roster.filter((m) => m.classId === row.id && m.role === "teacher").map((m) => m.name).join(", ") || "Not assigned",
    masteryAverage: res.locals.member.role === "student" ? 0 : row.masteryAverage,
  }))));
});

router.post("/classes", async (req, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classesTable).values({ ...parsed.data, schoolId: res.locals.member.schoolId,
    studentCount: 0, masteryAverage: 0, teacherName: "Not assigned" }).returning();
  res.status(201).json(CreateClassResponse.parse(row));
});

router.get("/materials", async (req, res): Promise<void> => {
  const params = GetMaterialsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, params.data.classId))
    .orderBy(desc(classMaterialsTable.createdAt));
  res.json(
    GetMaterialsResponse.parse(
      rows.map((row) => ({
        ...row,
        createdAt: row.createdAt.toISOString(),
      })),
    ),
  );
});

router.post("/materials", async (req, res): Promise<void> => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const [row] = await db.insert(classMaterialsTable).values(parsed.data).returning();
  res
    .status(201)
    .json(CreateMaterialResponse.parse({ ...row, createdAt: row.createdAt.toISOString() }));
});

router.get("/assignments", async (req, res): Promise<void> => {
  const params = GetAssignmentsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(assignmentsTable)
    .where(and(eq(assignmentsTable.classId, params.data.classId),
      res.locals.member.role === "student" ? eq(assignmentsTable.status, "published") : undefined))
    .orderBy(desc(assignmentsTable.id));
  const submissionCounts = await db
    .select({ assignmentId: submissionsTable.assignmentId, total: count() })
    .from(submissionsTable)
    .where(and(inArray(submissionsTable.assignmentId, rows.map((row) => row.id).length ? rows.map((row) => row.id) : [-1]),
      res.locals.member.role === "student" ? eq(submissionsTable.studentUserId, res.locals.identity.userId) : undefined))
    .groupBy(submissionsTable.assignmentId);
  const submitted = new Map(submissionCounts.map((row) => [row.assignmentId, row.total]));
  res.json(
    GetAssignmentsResponse.parse(
      rows.map((row) => ({
        ...row,
        questions: res.locals.member.role === "student"
          ? row.questions.map(({ id, prompt, options, topic }) => ({ id, prompt, options, topic }))
          : row.questions,
        submittedCount: submitted.get(row.id) ?? 0,
      })),
    ),
  );
});

router.post("/assignments", async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .select({ id: classesTable.id })
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const [row] = await db
    .insert(assignmentsTable)
    .values({
      ...parsed.data,
      status: "published",
    })
    .returning();
  res.status(201).json(
    CreateAssignmentResponse.parse({
      ...row,
      submittedCount: 0,
    }),
  );
});

router.get("/assignments/:assignmentId/submissions", async (req, res): Promise<void> => {
  const params = GetSubmissionsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(and(eq(submissionsTable.assignmentId, params.data.assignmentId),
      res.locals.member.role === "student" ? eq(submissionsTable.studentUserId, res.locals.identity.userId) : undefined))
    .orderBy(desc(submissionsTable.submittedAt));
  res.json(
    GetSubmissionsResponse.parse(
      rows.map((row) => ({
        ...row,
        submittedAt: row.submittedAt.toISOString(),
      })),
    ),
  );
});

router.post(
  "/assignments/:assignmentId/submissions",
  async (req, res): Promise<void> => {
    const params = SubmitAssignmentParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    const parsed = SubmitAssignmentBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const [assignment] = await db
      .select()
      .from(assignmentsTable)
      .where(eq(assignmentsTable.id, params.data.assignmentId));
    if (!assignment) {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (parsed.data.answers.length !== assignment.questions.length) {
      res.status(400).json({ error: "Submit one answer for every question." });
      return;
    }
    const correct = parsed.data.answers.reduce(
      (sum, answer, index) =>
        sum + (answer === assignment.questions[index]?.answerIndex ? 1 : 0),
      0,
    );
    const [row] = await db
      .insert(submissionsTable)
      .values({
        assignmentId: assignment.id,
        studentName: res.locals.identity.name,
        studentUserId: res.locals.identity.userId,
        answers: parsed.data.answers,
        score: Math.round((correct / assignment.questions.length) * 100),
        totalQuestions: assignment.questions.length,
      })
      .returning();
    const scores = await db
      .select({
        average: count(),
      })
      .from(submissionsTable)
      .innerJoin(assignmentsTable, eq(submissionsTable.assignmentId, assignmentsTable.id))
      .where(eq(assignmentsTable.classId, assignment.classId));
    const total = scores[0]?.average ?? 0;
    if (total > 0) {
      const classScores = await db
        .select({ score: submissionsTable.score })
        .from(submissionsTable)
        .innerJoin(assignmentsTable, eq(submissionsTable.assignmentId, assignmentsTable.id))
        .where(eq(assignmentsTable.classId, assignment.classId));
      const average = Math.round(
        classScores.reduce((sum, item) => sum + item.score, 0) / classScores.length,
      );
      await db
        .update(classesTable)
        .set({ masteryAverage: average })
        .where(eq(classesTable.id, assignment.classId));
    }
    res.status(201).json(
      SubmitAssignmentResponse.parse({
        ...row,
        submittedAt: row.submittedAt.toISOString(),
      }),
    );
  },
);

router.post("/learning/practice", async (req, res): Promise<void> => {
  const parsed = GeneratePracticeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const materials = await db
    .select()
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, parsed.data.classId));
  const sources = chooseSources(materials, parsed.data.topic);
  if (sources.length === 0) {
    res.status(409).json({
      error: "Add a class source covering this topic before generating questions.",
    });
    return;
  }
  const sourceContext = sources
    .slice(0, 4)
    .map((source) => `SOURCE_ID=${source.id}\nTITLE=${source.title}\nTOPIC=${source.topic}\nTEXT=${source.sourceText.slice(0, 5000)}`)
    .join("\n\n---\n\n");
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "Create age-appropriate multiple-choice practice for a K-12 class. Use only the supplied class sources; do not add outside facts. Return JSON {questions:[{prompt,options:[four strings],answerIndex,explanation,materialId,sourceExcerpt}]}. Every sourceExcerpt must be an exact contiguous quote copied from its source and must support the question. Each answer must be unambiguous. Do not include markdown.",
        },
        {
          role: "user",
          content: `Grade ${room.grade}, ${room.subject}. Create ${parsed.data.count} questions on ${parsed.data.topic} using these sources:\n\n${sourceContext}`,
        },
      ],
    });
    const draft = GeneratedPracticeSchema.parse(
      parseJsonResponse(completion.choices[0]?.message.content),
    );
    const byId = new Map(sources.map((source) => [source.id, source]));
    const questions: PracticeQuestionRecord[] = draft.questions
      .slice(0, parsed.data.count)
      .map((question) => {
        const source = byId.get(question.materialId);
        if (!source || !isExactExcerpt(source.sourceText, question.sourceExcerpt)) {
          throw new Error("A generated question could not be verified against its source.");
        }
        return {
          id: randomUUID(),
          prompt: question.prompt,
          options: question.options,
          answerIndex: question.answerIndex,
          explanation: question.explanation,
          sourceName: source.sourceName,
          sourceExcerpt: question.sourceExcerpt,
          topic: parsed.data.topic,
        };
      });
    res.json(GeneratePracticeResponse.parse(questions));
  } catch (error) {
    req.log.error({ err: error }, "Unable to generate source-verified practice");
    res.status(502).json({
      error: "Practice could not be verified against the saved class sources. Try again or review the source text.",
    });
  }
});

router.post("/learning/tutor", async (req, res): Promise<void> => {
  const parsed = AskTutorBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [room] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const materials = await db
    .select()
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.classId, parsed.data.classId));
  const topicMatches = chooseSources(materials, parsed.data.question);
  const sources = topicMatches.length ? topicMatches : materials;
  if (sources.length === 0) {
    res.json(
      AskTutorResponse.parse({
        answer: "I couldn’t find a supporting source in this class yet. Ask your teacher to add the relevant notes, then try again.",
        citations: [],
        grounded: false,
      }),
    );
    return;
  }
  const sourceContext = sources
    .slice(0, 4)
    .map((source) => `SOURCE_ID=${source.id}\nTITLE=${source.title}\nTOPIC=${source.topic}\nTEXT=${source.sourceText.slice(0, 5000)}`)
    .join("\n\n---\n\n");
  try {
    const completion = await openai.chat.completions.create({
      model: "gpt-5.6-terra",
      max_completion_tokens: 8192,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You are a patient K-12 tutor. Answer only from the provided class source excerpts. Never use outside knowledge or invent citations. In hint mode, give a small next step, not the full solution. In explain mode, explain step by step using the source. Return JSON {answer:string,citations:[{materialId:number,excerpt:string}]}; each excerpt must be an exact contiguous quote from the identified source. If the sources do not support an answer, return a brief request for more class material and an empty citations array.",
        },
        {
          role: "user",
          content: `Class: ${room.grade} ${room.subject}\nMode: ${parsed.data.mode}\nQuestion: ${parsed.data.question}\n\nClass sources:\n${sourceContext}`,
        },
      ],
    });
    const draft = GeneratedTutorSchema.parse(
      parseJsonResponse(completion.choices[0]?.message.content),
    );
    const byId = new Map(sources.map((source) => [source.id, source]));
    const citations = draft.citations.flatMap((citation) => {
      const source = byId.get(citation.materialId);
      if (!source || !isExactExcerpt(source.sourceText, citation.excerpt)) return [];
      return [{
        sourceName: source.sourceName,
        topic: source.topic,
        excerpt: citation.excerpt,
      }];
    });
    if (citations.length === 0) {
      res.json(
        AskTutorResponse.parse({
          answer: "I couldn’t confirm an answer from the saved class material. Try a different question or ask your teacher to add a source.",
          citations: [],
          grounded: false,
        }),
      );
      return;
    }
    res.json(
      AskTutorResponse.parse({
        answer: draft.answer,
        citations,
        grounded: true,
      }),
    );
  } catch (error) {
    req.log.error({ err: error }, "Unable to produce a source-verified tutor answer");
    res.status(502).json({
      error: "The tutor could not verify a source for this response. Please try again.",
    });
  }
});

router.get("/learning/mastery", async (req, res): Promise<void> => {
  const params = GetMasteryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const [room] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, params.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const rows = await db
    .select({
      studentName: submissionsTable.studentName,
      studentUserId: submissionsTable.studentUserId,
      topic: assignmentsTable.topic,
      score: submissionsTable.score,
    })
    .from(submissionsTable)
    .innerJoin(assignmentsTable, eq(submissionsTable.assignmentId, assignmentsTable.id))
    .where(and(eq(assignmentsTable.classId, room.id),
      res.locals.member.role === "student" ? eq(submissionsTable.studentUserId, res.locals.identity.userId) : undefined));
  const studentTopics = new Map<
    string,
    Map<string, { total: number; count: number }>
  >();
  for (const row of rows) {
    const key = row.studentUserId ?? `legacy:${row.studentName}`;
    const topics = studentTopics.get(key) ?? new Map();
    const current = topics.get(row.topic) ?? { total: 0, count: 0 };
    current.total += row.score;
    current.count += 1;
    topics.set(row.topic, current);
    studentTopics.set(key, topics);
  }
  const students = [...studentTopics.entries()].map(([userId, topics]) => ({
    studentName: rows.find((row) => (row.studentUserId ?? `legacy:${row.studentName}`) === userId)?.studentName ?? "Student",
    topics: [...topics.entries()].map(([topic, values]) => ({
      topic,
      score: Math.round(values.total / values.count),
    })),
  }));
  res.json(
    GetMasteryResponse.parse({
      classId: room.id,
      average: res.locals.member.role === "student"
        ? (rows.length ? Math.round(rows.reduce((sum, row) => sum + row.score, 0) / rows.length) : 0)
        : room.masteryAverage,
      students,
    }),
  );
});

export default router;
