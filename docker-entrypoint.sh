#!/usr/bin/env bash
set -eu

cd /app

mkdir -p /app/backend/data /app/backend/uploads /app/backend/logs

(
  cd /app/backend
  npm run dev
) &
backend_pid=$!

(
  cd /app/frontend
  npm run dev -- --host 0.0.0.0 --port 5173 --strictPort
) &
frontend_pid=$!

trap 'kill "$backend_pid" "$frontend_pid" 2>/dev/null || true; wait' INT TERM

wait -n "$backend_pid" "$frontend_pid"
status=$?
kill "$backend_pid" "$frontend_pid" 2>/dev/null || true
wait 2>/dev/null || true
exit "$status"
