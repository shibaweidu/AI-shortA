import { queryPostgres, isPostgresEnabled } from "./postgres.js";

type LegacyStateSnapshot = {
  appState: Record<string, string>;
  imageJobs: unknown[];
  agents: unknown[];
};

function toDate(value: unknown) {
  if (typeof value !== "number" || !Number.isFinite(value)) return new Date();
  return new Date(value);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function tryParseJson(value: string) {
  try {
    return JSON.parse(value) as unknown;
  } catch {
    return null;
  }
}

export function shouldUsePostgresDualWrite() {
  return isPostgresEnabled() && process.env.DB_DUAL_WRITE === "1";
}

export async function loadLegacyStateFromPostgres(): Promise<LegacyStateSnapshot> {
  if (!isPostgresEnabled()) {
    return { appState: {}, imageJobs: [], agents: [] };
  }

  const [appStateResult, jobsResult, agentsResult] = await Promise.all([
    queryPostgres<{ key: string; value_text: string }>(
      "select key, value_text from app_state where deleted_at is null",
    ),
    queryPostgres<{ raw_job: unknown }>(
      "select raw_job from image_jobs order by created_at desc",
    ),
    queryPostgres<{ raw_agent: unknown }>(
      "select raw_agent from agents order by created_at desc",
    ),
  ]);

  return {
    appState: Object.fromEntries(appStateResult.rows.map((row) => [row.key, row.value_text])),
    imageJobs: jobsResult.rows.map((row) => row.raw_job).filter(Boolean),
    agents: agentsResult.rows.map((row) => row.raw_agent).filter(Boolean),
  };
}

export async function saveAppStateEntryToPostgres(key: string, value: string | null) {
  if (!shouldUsePostgresDualWrite()) return;
  if (value === null) {
    await queryPostgres(
      "update app_state set deleted_at = now(), updated_at = now() where key = $1",
      [key],
    );
    return;
  }
  await queryPostgres(
    `insert into app_state (key, value_text, value_json, updated_at, deleted_at)
     values ($1, $2, $3::jsonb, now(), null)
     on conflict (key) do update set
       value_text = excluded.value_text,
       value_json = excluded.value_json,
       updated_at = now(),
       deleted_at = null`,
    [key, value, JSON.stringify(tryParseJson(value))],
  );
}

export async function saveImageJobsSnapshotToPostgres(jobs: unknown[]) {
  if (!shouldUsePostgresDualWrite()) return;
  for (const job of jobs) {
    const record = asRecord(job);
    const request = asRecord(record.request);
    const provider = asRecord(record.provider);
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    await queryPostgres(
      `insert into image_jobs
        (id, status, media_type, provider, request, result_url, upstream_url, error, raw_job, created_at, updated_at)
       values
        ($1, $2, $3, $4::jsonb, $5::jsonb, $6, $7, $8, $9::jsonb, $10, $11)
       on conflict (id) do update set
        status = excluded.status,
        media_type = excluded.media_type,
        provider = excluded.provider,
        request = excluded.request,
        result_url = excluded.result_url,
        upstream_url = excluded.upstream_url,
        error = excluded.error,
        raw_job = excluded.raw_job,
        updated_at = excluded.updated_at`,
      [
        id,
        typeof record.status === "string" ? record.status : "queued",
        typeof request.mediaType === "string" ? request.mediaType : null,
        JSON.stringify(provider),
        JSON.stringify(request),
        typeof record.resultUrl === "string" ? record.resultUrl : null,
        typeof record.upstreamUrl === "string" ? record.upstreamUrl : null,
        typeof record.error === "string" ? record.error : null,
        JSON.stringify(record),
        toDate(record.createdAt),
        toDate(record.updatedAt),
      ],
    );
  }
}

export async function saveAgentsSnapshotToPostgres(agents: unknown[]) {
  if (!shouldUsePostgresDualWrite()) return;
  for (const agent of agents) {
    const record = asRecord(agent);
    const id = typeof record.id === "string" ? record.id : "";
    if (!id) continue;
    await queryPostgres(
      `insert into agents
        (id, name, category, type, thumbnail, system_prompt, model_id, temperature, max_tokens, is_active, raw_agent, created_at, updated_at)
       values
        ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11::jsonb, $12, $13)
       on conflict (id) do update set
        name = excluded.name,
        category = excluded.category,
        type = excluded.type,
        thumbnail = excluded.thumbnail,
        system_prompt = excluded.system_prompt,
        model_id = excluded.model_id,
        temperature = excluded.temperature,
        max_tokens = excluded.max_tokens,
        is_active = excluded.is_active,
        raw_agent = excluded.raw_agent,
        updated_at = excluded.updated_at`,
      [
        id,
        typeof record.name === "string" ? record.name : id,
        typeof record.category === "string" ? record.category : null,
        typeof record.type === "string" ? record.type : null,
        typeof record.thumbnail === "string" ? record.thumbnail : null,
        typeof record.systemPrompt === "string" ? record.systemPrompt : null,
        typeof record.modelId === "string" ? record.modelId : null,
        typeof record.temperature === "number" ? record.temperature : null,
        typeof record.maxTokens === "number" ? record.maxTokens : null,
        typeof record.isActive === "boolean" ? record.isActive : true,
        JSON.stringify(record),
        toDate(record.createdAt),
        toDate(record.updatedAt),
      ],
    );
  }
}

export async function saveConfigDocumentToPostgres(name: string, body: unknown) {
  if (!shouldUsePostgresDualWrite()) return;
  await queryPostgres(
    `insert into config_documents (name, body, updated_at)
     values ($1, $2::jsonb, now())
     on conflict (name) do update set body = excluded.body, updated_at = now()`,
    [name, JSON.stringify(body ?? null)],
  );
}
