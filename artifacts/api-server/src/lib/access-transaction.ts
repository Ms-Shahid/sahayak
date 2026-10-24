import { db, membershipsTable, schoolsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { AccessError, type Member } from "./access";

export type AccessTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function lockSchool(tx: AccessTransaction, schoolId: number) {
  await tx.select().from(schoolsTable).where(eq(schoolsTable.id, schoolId)).for("update");
}

// Every access-management writer takes the tenant lock before row locks and
// checks authorization again. A request waiting behind a transfer cannot use
// its old administrator snapshot after the transfer commits.
export async function accessTransaction<T>(actor: Member, work: (tx: AccessTransaction) => Promise<T>) {
  return db.transaction(async tx => {
    await lockSchool(tx, actor.schoolId);
    const [current] = await tx.select().from(membershipsTable).where(eq(membershipsTable.id, actor.id));
    if (!current || current.role !== actor.role || current.schoolId !== actor.schoolId) {
      throw new AccessError(403, "Your access has changed. Refresh and try again.");
    }
    return work(tx);
  });
}
