import type { PracticeQuestionRecord, RubricMark } from "@workspace/db";

type ScoredWork = {
  answers: number[];
  attachmentId: number | null;
  reviewStatus: string;
  rubric: RubricMark[] | null;
};

/** Teacher criteria replace machine marks, never add duplicate evidence. */
export function questionResults(questions: PracticeQuestionRecord[], work: ScoredWork) {
  if (work.reviewStatus === "pending") return [];
  return questions.flatMap((q, i) => {
    const marks = work.rubric?.filter(mark => mark.questionId === q.id) ?? [];
    if (!marks.length && work.attachmentId) return [];
    const max = marks.reduce((sum, mark) => sum + mark.maxPoints, 0);
    return [{
      questionId: q.id,
      topic: q.topic,
      prompt: q.prompt,
      selectedIndex: work.attachmentId ? null : work.answers[i] ?? null,
      score: max ? Math.round(marks.reduce((sum, mark) => sum + mark.points, 0) / max * 100)
        : work.answers[i] === q.answerIndex ? 100 : 0,
      feedback: marks.length ? marks.map(mark => `${mark.criterion}: ${mark.points}/${mark.maxPoints}. ${mark.feedback}`).join("\n") : q.explanation,
    }];
  });
}

export function validateRubric(questions: PracticeQuestionRecord[], rubric: RubricMark[]) {
  const ids = new Set(questions.map(q => q.id));
  const criteria = new Set<string>();
  for (const mark of rubric) {
    const key = JSON.stringify([mark.questionId, mark.criterion.trim().toLowerCase()]);
    if (!ids.has(mark.questionId) || mark.points > mark.maxPoints || !mark.criterion.trim() || !mark.feedback.trim() || criteria.has(key)) {
      throw new Error("Use unique named criteria for existing questions, with points no greater than the maximum and feedback for each.");
    }
    criteria.add(key);
  }
  if (questions.some(q => !rubric.some(mark => mark.questionId === q.id))) {
    throw new Error("Mark every question before saving the rubric review.");
  }
  return Math.round(rubric.reduce((sum, mark) => sum + mark.points, 0) /
    rubric.reduce((sum, mark) => sum + mark.maxPoints, 0) * 100);
}
