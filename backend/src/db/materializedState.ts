import { queryPostgres, withPostgresClient } from "./postgres.js";
import { shouldUsePostgresDualWrite } from "./legacyPersistence.js";
import type { PoolClient } from "pg";

type PersistedEnvelope = {
  state?: Record<string, unknown>;
  version?: unknown;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asList(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function asString(value: unknown, fallback = "") {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asBoolean(value: unknown, fallback = false) {
  return typeof value === "boolean" ? value : fallback;
}

function toDate(value: unknown) {
  const numeric = asNumber(value, Date.now());
  return new Date(numeric);
}

function parseEnvelope(value: string): PersistedEnvelope | null {
  try {
    const parsed = JSON.parse(value) as PersistedEnvelope;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function flowOwnerFromKey(key: string) {
  const prefix = "ai-director-flow-v2:";
  return key.startsWith(prefix) ? key.slice(prefix.length) : null;
}

async function ensureUserExists(client: PoolClient, userId: string | null) {
  if (!userId) return;
  await client.query(
    `insert into users (id, name, role, raw_user, created_at, updated_at)
     values ($1, $1, 'user', $2::jsonb, now(), now())
     on conflict (id) do nothing`,
    [userId, JSON.stringify({ id: userId, placeholder: true })],
  );
}

async function materializeAuthState(value: string) {
  const envelope = parseEnvelope(value);
  const users = asList(envelope?.state?.users);
  for (const item of users) {
    const user = asRecord(item);
    const id = asString(user.id);
    if (!id) continue;
    const passwordHash = asString(user.passwordHash) || asString(user.password) || null;
    await queryPostgres(
      `insert into users
        (id, email, name, role, password_hash, raw_user, created_at, updated_at, deleted_at)
       values
        ($1, $2, $3, 'user', $4, $5::jsonb, $6, $7, null)
       on conflict (id) do update set
        email = excluded.email,
        name = excluded.name,
        password_hash = excluded.password_hash,
        raw_user = excluded.raw_user,
        updated_at = excluded.updated_at,
        deleted_at = null`,
      [
        id,
        asString(user.username) || null,
        asString(user.displayName) || asString(user.username) || id,
        passwordHash,
        JSON.stringify(user),
        toDate(user.createdAt),
        toDate(user.updatedAt),
      ],
    );
  }
}

async function materializeCreditState(value: string) {
  const envelope = parseEnvelope(value);
  const state = envelope?.state ?? {};
  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      for (const item of asList(state.packages)) {
        const record = asRecord(item);
        const id = asString(record.id);
        if (!id) continue;
        await client.query(
          `insert into credit_packages
            (id, name, description, credits, bonus_credits, price, purchase_url, enabled, sort_order, raw_package, created_at, updated_at, deleted_at)
           values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, null)
           on conflict (id) do update set
            name = excluded.name,
            description = excluded.description,
            credits = excluded.credits,
            bonus_credits = excluded.bonus_credits,
            price = excluded.price,
            purchase_url = excluded.purchase_url,
            enabled = excluded.enabled,
            sort_order = excluded.sort_order,
            raw_package = excluded.raw_package,
            updated_at = excluded.updated_at,
            deleted_at = null`,
          [
            id,
            asString(record.name) || id,
            asString(record.description),
            asNumber(record.credits),
            asNumber(record.bonusCredits),
            asNumber(record.price),
            asString(record.purchaseUrl) || null,
            asBoolean(record.enabled, true),
            asNumber(record.sortOrder),
            JSON.stringify(record),
            toDate(record.createdAt),
            toDate(record.updatedAt),
          ],
        );
      }

      for (const item of asList(state.redeemCodes)) {
        const record = asRecord(item);
        const id = asString(record.id);
        if (!id) continue;
        await client.query(
          `insert into redeem_codes
            (id, code, package_id, batch_name, status, expires_at, used_by_user_id, used_at, note, raw_code, created_at, updated_at, deleted_at)
           values
            ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12, null)
           on conflict (id) do update set
            code = excluded.code,
            package_id = excluded.package_id,
            batch_name = excluded.batch_name,
            status = excluded.status,
            expires_at = excluded.expires_at,
            used_by_user_id = excluded.used_by_user_id,
            used_at = excluded.used_at,
            note = excluded.note,
            raw_code = excluded.raw_code,
            updated_at = excluded.updated_at,
            deleted_at = null`,
          [
            id,
            asString(record.code),
            asString(record.packageId) || null,
            asString(record.batchName),
            asString(record.status, "unused"),
            record.expiresAt ? toDate(record.expiresAt) : null,
            asString(record.usedByUserId) || null,
            record.usedAt ? toDate(record.usedAt) : null,
            asString(record.note),
            JSON.stringify(record),
            toDate(record.createdAt),
            toDate(record.updatedAt),
          ],
        );
      }

      for (const item of asList(state.accounts)) {
        const record = asRecord(item);
        const userId = asString(record.userId);
        if (!userId) continue;
        await ensureUserExists(client, userId);
        await client.query(
          `insert into credit_accounts
            (user_id, balance, total_earned, total_spent, raw_account, updated_at)
           values
            ($1, $2, $3, $4, $5::jsonb, $6)
           on conflict (user_id) do update set
            balance = excluded.balance,
            total_earned = excluded.total_earned,
            total_spent = excluded.total_spent,
            raw_account = excluded.raw_account,
            updated_at = excluded.updated_at`,
          [
            userId,
            asNumber(record.balance),
            asNumber(record.totalEarned),
            asNumber(record.totalSpent),
            JSON.stringify(record),
            toDate(record.updatedAt),
          ],
        );
      }

      for (const item of asList(state.transactions)) {
        const record = asRecord(item);
        const id = asString(record.id);
        const userId = asString(record.userId);
        if (!id || !userId) continue;
        await ensureUserExists(client, userId);
        await client.query(
          `insert into credit_ledger
            (id, user_id, amount, reason, reference_type, reference_id, metadata, created_at)
           values
            ($1, $2, $3, $4, $5, $6, $7::jsonb, $8)
           on conflict (id) do update set
            user_id = excluded.user_id,
            amount = excluded.amount,
            reason = excluded.reason,
            reference_type = excluded.reference_type,
            reference_id = excluded.reference_id,
            metadata = excluded.metadata`,
          [
            id,
            userId,
            asNumber(record.amount),
            asString(record.note) || asString(record.type),
            asString(record.type) || null,
            asString(record.generationTaskId) || asString(record.redeemCodeId) || asString(record.packageId) || null,
            JSON.stringify(record),
            toDate(record.createdAt),
          ],
        );
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function materializeFlowState(key: string, value: string) {
  const ownerUserId = flowOwnerFromKey(key);
  const envelope = parseEnvelope(value);
  const state = envelope?.state ?? {};
  await withPostgresClient(async (client) => {
    await client.query("begin");
    try {
      await ensureUserExists(client, ownerUserId);
      for (const item of asList(state.projects)) {
        const project = asRecord(item);
        const id = asString(project.id);
        if (!id) continue;
        await client.query(
          `insert into flow_projects
            (id, owner_user_id, name, raw_project, created_at, updated_at, deleted_at)
           values
            ($1, $2, $3, $4::jsonb, $5, $6, null)
           on conflict (id) do update set
            owner_user_id = excluded.owner_user_id,
            name = excluded.name,
            raw_project = excluded.raw_project,
            updated_at = excluded.updated_at,
            deleted_at = null`,
          [
            id,
            ownerUserId || null,
            asString(project.name) || id,
            JSON.stringify(project),
            toDate(project.createdAt),
            toDate(project.updatedAt),
          ],
        );
      }

      for (const item of asList(state.items)) {
        const flowItem = asRecord(item);
        const id = asString(flowItem.id);
        if (!id) continue;
        await client.query(
          `insert into flow_items
            (id, project_id, owner_user_id, kind, title, asset_url, raw_item, created_at, updated_at, deleted_at)
           values
            ($1, $2, $3, $4, $5, $6, $7::jsonb, $8, $9, null)
           on conflict (id) do update set
            project_id = excluded.project_id,
            owner_user_id = excluded.owner_user_id,
            kind = excluded.kind,
            title = excluded.title,
            asset_url = excluded.asset_url,
            raw_item = excluded.raw_item,
            updated_at = excluded.updated_at,
            deleted_at = null`,
          [
            id,
            asString(flowItem.projectId) || null,
            ownerUserId || null,
            asString(flowItem.type, "image"),
            asString(flowItem.prompt).slice(0, 180) || null,
            asString(flowItem.url) || asString(flowItem.thumbnail) || null,
            JSON.stringify(flowItem),
            toDate(flowItem.createdAt),
            toDate(flowItem.updatedAt || flowItem.createdAt),
          ],
        );
      }

      for (const deletedId of asList(state.deletedItemIds)) {
        if (typeof deletedId !== "string" || !deletedId) continue;
        await client.query("update flow_items set deleted_at = now(), updated_at = now() where id = $1", [deletedId]);
      }

      await client.query("commit");
    } catch (error) {
      await client.query("rollback");
      throw error;
    }
  });
}

async function materializeModelCreditState(value: string) {
  const envelope = parseEnvelope(value);
  const rules = asList(envelope?.state?.rules);
  for (const item of rules) {
    const rule = asRecord(item);
    const modelValue = asString(rule.modelValue);
    if (!modelValue) continue;
    await queryPostgres(
      `insert into model_credit_rules
        (model_value, image_credits_by_resolution, video_credits_by_duration, video_credits_per_second, raw_rule, updated_at)
       values
        ($1, $2::jsonb, $3::jsonb, $4, $5::jsonb, $6)
       on conflict (model_value) do update set
        image_credits_by_resolution = excluded.image_credits_by_resolution,
        video_credits_by_duration = excluded.video_credits_by_duration,
        video_credits_per_second = excluded.video_credits_per_second,
        raw_rule = excluded.raw_rule,
        updated_at = excluded.updated_at`,
      [
        modelValue,
        JSON.stringify(asRecord(rule.imageCreditsByResolution)),
        JSON.stringify(asRecord(rule.videoCreditsByDuration)),
        typeof rule.videoCreditsPerSecond === "number" ? rule.videoCreditsPerSecond : null,
        JSON.stringify(rule),
        toDate(rule.updatedAt),
      ],
    );
  }
}

export async function materializeAppStateToPostgres(key: string, value: string | null) {
  if (!shouldUsePostgresDualWrite() || value === null) return;
  if (key === "koala-auth-store-v1") {
    await materializeAuthState(value);
    return;
  }
  if (key === "koala-credit-store-v1") {
    await materializeCreditState(value);
    return;
  }
  if (key === "koala-model-credit-store-v1") {
    await materializeModelCreditState(value);
    return;
  }
  if (key.startsWith("ai-director-flow-v2:")) {
    await materializeFlowState(key, value);
  }
}
