import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

const databaseUrl = (process.env.DATABASE_URL ?? "").trim();
const sslMode = (process.env.PGSSLMODE ?? "").trim().toLowerCase();
let pool: Pool | null = null;

export function isPostgresEnabled() {
  return databaseUrl.length > 0;
}

function shouldUseSsl() {
  if (process.env.DATABASE_SSL === "1") return true;
  if (process.env.DATABASE_SSL === "0") return false;
  return Boolean(sslMode && !["disable", "off", "0", "false"].includes(sslMode));
}

export function getPostgresPool() {
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is not configured");
  }
  if (!pool) {
    pool = new Pool({
      connectionString: databaseUrl,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      idleTimeoutMillis: Number(process.env.DATABASE_IDLE_TIMEOUT_MS ?? 30_000),
      connectionTimeoutMillis: Number(process.env.DATABASE_CONNECTION_TIMEOUT_MS ?? 10_000),
      ssl: shouldUseSsl()
        ? { rejectUnauthorized: process.env.DATABASE_SSL_REJECT_UNAUTHORIZED !== "0" }
        : undefined,
    });
  }
  return pool;
}

export async function queryPostgres<T extends QueryResultRow = QueryResultRow>(
  text: string,
  values?: unknown[],
): Promise<QueryResult<T>> {
  return getPostgresPool().query<T>(text, values);
}

export async function withPostgresClient<T>(callback: (client: PoolClient) => Promise<T>) {
  const client = await getPostgresPool().connect();
  try {
    return await callback(client);
  } finally {
    client.release();
  }
}

export async function closePostgresPool() {
  if (!pool) return;
  const currentPool = pool;
  pool = null;
  await currentPool.end();
}

export async function waitForPostgres(options: { attempts?: number; delayMs?: number } = {}) {
  const attempts = options.attempts ?? Number(process.env.DATABASE_WAIT_ATTEMPTS ?? 30);
  const delayMs = options.delayMs ?? Number(process.env.DATABASE_WAIT_DELAY_MS ?? 2000);
  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      await queryPostgres("select 1");
      return;
    } catch (error) {
      lastError = error;
      if (attempt < attempts) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}
