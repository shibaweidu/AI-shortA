import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { closePostgresPool, isPostgresEnabled, waitForPostgres, withPostgresClient } from "../db/postgres.js";

const migrationsDir = join(process.cwd(), "migrations");

async function main() {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL is required to run migrations");
  }
  await waitForPostgres();

  const fileNames = (await readdir(migrationsDir))
    .filter((fileName) => /^\d+_.+\.sql$/i.test(fileName))
    .sort();

  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await client.query(`
        create table if not exists schema_migrations (
          id text primary key,
          applied_at timestamptz not null default now()
        )
      `);

      for (const fileName of fileNames) {
        const migrationId = basename(fileName, ".sql");
        const existing = await client.query("select 1 from schema_migrations where id = $1", [migrationId]);
        if (existing.rowCount) {
          console.log(`[db:migrate] skip ${migrationId}`);
          continue;
        }

        const sql = await readFile(join(migrationsDir, fileName), "utf8");
        console.log(`[db:migrate] apply ${migrationId}`);
        await client.query(sql);
        await client.query("insert into schema_migrations (id) values ($1)", [migrationId]);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

main()
  .then(async () => {
    await closePostgresPool();
    console.log("[db:migrate] done");
  })
  .catch(async (error) => {
    await closePostgresPool();
    console.error("[db:migrate] failed", error);
    process.exitCode = 1;
  });
