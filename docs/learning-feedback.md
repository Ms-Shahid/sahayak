# Reviewed feedback and learning gaps

Teachers can review both online answers and uploaded work from Assignments. A rubric
contains one or more named criteria for every assignment question, awarded points,
maximum points and written feedback. The server derives the percentage from the
sum of awarded and maximum points; a client-supplied score cannot override a rubric.
Question topics come from the saved assignment, not the review request.

Saved reviews preserve the student's original choices and identify the reviewer
and review time. Teacher rubric marks replace automatic question marks for topic
evidence. Pending work is excluded. Existing overall-only file reviews remain
supported, but cannot establish which topics were understood; teachers can upgrade
them to a question-level review.

## Mastery and adaptation

- Topic mastery uses each question's percentage, rather than copying a whole
  assignment's percentage onto every topic.
- The adaptive learning hub uses the latest five scored question responses per
  topic, including teacher partial credit. Pending and overall-only file grades
  do not create wrong answers.
- Evidence below 60% is a possible weakness, 60–84% suggests further practice,
  and 85% or higher suggests consolidation. These are product heuristics, not
  validated assessments or a diagnosis.
- Weak topics lead automatic session selection; unseen topics precede established
  topics at or above 60%. Within a topic, recently missed questions come first,
  followed by unseen questions and then successful questions.
- Relaxed/steady/challenge preferences still control session size, with at most
  three questions recommended for weak topics. Recommendations change between
  sessions, not mid-session. Saved sessions retain their original questions.
- All new practice sessions use teacher-published questions whose source quotations
  still match an available, ready school/class source. This is review-bank
  adaptation, not generated or difficulty-calibrated new content.

The teacher workspace debrief aggregates scored assignment work by topic, reports
the number of question results and learners below 60%, links back to submitted
work, and suggests a five-minute warm-up using a saved question and cited passage.
It does not call an LLM or invent curriculum content. Low-evidence, empty,
pending and unavailable-source states are explicit. Sources are checked when the
debrief is read; missing sources suppress supporting excerpts and automatic
explanations, not the student's historical grade or the teacher's own feedback.

Exact quotations establish provenance, not correctness or the relevance of every
inference. Teachers must check both assignment content and warm-up suitability.

## Rollout and verification

Run the existing post-merge setup (`scripts/post-merge.sh`) to apply the additive
rubric and review-time columns before running the new API. No production changes
are performed by this task.

Checks:

```sh
pnpm run typecheck
node --test artifacts/api-server/tests/student-learning.test.mjs artifacts/api-server/tests/learning-evidence.test.mjs
pnpm --filter @workspace/api-server run test:access
```

The access suite uses isolated synthetic schools, identities and development
PostgreSQL, including mixed-topic grading, source removal, partial credit,
uploaded-work review and school/class privacy boundaries.
