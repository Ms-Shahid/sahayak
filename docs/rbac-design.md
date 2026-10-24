# ClassOS: Auth and RBAC Design

Scope: demo-grade sign-in with seeded users, plus server-enforced role-based access control for content uploaded by admins and teachers and consumed by students. Demo data only; no real student records.

## 1. Roles

| Role | Who | Owns |
|---|---|---|
| `admin` | Department head / curriculum director | Tier 1 (school) materials, curriculum, users, class assignments, access policy |
| `teacher` | Grade + subject teacher | Tier 2 (class) materials, practice, assignments for classes they are assigned to |
| `student` | Learner | Nothing; reads published content, submits work, uses the tutor in classes they are enrolled in |

## 2. Authentication (demo)

- `GET /api/auth/demo-users`: public list of seeded users for the sign-in screen.
- `POST /api/auth/login {userId}`: sets an HttpOnly, signed session cookie (HMAC-SHA256 of the user id, secret from `SESSION_SECRET`, with a dev default).
- `GET /api/auth/me`, `POST /api/auth/logout`.
- No passwords: this is a demo. The cookie is signed so a client cannot forge another identity, and all authorization is done on the server. Swapping in real auth later only means replacing the login route and `loadUser` middleware.
- Seeded on first start: 1 admin, one teacher per existing class (matched by `teacherName`), and 3 students enrolled in every class.

## 3. Data model additions

- `classos_users(id, name, email, role)`
- `classos_class_members(user_id, class_id)`: teacher assignment and student enrollment, role comes from the user.
- `classos_access_policy(id=1, tier1_default_visibility, class_upload_default_status)`: admin-controlled defaults.
- `classos_audit_log(id, actor_id, action, target, detail, created_at)`
- `classos_materials` gains: `scope` (`school` | `class`), `visibility` (`teachers` | `students` | `ai_only`), `status` (`draft` | `published` | `archived`), `uploaded_by`, `grade`, `subject` (for school-scope items), and `class_id` becomes nullable (school-scope items have none).

## 4. Content visibility rules

A material is visible to a user when:

| Viewer | Rule |
|---|---|
| admin | everything |
| teacher | class-scope items of classes they are assigned to (any status except archived); school-scope items matching their class grade and subject (any visibility except archived) |
| student | `status = published` AND `visibility = students`, in classes they are enrolled in (class scope) or school-scope items matching an enrolled class grade and subject |

`visibility` meanings:
- `teachers`: only teachers and admins can read it; not given to the AI tutor.
- `students`: students can read it, and the AI can use it.
- `ai_only`: students cannot open it, but the AI tutor and practice generator may ground on it. Default for Tier 1 textbooks (set by the admin policy).

**AI grounding sources** (tutor and practice) = materials with `status = published` and `visibility` in (`students`, `ai_only`), scoped to the class (class items plus matching school items). For practice generation by a teacher, `teachers` visibility items of their own class are also allowed. Archived and draft items are never used for the tutor.

## 5. Permission matrix

| Action | admin | teacher | student |
|---|---|---|---|
| Manage users, class membership, access policy | yes | no | no |
| View audit log | yes | no | no |
| Create / edit curriculum | yes | no | no |
| Upload school-scope material | yes | no | no |
| Upload class-scope material | yes | own classes | no |
| Change material visibility / status | yes | own class items | no |
| Create classes | yes | no | no |
| List classes | all | assigned | enrolled |
| Generate practice, create assignments | yes | own classes | no |
| View submissions / mastery for a class | yes | own classes | no |
| List assignments | yes | own classes | enrolled classes, published only |
| Submit assignment | no | no | enrolled classes; student name taken from the session |
| Ask tutor | yes | yes (own classes) | enrolled classes |
| School dashboard | yes | assigned-class view | no |

Every route first runs `requireUser`, then `requireRole(...)`, then a class-membership check where a `classId` is involved. Failures return `401` (no session) or `403` (wrong role / not a member). Student-facing queries filter in SQL, not in the UI.

## 6. Admin console

Admin-only screen at `/admin`:
1. Users: list, add, change role.
2. Class access: assign teachers and enroll students per class.
3. Access policy: default visibility for Tier 1 uploads; default status for teacher uploads (`published` or `draft` requiring admin review).
4. Content governance: every material with its scope, owner, visibility and status, editable.
5. Audit log.

## 7. Frontend

- Sign-in screen listing demo users by role; session loaded from `/api/auth/me`.
- Navigation shows only sections the role may use; route guards redirect otherwise (UI is convenience only, the API is authoritative).
- Students never see source text of `ai_only` items; the tutor shows citation excerpts only for sources the student may open, and a "from school reference material" label otherwise.

## 8. Out of scope here

Passwords/SSO, roster sync, file upload and parsing, grading desk, per-student parent roles. See `docs/tasks.md`.
