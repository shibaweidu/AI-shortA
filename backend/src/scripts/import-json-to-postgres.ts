import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { closePostgresPool, isPostgresEnabled, waitForPostgres } from "../db/postgres.js";
import {
  saveAgentsSnapshotToPostgres,
  saveAppStateEntryToPostgres,
  saveConfigDocumentToPostgres,
  saveImageJobsSnapshotToPostgres,
} from "../db/legacyPersistence.js";
import { materializeAppStateToPostgres } from "../db/materializedState.js";

const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir, fileName), "utf8")) as T;
  } catch {
    return fallback;
  }
}

async function main() {
  if (!isPostgresEnabled()) {
    throw new Error("DATABASE_URL is required to import JSON data");
  }
  process.env.DB_DUAL_WRITE = "1";

  await waitForPostgres();

  const appState = await readJson<Record<string, string>>("app-state.json", {});
  for (const [key, value] of Object.entries(appState)) {
    if (typeof value !== "string") continue;
    await saveAppStateEntryToPostgres(key, value);
    await materializeAppStateToPostgres(key, value);
  }

  const imageJobs = await readJson<unknown[]>("image-jobs.json", []);
  await saveImageJobsSnapshotToPostgres(imageJobs);

  const agents = await readJson<unknown[]>("agents.json", []);
  await saveAgentsSnapshotToPostgres(agents);

  await saveConfigDocumentToPostgres("email-config", await readJson("email-config.json", {}));
  await saveConfigDocumentToPostgres("storage-config", await readJson("storage-config.json", {}));
  await saveConfigDocumentToPostgres("style-library", await readJson("style-library.json", {}));

  console.log("[db:import-json] imported", {
    appState: Object.keys(appState).length,
    imageJobs: imageJobs.length,
    agents: agents.length,
    dataDir,
  });
}

main()
  .then(async () => {
    await closePostgresPool();
  })
  .catch(async (error) => {
    await closePostgresPool();
    console.error("[db:import-json] failed", error);
    process.exitCode = 1;
  });
