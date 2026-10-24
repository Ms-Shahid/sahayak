# Student engagement and self-paced learning

## Student workflow

- `/student`: personal learning hub, topic recommendations, saved pace and resume action.
- `/student/notes`: read sources shared with the student's assigned class.
- `/student/play`: teacher-published practice and puzzle-style answer-tile quizzes, with hints, pause/resume and post-submission feedback.
- `/student/progress`: personal scorecard, activity counts, XP breakdown and anonymous class leaderboard.
- `/assignments`: existing one-submission coursework flow; completed work contributes to engagement XP.
- `/attendance`: school administrators and assigned teachers record or correct student attendance.

There are no timers or speed bonuses. Unfinished choices are saved locally under an account/class/session-specific key; the server stores sessions and completed results. A session can be resumed through the hub or its URL.

## Engagement XP

XP measures participation, not academic ability. Accuracy is tracked separately for adaptive recommendations.

| Activity | XP | Deduplication |
| --- | --- | --- |
| Teacher-recorded attendance | 10 | Once per learner, class and UTC calendar day |
| Submitted assignment | 25 | Once per assignment and learner, derived from existing submissions |
| Practice question completed | 5 | Once per published question and learner in practice mode |
| Puzzle question submitted | 10 | Once per published question and learner in puzzle mode |

All questions in a session must be answered before submitting. Incorrect answers still earn participation XP. Replaying the same question in the same mode does not earn more XP. Attendance corrections remove that day's credit. Each 100 XP advances a level. Scorecards and rankings are for the selected class, not a global or cross-school competition. Equal XP produces tied ranks.

## Adaptation

Recommendations use the learner's latest five scored responses per topic across assignments and practice/puzzle sessions, not the class average. Unassessed topics are presented as check-ins, without invented mastery percentages. Previously answered topics below 60% are recommended for review; below 85% for reinforcement; otherwise for extension or another topic.

Saved pace controls session size: relaxed up to 3 questions, steady up to 5, challenge up to 8. Topics below 60% use at most 3 questions. The actual session can be shorter when the teacher-published bank is small. Students may choose a topic rather than follow the recommendation.

This MVP adapts topic priority, session length and access to source hints. It does not claim to calibrate question difficulty, diagnose learning disabilities, establish curriculum mastery, or generate new reviewed questions automatically.

## Privacy and integrity

- Membership and assigned class access are checked server-side.
- Sessions belong to the authenticated learner; peer sessions are not accessible.
- Students cannot mark attendance or choose their identity, XP amount or score.
- Answer indices and grading feedback are withheld until a session is submitted.
- Grading and XP events commit atomically. Repeated/concurrent submits return the existing result.
- Unique event keys prevent repeat rewards, including across separate sessions.
- Class leaderboards return aliases and XP, never peer names, emails, submission details or academic grades.

## Rollout and verification

The changes add learning preference, session and XP-event tables. No existing records are dropped. Development schema setup uses `pnpm --filter @workspace/db run push`; the configured post-merge script runs this too. Apply the corresponding additive schema changes through the production database deployment workflow before publishing the API that uses them. Do not point development schema commands at production.

Checks:

```sh
pnpm run typecheck
pnpm --filter @workspace/api-server run test:access
node --test artifacts/api-server/tests/student-learning.test.mjs
```

The access suite uses isolated synthetic fixtures against the development database and cleans up only those fixtures. It covers school/class isolation, private sessions, server-owned grades and XP, concurrent/repeated submissions, attendance authorization/corrections, and participation credit for incorrect answers.
