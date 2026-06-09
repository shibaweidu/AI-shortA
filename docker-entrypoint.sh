#!/usr/bin/env bash
set -eu

mkdir -p /app/backend/data /app/backend/uploads /app/backend/logs

cd /app/backend
if [ -n "${DATABASE_URL:-}" ] && [ "${DB_AUTO_MIGRATE:-1}" = "1" ]; then
  node dist/scripts/migrate.js
fi
if [ -n "${DATABASE_URL:-}" ] && [ "${DB_IMPORT_JSON_ON_START:-0}" = "1" ]; then
  node dist/scripts/import-json-to-postgres.js
fi

exec node dist/server.js
