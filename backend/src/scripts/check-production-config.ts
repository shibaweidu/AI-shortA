import { isPostgresEnabled, waitForPostgres, closePostgresPool } from "../db/postgres.js";

type Check = {
  name: string;
  ok: boolean;
  message: string;
  severity?: "error" | "warning";
};

function env(name: string) {
  return (process.env[name] ?? "").trim();
}

async function main() {
  const checks: Check[] = [];
  checks.push({
    name: "PUBLIC_BASE_URL",
    ok: /^https?:\/\/[^/]+/i.test(env("PUBLIC_BASE_URL")),
    message: env("PUBLIC_BASE_URL") || "missing",
  });
  checks.push({
    name: "DATABASE_URL",
    ok: isPostgresEnabled(),
    message: isPostgresEnabled() ? "configured" : "missing",
  });
  checks.push({
    name: "POSTGRES_PASSWORD",
    ok: Boolean(env("POSTGRES_PASSWORD")) && env("POSTGRES_PASSWORD") !== "change-me",
    message: env("POSTGRES_PASSWORD") ? "configured" : "missing",
  });
  checks.push({
    name: "DB_READ_PRIMARY",
    ok: ["json", "postgres", ""].includes(env("DB_READ_PRIMARY")),
    message: env("DB_READ_PRIMARY") || "json",
  });
  checks.push({
    name: "OBJECT_STORAGE",
    ok: true,
    message: env("OBJECT_STORAGE_ENABLED") === "1" ? "enabled" : "local uploads fallback",
    severity: env("OBJECT_STORAGE_ENABLED") === "1" ? undefined : "warning",
  });
  if (isPostgresEnabled()) {
    try {
      await waitForPostgres({ attempts: 3, delayMs: 1000 });
      checks.push({ name: "DATABASE_CONNECTIVITY", ok: true, message: "ok" });
    } catch (error) {
      checks.push({
        name: "DATABASE_CONNECTIVITY",
        ok: false,
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const failed = checks.filter((check) => !check.ok && check.severity !== "warning");
  console.log(JSON.stringify({ ok: failed.length === 0, checks }, null, 2));
  if (failed.length > 0) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
