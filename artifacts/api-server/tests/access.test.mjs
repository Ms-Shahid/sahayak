import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createRequire, isBuiltin } from "node:module";
import test from "node:test";
import { build } from "esbuild";

// Isolated test bundle: only the identity provider is stubbed. Real Express routes,
// validation, authorization, transactions, and the development PostgreSQL are used.
// This stub is never imported by, or built into, the application.
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "node_modules/.cache/classos-access-tests/app.mjs");

test("ClassOS school, invitation, class and student privacy boundaries", async (t) => {
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    stdin: {
      resolveDir: root,
      contents: `
        import express from "express";
        import router from "./src/routes/index";
        import { apiErrorHandler } from "./src/lib/errors";
        export * from "@workspace/db";
        export { eq, inArray } from "drizzle-orm";
        export { privateFile } from "./src/lib/private-files";
        export { extractFile, validateFileContent } from "./src/lib/extract-file";
        export const app = express();
        app.use(express.json());
        app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
        app.use("/api", router);
        app.use(apiErrorHandler);
      `,
    },
    bundle: true, platform: "node", format: "esm", outfile: output,
    plugins: [{
      name: "isolated-identity",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "clerk-test", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, () => ({
          contents: `
            export const getAuth = req => ({ userId: req.headers["x-test-user"] || null });
            export const clerkClient = { users: { getUser: async id => ({
              firstName: id, lastName: "Synthetic", primaryEmailAddressId: "email",
              emailAddresses: [{ id: "email", emailAddress: id + "@example.test",
                verification: { status: id.endsWith("unverified") ? "unverified" : "verified" } }]
            }) } };
          `,
        }));
        build.onResolve({ filter: /^[^./]/ }, async (args) => {
          if (args.pluginData === "external-resolution" || args.path.startsWith("@workspace/")) return undefined;
          if (isBuiltin(args.path)) return { path: args.path, external: true };
          // Respect ESM export conditions rather than accidentally selecting CJS-only entrypoints.
          const resolved = await build.resolve(args.path, { resolveDir: args.resolveDir || root, kind: args.kind, pluginData: "external-resolution" });
          if (resolved.errors.length) return { errors: resolved.errors };
          return { path: resolved.path, external: true };
        });
      },
    }],
  });
  const m = await import(output);
  const { db, eq, inArray } = m;
  const prefix = `access-${randomUUID()}`;
  const user = (name) => `${prefix}-${name}`;
  const schoolIds = [];
  const legacyIds = [];
  const server = m.app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  async function request(who, endpoint, method = "GET", data, extraHeaders = {}) {
    const response = await fetch(origin + endpoint, {
      method,
      headers: { ...(who ? { "x-test-user": user(who) } : {}),
        ...(data !== undefined ? { "content-type": "application/json" } : {}), ...extraHeaders },
      ...(data !== undefined ? { body: JSON.stringify(data) } : {}),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null, headers: response.headers };
  }
  async function invite(issuer, recipient, role, classIds) {
    const result = await request(issuer, "/invitations", "POST", { email: `${user(recipient)}@example.test`, role, classIds });
    assert.equal(result.status, 201);
    return result.data;
  }
  async function accept(recipient, receipt) {
    return request(recipient, "/invitations/accept", "POST", { token: receipt.token });
  }
  const classInput = (name) => ({ name, grade: "7", subject: "Science", teacherName: "Ignored display input" });
  let roomA, roomA2, roomB, assignment, teacher, student, student2, pending;
  try {
    await t.test("authentication is mandatory; verified identities and JSON mutations are required", async () => {
      for (const endpoint of ["/account", "/classes", "/school/dashboard", "/school/curriculum", "/materials?classId=1",
        "/assignments?classId=1", "/assignments/1/submissions", "/learning/mastery?classId=1", "/members", "/invitations",
        "/uploads/1", "/uploads/1/download", "/school/materials"]) {
        assert.equal((await request(null, endpoint)).status, 401, endpoint);
      }
      assert.equal((await request("unverified", "/account")).status, 403);
      assert.equal((await request("outsider", "/classes")).status, 403);
      assert.equal((await request("admin-a", "/enrollment", "POST", {})).status, 400);
      assert.equal((await request("admin-a", "/enrollment", "POST", { schoolName: "  " })).status, 400);
      assert.equal((await request("admin-a", "/enrollment", "POST", { schoolName: "No CSRF" },
        { "sec-fetch-site": "cross-site" })).status, 403);
    });
    await t.test("new enrollment never claims existing or legacy school records", async () => {
      for (const who of ["admin-a", "admin-b"]) {
        const result = await request(who, "/enrollment", "POST", { schoolName: `${prefix} School` });
        assert.equal(result.status, 201);
        schoolIds.push(result.data.membership.schoolId);
        assert.equal(result.data.membership.role, "admin");
      }
      assert.notEqual(schoolIds[0], schoolIds[1], "same name must not join another school");
      const [legacy] = await db.insert(m.classesTable).values({ name: "Quarantined synthetic demo", grade: "7", subject: "Science", teacherName: "Demo" }).returning();
      legacyIds.push(legacy.id);
      assert.deepEqual((await request("admin-a", "/classes")).data, []);
      roomA = (await request("admin-a", "/classes", "POST", classInput(`${prefix} A`))).data;
      roomA2 = (await request("admin-a", "/classes", "POST", classInput(`${prefix} A2`))).data;
      roomB = (await request("admin-b", "/classes", "POST", classInput(`${prefix} B`))).data;
      assert.equal((await request("admin-a", "/enrollment", "POST", { schoolName: "Again" })).status, 409);
      assert.deepEqual((await request("admin-a", "/classes")).data.map((r) => r.id), [roomA.id, roomA2.id]);
      assert.equal((await request("admin-a", `/materials?classId=${roomB.id}`)).status, 404);
    });
    await t.test("teacher invitations are email-bound, stored as hashes, single-use, and class-scoped", async () => {
      const receipt = await invite("admin-a", "teacher", "teacher", [roomA.id]);
      const [stored] = await db.select().from(m.invitationsTable).where(eq(m.invitationsTable.id, receipt.invitation.id));
      assert.notEqual(stored.tokenHash, receipt.token);
      assert.equal(stored.tokenHash.length, 64);
      assert.equal((await accept("wrong-email", receipt)).status, 400);
      const joined = await accept("teacher", receipt);
      assert.equal(joined.status, 200);
      teacher = joined.data.membership;
      assert.equal(teacher.role, "teacher");
      assert.deepEqual(teacher.classIds, [roomA.id]);
      assert.equal((await accept("teacher", receipt)).status, 400);
      assert.deepEqual((await request("teacher", "/classes")).data.map((r) => r.id), [roomA.id]);
      assert.equal((await request("teacher", "/classes", "POST", classInput("Unauthorized"))).status, 403);
      assert.equal((await request("teacher", "/members")).status, 403);
      assert.equal((await request("teacher", "/school/dashboard")).status, 403);
      assert.equal((await request("teacher", "/invitations", "POST", {
        email: `${user("other")}@example.test`, role: "teacher", classIds: [roomA.id],
      })).status, 403);
      assert.equal((await request("teacher", "/invitations", "POST", {
        email: `${user("other")}@example.test`, role: "student", classIds: [roomA2.id],
      })).status, 404);
      const listed = await request("admin-a", "/invitations");
      assert.ok(listed.data.every((r) => !("token" in r) && !("tokenHash" in r)));
    });
    await t.test("expired and revoked invitations cannot grant membership; concurrent acceptance grants once", async () => {
      const expired = await invite("admin-a", "expired", "student", [roomA.id]);
      await db.update(m.invitationsTable).set({ expiresAt: new Date(0) }).where(eq(m.invitationsTable.id, expired.invitation.id));
      assert.equal((await accept("expired", expired)).status, 400);
      const revoked = await invite("teacher", "revoked", "student", [roomA.id]);
      assert.equal((await request("admin-b", `/invitations/${revoked.invitation.id}`, "DELETE")).status, 404);
      assert.equal((await request("teacher", `/invitations/${revoked.invitation.id}`, "DELETE")).status, 204);
      assert.equal((await accept("revoked", revoked)).status, 400);
      const receipt = await invite("teacher", "student", "student", [roomA.id]);
      const results = await Promise.all([accept("student", receipt), accept("student", receipt)]);
      assert.deepEqual(results.map((r) => r.status).sort(), [200, 400]);
      student = results.find((r) => r.status === 200).data.membership;
      const receipt2 = await invite("teacher", "student2", "student", [roomA.id]);
      const joined2 = await accept("student2", receipt2);
      assert.equal(joined2.status, 200);
      student2 = joined2.data.membership;
      const otherSchool = await invite("admin-b", "student", "student", [roomB.id]);
      assert.equal((await accept("student", otherSchool)).status, 409);
      const roleChange = await invite("admin-a", "student", "teacher", [roomA.id]);
      assert.equal((await accept("student", roleChange)).status, 409);
    });
    await t.test("school and class guards protect every learning route before data or AI use", async () => {
      const result = await request("teacher", "/materials", "POST", { classId: roomA.id, title: "Water source",
        sourceName: "Synthetic textbook", topic: "Water", sourceText: "Plants use water and sunlight to grow. This is synthetic material." });
      assert.equal(result.status, 201);
      assert.equal((await request("admin-b", `/materials?classId=${roomA.id}`)).status, 404);
      for (const id of [roomA2.id, roomB.id, legacyIds[0]]) {
        for (const who of ["teacher", "student"]) {
          for (const endpoint of [`/assignments?classId=${id}`, `/learning/mastery?classId=${id}`]) {
            assert.equal((await request(who, endpoint)).status, 404, `${who} ${endpoint}`);
          }
          assert.equal((await request(who, "/learning/tutor", "POST", { classId: id, question: "Water?", mode: "hint" })).status, 404);
        }
        assert.equal((await request("teacher", "/learning/practice", "POST", { classId: id, topic: "Water", count: 1 })).status, 404);
      }
      assert.equal((await request("student", `/materials?classId=${roomA.id}`)).status, 403);
      assert.equal((await request("student", "/learning/practice", "POST", { classId: roomA.id, topic: "Water", count: 1 })).status, 403);
      const entry = { subject: "Science", grade: "7", unit: "Plants", chapter: "Water", topic: "Growth", standard: "Synthetic" };
      assert.equal((await request("admin-a", "/school/curriculum", "POST", entry)).status, 201);
      assert.equal((await request("teacher", "/school/curriculum", "POST", entry)).status, 403);
      assert.equal((await request("admin-b", "/school/curriculum")).data.length, 0);
      assert.equal((await request("admin-a", "/school/dashboard")).data.studentCount, 2);
      assert.equal((await request("admin-a", "/school/dashboard")).data.sourceCount, 1);
      assert.equal((await request("admin-b", "/school/dashboard")).data.sourceCount, 0);
    });
    await t.test("students never receive keys, explanations, source excerpts, peer submissions or peer mastery", async () => {
      const source = (await request("teacher", `/materials?classId=${roomA.id}`)).data[0];
      const question = { id: randomUUID(), prompt: "Which resource helps plants grow?", options: ["Water", "Plastic", "Glass", "Metal"],
        answerIndex: 0, explanation: "The private answer explanation.", sourceName: "Synthetic textbook",
        sourceExcerpt: "Plants use water and sunlight to grow.", topic: "Water", materialId: source.id };
      const result = await request("teacher", "/assignments", "POST", {
        classId: roomA.id, title: `${prefix} Practice`, topic: "Water", dueDate: "2027-01-01", questions: [question],
      });
      assert.equal(result.status, 201);
      assignment = result.data;
      assert.equal((await request("teacher", `/assignments?classId=${roomA.id}`)).data[0].questions[0].answerIndex, 0);
      const visible = (await request("student", `/assignments?classId=${roomA.id}`)).data[0];
      assert.deepEqual(Object.keys(visible.questions[0]).sort(), ["id", "options", "prompt", "topic"]);
      assert.equal((await request("student", "/assignments", "POST", {
        classId: roomA.id, title: "Spoof", topic: "Water", dueDate: "2027-01-01", questions: [question],
      })).status, 403);
      const first = await request("student", `/assignments/${assignment.id}/submissions`, "POST", {
        studentName: "Impersonated peer", answers: [0], userId: user("student2"), schoolId: schoolIds[1], role: "admin",
      });
      assert.equal(first.status, 201);
      assert.equal(first.data.studentName, `${user("student")} Synthetic`);
      assert.equal(first.data.score, 100);
      assert.equal((await request("student", `/assignments/${assignment.id}/submissions`, "POST", { answers: [1] })).status, 409);
      assert.equal((await request("student2", `/assignments/${assignment.id}/submissions`, "POST", { answers: [99] })).status, 400);
      const attempts = await Promise.all([1, 2].map(() => request("student2", `/assignments/${assignment.id}/submissions`, "POST", { answers: [1] })));
      assert.deepEqual(attempts.map((r) => r.status).sort(), [201, 409]);
      assert.equal((await request("teacher", `/assignments/${assignment.id}/submissions`, "POST", { answers: [0] })).status, 403);
      assert.equal((await request("admin-b", `/assignments/${assignment.id}/submissions`)).status, 404);
      for (const who of ["student", "student2"]) {
        const submissions = await request(who, `/assignments/${assignment.id}/submissions`);
        assert.equal(submissions.data.length, 1);
        assert.equal(submissions.data[0].studentName, `${user(who)} Synthetic`);
        const mastery = await request(who, `/learning/mastery?classId=${roomA.id}`);
        assert.equal(mastery.data.students.length, 1);
        assert.equal(mastery.data.students[0].studentName, `${user(who)} Synthetic`);
        assert.equal(mastery.data.average, who === "student" ? 100 : 0);
        assert.equal((await request(who, `/assignments?classId=${roomA.id}`)).data[0].submittedCount, 1);
      }
      assert.equal((await request("teacher", `/assignments/${assignment.id}/submissions`)).data.length, 2);
      assert.equal((await request("teacher", `/learning/mastery?classId=${roomA.id}`)).data.students.length, 2);
    });
    await t.test("student notes, adaptive practice, puzzles and XP are private and replay safe", async () => {
      const path = `/student/overview?classId=${roomA.id}`;
      for (const endpoint of [path, `/student/notes?classId=${roomA.id}`, "/student/sessions/1"]) {
        assert.equal((await request(null, endpoint)).status, 401);
        assert.equal((await request("teacher", endpoint)).status, 403);
      }
      for (const endpoint of ["/student/overview", "/student/notes"]) {
        assert.equal((await request("student", `${endpoint}?classId=${roomB.id}`)).status, 404);
        assert.equal((await request("student", `${endpoint}?classId=${legacyIds[0]}`)).status, 404);
      }
      const notes = await request("student", `/student/notes?classId=${roomA.id}`);
      assert.equal(notes.status, 200);
      assert.ok(notes.data[0].sourceText.includes("Plants use water"));
      const initial = (await request("student", path)).data;
      assert.equal(initial.xpTotal, 25, "existing assignments count once");
      assert.equal(initial.counts.assignmentsCompleted, 1);
      assert.equal(initial.topics[0].mastery, 100);
      assert.ok(initial.leaderboard.every(r => !("name" in r) && !("email" in r) && !("userId" in r)));
      assert.equal(initial.leaderboard.find(r => r.isMe).alias, "You");
      assert.equal((await request("student", "/student/preferences", "POST", { classId: roomB.id, pace: "relaxed" })).status, 404);
      assert.equal((await request("student", "/student/preferences", "POST", { classId: roomA.id, pace: "unlimited" })).status, 400);
      assert.equal((await request("student", "/student/preferences", "POST", { classId: roomA.id, pace: "relaxed" })).status, 200);
      assert.equal((await request("student", path)).data.pace, "relaxed");
      assert.equal((await request("student", "/student/sessions", "POST", { classId: roomB.id, mode: "practice" })).status, 404);
      assert.equal((await request("student", "/student/sessions", "POST", { classId: roomA.id, mode: "practice", topic: "Missing" })).status, 409);
      const started = await request("student", "/student/sessions", "POST", { classId: roomA.id, mode: "practice", points: 9000 });
      assert.equal(started.status, 201);
      assert.equal(started.data.pace, "relaxed");
      assert.equal(started.data.feedback.length, 0);
      assert.equal(started.data.questions[0].answerIndex, undefined);
      assert.equal(started.data.questions[0].explanation, undefined);
      assert.equal((await request("student2", `/student/sessions/${started.data.id}`)).status, 404);
      assert.equal((await request("student2", `/student/sessions/${started.data.id}/submit`, "POST", { answers: [0] })).status, 404);
      assert.equal((await request("student", path)).data.activeSessionId, started.data.id);
      assert.equal((await request("student", `/student/sessions/${started.data.id}`)).data.submitted, false);
      assert.equal((await request("student", `/student/sessions/${started.data.id}/submit`, "POST", { answers: [9] })).status, 400);
      const results = await Promise.all([1, 2].map(() => request("student", `/student/sessions/${started.data.id}/submit`, "POST", { answers: [0], score: 0, xpEarned: 999 })));
      assert.ok(results.every(r => r.status === 200 && r.data.score === 100 && r.data.xpEarned === 5));
      assert.equal(results[0].data.feedback[0].answerIndex, 0);
      assert.equal((await request("student", path)).data.xpTotal, 30);
      const retry = await request("student", "/student/sessions", "POST", { classId: roomA.id, mode: "practice" });
      const retryResult = await request("student", `/student/sessions/${retry.data.id}/submit`, "POST", { answers: [0] });
      assert.equal(retryResult.data.xpEarned, 0, "replaying the same completed question cannot farm points");
      const puzzle = await request("student", "/student/sessions", "POST", { classId: roomA.id, mode: "puzzle" });
      const puzzleResult = await request("student", `/student/sessions/${puzzle.data.id}/submit`, "POST", { answers: [0] });
      assert.equal(puzzleResult.data.xpEarned, 10);
      const wrong = await request("student2", "/student/sessions", "POST", { classId: roomA.id, mode: "practice" });
      assert.equal((await request("student2", `/student/sessions/${wrong.data.id}/submit`, "POST", { answers: [1] })).data.xpEarned, 5, "engagement XP is independent of accuracy");
      const weak = (await request("student2", path)).data;
      assert.equal(weak.topics[0].stage, "revisit");
      assert.equal(weak.topics[0].suggestedQuestions, 3);
      assert.equal(weak.xpTotal, 30, "only my assignment and practice engagement count");
      const final = (await request("student", path)).data;
      assert.equal(final.xpTotal, 40);
      assert.equal(final.counts.practiceCompleted, 2);
      assert.equal(final.counts.quizzesSubmitted, 1);
    });
    await t.test("only authorized staff can record one attendance award per student/class/day", async () => {
      const date = new Date().toISOString().slice(0, 10);
      const endpoint = `/student/attendance?classId=${roomA.id}&date=${date}`;
      const input = { classId: roomA.id, memberId: student.id, date, present: true };
      assert.equal((await request("student", endpoint)).status, 403);
      assert.equal((await request("student", "/student/attendance", "POST", input)).status, 403);
      assert.equal((await request("student", `/student/ATTENDANCE/?classId=${roomA.id}&date=${date}`)).status, 403);
      assert.equal((await request("student", "/student/attendance/", "POST", input)).status, 403);
      assert.equal((await request("admin-b", endpoint)).status, 404);
      assert.equal((await request("teacher", "/student/attendance", "POST", { ...input, memberId: teacher.id })).status, 404);
      assert.equal((await request("teacher", "/student/attendance", "POST", { ...input, date: "2099-01-01" })).status, 400);
      assert.equal((await request("teacher", "/student/attendance", "POST", { ...input, date: "2026-02-30" })).status, 400);
      const results = await Promise.all([1, 2].map(() => request("teacher", "/student/attendance", "POST", input)));
      assert.ok(results.every(r => r.status === 200));
      assert.equal((await request("teacher", endpoint)).data.find(r => r.memberId === student.id).present, true);
      let overview = (await request("student", `/student/overview?classId=${roomA.id}`)).data;
      assert.equal(overview.xpBreakdown.attendance, 10);
      assert.equal(overview.counts.classesAttended, 1);
      assert.equal(overview.xpTotal, 50);
      assert.equal((await request("teacher", "/student/attendance", "POST", { ...input, present: false })).status, 200);
      overview = (await request("student", `/student/overview?classId=${roomA.id}`)).data;
      assert.equal(overview.xpBreakdown.attendance, 0);
      assert.equal(overview.counts.classesAttended, 0);
    });
    await t.test("private file uploads retain citations, reject unsafe files and protect master sources", async () => {
      const AdmZip = createRequire(path.join(root, "package.json"))("adm-zip");
      const zip = new AdmZip();
      zip.addFile("word/document.xml", Buffer.from('<w:document xmlns:w="w"><w:body><w:p><w:r><w:t>Plants use water and sunlight to grow. Water moves from roots to leaves.</w:t></w:r></w:p></w:body></w:document>'));
      const bytes = zip.toBuffer();
      const input = { filename: "Synthetic-textbook.docx", contentType: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        size: bytes.length, purpose: "source", title: "Master plants", topic: "Water" };
      assert.equal((await request("teacher", "/uploads", "POST", input)).status, 403);
      assert.equal((await request("student", "/uploads", "POST", { ...input, classId: roomA.id })).status, 403);
      assert.equal((await request("teacher", "/uploads", "POST", { ...input, classId: roomB.id })).status, 404);
      assert.equal((await request("admin-a", "/uploads", "POST", { ...input, size: 21 * 1024 * 1024 })).status, 400);
      assert.equal((await request("admin-a", "/uploads", "POST", { ...input, contentType: "image/png" })).status, 400);
      const reserved = await request("admin-a", "/uploads", "POST", input);
      assert.equal(reserved.status, 201);
      assert.ok(reserved.data.uploadURL);
      assert.equal((await fetch(reserved.data.uploadURL, { method: "PUT", headers: { "Content-Type": input.contentType }, body: bytes })).status, 200);
      assert.equal((await request("teacher", `/uploads/${reserved.data.id}/complete`, "POST", {})).status, 404);
      assert.equal((await request("admin-b", `/uploads/${reserved.data.id}`)).status, 404);
      assert.equal((await request("student", `/uploads/${reserved.data.id}/download`)).status, 403);
      const complete = await request("admin-a", `/uploads/${reserved.data.id}/complete`, "POST", {});
      assert.equal(complete.status, 200);
      assert.equal(complete.data.status, "ready", JSON.stringify(complete.data));
      assert.equal(complete.data.pages[0].page, 1);
      assert.match(complete.data.pages[0].label, /not a physical page/);
      assert.match(complete.data.pages[0].text, /roots to leaves/);
      assert.ok(!("objectPath" in complete.data) && !("ownerId" in complete.data));
      const masters = (await request("teacher", "/school/materials")).data;
      assert.equal(masters.length, 1);
      assert.equal(masters[0].classId, null);
      assert.equal((await request("admin-b", "/school/materials")).data.length, 0);
      assert.ok((await request("student", `/student/notes?classId=${roomA.id}`)).data.some(r => r.id === masters[0].id));
      assert.ok((await request("teacher", `/materials?classId=${roomA.id}`)).data.some(r => r.uploadId === reserved.data.id));
      const original = await fetch(`${origin}/uploads/${reserved.data.id}/download`, { headers: { "x-test-user": user("teacher") } });
      assert.equal(original.status, 200);
      assert.equal(original.headers.get("cache-control"), "private, no-store");
      assert.match(original.headers.get("content-disposition"), /^attachment/);
      assert.deepEqual(Buffer.from(await original.arrayBuffer()), bytes);
      // A still-valid PUT URL can overwrite only staging, never the accepted original.
      await fetch(reserved.data.uploadURL, { method: "PUT", body: Buffer.from("replacement") });
      const repeated = await request("admin-a", `/uploads/${reserved.data.id}/complete`, "POST", {});
      assert.equal(repeated.data.pages[0].text, complete.data.pages[0].text);
      const malformed = await request("teacher", "/uploads", "POST", { ...input, filename: "Broken.pdf", contentType: "application/pdf", size: 4, classId: roomA.id });
      assert.equal(malformed.status, 201);
      await fetch(malformed.data.uploadURL, { method: "PUT", body: Buffer.from("nope") });
      const failure = await request("teacher", `/uploads/${malformed.data.id}/complete`, "POST", {});
      assert.equal(failure.data.status, "failed");
      assert.match(failure.data.error, /valid PDF/);
      assert.equal((await request("teacher", `/uploads/${malformed.data.id}/download`)).status, 404);
    });
    await t.test("slide and PDF extraction preserve page boundaries", async () => {
      const AdmZip = createRequire(path.join(root, "package.json"))("adm-zip");
      const slides = new AdmZip();
      // The visible presentation order deliberately differs from internal slide filenames.
      slides.addFile("ppt/presentation.xml", Buffer.from('<p:presentation xmlns:p="p" xmlns:r="r"><p:sldIdLst><p:sldId r:id="r2"/><p:sldId r:id="r1"/></p:sldIdLst></p:presentation>'));
      slides.addFile("ppt/_rels/presentation.xml.rels", Buffer.from('<Relationships><Relationship Id="r1" Target="slides/slide1.xml"/><Relationship Id="r2" Target="slides/slide2.xml"/></Relationships>'));
      for (let n = 1; n <= 2; n++) slides.addFile(`ppt/slides/slide${n}.xml`, Buffer.from(`<p:sld xmlns:p="p" xmlns:a="a"><a:p><a:r><a:t>Slide ${n}: plants need water and sunlight to grow.</a:t></a:r></a:p></p:sld>`));
      const parsed = await m.extractFile(slides.toBuffer(), "slides.pptx");
      assert.equal(parsed.length, 2);
      assert.deepEqual(parsed.map(p => p.label), ["Slide 1", "Slide 2"]);
      assert.match(parsed[0].text, /Slide 2:/);
      const content = "BT /F1 12 Tf 30 100 Td (Plants use water and sunlight to grow.) Tj ET";
      const pdf = Buffer.from(`%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Resources <</Font <</F1 4 0 R>>>> /Contents 5 0 R>> endobj
4 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj
5 0 obj <</Length ${content.length}>> stream
${content}
endstream endobj
trailer <</Root 1 0 R>>
%%EOF`);
      const pages = await m.extractFile(pdf, "chapter.pdf");
      assert.equal(pages[0].label, "Page 1");
      assert.match(pages[0].text, /Plants use water/);
      // Image-only PDFs exercise native rendering + managed OCR, not the PDF text layer.
      const sharp = createRequire(path.join(root, "package.json"))("sharp");
      const image = await sharp(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1000" height="240"><rect width="100%" height="100%" fill="white"/><text x="30" y="80" font-size="36" fill="black">Plants need water and sunlight to grow.</text><text x="30" y="150" font-size="36" fill="black">Water enters through the roots.</text></svg>')).jpeg().toBuffer();
      const drawing = "q 1000 0 0 240 0 0 cm /Scan Do Q";
      const scan = Buffer.concat([Buffer.from(`%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 1000 240] /Resources <</XObject <</Scan 4 0 R>>>> /Contents 5 0 R>> endobj
4 0 obj <</Type /XObject /Subtype /Image /Width 1000 /Height 240 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${image.length}>> stream
`), image, Buffer.from(`
endstream endobj
5 0 obj <</Length ${drawing.length}>> stream
${drawing}
endstream endobj
trailer <</Root 1 0 R>>
%%EOF`)]);
      const scanned = await m.extractFile(scan, "scanned-work.pdf");
      assert.match(scanned[0].text.toLowerCase(), /water/);
      assert.match(scanned[0].text.toLowerCase(), /roots/);
    });
    await t.test("uploaded work stays pending until authorized staff review; peer files and replays stay private", async () => {
      const overviewPath = `/student/overview?classId=${roomA.id}`;
      const accuracyBefore = (await request("student", overviewPath)).data.topics.map(t => ({ topic: t.topic, mastery: t.mastery }));
      const [assignment2] = await db.insert(m.assignmentsTable).values({ classId: roomA.id, title: "Photo work", topic: "Water", dueDate: "2027-01-01", questions: assignment.questions, status: "published" }).returning();
      const [file] = await db.insert(m.uploadsTable).values({ schoolId: schoolIds[0], classId: roomA.id, assignmentId: assignment2.id,
        ownerId: user("student"), purpose: "submission", filename: "work.pdf", contentType: "application/pdf", size: 5,
        objectPath: `${process.env.PRIVATE_OBJECT_DIR}/classos/${randomUUID()}`, status: "ready",
        pages: [{ page: 1, label: "Page 1", text: "Synthetic handwritten answer." }] }).returning();
      await m.privateFile(file.objectPath).save(Buffer.from("%PDF-"), { resumable: false });
      assert.equal((await request("teacher", `/uploads/${file.id}`)).status, 404, "unsubmitted student uploads are private");
      assert.equal((await request("student2", `/uploads/${file.id}`)).status, 404);
      assert.equal((await request("student2", `/assignments/${assignment2.id}/submissions`, "POST", { attachmentId: file.id })).status, 400);
      const submitted = await request("student", `/assignments/${assignment2.id}/submissions`, "POST", { attachmentId: file.id });
      assert.equal(submitted.status, 201);
      assert.equal(submitted.data.reviewStatus, "pending");
      assert.deepEqual((await request("student", overviewPath)).data.topics.map(t => ({ topic: t.topic, mastery: t.mastery })), accuracyBefore, "file work must not invent per-question wrong answers");
      assert.equal((await request("student", `/learning/mastery?classId=${roomA.id}`)).data.average, 100, "pending grade is excluded");
      assert.equal((await request("student", `/assignments/${assignment2.id}/submissions`, "POST", { attachmentId: file.id })).status, 409);
      assert.equal((await request("teacher", `/uploads/${file.id}`)).status, 200);
      assert.equal((await request("admin-b", `/uploads/${file.id}/download`)).status, 404);
      const reviewPath = `/submissions/${submitted.data.id}/review`;
      assert.equal((await request("student", reviewPath, "PATCH", { score: 80, feedback: "Spoof" })).status, 403);
      assert.equal((await request("admin-b", reviewPath, "PATCH", { score: 80, feedback: "Cross school" })).status, 404);
      assert.equal((await request("teacher", reviewPath, "PATCH", { score: 101, feedback: "Invalid" })).status, 400);
      const reviewed = await request("teacher", reviewPath, "PATCH", { score: 80, feedback: "Good reasoning. Label your diagram." });
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.data.reviewStatus, "reviewed");
      assert.equal((await request("student", `/learning/mastery?classId=${roomA.id}`)).data.average, 90);
      const own = (await request("student", `/assignments/${assignment2.id}/submissions`)).data[0];
      assert.equal(own.teacherFeedback, "Good reasoning. Label your diagram.");
      assert.equal(own.score, 80);
      assert.deepEqual(own.questionResults, [], "overall-only file grades do not fabricate topic evidence");
      const rubricReview = await request("teacher", reviewPath, "PATCH", {
        feedback: "Question-level file review.",
        rubric: assignment2.questions.map(q => ({ questionId: q.id, criterion: "Reasoning", points: 3, maxPoints: 10, feedback: "Revisit the source." })),
      });
      assert.equal(rubricReview.status, 200);
      assert.equal(rubricReview.data.score, 30);
      const rubricWork = (await request("student", `/assignments/${assignment2.id}/submissions`)).data[0];
      assert.equal(rubricWork.questionResults[0].score, 30);
      assert.equal(rubricWork.questionResults[0].selectedIndex, null);
      assert.equal((await request("teacher", reviewPath, "PATCH", { score: 90, feedback: "Discard rubric" })).status, 400);
    });
    await t.test("rubric evidence drives topic mastery, debriefs and adaptive practice without crossing class boundaries", async () => {
      const source = (await request("teacher", "/materials", "POST", {
        classId: roomA.id, title: "Review source", sourceName: "Review textbook", topic: "Weak concept",
        sourceText: "Plants use water and sunlight to grow. Evidence helps explain plant growth.",
      })).data;
      const qs = ["Weak concept", "Strong concept"].map((topic, i) => ({
        id: randomUUID(), prompt: `Which resource helps plants grow (${i + 1})?`,
        options: ["Water", "Plastic", "Glass", "Metal"], answerIndex: 0, explanation: "Plants use water and sunlight to grow.",
        sourceName: source.sourceName, materialId: source.id, sourceExcerpt: "Plants use water and sunlight to grow.", topic,
      }));
      const a = (await request("teacher", "/assignments", "POST", {
        classId: roomA.id, title: "Mixed-topic review", topic: "Plants", dueDate: "2027-01-01", questions: qs,
      })).data;
      const s = (await request("student", `/assignments/${a.id}/submissions`, "POST", { answers: [0, 1] })).data;
      const reviewPath = `/submissions/${s.id}/review`;
      const rubric = qs.map((q, i) => ({ questionId: q.id, criterion: "Source reasoning", points: i ? 9 : 2, maxPoints: 10, feedback: i ? "Well supported." : "Revisit the saved passage." }));
      assert.equal((await request("student", reviewPath, "PATCH", { feedback: "Spoof", rubric })).status, 403);
      assert.equal((await request("admin-b", reviewPath, "PATCH", { feedback: "Spoof", rubric })).status, 404);
      assert.equal((await request("teacher", reviewPath, "PATCH", { feedback: "Missing question", rubric: rubric.slice(0, 1) })).status, 400);
      assert.equal((await request("teacher", reviewPath, "PATCH", { feedback: "Invalid marks", rubric: [{ ...rubric[0], points: 11 }, rubric[1]] })).status, 400);
      assert.equal((await request("teacher", reviewPath, "PATCH", { score: 10, feedback: "Overall-only online grade" })).status, 400);
      const reviewed = await request("teacher", reviewPath, "PATCH", { score: 100, feedback: "Teacher-confirmed source reasoning.", rubric });
      assert.equal(reviewed.status, 200);
      assert.equal(reviewed.data.score, 55, "server ignores spoofed score and derives rubric percentage");
      assert.deepEqual(reviewed.data.rubric, rubric);
      const own = (await request("student", `/assignments/${a.id}/submissions`)).data[0];
      assert.ok(own.reviewedAt);
      assert.deepEqual(own.questionResults.map(r => r.score), [20, 90]);
      assert.ok(own.questionResults.every(r => r.citation.materialId === source.id));
      assert.equal((await request("student2", `/assignments/${a.id}/submissions`)).data.length, 0);
      const mastery = (await request("student", `/learning/mastery?classId=${roomA.id}`)).data.students[0].topics;
      assert.equal(mastery.find(t => t.topic === "Weak concept").score, 20);
      assert.equal(mastery.find(t => t.topic === "Weak concept").weakness, true);
      assert.equal(mastery.find(t => t.topic === "Strong concept").score, 90);
      const debriefPath = `/learning/debrief?classId=${roomA.id}`;
      assert.equal((await request(null, debriefPath)).status, 401);
      assert.equal((await request("student", debriefPath)).status, 403);
      assert.equal((await request("admin-b", debriefPath)).status, 404);
      assert.equal((await request("teacher", "/learning/debrief?classId=invalid")).status, 400);
      const debrief = (await request("teacher", debriefPath)).data;
      const weak = debrief.topics.find(t => t.topic === "Weak concept");
      assert.equal(weak.score, 20);
      assert.equal(weak.studentsNeedingSupport, 1);
      assert.equal(weak.evidence[0].submissionId, s.id);
      assert.equal(weak.sourceAvailable, true);
      assert.match(weak.warmUp, /Review textbook/);
      const recommendation = (await request("student", `/student/overview?classId=${roomA.id}`)).data.topics[0];
      assert.equal(recommendation.topic, "Weak concept");
      assert.equal(recommendation.mastery, 20);
      const session = await request("student", "/student/sessions", "POST", { classId: roomA.id, mode: "practice" });
      assert.equal(session.status, 201);
      assert.equal(session.data.topic, "Weak concept");
      assert.ok(session.data.questions.every(q => !("answerIndex" in q) && !("explanation" in q)));
      // Source availability is rechecked, not trusted from old published question metadata.
      await db.update(m.classMaterialsTable).set({ extractionStatus: "failed" }).where(eq(m.classMaterialsTable.id, source.id));
      const unavailable = (await request("teacher", debriefPath)).data.topics.find(t => t.topic === "Weak concept");
      assert.equal(unavailable.sourceAvailable, false);
      assert.ok(!unavailable.evidence[0].result.citation);
      assert.match(unavailable.warmUp, /No supporting saved source/);
      assert.equal((await request("student", "/student/sessions", "POST", { classId: roomA.id, topic: "Weak concept", mode: "practice" })).status, 409);
    });
    await t.test("roster updates and removal revoke access and outstanding teacher invitations immediately", async () => {
      pending = await invite("teacher", "pending", "student", [roomA.id]);
      assert.equal((await request("admin-b", `/members/${teacher.id}`, "PATCH", { classIds: [roomB.id] })).status, 404);
      assert.equal((await request("admin-a", `/members/${teacher.id}`, "PATCH", { classIds: [roomB.id] })).status, 404);
      assert.equal((await request("admin-a", `/members/${teacher.id}`, "PATCH", { classIds: [roomA2.id] })).status, 200);
      assert.equal((await request("teacher", `/assignments/${assignment.id}/submissions`)).status, 404);
      assert.equal((await accept("pending", pending)).status, 400);
      assert.deepEqual((await request("teacher", "/classes")).data.map((r) => r.id), [roomA2.id]);
      assert.equal((await request("admin-a", `/members/${student.id}`, "DELETE")).status, 204);
      assert.equal((await request("student", "/classes")).status, 403);
      assert.equal((await request("student", `/assignments/${assignment.id}/submissions`)).status, 403);
      assert.equal((await request("student", "/account")).data.membership, undefined);
      const self = (await request("admin-a", "/account")).data.membership;
      assert.equal((await request("admin-a", `/members/${self.id}`, "DELETE")).status, 400);
    });
  } finally {
    await new Promise((resolve) => server.close(resolve));
    // Remove only this run's synthetic records, never pre-existing data.
    if (schoolIds.length) {
      const files = await db.select().from(m.uploadsTable).where(inArray(m.uploadsTable.schoolId, schoolIds));
      for (const file of files) {
        await m.privateFile(file.objectPath).delete({ ignoreNotFound: true });
        await m.privateFile(`${file.objectPath}.incoming`).delete({ ignoreNotFound: true });
      }
      const rooms = await db.select({ id: m.classesTable.id }).from(m.classesTable).where(inArray(m.classesTable.schoolId, schoolIds));
      if (rooms.length) await db.delete(m.classesTable).where(inArray(m.classesTable.id, rooms.map((r) => r.id)));
      await db.delete(m.classMaterialsTable).where(inArray(m.classMaterialsTable.schoolId, schoolIds));
      await db.delete(m.uploadsTable).where(inArray(m.uploadsTable.schoolId, schoolIds));
      await db.delete(m.membershipsTable).where(inArray(m.membershipsTable.schoolId, schoolIds));
      await db.delete(m.curriculumEntriesTable).where(inArray(m.curriculumEntriesTable.schoolId, schoolIds));
      await db.delete(m.schoolsTable).where(inArray(m.schoolsTable.id, schoolIds));
    }
    if (legacyIds.length) await db.delete(m.classesTable).where(inArray(m.classesTable.id, legacyIds));
    await m.pool.end();
    await rm(path.dirname(output), { recursive: true, force: true });
  }
});
