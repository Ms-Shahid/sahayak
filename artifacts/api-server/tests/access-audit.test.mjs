import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import { createHash, randomUUID } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "node_modules/.cache/classos-audit-tests/app.mjs");

test("school access audit: events, isolation, pagination, deletion and atomic rollback", async t => {
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    stdin: { resolveDir: root, contents: `
      import express from "express";
      import accounts from "./src/routes/accounts";
      import { apiErrorHandler } from "./src/lib/errors";
      export * from "@workspace/db";
      export { eq, inArray } from "drizzle-orm";
      export { failNextAudit } from "audit-faults";
      export const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
      app.use("/api", accounts);
      app.use(apiErrorHandler);
    ` },
    bundle: true, platform: "node", format: "esm", outfile: output,
    plugins: [{
      name: "test-only-identity-and-audit-faults",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "identity", namespace: "test" }));
        build.onResolve({ filter: /^audit-faults$/ }, () => ({ path: "faults", namespace: "test" }));
        build.onResolve({ filter: /^\.\.\/lib\/access-audit$/ }, () => ({ path: "writer", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, args => {
          if (args.path === "identity") return { contents: `
            export const getAuth = req => ({ userId: req.headers["x-test-user"] || null });
            export const clerkClient = { users: { getUser: async id => ({
              firstName: id, primaryEmailAddressId: "email",
              emailAddresses: [{ id: "email", emailAddress: id + "@example.test", verification: { status: "verified" } }]
            }) } };
          ` };
          if (args.path === "faults") return { contents: `
            export const fault = { action: null };
            export const failNextAudit = action => { fault.action = action; };
          ` };
          return { resolveDir: root, contents: `
            import { auditAccess as realAudit } from "./src/lib/access-audit.ts";
            import { fault } from "audit-faults";
            export { revokeIssuedInvitations } from "./src/lib/access-audit.ts";
            export async function auditAccess(tx, actor, event) {
              if (fault.action === event.action) { fault.action = null; throw new Error("Synthetic audit write failure"); }
              return realAudit(tx, actor, event);
            }
          ` };
        });
        build.onResolve({ filter: /^[^./]/ }, async args => {
          if (args.pluginData === "external-resolution" || args.path.startsWith("@workspace/")) return;
          if (isBuiltin(args.path)) return { path: args.path, external: true };
          const resolved = await build.resolve(args.path, { resolveDir: args.resolveDir || root,
            kind: args.kind, pluginData: "external-resolution" });
          return resolved.errors.length ? { errors: resolved.errors } : { path: resolved.path, external: true };
        });
      },
    }],
  });
  const m = await import(output);
  const { db, eq, inArray } = m;
  const prefix = `audit-${randomUUID()}`;
  const uid = who => `${prefix}-${who}`;
  const email = who => `${uid(who)}@example.test`;
  const schools = [];
  const secrets = [];
  const server = m.app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  const origin = `http://127.0.0.1:${server.address().port}/api`;
  async function request(who, endpoint, method = "GET", data) {
    const response = await fetch(origin + endpoint, { method,
      headers: { ...(who ? { "x-test-user": uid(who) } : {}),
        ...(data === undefined ? {} : { "content-type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await response.text();
    return { status: response.status, data: text ? JSON.parse(text) : null };
  }
  async function history(who = "admin") {
    const result = await request(who, "/access-history");
    assert.equal(result.status, 200);
    return result.data.events;
  }
  async function invite(who, recipient, role, classIds) {
    const result = await request(who, "/invitations", "POST", { email: email(recipient), role, classIds });
    assert.equal(result.status, 201);
    secrets.push(result.data.token, createHash("sha256").update(result.data.token).digest("hex"));
    return result.data;
  }
  const accept = (who, invitation) => request(who, "/invitations/accept", "POST", { token: invitation.token });
  let admin, teacher, student, room, room2;
  try {
    await t.test("enrollment is atomic and records the verified actor and school", async () => {
      m.failNextAudit("school.enrolled");
      assert.equal((await request("failed-admin", "/enrollment", "POST", { schoolName: prefix })).status, 500);
      assert.equal((await request("failed-admin", "/account")).data.membership, undefined);
      assert.equal((await db.select().from(m.schoolsTable).where(eq(m.schoolsTable.name, prefix))).length, 0);
      for (const who of ["admin", "other-admin"]) {
        const result = await request(who, "/enrollment", "POST", { schoolName: `${prefix}-${who}` });
        assert.equal(result.status, 201);
        schools.push(result.data.membership.schoolId);
        if (who === "admin") admin = result.data.membership;
      }
      const [event] = await history();
      assert.equal(event.action, "school.enrolled");
      assert.equal(event.actorUserId, uid("admin"));
      assert.equal(event.actorEmail, email("admin"));
      assert.equal(event.actorRole, "admin");
      assert.equal(event.targetId, schools[0]);
      assert.equal(event.targetType, "school");
      assert.ok(Number.isFinite(Date.parse(event.createdAt)));
      [room, room2] = await db.insert(m.classesTable).values(["One", "Two"].map(name => ({
        schoolId: schools[0], name, grade: "7", subject: "Science", teacherName: "Synthetic",
      }))).returning();
    });
    await t.test("invitation create/accept/revoke events match changes and failures roll back", async () => {
      const before = await history();
      m.failNextAudit("invitation.created");
      assert.equal((await request("admin", "/invitations", "POST", {
        email: email("teacher"), role: "teacher", classIds: [room.id],
      })).status, 500);
      assert.deepEqual(await history(), before);
      assert.equal((await request("admin", "/invitations")).data.length, 0);
      const invitation = await invite("admin", "teacher", "teacher", [room.id]);
      let [event] = await history();
      assert.equal(event.action, "invitation.created");
      assert.equal(event.targetId, invitation.invitation.id);
      assert.equal(event.targetLabel, email("teacher"));
      assert.deepEqual(event.afterClassIds, [room.id]);
      assert.equal((await accept("wrong-email", invitation)).status, 400);
      const beforeAccept = await history();
      m.failNextAudit("invitation.accepted");
      assert.equal((await accept("teacher", invitation)).status, 500);
      assert.deepEqual(await history(), beforeAccept);
      assert.equal((await request("teacher", "/account")).data.membership, undefined);
      m.failNextAudit("member.joined");
      assert.equal((await accept("teacher", invitation)).status, 500);
      assert.deepEqual(await history(), beforeAccept, "later audit failures roll back earlier audit events too");
      const accepted = await accept("teacher", invitation);
      assert.equal(accepted.status, 200);
      teacher = accepted.data.membership;
      const events = (await history()).slice(0, 3);
      assert.deepEqual(events.map(e => e.action), ["roster.updated", "member.joined", "invitation.accepted"]);
      assert.ok(events.every(e => e.actorUserId === uid("teacher") && e.actorRole === "teacher"));
      assert.deepEqual(events[0].beforeClassIds, []);
      assert.deepEqual(events[0].afterClassIds, [room.id]);
      assert.equal((await accept("teacher", invitation)).status, 400);
      assert.deepEqual((await history()).slice(0, 3), events);
      const forStudent = await invite("teacher", "student", "student", [room.id]);
      student = (await accept("student", forStudent)).data.membership;
      const revoked = await invite("admin", "revoked", "student", [room.id]);
      const beforeRevoke = await history();
      m.failNextAudit("invitation.revoked");
      assert.equal((await request("admin", `/invitations/${revoked.invitation.id}`, "DELETE")).status, 500);
      assert.deepEqual(await history(), beforeRevoke);
      assert.equal((await request("admin", "/invitations")).data.find(i => i.id === revoked.invitation.id).status, "pending");
      assert.equal((await request("admin", `/invitations/${revoked.invitation.id}`, "DELETE")).status, 204);
      [event] = await history();
      assert.equal(event.action, "invitation.revoked");
      assert.equal(event.reason, "direct");
      assert.equal(event.targetId, revoked.invitation.id);
      assert.equal((await request("admin", `/invitations/${revoked.invitation.id}`, "DELETE")).status, 404);
      assert.equal((await accept("revoked", revoked)).status, 400);
    });
    await t.test("existing members gain only new classes; replay and expiration produce no false events", async () => {
      const additional = await invite("admin", "student", "student", [room2.id]);
      assert.equal((await accept("student", additional)).status, 200);
      let events = await history();
      assert.equal(events[0].action, "roster.updated");
      assert.deepEqual(events[0].beforeClassIds, [room.id]);
      assert.deepEqual([...events[0].afterClassIds].sort(), [room.id, room2.id].sort());
      assert.equal(events[1].action, "invitation.accepted");
      assert.equal(events[2].action, "invitation.created", "existing member does not join twice");
      const redundant = await invite("admin", "student", "student", [room2.id]);
      const beforeCount = (await history()).length;
      const outcomes = await Promise.all([accept("student", redundant), accept("student", redundant)]);
      assert.deepEqual(outcomes.map(r => r.status).sort(), [200, 400]);
      events = await history();
      assert.equal(events.length, beforeCount + 1, "only the acceptance is new; roster is unchanged");
      assert.equal(events[0].action, "invitation.accepted");
      const expired = await invite("admin", "expired", "student", [room.id]);
      await db.update(m.invitationsTable).set({ expiresAt: new Date(0) }).where(eq(m.invitationsTable.id, expired.invitation.id));
      const before = await history();
      assert.equal((await accept("expired", expired)).status, 400);
      assert.deepEqual(await history(), before);
    });
    await t.test("only same-school administrators can read; no token or hash is stored", async () => {
      for (const [who, code] of [[null, 401], ["outsider", 403], ["teacher", 403], ["student", 403]]) {
        assert.equal((await request(who, "/access-history")).status, code);
      }
      const other = await history("other-admin");
      assert.equal(other.length, 1);
      assert.equal(other[0].actorUserId, uid("other-admin"));
      const spoofed = await request("other-admin", `/access-history?schoolId=${schools[0]}`);
      assert.deepEqual(spoofed.data.events, other);
      assert.equal((await request("admin", "/access-history?before=invalid")).status, 400);
      const stored = await db.select().from(m.accessAuditTable).where(eq(m.accessAuditTable.schoolId, schools[0]));
      const text = JSON.stringify(stored);
      for (const secret of secrets) assert.ok(!text.includes(secret), "neither token nor hash belongs in audit storage");
      assert.ok(stored.every(e => !("token" in e) && !("tokenHash" in e)));
    });
    await t.test("roster snapshots, automatic revocations, no-ops and member removal are atomic", async () => {
      const pending = await invite("teacher", "pending", "student", [room.id]);
      let before = await history();
      const path = `/members/${teacher.id}`;
      assert.equal((await request("other-admin", path, "PATCH", { classIds: [] })).status, 404);
      assert.equal((await request("admin", `/members/${admin.id}`, "DELETE")).status, 400);
      assert.equal((await request("admin", path, "PATCH", { classIds: [room.id] })).status, 200);
      assert.deepEqual(await history(), before, "same roster is not a change");
      m.failNextAudit("roster.updated");
      assert.equal((await request("admin", path, "PATCH", { classIds: [room2.id] })).status, 500);
      assert.deepEqual(await history(), before);
      assert.deepEqual((await request("teacher", "/account")).data.membership.classIds, [room.id]);
      assert.equal((await request("admin", "/invitations")).data.find(i => i.id === pending.invitation.id).status, "pending");
      assert.equal((await request("admin", path, "PATCH", { classIds: [room2.id] })).status, 200);
      let events = (await history()).slice(0, 2);
      assert.deepEqual(events.map(e => e.action), ["roster.updated", "invitation.revoked"]);
      assert.deepEqual(events[0].beforeClassIds, [room.id]);
      assert.deepEqual(events[0].afterClassIds, [room2.id]);
      assert.equal(events[1].targetId, pending.invitation.id);
      assert.equal(events[1].reason, "roster_change");
      assert.equal((await accept("pending", pending)).status, 400);
      const lastInvitation = await invite("teacher", "last", "student", [room2.id]);
      before = await history();
      m.failNextAudit("member.removed");
      assert.equal((await request("admin", path, "DELETE")).status, 500);
      assert.deepEqual(await history(), before);
      assert.ok((await request("teacher", "/account")).data.membership);
      assert.equal((await request("admin", "/invitations")).data.find(i => i.id === lastInvitation.invitation.id).status, "pending");
      assert.equal((await request("admin", path, "DELETE")).status, 204);
      events = (await history()).slice(0, 2);
      assert.equal(events[0].action, "member.removed");
      assert.equal(events[0].actorUserId, uid("admin"));
      assert.equal(events[0].targetLabel, email("teacher"));
      assert.deepEqual(events[0].beforeClassIds, [room2.id]);
      assert.equal(events[1].targetId, lastInvitation.invitation.id);
      assert.equal(events[1].reason, "member_removal");
      assert.equal((await request("teacher", "/access-history")).status, 403);
      assert.equal((await accept("last", lastInvitation)).status, 400);
      assert.ok((await history()).some(e => e.actorUserId === uid("teacher") && e.action === "invitation.created"),
        "deleting an issuer cannot delete their history");
      assert.equal((await request("admin", `/members/${student.id}`, "DELETE")).status, 204);
    });
    await t.test("keyset pagination is bounded, stable and remains school-scoped", async () => {
      // Populate only synthetic history in this test's school.
      await db.insert(m.accessAuditTable).values(Array.from({ length: 55 }, (_, i) => ({
        schoolId: schools[0], actorUserId: uid("admin"), actorName: "Synthetic", actorEmail: email("admin"),
        actorRole: "admin", action: "roster.updated", targetType: "member", targetId: admin.id,
        targetLabel: `Pagination ${i}`, reason: "direct",
      })));
      const first = (await request("admin", "/access-history")).data;
      assert.equal(first.events.length, 50);
      assert.equal(first.nextCursor, first.events.at(-1).id);
      const second = (await request("admin", `/access-history?before=${first.nextCursor}`)).data;
      assert.ok(second.events.length > 0);
      assert.equal(second.nextCursor, null);
      const ids = [...first.events, ...second.events].map(e => e.id);
      assert.equal(new Set(ids).size, ids.length);
      assert.deepEqual(ids, [...ids].sort((a, b) => b - a));
      assert.ok([...first.events, ...second.events].every(e => e.actorUserId !== uid("other-admin")));
      const all = await db.select().from(m.accessAuditTable).where(eq(m.accessAuditTable.schoolId, schools[0]));
      assert.equal(ids.length, all.length);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (schools.length) {
      await db.delete(m.classesTable).where(inArray(m.classesTable.schoolId, schools));
      await db.delete(m.membershipsTable).where(inArray(m.membershipsTable.schoolId, schools));
      await db.delete(m.accessAuditTable).where(inArray(m.accessAuditTable.schoolId, schools));
      await db.delete(m.schoolsTable).where(inArray(m.schoolsTable.id, schools));
    }
    await m.pool.end();
    await rm(path.dirname(output), { recursive: true, force: true });
  }
});
