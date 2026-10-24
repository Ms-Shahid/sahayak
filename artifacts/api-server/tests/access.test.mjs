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
        export const app = express();
        app.use(express.json());
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
        build.onResolve({ filter: /^[^./]/ }, (args) => {
          if (args.path.startsWith("@workspace/")) return undefined;
          const resolved = isBuiltin(args.path) ? args.path
            : createRequire(path.join(args.resolveDir || root, "package.json")).resolve(args.path);
          return { path: resolved, external: true };
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
        "/assignments?classId=1", "/assignments/1/submissions", "/learning/mastery?classId=1", "/members", "/invitations"]) {
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
      const question = { id: randomUUID(), prompt: "Which resource helps plants grow?", options: ["Water", "Plastic", "Glass", "Metal"],
        answerIndex: 0, explanation: "The private answer explanation.", sourceName: "Synthetic textbook",
        sourceExcerpt: "Plants use water and sunlight to grow.", topic: "Water" };
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
      const rooms = await db.select({ id: m.classesTable.id }).from(m.classesTable).where(inArray(m.classesTable.schoolId, schoolIds));
      if (rooms.length) await db.delete(m.classesTable).where(inArray(m.classesTable.id, rooms.map((r) => r.id)));
      await db.delete(m.membershipsTable).where(inArray(m.membershipsTable.schoolId, schoolIds));
      await db.delete(m.curriculumEntriesTable).where(inArray(m.curriculumEntriesTable.schoolId, schoolIds));
      await db.delete(m.schoolsTable).where(inArray(m.schoolsTable.id, schoolIds));
    }
    if (legacyIds.length) await db.delete(m.classesTable).where(inArray(m.classesTable.id, legacyIds));
    await m.pool.end();
    await rm(path.dirname(output), { recursive: true, force: true });
  }
});
