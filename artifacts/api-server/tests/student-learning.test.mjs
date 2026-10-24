import assert from "node:assert/strict";
import test from "node:test";
import { learningPlan, PACE_SIZE, rankLearners, scoreAnswers } from "../src/lib/student-learning.ts";

test("new topics start without fabricated mastery and weak topics are prioritized", () => {
  const plan = learningPlan(["Strong", "Weak", "New", "Strong"], [
    { topic: "Strong", correct: true, at: 1 }, { topic: "Weak", correct: false, at: 1 },
  ], "challenge");
  assert.deepEqual(plan.map(p => p.topic), ["New", "Weak", "Strong"]);
  assert.equal(plan[0].mastery, null);
  assert.equal(plan[1].stage, "revisit");
  assert.equal(plan[1].suggestedQuestions, 3);
  assert.equal(plan[2].suggestedQuestions, 8);
});
test("mastery adapts to the latest five responses rather than lifetime or class average", () => {
  const attempts = Array.from({ length: 10 }, (_, i) => ({ topic: "Water", correct: i >= 5, at: i }));
  const [topic] = learningPlan(["Water"], attempts, "steady");
  assert.equal(topic.mastery, 100);
  assert.equal(topic.attempts, 5);
  assert.equal(topic.stage, "extend");
  assert.deepEqual(PACE_SIZE, { relaxed: 3, steady: 5, challenge: 8 });
});
test("grading derives from stored answers and ranks handle ties without exposing identities", () => {
  assert.deepEqual(scoreAnswers([{ answerIndex: 0 }, { answerIndex: 2 }], [0, 1]), { score: 50, correct: [true, false] });
  const ranks = rankLearners([{ memberId: 1, xp: 20 }, { memberId: 2, xp: 30 }, { memberId: 3, xp: 30 }], 1);
  assert.deepEqual(ranks.map(r => r.rank), [1, 1, 3]);
  assert.equal(ranks[2].alias, "You");
  assert.equal(ranks[2].isMe, true);
  assert.deepEqual(Object.keys(ranks[0]).sort(), ["alias", "isMe", "rank", "xp"]);
});
