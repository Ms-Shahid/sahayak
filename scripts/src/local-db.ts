// Starts a throwaway local Postgres for development (no Docker or system install needed).
// Data lives in .local/pgdata at the repo root. Stop with Ctrl+C.
import { existsSync, mkdirSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const root = path.resolve(import.meta.dirname, "..", "..");
const dataDir = path.join(root, ".local", "pgdata");
const port = Number(process.env.LOCAL_DB_PORT ?? 5433);

const pg = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port,
  persistent: true,
});

if (!existsSync(path.join(dataDir, "PG_VERSION"))) {
  mkdirSync(dataDir, { recursive: true });
  await pg.initialise();
}
await pg.start();
try {
  await pg.createDatabase("classos");
} catch {
  // database already exists
}
console.log(`Local Postgres ready: postgresql://postgres:postgres@localhost:${port}/classos`);

const stop = async () => {
  await pg.stop();
  process.exit(0);
};
process.on("SIGINT", stop);
process.on("SIGTERM", stop);
