import { and, eq } from "drizzle-orm";
import { db, assignmentsTable, submissionsTable, type ClassMaterial, type PracticeQuestionRecord, type SubmissionRecord } from "@workspace/db";
import { citationPage, learningSources } from "./source-access";
import { questionResults } from "./learning-evidence";

export function questionCitation(question: PracticeQuestionRecord, sources: ClassMaterial[]) {
  const source = sources.find(s => s.id === question.materialId);
  const page = source && question.sourceExcerpt && citationPage(source, question.sourceExcerpt);
  if (!source || !page || !source.sourceText.includes(question.sourceExcerpt)) return undefined;
  return { materialId: source.id, sourceName: source.sourceName, sourcePage: page, topic: question.topic, excerpt: question.sourceExcerpt };
}

export function evidencedResults(questions: PracticeQuestionRecord[], submission: SubmissionRecord, sources: ClassMaterial[]) {
  return questionResults(questions, submission).map(result => ({
    ...result,
    // Without a live source, do not repeat unverified generated explanations.
    feedback: questionCitation(questions.find(q => q.id === result.questionId)!, sources)
      ? result.feedback : submission.rubric?.filter(m => m.questionId === result.questionId)
        .map(m => `${m.criterion}: ${m.points}/${m.maxPoints}. ${m.feedback}`).join("\n") || "Supporting source unavailable. Ask your teacher to review this result.",
    citation: questionCitation(questions.find(q => q.id === result.questionId)!, sources),
  }));
}

export async function classEvidence(classId: number, schoolId: number, userId?: string) {
  const [rows, sources] = await Promise.all([
    db.select({ submission: submissionsTable, assignment: assignmentsTable }).from(submissionsTable)
      .innerJoin(assignmentsTable, eq(assignmentsTable.id, submissionsTable.assignmentId))
      .where(and(eq(assignmentsTable.classId, classId), userId ? eq(submissionsTable.studentUserId, userId) : undefined)),
    learningSources(classId, schoolId),
  ]);
  return { rows, sources };
}
