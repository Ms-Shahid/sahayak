import { and, eq, isNull, ne, or, sql, inArray } from "drizzle-orm";
import { db, classMaterialsTable, submissionsTable, assignmentsTable, classesTable, uploadsTable } from "@workspace/db";

// Extraction has an eight-minute budget; abandoned work must not remain "processing" forever.
export async function expireInterruptedExtractions(schoolId: number) {
  await db.transaction(async tx => {
    const stopped = await tx.update(uploadsTable).set({ status: "failed", error: "Extraction was interrupted. Please upload this file again." })
      .where(and(eq(uploadsTable.schoolId, schoolId), eq(uploadsTable.status, "processing"),
        sql`${uploadsTable.processingStartedAt} < now() - interval '15 minutes'`)).returning({ id: uploadsTable.id });
    if (stopped.length) await tx.update(classMaterialsTable)
      .set({ extractionStatus: "failed", extractionError: "Extraction was interrupted. Please upload this file again." })
      .where(inArray(classMaterialsTable.uploadId, stopped.map(row => row.id)));
  });
}

export async function learningSources(classId: number, schoolId: number) {
  return db.select().from(classMaterialsTable).where(and(eq(classMaterialsTable.extractionStatus, "ready"),
    or(eq(classMaterialsTable.classId, classId),
      and(isNull(classMaterialsTable.classId), eq(classMaterialsTable.schoolId, schoolId)))));
}
export function citationPage(source: typeof classMaterialsTable.$inferSelect, excerpt: string) {
  if (source.pages.length) return source.pages.find(page => page.text.includes(excerpt))?.page;
  return source.sourceText.includes(excerpt) ? 1 : undefined;
}
export async function refreshClassMastery(classId: number) {
  const scores = await db.select({ score: submissionsTable.score }).from(submissionsTable)
    .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
    .where(and(eq(assignmentsTable.classId, classId), ne(submissionsTable.reviewStatus, "pending")));
  await db.update(classesTable).set({ masteryAverage: scores.length ? Math.round(scores.reduce((sum, r) => sum + r.score, 0) / scores.length) : 0 })
    .where(eq(classesTable.id, classId));
}
