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
- Learning API: `artifacts/api-server/src/routes/classos.ts`
- API contract: `lib/api-spec/openapi.yaml`
- Database schema: `lib/db/src/schema/classos.ts`

## Architecture decisions

- Clerk verifies accounts; the application database controls school and class membership. New schools start empty with the enrolling account as administrator. Existing unassigned demo records are quarantined, not automatically claimed.
- Invitations are manually shared private tokens, hashed at rest, email-bound, single-use, revocable, and valid for seven days. No invitation email is sent. Each account has one school and role; additional invitations can extend class access within that school and role.
- Students receive assignment prompts/options only, submit once using server identity, and can view only their own submissions and mastery. Administrators manage the school roster; teachers work with assigned classes only.
- Source ingestion is text-first. Persistent file uploads, OCR, and PDF/PPTX parsing are not implemented.
- AI uses managed Replit OpenAI access. Exact source quotations are checked before returning generated practice or tutor citations; teacher review is still required and correctness is not guaranteed.

## Product

- School overview, master curriculum hierarchy, and class workspace creation.
- Teacher text-source library and source-cited practice generation, review, and publishing.
- Student assignments, scored submissions, class mastery, and source-grounded tutoring.
- Secure account onboarding, school enrollment, class-scoped teacher/student invitations, and access management.
- Automated roster sync, multimedia generation, and adaptive learning remain outside the current MVP.

## User preferences

- Give school, teacher, and student experiences equal MVP depth.

## Gotchas

- Regenerate clients and validation schemas after OpenAPI changes.
- Restart the managed API workflow after backend changes; its dev command builds before serving.
- The user-provided `Ms-Shahid/sahayak` GitHub repository has not been linked or pushed from this project.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
