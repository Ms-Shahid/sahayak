import assert from "node:assert/strict";
import test from "node:test";
import { questionResults, validateRubric } from "../src/lib/learning-evidence.ts";

const questions = [
  { id: "a", topic: "Water", prompt: "Which resource?", answerIndex: 0, explanation: "Read the source." },
  { id: "b", topic: "Sunlight", prompt: "Which light?", answerIndex: 1, explanation: "Check the passage." },
];
const work = { answers: [0, 0], attachmentId: null, reviewStatus: "auto", rubric: null };
const rubric = [
  { questionId: "a", criterion: "Reasoning", points: 2, maxPoints: 10, feedback: "Revisit water." },
  { questionId: "b", criterion: "Evidence", points: 9, maxPoints: 10, feedback: "Well supported." },
];
test("each question contributes to its own topic; teacher partial-credit replaces automatic marks", () => {
  assert.deepEqual(questionResults(questions, work).map(q => [q.topic, q.score]), [["Water", 100], ["Sunlight", 0]]);
  assert.equal(validateRubric(questions, rubric), 55);
  const results = questionResults(questions, { ...work, reviewStatus: "reviewed", rubric });
  assert.deepEqual(results.map(q => q.score), [20, 90]);
  assert.match(results[0].feedback, /Reasoning: 2\/10/);
});
test("pending and overall-only file reviews never fabricate topic evidence", () => {
  assert.deepEqual(questionResults(questions, { ...work, reviewStatus: "pending" }), []);
  assert.deepEqual(questionResults(questions, { ...work, attachmentId: 1, reviewStatus: "reviewed" }), []);
  assert.deepEqual(questionResults(questions, { ...work, attachmentId: 1, reviewStatus: "reviewed", rubric }).map(q => q.selectedIndex), [null, null]);
});
test("rubrics must cover every real question with valid, unique criteria", () => {
  assert.throws(() => validateRubric(questions, rubric.slice(0, 1)), /every question/);
  assert.throws(() => validateRubric(questions, [...rubric, rubric[0]]), /unique/);
  assert.throws(() => validateRubric(questions, [{ ...rubric[0], questionId: "foreign" }, rubric[1]]), /existing/);
  assert.throws(() => validateRubric(questions, [{ ...rubric[0], points: 11 }, rubric[1]]), /maximum/);
  assert.equal(validateRubric(questions, [...rubric, { ...rubric[0], criterion: "Explanation", points: 4, maxPoints: 5 }]), 60);
});
