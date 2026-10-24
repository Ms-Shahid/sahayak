import { Router } from "express";
import { validateRubric } from "../lib/learning-evidence";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { db, uploadsTable, classMaterialsTable, assignmentsTable, submissionsTable } from "@workspace/db";
import { RequestFileUploadBody, ReviewSubmissionBody, GetStoredFileResponse, GetSchoolMaterialsResponse, ReviewSubmissionResponse } from "@workspace/api-zod";
import { requireIdentity, requireMembership, assertClass, AccessError } from "../lib/access";
import { fileTypes, extractFile, validateFileContent } from "../lib/extract-file";
import { privateFile, readIncoming, reservePrivateFile, sealPrivateFile } from "../lib/private-files";
import { expireInterruptedExtractions, refreshClassMastery } from "../lib/source-access";

const router = Router();
router.use(["/uploads", "/school/materials", "/submissions/:submissionId/review"], requireIdentity, requireMembership);
function id(value: unknown) {
  const n = Number(value);
  if (!Number.isSafeInteger(n) || n <= 0) throw new AccessError(400, "Invalid record ID.");
  return n;
}
function serializeFile(file: typeof uploadsTable.$inferSelect) {
  return GetStoredFileResponse.parse({ ...file, originalAvailable: file.originalAvailable === 1 });
}
async function authorizedFile(res: import("express").Response, uploadId: number, ownerOnly = false) {
  await expireInterruptedExtractions(res.locals.member.schoolId);
  const [file] = await db.select().from(uploadsTable).where(and(eq(uploadsTable.id, uploadId), eq(uploadsTable.schoolId, res.locals.member.schoolId)));
  if (!file) throw new AccessError(404, "File not found.");
  if (file.classId !== null) assertClass(res.locals.classIds, file.classId);
  if (ownerOnly && file.ownerId !== res.locals.identity.userId) throw new AccessError(404, "File not found.");
  if (file.purpose === "source") {
    if (res.locals.member.role === "student" || (ownerOnly && file.classId === null && res.locals.member.role !== "admin")) throw new AccessError(403, "Staff access required.");
  } else if (file.ownerId !== res.locals.identity.userId) {
    if (res.locals.member.role === "student") throw new AccessError(404, "File not found.");
    const [submission] = await db.select({ id: submissionsTable.id }).from(submissionsTable).where(eq(submissionsTable.attachmentId, file.id));
    if (!submission) throw new AccessError(404, "Submitted file not found.");
  }
  return file;
}

router.post("/uploads", async (req, res) => {
  const parsed = RequestFileUploadBody.safeParse(req.body);
  if (!parsed.success) throw new AccessError(400, parsed.error.message);
  const data = parsed.data;
  const ext = data.filename.split(".").pop()?.toLowerCase() ?? "";
  if (fileTypes[ext] !== data.contentType || /[/\\\x00-\x1f]/.test(data.filename)) throw new AccessError(400, "Choose a PDF, DOCX, PPTX, JPEG, PNG or WebP file with the matching content type.");
  let classId: number | null = data.classId ?? null;
  if (data.purpose === "source") {
    if (res.locals.member.role === "student" || (classId === null && res.locals.member.role !== "admin")) throw new AccessError(403, "Only school administrators can add master sources; class sources require staff access.");
    if (classId !== null) assertClass(res.locals.classIds, classId);
    if (!data.title?.trim() || !data.topic?.trim() || data.assignmentId) throw new AccessError(400, "Provide a title and topic for a source.");
  } else {
    if (res.locals.member.role !== "student" || !data.assignmentId || !["pdf", "png", "jpg", "jpeg", "webp"].includes(ext)) throw new AccessError(403, "Students may submit photos or PDFs to published assignments.");
    const [assignment] = await db.select().from(assignmentsTable).where(and(eq(assignmentsTable.id, data.assignmentId), eq(assignmentsTable.status, "published")));
    if (!assignment) throw new AccessError(404, "Assignment not found.");
    assertClass(res.locals.classIds, assignment.classId);
    classId = assignment.classId;
    const [existing] = await db.select({ id: submissionsTable.id }).from(submissionsTable).where(and(eq(submissionsTable.assignmentId, assignment.id), eq(submissionsTable.studentUserId, res.locals.identity.userId)));
    if (existing) throw new AccessError(409, "You have already submitted this assignment.");
  }
  // Per-account limits prevent unlimited storage reservations and OCR requests.
  const [recent] = await db.select({ total: sql<number>`count(*)::int` }).from(uploadsTable)
    .where(and(eq(uploadsTable.ownerId, res.locals.identity.userId), sql`${uploadsTable.createdAt} > now() - interval '1 hour'`));
  if (recent.total >= 20) throw new AccessError(429, "Upload limit reached. Try again in an hour.");
  const reservation = await reservePrivateFile();
  const upload = await db.transaction(async tx => {
    const [file] = await tx.insert(uploadsTable).values({ ...reservation, schoolId: res.locals.member.schoolId, classId,
      assignmentId: data.purpose === "submission" ? data.assignmentId : null, ownerId: res.locals.identity.userId,
      filename: data.filename, size: data.size, contentType: data.contentType, purpose: data.purpose }).returning();
    if (data.purpose === "source") await tx.insert(classMaterialsTable).values({
      classId, schoolId: res.locals.member.schoolId, title: data.title!, topic: data.topic!,
      sourceName: data.filename, sourceText: "", uploadId: file.id, extractionStatus: "uploading",
    });
    return file;
  });
  res.status(201).json({ id: upload.id, uploadURL: reservation.uploadURL });
});

router.get("/uploads/:uploadId", async (req, res) => {
  res.json(serializeFile(await authorizedFile(res, id(req.params.uploadId))));
});
router.post("/uploads/:uploadId/complete", async (req, res) => {
  const file = await authorizedFile(res, id(req.params.uploadId), true);
  // A failed extraction is final too: reusing a signed PUT URL cannot replace an accepted original.
  if (file.status !== "uploading") {
    if (file.status === "processing") throw new AccessError(409, "Extraction is in progress. Check the file status shortly.");
    res.json(serializeFile(file)); return;
  }
  const [claimed] = await db.update(uploadsTable).set({ status: "processing", processingStartedAt: new Date() })
    .where(and(eq(uploadsTable.id, file.id), eq(uploadsTable.status, "uploading"))).returning();
  if (!claimed) throw new AccessError(409, "This upload is already being processed.");
  await db.update(classMaterialsTable).set({ extractionStatus: "processing" }).where(eq(classMaterialsTable.uploadId, file.id));
  let status = "ready", error: string | null = null;
  let originalAvailable = 0;
  let pages: typeof file.pages = [];
  try {
    const bytes = await readIncoming(file.objectPath, file.size);
    await validateFileContent(bytes, file.filename);
    // Originals are attachment-only, never rendered as active content by this API.
    // Unreadable work retains its original for teacher inspection.
    await sealPrivateFile(file.objectPath, bytes, file.contentType);
    originalAvailable = 1;
    await db.update(uploadsTable).set({ originalAvailable: 1 }).where(eq(uploadsTable.id, file.id));
    pages = await extractFile(bytes, file.filename);
  } catch (err) {
    req.log.warn({ err, uploadId: file.id }, "File extraction failed");
    status = "failed";
    error = err instanceof Error && !("code" in err)
      ? err.message.slice(0, 400) : "File could not be extracted. Check the file and upload a clearer supported document.";
  }
  const [result] = await db.transaction(async tx => {
    await tx.update(classMaterialsTable).set({ extractionStatus: status, extractionError: error, pages,
      sourceText: pages.map(p => p.text).join("\n\n") }).where(eq(classMaterialsTable.uploadId, file.id));
    return tx.update(uploadsTable).set({ status, error, pages, originalAvailable }).where(eq(uploadsTable.id, file.id)).returning();
  });
  res.json(serializeFile(result));
});
router.get("/uploads/:uploadId/download", async (req, res, next) => {
  const file = await authorizedFile(res, id(req.params.uploadId));
  if (!["ready", "failed"].includes(file.status)) throw new AccessError(409, "The original is not ready.");
  const object = privateFile(file.objectPath);
  const [exists] = await object.exists();
  if (!exists) throw new AccessError(404, "Original file unavailable. Upload it again.");
  res.set({ "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff",
    "Content-Security-Policy": "sandbox", "Cache-Control": "private, no-store",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(file.filename)}` });
  object.createReadStream().on("error", next).pipe(res);
});
router.get("/school/materials", async (_req, res) => {
  if (res.locals.member.role === "student") throw new AccessError(403, "Staff access required.");
  await expireInterruptedExtractions(res.locals.member.schoolId);
  const rows = await db.select().from(classMaterialsTable).where(and(eq(classMaterialsTable.schoolId, res.locals.member.schoolId), isNull(classMaterialsTable.classId))).orderBy(desc(classMaterialsTable.createdAt));
  res.json(GetSchoolMaterialsResponse.parse(rows.map(row => ({ ...row, createdAt: row.createdAt.toISOString() }))));
});
router.patch("/submissions/:submissionId/review", async (req, res) => {
  if (res.locals.member.role === "student") throw new AccessError(403, "Staff access required.");
  const parsed = ReviewSubmissionBody.safeParse(req.body);
  if (!parsed.success) throw new AccessError(400, parsed.error.message);
  const [record] = await db.select({ submission: submissionsTable, classId: assignmentsTable.classId, questions: assignmentsTable.questions }).from(submissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId)).where(eq(submissionsTable.id, id(req.params.submissionId)));
  if (!record) throw new AccessError(404, "Submission not found.");
  assertClass(res.locals.classIds, record.classId);
  let score = parsed.data.score;
  if (parsed.data.rubric) {
    try { score = validateRubric(record.questions, parsed.data.rubric); }
    catch (error) { throw new AccessError(400, (error as Error).message); }
  } else if (!record.submission.attachmentId || record.submission.rubric) {
    throw new AccessError(400, "Save question-level rubric marks for this review.");
  }
  if (score === undefined || !parsed.data.feedback.trim()) throw new AccessError(400, "Provide a grade or rubric and written feedback.");
  const [result] = await db.update(submissionsTable).set({ score, teacherFeedback: parsed.data.feedback.trim(),
    rubric: parsed.data.rubric ?? null, reviewedAt: new Date(),
    reviewStatus: "reviewed", reviewedBy: res.locals.identity.userId }).where(eq(submissionsTable.id, record.submission.id)).returning();
  await refreshClassMastery(record.classId);
  res.json(ReviewSubmissionResponse.parse({ ...result, reviewedAt: result.reviewedAt?.toISOString() ?? null, submittedAt: result.submittedAt.toISOString() }));
});
export default router;
