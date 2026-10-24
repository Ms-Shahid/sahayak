import { randomUUID } from "node:crypto";
import { asc, count, desc, eq, inArray } from "drizzle-orm";
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
  UpdateMaterialBody,
  UpdateMaterialParams,
  UpdateMaterialResponse,
  SubmitAssignmentBody,
  SubmitAssignmentParams,
  SubmitAssignmentResponse,
} from "@workspace/api-zod";
import {
  accessPolicyTable,
  assignmentsTable,
  classMaterialsTable,
  classesTable,
  curriculumEntriesTable,
  db,
  submissionsTable,
  type ClassMaterial as ClassMaterialRecord,
  type PracticeQuestionRecord,
} from "@workspace/db";
import { openai } from "@workspace/integrations-openai-ai-server";
import { audit, guardClass, memberClassIds, requireRole } from "../lib/auth";
import { getClass, groundingMaterials, ownsMaterial, readableMaterials } from "../lib/access";

const router: IRouter = Router();

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

function serializeMaterial(row: ClassMaterialRecord) {
  return { ...row, createdAt: row.createdAt.toISOString() };
}

/** Classes the signed-in user may see: all for admins, memberships for everyone else. */
async function visibleClasses(user: { id: number; role: string }) {
  const rooms = await db.select().from(classesTable).orderBy(asc(classesTable.grade));
  if (user.role === "admin") return rooms;
  const ids = new Set(await memberClassIds(user.id));
  return rooms.filter((room) => ids.has(room.id));
}

router.get("/school/dashboard", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const allowedClassIds = new Set((await visibleClasses(req.user!)).map((room) => room.id));
  const [curriculum, allClasses, allMaterials, allAssignments, submittedRows] =
    await Promise.all([
      db.select({ total: count() }).from(curriculumEntriesTable),
      db.select().from(classesTable),
      db.select().from(classMaterialsTable).orderBy(desc(classMaterialsTable.createdAt)),
      db.select().from(assignmentsTable),
      db
        .select({ assignmentId: submissionsTable.assignmentId, total: count() })
        .from(submissionsTable)
        .groupBy(submissionsTable.assignmentId),
    ]);

  const classes = allClasses.filter((room) => allowedClassIds.has(room.id));
  const materials = allMaterials.filter(
    (material) => material.classId === null || allowedClassIds.has(material.classId),
  );
  const assignments = allAssignments.filter((assignment) => allowedClassIds.has(assignment.classId));
  const teacherCount = new Set(classes.map((room) => room.teacherName)).size;
  const studentCount = classes.reduce((sum, room) => sum + room.studentCount, 0);
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
    schoolName: "Northstar Academy",
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
          (room?.studentCount ?? 0) -
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
    .orderBy(asc(curriculumEntriesTable.grade), asc(curriculumEntriesTable.subject));
  res.json(GetCurriculumResponse.parse(rows));
});

router.post("/school/curriculum", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateCurriculumEntryBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db
    .insert(curriculumEntriesTable)
    .values({
      ...parsed.data,
      standard: parsed.data.standard || "School standard",
    })
    .returning();
  res.status(201).json(CreateCurriculumEntryResponse.parse(row));
});

router.get("/classes", async (req, res): Promise<void> => {
  res.json(GetClassesResponse.parse(await visibleClasses(req.user!)));
});

router.post("/classes", requireRole("admin"), async (req, res): Promise<void> => {
  const parsed = CreateClassBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const [row] = await db.insert(classesTable).values(parsed.data).returning();
  await audit(req.user, "class_created", row.name);
  res.status(201).json(CreateClassResponse.parse(row));
});

router.get("/materials", async (req, res): Promise<void> => {
  const params = GetMaterialsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await guardClass(req, res, params.data.classId, ["admin", "teacher", "student"]))) return;
  const room = await getClass(params.data.classId);
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const rows = await readableMaterials(req.user!, room);
  rows.sort((x, y) => y.createdAt.getTime() - x.createdAt.getTime());
  res.json(GetMaterialsResponse.parse(rows.map(serializeMaterial)));
});

router.post("/materials", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const parsed = CreateMaterialBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const user = req.user!;
  const [policy] = await db.select().from(accessPolicyTable).where(eq(accessPolicyTable.id, 1));
  const { scope = "class", classId, grade, subject, visibility, ...content } = parsed.data;
  if (scope === "school") {
    if (user.role !== "admin") {
      res.status(403).json({ error: "Only admins can add school-level sources." });
      return;
    }
    const [row] = await db
      .insert(classMaterialsTable)
      .values({
        ...content,
        scope: "school",
        classId: null,
        grade: grade?.trim() || null,
        subject: subject?.trim() || null,
        visibility: visibility ?? policy?.tier1DefaultVisibility ?? "ai_only",
        status: "published",
        uploadedBy: user.id,
      })
      .returning();
    await audit(user, "school_source_added", `${row.title} (${row.visibility})`);
    res.status(201).json(CreateMaterialResponse.parse(serializeMaterial(row)));
    return;
  }
  if (classId === undefined) {
    res.status(400).json({ error: "Choose a class for this source." });
    return;
  }
  if (!(await guardClass(req, res, classId, ["admin", "teacher"]))) return;
  const room = await getClass(classId);
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const [row] = await db
    .insert(classMaterialsTable)
    .values({
      ...content,
      scope: "class",
      classId,
      visibility: visibility ?? "students",
      status:
        user.role === "admin" ? "published" : (policy?.classUploadDefaultStatus ?? "published"),
      uploadedBy: user.id,
    })
    .returning();
  await audit(user, "class_source_added", `${row.title} to ${room.name} (${row.status})`);
  res.status(201).json(CreateMaterialResponse.parse(serializeMaterial(row)));
});

router.patch("/materials/:materialId", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const params = UpdateMaterialParams.safeParse(req.params);
  const parsed = UpdateMaterialBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Invalid request." });
    return;
  }
  const [material] = await db
    .select()
    .from(classMaterialsTable)
    .where(eq(classMaterialsTable.id, params.data.materialId));
  if (!material) {
    res.status(404).json({ error: "Source not found." });
    return;
  }
  const user = req.user!;
  if (!(await ownsMaterial(user, material))) {
    res.status(403).json({ error: "You cannot change this source." });
    return;
  }
  const changes = {
    ...(parsed.data.visibility ? { visibility: parsed.data.visibility } : {}),
    ...(parsed.data.status ? { status: parsed.data.status } : {}),
  };
  if (Object.keys(changes).length === 0) {
    res.status(400).json({ error: "Nothing to change." });
    return;
  }
  const [row] = await db
    .update(classMaterialsTable)
    .set(changes)
    .where(eq(classMaterialsTable.id, material.id))
    .returning();
  await audit(user, "source_access_changed", `${row.title}: ${row.status}, ${row.visibility}`);
  res.json(UpdateMaterialResponse.parse(serializeMaterial(row)));
});

router.get("/assignments", async (req, res): Promise<void> => {
  const params = GetAssignmentsQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await guardClass(req, res, params.data.classId, ["admin", "teacher", "student"]))) return;
  const allRows = await db
    .select()
    .from(assignmentsTable)
    .where(eq(assignmentsTable.classId, params.data.classId))
    .orderBy(desc(assignmentsTable.id));
  const rows =
    req.user!.role === "student" ? allRows.filter((row) => row.status === "published") : allRows;
  const submissionCounts = await db
    .select({ assignmentId: submissionsTable.assignmentId, total: count() })
    .from(submissionsTable)
    .where(inArray(submissionsTable.assignmentId, rows.map((row) => row.id).length ? rows.map((row) => row.id) : [-1]))
    .groupBy(submissionsTable.assignmentId);
  const submitted = new Map(submissionCounts.map((row) => [row.assignmentId, row.total]));
  res.json(
    GetAssignmentsResponse.parse(
      rows.map((row) => ({
        ...row,
        submittedCount: submitted.get(row.id) ?? 0,
      })),
    ),
  );
});

router.post("/assignments", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const parsed = CreateAssignmentBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await guardClass(req, res, parsed.data.classId, ["admin", "teacher"]))) return;
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
  const [owner] = await db
    .select({ classId: assignmentsTable.classId })
    .from(assignmentsTable)
    .where(eq(assignmentsTable.id, params.data.assignmentId));
  if (!owner) {
    res.status(404).json({ error: "Assignment not found." });
    return;
  }
  if (!(await guardClass(req, res, owner.classId, ["admin", "teacher"]))) return;
  const rows = await db
    .select()
    .from(submissionsTable)
    .where(eq(submissionsTable.assignmentId, params.data.assignmentId))
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
  requireRole("student"),
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
    if (!assignment || assignment.status !== "published") {
      res.status(404).json({ error: "Assignment not found." });
      return;
    }
    if (!(await guardClass(req, res, assignment.classId, ["student"]))) return;
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
        studentName: req.user!.name,
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

router.post("/learning/practice", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const parsed = GeneratePracticeBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  if (!(await guardClass(req, res, parsed.data.classId, ["admin", "teacher"]))) return;
  const [room] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const materials = await groundingMaterials(room, { includeTeacherOnly: true });
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
  if (!(await guardClass(req, res, parsed.data.classId, ["admin", "teacher", "student"]))) return;
  const [room] = await db
    .select()
    .from(classesTable)
    .where(eq(classesTable.id, parsed.data.classId));
  if (!room) {
    res.status(404).json({ error: "Class not found." });
    return;
  }
  const materials = await groundingMaterials(room, {
    includeTeacherOnly: req.user!.role !== "student",
  });
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
        excerpt:
          req.user!.role === "student" && source.visibility === "ai_only"
            ? "Quoted from school reference material that is not shown to students."
            : citation.excerpt,
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

router.get("/learning/mastery", requireRole("admin", "teacher"), async (req, res): Promise<void> => {
  const params = GetMasteryQueryParams.safeParse(req.query);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!(await guardClass(req, res, params.data.classId, ["admin", "teacher"]))) return;
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
      topic: assignmentsTable.topic,
      score: submissionsTable.score,
    })
    .from(submissionsTable)
    .innerJoin(assignmentsTable, eq(submissionsTable.assignmentId, assignmentsTable.id))
    .where(eq(assignmentsTable.classId, room.id));
  const studentTopics = new Map<
    string,
    Map<string, { total: number; count: number }>
  >();
  for (const row of rows) {
    const topics = studentTopics.get(row.studentName) ?? new Map();
    const current = topics.get(row.topic) ?? { total: 0, count: 0 };
    current.total += row.score;
    current.count += 1;
    topics.set(row.topic, current);
    studentTopics.set(row.studentName, topics);
  }
  const students = [...studentTopics.entries()].map(([studentName, topics]) => ({
    studentName,
    topics: [...topics.entries()].map(([topic, values]) => ({
      topic,
      score: Math.round(values.total / values.count),
    })),
  }));
  res.json(
    GetMasteryResponse.parse({
      classId: room.id,
      average: room.masteryAverage,
      students,
    }),
  );
});

export default router;
