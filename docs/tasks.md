# ClassOS: Remaining Tasks (PRD gap analysis)

Status key: DONE = in repo, PARTIAL = demo-level, TODO = missing.
Reviewed against `docs/product-overview.md` and the code on `main` (commit ad9cba9).

## Current state by PRD section

| PRD item | Status | Notes |
|---|---|---|
| Tier 1 curriculum hierarchy (Subject/Unit/Chapter/Topic) | PARTIAL | `classos_curriculum_entries` + `/school/curriculum`. No Tier 1 master materials (textbook PDFs, formula guides, exam board specs) |
| Tier 2 class workspace | PARTIAL | Classes, materials, assignments exist. Materials are pasted text only |
| Multi-format ingestion (pdf/docx/txt/pptx/images/heic) | TODO | No upload, storage, OCR or parsing; `sourceText` is a text column |
| Roster sync (ClassLink/OneRoster/Google Classroom/Canvas) | TODO | `studentName` is a free-text string; no student/user table |
| Practice & Homework Hub | PARTIAL | MCQ assignments and auto-scored submissions. No handwritten/PDF submissions, no grading/markup desk |
| Topic Mastery Matrix | PARTIAL | Per-student per-topic average, class level. No department level, no live updates |
| Teacher AI Content Studio | PARTIAL | Only MCQ practice. No slide decks, audio/video, infographics, flashcards |
| Teacher approval workflow | PARTIAL | Source excerpts shown and exact-quote checked. Needs draft status, per-question edit/approve/reject, steering prompt (`/learning/practice` response should not publish directly) |
| Student AI Tutor | PARTIAL | Class-source grounded, hint/explain modes, quote-verified. Tier 1 material not in grounding; no chat history; no method-aligned solving |
| Teacher Assistant Agent (daily recap and debrief) | TODO | Nothing built |
| Auth and roles | TODO | Role switch is navigation only; no sign-in, no authorization |

## P0: Demo-critical (do first)

1. **Approval workflow:** generate returns drafts; add `draft/approved` status, edit question, reject question, and "regenerate with steering prompt". Publish only approved items. (API, OpenAPI, DB, `PracticePage`)
2. **File upload and parsing:** upload endpoint with object storage; text extraction for `.pdf`, `.docx`, `.txt`, `.pptx`; store original file plus extracted text per material.
3. **Image/scan ingestion:** OCR or vision extraction for `.png`, `.jpg`, `.heic` (whiteboard, handwriting, diagrams); show extraction for teacher correction before it becomes a grounded source.
4. **Tier 1 materials:** add `tier` (school/class) to materials; school-level upload UI; tutor and practice grounding pull Tier 1 plus Tier 2 and label which tier each citation came from.
5. **Demo seed data and script:** seeded school, grade classes, students, one polished end-to-end flow (upload, generate, approve, student tutor).

## P1: Core PRD features

6. **Auth and roles:** sign-in, roles (admin/dept head, teacher, student), server-side authorization on every route; replace `studentName` strings with a `students` table and user IDs.
7. **Student submissions:** photo/PDF upload of handwritten work; split-screen grading and markup desk for teachers; manual score and feedback.
8. **Mastery matrix upgrade:** link topics to curriculum entries (FK not free-text), department-level rollup, topic-by-student heatmap.
9. **Teacher Assistant Agent:** end-of-class recap for students; teacher debrief with weak topics and next-day warm-up suggestions generated from mastery plus submissions.
10. **Content Studio outputs:** slide deck, flashcards, quiz variants, infographic, audio summary (pick two for the hackathon).
11. **Tutor upgrades:** conversation history, step-by-step hint ladder, "not covered by class materials" state, per-answer source panel.

## P2: Nice to have / post-hackathon

12. Roster sync: OneRoster CSV import first, then Google Classroom and Canvas; ClassLink later.
13. Multi-section handling (sections within a grade) if required; audit log; district-level multi-school.
14. Automated tests (API routes, quote-verification logic), CI, `pnpm run typecheck` gate.
15. Accessibility, mobile layout, localization (the name "Sahayak" suggests multilingual/Indian-school use).

## Engineering and housekeeping

- **Link GitHub:** `replit.md` notes the Replit project was not linked to `Ms-Shahid/sahayak`; agree on a branch workflow with the team to avoid conflicts.
- **Model name:** `classos.ts` hardcodes `gpt-5.6-terra` through Replit's managed OpenAI; make it an env/config value.
- **Secrets and env:** document `DATABASE_URL` and AI keys in a `.env.example`.
- **Limits:** source text is truncated to 5000 chars per source in prompts; replace with chunking and retrieval once files are uploaded (needed for textbook PDFs).
- **Safety:** keep the rule from `.agents/memory/grounded-learning.md`: a valid quote proves provenance, not correctness; keep teacher approval and avoid "zero hallucination" claims in UI copy. Use synthetic data only; no real student records.
- Remove stray placeholder folders `src/` and `tests/` in the repo root.
