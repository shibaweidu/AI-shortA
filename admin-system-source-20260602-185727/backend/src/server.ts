import cors from "cors";
import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { createHash, randomInt } from "node:crypto";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? process.env.VITE_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
const DATA_DIR = join(process.cwd(), "data");
const UPLOADS_DIR = join(process.cwd(), "uploads");
const LOGS_DIR = join(process.cwd(), "logs");
const JOBS_FILE = join(DATA_DIR, "image-jobs.json");
const APP_STATE_FILE = join(DATA_DIR, "app-state.json");
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const EMAIL_CONFIG_FILE = join(DATA_DIR, "email-config.json");
const STORAGE_CONFIG_FILE = join(DATA_DIR, "storage-config.json");
const STYLE_LIBRARY_FILE = join(DATA_DIR, "style-library.json");
const IMAGE_JOBS_LOG_FILE = join(LOGS_DIR, "image-jobs.log");
const APP_STATE_LOG_FILE = join(LOGS_DIR, "app-state.log");
const ADMIN_LOG_SOURCES = {
  "image-jobs": {
    label: "生成任务日志",
    filePath: IMAGE_JOBS_LOG_FILE,
  },
  "app-state": {
    label: "用户状态日志",
    filePath: APP_STATE_LOG_FILE,
  },
} as const;
const MAX_CONCURRENT_JOBS = Number(process.env.IMAGE_JOB_CONCURRENCY ?? 2);
const COMPLETED_JOB_RETENTION_MS = Number(process.env.IMAGE_JOB_RETENTION_HOURS ?? 24 * 7) * 60 * 60 * 1000;
const FAILED_JOB_RETENTION_MS = Number(process.env.FAILED_IMAGE_JOB_RETENTION_HOURS ?? 24) * 60 * 60 * 1000;
const IMAGE_JOB_REQUEST_TIMEOUT_MS = Number(process.env.IMAGE_JOB_REQUEST_TIMEOUT_SECONDS ?? 600) * 1000;
const VIDEO_JOB_REQUEST_TIMEOUT_MS = Number(process.env.VIDEO_JOB_REQUEST_TIMEOUT_SECONDS ?? 1800) * 1000;
const EMAIL_VERIFICATION_COOLDOWN_MS = Number(process.env.EMAIL_VERIFICATION_COOLDOWN_SECONDS ?? 60) * 1000;
const EMAIL_VERIFICATION_MAX_ATTEMPTS = Number(process.env.EMAIL_VERIFICATION_MAX_ATTEMPTS ?? 5);
const UPSTREAM_TIMEOUT_RECOVERY_MS = Number(process.env.IMAGE_JOB_524_RECOVERY_SECONDS ?? 0) * 1000;
const UPSTREAM_TIMEOUT_RECOVERY_POLL_MS = Number(process.env.IMAGE_JOB_524_RECOVERY_POLL_SECONDS ?? 5) * 1000;
const UPSTREAM_LOG_ACCESS_TOKEN = (process.env.IMAGE_JOB_LOG_ACCESS_TOKEN ?? process.env.NEW_API_ACCESS_TOKEN ?? process.env.ONE_API_ACCESS_TOKEN ?? "").trim();
const UPSTREAM_LOG_COOKIE = (process.env.IMAGE_JOB_LOG_COOKIE ?? "").trim();
const FORCE_IPV4_OUTBOUND = process.env.IMAGE_JOB_FORCE_IPV4 !== "0";
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? "200mb";

if (FORCE_IPV4_OUTBOUND) {
  setDefaultResultOrder("ipv4first");
  setDefaultAutoSelectFamily(false);
}

type JobStatus = "queued" | "running" | "completed" | "failed" | "timeout-recoverable";
type MediaJobType = "image" | "video";

type ImageJobAttempt = {
  label?: string;
  endpoint: string;
  payload: Record<string, unknown>;
  referenceImages?: string[];
  useImageEdit?: boolean;
  mediaType?: MediaJobType;
};

type ImageJob = {
  id: string;
  status: JobStatus;
  createdAt: number;
  updatedAt: number;
  provider: {
    id?: string;
    name?: string;
    baseUrl: string;
    key: string;
    logAccessToken?: string;
    headers?: Record<string, string>;
  };
  request: {
    endpoint: string;
    method: "POST";
    payload: Record<string, unknown>;
    referenceImages?: string[];
    useImageEdit?: boolean;
    mediaType?: MediaJobType;
    attempts?: ImageJobAttempt[];
  };
  resultUrl?: string;
  upstreamUrl?: string;
error?: string;
};

type ProviderRequestConfig = {
 id?: string;
 name?: string;
 baseUrl: string;
 key: string;
 headers?: Record<string, string>;
};

type Agent = {
  id: string;
  name: string;
  description: string;
  category: string;
  type: 'preset' | 'custom';
  thumbnail?: string;
  systemPrompt: string;
  modelId?: string;
  temperature?: number;
  maxTokens?: number;
  createdAt: number;
  updatedAt: number;
  isActive: boolean;
};

type EmailConfig = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  codeTtlMinutes: number;
  updatedAt: number;
};

type PublicEmailConfig = Omit<EmailConfig, "password"> & {
  hasPassword: boolean;
};

type ObjectStorageConfig = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl: string;
  prefix: string;
  forcePathStyle: boolean;
  useBackendProxy: boolean;
  updatedAt: number;
};

type PublicObjectStorageConfig = Omit<ObjectStorageConfig, "secretAccessKey"> & {
  hasSecretAccessKey: boolean;
};

type StyleCategory = {
  id: string;
  name: string;
  order: number;
};

type StylePreset = {
  id: string;
  name: string;
  categoryIds: string[];
  coverImageUrl: string;
  sampleImageUrls: string[];
  prompt: string;
  strength: number;
  isNew?: boolean;
  isActive: boolean;
  source: "preset" | "custom";
  createdAt: number;
  updatedAt: number;
};

type StyleLibrary = {
  categories: StyleCategory[];
  styles: StylePreset[];
};

type ReferenceRole = "character" | "scene" | "object" | "general";

type ReferenceSettings = {
  visionModelValue: string;
  classificationPrompt: string;
  rolePrompts: Record<ReferenceRole, string>;
};

type EmailVerificationPurpose = "register";

type EmailVerificationRecord = {
  email: string;
  purpose: EmailVerificationPurpose;
  codeHash: string;
  sentAt: number;
  expiresAt: number;
  attempts: number;
};

const DEFAULT_EMAIL_CONFIG: EmailConfig = {
  enabled: false,
  host: "",
  port: 465,
  secure: true,
  username: "",
  password: "",
  fromName: "Koala AI",
  fromEmail: "",
  subject: "Koala AI 注册验证码",
  codeTtlMinutes: 10,
  updatedAt: Date.now(),
};

const DEFAULT_OBJECT_STORAGE_CONFIG: ObjectStorageConfig = {
  enabled: process.env.S4_ENABLED === "true" || process.env.OBJECT_STORAGE_ENABLED === "true",
  endpoint: (process.env.S4_ENDPOINT ?? process.env.OBJECT_STORAGE_ENDPOINT ?? "https://s3.bitiful.net").trim(),
  region: (process.env.S4_REGION ?? process.env.OBJECT_STORAGE_REGION ?? "cn-east-1").trim(),
  bucket: (process.env.S4_BUCKET ?? process.env.OBJECT_STORAGE_BUCKET ?? "").trim(),
  accessKeyId: (process.env.S4_ACCESS_KEY_ID ?? process.env.OBJECT_STORAGE_ACCESS_KEY_ID ?? "").trim(),
  secretAccessKey: (process.env.S4_SECRET_ACCESS_KEY ?? process.env.OBJECT_STORAGE_SECRET_ACCESS_KEY ?? "").trim(),
  publicBaseUrl: (process.env.S4_PUBLIC_BASE_URL ?? process.env.OBJECT_STORAGE_PUBLIC_BASE_URL ?? "").trim(),
  prefix: (process.env.S4_PREFIX ?? process.env.OBJECT_STORAGE_PREFIX ?? "kaola/").trim(),
  forcePathStyle: process.env.S4_FORCE_PATH_STYLE !== "0" && process.env.OBJECT_STORAGE_FORCE_PATH_STYLE !== "0",
  useBackendProxy: process.env.S4_USE_BACKEND_PROXY === "1" || process.env.OBJECT_STORAGE_USE_BACKEND_PROXY === "1",
  updatedAt: Date.now(),
};

const DEFAULT_STYLE_LIBRARY: StyleLibrary = {
  categories: [
    { id: "all", name: "全部", order: 0 },
    { id: "my", name: "我的风格", order: 1 },
    { id: "recent", name: "最近使用", order: 2 },
    { id: "3d", name: "立体风格", order: 3 },
    { id: "chinese", name: "国风", order: 4 },
    { id: "ip", name: "IP风格", order: 5 },
    { id: "western", name: "欧美风格", order: 6 },
    { id: "japanese", name: "日系风格", order: 7 },
    { id: "illustration", name: "插画风格", order: 8 },
    { id: "korean", name: "韩系", order: 9 },
    { id: "cute", name: "可爱Q版", order: 10 },
  ],
  styles: [
    {
      id: "style-kpop-cg",
      name: "KpopCG",
      categoryIds: ["3d", "korean"],
      coverImageUrl: "https://static-oiioii-sg.hogiai.cn/style_recommends/mnpo9im1_39c786142b2473e8.webp",
      sampleImageUrls: [
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnojtb8n_3114dbe29e4fedbc.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnpo9im1_39c786142b2473e8.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnojr8e9_5d62e6aa1dc41c5e.webp",
      ],
      prompt: "K-pop inspired glossy CG portrait style, polished skin rendering, studio lighting, fashionable styling, vibrant but controlled colors, premium entertainment poster finish.",
      strength: 0.7,
      isNew: true,
      isActive: true,
      source: "preset",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "style-game-cg",
      name: "游戏CG",
      categoryIds: ["3d", "western"],
      coverImageUrl: "https://static-oiioii-sg.hogiai.cn/style_recommends/Nhe9bnBOkoh8LSxYaG7cMct7nDg.webp",
      sampleImageUrls: [
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mn2tgtajad1a164ac3985264.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/EW0XbyTnUoZX44xcI1vcRtMcnjd.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/SnaobGxSHoLVIXxFlOUc5QgEnBc.webp",
      ],
      prompt: "high-end game cinematic CG style, dramatic key light, detailed materials, atmospheric depth, sharp concept-art composition, immersive AAA game visual finish.",
      strength: 0.72,
      isActive: true,
      source: "preset",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "style-pixel-farm",
      name: "像素农场",
      categoryIds: ["illustration", "cute"],
      coverImageUrl: "https://static-oiioii-sg.hogiai.cn/style_recommends/mnps4e2n_f772bf318499f660.webp",
      sampleImageUrls: [
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnpsa9ba_121507cc8417d426.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnps84h8_04377ac124a68cc7.webp",
        "https://static-oiioii-sg.hogiai.cn/style_recommends/mnps8fah_869571d3fa0df2a2.webp",
      ],
      prompt: "cozy pixel-art farm game style, chunky pixel shapes, cheerful pastoral colors, soft nostalgic game interface feeling, clean readable silhouettes.",
      strength: 0.78,
      isNew: true,
      isActive: true,
      source: "preset",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
    {
      id: "style-ink",
      name: "国风水墨",
      categoryIds: ["chinese", "illustration"],
      coverImageUrl: "https://static-oiioii-sg.hogiai.cn/style_recommends/mmybot0eaa74e8f640da0bf4.webp",
      sampleImageUrls: [],
      prompt: "Chinese ink wash painting style, flowing brushwork, restrained mineral colors, misty negative space, elegant traditional composition, paper texture.",
      strength: 0.68,
      isActive: true,
      source: "preset",
      createdAt: Date.now(),
      updatedAt: Date.now(),
    },
  ],
};

let styleLibrary: StyleLibrary = { ...DEFAULT_STYLE_LIBRARY };

const app = express();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024, files: 8 } });
const jobs = new Map<string, ImageJob>();
const appState = new Map<string, string>();
const agents = new Map<string, Agent>();
const emailVerificationRecords = new Map<string, EmailVerificationRecord>();
const pendingQueue: string[] = [];
let runningJobs = 0;
let saveChain = Promise.resolve();
let appStateSaveChain = Promise.resolve();
let agentsSaveChain = Promise.resolve();
let emailConfigSaveChain = Promise.resolve();
let styleLibrarySaveChain = Promise.resolve();
let storageConfigSaveChain = Promise.resolve();
let emailConfig: EmailConfig = { ...DEFAULT_EMAIL_CONFIG };
let objectStorageConfig: ObjectStorageConfig = { ...DEFAULT_OBJECT_STORAGE_CONFIG };

const REFERENCE_SETTINGS_KEY = "reference-settings";
const DEFAULT_REFERENCE_SETTINGS: ReferenceSettings = {
  visionModelValue: "",
  classificationPrompt:
    "判断这张图作为 AI 生图参考时最适合的类型。只能返回 JSON：{\"role\":\"character|scene|object|general\",\"confidence\":0-1}。character=人物、动物、IP角色、角色设定；scene=环境、建筑、室内外空间、风景；object=商品、道具、装备、单个物品；general=无明确主体或不适合分类。",
  rolePrompts: {
    character:
      "Image {index}: character reference. Keep identity, species/person features, outfit, proportions, expression traits, and recognizable design consistent.",
    scene:
      "Image {index}: scene reference. Use environment layout, architecture, spatial structure, lighting, atmosphere, and setting details.",
    object:
      "Image {index}: object reference. Use the object's shape, material, color, markings, product details, and functional design.",
    general:
      "Image {index}: general content reference. Use only the relevant visual details that support the user prompt.",
  },
};

app.use(cors());
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: false, maxAge: "7d" }));

app.get("/api/storage/object", async (request, response) => {
  const key = typeof request.query.key === "string" ? request.query.key.trim() : "";
  if (!key) {
    response.status(400).json({ error: "缺少对象 Key。" });
    return;
  }

  try {
    await assertObjectStorageReady();
    const data = await createObjectStorageClient().send(new GetObjectCommand({
      Bucket: objectStorageConfig.bucket,
      Key: key,
    }));
    if (data.ContentType) response.setHeader("Content-Type", data.ContentType);
    if (data.ContentLength !== undefined) response.setHeader("Content-Length", String(data.ContentLength));
    response.setHeader("Cache-Control", "public, max-age=604800");
    pipeObjectStorageBody(data.Body, response);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/health", (_request, response) => {
  response.json({ ok: true, jobs: jobs.size, runningJobs, queueLength: pendingQueue.length });
});

app.post("/api/client-log", (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const clientTaskId = typeof body?.clientTaskId === "string" && body.clientTaskId.trim() ? body.clientTaskId.trim() : "client";
  const event = typeof body?.event === "string" && body.event.trim() ? body.event.trim() : "event";
  const details = body?.details && typeof body.details === "object" ? body.details as Record<string, unknown> : {};
  logImageJob(clientTaskId, `client.${event}`, details);
  response.json({ ok: true });
});

app.get("/api/app-state/:key", (request, response) => {
  const currentValue = appState.get(request.params.key) ?? null;
  if (typeof currentValue === "string" && request.params.key.startsWith("ai-director-flow-v2")) {
    const normalizedValue = normalizeFlowStateStorageUrls(currentValue);
    if (normalizedValue !== currentValue) {
      appState.set(request.params.key, normalizedValue);
      logAppState("normalize-flow-storage-urls", request.params.key, normalizedValue);
      void saveAppStateSoon();
    }
    response.json({ key: request.params.key, value: normalizedValue });
    return;
  }
  response.json({ key: request.params.key, value: currentValue });
});

app.put("/api/app-state/:key", (request, response) => {
  const value = (request.body as { value?: unknown } | undefined)?.value;
  if (value !== null && typeof value !== "string") {
    response.status(400).json({ error: "value must be a string or null" });
    return;
  }

  const currentStoredValue = appState.get(request.params.key);
  const currentValue = currentStoredValue ?? null;
  if (value === null) {
    if (currentValue === null) {
      response.json({ ok: true, skipped: true });
      return;
    }
    appState.delete(request.params.key);
    logAppState("delete", request.params.key, null);
  } else {
    if (currentValue === value) {
      response.json({ ok: true, skipped: true });
      return;
    }
    if (shouldSkipEmptyFlowStateOverwrite(request.params.key, value)) {
      logAppState("skip-empty-flow-overwrite", request.params.key, value);
      response.json({ ok: true, skipped: true });
      return;
    }
    const nextFlowState = request.params.key.startsWith("ai-director-flow-v2:")
      ? mergeFlowStateValue(currentStoredValue, value)
      : { value, merged: false };
    if (nextFlowState.value === currentValue) {
      response.json({ ok: true, skipped: true });
      return;
    }
    appState.set(request.params.key, nextFlowState.value);
    logAppState(nextFlowState.merged ? "put-merged-flow" : "put", request.params.key, nextFlowState.value);
  }
  void saveAppStateSoon();
  response.json({ ok: true });
});

app.delete("/api/app-state/:key", (request, response) => {
  if (!appState.has(request.params.key)) {
    response.json({ ok: true, skipped: true });
    return;
  }
  appState.delete(request.params.key);
  logAppState("delete", request.params.key, null);
  void saveAppStateSoon();
  response.json({ ok: true });
});

app.get("/api/reference-settings", (_request, response) => {
  response.json(getReferenceSettings());
});

app.put("/api/reference-settings", (request, response) => {
  const settings = normalizeReferenceSettings(request.body);
  appState.set(REFERENCE_SETTINGS_KEY, JSON.stringify(settings));
  void saveAppStateSoon();
  response.json(settings);
});

app.post("/api/reference-classify", async (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl : "";
  const modelId = typeof body?.modelId === "string" ? body.modelId.trim() : "";
  const provider = normalizeProviderRequest(body?.provider);
  console.log("[reference-classify] request", {
    hasImageUrl: Boolean(imageUrl),
    modelId,
    providerId: provider?.id,
    providerName: provider?.name,
    providerBaseUrl: provider?.baseUrl,
  });
  if (!imageUrl || !modelId || !provider) {
    console.warn("[reference-classify] rejected: missing imageUrl/modelId/provider");
    response.status(400).json({ error: "imageUrl, modelId, and provider are required" });
    return;
  }

  const settings = getReferenceSettings();
  try {
    const resolvedImageUrl = await resolveAgentImageUrl(imageUrl);
    const payload = {
      model: modelId,
      messages: [
        { role: "system", content: settings.classificationPrompt },
        {
          role: "user",
          content: [
            { type: "text", text: "请为这张参考图推荐一个类型。" },
            { type: "image_url", image_url: { url: resolvedImageUrl } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 120,
    };
    const apiResponse = await fetch(buildEndpoint(provider.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: buildProviderHeaders(provider, "application/json", "application/json"),
      body: JSON.stringify(payload),
    });
    if (!apiResponse.ok) {
      const text = await apiResponse.text();
      throw new Error(`vision model failed: ${apiResponse.status} ${text.slice(0, 500)}`);
    }
    const data = await apiResponse.json();
    const content = extractAgentResponseContent(data);
    const result = parseReferenceClassification(content);
    console.log("[reference-classify] result", {
      modelId,
      providerId: provider.id,
      providerName: provider.name,
      role: result.role,
      confidence: result.confidence,
      rawPreview: content.slice(0, 200),
    });
    response.json(result);
  } catch (error) {
    console.error("[reference-classify] failed", {
      modelId,
      providerId: provider.id,
      providerName: provider.name,
      error: error instanceof Error ? error.message : String(error),
    });
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/style-library", (_request, response) => {
  response.json({
    categories: [...styleLibrary.categories].sort((a, b) => a.order - b.order),
    styles: styleLibrary.styles.filter((style) => style.isActive),
  });
});

app.get("/api/admin/style-library", (_request, response) => {
  response.json({
    categories: [...styleLibrary.categories].sort((a, b) => a.order - b.order),
    styles: [...styleLibrary.styles].sort((a, b) => b.updatedAt - a.updatedAt),
  });
});

app.post("/api/styles", (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const style = normalizeStylePreset({
    ...body,
    id: createId("style"),
    source: "custom",
    categoryIds: Array.isArray(body?.categoryIds) ? body?.categoryIds : ["my"],
    sampleImageUrls: Array.isArray(body?.sampleImageUrls) ? body?.sampleImageUrls : [body?.coverImageUrl].filter(Boolean),
    prompt: typeof body?.prompt === "string" ? body.prompt : "custom uploaded style reference",
    strength: typeof body?.strength === "number" ? body.strength : 0.65,
    isActive: true,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!style) {
    response.status(400).json({ error: "name and coverImageUrl are required" });
    return;
  }
  styleLibrary = { ...styleLibrary, styles: [style, ...styleLibrary.styles] };
  void saveStyleLibrarySoon();
  response.status(201).json(style);
});

app.put("/api/styles/:id", (request, response) => {
  const current = styleLibrary.styles.find((item) => item.id === request.params.id && item.source === "custom");
  if (!current) {
    response.status(404).json({ error: "custom style not found" });
    return;
  }
  const body = request.body as Record<string, unknown> | undefined;
  const name = typeof body?.name === "string" ? body.name.trim() : current.name;
  if (!name) {
    response.status(400).json({ error: "name is required" });
    return;
  }
  const updated = { ...current, name, updatedAt: Date.now() };
  styleLibrary = {
    ...styleLibrary,
    styles: styleLibrary.styles.map((item) => item.id === current.id ? updated : item),
  };
  void saveStyleLibrarySoon();
  response.json(updated);
});

app.delete("/api/styles/:id", (request, response) => {
  const current = styleLibrary.styles.find((item) => item.id === request.params.id && item.source === "custom");
  if (!current) {
    response.status(404).json({ error: "custom style not found" });
    return;
  }
  styleLibrary = { ...styleLibrary, styles: styleLibrary.styles.filter((item) => item.id !== current.id) };
  void saveStyleLibrarySoon();
  response.json({ ok: true });
});

app.post("/api/admin/style-categories", (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  if (!name) {
    response.status(400).json({ error: "name is required" });
    return;
  }
  const category: StyleCategory = {
    id: createId("style-cat"),
    name,
    order: typeof body?.order === "number" ? body.order : styleLibrary.categories.length,
  };
  styleLibrary = { ...styleLibrary, categories: [...styleLibrary.categories, category] };
  void saveStyleLibrarySoon();
  response.status(201).json(category);
});

app.put("/api/admin/style-categories/:id", (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const category = styleLibrary.categories.find((item) => item.id === request.params.id);
  if (!category) {
    response.status(404).json({ error: "category not found" });
    return;
  }
  const name = typeof body?.name === "string" ? body.name.trim() : category.name;
  const order = typeof body?.order === "number" && Number.isFinite(body.order) ? body.order : category.order;
  const updated = { ...category, name: name || category.name, order };
  styleLibrary = {
    ...styleLibrary,
    categories: styleLibrary.categories.map((item) => item.id === category.id ? updated : item),
  };
  void saveStyleLibrarySoon();
  response.json(updated);
});

app.delete("/api/admin/style-categories/:id", (request, response) => {
  const categoryId = request.params.id;
  if (categoryId === "all" || categoryId === "my" || categoryId === "recent") {
    response.status(400).json({ error: "default category cannot be deleted" });
    return;
  }
  styleLibrary = {
    categories: styleLibrary.categories.filter((item) => item.id !== categoryId),
    styles: styleLibrary.styles.map((style) => ({
      ...style,
      categoryIds: style.categoryIds.filter((id) => id !== categoryId),
      updatedAt: Date.now(),
    })),
  };
  void saveStyleLibrarySoon();
  response.json({ ok: true });
});

app.post("/api/admin/styles", (request, response) => {
  const style = normalizeStylePreset({
    ...(request.body as Record<string, unknown> | undefined),
    id: createId("style"),
    source: "preset",
    createdAt: Date.now(),
    updatedAt: Date.now(),
  });
  if (!style) {
    response.status(400).json({ error: "name and coverImageUrl are required" });
    return;
  }
  styleLibrary = { ...styleLibrary, styles: [style, ...styleLibrary.styles] };
  void saveStyleLibrarySoon();
  response.status(201).json(style);
});

app.put("/api/admin/styles/:id", (request, response) => {
  const current = styleLibrary.styles.find((item) => item.id === request.params.id);
  if (!current) {
    response.status(404).json({ error: "style not found" });
    return;
  }
  const normalized = normalizeStylePreset({
    ...current,
    ...(request.body as Record<string, unknown> | undefined),
    id: current.id,
    createdAt: current.createdAt,
    updatedAt: Date.now(),
  });
  if (!normalized) {
    response.status(400).json({ error: "name and coverImageUrl are required" });
    return;
  }
  styleLibrary = {
    ...styleLibrary,
    styles: styleLibrary.styles.map((item) => item.id === current.id ? normalized : item),
  };
  void saveStyleLibrarySoon();
  response.json(normalized);
});

app.delete("/api/admin/styles/:id", (request, response) => {
  styleLibrary = { ...styleLibrary, styles: styleLibrary.styles.filter((item) => item.id !== request.params.id) };
  void saveStyleLibrarySoon();
  response.json({ ok: true });
});

app.get("/api/email-config", (_request, response) => {
  response.json(getPublicEmailConfig());
});

app.put("/api/email-config", (request, response) => {
  try {
    emailConfig = normalizeEmailConfigInput(request.body, emailConfig);
    void saveEmailConfigSoon();
    response.json(getPublicEmailConfig());
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/email-config/test", async (request, response) => {
  const email = normalizeEmail((request.body as Record<string, unknown> | undefined)?.email);
  if (!email) {
    response.status(400).json({ error: "请输入有效的测试邮箱。" });
    return;
  }

  try {
    const code = generateEmailCode();
    await sendVerificationEmail(email, code, "test");
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/admin/storage-config", (_request, response) => {
  response.json(getPublicObjectStorageConfig());
});

app.put("/api/admin/storage-config", (request, response) => {
  try {
    objectStorageConfig = normalizeObjectStorageConfigInput(request.body, objectStorageConfig);
    void saveObjectStorageConfigSoon();
    response.json(getPublicObjectStorageConfig());
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/admin/storage-test", async (_request, response) => {
  try {
    await assertObjectStorageReady();
    await createObjectStorageClient().send(new HeadBucketCommand({ Bucket: objectStorageConfig.bucket }));
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/admin/storage-objects", async (request, response) => {
  try {
    await assertObjectStorageReady();
    const prefix = normalizeStoragePrefix(typeof request.query.prefix === "string" ? request.query.prefix : objectStorageConfig.prefix);
    const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "50", 10);
    const limit = Math.max(1, Math.min(200, Number.isFinite(limitValue) ? limitValue : 50));
    const data = await createObjectStorageClient().send(new ListObjectsV2Command({
      Bucket: objectStorageConfig.bucket,
      Prefix: prefix,
      MaxKeys: limit,
    }));
    response.json({
      objects: (data.Contents ?? []).map((item) => ({
        key: item.Key ?? "",
        size: item.Size ?? 0,
        updatedAt: item.LastModified?.getTime() ?? 0,
        url: item.Key ? publicUrlForObjectKey(item.Key) : "",
      })),
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/admin/storage-objects", async (request, response) => {
  const key = typeof request.query.key === "string" ? request.query.key.trim() : "";
  if (!key) {
    response.status(400).json({ error: "缺少对象 Key。" });
    return;
  }
  try {
    await assertObjectStorageReady();
    await deleteObjectStorageKey(key);
    response.json({ ok: true });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/admin/storage-presign-upload", async (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const fileName = typeof body?.fileName === "string" && body.fileName.trim() ? body.fileName.trim() : `upload-${Date.now()}`;
  const contentType = typeof body?.contentType === "string" && body.contentType.trim() ? body.contentType.trim() : "application/octet-stream";
  const directory = typeof body?.directory === "string" && body.directory.trim() ? body.directory.trim() : "admin";

  try {
    await assertObjectStorageReady();
    const extension = extname(fileName);
    const safeName = createStorageSafeFileName(fileName, extension || ".bin");
    const key = buildObjectStorageKey(directory, safeName);
    const command = new PutObjectCommand({
      Bucket: objectStorageConfig.bucket,
      Key: key,
      ContentType: contentType,
    });
    const uploadUrl = await getSignedUrl(createObjectStorageClient(), command, { expiresIn: 600 });
    response.json({
      method: "PUT",
      uploadUrl,
      key,
      url: publicUrlForObjectKey(key),
      headers: { "Content-Type": contentType },
      expiresIn: 600,
    });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/email-verifications/register/send", async (request, response) => {
  const email = normalizeEmail((request.body as Record<string, unknown> | undefined)?.email);
  if (!email) {
    response.status(400).json({ error: "请输入有效的邮箱地址。" });
    return;
  }

  const key = getEmailVerificationKey("register", email);
  const existing = emailVerificationRecords.get(key);
  const now = Date.now();
  if (existing && existing.expiresAt > now && now - existing.sentAt < EMAIL_VERIFICATION_COOLDOWN_MS) {
    response.status(429).json({
      error: `验证码发送太频繁，请 ${Math.ceil((EMAIL_VERIFICATION_COOLDOWN_MS - (now - existing.sentAt)) / 1000)} 秒后再试。`,
      retryAfterSeconds: Math.ceil((EMAIL_VERIFICATION_COOLDOWN_MS - (now - existing.sentAt)) / 1000),
    });
    return;
  }

  const code = generateEmailCode();
  const ttlMs = Math.max(1, emailConfig.codeTtlMinutes) * 60 * 1000;
  const record: EmailVerificationRecord = {
    email,
    purpose: "register",
    codeHash: hashEmailVerificationCode("register", email, code),
    sentAt: now,
    expiresAt: now + ttlMs,
    attempts: 0,
  };

  try {
    await sendVerificationEmail(email, code, "register");
    emailVerificationRecords.set(key, record);
    response.json({ ok: true, expiresAt: record.expiresAt, ttlSeconds: Math.round(ttlMs / 1000) });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/email-verifications/register/verify", (request, response) => {
  const body = request.body as Record<string, unknown> | undefined;
  const email = normalizeEmail(body?.email);
  const code = typeof body?.code === "string" ? body.code.trim() : "";
  if (!email || !/^\d{6}$/.test(code)) {
    response.status(400).json({ error: "请输入邮箱收到的 6 位验证码。" });
    return;
  }

  const key = getEmailVerificationKey("register", email);
  const record = emailVerificationRecords.get(key);
  const now = Date.now();
  if (!record || record.expiresAt <= now) {
    emailVerificationRecords.delete(key);
    response.status(400).json({ error: "验证码已过期，请重新获取。" });
    return;
  }

  if (record.attempts >= EMAIL_VERIFICATION_MAX_ATTEMPTS) {
    emailVerificationRecords.delete(key);
    response.status(400).json({ error: "验证码错误次数过多，请重新获取。" });
    return;
  }

  const codeHash = hashEmailVerificationCode("register", email, code);
  if (codeHash !== record.codeHash) {
    emailVerificationRecords.set(key, { ...record, attempts: record.attempts + 1 });
    response.status(400).json({ error: "验证码不正确。" });
    return;
  }

  emailVerificationRecords.delete(key);
  response.json({ ok: true });
});

app.post("/api/uploads/images", upload.array("images", 8), async (request, response) => {
  const files = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
  if (!files.length) {
    response.status(400).json({ error: "images are required" });
    return;
  }

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    const uploaded = await Promise.all(files.map(async (file) => {
      if (!file.mimetype.startsWith("image/")) {
        throw new Error(`Unsupported file type: ${file.mimetype || file.originalname}`);
      }

      const extension = imageExtensionFromContentType(file.mimetype);
      const fileName = `${createId("upload")}.${extension}`;
      const url = isObjectStorageEnabled()
        ? await putObjectStorageObject({
            key: buildObjectStorageKey("uploads", createStorageSafeFileName(file.originalname || fileName, `.${extension}`)),
            body: file.buffer,
            contentType: file.mimetype,
          })
        : await saveLocalUploadFile(fileName, file.buffer);
      return {
        url,
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype,
      };
    }));

    response.json({ files: uploaded });
  } catch (error) {
    response.status(400).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

// Agent API endpoints
app.get("/api/agents", (_request, response) => {
  response.json(Array.from(agents.values()));
});

app.get("/api/agents/:id", (request, response) => {
  const agent = agents.get(request.params.id);
  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return;
  }
  response.json(agent);
});

app.post("/api/agents", (request, response) => {
  const body = request.body as Partial<Agent>;
  
  if (!body.name || !body.description || !body.systemPrompt) {
    response.status(400).json({ error: "name, description, and systemPrompt are required" });
    return;
  }

  const now = Date.now();
  const agent: Agent = {
    id: createId("agent"),
    name: body.name,
    description: body.description,
    category: body.category || 'custom',
    type: body.type || 'custom',
    thumbnail: body.thumbnail,
    systemPrompt: body.systemPrompt,
    modelId: body.modelId,
    temperature: body.temperature ?? 0.7,
    maxTokens: body.maxTokens ?? 2000,
    createdAt: now,
    updatedAt: now,
    isActive: body.isActive ?? true,
  };

  agents.set(agent.id, agent);
  void saveAgentsSoon();
  response.json(agent);
});

app.put("/api/agents/:id", (request, response) => {
  const agent = agents.get(request.params.id);
  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = request.body as Partial<Agent>;
  const updatedAgent: Agent = {
    ...agent,
    ...body,
    id: agent.id,
    createdAt: agent.createdAt,
    updatedAt: Date.now(),
  };

  agents.set(agent.id, updatedAgent);
  void saveAgentsSoon();
  response.json(updatedAgent);
});

app.delete("/api/agents/:id", (request, response) => {
  const agent = agents.get(request.params.id);
  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return;
  }

  agents.delete(request.params.id);
  void saveAgentsSoon();
  response.json({ ok: true });
});

// Agent chat endpoint
app.post("/api/agents/:id/chat", async (request, response) => {
  const agent = agents.get(request.params.id);
  if (!agent) {
    response.status(404).json({ error: "Agent not found" });
    return;
  }

  const body = request.body as {
    message?: string;
    conversationHistory?: Array<{ role: string; content: string }>;
    provider?: ProviderRequestConfig;
    modelId?: string;
    attachments?: Array<{ type?: string; url?: string; name?: string }>;
    stream?: boolean;
  };
  
  if (!body.message) {
    response.status(400).json({ error: "message is required" });
    return;
  }

  const provider = normalizeProviderRequest(body.provider);
  if (!provider) {
    response.status(400).json({ error: "valid provider configuration is required" });
    return;
  }

  try {
    const imageAttachments = body.attachments?.length
      ? await Promise.all(
          body.attachments
            .filter((attachment) => attachment.type === "image" && typeof attachment.url === "string")
            .map(async (attachment) => ({ type: "image_url", image_url: { url: await resolveAgentImageUrl(attachment.url!) } }))
        )
      : [];
    const userContent = imageAttachments.length
      ? [
          { type: "text", text: body.message },
          ...imageAttachments,
        ]
      : body.message;

    const messages: Array<{ role: string; content: unknown }> = [
      { role: "system", content: agent.systemPrompt },
      ...(body.conversationHistory || []),
      { role: "user", content: userContent },
    ];

    const payload = {
      model: body.modelId || agent.modelId || "gpt-4",
      messages,
      temperature: agent.temperature ?? 0.7,
      max_tokens: agent.maxTokens ?? 2000,
      stream: body.stream === true,
    };

    const endpoint = buildEndpoint(provider.baseUrl, "/chat/completions");
    const headers = buildProviderHeaders(provider, "application/json", "application/json");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 60000);
    let clientClosed = false;
    let responseFinished = false;
    response.on("close", () => {
      if (responseFinished) return;
      clientClosed = true;
      controller.abort();
    });

    let apiResponse: Response;
    try {
      apiResponse = await fetch(endpoint, {
        method: "POST",
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    if (!apiResponse.ok) {
      const errorText = await apiResponse.text();
      throw new Error(`API request failed: ${apiResponse.status} ${errorText}`);
    }

    if (body.stream === true) {
      await streamAgentUpstreamResponse(apiResponse, response, () => clientClosed);
      responseFinished = true;
      return;
    }

    const result = await apiResponse.json();
    const content = extractAgentResponseContent(result) || "No response from agent";

    responseFinished = true;
    response.json({
      messageId: createId("msg"),
      content,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error("[agent-chat] error", error);
    if (!response.headersSent) {
      response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
    } else {
      writeAgentSse(response, "error", { error: error instanceof Error ? error.message : String(error) });
      response.end();
    }
  }
});

function writeAgentSse(response: express.Response, event: string, data: Record<string, unknown>) {
  response.write(`event: ${event}\n`);
  response.write(`data: ${JSON.stringify(data)}\n\n`);
}

function extractAgentResponseContent(value: unknown) {
  const data = value as { choices?: Array<{ message?: { content?: unknown }; delta?: { content?: unknown }; text?: unknown }> } | undefined;
  const choice = data?.choices?.[0];
  const content = choice?.message?.content ?? choice?.delta?.content ?? choice?.text;
  return typeof content === "string" ? content : "";
}

function extractAgentStreamDelta(value: unknown) {
  const data = value as { choices?: Array<{ delta?: { content?: unknown }; message?: { content?: unknown }; text?: unknown }> } | undefined;
  const choice = data?.choices?.[0];
  const content = choice?.delta?.content ?? choice?.message?.content ?? choice?.text;
  return typeof content === "string" ? content : "";
}

async function streamAgentUpstreamResponse(apiResponse: Response, response: express.Response, isClientClosed: () => boolean) {
  response.status(200);
  response.setHeader("Content-Type", "text/event-stream; charset=utf-8");
  response.setHeader("Cache-Control", "no-cache, no-transform");
  response.setHeader("Connection", "keep-alive");
  response.flushHeaders?.();

  const contentType = apiResponse.headers.get("content-type") ?? "";
  if (!apiResponse.body || !/text\/event-stream/i.test(contentType)) {
    const responseText = await apiResponse.text();
    const result = parseJsonOrText(responseText);
    const content = extractAgentResponseContent(result) || (typeof result === "string" ? result : "");
    if (content && !isClientClosed()) writeAgentSse(response, "delta", { content });
    if (!isClientClosed()) writeAgentSse(response, "done", { messageId: createId("msg"), timestamp: Date.now() });
    response.end();
    return;
  }

  const reader = apiResponse.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let doneSent = false;

  const handleEvent = (eventText: string) => {
    const dataText = eventText
      .split(/\r?\n/)
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.replace(/^data:\s?/, ""))
      .join("\n")
      .trim();

    if (!dataText) return;
    if (dataText === "[DONE]") {
      doneSent = true;
      if (!isClientClosed()) writeAgentSse(response, "done", { messageId: createId("msg"), timestamp: Date.now() });
      return;
    }

    const parsed = parseJsonOrText(dataText);
    const delta = extractAgentStreamDelta(parsed);
    if (delta && !isClientClosed()) writeAgentSse(response, "delta", { content: delta });
  };

  const drainBuffer = (flush = false) => {
    const events = buffer.split(/\r?\n\r?\n/);
    buffer = flush ? "" : events.pop() ?? "";
    for (const eventText of events) handleEvent(eventText);
    if (flush && buffer.trim()) handleEvent(buffer);
  };

  while (!isClientClosed()) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    drainBuffer(false);
  }

  buffer += decoder.decode();
  drainBuffer(true);

  if (!doneSent && !isClientClosed()) {
    writeAgentSse(response, "done", { messageId: createId("msg"), timestamp: Date.now() });
  }
  response.end();
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}

function sanitizeText(value: string, maxLength = 2000) {
  return value
    .replace(/data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, (match) => `<data-image length=${match.length}>`)
    .replace(/data:video\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, (match) => `<data-video length=${match.length}>`)
    .replace(/data:[a-z0-9.+-]+\/[a-z0-9.+-]+;base64,[a-z0-9+/=]+/gi, (match) => `<data-file length=${match.length}>`)
    .replace(/(https?:\/\/[^\s'"<>)?]+)\?[^\s'"<>)]+/gi, "$1?<query-redacted>")
    .replace(/Bearer\s+[^\s'"<>]+/gi, "Bearer <redacted>")
    .replace(/sk-[a-z0-9_-]{12,}/gi, "sk-<redacted>")
    .slice(0, maxLength);
}

function sanitizeValue(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return `<data-image length=${value.length}>`;
    if (/^data:video\//i.test(value)) return `<data-video length=${value.length}>`;
    if (/^data:[^;]+;base64,/i.test(value)) return `<data-file length=${value.length}>`;
    return sanitizeText(value, 500);
  }
  if (Array.isArray(value)) return value.map(sanitizeValue);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    if (/key|token|secret|password|authorization|api[-_]?key/i.test(key)) {
      output[key] = "<redacted>";
      continue;
    }
    output[key] = sanitizeValue(nestedValue);
  }
  return output;
}

function summarizeAttempt(attempt: ImageJobAttempt) {
  return {
    label: attempt.label,
    endpoint: attempt.endpoint,
    mediaType: attempt.mediaType,
    useImageEdit: attempt.useImageEdit === true,
    referenceImageCount: attempt.referenceImages?.length ?? 0,
    payload: sanitizeValue(attempt.payload),
  };
}

function getDataUrlMime(value: unknown) {
  if (typeof value !== "string") return undefined;
  return value.match(/^data:([^;]+);base64,/i)?.[1]?.toLowerCase();
}

function getMessageImageMimeTypes(payload: Record<string, unknown>) {
  const messages = Array.isArray(payload.messages) ? payload.messages : [];
  const mimeTypes: string[] = [];
  for (const message of messages) {
    if (!message || typeof message !== "object") continue;
    const content = (message as Record<string, unknown>).content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || typeof part !== "object") continue;
      const imageUrl = (part as Record<string, unknown>).image_url;
      const url = imageUrl && typeof imageUrl === "object"
        ? (imageUrl as Record<string, unknown>).url
        : undefined;
      const mimeType = getDataUrlMime(url);
      if (mimeType) mimeTypes.push(mimeType);
    }
  }
  return mimeTypes;
}

function getFirstVideoReferenceImage(payload: Record<string, unknown>) {
  const image = typeof payload.image === "string" && payload.image ? payload.image : undefined;
  const inputReference = typeof payload.input_reference === "string" && payload.input_reference
    ? payload.input_reference
    : typeof payload.inputReference === "string" && payload.inputReference
      ? payload.inputReference
      : undefined;
  const images = Array.isArray(payload.images)
    ? payload.images.filter((value): value is string => typeof value === "string" && Boolean(value))
    : [];
  const referenceImages = Array.isArray(payload.reference_images)
    ? payload.reference_images.filter((value): value is string => typeof value === "string" && Boolean(value))
    : Array.isArray(payload.referenceImages)
      ? payload.referenceImages.filter((value): value is string => typeof value === "string" && Boolean(value))
      : [];
  return image ?? inputReference ?? images[0] ?? referenceImages[0];
}

function isSingleImageVideoPayload(payload: Record<string, unknown>, mediaType: MediaJobType) {
  if (mediaType !== "video") return false;
  const model = typeof payload.model === "string" ? payload.model.toLowerCase() : "";
  return model.includes("sora");
}

function normalizeVideoPayloadImageFields(payload: Record<string, unknown>, mediaType: MediaJobType) {
  if (!isSingleImageVideoPayload(payload, mediaType)) return payload;
  const image = getFirstVideoReferenceImage(payload);
  const normalized = { ...payload };
  delete normalized.images;
  delete normalized.input_reference;
  delete normalized.inputReference;
  delete normalized.reference_images;
  delete normalized.referenceImages;
  if (image) normalized.image = image;
  else delete normalized.image;
  return normalized;
}

function summarizeVideoPayload(payload?: Record<string, unknown>) {
  if (!payload) return undefined;
  const images = Array.isArray(payload.images) ? payload.images : undefined;
  const inputImages = Array.isArray(payload.input_images) ? payload.input_images : undefined;
  const imageMime = getDataUrlMime(payload.image);
  const imagesMimeTypes = images
    ?.map(getDataUrlMime)
    .filter((mimeType): mimeType is string => Boolean(mimeType));
  const inputReferenceMime = getDataUrlMime(payload.input_reference ?? payload.inputReference);
  const messageImageMimeTypes = getMessageImageMimeTypes(payload);
  return {
    model: payload.model,
    size: payload.size,
    aspectRatio: payload.aspect_ratio ?? payload.aspectRatio,
    resolution: payload.resolution,
    duration: payload.duration,
    seconds: payload.seconds,
    hasImage: typeof payload.image === "string" && Boolean(payload.image),
    imageCount: images?.length ?? (payload.image ? 1 : 0),
    inputImageCount: inputImages?.length ?? 0,
    imageMime,
    imagesMimeTypes,
    hasInputReference: typeof payload.input_reference === "string" || typeof payload.inputReference === "string",
    inputReferenceMime,
    messageImageCount: messageImageMimeTypes.length,
    messageImageMimeTypes,
    usesVideoImageFields: Boolean(payload.image || images?.length || inputImages?.length),
    hasLegacyReferenceImages: Array.isArray(payload.reference_images) || Array.isArray(payload.referenceImages),
  };
}

function headersToObject(headers: Headers) {
  const result: Record<string, string> = {};
  headers.forEach((value, key) => {
    result[key] = /key|token|secret|password|authorization|cookie/i.test(key) ? "<redacted>" : sanitizeText(value, 500);
  });
  return result;
}

function keyFingerprint(key: string) {
  if (!key) return "<empty>";
  return createHash("sha256").update(key).digest("hex").slice(0, 12);
}

function getUpstreamRequestId(headers: Headers) {
  return headers.get("x-oneapi-request-id")
    ?? headers.get("x-api-request-id")
    ?? headers.get("x-request-id")
    ?? headers.get("x-newapi-request-id")
    ?? headers.get("request-id")
    ?? undefined;
}

function getGatewayRequestId(headers: Headers) {
  return headers.get("eo-log-uuid")
    ?? headers.get("cf-ray")
    ?? headers.get("x-edge-request-id")
    ?? headers.get("x-gateway-request-id")
    ?? undefined;
}

function logImageJob(jobId: string, event: string, details?: Record<string, unknown>) {
  const entry = {
    timestamp: new Date().toISOString(),
    jobId,
    event,
    ...(details ? sanitizeValue(details) as Record<string, unknown> : {}),
  };
  const line = JSON.stringify(entry);
  console.log(`[image-job] ${line}`);
  void appendFile(IMAGE_JOBS_LOG_FILE, `${line}\n`, "utf8").catch((error) => {
    console.warn("[image-job] failed to write log", error);
  });
}

function summarizeAppStateValue(value: string | null) {
  if (value === null) return { valueBytes: 0, deleted: true };
  const summary: Record<string, unknown> = { valueBytes: value.length };
  try {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown>; version?: unknown };
    const state = parsed.state;
    if (typeof parsed.version === "number") summary.version = parsed.version;
    if (state && typeof state === "object") {
      for (const key of ["users", "projects", "items", "accounts", "transactions", "providers"] as const) {
        const list = state[key];
        if (Array.isArray(list)) summary[key] = list.length;
      }
      if (Array.isArray(state.deletedItemIds)) summary.deletedItemIds = state.deletedItemIds.length;
      if (typeof state.currentUserId === "string") summary.currentUserId = state.currentUserId;
    }
  } catch {
    summary.parseable = false;
  }
  return summary;
}

function logAppState(event: string, key: string, value: string | null) {
  const line = JSON.stringify({
    timestamp: new Date().toISOString(),
    event,
    key,
    ...summarizeAppStateValue(value),
  });
  console.log(`[app-state] ${line}`);
  void appendFile(APP_STATE_LOG_FILE, `${line}\n`, "utf8").catch((error) => {
    console.warn("[app-state] failed to write log", error);
  });
}

function getPersistedFlowCounts(value?: string | null) {
  if (typeof value !== "string") return null;
  try {
    const state = (JSON.parse(value) as { state?: { projects?: unknown; items?: unknown } }).state;
    return {
      projects: Array.isArray(state?.projects) ? state.projects.length : 0,
      items: Array.isArray(state?.items) ? state.items.length : 0,
    };
  } catch {
    return null;
  }
}

function shouldSkipEmptyFlowStateOverwrite(key: string, nextValue: string) {
  if (!key.startsWith("ai-director-flow-v2:")) return false;
  const nextCounts = getPersistedFlowCounts(nextValue);
  const currentCounts = getPersistedFlowCounts(appState.get(key));
  return Boolean(
    nextCounts &&
      currentCounts &&
      nextCounts.projects === 0 &&
      nextCounts.items === 0 &&
      (currentCounts.projects > 0 || currentCounts.items > 0)
  );
}

function getRecordId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function getProjectUpdatedAt(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const updatedAt = (value as { updatedAt?: unknown }).updatedAt;
  return typeof updatedAt === "number" && Number.isFinite(updatedAt) ? updatedAt : 0;
}

function flowItemRank(value: unknown) {
  if (!value || typeof value !== "object") return 0;
  const item = value as { status?: unknown; url?: unknown; saveError?: unknown };
  if (item.status === "completed" && typeof item.url === "string" && item.url) return 5;
  if (item.status === "completed") return 4;
  if (item.status === "error" && item.saveError === "历史图片任务不存在，请重新生成。") return 1;
  if (item.status === "error" && item.saveError === "Historical video job was not found. Please generate it again.") return 1;
  if (item.status === "error") return 3;
  if (item.status === "generating") return 2;
  return 1;
}

function mergeById<T>(currentItems: T[], nextItems: T[], choose: (current: T, next: T) => T) {
  const merged = new Map<string, T>();
  const order: string[] = [];

  for (const item of currentItems) {
    const id = getRecordId(item);
    if (!id) continue;
    merged.set(id, item);
    order.push(id);
  }

  for (const item of nextItems) {
    const id = getRecordId(item);
    if (!id) continue;
    const current = merged.get(id);
    if (!current) {
      order.push(id);
      merged.set(id, item);
      continue;
    }
    merged.set(id, choose(current, item));
  }

  return order.map((id) => merged.get(id)).filter((item): item is T => Boolean(item));
}

function getStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter((item): item is string => Boolean(item));
}

function normalizeFlowItemStorageUrl(item: unknown) {
  if (!item || typeof item !== "object") return item;
  const record = item as Record<string, unknown>;
  if (typeof record.url !== "string") return item;
  const normalizedUrl = normalizeObjectStorageResultUrl(record.url);
  if (!normalizedUrl) return item;
  return normalizedUrl === record.url ? item : { ...record, url: normalizedUrl };
}

function normalizeFlowItemFromBackendJob(item: unknown) {
  const normalizedItem = normalizeFlowItemStorageUrl(item);
  if (!normalizedItem || typeof normalizedItem !== "object") return normalizedItem;
  const record = normalizedItem as Record<string, unknown>;
  const id = getRecordId(record);
  if (!id) return normalizedItem;
  const job = jobs.get(id);
  if (!job) return normalizedItem;
  markImageJobTimedOutIfStale(id, job);
  const currentJob = jobs.get(id) ?? job;
  if (currentJob.status === "queued" || currentJob.status === "running") {
    if (record.status === "completed" && typeof record.url === "string" && record.url) return normalizedItem;
    const currentProgress = typeof record.progress === "number" && Number.isFinite(record.progress) ? record.progress : 0;
    const fallbackProgress = getJobMediaType(currentJob) === "video" ? 8 : 0;
    return {
      ...record,
      status: "generating",
      progress: Math.max(currentProgress, fallbackProgress),
      saveError: undefined,
    };
  }
  if (currentJob.status === "failed" || currentJob.status === "timeout-recoverable") {
    if (record.status === "completed" && typeof record.url === "string" && record.url) return normalizedItem;
    return {
      ...record,
      status: "error",
      progress: undefined,
      saveError: currentJob.error || (getJobMediaType(currentJob) === "video" ? "视频生成失败。" : "图片生成失败。"),
    };
  }
  if (currentJob.status !== "completed" || !currentJob.resultUrl) return normalizedItem;
  const resultUrl = normalizeObjectStorageResultUrl(currentJob.resultUrl) ?? currentJob.resultUrl;
  const currentUrl = typeof record.url === "string" ? record.url : "";
  const resultObjectKey = objectStorageKeyFromUrl(resultUrl);
  const currentObjectKey = objectStorageKeyFromUrl(currentUrl);
  if (currentUrl && (!resultObjectKey || currentObjectKey)) return normalizedItem;
  return {
    ...record,
    status: "completed",
    url: resultUrl,
    progress: 100,
    saveError: undefined,
  };
}

function normalizeFlowStateStorageUrls(value: string) {
  try {
    const parsed = JSON.parse(value) as { state?: Record<string, unknown>; version?: unknown };
    const items = Array.isArray(parsed.state?.items) ? parsed.state.items : undefined;
    if (!items) return value;
    const normalizedItems = items.map(normalizeFlowItemFromBackendJob);
    const changed = normalizedItems.some((item, index) => item !== items[index]);
    if (!changed) return value;
    return JSON.stringify({
      ...parsed,
      state: {
        ...parsed.state,
        items: normalizedItems,
      },
    });
  } catch {
    return value;
  }
}

function mergeFlowStateValue(currentValue: string | undefined, nextValue: string) {
  if (!currentValue) return { value: nextValue, merged: false };

  try {
    const current = JSON.parse(currentValue) as { state?: Record<string, unknown>; version?: unknown };
    const next = JSON.parse(nextValue) as { state?: Record<string, unknown>; version?: unknown };
    const currentProjects = Array.isArray(current.state?.projects) ? current.state.projects : undefined;
    const nextProjects = Array.isArray(next.state?.projects) ? next.state.projects : undefined;
    const currentItems = Array.isArray(current.state?.items) ? current.state.items.map(normalizeFlowItemFromBackendJob) : undefined;
    const nextItems = Array.isArray(next.state?.items) ? next.state.items.map(normalizeFlowItemFromBackendJob) : undefined;
    if (!currentProjects || !nextProjects || !currentItems || !nextItems) return { value: nextValue, merged: false };

    const deletedItemIds = Array.from(new Set([
      ...getStringList(current.state?.deletedItemIds),
      ...getStringList(next.state?.deletedItemIds),
    ]));
    const isDeletedItem = (item: unknown) => deletedItemIds.includes(getRecordId(item));
    const projects = mergeById(currentProjects, nextProjects, (currentProject, nextProject) =>
      getProjectUpdatedAt(nextProject) >= getProjectUpdatedAt(currentProject) ? nextProject : currentProject
    );
    const items = mergeById(
      currentItems.filter((item) => !isDeletedItem(item)),
      nextItems.filter((item) => !isDeletedItem(item)),
      (currentItem, nextItem) => flowItemRank(nextItem) >= flowItemRank(currentItem) ? nextItem : currentItem
    );

    const mergedValue = JSON.stringify({
      ...next,
      state: {
        ...next.state,
        projects,
        items,
        deletedItemIds,
      },
    });
    return {
      value: mergedValue,
      merged: projects.length !== nextProjects.length || items.length !== nextItems.length || mergedValue !== nextValue,
    };
  } catch {
    return { value: nextValue, merged: false };
  }
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl
    .replace(/\/+$/, "")
    .replace(/\/(?:v\d+(?:beta\d+)?\/)?(?:chat\/completions|images\/generations|images\/edits|responses)$/i, "");
}

function hasVersionSegment(baseUrl: string) {
  return /\/v\d+(?:beta\d+)?$/i.test(baseUrl);
}

function buildEndpoint(baseUrl: string, path: string) {
 if (/^https?:\/\//i.test(path)) return path;

const normalizedBase = normalizeBaseUrl(baseUrl);
const normalizedPath = path.startsWith("/") ? path : `/${path}`;

  if (hasVersionSegment(normalizedBase)) {
    return `${normalizedBase}${normalizedPath.replace(/^\/v\d+(?:beta\d+)?/i, "")}`;
  }

if (/^\/v\d+(?:beta\d+)?\//i.test(normalizedPath)) return `${normalizedBase}${normalizedPath}`;
return `${normalizedBase}/v1${normalizedPath}`;
}

function isGeminiProvider(provider: ProviderRequestConfig) {
 const text = `${provider.id ?? ""} ${provider.name ?? ""} ${provider.baseUrl}`.toLowerCase();
 return text.includes("gemini") || text.includes("google") || text.includes("generativelanguage");
}

function normalizeProviderKeyForHeader(key: string) {
 return key.split(/\r?\n/).map((value) => value.trim()).find(Boolean) ?? "";
}

function buildProviderHeaders(provider: ProviderRequestConfig, accept = "application/json", contentType?: string) {
 const providerKey = normalizeProviderKeyForHeader(provider.key);
 const headers: Record<string, string> = {
 Accept: accept,
 Authorization: `Bearer ${providerKey}`,
 ...(provider.headers ?? {}),
 };

 if (contentType) headers["Content-Type"] = contentType;
 if (isGeminiProvider(provider)) headers["x-goog-api-key"] = providerKey;
 if (provider.id === "anthropic" || provider.name?.toLowerCase().includes("anthropic")) {
 headers["anthropic-version"] = "2023-06-01";
 }

 return headers;
}

function normalizeProviderRequest(input: unknown): ProviderRequestConfig | null {
 if (!input || typeof input !== "object") return null;
 const provider = input as Record<string, unknown>;
 if (typeof provider.baseUrl !== "string" || typeof provider.key !== "string") return null;
 return {
 id: typeof provider.id === "string" ? provider.id : undefined,
 name: typeof provider.name === "string" ? provider.name : undefined,
 baseUrl: provider.baseUrl,
 key: provider.key,
 headers: typeof provider.headers === "object" && provider.headers ? provider.headers as Record<string, string> : undefined,
 };
}

function parseDataUrl(dataUrl: string) {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/);
  if (!match) return null;
  return { mimeType: match[1], data: match[2] };
}

function detectImageMimeFromBase64(base64: string) {
  const normalized = base64.replace(/\s+/g, "");
  if (normalized.startsWith("iVBORw0KGgo")) return "image/png";
  if (normalized.startsWith("/9j/")) return "image/jpeg";
  if (normalized.startsWith("UklGR")) return "image/webp";
  if (normalized.startsWith("R0lGOD")) return "image/gif";
  return undefined;
}

function normalizeImageDataUrlMime(dataUrl: string) {
  const parsed = parseDataUrl(dataUrl);
  if (!parsed) return dataUrl;
  if (parsed.mimeType.toLowerCase().startsWith("image/")) return dataUrl;
  const detectedMime = detectImageMimeFromBase64(parsed.data);
  if (!detectedMime) return dataUrl;
  return `data:${detectedMime};base64,${parsed.data.replace(/\s+/g, "")}`;
}

function imageExtensionFromContentType(contentType?: string | null) {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("jpeg")) return "jpg";
  if (normalized.includes("webp")) return "webp";
  if (normalized.includes("gif")) return "gif";
  if (normalized.includes("avif")) return "avif";
  return "png";
}

function videoExtensionFromContentType(contentType?: string | null) {
  const normalized = (contentType ?? "").toLowerCase();
  if (normalized.includes("webm")) return "webm";
  if (normalized.includes("quicktime") || normalized.includes("mov")) return "mov";
  if (normalized.includes("x-matroska") || normalized.includes("matroska")) return "mkv";
  if (normalized.includes("mpegurl") || normalized.includes("m3u8")) return "m3u8";
  return "mp4";
}

function mediaExtensionFromContentType(mediaType: MediaJobType, contentType?: string | null) {
  return mediaType === "video" ? videoExtensionFromContentType(contentType) : imageExtensionFromContentType(contentType);
}

function isVideoContentType(contentType?: string | null) {
  const normalized = (contentType ?? "").toLowerCase();
  return normalized.startsWith("video/") || normalized.includes("mpegurl") || normalized.includes("octet-stream");
}

function contentTypeFromImagePath(filePath: string) {
  const extension = extname(filePath).toLowerCase();
  if (extension === ".jpg" || extension === ".jpeg") return "image/jpeg";
  if (extension === ".webp") return "image/webp";
  if (extension === ".gif") return "image/gif";
  if (extension === ".avif") return "image/avif";
  return "image/png";
}

function getLocalUploadPathFromUrl(url: string) {
  if (url.startsWith("/uploads/")) return url;
  try {
    const parsed = new URL(url);
    if (parsed.pathname.startsWith("/uploads/")) {
      return parsed.pathname;
    }
  } catch {
    return null;
  }
  return null;
}

async function resolveAgentImageUrl(url: string) {
  if (/^data:/i.test(url)) return normalizeImageDataUrlMime(url);

  const uploadPath = getLocalUploadPathFromUrl(url);
  if (!uploadPath) return url;

  const fileName = basename(decodeURIComponent(uploadPath.replace("/uploads/", "")));
  const filePath = join(UPLOADS_DIR, fileName);
  try {
    const buffer = await readFile(filePath);
    return `data:${contentTypeFromImagePath(filePath)};base64,${buffer.toString("base64")}`;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      throw new Error(`Agent image attachment is missing from local uploads: ${fileName}`);
    }
    throw error;
  }
}

function isLikelyBase64Image(value: string) {
  return value.length > 100 && /^(?:iVBORw0KGgo|\/9j\/|UklGR|R0lGOD|AAAA)[a-z0-9+/]+=*$/i.test(value.replace(/\s+/g, ""));
}

function toImageDataUrl(base64: string) {
  return `data:image/png;base64,${base64.replace(/\s+/g, "")}`;
}

function extractImageUrls(response: unknown): string[] {
  const results: string[] = [];
  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) {
        results.push(value);
        return;
      }
      if (isLikelyBase64Image(value)) {
        results.push(toImageDataUrl(value));
        return;
      }
      results.push(...Array.from(value.matchAll(/https?:\/\/[^\s'"<>)]+/g)).map((match) => match[0]));
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;
    const item = value as Record<string, unknown>;
    for (const key of ["url", "image_url", "output_url", "result_url"] as const) {
      const candidate = item[key];
      if (typeof candidate === "string") {
        results.push(candidate);
        // Debug log to track URL extraction
        if (candidate.includes('/content/')) {
          console.log('[extractImageUrls] Found content URL:', {
            key,
            url: candidate,
            hasQueryParams: candidate.includes('?'),
            queryString: candidate.split('?')[1] || 'none'
          });
        }
      }
    }
    if (typeof item.b64_json === "string") results.push(`data:image/png;base64,${item.b64_json}`);
    if (typeof item.base64 === "string") results.push(`data:image/png;base64,${item.base64}`);
    if (typeof item.image_base64 === "string") results.push(`data:image/png;base64,${item.image_base64}`);
    if (typeof item.result === "string" && isLikelyBase64Image(item.result)) results.push(toImageDataUrl(item.result));
    if (typeof item.data === "string" && isLikelyBase64Image(item.data)) results.push(toImageDataUrl(item.data));
    Object.values(item).forEach(visit);
  };
  visit(response);
return Array.from(new Set(results));
}

function isLikelyVideoUrl(value: string) {
  return /^data:video\//i.test(value)
    || /\.(?:mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|m3u8)(?:[?#][^\s'"<>)]+)?$/i.test(value)
    || /\/(?:video|videos|generated|content)\//i.test(value);
}

function extractVideoUrls(response: unknown): string[] {
  const results: string[] = [];
  const pushVideo = (candidate: string, trustField = false) => {
    const cleaned = candidate.trim().replace(/[),.;\]]+$/g, "");
    if (!cleaned) return;
    if (/^data:video\//i.test(cleaned) || /^https?:\/\//i.test(cleaned) || cleaned.startsWith("/")) {
      if (trustField || /^data:video\//i.test(cleaned) || cleaned.startsWith("/") || isLikelyVideoUrl(cleaned)) {
        results.push(cleaned);
      }
    }
  };

  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      const videoSrcMatches = value.matchAll(/<video\b[^>]*\bsrc=["']([^"']+)["']/gi);
      for (const match of videoSrcMatches) pushVideo(match[1]);
      if (/^data:video\//i.test(value) || (/^https?:\/\//i.test(value) && isLikelyVideoUrl(value))) {
        pushVideo(value);
        return;
      }
      for (const match of value.matchAll(/https?:\/\/[^\s'"<>)]+/g)) pushVideo(match[0]);
      return;
    }
    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }
    if (typeof value !== "object") return;

    const item = value as Record<string, unknown>;
    for (const key of ["video_url", "mp4", "video", "source", "src"] as const) {
      const candidate = item[key];
      if (typeof candidate === "string") pushVideo(candidate, true);
    }
    for (const key of ["url", "output_url", "result_url"] as const) {
      const candidate = item[key];
      if (typeof candidate === "string") pushVideo(candidate);
    }
    Object.values(item).forEach(visit);
  };

  visit(response);
  return Array.from(new Set(results));
}

function extractMediaUrls(response: unknown, mediaType: MediaJobType) {
  return mediaType === "video" ? extractVideoUrls(response) : extractImageUrls(response);
}

function absolutizeUpstreamMediaUrl(mediaUrl: string, baseUrl: string) {
 if (/^(?:https?:|data:(?:image|video)\/)/i.test(mediaUrl)) return mediaUrl;
 if (!mediaUrl.startsWith("/")) return mediaUrl;

 try {
  const base = new URL(normalizeBaseUrl(baseUrl));
  return new URL(mediaUrl, base.origin).href;
 } catch {
  return mediaUrl;
 }
}

function absolutizeUpstreamImageUrl(imageUrl: string, baseUrl: string) {
  return absolutizeUpstreamMediaUrl(imageUrl, baseUrl);
}

function extractAsyncTaskId(response: unknown): string | null {
 if (!response || typeof response !== "object") return null;
 const obj = response as Record<string, unknown>;
 
 // Check for common async task patterns
 // Only treat as async if status is explicitly queued/processing
 if ((obj.status === "queued" || obj.status === "processing") && typeof obj.task_id === "string" && obj.task_id) {
 return obj.task_id;
 }
 if ((obj.status === "queued" || obj.status === "processing") && typeof obj.taskId === "string" && obj.taskId) {
 return obj.taskId;
 }
 if ((obj.status === "queued" || obj.status === "processing") && typeof obj.id === "string" && obj.id) {
 return obj.id;
 }
 
 return null;
}

function isCompletedTaskStatus(status: unknown) {
  return ["completed", "succeeded", "success"].includes(String(status ?? "").toLowerCase());
}

function isActiveTaskStatus(status: unknown) {
  return ["queued", "processing", "pending", "running", "submitted", "in_progress", "created"].includes(String(status ?? "").toLowerCase());
}

function extractTaskIdCandidate(response: unknown): string | null {
  if (!response || typeof response !== "object") return null;
  const record = response as Record<string, unknown>;
  const candidates = [
    record.task_id,
    record.taskId,
    record.video_id,
    record.videoId,
    record.generation_id,
    record.generationId,
    record.id,
  ];
  const id = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof id === "string" ? id : null;
}

function extractMediaTaskId(response: unknown, mediaType: MediaJobType): string | null {
  if (mediaType !== "video" || !response || typeof response !== "object") return extractAsyncTaskId(response);
  const record = response as Record<string, unknown>;
  if (isActiveTaskStatus(record.status ?? record.state)) return extractTaskIdCandidate(response);
  return extractAsyncTaskId(response);
}

function buildVideoTaskStatusEndpoints(taskId: string, attemptEndpoint?: string) {
  const encodedTaskId = encodeURIComponent(taskId);
  const officialVideoEndpoints = [
    `/v1/videos/${encodedTaskId}`,
    `/videos/${encodedTaskId}`,
  ];
  const asyncEndpoints = [
    `/v1/async/generations/${encodedTaskId}`,
    `/async/generations/${encodedTaskId}`,
  ];
  const lnapiEndpoints = [
    `/v1/video/query?id=${encodedTaskId}`,
    `/video/query?id=${encodedTaskId}`,
  ];
  const legacyEndpoints = [
    `/v1/video/generations/${encodedTaskId}`,
    `/video/generations/${encodedTaskId}`,
    `/v1/video/tasks/${encodedTaskId}`,
    `/video/tasks/${encodedTaskId}`,
    `/v1/tasks/${encodedTaskId}`,
    `/tasks/${encodedTaskId}`,
  ];
  const endpoint = (attemptEndpoint ?? "").toLowerCase();
  const ordered = endpoint.includes("async/generations")
    ? [...asyncEndpoints, ...officialVideoEndpoints, ...lnapiEndpoints, ...legacyEndpoints]
    : endpoint.includes("video/create")
      ? [...lnapiEndpoints, ...officialVideoEndpoints, ...asyncEndpoints, ...legacyEndpoints]
      : [...officialVideoEndpoints, ...asyncEndpoints, ...lnapiEndpoints, ...legacyEndpoints];
  return Array.from(new Set(ordered));
}

function addVideoContentUrlCandidate(response: unknown, baseUrl: string, taskId: string) {
  if (!response || typeof response !== "object") return response;
  const contentUrl = buildEndpoint(baseUrl, `/videos/${encodeURIComponent(taskId)}/content`);
  return { ...(response as Record<string, unknown>), video_url: contentUrl };
}

async function fetchJsonWithTimeout(url: string, headers: Record<string, string>, timeoutMs = 30000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    const responseText = await response.text();
    return { response, responseText, payload: parseJsonOrText(responseText) };
  } finally {
    clearTimeout(timeout);
  }
}

async function queryCompletedVideoTask(job: ImageJob, attempt: ImageJobAttempt, taskId: string): Promise<unknown | null> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${job.provider.key}`,
    Accept: "application/json",
    ...(job.provider.headers ?? {}),
  };
  const taskEndpoints = buildVideoTaskStatusEndpoints(taskId, attempt.endpoint);

  for (const taskPath of taskEndpoints) {
    const taskUrl = buildEndpoint(job.provider.baseUrl, taskPath);
    try {
      logImageJob(job.id, "attempt.completed-task-query", {
        label: attempt.label,
        taskId,
        taskUrl,
      });
      const { response, responseText, payload } = await fetchJsonWithTimeout(taskUrl, headers);
      logImageJob(job.id, "attempt.completed-task-query-response", {
        label: attempt.label,
        taskId,
        taskUrl,
        status: response.status,
        statusText: response.statusText,
        responsePreview: sanitizeText(responseText, 800),
      });
      if (!response.ok) continue;
      if (extractVideoUrls(payload).length > 0) return payload;
      if (payload && typeof payload === "object") {
        const record = payload as Record<string, unknown>;
        if (isCompletedTaskStatus(record.status ?? record.state)) {
          return addVideoContentUrlCandidate(payload, job.provider.baseUrl, taskId);
        }
      }
    } catch (error) {
      logImageJob(job.id, "attempt.completed-task-query-error", {
        label: attempt.label,
        taskId,
        taskUrl,
        ...getErrorDetails(error),
      });
    }
  }

  return null;
}

async function pollAsyncTask(job: ImageJob, attempt: ImageJobAttempt, taskId: string, baseEndpoint: string): Promise<unknown> {
 const mediaType = attempt.mediaType ?? job.request.mediaType ?? "image";
 const firstPollDelayMs = mediaType === "video" ? 30000 : 30000;
 const subsequentPollIntervalMs = mediaType === "video" ? 15000 : 15000;
 const pollTimeoutMs = mediaType === "video" ? VIDEO_JOB_REQUEST_TIMEOUT_MS : IMAGE_JOB_REQUEST_TIMEOUT_MS;
 const maxPolls = Math.max(
  10,
  Math.ceil(Math.max(0, pollTimeoutMs - firstPollDelayMs) / subsequentPollIntervalMs) + 1,
 );
 const headers: Record<string, string> = {
 Authorization: `Bearer ${job.provider.key}`,
 Accept: "application/json",
 ...(job.provider.headers ?? {}),
 };
 
 const taskEndpoints = mediaType === "video" ? buildVideoTaskStatusEndpoints(taskId, attempt.endpoint) : [
 `/v1/images/tasks/${taskId}`, // New API standard endpoint (documented)
 `/images/tasks/${taskId}`, // New API without /v1
 `/v1/tasks/${taskId}`, // Generic tasks endpoint
 `/tasks/${taskId}`, // Generic without /v1
 `/images/generations/${taskId}`, // OpenAI-style
 `/v1/images/generations/${taskId}`, // OpenAI-style with /v1
 ];
 
 let workingEndpoint: string | null = null;
 
 logImageJob(job.id, "attempt.poll-plan", {
 label: attempt.label,
 mediaType,
 taskId,
 maxPolls,
 firstPollDelayMs,
 subsequentPollIntervalMs,
 pollTimeoutMs,
 });

 for (let i = 0; i < maxPolls; i++) {
 const pollDelay = i === 0 ? firstPollDelayMs : subsequentPollIntervalMs;
 logImageJob(job.id, "attempt.poll-wait", { 
 label: attempt.label,
 taskId,
 pollAttempt: i + 1,
 waitMs: pollDelay
 });
 await new Promise(resolve => setTimeout(resolve, pollDelay));
 
 // Special case: re-POST to original endpoint
 if (workingEndpoint === "REPOST_ORIGINAL") {
 try {
 const originalUrl = buildEndpoint(job.provider.baseUrl, attempt.endpoint);
 logImageJob(job.id, "attempt.poll", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1, 
 maxPolls,
 taskUrl: originalUrl,
 method: "POST (re-query)"
 });
 
 const response = await fetch(originalUrl, {
 method: "POST",
 headers: { ...headers, "Content-Type": "application/json" },
 body: JSON.stringify({ ...attempt.payload, task_id: taskId }),
 });
 
 if (!response.ok) {
 throw new Error(`Re-POST returned ${response.status}`);
 }
 
 const responseText = await response.text();
 logImageJob(job.id, "attempt.poll-response", {
 label: attempt.label,
 taskId,
 pollAttempt: i + 1,
 responsePreview: sanitizeText(responseText, 800)
 });
 
 const taskResponse = parseJsonOrText(responseText);
 
 if (!taskResponse || typeof taskResponse !== "object") {
 throw new Error("Invalid task response format");
 }
 
 const obj = taskResponse as Record<string, unknown>;
 
 // Check if task is completed
 if (obj.status === "completed" || obj.status === "succeeded" || obj.status === "success") {
 logImageJob(job.id, "attempt.poll-completed", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1,
 responsePreview: sanitizeText(responseText, 500)
 });
 return taskResponse;
 }
 
  // Check if we got a media URL even without completed status
  const mediaUrls = extractMediaUrls(taskResponse, mediaType);
  if (mediaUrls.length > 0) {
  logImageJob(job.id, "attempt.poll-completed", { 
  label: attempt.label,
  mediaType,
  taskId, 
  pollAttempt: i + 1,
  hint: `Found ${mediaType} URL without completed status`,
  responsePreview: sanitizeText(responseText, 500)
  });
 return taskResponse;
 }
 
 // Check if task failed
 if (obj.status === "failed" || obj.status === "error") {
 const errorMsg = typeof obj.error === "string" ? obj.error : typeof obj.message === "string" ? obj.message : "Task failed";
 throw new Error(`${attempt.label ?? attempt.endpoint}: async task failed: ${errorMsg}`);
 }
 
 // Task still processing - only continue if not last attempt
 if (i < maxPolls - 1) {
 logImageJob(job.id, "attempt.poll-pending", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1,
 status: obj.status,
 progress: obj.progress,
 hint: `Will retry after ${subsequentPollIntervalMs}ms (${maxPolls - i - 1} attempts remaining)`
 });
 continue;
 } else {
 // Last attempt and still queued - fail with helpful message
 throw new Error(`${attempt.label ?? attempt.endpoint}: task still queued/processing after ${maxPolls} attempts. Response: ${sanitizeText(responseText, 200)}`);
 }
 } catch (error) {
 throw error;
 }
 }
 
 const endpointsToTry: string[] = workingEndpoint ? [workingEndpoint] : taskEndpoints;
 
 for (const taskPath of endpointsToTry) {
 try {
 const taskUrl = buildEndpoint(job.provider.baseUrl, taskPath);
 logImageJob(job.id, "attempt.poll", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1, 
 maxPolls,
 taskUrl 
 });
 
 const response = await fetch(taskUrl, { headers });
 const responseText = await response.text();
 if (!response.ok) {
 logImageJob(job.id, "attempt.poll-status-error", {
 label: attempt.label,
 taskId,
 pollAttempt: i + 1,
 taskUrl,
 status: response.status,
 statusText: response.statusText,
 responsePreview: sanitizeText(responseText, 500),
 });
 if (workingEndpoint) workingEndpoint = null;
 continue;
 }
 
 const taskResponse = parseJsonOrText(responseText);
 
 if (!taskResponse || typeof taskResponse !== "object") {
 if (!workingEndpoint) continue;
 throw new Error("Invalid task response format");
 }
 
 const obj = taskResponse as Record<string, unknown>;
 
 // Remember this endpoint works
 if (!workingEndpoint) {
 workingEndpoint = taskPath;
 logImageJob(job.id, "attempt.poll-endpoint-found", { 
 label: attempt.label,
 taskId,
 endpoint: taskPath
 });
 }
 
  const taskMediaUrls = extractMediaUrls(taskResponse, mediaType);
  if (taskMediaUrls.length > 0) {
  logImageJob(job.id, "attempt.poll-completed", { 
  label: attempt.label,
  mediaType,
  taskId, 
  pollAttempt: i + 1,
  taskUrl,
  hint: `Found ${mediaType} URL`,
  responsePreview: sanitizeText(responseText, 500)
  });
  return taskResponse;
  }

  // Check if task is completed
  if (obj.status === "completed" || obj.status === "succeeded" || obj.status === "success") {
  const completedResponse = mediaType === "video" && taskMediaUrls.length === 0
    ? addVideoContentUrlCandidate(taskResponse, job.provider.baseUrl, taskId)
    : taskResponse;
  logImageJob(job.id, "attempt.poll-completed", { 
  label: attempt.label,
  mediaType,
  taskId, 
  pollAttempt: i + 1,
  taskUrl,
  responsePreview: sanitizeText(responseText, 500)
  });
  return completedResponse;
  }
 
 // Check if task failed
 if (obj.status === "failed" || obj.status === "error") {
 const errorMsg = typeof obj.error === "string" ? obj.error : typeof obj.message === "string" ? obj.message : "Task failed";
 throw new Error(`${attempt.label ?? attempt.endpoint}: async task failed: ${errorMsg}`);
 }
 
 // Task still processing
 logImageJob(job.id, "attempt.poll-pending", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1,
 status: obj.status,
 progress: obj.progress,
 taskUrl 
 });
 break; // Break inner loop, continue polling
 } catch (error) {
 if (workingEndpoint) {
 logImageJob(job.id, "attempt.poll-working-endpoint-error", {
 label: attempt.label,
 taskId,
 pollAttempt: i + 1,
 endpoint: workingEndpoint,
 ...getErrorDetails(error),
 });
 workingEndpoint = null;
 continue;
 }
 // Try next endpoint
 if (taskPath === endpointsToTry[endpointsToTry.length - 1]) {
 logImageJob(job.id, "attempt.poll-error", { 
 label: attempt.label,
 taskId, 
 pollAttempt: i + 1,
 ...getErrorDetails(error)
 });
 }
 }
 }
 
 if (!workingEndpoint && i === 0) {
 // No standard task endpoint found, try re-posting to original endpoint with task_id
 logImageJob(job.id, "attempt.poll-fallback-repost", { 
 label: attempt.label,
 taskId,
 hint: "No task query endpoint found, will re-POST to original endpoint"
 });
 workingEndpoint = "REPOST_ORIGINAL";
 }
 }
 
 const totalWaitMs = firstPollDelayMs + (maxPolls - 1) * subsequentPollIntervalMs;
 throw new Error(`${attempt.label ?? attempt.endpoint}: async task polling timed out after ${totalWaitMs}ms`);
}

function normalizeEmail(value: unknown) {
  if (typeof value !== "string") return "";
  const email = value.trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function normalizeEmailConfigInput(value: unknown, current: EmailConfig) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const next: EmailConfig = { ...current };

  if (typeof body.enabled === "boolean") next.enabled = body.enabled;
  if (typeof body.host === "string") next.host = body.host.trim();
  if (typeof body.secure === "boolean") next.secure = body.secure;
  if (typeof body.username === "string") next.username = body.username.trim();
  if (typeof body.password === "string" && body.password.length > 0) next.password = body.password;
  if (body.clearPassword === true) next.password = "";
  if (typeof body.fromName === "string") next.fromName = body.fromName.trim();
  if (typeof body.fromEmail === "string") next.fromEmail = body.fromEmail.trim().toLowerCase();
  if (typeof body.subject === "string") next.subject = body.subject.trim();

  const port = Number(body.port);
  if (Number.isFinite(port)) next.port = Math.trunc(port);

  const codeTtlMinutes = Number(body.codeTtlMinutes);
  if (Number.isFinite(codeTtlMinutes)) next.codeTtlMinutes = Math.trunc(codeTtlMinutes);

  if (next.port < 1 || next.port > 65535) throw new Error("SMTP 端口必须在 1 到 65535 之间。");
  if (next.codeTtlMinutes < 1 || next.codeTtlMinutes > 60) throw new Error("验证码有效期必须在 1 到 60 分钟之间。");
  if (next.fromEmail && !normalizeEmail(next.fromEmail)) throw new Error("发件邮箱格式不正确。");
  if (!next.subject) next.subject = DEFAULT_EMAIL_CONFIG.subject;
  if (!next.fromName) next.fromName = DEFAULT_EMAIL_CONFIG.fromName;

  next.updatedAt = Date.now();
  return next;
}

function normalizeEmailConfigFromFile(value: unknown) {
  try {
    const loaded = normalizeEmailConfigInput(value, DEFAULT_EMAIL_CONFIG);
    if (value && typeof value === "object") {
      const updatedAt = (value as Record<string, unknown>).updatedAt;
      if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) loaded.updatedAt = updatedAt;
    }
    return loaded;
  } catch {
    return { ...DEFAULT_EMAIL_CONFIG };
  }
}

function getPublicEmailConfig(): PublicEmailConfig {
  return {
    enabled: emailConfig.enabled,
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    username: emailConfig.username,
    fromName: emailConfig.fromName,
    fromEmail: emailConfig.fromEmail,
    subject: emailConfig.subject,
    codeTtlMinutes: emailConfig.codeTtlMinutes,
    updatedAt: emailConfig.updatedAt,
    hasPassword: Boolean(emailConfig.password),
  };
}

function normalizeStoragePrefix(value: unknown) {
  if (typeof value !== "string") return "";
  const normalized = value
    .trim()
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  return normalized && !normalized.endsWith("/") ? `${normalized}/` : normalized;
}

function normalizeObjectStorageConfigInput(value: unknown, current: ObjectStorageConfig) {
  const body = value && typeof value === "object" ? value as Record<string, unknown> : {};
  const next: ObjectStorageConfig = { ...current };

  if (typeof body.enabled === "boolean") next.enabled = body.enabled;
  if (typeof body.endpoint === "string") next.endpoint = body.endpoint.trim().replace(/\/+$/, "");
  if (typeof body.region === "string") next.region = body.region.trim() || DEFAULT_OBJECT_STORAGE_CONFIG.region;
  if (typeof body.bucket === "string") next.bucket = body.bucket.trim();
  if (typeof body.accessKeyId === "string") next.accessKeyId = body.accessKeyId.trim();
  if (typeof body.secretAccessKey === "string" && body.secretAccessKey.length > 0) next.secretAccessKey = body.secretAccessKey;
  if (body.clearSecretAccessKey === true) next.secretAccessKey = "";
  if (typeof body.publicBaseUrl === "string") next.publicBaseUrl = body.publicBaseUrl.trim().replace(/\/+$/, "");
  if (typeof body.prefix === "string") next.prefix = normalizeStoragePrefix(body.prefix);
  if (typeof body.forcePathStyle === "boolean") next.forcePathStyle = body.forcePathStyle;
  if (typeof body.useBackendProxy === "boolean") next.useBackendProxy = body.useBackendProxy;

  if (next.enabled) {
    const error = getObjectStorageConfigError(next);
    if (error) throw new Error(error);
  }
  next.updatedAt = Date.now();
  return next;
}

function normalizeObjectStorageConfigFromFile(value: unknown) {
  try {
    const loaded = normalizeObjectStorageConfigInput(value, DEFAULT_OBJECT_STORAGE_CONFIG);
    if (value && typeof value === "object") {
      const updatedAt = (value as Record<string, unknown>).updatedAt;
      if (typeof updatedAt === "number" && Number.isFinite(updatedAt)) loaded.updatedAt = updatedAt;
    }
    return loaded;
  } catch {
    return { ...DEFAULT_OBJECT_STORAGE_CONFIG };
  }
}

function getPublicObjectStorageConfig(): PublicObjectStorageConfig {
  return {
    enabled: objectStorageConfig.enabled,
    endpoint: objectStorageConfig.endpoint,
    region: objectStorageConfig.region,
    bucket: objectStorageConfig.bucket,
    accessKeyId: objectStorageConfig.accessKeyId,
    publicBaseUrl: objectStorageConfig.publicBaseUrl,
    prefix: objectStorageConfig.prefix,
    forcePathStyle: objectStorageConfig.forcePathStyle,
    useBackendProxy: objectStorageConfig.useBackendProxy,
    updatedAt: objectStorageConfig.updatedAt,
    hasSecretAccessKey: Boolean(objectStorageConfig.secretAccessKey),
  };
}

function getObjectStorageConfigError(config = objectStorageConfig) {
  if (!config.endpoint) return "请填写对象存储 Endpoint。";
  if (!config.region) return "请填写对象存储 Region。";
  if (!config.bucket) return "请填写 Bucket。";
  if (!config.accessKeyId) return "请填写 Access Key ID。";
  if (!config.secretAccessKey) return "请填写 Secret Access Key。";
  return "";
}

async function assertObjectStorageReady() {
  if (!objectStorageConfig.enabled) throw new Error("对象存储尚未启用。");
  const error = getObjectStorageConfigError();
  if (error) throw new Error(error);
}

function createObjectStorageClient() {
  return new S3Client({
    region: objectStorageConfig.region || DEFAULT_OBJECT_STORAGE_CONFIG.region,
    endpoint: objectStorageConfig.endpoint,
    forcePathStyle: objectStorageConfig.forcePathStyle,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: objectStorageConfig.accessKeyId,
      secretAccessKey: objectStorageConfig.secretAccessKey,
    },
  });
}

function isObjectStorageEnabled() {
  return objectStorageConfig.enabled && !getObjectStorageConfigError();
}

function createStorageSafeFileName(fileName: string, fallbackExtension: string) {
  const extension = extname(fileName) || fallbackExtension;
  const baseName = basename(fileName, extname(fileName))
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80) || "asset";
  return `${baseName}-${createId("obj")}${extension}`;
}

function buildObjectStorageKey(directory: string, fileName: string) {
  const safeDirectory = directory
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .replace(/[^a-zA-Z0-9/_-]+/g, "-")
    .replace(/\/{2,}/g, "/");
  return `${objectStorageConfig.prefix}${safeDirectory ? `${safeDirectory}/` : ""}${fileName}`.replace(/^\/+/, "");
}

function publicUrlForObjectKey(key: string) {
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  const proxyPath = `/api/storage/object?key=${encodeURIComponent(key)}`;
  if (objectStorageConfig.useBackendProxy) return PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${proxyPath}` : proxyPath;
  if (objectStorageConfig.publicBaseUrl) return `${objectStorageConfig.publicBaseUrl}/${encodedKey}`;
  try {
    const endpoint = new URL(objectStorageConfig.endpoint);
    return `${endpoint.protocol}//${objectStorageConfig.bucket}.${endpoint.host}/${encodedKey}`;
  } catch {
    return PUBLIC_BASE_URL ? `${PUBLIC_BASE_URL}${proxyPath}` : proxyPath;
  }
}

function objectStorageKeyFromUrl(url?: string) {
  if (!url) return "";
  if (!objectStorageConfig.bucket) return "";
  const tryDecodePath = (value: string) => decodeURIComponent(value.replace(/^\/+/, ""));
  try {
    const parsed = new URL(url);
    if (parsed.pathname === "/api/storage/object" && parsed.searchParams.get("key")) {
      return parsed.searchParams.get("key") ?? "";
    }
    if (objectStorageConfig.publicBaseUrl) {
      const publicBase = new URL(objectStorageConfig.publicBaseUrl);
      const basePath = publicBase.pathname.replace(/\/+$/, "");
      if (parsed.origin === publicBase.origin && (!basePath || parsed.pathname.startsWith(`${basePath}/`))) {
        return tryDecodePath(basePath ? parsed.pathname.slice(basePath.length + 1) : parsed.pathname);
      }
    }
    const endpoint = new URL(objectStorageConfig.endpoint);
    if (parsed.host === `${objectStorageConfig.bucket}.${endpoint.host}`) return tryDecodePath(parsed.pathname);
    if (parsed.host === endpoint.host && parsed.pathname.startsWith(`/${objectStorageConfig.bucket}/`)) {
      return tryDecodePath(parsed.pathname.slice(objectStorageConfig.bucket.length + 2));
    }
  } catch {
    return "";
  }
  return "";
}

function normalizeObjectStorageResultUrl(url?: string) {
  const objectKey = objectStorageKeyFromUrl(url);
  return objectKey ? publicUrlForObjectKey(objectKey) : url;
}

function pipeObjectStorageBody(body: unknown, response: express.Response) {
  if (!body) {
    response.end();
    return;
  }
  if (body instanceof Uint8Array) {
    response.end(Buffer.from(body));
    return;
  }
  if (typeof (body as { pipe?: unknown }).pipe === "function") {
    (body as NodeJS.ReadableStream).pipe(response);
    return;
  }
  if (typeof ReadableStream !== "undefined" && body instanceof ReadableStream) {
    Readable.fromWeb(body as any).pipe(response);
    return;
  }
  response.end(String(body));
}

async function putObjectStorageObject(input: { key: string; body: Buffer | Readable; contentType?: string; contentLength?: number }) {
  await assertObjectStorageReady();
  await createObjectStorageClient().send(new PutObjectCommand({
    Bucket: objectStorageConfig.bucket,
    Key: input.key,
    Body: input.body,
    ContentType: input.contentType || "application/octet-stream",
    ...(input.contentLength !== undefined ? { ContentLength: input.contentLength } : {}),
  }));
  return publicUrlForObjectKey(input.key);
}

async function deleteObjectStorageKey(key: string) {
  await assertObjectStorageReady();
  await createObjectStorageClient().send(new DeleteObjectCommand({
    Bucket: objectStorageConfig.bucket,
    Key: key,
  }));
}

function getEmailConfigError() {
  if (!emailConfig.enabled) return "邮箱服务尚未启用，请先在后台邮箱配置中启用。";
  if (!emailConfig.host) return "请先配置 SMTP 服务器地址。";
  if (!emailConfig.port) return "请先配置 SMTP 端口。";
  if (!normalizeEmail(emailConfig.fromEmail)) return "请先配置有效的发件邮箱。";
  if ((emailConfig.username && !emailConfig.password) || (!emailConfig.username && emailConfig.password)) {
    return "SMTP 用户名和密码需要同时填写。";
  }
  return "";
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatEmailAddress(name: string, email: string) {
  const safeName = name.replace(/[\r\n"]/g, "").trim();
  const safeEmail = email.replace(/[\r\n<>]/g, "").trim();
  return safeName ? `"${safeName}" <${safeEmail}>` : safeEmail;
}

function generateEmailCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

function getEmailVerificationKey(purpose: EmailVerificationPurpose, email: string) {
  return `${purpose}:${email}`;
}

function hashEmailVerificationCode(purpose: EmailVerificationPurpose, email: string, code: string) {
  return createHash("sha256").update(`${purpose}:${email}:${code}`).digest("hex");
}

function buildVerificationEmail(code: string, purpose: "register" | "test") {
  const minutes = Math.max(1, emailConfig.codeTtlMinutes);
  const title = purpose === "test" ? "邮箱配置测试" : "注册验证码";
  const text = `${title}\n\n验证码：${code}\n有效期：${minutes} 分钟\n\n如果不是你本人操作，请忽略这封邮件。`;
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.6;color:#111827">
      <h2 style="margin:0 0 16px">${escapeHtml(title)}</h2>
      <p style="margin:0 0 12px">你的验证码是：</p>
      <div style="display:inline-block;letter-spacing:6px;font-size:28px;font-weight:700;background:#f3f4f6;border-radius:10px;padding:12px 18px">${escapeHtml(code)}</div>
      <p style="margin:16px 0 0;color:#6b7280">验证码 ${minutes} 分钟内有效。如果不是你本人操作，请忽略这封邮件。</p>
    </div>
  `;
  return { text, html };
}

async function sendVerificationEmail(email: string, code: string, purpose: "register" | "test") {
  const configError = getEmailConfigError();
  if (configError) throw new Error(configError);

  const transport = nodemailer.createTransport({
    host: emailConfig.host,
    port: emailConfig.port,
    secure: emailConfig.secure,
    auth: emailConfig.username ? { user: emailConfig.username, pass: emailConfig.password } : undefined,
  });
  const content = buildVerificationEmail(code, purpose);
  await transport.sendMail({
    from: formatEmailAddress(emailConfig.fromName, emailConfig.fromEmail),
    to: email,
    subject: emailConfig.subject || DEFAULT_EMAIL_CONFIG.subject,
    text: content.text,
    html: content.html,
  });
}

function cleanupExpiredEmailVerificationRecords() {
  const now = Date.now();
  for (const [key, record] of emailVerificationRecords.entries()) {
    if (record.expiresAt <= now) emailVerificationRecords.delete(key);
  }
}

function normalizeStyleCategory(input: unknown, index: number): StyleCategory | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<StyleCategory>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  if (!name) return null;
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createId("style-cat"),
    name,
    order: typeof raw.order === "number" && Number.isFinite(raw.order) ? raw.order : index,
  };
}

function normalizeStylePreset(input: unknown): StylePreset | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Partial<StylePreset>;
  const name = typeof raw.name === "string" ? raw.name.trim() : "";
  const coverImageUrl = typeof raw.coverImageUrl === "string" ? raw.coverImageUrl.trim() : "";
  if (!name || !coverImageUrl) return null;
  const now = Date.now();
  return {
    id: typeof raw.id === "string" && raw.id.trim() ? raw.id.trim() : createId("style"),
    name,
    categoryIds: Array.isArray(raw.categoryIds) ? raw.categoryIds.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [],
    coverImageUrl,
    sampleImageUrls: Array.isArray(raw.sampleImageUrls) ? raw.sampleImageUrls.filter((value): value is string => typeof value === "string" && Boolean(value.trim())) : [],
    prompt: typeof raw.prompt === "string" ? raw.prompt.trim() : "",
    strength: typeof raw.strength === "number" && Number.isFinite(raw.strength) ? Math.max(0, Math.min(1, raw.strength)) : 0.65,
    isNew: raw.isNew === true,
    isActive: raw.isActive !== false,
    source: raw.source === "custom" ? "custom" : "preset",
    createdAt: typeof raw.createdAt === "number" ? raw.createdAt : now,
    updatedAt: typeof raw.updatedAt === "number" ? raw.updatedAt : now,
  };
}

function normalizeStyleLibraryFromFile(input: unknown): StyleLibrary {
  const raw = input && typeof input === "object" ? input as Partial<StyleLibrary> : {};
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map(normalizeStyleCategory).filter((item): item is StyleCategory => Boolean(item))
    : [];
  const styles = Array.isArray(raw.styles)
    ? raw.styles.map(normalizeStylePreset).filter((item): item is StylePreset => Boolean(item))
    : [];

  return {
    categories: categories.length ? categories : DEFAULT_STYLE_LIBRARY.categories,
    styles: styles.length ? styles : DEFAULT_STYLE_LIBRARY.styles,
  };
}

function normalizeReferenceRole(value: unknown): ReferenceRole {
  return value === "character" || value === "scene" || value === "object" || value === "general" ? value : "general";
}

function normalizeReferenceSettings(input: unknown): ReferenceSettings {
  const raw = input && typeof input === "object" ? input as Partial<ReferenceSettings> : {};
  const rawPrompts = raw.rolePrompts && typeof raw.rolePrompts === "object"
    ? raw.rolePrompts as Partial<Record<ReferenceRole, unknown>>
    : {};
  return {
    visionModelValue: typeof raw.visionModelValue === "string" ? raw.visionModelValue : DEFAULT_REFERENCE_SETTINGS.visionModelValue,
    classificationPrompt: typeof raw.classificationPrompt === "string" && raw.classificationPrompt.trim()
      ? raw.classificationPrompt
      : DEFAULT_REFERENCE_SETTINGS.classificationPrompt,
    rolePrompts: {
      character: typeof rawPrompts.character === "string" && rawPrompts.character.trim() ? rawPrompts.character : DEFAULT_REFERENCE_SETTINGS.rolePrompts.character,
      scene: typeof rawPrompts.scene === "string" && rawPrompts.scene.trim() ? rawPrompts.scene : DEFAULT_REFERENCE_SETTINGS.rolePrompts.scene,
      object: typeof rawPrompts.object === "string" && rawPrompts.object.trim() ? rawPrompts.object : DEFAULT_REFERENCE_SETTINGS.rolePrompts.object,
      general: typeof rawPrompts.general === "string" && rawPrompts.general.trim() ? rawPrompts.general : DEFAULT_REFERENCE_SETTINGS.rolePrompts.general,
    },
  };
}

function getReferenceSettings() {
  const saved = appState.get(REFERENCE_SETTINGS_KEY);
  if (!saved) return DEFAULT_REFERENCE_SETTINGS;
  try {
    return normalizeReferenceSettings(JSON.parse(saved));
  } catch {
    return DEFAULT_REFERENCE_SETTINGS;
  }
}

function parseReferenceClassification(content: string) {
  const fallback = { role: "general" as ReferenceRole, confidence: 0 };
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  try {
    const raw = JSON.parse(jsonMatch?.[0] ?? content) as Record<string, unknown>;
    const confidence = typeof raw.confidence === "number" && Number.isFinite(raw.confidence)
      ? Math.max(0, Math.min(1, raw.confidence))
      : 0.5;
    return { role: normalizeReferenceRole(raw.role), confidence };
  } catch {
    const lower = content.toLowerCase();
    if (lower.includes("character")) return { role: "character" as ReferenceRole, confidence: 0.4 };
    if (lower.includes("scene")) return { role: "scene" as ReferenceRole, confidence: 0.4 };
    if (lower.includes("object")) return { role: "object" as ReferenceRole, confidence: 0.4 };
    return fallback;
  }
}

async function ensureDataFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
  try {
    const raw = await readFile(JOBS_FILE, "utf8");
    const savedJobs = JSON.parse(raw) as ImageJob[];
    for (const job of savedJobs) jobs.set(job.id, job);
  } catch {
    await writeFile(JOBS_FILE, "[]", "utf8");
  }

  try {
    const raw = await readFile(APP_STATE_FILE, "utf8");
    const savedState = JSON.parse(raw) as Record<string, string>;
    for (const [key, value] of Object.entries(savedState)) {
      if (typeof value === "string") appState.set(key, value);
    }
  } catch {
    await writeFile(APP_STATE_FILE, "{}", "utf8");
  }

  try {
    const raw = await readFile(AGENTS_FILE, "utf8");
    const savedAgents = JSON.parse(raw) as Agent[];
    for (const agent of savedAgents) agents.set(agent.id, agent);
  } catch {
    await writeFile(AGENTS_FILE, "[]", "utf8");
  }

  try {
    const raw = await readFile(EMAIL_CONFIG_FILE, "utf8");
    emailConfig = normalizeEmailConfigFromFile(JSON.parse(raw));
  } catch {
    emailConfig = { ...DEFAULT_EMAIL_CONFIG };
    await writeFile(EMAIL_CONFIG_FILE, JSON.stringify(emailConfig, null, 2), "utf8");
  }

  try {
    const raw = await readFile(STORAGE_CONFIG_FILE, "utf8");
    objectStorageConfig = normalizeObjectStorageConfigFromFile(JSON.parse(raw));
  } catch {
    objectStorageConfig = { ...DEFAULT_OBJECT_STORAGE_CONFIG };
    await writeFile(STORAGE_CONFIG_FILE, JSON.stringify(objectStorageConfig, null, 2), "utf8");
  }

  try {
    const raw = await readFile(STYLE_LIBRARY_FILE, "utf8");
    styleLibrary = normalizeStyleLibraryFromFile(JSON.parse(raw));
  } catch {
    styleLibrary = DEFAULT_STYLE_LIBRARY;
    await writeFile(STYLE_LIBRARY_FILE, JSON.stringify(styleLibrary, null, 2), "utf8");
  }
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function sanitizeJobForPersistence(value: unknown): unknown {
  if (typeof value === "string") {
    if (/^data:image\//i.test(value)) return `<data-image omitted length=${value.length}>`;
    if (/^data:video\//i.test(value)) return `<data-video omitted length=${value.length}>`;
    return value;
  }
  if (Array.isArray(value)) return value.map(sanitizeJobForPersistence);
  if (!value || typeof value !== "object") return value;

  const output: Record<string, unknown> = {};
  for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
    output[key] = sanitizeJobForPersistence(nestedValue);
  }
  return output;
}

function saveJobsSoon() {
  saveChain = saveChain.then(async () => {
    await mkdir(dirname(JOBS_FILE), { recursive: true });
    const tempFile = `${JOBS_FILE}.tmp`;
    const persistedJobs = Array.from(jobs.values()).map((job) => sanitizeJobForPersistence(job));
    await writeFile(tempFile, JSON.stringify(persistedJobs, null, 2), "utf8");
    await rename(tempFile, JOBS_FILE);
  }).catch((error) => {
    console.error("[jobs] failed to save jobs", error);
  });
  return saveChain;
}

function saveAppStateSoon() {
  appStateSaveChain = appStateSaveChain.then(async () => {
    await mkdir(dirname(APP_STATE_FILE), { recursive: true });
    const tempFile = `${APP_STATE_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(Object.fromEntries(appState.entries()), null, 2), "utf8");
    await rename(tempFile, APP_STATE_FILE);
  }).catch((error) => {
    console.error("[app-state] failed to save state", error);
  });
  return appStateSaveChain;
}

function saveAgentsSoon() {
  agentsSaveChain = agentsSaveChain.then(async () => {
    await mkdir(dirname(AGENTS_FILE), { recursive: true });
    const tempFile = `${AGENTS_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(Array.from(agents.values()), null, 2), "utf8");
    await rename(tempFile, AGENTS_FILE);
  }).catch((error) => {
    console.error("[agents] failed to save agents", error);
  });
  return agentsSaveChain;
}

function saveEmailConfigSoon() {
  emailConfigSaveChain = emailConfigSaveChain.then(async () => {
    await mkdir(dirname(EMAIL_CONFIG_FILE), { recursive: true });
    const tempFile = `${EMAIL_CONFIG_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(emailConfig, null, 2), "utf8");
    await rename(tempFile, EMAIL_CONFIG_FILE);
  }).catch((error) => {
    console.error("[email-config] failed to save config", error);
  });
  return emailConfigSaveChain;
}

function saveObjectStorageConfigSoon() {
  storageConfigSaveChain = storageConfigSaveChain.then(async () => {
    await mkdir(dirname(STORAGE_CONFIG_FILE), { recursive: true });
    const tempFile = `${STORAGE_CONFIG_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(objectStorageConfig, null, 2), "utf8");
    await rename(tempFile, STORAGE_CONFIG_FILE);
  }).catch((error) => {
    console.error("[storage-config] failed to save config", error);
  });
  return storageConfigSaveChain;
}

function saveStyleLibrarySoon() {
  styleLibrarySaveChain = styleLibrarySaveChain.then(async () => {
    await mkdir(dirname(STYLE_LIBRARY_FILE), { recursive: true });
    const tempFile = `${STYLE_LIBRARY_FILE}.tmp`;
    await writeFile(tempFile, JSON.stringify(styleLibrary, null, 2), "utf8");
    await rename(tempFile, STYLE_LIBRARY_FILE);
  }).catch((error) => {
    console.error("[style-library] failed to save library", error);
  });
  return styleLibrarySaveChain;
}

function publicUrlForUpload(fileName: string) {
  return `/uploads/${fileName}`;
}

async function saveLocalUploadFile(fileName: string, buffer: Buffer) {
  await mkdir(UPLOADS_DIR, { recursive: true });
  await writeFile(join(UPLOADS_DIR, fileName), buffer);
  return publicUrlForUpload(fileName);
}

function getImageJobTimeoutMs(job?: ImageJob) {
  return job && getJobMediaType(job) === "video" ? VIDEO_JOB_REQUEST_TIMEOUT_MS : IMAGE_JOB_REQUEST_TIMEOUT_MS;
}

function getImageJobTimeoutMessage(job?: ImageJob) {
  const mediaType = job && getJobMediaType(job) === "video" ? "Video" : "Image";
  return `${mediaType} generation timed out after ${Math.round(getImageJobTimeoutMs(job) / 1000)}s.`;
}

function isActiveImageJob(job: ImageJob) {
  return job.status === "queued" || job.status === "running";
}

function markImageJobTimedOutIfStale(jobId: string, job: ImageJob, now = Date.now()) {
  const timeoutMs = getImageJobTimeoutMs(job);
  if (!isActiveImageJob(job) || timeoutMs <= 0) return false;
  if (now - job.createdAt < timeoutMs) return false;

  const error = getImageJobTimeoutMessage(job);
  jobs.set(jobId, { ...job, status: "failed", error, updatedAt: now });
  logImageJob(jobId, "job.timeout", { error, ageMs: now - job.createdAt });
  void saveJobsSoon();
  return true;
}

function uploadPathFromResultUrl(resultUrl?: string) {
  if (!resultUrl?.startsWith("/uploads/")) return null;
  return join(UPLOADS_DIR, decodeURIComponent(resultUrl.replace("/uploads/", "")));
}

async function deleteJobAsset(job: ImageJob) {
  const uploadPath = uploadPathFromResultUrl(job.resultUrl);
  if (uploadPath) {
    await rm(uploadPath, { force: true });
    return;
  }
  const objectKey = objectStorageKeyFromUrl(job.resultUrl);
  if (objectKey && isObjectStorageEnabled()) await deleteObjectStorageKey(objectKey);
}

function getErrorDetails(error: unknown) {
  const details: Record<string, unknown> = {
    error: error instanceof Error ? error.message : String(error),
  };
  const code = error && typeof error === "object" ? (error as { code?: unknown }).code : undefined;
  if (typeof code === "string") details.code = code;
  const cause = error instanceof Error && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof Error) {
    details.cause = cause.message;
    details.causeName = cause.name;
    const causeCode = (cause as { code?: unknown }).code;
    if (typeof causeCode === "string") details.causeCode = causeCode;
  } else if (cause) {
    details.cause = String(cause);
  }
  return details;
}

async function cleanupExpiredJobs() {
  const now = Date.now();
  let changed = false;
  for (const [jobId, job] of jobs.entries()) {
    if (markImageJobTimedOutIfStale(jobId, job, now)) {
      changed = true;
      continue;
    }

    const retentionMs = job.status === "completed" ? COMPLETED_JOB_RETENTION_MS : job.status === "failed" ? FAILED_JOB_RETENTION_MS : undefined;
    if (!retentionMs) continue;
    if (now - job.updatedAt < retentionMs) continue;
    await deleteJobAsset(job).catch((error) => console.warn("[jobs] failed to delete expired asset", { jobId, error }));
    jobs.delete(jobId);
    changed = true;
  }
  if (changed) await saveJobsSoon();
}

async function saveMediaResult(jobId: string, mediaUrl: string, mediaType: MediaJobType, authKey?: string) {
  const dataUrlPattern = mediaType === "video" ? /^data:video\//i : /^data:image\//i;
  if (dataUrlPattern.test(mediaUrl)) {
    const parsed = parseDataUrl(mediaUrl);
    if (!parsed) throw new Error(`Invalid data URL ${mediaType} result`);
    const extension = mediaExtensionFromContentType(mediaType, parsed.mimeType);
    const fileName = `${jobId}.${extension}`;
    const buffer = Buffer.from(parsed.data, "base64");
    if (isObjectStorageEnabled()) {
      return putObjectStorageObject({
        key: buildObjectStorageKey(mediaType === "video" ? "generated/videos" : "generated/images", fileName),
        body: buffer,
        contentType: parsed.mimeType,
      });
    }
    return saveLocalUploadFile(fileName, buffer);
  }

  const startedAt = Date.now();
  let response: Response;
  try {
    const headers: Record<string, string> = {
      Accept: mediaType === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
    };
    if (authKey) {
      headers.Authorization = `Bearer ${authKey}`;
    }
    response = await fetch(mediaUrl, { headers });
  } catch (error) {
    logImageJob(jobId, "asset.download.error", {
      mediaType,
      durationMs: Date.now() - startedAt,
      mediaUrl,
      ...getErrorDetails(error),
    });
    throw error;
  }
  logImageJob(jobId, "asset.download.response", {
    mediaType,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    durationMs: Date.now() - startedAt,
    mediaUrl,
  });
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download generated ${mediaType}: ${response.status}`);
  }
  const contentType = response.headers.get("content-type") || "";
  if (contentType.includes("text/html")) {
    throw new Error(`${mediaType} URL returned HTML (likely auth/login page). Check provider credentials or URL signature.`);
  }
  if (mediaType === "video" && contentType && !isVideoContentType(contentType)) {
    logImageJob(jobId, "asset.download.content-type-warning", { mediaType, contentType, mediaUrl });
  }

  let pathExtension = "mp4";
  try {
    pathExtension = extname(new URL(mediaUrl).pathname).replace(/^\./, "") || pathExtension;
  } catch {
    pathExtension = mediaType === "video" ? "mp4" : "png";
  }
  const extension = mediaExtensionFromContentType(mediaType, response.headers.get("content-type")) || pathExtension || (mediaType === "video" ? "mp4" : "png");
  const fileName = `${jobId}.${extension}`;
  const contentLengthHeader = response.headers.get("content-length");
  const contentLength = contentLengthHeader ? Number(contentLengthHeader) : undefined;
  if (isObjectStorageEnabled()) {
    const normalizedContentLength = Number.isFinite(contentLength) && contentLength && contentLength > 0 ? contentLength : undefined;
    return putObjectStorageObject({
      key: buildObjectStorageKey(mediaType === "video" ? "generated/videos" : "generated/images", fileName),
      body: Readable.fromWeb(response.body as any),
      contentType: response.headers.get("content-type") || undefined,
      contentLength: normalizedContentLength,
    });
  }
  await pipeline(Readable.fromWeb(response.body as any), createWriteStream(join(UPLOADS_DIR, fileName)));
  return publicUrlForUpload(fileName);
}

async function saveImageResult(jobId: string, imageUrl: string, authKey?: string) {
  return saveMediaResult(jobId, imageUrl, "image", authKey);
}

async function saveMediaResultOrFallback(jobId: string, mediaUrl: string, mediaType: MediaJobType, authKey?: string, taskId?: string, baseUrl?: string, taskResponse?: unknown, details: Record<string, unknown> = {}) {
  try {
    const localUrl = await saveMediaResult(jobId, mediaUrl, mediaType, authKey);
    logImageJob(jobId, "asset.save.done", { mediaType, localUrl, ...details });
    return localUrl;
  } catch (error) {
    // If signed URL failed with HTML response and we have task response, extract a fresh URL from it.
    if (taskResponse && error instanceof Error && error.message.includes("HTML")) {
      try {
        const signedUrls = extractMediaUrls(taskResponse, mediaType);
        if (signedUrls.length > 0) {
          const signedUrl = absolutizeUpstreamMediaUrl(signedUrls[0], baseUrl || "");
          logImageJob(jobId, "asset.retry-signed-url", {
            mediaType,
            originalUrl: mediaUrl,
            signedUrl,
            hint: "Original URL returned HTML, retrying with signed URL from task response"
          });
          // Don't pass authKey for signed URLs - they use signature authentication.
          const localUrl = await saveMediaResult(jobId, signedUrl, mediaType, undefined);
          logImageJob(jobId, "asset.save.done", { mediaType, localUrl, ...details, retriedWithSignedUrl: true });
          return localUrl;
        }
      } catch (retryError) {
        // Signed URL also failed, fall through to original fallback.
      }
    }

    if (!/^https?:\/\//i.test(mediaUrl)) throw error;
    logImageJob(jobId, "asset.save.fallback", {
      mediaType,
      mediaUrl,
      ...details,
      ...getErrorDetails(error),
      fallbackUrl: mediaUrl,
    });
    return mediaUrl;
  }
}

async function saveImageResultOrFallback(jobId: string, imageUrl: string, authKey?: string, taskId?: string, baseUrl?: string, taskResponse?: unknown, details: Record<string, unknown> = {}) {
  return saveMediaResultOrFallback(jobId, imageUrl, "image", authKey, taskId, baseUrl, taskResponse, details);
}

function updateJob(jobId: string, updates: Partial<ImageJob>) {
  const job = jobs.get(jobId);
  if (!job) return;
  jobs.set(jobId, { ...job, ...updates, updatedAt: Date.now() });
  void saveJobsSoon();
}

function getJobMediaType(job: ImageJob): MediaJobType {
  return job.request.mediaType ?? "image";
}

function getTextFromMessageContent(content: unknown): string | undefined {
  if (typeof content === "string" && content.trim()) return content;
  if (!Array.isArray(content)) return undefined;

  for (const part of content) {
    if (!part || typeof part !== "object") continue;
    const record = part as Record<string, unknown>;
    if (typeof record.text === "string" && record.text.trim()) return record.text;
  }

  return undefined;
}

function getPromptFromPayload(payload: Record<string, unknown>) {
  if (typeof payload.prompt === "string" && payload.prompt.trim()) return payload.prompt;
  if (typeof payload.input === "string" && payload.input.trim()) return payload.input;

  if (Array.isArray(payload.messages)) {
    for (const message of [...payload.messages].reverse()) {
      if (!message || typeof message !== "object") continue;
      const record = message as Record<string, unknown>;
      const text = getTextFromMessageContent(record.content);
      if (text) return text;
    }
  }

  return undefined;
}

function getFirstPayloadValue(job: ImageJob, key: string) {
  const payloads = [job.request.payload, ...getImageJobAttempts(job).map((attempt) => attempt.payload)];
  for (const payload of payloads) {
    const value = payload[key];
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function getJobRecoveryMetadata(job: ImageJob) {
  const payloads = [job.request.payload, ...getImageJobAttempts(job).map((attempt) => attempt.payload)];
  let prompt: string | undefined;
  for (const payload of payloads) {
    prompt = getPromptFromPayload(payload);
    if (prompt) break;
  }

  const model = getFirstPayloadValue(job, "model");
  const size = getFirstPayloadValue(job, "size");
  const duration = getFirstPayloadValue(job, "duration");

  return {
    endpoint: job.request.endpoint,
    prompt,
    model: typeof model === "string" ? model : model === undefined ? undefined : String(model),
    size: typeof size === "string" ? size : size === undefined ? undefined : String(size),
    duration: typeof duration === "number" || typeof duration === "string" ? duration : undefined,
    providerId: job.provider.id,
    providerName: job.provider.name,
  };
}

function getJobResponse(job: ImageJob) {
  const resultUrl = normalizeObjectStorageResultUrl(job.resultUrl);
  return {
    id: job.id,
    status: job.status,
    mediaType: getJobMediaType(job),
    createdAt: job.createdAt,
    updatedAt: job.updatedAt,
    resultUrl,
    upstreamUrl: job.upstreamUrl,
    error: job.error,
  };
}

function getRecoverableJobResponse(job: ImageJob) {
  return {
    ...getJobResponse(job),
    request: getJobRecoveryMetadata(job),
  };
}

function redactLogLine(line: string) {
  return line
    .replace(/(authorization["']?\s*[:=]\s*["']?Bearer\s+)[^"',\s}]+/gi, "$1<redacted>")
    .replace(/((?:api[-_ ]?key|access[-_ ]?token|refresh[-_ ]?token|cookie|password|secret)["']?\s*[:=]\s*["']?)[^"',\s}]+/gi, "$1<redacted>")
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/=-]{16,}/g, "$1<redacted>");
}

async function readLogTail(filePath: string, maxLines: number, query = "") {
  try {
    const stats = await stat(filePath);
    const maxBytes = 1024 * 1024 * 4;
    const raw = await readFile(filePath, "utf8");
    const clipped = raw.length > maxBytes ? raw.slice(raw.length - maxBytes) : raw;
    const normalizedQuery = query.trim().toLowerCase();
    const lines = clipped
      .split(/\r?\n/)
      .filter((line) => line.length > 0)
      .filter((line) => !normalizedQuery || line.toLowerCase().includes(normalizedQuery));
    return {
      lines: lines.slice(-maxLines).map(redactLogLine),
      size: stats.size,
      updatedAt: stats.mtimeMs,
      truncated: raw.length > maxBytes || lines.length > maxLines,
      query: normalizedQuery,
    };
  } catch (error) {
    if (error && typeof error === "object" && (error as NodeJS.ErrnoException).code === "ENOENT") {
      return { lines: [], size: 0, updatedAt: 0, truncated: false, query };
    }
    throw error;
  }
}

function scheduleJob(jobId: string) {
  if (pendingQueue.includes(jobId)) return;
  pendingQueue.push(jobId);
  logImageJob(jobId, "queue.add", { queueLength: pendingQueue.length, runningJobs });
  void runNextJobs();
}

async function recoverPersistedActiveJobs() {
  let recovered = 0;
  let changed = false;
  for (const [jobId, job] of jobs.entries()) {
    if (!isActiveImageJob(job)) continue;
    if (markImageJobTimedOutIfStale(jobId, job)) {
      changed = true;
      continue;
    }

    if (job.status === "running") {
      jobs.set(jobId, { ...job, status: "queued", updatedAt: Date.now() });
      logImageJob(jobId, "queue.recover-running", {
        mediaType: getJobMediaType(job),
        previousUpdatedAt: job.updatedAt,
      });
      changed = true;
    } else {
      logImageJob(jobId, "queue.recover-queued", {
        mediaType: getJobMediaType(job),
        previousUpdatedAt: job.updatedAt,
      });
    }

    recovered += 1;
    scheduleJob(jobId);
  }

  if (changed) await saveJobsSoon();
  if (recovered > 0) {
    console.log(`[jobs] recovered ${recovered} active job(s) into the queue`);
  }
}

async function runNextJobs() {
  while (runningJobs < MAX_CONCURRENT_JOBS && pendingQueue.length > 0) {
    const jobId = pendingQueue.shift();
    if (!jobId) return;
    const job = jobs.get(jobId);
    if (job && markImageJobTimedOutIfStale(jobId, job)) continue;
    if (!job || job.status !== "queued") continue;
    runningJobs += 1;
    logImageJob(jobId, "queue.start", { runningJobs, queueLength: pendingQueue.length });
    void runImageJob(jobId)
      .catch((error) => {
        console.error("[jobs] image job crashed", { jobId, error });
        logImageJob(jobId, "job.failed", { error: error instanceof Error ? error.message : String(error) });
        updateJob(jobId, { status: "failed", error: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        runningJobs -= 1;
        logImageJob(jobId, "queue.finish", { runningJobs, queueLength: pendingQueue.length });
        void runNextJobs();
      });
  }
}

async function buildFormData(attempt: ImageJobAttempt) {
  const formData = new FormData();
  for (const [key, value] of Object.entries(attempt.payload)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value) || typeof value === "object") {
      formData.append(key, JSON.stringify(value));
    } else {
      formData.append(key, String(value));
    }
  }

  for (const [index, imageUrl] of (attempt.referenceImages ?? []).entries()) {
    let blob: Blob;
    if (/^data:/i.test(imageUrl)) {
      const parsed = parseDataUrl(imageUrl);
      if (!parsed) continue;
      blob = new Blob([Buffer.from(parsed.data, "base64")], { type: parsed.mimeType });
    } else {
      const response = await fetch(imageUrl, { headers: { Accept: "image/*,*/*;q=0.8" } });
      if (!response.ok) throw new Error(`Failed to fetch reference image: ${response.status}`);
      blob = await response.blob();
    }
    formData.append("image", blob, `reference-${index + 1}.${imageExtensionFromContentType(blob.type)}`);
  }
  return formData;
}

class ImageJobAttemptError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
    readonly responseText?: string
  ) {
    super(message);
    this.name = "ImageJobAttemptError";
  }
}

class UpstreamLogLookupError extends Error {
  constructor(message: string, readonly terminal = false) {
    super(message);
    this.name = "UpstreamLogLookupError";
  }
}

function parseJsonOrText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function buildLogSearchUrl(baseUrl: string, requestId: string) {
  const base = normalizeBaseUrl(baseUrl).replace(/\/v\d+(?:beta\d+)?$/i, "");
  const params = new URLSearchParams({
    p: "1",
    page_size: "10",
    type: "0",
    start_timestamp: String(Math.floor((Date.now() - 24 * 60 * 60 * 1000) / 1000)),
    end_timestamp: String(Math.floor((Date.now() + 60 * 60 * 1000) / 1000)),
    request_id: requestId,
  });
  return `${base}/api/log/self/?${params.toString()}`;
}

function getMessageFromPayload(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const record = value as Record<string, unknown>;
  if (typeof record.message === "string") return record.message;
  if (typeof record.error === "string") return record.error;
  if (record.error && typeof record.error === "object") {
    const nested = record.error as Record<string, unknown>;
    if (typeof nested.message === "string") return nested.message;
  }
  return "";
}

function isUnauthorizedLogPayload(status: number, payload: unknown) {
  const message = getMessageFromPayload(payload);
  return status === 401 || status === 403 || /unauthorized|invalid access token|未授权|无权限/i.test(message);
}

function getUpstreamLogAccessToken(job: ImageJob) {
  return job.provider.logAccessToken?.trim() || UPSTREAM_LOG_ACCESS_TOKEN || job.provider.key;
}

function getLogAuthHint(job: ImageJob) {
  const hasDedicatedToken = Boolean(job.provider.logAccessToken?.trim() || UPSTREAM_LOG_ACCESS_TOKEN);
  if (hasDedicatedToken) {
    return "Upstream log lookup was unauthorized; check the configured log access token.";
  }
  return "Upstream log lookup was unauthorized. The generation API key can submit images, but this log endpoint appears to require a dashboard/log access token. Configure provider.logAccessToken or IMAGE_JOB_LOG_ACCESS_TOKEN if you want automatic 524 recovery.";
}

async function fetchUpstreamLogPayload(job: ImageJob, requestId: string) {
  const url = buildLogSearchUrl(job.provider.baseUrl, requestId);
  const headers: Record<string, string> = {
    Accept: "application/json",
  };
  const accessToken = getUpstreamLogAccessToken(job);
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  if (UPSTREAM_LOG_COOKIE) headers.Cookie = UPSTREAM_LOG_COOKIE;

  const response = await fetch(url, {
    headers,
  });
  const text = await response.text();
  const payload = parseJsonOrText(text);
  logImageJob(job.id, "timeout-recovery.log-response", {
    requestId,
    status: response.status,
    statusText: response.statusText,
    bodyPreview: sanitizeText(text),
  });
  if (isUnauthorizedLogPayload(response.status, payload)) {
    throw new UpstreamLogLookupError(getLogAuthHint(job), true);
  }
  if (!response.ok) return null;
  return payload;
}

function getNestedValue(value: unknown, path: string[]) {
  let current = value;
  for (const key of path) {
    if (!current || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function parseMaybeJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const trimmed = value.trim();
  if (!trimmed || !/^[{[]/.test(trimmed)) return value;
  return parseJsonOrText(trimmed);
}

function collectPotentialLogPayloads(value: unknown): unknown[] {
  const payloads: unknown[] = [];
  const visit = (item: unknown) => {
    if (!item || typeof item !== "object") return;
    payloads.push(item);
    const record = item as Record<string, unknown>;
    for (const key of ["content", "response", "response_body", "responseBody", "body", "other", "metadata"] as const) {
      const nested = parseMaybeJson(record[key]);
      if (nested && nested !== record[key]) payloads.push(nested);
      if (nested && typeof nested === "object") visit(nested);
    }
  };

  payloads.push(value);
  if (Array.isArray(value)) value.forEach(visit);
  if (value && typeof value === "object") {
    const items = getNestedValue(value, ["data", "items"]);
    if (Array.isArray(items)) items.forEach(visit);
    const data = getNestedValue(value, ["data"]);
    if (Array.isArray(data)) data.forEach(visit);
    visit(value);
  }

  return payloads;
}

async function recoverImageUrlFromUpstreamLogs(job: ImageJob, requestId: string): Promise<{ imageUrl: string | null; error?: string }> {
  if (!requestId || UPSTREAM_TIMEOUT_RECOVERY_MS <= 0) return { imageUrl: null };

  const deadline = Date.now() + UPSTREAM_TIMEOUT_RECOVERY_MS;
  logImageJob(job.id, "timeout-recovery.start", {
    requestId,
    recoveryMs: UPSTREAM_TIMEOUT_RECOVERY_MS,
    pollMs: UPSTREAM_TIMEOUT_RECOVERY_POLL_MS,
  });

  while (Date.now() <= deadline) {
    await sleep(UPSTREAM_TIMEOUT_RECOVERY_POLL_MS);
    let payload: unknown;
    try {
      payload = await fetchUpstreamLogPayload(job, requestId);
    } catch (error) {
      logImageJob(job.id, "timeout-recovery.log-error", {
        requestId,
        error: error instanceof Error ? error.message : String(error),
      });
      if (error instanceof UpstreamLogLookupError && error.terminal) {
        logImageJob(job.id, "timeout-recovery.abort", { requestId, error: error.message });
        return { imageUrl: null, error: error.message };
      }
      payload = null;
    }
    if (!payload) continue;

    for (const candidate of collectPotentialLogPayloads(payload)) {
 let imageUrl = extractImageUrls(candidate)[0];
if (!imageUrl) continue;
 imageUrl = absolutizeUpstreamImageUrl(imageUrl, job.provider.baseUrl);

logImageJob(job.id, "timeout-recovery.image-url", { requestId, imageUrl });
      return { imageUrl };
    }
  }

  logImageJob(job.id, "timeout-recovery.timeout", { requestId });
  return { imageUrl: null };
}

function getRecoverableTimeoutMessage(error: ImageJobAttemptError) {
  return `${error.message}\nUpstream requestId=${error.requestId}. The generation request was not retried to avoid duplicate charges, and no completed image was found in upstream logs within ${Math.round(UPSTREAM_TIMEOUT_RECOVERY_MS / 1000)}s. You can search this requestId in the upstream New API logs to recover the result if it finishes later.`;
}

function isRecoverableGatewayTimeoutStatus(status?: number) {
  return status === 504 || status === 524;
}

function getFailedImageResponseMessage(attempt: ImageJobAttempt, response: Response, responseText: string) {
  const requestId = getUpstreamRequestId(response.headers);
  const gatewayRequestId = getGatewayRequestId(response.headers);
  const mediaType = attempt.mediaType ?? "image";
  const baseMessage = `${attempt.label ?? attempt.endpoint} ${response.status}: ${sanitizeText(responseText, 1000)}`;
  const ids = [
    requestId ? `requestId=${requestId}` : "",
    gatewayRequestId ? `gatewayRequestId=${gatewayRequestId}` : "",
  ].filter(Boolean).join(" ");

  let hint: string | undefined;
  if (isRecoverableGatewayTimeoutStatus(response.status)) {
    hint = requestId
      ? `Upstream gateway timed out before returning the generated ${mediaType}. The backend will try to recover it from upstream logs by requestId without resubmitting the generation request.`
      : `Upstream gateway timed out before returning the generated ${mediaType} and did not include an upstream requestId, so the backend cannot automatically recover the result. If the provider dashboard shows a successful result, copy that URL and attach it to this local job; otherwise use a direct/long-timeout API endpoint or ask the provider to increase the gateway/origin timeout.`;
  }

  return new ImageJobAttemptError(`${baseMessage}${ids ? ` ${ids}` : ""}${hint ? ` hint=${hint}` : ""}`, response.status, requestId, responseText);
}

function getImageJobAttempts(job: ImageJob): ImageJobAttempt[] {
  if (job.request.attempts?.length) return job.request.attempts;
  return [
    {
      endpoint: job.request.endpoint,
      payload: job.request.payload,
      referenceImages: job.request.referenceImages,
      useImageEdit: job.request.useImageEdit,
      mediaType: job.request.mediaType,
    },
  ];
}

function isAbortError(error: unknown) {
  return error instanceof DOMException && error.name === "AbortError"
    || error instanceof Error && /aborted|aborterror/i.test(error.message);
}

async function runImageJobAttempt(job: ImageJob, attempt: ImageJobAttempt): Promise<{ imageUrl: string; taskId?: string; taskResponse?: unknown }> {
  const endpoint = buildEndpoint(job.provider.baseUrl, attempt.endpoint);
  const startedAt = Date.now();
  const mediaType = attempt.mediaType ?? job.request.mediaType ?? "image";
  logImageJob(job.id, "attempt.start", {
    label: attempt.label,
    endpoint: attempt.endpoint,
    targetUrl: endpoint,
    mediaType,
    useImageEdit: attempt.useImageEdit === true,
    providerId: job.provider.id,
    providerName: job.provider.name,
    providerBaseUrl: job.provider.baseUrl,
    providerAuthFingerprint: keyFingerprint(job.provider.key),
    requestHeaders: ["Authorization", ...Object.keys(job.provider.headers ?? {})],
    payload: attempt.payload,
    referenceImageCount: attempt.referenceImages?.length ?? 0,
  });
  if (mediaType === "video") {
    logImageJob(job.id, "video.attempt.start", {
      label: attempt.label,
      endpoint: attempt.endpoint,
      targetUrl: endpoint,
      payload: summarizeVideoPayload(attempt.payload),
    });
  }
  const headers: Record<string, string> = {
    Authorization: `Bearer ${job.provider.key}`,
    Accept: "application/json",
    ...(job.provider.headers ?? {}),
  };

  let response: Response;
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    const controller = new AbortController();
    const requestTimeoutMs = mediaType === "video" ? VIDEO_JOB_REQUEST_TIMEOUT_MS : IMAGE_JOB_REQUEST_TIMEOUT_MS;
    if (requestTimeoutMs > 0) {
      timeout = setTimeout(() => controller.abort(), requestTimeoutMs);
    }
    
    response = await fetch(endpoint, {
      method: "POST",
      headers: attempt.useImageEdit ? headers : { ...headers, "Content-Type": "application/json" },
      body: attempt.useImageEdit ? await buildFormData(attempt) : JSON.stringify(attempt.payload),
      signal: controller.signal,
    });
  } catch (error) {
    logImageJob(job.id, "attempt.network-error", {
      label: attempt.label,
      endpoint: attempt.endpoint,
      durationMs: Date.now() - startedAt,
      ...getErrorDetails(error),
    });
    if (isAbortError(error)) {
      throw new ImageJobAttemptError(
        `${attempt.label ?? attempt.endpoint}: ${mediaType} request timed out after ${Math.round((mediaType === "video" ? VIDEO_JOB_REQUEST_TIMEOUT_MS : IMAGE_JOB_REQUEST_TIMEOUT_MS) / 1000)}s before upstream returned a response. The upstream service may still finish the generation, but no requestId was available for automatic recovery.`,
        undefined,
        undefined,
        undefined
      );
    }
    throw error;
  } finally {
    if (timeout) clearTimeout(timeout);
  }

  const responseText = await response.text();
  logImageJob(job.id, "attempt.response", {
    label: attempt.label,
    endpoint: attempt.endpoint,
    targetUrl: endpoint,
    mediaType,
    status: response.status,
    statusText: response.statusText,
    contentType: response.headers.get("content-type"),
    responseHeaders: headersToObject(response.headers),
    durationMs: Date.now() - startedAt,
    bodyPreview: sanitizeText(responseText),
  });
  if (!response.ok) {
    throw getFailedImageResponseMessage(attempt, response, responseText);
  }

  let upstreamResponse: unknown;
  upstreamResponse = parseJsonOrText(responseText);

 // Check if this is an async task response
 const asyncTaskId = extractMediaUrls(upstreamResponse, mediaType).length > 0 ? null : extractMediaTaskId(upstreamResponse, mediaType);
 if (asyncTaskId) {
  logImageJob(job.id, "attempt.async-task", { 
  label: attempt.label, 
  endpoint: attempt.endpoint, 
  mediaType,
  taskId: asyncTaskId 
  });
 upstreamResponse = await pollAsyncTask(job, attempt, asyncTaskId, endpoint);
 }

 if (mediaType === "video" && extractMediaUrls(upstreamResponse, mediaType).length === 0) {
  const record = upstreamResponse && typeof upstreamResponse === "object" ? upstreamResponse as Record<string, unknown> : undefined;
  const completedTaskId = record && isCompletedTaskStatus(record.status ?? record.state) ? extractTaskIdCandidate(record) : null;
  if (completedTaskId) {
    const queriedResponse = await queryCompletedVideoTask(job, attempt, completedTaskId);
    if (queriedResponse) upstreamResponse = queriedResponse;
  }
 }
 
 // Extract task_id from response (even if not async, for task content endpoint)
 const taskIdFromResponse = typeof (upstreamResponse as any)?.task_id === "string" 
   ? (upstreamResponse as any).task_id 
   : asyncTaskId;

 let imageUrl = extractMediaUrls(upstreamResponse, mediaType)[0];
 if (!imageUrl) {
 logImageJob(job.id, "attempt.no-media-url", { label: attempt.label, endpoint: attempt.endpoint, mediaType });
 throw new Error(`${attempt.label ?? attempt.endpoint}: upstream returned no usable ${mediaType} URL`);
 }
  
  // Log extracted URL before absolutization
  logImageJob(job.id, "attempt.media-url-extracted", {
   label: attempt.label,
   mediaType,
   rawUrl: imageUrl,
   hasQueryParams: imageUrl.includes('?')
  });
  
 imageUrl = absolutizeUpstreamMediaUrl(imageUrl, job.provider.baseUrl);

  logImageJob(job.id, "attempt.media-url", {
    label: attempt.label,
    endpoint: attempt.endpoint,
    mediaType,
    imageUrl,
    taskId: taskIdFromResponse,
    hasQueryParams: imageUrl.includes('?'),
  });
  return { imageUrl, taskId: taskIdFromResponse || undefined, taskResponse: upstreamResponse };
}

async function runImageJob(jobId: string) {
  const job = jobs.get(jobId);
  if (!job) return;
  updateJob(jobId, { status: "running", error: undefined });
  const attempts = getImageJobAttempts(job);
  const mediaType = getJobMediaType(job);
  logImageJob(jobId, "job.start", {
    providerId: job.provider.id,
    providerName: job.provider.name,
    providerBaseUrl: job.provider.baseUrl,
    providerAuthFingerprint: keyFingerprint(job.provider.key),
    providerLogAuthFingerprint: job.provider.logAccessToken ? keyFingerprint(job.provider.logAccessToken) : undefined,
    mediaType,
    attemptCount: attempts.length,
    attempts: attempts.map(summarizeAttempt),
  });

  const errors: string[] = [];
  for (const attempt of attempts) {
    try {
      const result = await runImageJobAttempt(job, attempt);
      const imageUrl = result.imageUrl;
      const taskId = result.taskId;
      const taskResponse = result.taskResponse;
      
      updateJob(jobId, { upstreamUrl: imageUrl });
      
      // Always try to download and save locally for better reliability.
      logImageJob(jobId, "asset.save.start", { mediaType, imageUrl, taskId });
      const resultUrl = await saveMediaResultOrFallback(jobId, imageUrl, mediaType, job.provider.key, taskId, job.provider.baseUrl, taskResponse);
      updateJob(jobId, { status: "completed", upstreamUrl: imageUrl, resultUrl, error: undefined });
      logImageJob(jobId, "job.completed", { mediaType, upstreamUrl: imageUrl, resultUrl });
      return;
    } catch (error) {
      const shouldAttemptTimeoutRecovery =
        UPSTREAM_TIMEOUT_RECOVERY_MS > 0 &&
        error instanceof ImageJobAttemptError &&
        isRecoverableGatewayTimeoutStatus(error.status) &&
        Boolean(error.requestId);
      const message = shouldAttemptTimeoutRecovery
        ? getRecoverableTimeoutMessage(error)
        : error instanceof Error ? error.message : String(error);
      errors.push(message);
      logImageJob(jobId, "attempt.failed", {
        label: attempt.label,
        endpoint: attempt.endpoint,
        mediaType,
        error: message,
      });

      const hasMoreAttempts = attempts.indexOf(attempt) < attempts.length - 1;
      if (mediaType === "image" && error instanceof ImageJobAttemptError && isRecoverableGatewayTimeoutStatus(error.status) && !hasMoreAttempts) {
        if (shouldAttemptTimeoutRecovery && error.requestId) {
          const recovery = await recoverImageUrlFromUpstreamLogs(job, error.requestId);
          if (recovery.error) {
            errors[errors.length - 1] = `${message}\n${recovery.error}`;
          }
          if (recovery.imageUrl) {
            updateJob(jobId, { upstreamUrl: recovery.imageUrl });
            logImageJob(jobId, "asset.save.start", { imageUrl: recovery.imageUrl, recoveredFromRequestId: error.requestId });
            const resultUrl = await saveImageResultOrFallback(jobId, recovery.imageUrl, job.provider.key, undefined, undefined, { recoveredFromRequestId: error.requestId });
            updateJob(jobId, { status: "completed", upstreamUrl: recovery.imageUrl, resultUrl, error: undefined });
            logImageJob(jobId, "job.completed", { upstreamUrl: recovery.imageUrl, resultUrl, recoveredFromRequestId: error.requestId });
            return;
          }
        }
      }

      if (hasMoreAttempts) {
        logImageJob(jobId, "attempt.next", {
          failedLabel: attempt.label,
          failedEndpoint: attempt.endpoint,
          mediaType,
        });
        continue;
      }

      // Do not submit another image request after the final upstream/network failure.
      break;
    }
  }

  throw new Error(errors.join("\n"));
}

app.get("/health", (_request, response) => {
response.json({ ok: true });
});

app.all("/api/openai-compatible/*path", async (request, response) => {
 const body = request.body as Record<string, unknown> | undefined;
 const providerFromBody = normalizeProviderRequest(body?.provider);
 const providerFromHeaders = request.method === "GET" ? normalizeProviderRequest({
 id: request.headers["x-provider-id"],
 name: request.headers["x-provider-name"],
 baseUrl: request.headers["x-provider-baseurl"],
 key: request.headers["x-provider-key"],
 }) : null;
 const provider = providerFromBody || providerFromHeaders;
 const rawPath = Array.isArray(request.params.path) ? request.params.path.join("/") : String(request.params.path ?? "");
 const queryTarget = typeof request.query.target === "string" ? request.query.target : undefined;
 const targetPath = queryTarget || (typeof body?.path === "string" ? body.path : `/${rawPath}`);
 const payload = body?.payload;
 const method = request.method === "GET" ? "GET" : "POST";

 if (!provider) {
 response.status(400).json({ error: "provider.baseUrl and provider.key are required" });
 return;
 }

 if (!targetPath) {
 response.status(400).json({ error: "path is required" });
 return;
 }

 const targetUrl = buildEndpoint(provider.baseUrl, targetPath);
 const startedAt = Date.now();
 try {
 const upstreamResponse = await fetch(targetUrl, {
 method,
 headers: buildProviderHeaders(provider, "application/json", method === "POST" ? "application/json" : undefined),
 body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
 });
 const responseText = await upstreamResponse.text();

 console.log("[openai-compatible] upstream response", sanitizeValue({
 providerId: provider.id,
 providerName: provider.name,
 baseUrl: provider.baseUrl,
 path: targetPath,
 targetUrl,
 method,
 status: upstreamResponse.status,
 durationMs: Date.now() - startedAt,
 bodyPreview: sanitizeText(responseText,1200),
 }));

 response.status(upstreamResponse.status);
 response.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");
 response.setHeader("Cache-Control", "no-cache");
 response.send(responseText);
 } catch (error) {
 console.warn("[openai-compatible] upstream request failed", sanitizeValue({
 providerId: provider.id,
 providerName: provider.name,
 baseUrl: provider.baseUrl,
 path: targetPath,
 targetUrl,
 method,
 durationMs: Date.now() - startedAt,
 ...getErrorDetails(error),
 }));
 response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
 }
});

app.all("/api/openai-compatible", async (request, response) => {
 const body = request.body as Record<string, unknown> | undefined;
 const providerFromBody = normalizeProviderRequest(body?.provider);
 const providerFromHeaders = request.method === "GET" ? normalizeProviderRequest({
 id: request.headers["x-provider-id"],
 name: request.headers["x-provider-name"],
 baseUrl: request.headers["x-provider-baseurl"],
 key: request.headers["x-provider-key"],
 }) : null;
 const provider = providerFromBody || providerFromHeaders;
 const targetPath = typeof request.query.target === "string" ? request.query.target : typeof body?.path === "string" ? body.path : "";
 const payload = body?.payload;
 const method = request.method === "GET" ? "GET" : "POST";

 if (!provider) {
 response.status(400).json({ error: "provider.baseUrl and provider.key are required" });
 return;
 }

 if (!targetPath) {
 response.status(400).json({ error: "path is required" });
 return;
 }

 const targetUrl = buildEndpoint(provider.baseUrl, targetPath);
 try {
 const upstreamResponse = await fetch(targetUrl, {
 method,
 headers: buildProviderHeaders(provider, "application/json", method === "POST" ? "application/json" : undefined),
 body: method === "POST" ? JSON.stringify(payload ?? {}) : undefined,
 });
 const responseText = await upstreamResponse.text();
 response.status(upstreamResponse.status);
 response.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/json");
 response.setHeader("Cache-Control", "no-cache");
 response.send(responseText);
 } catch (error) {
 response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
 }
});

app.get("/api/image-jobs", (request, response) => {
  const mediaType = request.query.mediaType === "video" ? "video" : request.query.mediaType === "image" ? "image" : undefined;
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "100", 10);
  const limit = Math.max(1, Math.min(500, Number.isFinite(limitValue) ? limitValue : 100));

  const filteredJobs = Array.from(jobs.values())
    .filter((job) => !mediaType || getJobMediaType(job) === mediaType)
    .filter((job) => !status || job.status === status)
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, limit)
    .map(getRecoverableJobResponse);

  response.json({ jobs: filteredJobs });
});

app.get("/api/admin/logs", async (request, response) => {
  const rawSource = typeof request.query.source === "string" ? request.query.source : "image-jobs";
  const sourceKey = Object.prototype.hasOwnProperty.call(ADMIN_LOG_SOURCES, rawSource)
    ? rawSource as keyof typeof ADMIN_LOG_SOURCES
    : "image-jobs";
  const source = ADMIN_LOG_SOURCES[sourceKey];
  const linesValue = Number.parseInt(typeof request.query.lines === "string" ? request.query.lines : "300", 10);
  const maxLines = Math.max(50, Math.min(2000, Number.isFinite(linesValue) ? linesValue : 300));
  const query = typeof request.query.q === "string" ? request.query.q : "";

  try {
    const log = await readLogTail(source.filePath, maxLines, query);
    response.json({
      source: sourceKey,
      label: source.label,
      sources: Object.entries(ADMIN_LOG_SOURCES).map(([id, value]) => ({ id, label: value.label })),
      ...log,
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/image-jobs", upload.none(), (request, response) => {
  const body = request.body as Record<string, unknown>;
  const provider = body.provider as Record<string, unknown> | undefined;
  const rawPayload = body.payload as Record<string, unknown> | undefined;
  const endpoint = typeof body.endpoint === "string" ? body.endpoint : "/images/generations";
  const mediaType: MediaJobType = body.mediaType === "video" ? "video" : "image";
  const payload = rawPayload ? normalizeVideoPayloadImageFields(rawPayload, mediaType) : undefined;
  const attempts = Array.isArray(body.attempts)
    ? body.attempts
        .map((attempt): ImageJobAttempt | null => {
          if (!attempt || typeof attempt !== "object") return null;
          const raw = attempt as Record<string, unknown>;
          if (typeof raw.endpoint !== "string" || !raw.payload || typeof raw.payload !== "object") return null;
          const attemptMediaType: MediaJobType = raw.mediaType === "video" ? "video" : mediaType;
          return {
            label: typeof raw.label === "string" ? raw.label : undefined,
            endpoint: raw.endpoint,
            payload: normalizeVideoPayloadImageFields(raw.payload as Record<string, unknown>, attemptMediaType),
            referenceImages: Array.isArray(raw.referenceImages) ? raw.referenceImages.filter((value): value is string => typeof value === "string") : undefined,
            useImageEdit: raw.useImageEdit === true,
            mediaType: attemptMediaType,
          };
        })
        .filter((attempt): attempt is ImageJobAttempt => Boolean(attempt))
    : undefined;
  const clientTaskId = typeof body.clientTaskId === "string" && body.clientTaskId.trim() ? body.clientTaskId.trim() : undefined;

  logImageJob(clientTaskId ?? "job-request", "request.received", {
    endpoint,
    mediaType,
    hasProvider: Boolean(provider),
    hasProviderBaseUrl: typeof provider?.baseUrl === "string",
    hasProviderKey: typeof provider?.key === "string" && Boolean(provider.key),
    hasPayload: Boolean(payload),
    referenceImageCount: Array.isArray(body.referenceImages) ? body.referenceImages.length : 0,
    attemptCount: attempts?.length ?? 0,
  });
  if (mediaType === "video") {
    logImageJob(clientTaskId ?? "job-request", "video.request.received", {
      endpoint,
      payload: summarizeVideoPayload(payload),
      attempts: attempts?.map((attempt) => ({
        label: attempt.label,
        endpoint: attempt.endpoint,
        payload: summarizeVideoPayload(attempt.payload),
      })),
    });
  }

  if (!provider || typeof provider.baseUrl !== "string" || typeof provider.key !== "string" || !payload) {
    logImageJob(clientTaskId ?? "job-request", "request.invalid", {
      hasProvider: Boolean(provider),
      hasProviderBaseUrl: typeof provider?.baseUrl === "string",
      hasProviderKey: typeof provider?.key === "string" && Boolean(provider.key),
      hasPayload: Boolean(payload),
    });
    response.status(400).json({ error: "provider.baseUrl, provider.key and payload are required" });
    return;
  }

  if (clientTaskId && jobs.has(clientTaskId)) {
    const existingJob = jobs.get(clientTaskId)!;
    markImageJobTimedOutIfStale(clientTaskId, existingJob);
    logImageJob(clientTaskId, "job.reuse-existing", { status: jobs.get(clientTaskId)?.status });
    response.status(202).json(getJobResponse(jobs.get(clientTaskId)!));
    return;
  }

  const now = Date.now();
  const job: ImageJob = {
    id: clientTaskId ?? createId("job"),
    status: "queued",
    createdAt: now,
    updatedAt: now,
    provider: {
      id: typeof provider.id === "string" ? provider.id : undefined,
      name: typeof provider.name === "string" ? provider.name : undefined,
      baseUrl: provider.baseUrl,
      key: provider.key,
      logAccessToken: typeof provider.logAccessToken === "string" ? provider.logAccessToken : undefined,
      headers: typeof provider.headers === "object" && provider.headers ? provider.headers as Record<string, string> : undefined,
    },
    request: {
      endpoint,
      method: "POST",
      payload,
      referenceImages: Array.isArray(body.referenceImages) ? body.referenceImages.filter((value): value is string => typeof value === "string") : undefined,
      useImageEdit: body.useImageEdit === true,
      mediaType,
      attempts,
    },
  };

  jobs.set(job.id, job);
  logImageJob(job.id, "job.created", {
    providerId: job.provider.id,
    providerName: job.provider.name,
    providerBaseUrl: job.provider.baseUrl,
    providerAuthFingerprint: keyFingerprint(job.provider.key),
    providerLogAuthFingerprint: job.provider.logAccessToken ? keyFingerprint(job.provider.logAccessToken) : undefined,
    endpoint: job.request.endpoint,
    mediaType: getJobMediaType(job),
    useImageEdit: job.request.useImageEdit === true,
    referenceImageCount: job.request.referenceImages?.length ?? 0,
    payload: job.request.payload,
    attemptCount: getImageJobAttempts(job).length,
    attempts: getImageJobAttempts(job).map(summarizeAttempt),
  });
  if (getJobMediaType(job) === "video") {
    logImageJob(job.id, "video.job.created", {
      endpoint: job.request.endpoint,
      payload: summarizeVideoPayload(job.request.payload),
      attempts: getImageJobAttempts(job).map((attempt) => ({
        label: attempt.label,
        endpoint: attempt.endpoint,
        payload: summarizeVideoPayload(attempt.payload),
      })),
    });
  }
  void saveJobsSoon();
  scheduleJob(job.id);
  response.status(202).json(getJobResponse(job));
});

app.get("/api/image-jobs/:id", (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) {
    response.json({ id: request.params.id, status: "missing", missing: true, error: "Image job was not found" });
    return;
  }
  markImageJobTimedOutIfStale(request.params.id, job);
  response.json(getJobResponse(jobs.get(request.params.id)!));
});

app.post("/api/image-jobs/:id/result", async (request, response) => {
  const job = jobs.get(request.params.id);
  const body = request.body as Record<string, unknown> | undefined;
  const imageUrl = typeof body?.imageUrl === "string" ? body.imageUrl.trim() : "";

  if (!job) {
    response.status(404).json({ ok: false, missing: true, error: "Image job was not found" });
    return;
  }

  if (!/^https?:\/\//i.test(imageUrl) && !/^data:(?:image|video)\//i.test(imageUrl)) {
    response.status(400).json({ ok: false, error: "imageUrl must be an http(s) URL, data:image URL, or data:video URL" });
    return;
  }

  try {
    const mediaType = getJobMediaType(job);
    logImageJob(job.id, "manual-result.attach.start", { mediaType, imageUrl });
    const resultUrl = await saveMediaResultOrFallback(job.id, imageUrl, mediaType, job.provider.key, undefined, undefined, undefined, { manual: true });
    updateJob(job.id, { status: "completed", upstreamUrl: imageUrl, resultUrl, error: undefined });
    logImageJob(job.id, "manual-result.attach.done", { mediaType, upstreamUrl: imageUrl, resultUrl });
    response.json({ ok: true, ...getJobResponse(jobs.get(job.id)!) });
  } catch (error) {
    logImageJob(job.id, "manual-result.attach.failed", getErrorDetails(error));
    response.status(500).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/image-jobs/:id/asset", async (request, response) => {
  const job = jobs.get(request.params.id);
  if (!job) {
    response.json({ ok: false, missing: true });
    return;
  }

  await deleteJobAsset(job);
  updateJob(job.id, { resultUrl: undefined });
  response.json({ ok: true });
});

await ensureDataFiles();
await recoverPersistedActiveJobs();

// Initialize preset agents if none exist
if (agents.size === 0) {
  console.log('[backend] initializing preset agents...');
  
  const promptOptimizationAgent: Agent = {
    id: createId('agent'),
    name: '提示词优化助手',
    description: '帮助你优化和改进图片生成提示词，让AI更准确地理解你的创意',
    category: 'prompt-optimization',
    type: 'preset',
    systemPrompt: `你是一个专业的AI图片生成提示词优化助手。你的任务是帮助用户优化他们的提示词，使其更加详细、准确和有效。

优化原则：
1. 保持用户的核心创意和意图
2. 添加具体的视觉细节（光线、色彩、构图、风格等）
3. 使用专业的摄影和艺术术语
4. 考虑画面的氛围和情感表达
5. 适当添加质量提升词（如"高清"、"细节丰富"、"专业摄影"等）

输出格式：
- 直接输出优化后的提示词，不需要额外解释
- 保持简洁，一般在50-150字之间
- 使用中文或英文，根据用户输入的语言决定

示例：
用户输入："一只猫"
优化输出："一只优雅的波斯猫，坐在洒满阳光的窗台上，柔和的自然光线，温暖的色调，浅景深，电影级构图，高清细节，专业摄影"`,
    modelId: 'gpt-4',
    temperature: 0.7,
    maxTokens: 500,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
  };

  const storyboardAgent: Agent = {
    id: createId('agent'),
    name: '分镜脚本助手',
    description: '根据你的故事创意生成详细的视频分镜脚本，包含多个镜头描述',
    category: 'storyboard',
    type: 'preset',
    systemPrompt: `你是一个专业的视频分镜脚本创作助手。你的任务是根据用户的故事创意，生成详细的分镜脚本。

分镜原则：
1. 将故事分解为3-8个关键镜头
2. 每个镜头包含：景别、运镜、画面内容、氛围
3. 注重镜头之间的连贯性和节奏感
4. 考虑视觉冲击力和叙事效果

输出格式：
镜头1（景别）：画面描述，包含运镜方式、主体动作、环境氛围等
镜头2（景别）：...
镜头3（景别）：...

景别选项：远景、全景、中景、近景、特写
运镜方式：推镜、拉镜、摇镜、跟镜、固定镜头等

示例：
用户输入："一个人在森林中探险"
输出：
镜头1（远景）：航拍视角，茂密的森林全景，阳光透过树叶洒下斑驳光影，一个渺小的身影在林间小路上前行
镜头2（中景）：跟镜，探险者背影，穿过密林，拨开枝叶，脚步坚定
镜头3（近景）：侧面特写，探险者抬头仰望参天古树，眼神中充满好奇与敬畏
镜头4（特写）：手持镜头，探险者的手触摸树干上的青苔，感受自然的质感`,
    modelId: 'gpt-4',
    temperature: 0.8,
    maxTokens: 1000,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
  };

  const agentCreatorAgent: Agent = {
    id: createId('agent'),
    name: '智能体创建助手',
    description: '通过对话帮助用户设计智能体的名称、描述和系统提示词',
    category: 'custom',
    type: 'preset',
    systemPrompt: `你是一个专业的智能体创建助手。你的任务是通过对话帮助用户明确他们想创建的智能体职能，并最终生成可直接保存的智能体配置。

工作方式：
1. 先询问用户想让智能体解决什么问题、服务什么场景、输出什么结果。
2. 如果信息不足，继续追问，不要过早给最终配置。
3. 当信息足够时，输出一个清晰的智能体方案。
4. 最终回复必须包含一个 JSON 代码块，格式如下：

\`\`\`json
{
  "name": "智能体名称",
  "description": "一句话说明智能体用途",
  "systemPrompt": "完整系统提示词，包含身份、任务、工作流程、输出格式和注意事项"
}
\`\`\`

要求：
- name 简洁，不超过 12 个中文字符。
- description 适合展示在智能体列表。
- systemPrompt 要完整、可直接作为系统提示词使用。
- 不要生成 category 字段，智能体统一保存为自定义智能体。`,
    modelId: 'gpt-4',
    temperature: 0.7,
    maxTokens: 1600,
    createdAt: Date.now(),
    updatedAt: Date.now(),
    isActive: true,
  };

  agents.set(promptOptimizationAgent.id, promptOptimizationAgent);
  agents.set(storyboardAgent.id, storyboardAgent);
  agents.set(agentCreatorAgent.id, agentCreatorAgent);
  await saveAgentsSoon();
  console.log('[backend] preset agents initialized');
}

void cleanupExpiredJobs();
cleanupExpiredEmailVerificationRecords();
setInterval(() => void cleanupExpiredJobs(), 60 * 60 * 1000);
setInterval(cleanupExpiredEmailVerificationRecords, 60 * 1000);
app.listen(PORT, HOST, () => {
  console.log(`[backend] listening on http://${HOST}:${PORT}`);
  console.log(`[backend] loaded ${jobs.size} image jobs`);
  console.log(`[backend] loaded ${agents.size} agents`);
  console.log(`[backend] loaded ${styleLibrary.styles.length} style presets`);
  console.log(`[backend] email verification ${emailConfig.enabled ? "enabled" : "disabled"}`);
  console.log(`[backend] completed image job retention: ${Math.round(COMPLETED_JOB_RETENTION_MS / 60 / 60 / 1000)}h`);
});
