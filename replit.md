# ClassOS

A syllabus-grounded K–12 learning MVP connecting school curriculum, teacher-reviewed practice, and student learning.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server using its managed workflow
- `pnpm --filter @workspace/classos run dev` — run the web frontend using its managed workflow
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
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

- The current app is a synthetic-data demo. The role switch is navigation, not authentication or authorization; do not use real student records.
- Source ingestion is text-first. Persistent file uploads, OCR, and PDF/PPTX parsing are not implemented.
- AI uses managed Replit OpenAI access. Exact source quotations are checked before returning generated practice or tutor citations; teacher review is still required and correctness is not guaranteed.

## Product

- School overview, master curriculum hierarchy, and class workspace creation.
- Teacher text-source library and source-cited practice generation, review, and publishing.
- Student assignments, scored submissions, class mastery, and source-grounded tutoring.
- Full sign-in, role enforcement, roster sync, multimedia generation, and adaptive learning remain outside the current demo.

## User preferences

- Give school, teacher, and student experiences equal MVP depth.

## Gotchas

- Regenerate clients and validation schemas after OpenAPI changes.
- Restart the managed API workflow after backend changes; its dev command builds before serving.
- The user-provided `Ms-Shahid/sahayak` GitHub repository has not been linked or pushed from this project.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
