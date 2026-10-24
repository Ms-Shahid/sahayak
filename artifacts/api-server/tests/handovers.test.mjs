import assert from "node:assert/strict";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltin } from "node:module";
import { randomUUID, createHash } from "node:crypto";
import test from "node:test";
import { build } from "esbuild";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const output = path.join(root, "node_modules/.cache/classos-handover-tests/app.mjs");

test("verified administrator handovers are isolated, atomic and single-use", async t => {
  await mkdir(path.dirname(output), { recursive: true });
  await build({
    stdin: { resolveDir: root, contents: `
      import express from "express";
      import accounts from "./src/routes/accounts";
      import handovers from "./src/routes/handovers";
      import { apiErrorHandler } from "./src/lib/errors";
      export * from "@workspace/db";
      export { eq, inArray } from "drizzle-orm";
      export { fault } from "audit-faults";
      export const app = express();
      app.use(express.json());
      app.use((req, _res, next) => { req.log = { warn() {}, error() {} }; next(); });
      app.use("/api", accounts, handovers);
      app.use(apiErrorHandler);
    ` },
    bundle: true, platform: "node", format: "esm", outfile: output,
    plugins: [{
      name: "synthetic-identities-and-audit-failure",
      setup(build) {
        build.onResolve({ filter: /^@clerk\/express$/ }, () => ({ path: "identity", namespace: "test" }));
        build.onResolve({ filter: /^audit-faults$/ }, () => ({ path: "faults", namespace: "test" }));
        build.onResolve({ filter: /^\.\.\/lib\/access-audit$/ }, () => ({ path: "writer", namespace: "test" }));
        build.onLoad({ filter: /.*/, namespace: "test" }, args => {
          if (args.path === "identity") return { contents: `
            export const getAuth = req => ({ userId: req.headers["x-test-user"] || null });
            export const clerkClient = { users: { getUser: async id => ({
              firstName: id, primaryEmailAddressId: "email",
              emailAddresses: [{ id: "email", emailAddress: id + "@example.test",
                verification: { status: id.endsWith("-unverified") ? "unverified" : "verified" } }]
            }) } };
          ` };
          if (args.path === "faults") return { contents: `export const fault = { action: null };` };
          return { resolveDir: root, contents: `
            import { auditAccess as real } from "./src/lib/access-audit.ts";
            import { fault } from "audit-faults";
            export { revokeIssuedInvitations } from "./src/lib/access-audit.ts";
            export async function auditAccess(tx, actor, event) {
              if (fault.action === event.action) { fault.action = null; throw new Error("Synthetic audit failure"); }
              return real(tx, actor, event);
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
  const prefix = `handover-${randomUUID()}`;
  const uid = who => `${prefix}-${who}`;
  const email = who => `${uid(who)}@example.test`;
  const schools = [];
  const server = m.app.listen(0, "127.0.0.1");
  await new Promise(resolve => server.once("listening", resolve));
  async function request(who, endpoint, method = "GET", data) {
    const res = await fetch(`http://127.0.0.1:${server.address().port}/api${endpoint}`, {
      method, headers: { ...(who ? { "x-test-user": uid(who) } : {}),
        ...(data === undefined ? {} : { "content-type": "application/json" }) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await res.text();
    return { status: res.status, data: text ? JSON.parse(text) : null };
  }
  let admin, teacher, other, student, unverified, room;
  const start = (id = teacher.id, who = "admin") => request(who, "/handovers", "POST", {
    recipientId: id, confirmation: "TRANSFER ADMINISTRATION",
  });
  const accept = (receipt, who = "teacher") => request(who, "/handovers/accept", "POST", {
    token: receipt.token, confirmation: "ACCEPT ADMINISTRATION",
  });
  const invite = who => request(who, "/invitations", "POST", {
    email: email(`invited-${who}`), role: "student", classIds: [room.id],
  });
  try {
    for (const who of ["admin", "other"]) {
      const res = await request(who, "/enrollment", "POST", { schoolName: `${prefix}-${who}` });
      assert.equal(res.status, 201);
      schools.push(res.data.membership.schoolId);
      if (who === "admin") admin = res.data.membership; else other = res.data.membership;
    }
    [room] = await db.insert(m.classesTable).values({
      schoolId: schools[0], name: prefix, grade: "7", subject: "Science", teacherName: "Synthetic",
    }).returning();
    [teacher, student, unverified] = await db.insert(m.membershipsTable).values(
      [["teacher", "teacher"], ["student", "student"], ["unverified", "teacher"]].map(([who, role]) => ({
        schoolId: schools[0], userId: uid(who), email: email(who), name: who, role,
      }))).returning();
    await db.insert(m.classMembershipsTable).values([teacher, admin].map(member => ({ memberId: member.id, classId: room.id })));
    await t.test("requires verified current admin, same-school teacher and explicit confirmation", async () => {
      for (const who of [null, "student", "teacher", "unverified"]) assert.ok((await start(teacher.id, who)).status >= 400);
      for (const id of [other.id, student.id, admin.id, 999999999]) assert.equal((await start(id)).status, 400);
      assert.equal((await request("admin", "/handovers", "POST", { recipientId: teacher.id })).status, 400);
      assert.equal((await request("teacher", "/handovers")).status, 403);
      const receipt = (await start()).data;
      const [stored] = await db.select().from(m.adminHandoversTable).where(eq(m.adminHandoversTable.id, receipt.handover.id));
      assert.notEqual(stored.tokenHash, receipt.token);
      assert.equal(stored.tokenHash, createHash("sha256").update(receipt.token).digest("hex"));
      assert.ok(stored.expiresAt.getTime() - Date.now() <= 86400000);
      assert.ok(stored.expiresAt.getTime() - Date.now() > 86300000);
      const list = await request("admin", "/handovers");
      assert.ok(!JSON.stringify(list.data).includes(receipt.token));
      assert.deepEqual((await request("other", "/handovers")).data, []);
      assert.equal((await accept(receipt, "other")).status, 403);
      assert.equal((await accept(receipt, "unverified")).status, 403);
      await db.update(m.adminHandoversTable).set({ recipientEmail: email("someone-else") }).where(eq(m.adminHandoversTable.id, receipt.handover.id));
      assert.equal((await accept(receipt)).status, 400);
      assert.equal((await request("teacher", "/handovers/accept", "POST", { token: receipt.token })).status, 400);
    });
    await t.test("replacement, cancellation and expiry invalidate credentials", async () => {
      const first = (await start()).data;
      const second = (await start()).data;
      assert.equal((await accept(first)).status, 400);
      assert.equal((await request("other", `/handovers/${second.handover.id}`, "DELETE")).status, 404);
      assert.equal((await request("admin", `/handovers/${second.handover.id}`, "DELETE")).status, 204);
      assert.equal((await accept(second)).status, 400);
      const expired = (await start()).data;
      await db.update(m.adminHandoversTable).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(m.adminHandoversTable.id, expired.handover.id));
      assert.equal((await accept(expired)).status, 400);
      assert.equal((await request("admin", `/members/${admin.id}`, "DELETE")).status, 400);
    });
    await t.test("failed transfer rolls back roles, credential, roster and invitation changes", async () => {
      const receipt = (await start()).data;
      const adminInvite = (await invite("admin")).data;
      const teacherInvite = (await invite("teacher")).data;
      m.fault.action = "handover.accepted";
      assert.equal((await accept(receipt)).status, 500);
      assert.equal((await request("admin", "/account")).data.membership.role, "admin");
      assert.equal((await request("teacher", "/account")).data.membership.role, "teacher");
      const [row] = await db.select().from(m.adminHandoversTable).where(eq(m.adminHandoversTable.id, receipt.handover.id));
      assert.equal(row.acceptedAt, null);
      const invitations = (await request("admin", "/invitations")).data;
      for (const id of [adminInvite.invitation.id, teacherInvite.invitation.id]) {
        assert.equal(invitations.find(i => i.id === id).status, "pending");
      }
      assert.equal((await db.select().from(m.classMembershipsTable).where(eq(m.classMembershipsTable.memberId, admin.id))).length, 1);
    });
    await t.test("concurrent accepts transfer once; old admin loses access and all obsolete credentials are revoked", async () => {
      const receipt = (await start()).data;
      const results = await Promise.all([accept(receipt), accept(receipt)]);
      assert.equal(results.filter(r => r.status === 200).length, 1);
      const newAccount = (await request("teacher", "/account")).data;
      assert.equal(newAccount.membership.role, "admin");
      assert.equal((await request("admin", "/account")).data.membership.role, "teacher");
      assert.deepEqual((await request("admin", "/account")).data.membership.classIds, []);
      for (const endpoint of ["/members", "/access-history", "/handovers"]) {
        assert.equal((await request("admin", endpoint)).status, 403);
        assert.equal((await request("teacher", endpoint)).status, 200);
      }
      assert.equal((await start()).status, 403);
      assert.equal((await accept(receipt, "admin")).status, 400);
      const roster = (await request("teacher", "/members")).data;
      assert.equal(roster.filter(r => r.role === "admin").length, 1);
      const invitations = (await request("teacher", "/invitations")).data;
      assert.ok(invitations.every(i => i.status === "revoked"));
      const history = (await request("teacher", "/access-history")).data.events;
      assert.equal(history.filter(e => e.action === "handover.accepted").length, 1);
      assert.ok(!JSON.stringify(history).includes(receipt.token));
      assert.equal((await request("teacher", `/members/${admin.id}`, "DELETE")).status, 204);
      assert.equal((await request("teacher", `/members/${teacher.id}`, "DELETE")).status, 400);
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    if (schools.length) {
      await db.delete(m.adminHandoversTable).where(inArray(m.adminHandoversTable.schoolId, schools));
      await db.delete(m.classesTable).where(inArray(m.classesTable.schoolId, schools));
      await db.delete(m.membershipsTable).where(inArray(m.membershipsTable.schoolId, schools));
      await db.delete(m.accessAuditTable).where(inArray(m.accessAuditTable.schoolId, schools));
      await db.delete(m.schoolsTable).where(inArray(m.schoolsTable.id, schools));
    }
    await m.pool.end();
    await rm(path.dirname(output), { recursive: true, force: true });
  }
});
