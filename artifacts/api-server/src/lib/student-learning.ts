export type Pace = "relaxed" | "steady" | "challenge";
export type Attempt = { topic: string; correct: boolean; at: number };
export const PACE_SIZE: Record<Pace, number> = { relaxed: 3, steady: 5, challenge: 8 };
export const XP = { attendance: 10, practice: 5, quiz: 10, assignment: 25 } as const;

/** Use the latest five scored responses per topic, never a class average. */
export function learningPlan(topics: string[], attempts: Attempt[], pace: Pace) {
  return [...new Set(topics)].map(topic => {
    const recent = attempts.filter(a => a.topic === topic).sort((a, b) => b.at - a.at).slice(0, 5);
    const mastery = recent.length ? Math.round(recent.filter(a => a.correct).length / recent.length * 100) : null;
    const stage = mastery === null ? "start" : mastery < 60 ? "revisit" : mastery < 85 ? "build" : "extend";
    return {
      topic, mastery, attempts: recent.length, stage,
      reason: mastery === null ? "Start with a short check-in; no scored responses yet."
        : mastery < 60 ? "Revisit this topic with source clues and smaller steps."
        : mastery < 85 ? "Keep practising to make this topic more consistent."
        : "You are doing well. Try another topic or reinforce this one.",
      suggestedQuestions: mastery !== null && mastery < 60 ? Math.min(3, PACE_SIZE[pace]) : PACE_SIZE[pace],
    };
  }).sort((a, b) => (a.mastery ?? -1) - (b.mastery ?? -1) || a.topic.localeCompare(b.topic));
}

export function scoreAnswers(questions: { answerIndex: number }[], answers: number[]) {
  const correct = questions.map((q, i) => q.answerIndex === answers[i]);
  return { correct, score: Math.round(correct.filter(Boolean).length / questions.length * 100) };
}

export function rankLearners(rows: { memberId: number; xp: number }[], myId: number) {
  const sorted = [...rows].sort((a, b) => b.xp - a.xp || a.memberId - b.memberId);
  return sorted.map(row => ({
    rank: sorted.findIndex(r => r.xp === row.xp) + 1,
    alias: row.memberId === myId ? "You" : `Learner ${row.memberId}`,
    xp: row.xp,
    isMe: row.memberId === myId,
  }));
}
