# AI Shorta Deployment Notes

## Current Stack

- Frontend: React 19, Vite, TypeScript, Tailwind CSS, Zustand.
- Backend: Node.js 22, Express 5, TypeScript, Multer, Nodemailer, AWS S3 compatible storage SDK.
- Persistence: local JSON files are still the default runtime source of truth. PostgreSQL migration, import, and dual-write support are available for production migration.
- Static delivery: the backend can serve `frontend/dist`; Caddy terminates TLS and proxies to the backend.

## Recommended Production Shape

Use one application container, one PostgreSQL container or managed PostgreSQL instance, Caddy as the public reverse proxy, and S3 compatible object storage for generated/uploaded media.

Run a single `ai-shorta` replica until the job queue is moved to Redis/BullMQ or another shared worker queue. The current app recovers persisted active jobs after restart, but concurrent replicas would each have their own in-memory queue.

Set `ADMIN_API_TOKEN` to a long random value and set the same value in the admin settings page after login. Production also requires `CORS_ALLOWED_ORIGINS` to include the public site origin, for example `https://ai.appkaola.com`.

```bash
docker compose --env-file .env -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

If Docker Hub is unavailable while testing locally, run the production shape without Docker:

```powershell
.\scripts\start-local-production.ps1
```

This builds `backend/dist` and `frontend/dist`, then runs the compiled backend serving the built frontend.

Keep `DB_READ_PRIMARY=json` immediately after rollout. Run `npm run db:import-json` once against the production database, verify counts, keep `DB_DUAL_WRITE=1`, then switch `DB_READ_PRIMARY=postgres` during a low-traffic deployment window.

## Database Commands

```bash
cd backend
npm run db:migrate
npm run db:import-json
npm run check:prod
```

The database commands require `DATABASE_URL`. `check:prod` also validates production environment basics.

## Production Priorities

1. Move uploads from local disk to object storage and keep local disk only as a development fallback.
2. Replace in-process job queue with Redis/BullMQ or a dedicated worker service before scaling past one app replica.
3. Move auth, users, credits, flow projects, and assets from app-state JSON keys into typed PostgreSQL tables.
4. Add server-side request validation, structured logging, rate limits, and centralized error tracking.
5. Add backup policy: PostgreSQL PITR, object storage lifecycle rules, and daily export verification.

## Backup

For self-hosted PostgreSQL, run:

```powershell
$env:DATABASE_URL="postgres://..."
.\scripts\backup-postgres.ps1
```

For managed PostgreSQL, enable point-in-time recovery and test restore into a staging database before switching `DB_READ_PRIMARY=postgres`.
