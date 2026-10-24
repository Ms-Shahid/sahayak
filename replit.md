# ClassOS

A syllabus-grounded K–12 learning MVP connecting school curriculum, teacher-reviewed practice, and student learning.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server using its managed workflow
- `pnpm --filter @workspace/classos run dev` — run the web frontend using its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- `pnpm --filter @workspace/api-server run test:access` — authorization regression tests against development PostgreSQL with isolated synthetic identities
- `pnpm --filter @workspace/api-server run test:access-audit` — school audit isolation, accurate events and transactional rollback checks
- `node --test artifacts/api-server/tests/student-learning.test.mjs` — adaptive recommendation and ranking unit tests
- `node --test artifacts/api-server/tests/learning-evidence.test.mjs` — rubric and topic-evidence unit tests
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- Web app and styles: `artifacts/classos/src/`
- Learning API: `artifacts/api-server/src/routes/classos.ts` and `student-learning.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Database schemas: `lib/db/src/schema/`

## Architecture decisions

- Clerk verifies accounts; the application database controls school and class membership. New schools start empty with the enrolling account as administrator. Existing unassigned demo records are quarantined, not automatically claimed.
- Invitations are manually shared private tokens, hashed at rest, email-bound, single-use, revocable, and valid for seven days. No invitation email is sent. Each account has one school and role; additional invitations can extend class access within that school and role.
- Students receive assignment prompts/options only, submit once using server identity, and can view only their own submissions and mastery. Administrators manage the school roster; teachers work with assigned classes only.
- Student practice uses teacher-published questions, personal recent accuracy, and a saved pace preference. It does not invent or automatically publish new questions. Source hints are available; grading explanations and answer indices arrive only after submission.
- Engagement XP is participation-based, not a grade or speed measure. It is server-calculated and replay-safe. Class leaderboards show anonymous peer aliases and engagement totals only.
- Sources accept pasted text and private App Storage files (PDF, DOCX, PPTX, JPEG, PNG, WebP). File uploads are limited to 20 MB and 40 PDF pages/slides; extraction failures are explicit and excluded from learning context. DOCX citations use document sections, not invented physical page numbers. Scanned PDF pages and images use AI transcription that staff must verify.
- Uploaded assignment work is private to its student and authorized class staff. It stays pending and is excluded from mastery until staff save a grade and feedback. File bytes never enter PostgreSQL.
- AI uses managed Replit OpenAI access. Exact source quotations are checked before returning generated practice or tutor citations; teacher review is still required and correctness is not guaranteed.

## Product

- School overview, master curriculum hierarchy, and class workspace creation.
- Teacher text-source library and source-cited practice generation, review, and publishing.
- Student notes, assignments, resumable practice, puzzle quests, personal scorecards, class XP leaderboards, pace preferences, and source-grounded tutoring.
- Staff-recorded attendance with student XP credit and correction support.
- Secure account onboarding, school enrollment, class-scoped teacher/student invitations, and access management.
- Automated roster sync, multimedia generation, prerequisite graphs, and difficulty-calibrated AI question generation remain outside the current MVP.

## User preferences

- Give school, teacher, and student experiences equal MVP depth.
- Students should have an engaging notes/assignments/gamified learning experience, earn engagement XP from attendance, practice and quiz submissions, and learn adaptively at their own pace.

## Gotchas

- Regenerate clients and validation schemas after OpenAPI changes.
- Restart the managed API workflow after backend changes; its dev command builds before serving.
- The GitHub repository is `Ms-Shahid/sahayak`. Work must be submitted through pull requests; `main` requires two approving reviews, including for administrators. Never bypass that policy.
- See `docs/student-learning.md` for XP rules, adaptation boundaries, and schema rollout.
- See `docs/learning-feedback.md` for rubric review, topic evidence, debrief and warm-up behavior.
- See `docs/access-history.md` for school access audit coverage, privacy, pagination and schema rollout.
- See `docs/admin-handover.md` for confirmed administrator transfer, recipient eligibility and credential revocation.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
