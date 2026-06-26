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

function isPlaceholder(value: string) {
  return !value || value === "change-me" || value === "change-this-long-random-token";
}

function parseMegabyteLimit(value: string) {
  const match = value.trim().toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(kb|mb|gb)?$/);
  if (!match) return null;
  const amount = Number(match[1]);
  const unit = match[2] ?? "b";
  if (!Number.isFinite(amount)) return null;
  if (unit === "gb") return amount * 1024;
  if (unit === "mb") return amount;
  if (unit === "kb") return amount / 1024;
  return amount / 1024 / 1024;
}

async function main() {
  const checks: Check[] = [];
  checks.push({
    name: "PUBLIC_BASE_URL",
    ok: /^https?:\/\/[^/]+/i.test(env("PUBLIC_BASE_URL")),
    message: env("PUBLIC_BASE_URL") || "missing",
  });
  checks.push({
    name: "CORS_ALLOWED_ORIGINS",
    ok: env("CORS_ALLOWED_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean).length > 0
      && env("CORS_ALLOWED_ORIGINS").split(",").map((item) => item.trim()).filter(Boolean).every((origin) => /^https?:\/\/[^/]+/i.test(origin)),
    message: env("CORS_ALLOWED_ORIGINS") || "missing",
  });
  checks.push({
    name: "ADMIN_API_TOKEN",
    ok: env("ADMIN_API_TOKEN").length >= 24 && !isPlaceholder(env("ADMIN_API_TOKEN")),
    message: env("ADMIN_API_TOKEN") ? "configured" : "missing",
  });
  checks.push({
    name: "DATABASE_URL",
    ok: isPostgresEnabled(),
    message: isPostgresEnabled() ? "configured" : "missing",
  });
  checks.push({
    name: "POSTGRES_PASSWORD",
    ok: !isPlaceholder(env("POSTGRES_PASSWORD")),
    message: env("POSTGRES_PASSWORD") ? "configured" : "missing",
  });
  checks.push({
    name: "DB_READ_PRIMARY",
    ok: ["json", "postgres", ""].includes(env("DB_READ_PRIMARY")),
    message: env("DB_READ_PRIMARY") || "json",
  });
  checks.push({
    name: "OBJECT_STORAGE",
    ok: env("OBJECT_STORAGE_ENABLED") === "1",
    message: env("OBJECT_STORAGE_ENABLED") === "1" ? "enabled" : "local uploads fallback",
  });
  if (env("OBJECT_STORAGE_ENABLED") === "1") {
    for (const name of ["OBJECT_STORAGE_ENDPOINT", "OBJECT_STORAGE_BUCKET", "OBJECT_STORAGE_ACCESS_KEY_ID", "OBJECT_STORAGE_SECRET_ACCESS_KEY", "OBJECT_STORAGE_PUBLIC_BASE_URL"]) {
      checks.push({
        name,
        ok: Boolean(env(name)),
        message: env(name) ? "configured" : "missing",
      });
    }
  }
  const jsonLimitMb = parseMegabyteLimit(env("JSON_BODY_LIMIT") || "50mb");
  checks.push({
    name: "JSON_BODY_LIMIT",
    ok: jsonLimitMb !== null && jsonLimitMb <= 100,
    message: env("JSON_BODY_LIMIT") || "50mb",
    severity: jsonLimitMb !== null && jsonLimitMb <= 100 ? undefined : "warning",
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
