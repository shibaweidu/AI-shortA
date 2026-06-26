import cors from "cors";
import express from "express";
import multer from "multer";
import nodemailer from "nodemailer";
import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { createWriteStream } from "node:fs";
import { appendFile, mkdir, readdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { createHash, randomInt } from "node:crypto";
import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { setDefaultResultOrder } from "node:dns";
import { setDefaultAutoSelectFamily } from "node:net";
import { basename, dirname, extname, join } from "node:path";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { promisify } from "node:util";
import {
  loadLegacyStateFromPostgres,
  saveAgentsSnapshotToPostgres,
  saveAppStateEntryToPostgres,
  saveConfigDocumentToPostgres,
  saveImageJobsSnapshotToPostgres,
  shouldUsePostgresDualWrite,
} from "./db/legacyPersistence.js";
import { materializeAppStateToPostgres } from "./db/materializedState.js";
import { isPostgresEnabled, queryPostgres } from "./db/postgres.js";

const PORT = Number(process.env.PORT ?? 8787);
const HOST = process.env.HOST ?? "0.0.0.0";
const PUBLIC_BASE_URL = (process.env.PUBLIC_BASE_URL ?? process.env.VITE_BACKEND_URL ?? "").trim().replace(/\/+$/, "");
const DATA_DIR = join(process.cwd(), "data");
const UPLOADS_DIR = join(process.cwd(), "uploads");
const LOGS_DIR = join(process.cwd(), "logs");
const FRONTEND_DIST_DIR = process.env.FRONTEND_DIST_DIR ?? join(process.cwd(), "../frontend/dist");
const FRONTEND_INDEX_FILE = join(FRONTEND_DIST_DIR, "index.html");
const JOBS_FILE = join(DATA_DIR, "image-jobs.json");
const APP_STATE_FILE = join(DATA_DIR, "app-state.json");
const AGENTS_FILE = join(DATA_DIR, "agents.json");
const EMAIL_CONFIG_FILE = join(DATA_DIR, "email-config.json");
const STORAGE_CONFIG_FILE = join(DATA_DIR, "storage-config.json");
const STYLE_LIBRARY_FILE = join(DATA_DIR, "style-library.json");
const COLLECTION_LIBRARY_FILE = join(DATA_DIR, "collection-library.json");
const BACKUPS_DIR = join(DATA_DIR, "backups");
const IMAGE_JOBS_LOG_FILE = join(LOGS_DIR, "image-jobs.log");
const APP_STATE_LOG_FILE = join(LOGS_DIR, "app-state.log");
const generationResultCache = new Map<string, { createdAt: number; request?: unknown; response: unknown }>();
const execFileAsync = promisify(execFile);

function pruneGenerationResultCache() {
  const cutoff = Date.now() - 1000 * 60 * 60 * 6;
  for (const [key, value] of generationResultCache.entries()) {
    if (value.createdAt < cutoff) generationResultCache.delete(key);
  }
}
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
const JSON_BODY_LIMIT = process.env.JSON_BODY_LIMIT ?? (process.env.NODE_ENV === "production" ? "50mb" : "200mb");
const RATE_LIMIT_WINDOW_MS = Number(process.env.RATE_LIMIT_WINDOW_SECONDS ?? 60) * 1000;
const DEFAULT_RATE_LIMIT_MAX_REQUESTS = process.env.NODE_ENV === "production" ? 300 : 0;
const RATE_LIMIT_MAX_REQUESTS = Number(process.env.RATE_LIMIT_MAX_REQUESTS ?? DEFAULT_RATE_LIMIT_MAX_REQUESTS);
const ADMIN_API_TOKEN = (process.env.ADMIN_API_TOKEN ?? "").trim();
const CORS_ALLOWED_ORIGINS = (process.env.CORS_ALLOWED_ORIGINS ?? PUBLIC_BASE_URL)
  .split(",")
  .map((origin) => origin.trim().replace(/\/+$/, ""))
  .filter(Boolean);

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

type CollectionProvider = "civitai" | "lexica" | "generated";
type CollectionWorkStatus = "pending" | "published" | "rejected" | "broken";

// Civitai 的 /api/v1/images 已不再支持 query/tags 文本过滤（实测所有关键词返回同一榜单），
// 现在只有 sort × period 能产生差异化、可翻页的结果，用它们区分不同采集源。
type CivitaiSort = "Most Reactions" | "Most Comments" | "Most Collected" | "Newest";
type CivitaiPeriod = "Day" | "Week" | "Month" | "Year" | "AllTime";
const CIVITAI_SORTS: CivitaiSort[] = ["Most Reactions", "Most Comments", "Most Collected", "Newest"];
const CIVITAI_PERIODS: CivitaiPeriod[] = ["Day", "Week", "Month", "Year", "AllTime"];

type CollectionSource = {
  id: string;
  provider: CollectionProvider;
  name: string;
  query: string;
  enabled: boolean;
  sort?: CivitaiSort;
  period?: CivitaiPeriod;
  targetCategoryId?: string;
  targetCategoryName?: string;
  targetTags: string[];
  autoPublish: boolean;
  filterNsfw: boolean;
  maxItemsPerRun: number;
  scheduleEveryHours?: number;
  lastRunAt?: number;
  cursor?: string;
  createdAt: number;
  updatedAt: number;
};

type CollectionWork = {
  id: string;
  sourceId?: string;
  provider: CollectionProvider;
  sourceWorkId?: string;
  sourcePageUrl?: string;
  originalImageUrl: string;
  displayUrl: string;
  thumbnailUrl?: string;
  title: string;
  prompt: string;
  negativePrompt?: string;
  model?: string;
  aspectRatio: string;
  width?: number;
  height?: number;
  categoryId: string;
  categoryName: string;
  tags: string[];
  nsfw: boolean;
  qualityScore: number;
  recommendationScore: number;
  featured: boolean;
  featuredAt?: number;
  status: CollectionWorkStatus;
  failedCount: number;
  lastFailedAt?: number;
  metadata: Record<string, unknown>;
  collectedAt: number;
  publishedAt?: number;
  createdAt: number;
  updatedAt: number;
};

type CollectionLibrary = {
  sources: CollectionSource[];
  works: CollectionWork[];
  runs: CollectionRun[];
};

type CollectionRun = {
  id: string;
  sourceId: string;
  provider: CollectionProvider;
  query: string;
  status: "running" | "completed" | "failed";
  fetched: number;
  added: number;
  skipped: number;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

type CollectionClassifierSettings = {
  enabled: boolean;
  visionModelValue: string;
  modelId: string;
  provider?: ProviderRequestConfig;
  classificationPrompt: string;
};

type CollectionCategoryConfig = {
  id: string;
  name: string;
  keywords: string[];
  custom?: boolean;
};

type GeneratedPublishSettings = {
  enabled: boolean;
  autoPublish: boolean;
  mediaTypes: MediaJobType[];
  defaultCategoryId: string;
  defaultCategoryName: string;
  categories: CollectionCategoryConfig[];
};

type PaymentSettings = {
  enabled: boolean;
  providerName: string;
  mode: "external" | "api";
  createOrderUrl: string;
  method: "POST" | "GET";
  headersJson: string;
  payloadTemplate: string;
  payUrlField: string;
  orderIdField: string;
  webhookSecret: string;
  successUrl: string;
  cancelUrl: string;
};

type DataBackupManifest = {
  version: number;
  kind: "data-backup";
  createdAt: number;
  source: {
    runtime: "json" | "postgres";
    databaseConfigured: boolean;
    dualWrite: boolean;
  };
  summary: {
    appStateKeys: number;
    jobs: number;
    agents: number;
    styles: number;
    localUploads: number;
    objectStorageObjects: number;
  };
  coverage: {
    included: string[];
    notIncluded: string[];
  };
  appState: Record<string, string>;
  imageJobs: unknown[];
  agents: Agent[];
  emailConfig: EmailConfig;
  objectStorageConfig: ObjectStorageConfig;
  styleLibrary: StyleLibrary;
  localUploads: Array<{
    path: string;
    size: number;
    updatedAt: number;
  }>;
  objectStorageObjects: Array<{
    key: string;
    size: number;
    updatedAt: number;
    url: string;
  }>;
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
let collectionLibrary: CollectionLibrary = { sources: [], works: [], runs: [] };

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
let collectionLibrarySaveChain = Promise.resolve();
let emailConfig: EmailConfig = { ...DEFAULT_EMAIL_CONFIG };
let objectStorageConfig: ObjectStorageConfig = { ...DEFAULT_OBJECT_STORAGE_CONFIG };
let runningCollectionJobs = 0;
const collectionJobQueue: Array<{
  source: CollectionSource;
  attemptsLeft: number;
  resolve: (value: Awaited<ReturnType<typeof runCollectionSourceNow>>) => void;
  reject: (error: unknown) => void;
}> = [];
const queuedCollectionSourceIds = new Set<string>();
const COLLECTION_QUEUE_CONCURRENCY = Math.max(1, Math.min(5, Number(process.env.COLLECTION_QUEUE_CONCURRENCY ?? 2)));
const COLLECTION_QUEUE_RETRIES = Math.max(0, Math.min(5, Number(process.env.COLLECTION_QUEUE_RETRIES ?? 2)));
const COLLECTION_REQUEST_TIMEOUT_MS = Math.max(5000, Math.min(60000, Number(process.env.COLLECTION_REQUEST_TIMEOUT_SECONDS ?? 15) * 1000));
const COLLECTION_RUN_TIMEOUT_MS = Math.max(10000, Math.min(180000, Number(process.env.COLLECTION_RUN_TIMEOUT_SECONDS ?? 45) * 1000));
const COLLECTION_DETAIL_ENRICH_LIMIT = Math.max(0, Math.min(20, Number(process.env.COLLECTION_DETAIL_ENRICH_LIMIT ?? 8)));
// Lexica 搜索结果稀疏，cursor 以 100 步进翻页。限制最多翻多少页 + 墙钟预算，避免单次采集触发运行超时。
const LEXICA_MAX_SEARCH_PAGES = Math.max(1, Math.min(40, Number(process.env.LEXICA_MAX_SEARCH_PAGES ?? 8)));
const LEXICA_SEARCH_BUDGET_MS = Math.max(5000, Math.min(120000, Number(process.env.LEXICA_SEARCH_BUDGET_SECONDS ?? 30) * 1000));
// 在部分 Windows 环境里 Node 的原生 fetch（undici）连不上采集源（IPv6/连接超时），
// 但 PowerShell 的 Invoke-WebRequest 可以。给原生 fetch 一个较短的探测超时，
// 一旦它出现连接级失败就熔断，后续请求直接走 PowerShell，避免每条请求都白等 ~10s。
const COLLECTION_NATIVE_FETCH_TIMEOUT_MS = Math.max(2000, Math.min(15000, Number(process.env.COLLECTION_NATIVE_FETCH_TIMEOUT_SECONDS ?? 4) * 1000));
let nativeFetchConnectBroken = process.platform === "win32" && process.env.COLLECTION_FORCE_POWERSHELL === "1";
// Civitai 对匿名请求隐藏 meta（prompt/参数/模型版本）。配置 API token 后详情接口才会返回这些字段。
// 没有 token 时富化详情没有意义，会白白把每次采集数量限制在 COLLECTION_DETAIL_ENRICH_LIMIT 条。
let civitaiApiToken = (process.env.CIVITAI_API_TOKEN ?? "").trim();
const CIVITAI_API_TOKEN_KEY = "civitai-api-token";
function getCivitaiApiToken() {
  return civitaiApiToken;
}

const REFERENCE_SETTINGS_KEY = "reference-settings";
const COLLECTION_CLASSIFIER_SETTINGS_KEY = "collection-classifier-settings";
const GENERATED_PUBLISH_SETTINGS_KEY = "generated-publish-settings";
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
const DEFAULT_COLLECTION_CLASSIFIER_SETTINGS: CollectionClassifierSettings = {
  enabled: false,
  visionModelValue: "",
  modelId: "",
  classificationPrompt:
    '你是 AI 作品采集分类器。请根据图片、prompt、模型和标签，把作品归入一个首页主分类。只能返回 JSON：{"categoryId":"portrait|character|scene|product|poster|illustration|style|anime|cg|chinese","categoryName":"中文分类名","tags":["标签1","标签2"],"confidence":0-1}。分类定义：portrait=真人/摄影/人像，character=角色/IP/头像，scene=风景/建筑/室内/环境，product=商品/包装/器物，poster=海报/封面/排版，illustration=插画/概念图/绘本，style=视觉风格/技法/材质，anime=二次元/漫画/赛璐璐，cg=3D/CG/渲染，chinese=国风/汉服/水墨/武侠。',
};
let collectionClassifierSettings: CollectionClassifierSettings = { ...DEFAULT_COLLECTION_CLASSIFIER_SETTINGS };
const DEFAULT_COLLECTION_CATEGORIES: CollectionCategoryConfig[] = [
  { id: "portrait", name: "人像", keywords: ["portrait", "photo", "woman", "man", "face", "headshot", "fashion", "beauty", "girl", "boy", "美女", "人像"] },
  { id: "character", name: "角色", keywords: ["character", "game character", "mascot", "avatar", "chibi", "hero", "villain", "角色", "头像", "动物"] },
  { id: "scene", name: "场景", keywords: ["landscape", "interior", "architecture", "city", "room", "forest", "mountain", "street", "environment", "风景", "建筑", "室内"] },
  { id: "product", name: "产品", keywords: ["product", "packaging", "sneaker", "bottle", "perfume", "furniture", "device", "watch", "bag", "产品", "包装", "商品"] },
  { id: "poster", name: "海报", keywords: ["poster", "cover", "typography", "movie poster", "advertising", "banner", "海报", "封面", "排版"] },
  { id: "illustration", name: "插画", keywords: ["illustration", "children's book", "flat", "hand drawn", "concept art", "storybook", "插画", "绘本", "概念图"] },
  { id: "style", name: "风格", keywords: ["watercolor", "pixel art", "clay", "low poly", "cyberpunk", "cinematic", "minimal", "film", "retro", "风格"] },
  { id: "anime", name: "二次元", keywords: ["anime", "manga", "cel shading", "waifu", "japanese animation", "kawaii", "二次元", "动漫", "漫画"] },
  { id: "cg", name: "3D/CG", keywords: ["3d", "cgi", "render", "octane", "blender", "unreal engine", "zbrush", "渲染"] },
  { id: "chinese", name: "国风", keywords: ["chinese", "hanfu", "ink", "wuxia", "guofeng", "oriental", "xianxia", "国风", "汉服", "水墨", "武侠"] },
];
const DEFAULT_GENERATED_PUBLISH_SETTINGS: GeneratedPublishSettings = {
  enabled: true,
  autoPublish: true,
  mediaTypes: ["image"],
  defaultCategoryId: "style",
  defaultCategoryName: "风格",
  categories: DEFAULT_COLLECTION_CATEGORIES,
};
let generatedPublishSettings: GeneratedPublishSettings = { ...DEFAULT_GENERATED_PUBLISH_SETTINGS };
const PAYMENT_SETTINGS_KEY = "koala-payment-settings-v1";
const CREDIT_STORE_KEY = "koala-credit-store-v1";
const DEFAULT_PAYMENT_SETTINGS: PaymentSettings = {
  enabled: false,
  providerName: "",
  mode: "external",
  createOrderUrl: "",
  method: "POST",
  headersJson: "",
  payloadTemplate: JSON.stringify({
    orderId: "{{orderId}}",
    packageId: "{{packageId}}",
    packageName: "{{packageName}}",
    amount: "{{price}}",
    credits: "{{credits}}",
    userId: "{{userId}}",
    successUrl: "{{successUrl}}",
    cancelUrl: "{{cancelUrl}}",
  }, null, 2),
  payUrlField: "payUrl",
  orderIdField: "orderId",
  webhookSecret: "",
  successUrl: "",
  cancelUrl: "",
};
let paymentSettings: PaymentSettings = { ...DEFAULT_PAYMENT_SETTINGS };

app.use(cors({
  origin(origin, callback) {
    if (!origin) {
      callback(null, true);
      return;
    }
    const normalizedOrigin = origin.replace(/\/+$/, "");
    if (CORS_ALLOWED_ORIGINS.includes(normalizedOrigin) || (process.env.NODE_ENV !== "production" && CORS_ALLOWED_ORIGINS.length === 0)) {
      callback(null, true);
      return;
    }
    callback(null, false);
  },
}));
app.set("trust proxy", process.env.TRUST_PROXY ?? "loopback");
app.use((request, response, next) => {
  const requestId = typeof request.headers["x-request-id"] === "string" && request.headers["x-request-id"].trim()
    ? request.headers["x-request-id"].trim().slice(0, 120)
    : randomUUID();
  response.setHeader("X-Request-Id", requestId);
  response.setHeader("X-Content-Type-Options", "nosniff");
  response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  response.setHeader("Permissions-Policy", "camera=(), microphone=(), geolocation=()");
  next();
});

const rateLimitBuckets = new Map<string, { resetAt: number; count: number }>();
app.use((request, response, next) => {
  if (request.path === "/api/health" || RATE_LIMIT_MAX_REQUESTS <= 0) {
    next();
    return;
  }
  const now = Date.now();
  const key = request.ip ?? request.socket.remoteAddress ?? "unknown";
  const current = rateLimitBuckets.get(key);
  const bucket = current && current.resetAt > now ? current : { resetAt: now + RATE_LIMIT_WINDOW_MS, count: 0 };
  bucket.count += 1;
  rateLimitBuckets.set(key, bucket);
  response.setHeader("RateLimit-Limit", String(RATE_LIMIT_MAX_REQUESTS));
  response.setHeader("RateLimit-Remaining", String(Math.max(0, RATE_LIMIT_MAX_REQUESTS - bucket.count)));
  response.setHeader("RateLimit-Reset", String(Math.ceil(bucket.resetAt / 1000)));
  if (bucket.count > RATE_LIMIT_MAX_REQUESTS) {
    response.status(429).json({ error: "Too many requests" });
    return;
  }
  if (rateLimitBuckets.size > 10_000) {
    for (const [bucketKey, value] of rateLimitBuckets.entries()) {
      if (value.resetAt <= now) rateLimitBuckets.delete(bucketKey);
    }
  }
  next();
});

function getRequestAdminToken(request: express.Request) {
  const headerToken = request.headers["x-admin-token"];
  if (typeof headerToken === "string" && headerToken.trim()) return headerToken.trim();
  const authorization = request.headers.authorization;
  if (typeof authorization === "string" && authorization.toLowerCase().startsWith("bearer ")) {
    return authorization.slice(7).trim();
  }
  return "";
}

function isAdminProtectedPath(method: string, path: string) {
  if (path.startsWith("/api/admin")) return true;
  if (path === "/api/generated-works/publish") return true;
  if (path.startsWith("/api/collection/classifier-settings")) return true;
  if (path.startsWith("/api/collection/generated-publish-settings")) return true;
  if (path.startsWith("/api/collection/civitai-token")) return true;
  if (path.startsWith("/api/collection/sources")) return true;
  if (path.startsWith("/api/collection/runs")) return true;
  if (path === "/api/collection/run-enabled") return true;
  if (path === "/api/payment-settings") return true;
  if (path === "/api/collection/works") return true;
  if (path.startsWith("/api/collection/works/batch")) return true;
  if (path.startsWith("/api/collection/works/") && method !== "GET" && !path.endsWith("/broken")) return true;
  return false;
}

app.use((request, response, next) => {
  if (!ADMIN_API_TOKEN || request.method === "OPTIONS" || !isAdminProtectedPath(request.method, request.path)) {
    next();
    return;
  }
  if (getRequestAdminToken(request) !== ADMIN_API_TOKEN) {
    response.status(401).json({ error: "Admin API token is required" });
    return;
  }
  next();
});
app.use(express.json({ limit: JSON_BODY_LIMIT }));
app.use("/uploads", express.static(UPLOADS_DIR, { fallthrough: false, maxAge: "7d" }));

function saveAppStateEntryInBackground(key: string, value: string | null) {
  if (!shouldUsePostgresDualWrite()) return;
  void (async () => {
    await saveAppStateEntryToPostgres(key, value);
    await materializeAppStateToPostgres(key, value);
  })().catch((error) => {
    console.error("[app-state] failed to dual-write PostgreSQL entry", { key, error });
  });
}

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
  response.json({
    ok: true,
    jobs: jobs.size,
    runningJobs,
    queueLength: pendingQueue.length,
    database: {
      configured: isPostgresEnabled(),
      dualWrite: shouldUsePostgresDualWrite(),
      readPrimary: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
    },
  });
});

app.get("/api/health/deep", async (_request, response) => {
  const databaseConfigured = isPostgresEnabled();
  let databaseOk = !databaseConfigured;
  let databaseError: string | undefined;
  if (databaseConfigured) {
    try {
      await queryPostgres("select 1");
      databaseOk = true;
    } catch (error) {
      databaseOk = false;
      databaseError = error instanceof Error ? error.message : String(error);
    }
  }
  response.status(databaseOk ? 200 : 503).json({
    ok: databaseOk,
    jobs: jobs.size,
    runningJobs,
    queueLength: pendingQueue.length,
    database: {
      configured: databaseConfigured,
      ok: databaseOk,
      dualWrite: shouldUsePostgresDualWrite(),
      readPrimary: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
      error: databaseError,
    },
  });
});

app.get("/api-proxy/asset", async (request, response) => {
  const assetUrl = typeof request.query.url === "string" ? request.query.url.trim() : "";
  if (!assetUrl || !/^https?:\/\//i.test(assetUrl)) {
    response.status(400).json({ error: "Invalid asset url" });
    return;
  }

  try {
    const upstreamResponse = await fetch(assetUrl, {
      method: "GET",
      headers: { Accept: typeof request.headers.accept === "string" ? request.headers.accept : "*/*" },
    });
    response.status(upstreamResponse.status);
    response.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstreamResponse.body as never).pipe(response);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api-proxy/generation-result/:clientTaskId", (request, response) => {
  pruneGenerationResultCache();
  const result = generationResultCache.get(request.params.clientTaskId);
  response.json(result ? { found: true, ...result } : { found: false });
});

app.get("/api-proxy/generation-results", (_request, response) => {
  pruneGenerationResultCache();
  response.json({
    results: Array.from(generationResultCache.entries()).map(([clientTaskId, value]) => ({
      clientTaskId,
      ...value,
    })),
  });
});

app.get("/api-proxy", async (request, response) => {
  const targetUrl = typeof request.headers["x-target-url"] === "string" ? request.headers["x-target-url"] : "";
  if (!targetUrl || !/^https?:\/\//i.test(targetUrl)) {
    response.status(400).json({ error: "Missing or invalid x-target-url header" });
    return;
  }

  const headers: Record<string, string> = {
    Accept: typeof request.headers.accept === "string" ? request.headers.accept : "*/*",
  };
  if (typeof request.headers.authorization === "string") headers.Authorization = request.headers.authorization;

  try {
    const upstreamResponse = await fetch(targetUrl, { method: "GET", headers });
    response.status(upstreamResponse.status);
    response.setHeader("Content-Type", upstreamResponse.headers.get("content-type") || "application/octet-stream");
    response.setHeader("Cache-Control", "no-cache");
    if (!upstreamResponse.body) {
      response.end();
      return;
    }
    Readable.fromWeb(upstreamResponse.body as never).pipe(response);
  } catch (error) {
    response.status(502).json({ error: error instanceof Error ? error.message : String(error) });
  }
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
    saveAppStateEntryInBackground(request.params.key, null);
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
    saveAppStateEntryInBackground(request.params.key, nextFlowState.value);
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
  saveAppStateEntryInBackground(request.params.key, null);
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

app.get("/api/collection/classifier-settings", (_request, response) => {
  response.json(getCollectionClassifierSettings());
});

app.put("/api/collection/classifier-settings", (request, response) => {
  collectionClassifierSettings = normalizeCollectionClassifierSettings(request.body);
  appState.set(COLLECTION_CLASSIFIER_SETTINGS_KEY, JSON.stringify(collectionClassifierSettings));
  void saveAppStateSoon();
  response.json(collectionClassifierSettings);
});

app.get("/api/collection/civitai-token", (_request, response) => {
  const token = getCivitaiApiToken();
  // 不回传明文，仅告知是否已配置 + 末尾 4 位用于确认。
  response.json({
    configured: Boolean(token),
    hint: token ? `••••${token.slice(-4)}` : "",
  });
});

app.put("/api/collection/civitai-token", (request, response) => {
  const body = asPlainRecord(request.body);
  civitaiApiToken = getStringField(body, "token").trim();
  appState.set(CIVITAI_API_TOKEN_KEY, civitaiApiToken);
  void saveAppStateSoon();
  response.json({ configured: Boolean(civitaiApiToken), hint: civitaiApiToken ? `••••${civitaiApiToken.slice(-4)}` : "" });
});

app.get("/api/collection/generated-publish-settings", (_request, response) => {
  response.json(getGeneratedPublishSettings());
});

app.put("/api/collection/generated-publish-settings", (request, response) => {
  generatedPublishSettings = normalizeGeneratedPublishSettings(request.body);
  appState.set(GENERATED_PUBLISH_SETTINGS_KEY, JSON.stringify(generatedPublishSettings));
  void saveAppStateSoon();
  response.json(generatedPublishSettings);
});

app.get("/api/payment-settings", (_request, response) => {
  response.json(getPaymentSettings());
});

app.put("/api/payment-settings", (request, response) => {
  paymentSettings = normalizePaymentSettings(request.body);
  appState.set(PAYMENT_SETTINGS_KEY, JSON.stringify(paymentSettings));
  void saveAppStateSoon();
  response.json(paymentSettings);
});

app.post("/api/payments/create-order", async (request, response) => {
  const settings = getPaymentSettings();
  const body = asPlainRecord(request.body);
  const packageId = getStringField(body, "packageId");
  const userId = getStringField(body, "userId");
  const returnUrl = getStringField(body, "returnUrl");
  const pkg = getCreditPackageById(packageId);

  if (!pkg) {
    response.status(404).json({ error: "Credit package not found" });
    return;
  }
  if (!userId) {
    response.status(400).json({ error: "userId is required" });
    return;
  }

  try {
    const result = await createPaymentOrder(settings, pkg, userId, returnUrl);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/payments/fulfill", (request, response) => {
  const settings = getPaymentSettings();
  const body = asPlainRecord(request.body);
  const providedSecret = getStringField(body, "secret") || String(request.headers["x-payment-secret"] ?? "");
  if (settings.webhookSecret && providedSecret !== settings.webhookSecret) {
    response.status(401).json({ error: "Invalid payment webhook secret" });
    return;
  }

  const packageId = getStringField(body, "packageId");
  const userId = getStringField(body, "userId");
  const orderId = getStringField(body, "orderId");
  const pkg = getCreditPackageById(packageId);
  if (!pkg) {
    response.status(404).json({ error: "Credit package not found" });
    return;
  }
  if (!userId || !orderId) {
    response.status(400).json({ error: "userId and orderId are required" });
    return;
  }

  try {
    const result = fulfillPaymentOrder(pkg, userId, orderId);
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/generated-works/publish", async (request, response) => {
  const body = asPlainRecord(request.body);
  const mediaType: MediaJobType = body.mediaType === "video" ? "video" : "image";
  if (body.manual !== true) {
    response.json({ ok: true, work: null, skipped: true });
    return;
  }
  try {
    const work = await publishGeneratedWork({
      itemId: getStringField(body, "itemId") || undefined,
      projectId: getStringField(body, "projectId") || undefined,
      userId: getStringField(body, "userId") || undefined,
      mediaType,
      url: getStringField(body, "url"),
      prompt: getStringField(body, "prompt"),
      negativePrompt: getStringField(body, "negativePrompt") || undefined,
      model: getStringField(body, "model") || undefined,
      categoryId: getStringField(body, "categoryId") || undefined,
      categoryName: getStringField(body, "categoryName") || undefined,
      status: body.status === "pending" ? "pending" : body.status === "published" ? "published" : undefined,
      manual: body.manual === true,
      aspectRatio: getStringField(body, "aspectRatio") || undefined,
      width: getNumberField(body, "width"),
      height: getNumberField(body, "height"),
      resolution: getStringField(body, "resolution") || undefined,
      metadata: asPlainRecord(body.metadata),
    });
    response.json({ ok: true, work: work ? getCollectionPublicWork(work) : null });
  } catch (error) {
    response.status(500).json({ error: getErrorMessage(error) });
  }
});

type CollectedCandidate = {
  provider: CollectionProvider;
  sourceWorkId?: string;
  sourcePageUrl?: string;
  originalImageUrl: string;
  displayUrl?: string;
  thumbnailUrl?: string;
  title?: string;
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  width?: number;
  height?: number;
  nsfw?: boolean;
  tags?: string[];
  metadata?: Record<string, unknown>;
};

function getCollectionPublicWork(work: CollectionWork) {
  return {
    id: work.id,
    sourceId: work.sourceId,
    provider: work.provider,
    sourceWorkId: work.sourceWorkId,
    sourcePageUrl: work.sourcePageUrl,
    originalImageUrl: work.originalImageUrl,
    displayUrl: work.displayUrl,
    thumbnailUrl: work.thumbnailUrl,
    coverUrl: work.thumbnailUrl || work.displayUrl || work.originalImageUrl,
    title: work.title,
    prompt: work.prompt,
    negativePrompt: work.negativePrompt,
    model: work.model,
    aspectRatio: work.aspectRatio,
    width: work.width,
    height: work.height,
    categoryId: work.categoryId,
    categoryName: work.categoryName,
    tags: work.tags,
    nsfw: work.nsfw,
    status: work.status,
    failedCount: work.failedCount,
    featured: work.featured,
    featuredAt: work.featuredAt,
    collectedAt: work.collectedAt,
    publishedAt: work.publishedAt,
    recommendationScore: work.recommendationScore,
    metadata: work.metadata,
  };
}

function getCollectionCursor(work: CollectionWork) {
  return `${work.featured ? 1 : 0}:${work.featuredAt ?? 0}:${work.recommendationScore}:${work.collectedAt}:${work.id}`;
}

function compareCollectionWorks(left: CollectionWork, right: CollectionWork) {
  if (left.featured !== right.featured) return left.featured ? -1 : 1;
  if ((right.featuredAt ?? 0) !== (left.featuredAt ?? 0)) return (right.featuredAt ?? 0) - (left.featuredAt ?? 0);
  if (right.recommendationScore !== left.recommendationScore) return right.recommendationScore - left.recommendationScore;
  if (right.collectedAt !== left.collectedAt) return right.collectedAt - left.collectedAt;
  return right.id.localeCompare(left.id);
}

function filterCollectionWorks(input: { status?: string; categoryId?: string; includeNsfw?: boolean }) {
  return collectionLibrary.works
    .filter((work) => !input.status || work.status === input.status)
    .filter((work) => input.includeNsfw || !work.nsfw)
    .filter((work) => !input.categoryId || work.categoryId === input.categoryId)
    .sort(compareCollectionWorks);
}

function isAdminPublishedGeneratedWork(work: CollectionWork) {
  if (work.provider !== "generated") return true;
  const metadata = work.metadata ?? {};
  return metadata.manual === true
    || metadata.entry === "admin-collection-publish"
    || work.sourceWorkId?.startsWith("admin-generated-") === true
    || (typeof metadata.itemId === "string" && metadata.itemId.startsWith("admin-generated-"));
}

function paginateCollectionWorks(works: CollectionWork[], cursor: string | undefined, limit: number) {
  const startIndex = cursor ? works.findIndex((work) => getCollectionCursor(work) === cursor) + 1 : 0;
  const safeStart = Math.max(0, startIndex);
  const items = works.slice(safeStart, safeStart + limit);
  const last = items.at(-1);
  return {
    items,
    nextCursor: last && safeStart + items.length < works.length ? getCollectionCursor(last) : undefined,
    hasMore: safeStart + items.length < works.length,
  };
}

async function collectFromLexica(query: string, limit: number): Promise<CollectedCandidate[]> {
  try {
    for (const variant of buildLexicaQueryVariants(query)) {
      const candidates = await fetchLexicaApiCandidates(variant, limit);
      if (candidates.length > 0) return candidates;
    }
  } catch (error) {
    console.warn("[collection] lexica api failed, fallback to html", getErrorMessage(error));
  }

  const html = await fetchTextWithPowerShellFallback(`https://lexica.art/?q=${encodeURIComponent(query)}`);
  const extracted = extractLexicaPromptFromHtml(html);
  if (!extracted.imageUrl) return [];
  const prompt = extracted.promptText || query;
  return [{
    provider: "lexica",
    sourceWorkId: extracted.promptId || extracted.imageUrl,
    sourcePageUrl: extracted.promptId ? `https://lexica.art/prompt/${extracted.promptId}` : `https://lexica.art/?q=${encodeURIComponent(query)}`,
    originalImageUrl: extracted.imageUrl,
    displayUrl: extracted.imageUrl,
    title: createCollectionTitle(prompt, "lexica"),
    prompt,
    model: "lexica-web",
    nsfw: false,
    metadata: { source: "html-fallback", query, extracted },
  }];
}

// Civitai REST API v1 已彻底移除 meta（prompt 等），但网站使用的 tRPC 接口
// image.getGenerationData 在带 token 时仍返回 prompt/negativePrompt/resources。
async function fetchCivitaiGenerationData(imageId: string): Promise<{
  prompt?: string;
  negativePrompt?: string;
  model?: string;
  meta?: Record<string, unknown>;
} | null> {
  const input = encodeURIComponent(JSON.stringify({ json: { id: Number(imageId) || imageId, type: "image" } }));
  const targetUrl = `https://civitai.com/api/trpc/image.getGenerationData?input=${input}`;
  const raw = asPlainRecord(await fetchJsonWithPowerShellFallback(targetUrl));
  const data = asPlainRecord(asPlainRecord(asPlainRecord(raw.result).data).json);
  const meta = asPlainRecord(data.meta);
  const prompt = getStringField(meta, "prompt") || undefined;
  const negativePrompt = getStringField(meta, "negativePrompt") || undefined;
  const resources = Array.isArray(data.resources) ? data.resources.map(asPlainRecord) : [];
  const model = resources.map((resource) => getStringField(resource, "modelName")).filter(Boolean).join(", ") || undefined;
  if (!prompt && !negativePrompt && !model) return null;
  return { prompt, negativePrompt, model, meta };
}

function parseCivitaiCollectedCandidate(record: Record<string, unknown>, fallbackImageUrl?: string): CollectedCandidate | null {
  const originalImageUrl = normalizeUrl(record.url) || normalizeUrl(fallbackImageUrl);
  if (!originalImageUrl) return null;
  const meta = asPlainRecord(record.meta);
  const width = getNumberField(record, "width");
  const height = getNumberField(record, "height");
  const prompt = getCollectionPrompt(record) || getCollectionPrompt(meta);
  const resources = Array.isArray(record.resources) ? record.resources.map(asPlainRecord) : [];
  const baseModel = getStringField(record, "baseModel");
  const username = getStringField(record, "username");
  const model = resources.map((resource) => getStringField(resource, "name")).filter(Boolean).join(", ") || getStringField(meta, "Model") || baseModel || undefined;
  // 无 token 时 Civitai 不返回 prompt，用 prompt 首行→baseModel/作者→默认 的顺序生成可读标题。
  const promptTitle = prompt.split(/\r?\n/, 1)[0]?.trim().replace(/\s+/g, " ") || "";
  const title = (promptTitle ? Array.from(promptTitle).slice(0, 28).join("") : "")
    || [baseModel, username && `@${username}`].filter(Boolean).join(" · ")
    || "Civitai 采集作品";
  return {
    provider: "civitai",
    sourceWorkId: getStringField(record, "id") || originalImageUrl,
    sourcePageUrl: `https://civitai.com/images/${getStringField(record, "id")}`,
    originalImageUrl,
    displayUrl: originalImageUrl,
    thumbnailUrl: normalizeUrl(record.thumbnailUrl) || undefined,
    title,
    prompt,
    negativePrompt: getStringField(meta, "negativePrompt") || undefined,
    model,
    width,
    height,
    nsfw: record.nsfw === true || record.nsfwLevel === "X" || record.nsfwLevel === "XXX",
    tags: [...resources.map((resource) => getStringField(resource, "type")).filter(Boolean), ...(baseModel ? [baseModel] : [])],
    metadata: record,
  };
}

async function collectFromCivitai(query: string, limit: number): Promise<CollectedCandidate[]> {
  return collectFromCivitaiWithCursor(query, limit, undefined).then((result) => result.candidates);
}

function normalizeCivitaiSort(value: unknown): CivitaiSort {
  return CIVITAI_SORTS.includes(value as CivitaiSort) ? (value as CivitaiSort) : "Most Reactions";
}

function normalizeCivitaiPeriod(value: unknown): CivitaiPeriod {
  return CIVITAI_PERIODS.includes(value as CivitaiPeriod) ? (value as CivitaiPeriod) : "Month";
}

async function collectFromCivitaiWithCursor(
  query: string,
  limit: number,
  cursor?: string,
  options?: { sort?: CivitaiSort; period?: CivitaiPeriod }
): Promise<{ candidates: CollectedCandidate[]; nextCursor?: string }> {
  const sort = normalizeCivitaiSort(options?.sort);
  const period = normalizeCivitaiPeriod(options?.period);
  // Civitai 忽略 query/tags 过滤，只按 sort+period 翻页，因此这里不再循环关键词变体。
  const params = new URLSearchParams({
    limit: String(Math.max(1, Math.min(100, limit))),
    sort,
    period,
  });
  if (cursor) params.set("cursor", cursor);
  const targetUrl = `https://civitai.com/api/v1/images?${params.toString()}`;
  const data = asPlainRecord(await fetchJsonWithPowerShellFallback(targetUrl));
  const items = Array.isArray(data.items) ? data.items : [];
  const metadata = asPlainRecord(data.metadata);
  const nextCursor = getStringField(metadata, "nextCursor") || undefined;
  const usedQuery = `${sort} · ${period}`;
  const listed = items.slice(0, limit).map((item): CollectedCandidate | null => parseCivitaiCollectedCandidate(asPlainRecord(item))).filter((item): item is CollectedCandidate => Boolean(item));

  // Civitai 对匿名请求隐藏 meta（prompt 等），只有配置了 API token 时详情接口才会返回。
  // 没有 token 时富化没有意义，反而会把入库数量限制在 COLLECTION_DETAIL_ENRICH_LIMIT 条，
  // 因此仅在有 token 时富化；否则直接用列表数据，让 maxItemsPerRun 全量生效。
  const canEnrich = Boolean(getCivitaiApiToken()) && COLLECTION_DETAIL_ENRICH_LIMIT > 0;
  if (canEnrich) {
    const enrichedById = new Map<string, { prompt?: string; negativePrompt?: string; model?: string; meta?: Record<string, unknown> }>();
    const enrichItems = items.slice(0, Math.min(limit, COLLECTION_DETAIL_ENRICH_LIMIT));
    for (const item of enrichItems) {
      const record = asPlainRecord(item);
      const imageId = getStringField(record, "id");
      if (!imageId) continue;
      try {
        const gen = await fetchCivitaiGenerationData(imageId);
        if (gen) enrichedById.set(imageId, gen);
      } catch {
        // 富化失败时保留列表里的基础数据，下面会用 listed 兜底。
      }
    }
    // 把 tRPC 拿到的 prompt 合并回列表项；未富化或无 prompt 的保留基础数据，保证返回数量 = maxItemsPerRun。
    const candidates = listed.map((candidate) => {
      const id = candidate.sourceWorkId ?? "";
      const gen = enrichedById.get(id);
      const prompt = gen?.prompt || candidate.prompt || "";
      const promptTitle = prompt.split(/\r?\n/, 1)[0]?.trim().replace(/\s+/g, " ") || "";
      return {
        ...candidate,
        prompt,
        negativePrompt: gen?.negativePrompt || candidate.negativePrompt,
        model: gen?.model || candidate.model,
        title: promptTitle ? Array.from(promptTitle).slice(0, 28).join("") : candidate.title,
        metadata: { ...(candidate.metadata ?? {}), collectionQuery: query, usedQuery, genMeta: gen?.meta },
      };
    });
    return { candidates, nextCursor };
  }

  const candidates = listed.map((candidate) => ({ ...candidate, metadata: { ...(candidate.metadata ?? {}), collectionQuery: query, usedQuery } }));
  return { candidates, nextCursor };
}

async function collectCandidates(source: CollectionSource) {
  if (source.provider === "lexica") return collectFromLexica(source.query, source.maxItemsPerRun);
  const result = await collectFromCivitaiWithCursor(source.query, source.maxItemsPerRun, source.cursor, {
    sort: source.sort,
    period: source.period,
  });
  source.cursor = result.nextCursor;
  return result.candidates;
}

async function classifyCollectedCandidateWithVision(candidate: CollectedCandidate) {
  const settings = getCollectionClassifierSettings();
  if (!settings.enabled || !settings.modelId || !settings.provider) return null;
  try {
    const resolvedImageUrl = await resolveAgentImageUrl(candidate.displayUrl || candidate.originalImageUrl);
    const payload = {
      model: settings.modelId,
      messages: [
        { role: "system", content: settings.classificationPrompt },
        {
          role: "user",
          content: [
            {
              type: "text",
              text: [
                `prompt: ${candidate.prompt || ""}`,
                `model: ${candidate.model || ""}`,
                `tags: ${(candidate.tags ?? []).join(", ")}`,
                `size: ${candidate.width || ""}x${candidate.height || ""}`,
              ].join("\n"),
            },
            { type: "image_url", image_url: { url: resolvedImageUrl } },
          ],
        },
      ],
      temperature: 0,
      max_tokens: 240,
    };
    const apiResponse = await fetch(buildEndpoint(settings.provider.baseUrl, "/chat/completions"), {
      method: "POST",
      headers: buildProviderHeaders(settings.provider, "application/json", "application/json"),
      body: JSON.stringify(payload),
    });
    if (!apiResponse.ok) {
      const text = await apiResponse.text();
      throw new Error(`vision model failed: ${apiResponse.status} ${text.slice(0, 500)}`);
    }
    const data = await apiResponse.json();
    return parseCollectionVisionClassification(extractAgentResponseContent(data));
  } catch (error) {
    console.warn("[collection] vision classification failed", {
      provider: candidate.provider,
      sourceWorkId: candidate.sourceWorkId,
      error: getErrorMessage(error),
    });
    return null;
  }
}

async function upsertCollectedCandidates(source: CollectionSource, candidates: CollectedCandidate[]) {
  const now = Date.now();
  let added = 0;
  let skipped = 0;
  const existingKeys = new Set(collectionLibrary.works.flatMap((work) => [
    `${work.provider}:id:${work.sourceWorkId ?? ""}`,
    `${work.provider}:url:${work.originalImageUrl}`,
  ]));

  for (const candidate of candidates) {
    if (source.filterNsfw && candidate.nsfw) {
      skipped += 1;
      continue;
    }
    const sourceKey = `${candidate.provider}:id:${candidate.sourceWorkId ?? ""}`;
    const urlKey = `${candidate.provider}:url:${candidate.originalImageUrl}`;
    if (existingKeys.has(sourceKey) || existingKeys.has(urlKey)) {
      skipped += 1;
      continue;
    }
    const tags = [...new Set([...(candidate.tags ?? []), ...source.targetTags])].slice(0, 24);
    const visionCategory = await classifyCollectedCandidateWithVision(candidate);
    const category = visionCategory || classifyCollectionWork({
      prompt: candidate.prompt,
      model: candidate.model,
      tags,
      fallbackId: source.targetCategoryId,
      fallbackName: source.targetCategoryName,
    });
    const status: CollectionWorkStatus = source.autoPublish ? "published" : "pending";
    const work: CollectionWork = {
      id: createId("cw"),
      sourceId: source.id,
      provider: candidate.provider,
      sourceWorkId: candidate.sourceWorkId,
      sourcePageUrl: candidate.sourcePageUrl,
      originalImageUrl: candidate.originalImageUrl,
      displayUrl: candidate.displayUrl || candidate.originalImageUrl,
      thumbnailUrl: candidate.thumbnailUrl,
      title: candidate.title || createCollectionTitle(candidate.prompt ?? "", candidate.provider),
      prompt: candidate.prompt ?? "",
      negativePrompt: candidate.negativePrompt,
      model: candidate.model,
      aspectRatio: inferAspectRatio(candidate.width, candidate.height),
      width: candidate.width,
      height: candidate.height,
      categoryId: category.categoryId,
      categoryName: category.categoryName,
      tags: [...new Set([...tags, ...(visionCategory?.tags ?? [])])].slice(0, 24),
      nsfw: candidate.nsfw === true,
      qualityScore: computeCollectionScore({ width: candidate.width, height: candidate.height, nsfw: candidate.nsfw === true, collectedAt: now }),
      recommendationScore: computeCollectionScore({ width: candidate.width, height: candidate.height, nsfw: candidate.nsfw === true, collectedAt: now }),
      featured: false,
      status,
      failedCount: 0,
      metadata: { ...(candidate.metadata ?? {}), visionCategory },
      collectedAt: now,
      publishedAt: status === "published" ? now : undefined,
      createdAt: now,
      updatedAt: now,
    };
    collectionLibrary.works.push(work);
    existingKeys.add(sourceKey);
    existingKeys.add(urlKey);
    added += 1;
  }

  source.lastRunAt = now;
  source.updatedAt = now;
  return { added, skipped };
}

async function runCollectionSourceNow(source: CollectionSource) {
  const run: CollectionRun = {
    id: createId("cr"),
    sourceId: source.id,
    provider: source.provider,
    query: source.query,
    status: "running",
    fetched: 0,
    added: 0,
    skipped: 0,
    startedAt: Date.now(),
  };
  collectionLibrary.runs.unshift(run);
  collectionLibrary.runs = collectionLibrary.runs.slice(0, 300);
  void saveCollectionLibrarySoon();

  try {
    const candidates = await withTimeout(
      collectCandidates(source),
      COLLECTION_RUN_TIMEOUT_MS,
      `collection run timed out after ${Math.round(COLLECTION_RUN_TIMEOUT_MS / 1000)}s`
    );
    const result = await upsertCollectedCandidates(source, candidates);
    run.status = "completed";
    run.fetched = candidates.length;
    run.added = result.added;
    run.skipped = result.skipped;
    run.finishedAt = Date.now();
    void saveCollectionLibrarySoon();
    return { ok: true as const, fetched: candidates.length, ...result, source, run };
  } catch (error) {
    run.status = "failed";
    run.error = getErrorMessage(error);
    run.finishedAt = Date.now();
    void saveCollectionLibrarySoon();
    throw error;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string) {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
    timeout.unref?.();
  });
  return Promise.race([promise, timeoutPromise]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
}

function processCollectionQueue() {
  while (runningCollectionJobs < COLLECTION_QUEUE_CONCURRENCY && collectionJobQueue.length > 0) {
    const job = collectionJobQueue.shift();
    if (!job) return;
    runningCollectionJobs += 1;
    void runCollectionSourceNow(job.source)
      .then(job.resolve)
      .catch((error) => {
        if (job.attemptsLeft > 0) {
          const delayMs = (COLLECTION_QUEUE_RETRIES - job.attemptsLeft + 1) * 2000;
          windowlessSetTimeout(() => {
            collectionJobQueue.push({ ...job, attemptsLeft: job.attemptsLeft - 1 });
            processCollectionQueue();
          }, delayMs);
          return;
        }
        job.reject(error);
      })
      .finally(() => {
        runningCollectionJobs -= 1;
        queuedCollectionSourceIds.delete(job.source.id);
        processCollectionQueue();
      });
  }
}

function windowlessSetTimeout(callback: () => void, delayMs: number) {
  setTimeout(callback, delayMs).unref?.();
}

function runCollectionSourceQueued(source: CollectionSource) {
  if (queuedCollectionSourceIds.has(source.id)) {
    return Promise.reject(new Error("source is already queued or running"));
  }
  queuedCollectionSourceIds.add(source.id);
  return new Promise<Awaited<ReturnType<typeof runCollectionSourceNow>>>((resolve, reject) => {
    collectionJobQueue.push({ source, attemptsLeft: COLLECTION_QUEUE_RETRIES, resolve, reject });
    processCollectionQueue();
  });
}

app.get("/api/collection/sources", (_request, response) => {
  response.json({ sources: collectionLibrary.sources });
});

app.get("/api/collection/runs", (request, response) => {
  const sourceId = typeof request.query.sourceId === "string" ? request.query.sourceId : undefined;
  const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "30", 10);
  const limit = Math.max(1, Math.min(100, Number.isFinite(limitValue) ? limitValue : 30));
  const runs = collectionLibrary.runs
    .filter((run) => !sourceId || run.sourceId === sourceId)
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(0, limit);
  response.json({ runs });
});

app.delete("/api/collection/runs", (request, response) => {
  const sourceId = typeof request.query.sourceId === "string" ? request.query.sourceId : undefined;
  const before = collectionLibrary.runs.length;
  const removedIds = collectionLibrary.runs
    .filter((run) => (!sourceId || run.sourceId === sourceId) && run.status !== "running")
    .map((run) => run.id);
  collectionLibrary.runs = collectionLibrary.runs.filter((run) => !removedIds.includes(run.id));
  if (isPostgresEnabled() && removedIds.length > 0) {
    void queryPostgres("delete from collection_runs where id = any($1::text[])", [removedIds]).catch(() => undefined);
  }
  void saveCollectionLibrarySoon();
  response.json({ ok: true, deleted: before - collectionLibrary.runs.length });
});

app.delete("/api/collection/runs/:id", (request, response) => {
  const run = collectionLibrary.runs.find((item) => item.id === request.params.id);
  if (!run) {
    response.status(404).json({ error: "run not found" });
    return;
  }
  if (run.status === "running") {
    response.status(400).json({ error: "run is still running" });
    return;
  }
  collectionLibrary.runs = collectionLibrary.runs.filter((item) => item.id !== request.params.id);
  if (isPostgresEnabled()) {
    void queryPostgres("delete from collection_runs where id = $1", [request.params.id]).catch(() => undefined);
  }
  void saveCollectionLibrarySoon();
  response.json({ ok: true, deleted: true });
});

app.post("/api/collection/sources", (request, response) => {
  const body = asPlainRecord(request.body);
  const provider = normalizeCollectionProvider(body.provider);
  const query = getStringField(body, "query");
  if (!provider || !query) {
    response.status(400).json({ error: "provider and query are required" });
    return;
  }
  const now = Date.now();
  const source: CollectionSource = {
    id: createId("cs"),
    provider,
    name: getStringField(body, "name") || `${provider} ${query}`,
    query,
    enabled: body.enabled !== false,
    sort: provider === "civitai" ? normalizeCivitaiSort(body.sort) : undefined,
    period: provider === "civitai" ? normalizeCivitaiPeriod(body.period) : undefined,
    targetCategoryId: getStringField(body, "targetCategoryId") || undefined,
    targetCategoryName: getStringField(body, "targetCategoryName") || undefined,
    targetTags: normalizeStringArray(body.targetTags),
    autoPublish: body.autoPublish === true,
    filterNsfw: body.filterNsfw !== false,
    maxItemsPerRun: Math.max(1, Math.min(200, Math.round(getNumberField(body, "maxItemsPerRun") ?? 50))),
    scheduleEveryHours: getNumberField(body, "scheduleEveryHours"),
    createdAt: now,
    updatedAt: now,
  };
  collectionLibrary.sources.push(source);
  void saveCollectionLibrarySoon();
  response.status(201).json({ source });
});

app.patch("/api/collection/sources/:id", (request, response) => {
  const source = collectionLibrary.sources.find((item) => item.id === request.params.id);
  if (!source) {
    response.status(404).json({ error: "source not found" });
    return;
  }
  const body = asPlainRecord(request.body);
  const provider = body.provider === undefined ? source.provider : normalizeCollectionProvider(body.provider);
  if (!provider) {
    response.status(400).json({ error: "invalid provider" });
    return;
  }
  source.provider = provider;
  if (body.name !== undefined) source.name = getStringField(body, "name") || source.name;
  if (body.query !== undefined) source.query = getStringField(body, "query") || source.query;
  if (body.enabled !== undefined) source.enabled = body.enabled !== false;
  if (body.sort !== undefined) source.sort = normalizeCivitaiSort(body.sort);
  if (body.period !== undefined) source.period = normalizeCivitaiPeriod(body.period);
  if (body.targetCategoryId !== undefined) source.targetCategoryId = getStringField(body, "targetCategoryId") || undefined;
  if (body.targetCategoryName !== undefined) source.targetCategoryName = getStringField(body, "targetCategoryName") || undefined;
  if (body.targetTags !== undefined) source.targetTags = normalizeStringArray(body.targetTags);
  if (body.autoPublish !== undefined) source.autoPublish = body.autoPublish === true;
  if (body.filterNsfw !== undefined) source.filterNsfw = body.filterNsfw !== false;
  if (body.maxItemsPerRun !== undefined) source.maxItemsPerRun = Math.max(1, Math.min(200, Math.round(getNumberField(body, "maxItemsPerRun") ?? source.maxItemsPerRun)));
  if (body.scheduleEveryHours !== undefined) {
    const next = getNumberField(body, "scheduleEveryHours");
    source.scheduleEveryHours = next && next > 0 ? Math.max(1, Math.min(24 * 30, next)) : undefined;
  }
  if (body.cursor !== undefined) source.cursor = getStringField(body, "cursor") || undefined;
  source.updatedAt = Date.now();
  void saveCollectionLibrarySoon();
  response.json({ source });
});

app.delete("/api/collection/sources/:id", (request, response) => {
  const before = collectionLibrary.sources.length;
  collectionLibrary.sources = collectionLibrary.sources.filter((source) => source.id !== request.params.id);
  if (isPostgresEnabled()) {
    void queryPostgres("update collection_sources set deleted_at = now(), updated_at = now() where id = $1", [request.params.id]).catch(() => undefined);
  }
  void saveCollectionLibrarySoon();
  response.json({ ok: true, deleted: before !== collectionLibrary.sources.length });
});

app.post("/api/collection/sources/:id/run", async (request, response) => {
  const source = collectionLibrary.sources.find((item) => item.id === request.params.id);
  if (!source) {
    response.status(404).json({ error: "source not found" });
    return;
  }
  if (!source.enabled) {
    response.status(400).json({ error: "source is disabled" });
    return;
  }
  try {
    const result = await runCollectionSourceQueued(source);
    response.json(result);
  } catch (error) {
    response.status(502).json({ error: getErrorMessage(error) });
  }
});

app.post("/api/collection/run-enabled", async (_request, response) => {
  const sources = collectionLibrary.sources.filter((source) => source.enabled);
  const results: Array<{ sourceId: string; ok: boolean; fetched?: number; added?: number; skipped?: number; error?: string }> = [];
  for (const source of sources) {
    try {
      const result = await runCollectionSourceQueued(source);
      results.push({ sourceId: source.id, ok: true, fetched: result.fetched, added: result.added, skipped: result.skipped });
    } catch (error) {
      results.push({ sourceId: source.id, ok: false, error: getErrorMessage(error) });
    }
  }
  response.json({ ok: true, results });
});

app.get("/api/collection/works", (request, response) => {
  const status = typeof request.query.status === "string" ? request.query.status : undefined;
  const categoryId = typeof request.query.categoryId === "string" ? request.query.categoryId : undefined;
  const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
  const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "30", 10);
  const limit = Math.max(1, Math.min(60, Number.isFinite(limitValue) ? limitValue : 30));
  const includeNsfw = request.query.includeNsfw === "1";
  const filtered = filterCollectionWorks({ status, categoryId, includeNsfw });
  const page = paginateCollectionWorks(filtered, cursor, limit);
  response.json({
    items: page.items.map(getCollectionPublicWork),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
});

app.get("/api/collection/works/:id", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work || work.status === "broken" || work.status === "rejected" || !isAdminPublishedGeneratedWork(work)) {
    response.status(404).json({ error: "work not found" });
    return;
  }
  response.json({ work: getCollectionPublicWork(work) });
});

app.get("/api/collection/works/:id/related", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work || work.status === "broken" || work.status === "rejected" || !isAdminPublishedGeneratedWork(work)) {
    response.status(404).json({ error: "work not found" });
    return;
  }

  const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "8", 10);
  const limit = Math.max(1, Math.min(12, Number.isFinite(limitValue) ? limitValue : 8));
  const tags = new Set(work.tags.map((tag) => tag.toLowerCase()));

  const related = collectionLibrary.works
    .filter((item) => item.id !== work.id)
    .filter((item) => item.status === "published" && !item.nsfw)
    .filter(isAdminPublishedGeneratedWork)
    .map((item) => {
      const sharedTags = item.tags.reduce((count, tag) => count + (tags.has(tag.toLowerCase()) ? 1 : 0), 0);
      const categoryMatch = item.categoryId === work.categoryId ? 3 : 0;
      return { item, score: categoryMatch + sharedTags };
    })
    .filter((entry) => entry.score > 0)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      return compareCollectionWorks(left.item, right.item);
    })
    .slice(0, limit)
    .map((entry) => getCollectionPublicWork(entry.item));

  response.json({ items: related });
});

app.patch("/api/collection/works/:id", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work) {
    response.status(404).json({ error: "work not found" });
    return;
  }
  const body = asPlainRecord(request.body);
  if (body.title !== undefined) work.title = getStringField(body, "title") || work.title;
  if (body.prompt !== undefined) work.prompt = getStringField(body, "prompt");
  if (body.negativePrompt !== undefined) work.negativePrompt = getStringField(body, "negativePrompt") || undefined;
  if (body.model !== undefined) work.model = getStringField(body, "model") || undefined;
  if (body.categoryId !== undefined) work.categoryId = getStringField(body, "categoryId") || work.categoryId;
  if (body.categoryName !== undefined) work.categoryName = getStringField(body, "categoryName") || work.categoryName;
  if (body.tags !== undefined) work.tags = normalizeStringArray(body.tags);
  if (body.displayUrl !== undefined) work.displayUrl = normalizeUrl(body.displayUrl) || work.displayUrl;
  if (body.thumbnailUrl !== undefined) work.thumbnailUrl = normalizeUrl(body.thumbnailUrl) || undefined;
  if (body.sourcePageUrl !== undefined) work.sourcePageUrl = normalizeUrl(body.sourcePageUrl) || undefined;
  if (body.featured !== undefined) {
    const nextFeatured = body.featured === true;
    work.featured = nextFeatured;
    work.featuredAt = nextFeatured ? Date.now() : undefined;
  }
  work.updatedAt = Date.now();
  void saveCollectionLibrarySoon();
  response.json({ work: getCollectionPublicWork(work) });
});

app.post("/api/collection/works/batch", (request, response) => {
  const body = asPlainRecord(request.body);
  const ids = normalizeStringArray(body.ids, []).slice(0, 200);
  const action = getStringField(body, "action");
  if (ids.length === 0 || !["publish", "reject", "delete"].includes(action)) {
    response.status(400).json({ error: "ids and action are required" });
    return;
  }
  const idSet = new Set(ids);
  const now = Date.now();
  let affected = 0;
  if (action === "delete") {
    const before = collectionLibrary.works.length;
    collectionLibrary.works = collectionLibrary.works.filter((work) => !idSet.has(work.id));
    affected = before - collectionLibrary.works.length;
    if (isPostgresEnabled()) {
      void queryPostgres("update collection_works set deleted_at = now(), updated_at = now() where id = any($1::text[])", [ids]).catch(() => undefined);
    }
  } else {
    for (const work of collectionLibrary.works) {
      if (!idSet.has(work.id)) continue;
      work.status = action === "publish" ? "published" : "rejected";
      if (action === "publish") work.publishedAt = work.publishedAt ?? now;
      work.updatedAt = now;
      affected += 1;
    }
  }
  void saveCollectionLibrarySoon();
  response.json({ ok: true, affected });
});

app.post("/api/collection/works/:id/publish", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work) {
    response.status(404).json({ error: "work not found" });
    return;
  }
  const now = Date.now();
  work.status = "published";
  work.publishedAt = work.publishedAt ?? now;
  work.updatedAt = now;
  void saveCollectionLibrarySoon();
  response.json({ work: getCollectionPublicWork(work) });
});

app.post("/api/collection/works/:id/reject", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work) {
    response.status(404).json({ error: "work not found" });
    return;
  }
  work.status = "rejected";
  work.updatedAt = Date.now();
  void saveCollectionLibrarySoon();
  response.json({ work: getCollectionPublicWork(work) });
});

app.post("/api/collection/works/:id/broken", (request, response) => {
  const work = collectionLibrary.works.find((item) => item.id === request.params.id);
  if (!work) {
    response.json({ ok: true, missing: true });
    return;
  }
  work.failedCount += 1;
  work.lastFailedAt = Date.now();
  if (work.failedCount >= 2) work.status = "broken";
  work.updatedAt = Date.now();
  void saveCollectionLibrarySoon();
  response.json({ ok: true, work: getCollectionPublicWork(work) });
});

app.delete("/api/collection/works/:id", (request, response) => {
  const before = collectionLibrary.works.length;
  collectionLibrary.works = collectionLibrary.works.filter((work) => work.id !== request.params.id);
  if (isPostgresEnabled()) {
    void queryPostgres("update collection_works set deleted_at = now(), updated_at = now() where id = $1", [request.params.id]).catch(() => undefined);
  }
  void saveCollectionLibrarySoon();
  response.json({ ok: true, deleted: before !== collectionLibrary.works.length });
});

app.get("/api/feed/home", (request, response) => {
  const categoryId = typeof request.query.categoryId === "string" ? request.query.categoryId : undefined;
  const cursor = typeof request.query.cursor === "string" ? request.query.cursor : undefined;
  const limitValue = Number.parseInt(typeof request.query.limit === "string" ? request.query.limit : "30", 10);
  const limit = Math.max(1, Math.min(60, Number.isFinite(limitValue) ? limitValue : 30));
  const filtered = filterCollectionWorks({ status: "published", categoryId, includeNsfw: false }).filter(isAdminPublishedGeneratedWork);
  const page = paginateCollectionWorks(filtered, cursor, limit);
  response.json({
    items: page.items.map(getCollectionPublicWork),
    nextCursor: page.nextCursor,
    hasMore: page.hasMore,
  });
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

app.get("/api/admin/data/status", async (_request, response) => {
  try {
    response.json({
      ok: true,
      runtime: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
      database: {
        configured: isPostgresEnabled(),
        dualWrite: shouldUsePostgresDualWrite(),
        readPrimary: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
      },
      counts: getRuntimeDataCounts(),
      backups: await listDataBackups(),
    });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/admin/data/migrate-postgres", async (_request, response) => {
  if (!isPostgresEnabled()) {
    response.status(400).json({ error: "DATABASE_URL 未配置，无法迁移到 PostgreSQL。" });
    return;
  }

  try {
    const result = await migrateRuntimeDataToPostgres();
    response.json(result);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/admin/data/backups", async (_request, response) => {
  try {
    response.json({ backups: await listDataBackups() });
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.post("/api/admin/data/backups", async (_request, response) => {
  try {
    const backup = await createDataBackup();
    response.status(201).json(backup);
  } catch (error) {
    response.status(500).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.get("/api/admin/data/backups/:fileName", async (request, response) => {
  try {
    const fileName = normalizeBackupFileName(request.params.fileName);
    if (!fileName) {
      response.status(400).json({ error: "备份文件名无效。" });
      return;
    }
    const filePath = join(BACKUPS_DIR, fileName);
    await stat(filePath);
    response.download(filePath, fileName);
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
  }
});

app.delete("/api/admin/data/backups/:fileName", async (request, response) => {
  try {
    const fileName = normalizeBackupFileName(request.params.fileName);
    if (!fileName) {
      response.status(400).json({ error: "备份文件名无效。" });
      return;
    }
    await unlink(join(BACKUPS_DIR, fileName));
    response.json({ ok: true });
  } catch (error) {
    response.status(404).json({ error: error instanceof Error ? error.message : String(error) });
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
            key: buildObjectStorageKey("uploads", fileName),
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

app.post("/api/uploads/files", upload.array("files", 8), async (request, response) => {
  const files = Array.isArray(request.files) ? request.files as Express.Multer.File[] : [];
  if (!files.length) {
    response.status(400).json({ error: "files are required" });
    return;
  }

  try {
    await mkdir(UPLOADS_DIR, { recursive: true });
    const uploaded = await Promise.all(files.map(async (file) => {
      const originalExtension = extname(file.originalname).toLowerCase().replace(/[^.\w-]/g, "");
      const extension = originalExtension || ".bin";
      const fileName = `${createId("file")}${extension}`;
      const url = isObjectStorageEnabled()
        ? await putObjectStorageObject({
            key: buildObjectStorageKey("uploads", fileName),
            body: file.buffer,
            contentType: file.mimetype || "application/octet-stream",
          })
        : await saveLocalUploadFile(fileName, file.buffer);
      return {
        url,
        name: file.originalname,
        size: file.size,
        mimeType: file.mimetype || "application/octet-stream",
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

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function getStringField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return typeof value === "string" ? value.trim() : "";
}

function getDeepStringField(record: Record<string, unknown>, path: string[]) {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return "";
    current = (current as Record<string, unknown>)[key];
  }
  return typeof current === "string" ? current.trim() : "";
}

function getCollectionPrompt(record: Record<string, unknown>) {
  const candidates = [
    getStringField(record, "prompt"),
    getStringField(record, "name"),
    getStringField(record, "description"),
    getDeepStringField(record, ["meta", "prompt"]),
    getDeepStringField(record, ["meta", "Prompt"]),
    getDeepStringField(record, ["metadata", "prompt"]),
    getDeepStringField(record, ["metadata", "Prompt"]),
    getDeepStringField(record, ["data", "prompt"]),
    getDeepStringField(record, ["data", "description"]),
  ];
  return candidates.find(Boolean) || "";
}

function getNumberField(record: Record<string, unknown>, key: string) {
  const value = record[key];
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const parsed = Number.parseFloat(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

function normalizeUrl(value: unknown) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  return /^https?:\/\//i.test(trimmed) ? trimmed : "";
}

function normalizeCollectionProvider(value: unknown): CollectionProvider | null {
  return value === "civitai" || value === "lexica" || value === "generated" ? value : null;
}

function normalizeStringArray(value: unknown, fallback: string[] = []) {
  if (!Array.isArray(value)) return fallback;
  return value
    .map((item) => (typeof item === "string" ? item.trim() : ""))
    .filter(Boolean)
    .slice(0, 24);
}

function inferAspectRatio(width?: number, height?: number) {
  if (!width || !height || width <= 0 || height <= 0) return "auto";
  const ratio = width / height;
  if (Math.abs(ratio - 1) < 0.08) return "1:1";
  if (Math.abs(ratio - 16 / 9) < 0.12) return "16:9";
  if (Math.abs(ratio - 9 / 16) < 0.12) return "9:16";
  if (Math.abs(ratio - 4 / 3) < 0.1) return "4:3";
  if (Math.abs(ratio - 3 / 4) < 0.1) return "3:4";
  return width > height ? "landscape" : "portrait";
}

const COLLECTION_CATEGORY_RULES: Array<{ id: string; name: string; keywords: string[] }> = [
  { id: "portrait", name: "人像", keywords: ["portrait", "photo", "woman", "man", "face", "headshot", "fashion", "beauty", "girl", "boy"] },
  { id: "character", name: "角色", keywords: ["character", "game character", "mascot", "avatar", "chibi", "hero", "villain"] },
  { id: "scene", name: "场景", keywords: ["landscape", "interior", "architecture", "city", "room", "forest", "mountain", "street", "environment"] },
  { id: "product", name: "产品", keywords: ["product", "packaging", "sneaker", "bottle", "perfume", "furniture", "device", "watch", "bag"] },
  { id: "poster", name: "海报", keywords: ["poster", "cover", "typography", "movie poster", "advertising", "banner"] },
  { id: "illustration", name: "插画", keywords: ["illustration", "children's book", "flat", "hand drawn", "concept art", "storybook"] },
  { id: "style", name: "风格", keywords: ["watercolor", "pixel art", "clay", "low poly", "cyberpunk", "cinematic", "minimal", "film", "retro"] },
  { id: "anime", name: "二次元", keywords: ["anime", "manga", "cel shading", "waifu", "japanese animation", "kawaii"] },
  { id: "cg", name: "3D/CG", keywords: ["3d", "cgi", "render", "octane", "blender", "unreal engine", "zbrush"] },
  { id: "chinese", name: "国风", keywords: ["chinese", "hanfu", "ink", "wuxia", "guofeng", "oriental", "xianxia"] },
];

function classifyCollectionWork(input: { prompt?: string; model?: string; tags?: string[]; fallbackId?: string; fallbackName?: string }) {
  if (input.fallbackId || input.fallbackName) {
    return { categoryId: input.fallbackId || "recommended", categoryName: input.fallbackName || "推荐" };
  }
  const haystack = `${input.prompt ?? ""} ${input.model ?? ""} ${(input.tags ?? []).join(" ")}`.toLowerCase();
  const matched = COLLECTION_CATEGORY_RULES.find((rule) => rule.keywords.some((keyword) => haystack.includes(keyword)));
  return matched ? { categoryId: matched.id, categoryName: matched.name } : { categoryId: "style", categoryName: "风格" };
}

function classifyCollectionWorkConfigured(input: { prompt?: string; model?: string; tags?: string[]; fallbackId?: string; fallbackName?: string }) {
  if (input.fallbackId || input.fallbackName) {
    return { categoryId: input.fallbackId || "recommended", categoryName: input.fallbackName || "推荐" };
  }
  const settings = getGeneratedPublishSettings();
  const haystack = `${input.prompt ?? ""} ${input.model ?? ""} ${(input.tags ?? []).join(" ")}`.toLowerCase();
  const matched = settings.categories.find((rule) => rule.keywords.some((keyword) => haystack.includes(keyword.toLowerCase())));
  return matched ? { categoryId: matched.id, categoryName: matched.name } : { categoryId: settings.defaultCategoryId, categoryName: settings.defaultCategoryName };
}

function createCollectionTitle(prompt: string, provider: CollectionProvider) {
  const firstLine = prompt.split(/\r?\n/, 1)[0]?.trim().replace(/\s+/g, " ") || "";
  if (firstLine) return Array.from(firstLine).slice(0, 28).join("");
  return provider === "civitai" ? "Civitai 采集作品" : provider === "lexica" ? "Lexica 采集作品" : "AI 作品";
}

function computeCollectionScore(input: { width?: number; height?: number; nsfw: boolean; collectedAt: number; failedCount?: number }) {
  const pixels = (input.width ?? 0) * (input.height ?? 0);
  const quality = Math.min(40, Math.round(pixels / 120000));
  const freshHours = Math.max(0, (Date.now() - input.collectedAt) / 1000 / 60 / 60);
  const freshness = Math.max(0, 40 - freshHours / 6);
  return Math.round((quality + freshness + (input.nsfw ? -80 : 20) - (input.failedCount ?? 0) * 30) * 100) / 100;
}

async function publishGeneratedWork(input: {
  itemId?: string;
  projectId?: string;
  userId?: string;
  mediaType: MediaJobType;
  url: string;
  prompt: string;
  negativePrompt?: string;
  model?: string;
  categoryId?: string;
  categoryName?: string;
  status?: "pending" | "published";
  manual?: boolean;
  aspectRatio?: string;
  width?: number;
  height?: number;
  resolution?: string;
  metadata?: Record<string, unknown>;
}) {
  const settings = getGeneratedPublishSettings();
  if (!input.manual && !settings.enabled) return null;
  if (!input.manual && !settings.mediaTypes.includes(input.mediaType)) return null;
  if (!input.url || !input.prompt.trim()) return null;
  const displayUrl = normalizeUrl(input.url) || getLocalUploadPathFromUrl(input.url) || input.url;
  if (!displayUrl) return null;

  const existing = collectionLibrary.works.find((work) =>
    work.provider === "generated" &&
    (work.sourceWorkId === input.itemId || work.originalImageUrl === displayUrl || work.displayUrl === displayUrl)
  );
  if (existing) return existing;

  const category = classifyCollectionWorkConfigured({
    prompt: input.prompt,
    model: input.model,
    tags: [],
    fallbackId: input.categoryId,
    fallbackName: input.categoryName,
  });
  const status = input.status ?? (settings.autoPublish ? "published" : "pending");
  const now = Date.now();
  const work: CollectionWork = {
    id: createId("cw"),
    sourceId: undefined,
    provider: "generated",
    sourceWorkId: input.itemId || displayUrl,
    sourcePageUrl: undefined,
    originalImageUrl: displayUrl,
    displayUrl,
    title: createCollectionTitle(input.prompt, "generated"),
    prompt: input.prompt,
    negativePrompt: input.negativePrompt,
    model: input.model,
    aspectRatio: input.aspectRatio || inferAspectRatio(input.width, input.height),
    width: input.width,
    height: input.height,
    categoryId: category.categoryId,
    categoryName: category.categoryName,
    tags: [],
    nsfw: false,
    qualityScore: computeCollectionScore({ width: input.width, height: input.height, nsfw: false, collectedAt: now }),
    recommendationScore: computeCollectionScore({ width: input.width, height: input.height, nsfw: false, collectedAt: now }),
    featured: false,
    status,
    failedCount: 0,
    metadata: {
      source: "generated",
      manual: input.manual === true,
      itemId: input.itemId,
      projectId: input.projectId,
      userId: input.userId,
      mediaType: input.mediaType,
      resolution: input.resolution,
      ...(input.metadata ?? {}),
    },
    collectedAt: now,
    publishedAt: status === "published" ? now : undefined,
    createdAt: now,
    updatedAt: now,
  };
  collectionLibrary.works.push(work);
  void saveCollectionLibrarySoon();
  return work;
}

function normalizeCollectionLibraryFromFile(value: unknown): CollectionLibrary {
  const raw = asPlainRecord(value);
  const sources = Array.isArray(raw.sources) ? raw.sources.map((item): CollectionSource | null => {
    const record = asPlainRecord(item);
    const provider = normalizeCollectionProvider(record.provider);
    const id = getStringField(record, "id");
    const query = getStringField(record, "query");
    if (!provider || !id || !query) return null;
    const now = Date.now();
    return {
      id,
      provider,
      name: getStringField(record, "name") || `${provider} ${query}`,
      query,
      enabled: record.enabled !== false,
      sort: provider === "civitai" ? normalizeCivitaiSort(record.sort) : undefined,
      period: provider === "civitai" ? normalizeCivitaiPeriod(record.period) : undefined,
      targetCategoryId: getStringField(record, "targetCategoryId") || undefined,
      targetCategoryName: getStringField(record, "targetCategoryName") || undefined,
      targetTags: normalizeStringArray(record.targetTags),
      autoPublish: record.autoPublish === true,
      filterNsfw: record.filterNsfw !== false,
      maxItemsPerRun: Math.max(1, Math.min(200, Math.round(getNumberField(record, "maxItemsPerRun") ?? 50))),
      scheduleEveryHours: getNumberField(record, "scheduleEveryHours"),
      lastRunAt: getNumberField(record, "lastRunAt"),
      cursor: getStringField(record, "cursor") || undefined,
      createdAt: getNumberField(record, "createdAt") ?? now,
      updatedAt: getNumberField(record, "updatedAt") ?? now,
    };
  }).filter((item): item is CollectionSource => Boolean(item)) : [];

  const works = Array.isArray(raw.works) ? raw.works.map((item): CollectionWork | null => {
    const record = asPlainRecord(item);
    const provider = normalizeCollectionProvider(record.provider);
    const id = getStringField(record, "id");
    const originalImageUrl = normalizeUrl(record.originalImageUrl);
    const displayUrl = normalizeUrl(record.displayUrl) || originalImageUrl;
    if (!provider || !id || !displayUrl) return null;
    const now = Date.now();
    const width = getNumberField(record, "width");
    const height = getNumberField(record, "height");
    const collectedAt = getNumberField(record, "collectedAt") ?? now;
    const nsfw = record.nsfw === true;
    const failedCount = Math.max(0, Math.round(getNumberField(record, "failedCount") ?? 0));
    const statusValue = getStringField(record, "status");
    const status: CollectionWorkStatus = statusValue === "pending" || statusValue === "published" || statusValue === "rejected" || statusValue === "broken" ? statusValue : "pending";
    return {
      id,
      sourceId: getStringField(record, "sourceId") || undefined,
      provider,
      sourceWorkId: getStringField(record, "sourceWorkId") || undefined,
      sourcePageUrl: normalizeUrl(record.sourcePageUrl) || undefined,
      originalImageUrl: originalImageUrl || displayUrl,
      displayUrl,
      thumbnailUrl: normalizeUrl(record.thumbnailUrl) || undefined,
      title: getStringField(record, "title") || createCollectionTitle(getCollectionPrompt(record), provider),
      prompt: getCollectionPrompt(record),
      negativePrompt: getStringField(record, "negativePrompt") || undefined,
      model: getStringField(record, "model") || undefined,
      aspectRatio: getStringField(record, "aspectRatio") || inferAspectRatio(width, height),
      width,
      height,
      categoryId: getStringField(record, "categoryId") || "style",
      categoryName: getStringField(record, "categoryName") || "风格",
      tags: normalizeStringArray(record.tags),
      nsfw,
      qualityScore: getNumberField(record, "qualityScore") ?? 0,
      recommendationScore: getNumberField(record, "recommendationScore") ?? computeCollectionScore({ width, height, nsfw, collectedAt, failedCount }),
      featured: record.featured === true,
      featuredAt: getNumberField(record, "featuredAt"),
      status,
      failedCount,
      lastFailedAt: getNumberField(record, "lastFailedAt"),
      metadata: asPlainRecord(record.metadata),
      collectedAt,
      publishedAt: getNumberField(record, "publishedAt"),
      createdAt: getNumberField(record, "createdAt") ?? collectedAt,
      updatedAt: getNumberField(record, "updatedAt") ?? now,
    };
  }).filter((item): item is CollectionWork => Boolean(item)) : [];

  const runs = Array.isArray(raw.runs) ? raw.runs.map((item): CollectionRun | null => {
    const record = asPlainRecord(item);
    const provider = normalizeCollectionProvider(record.provider);
    const id = getStringField(record, "id");
    const sourceId = getStringField(record, "sourceId");
    const statusValue = getStringField(record, "status");
    const status: CollectionRun["status"] = statusValue === "running" || statusValue === "completed" || statusValue === "failed" ? statusValue : "completed";
    if (!provider || !id || !sourceId) return null;
    return {
      id,
      sourceId,
      provider,
      query: getStringField(record, "query"),
      status,
      fetched: Math.max(0, Math.round(getNumberField(record, "fetched") ?? 0)),
      added: Math.max(0, Math.round(getNumberField(record, "added") ?? 0)),
      skipped: Math.max(0, Math.round(getNumberField(record, "skipped") ?? 0)),
      error: getStringField(record, "error") || undefined,
      startedAt: getNumberField(record, "startedAt") ?? Date.now(),
      finishedAt: getNumberField(record, "finishedAt"),
    };
  }).filter((item): item is CollectionRun => Boolean(item)) : [];

  return { sources, works, runs };
}

async function loadCollectionLibraryFromPostgres() {
  if (!isPostgresEnabled()) return null;
  try {
    const [sourcesResult, worksResult, runsResult] = await Promise.all([
      queryPostgres<{ raw_source: unknown }>("select raw_source from collection_sources where deleted_at is null order by created_at asc"),
      queryPostgres<{ raw_work: unknown }>("select to_jsonb(collection_works.*) as raw_work from collection_works where deleted_at is null order by collected_at desc"),
      queryPostgres<{ raw_run: unknown }>("select raw_run from collection_runs order by started_at desc limit 300"),
    ]);
    return normalizeCollectionLibraryFromFile({
      sources: sourcesResult.rows.map((row) => row.raw_source).filter(Boolean),
      works: worksResult.rows.map((row) => {
        const record = asPlainRecord(row.raw_work);
        return {
          ...record,
          sourceId: getStringField(record, "source_id"),
          sourceWorkId: getStringField(record, "source_work_id"),
          sourcePageUrl: getStringField(record, "source_page_url"),
          originalImageUrl: getStringField(record, "original_image_url"),
          displayUrl: getStringField(record, "display_url"),
          thumbnailUrl: getStringField(record, "thumbnail_url"),
          negativePrompt: getStringField(record, "negative_prompt"),
          aspectRatio: getStringField(record, "aspect_ratio"),
          categoryId: getStringField(record, "category_id"),
          categoryName: getStringField(record, "category_name"),
          qualityScore: getNumberField(record, "quality_score"),
          recommendationScore: getNumberField(record, "recommendation_score"),
          featuredAt: record.featured_at ? new Date(String(record.featured_at)).getTime() : undefined,
          failedCount: getNumberField(record, "failed_count"),
          lastFailedAt: record.last_failed_at ? new Date(String(record.last_failed_at)).getTime() : undefined,
          collectedAt: record.collected_at ? new Date(String(record.collected_at)).getTime() : undefined,
          publishedAt: record.published_at ? new Date(String(record.published_at)).getTime() : undefined,
          createdAt: record.created_at ? new Date(String(record.created_at)).getTime() : undefined,
          updatedAt: record.updated_at ? new Date(String(record.updated_at)).getTime() : undefined,
        };
      }),
      runs: runsResult.rows.map((row) => row.raw_run).filter(Boolean),
    });
  } catch (error) {
    console.warn("[collection-library] postgres load skipped", getErrorMessage(error));
    return null;
  }
}

function getErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error && "cause" in error ? (error as { cause?: unknown }).cause : undefined;
  if (cause instanceof Error) return `${message}: ${cause.message}`;
  if (cause && typeof cause === "object" && "message" in cause) return `${message}: ${String((cause as { message?: unknown }).message)}`;
  return message;
}

async function fetchJsonWithPowerShellFallback(targetUrl: string) {
  const authHeader = buildCivitaiAuthHeader(targetUrl);
  if (nativeFetchConnectBroken) {
    return JSON.parse(await fetchViaPowerShell(targetUrl, "application/json", authHeader)) as unknown;
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLLECTION_NATIVE_FETCH_TIMEOUT_MS);
  try {
    const upstreamResponse = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        "User-Agent": "KoalaAI-Collector/1.0",
        ...(authHeader ? { Authorization: authHeader } : {}),
      },
    });
    if (!upstreamResponse.ok) throw new Error(`request failed: ${upstreamResponse.status}`);
    return await upstreamResponse.json() as unknown;
  } catch (fetchError) {
    if (process.platform !== "win32") throw fetchError;
    if (isConnectLevelFetchError(fetchError) && !nativeFetchConnectBroken) {
      nativeFetchConnectBroken = true;
      console.warn("[collection] native fetch connect failed, switching to PowerShell for this process", getErrorMessage(fetchError));
    }
    try {
      return JSON.parse(await fetchViaPowerShell(targetUrl, "application/json", authHeader)) as unknown;
    } catch (fallbackError) {
      throw new Error(`fetch failed (${getErrorMessage(fetchError)}); PowerShell fallback failed (${getErrorMessage(fallbackError)})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithPowerShellFallback(targetUrl: string) {
  if (nativeFetchConnectBroken) {
    return fetchViaPowerShell(targetUrl, "text/html");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLLECTION_NATIVE_FETCH_TIMEOUT_MS);
  try {
    const upstreamResponse = await fetch(targetUrl, {
      signal: controller.signal,
      headers: {
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
      },
    });
    if (!upstreamResponse.ok) throw new Error(`request failed: ${upstreamResponse.status}`);
    return await upstreamResponse.text();
  } catch (fetchError) {
    if (process.platform !== "win32") throw fetchError;
    if (isConnectLevelFetchError(fetchError) && !nativeFetchConnectBroken) {
      nativeFetchConnectBroken = true;
      console.warn("[collection] native fetch connect failed, switching to PowerShell for this process", getErrorMessage(fetchError));
    }
    try {
      return await fetchViaPowerShell(targetUrl, "text/html");
    } catch (fallbackError) {
      throw new Error(`fetch failed (${getErrorMessage(fetchError)}); PowerShell fallback failed (${getErrorMessage(fallbackError)})`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

// 判断是否是连接级失败（DNS/连接超时/拒绝/重置），这类错误对原生 fetch 在本进程内通常会持续复现，
// 命中后熔断到 PowerShell；HTTP 状态错误（如 404/429）不算，避免误熔断。
function isConnectLevelFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  if (error.name === "AbortError") return true;
  const cause = (error as { cause?: unknown }).cause;
  const code = cause && typeof cause === "object" && "code" in cause ? String((cause as { code?: unknown }).code) : "";
  const connectCodes = [
    "UND_ERR_CONNECT_TIMEOUT",
    "UND_ERR_HEADERS_TIMEOUT",
    "ECONNREFUSED",
    "ECONNRESET",
    "ETIMEDOUT",
    "ENOTFOUND",
    "EAI_AGAIN",
    "ENETUNREACH",
    "EHOSTUNREACH",
  ];
  return connectCodes.includes(code);
}

async function fetchViaPowerShell(targetUrl: string, kind: "application/json" | "text/html", authHeader?: string): Promise<string> {
  const escapedUrl = targetUrl.replace(/'/g, "''");
  const accept = kind === "application/json"
    ? "application/json"
    : "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8";
  const userAgent = kind === "application/json"
    ? "KoalaAI-Collector/1.0"
    : "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
  const escapedAuth = authHeader ? authHeader.replace(/'/g, "''") : "";
  const headerLine = escapedAuth
    ? `$headers = @{ Accept = '${accept}'; 'User-Agent' = '${userAgent}'; Authorization = '${escapedAuth}' }`
    : `$headers = @{ Accept = '${accept}'; 'User-Agent' = '${userAgent}' }`;
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$url = '${escapedUrl}'`,
    headerLine,
    `$response = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -TimeoutSec ${Math.ceil(COLLECTION_REQUEST_TIMEOUT_MS / 1000)}`,
    "$response.Content",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: COLLECTION_REQUEST_TIMEOUT_MS + 10000,
    windowsHide: true,
  });
  return stdout;
}

// 仅对 Civitai API 请求附带 Bearer token；其它主机（如 Lexica）不加，避免泄露凭证。
function buildCivitaiAuthHeader(targetUrl: string): string | undefined {
  const token = getCivitaiApiToken();
  if (!token) return undefined;
  try {
    const host = new URL(targetUrl).hostname.toLowerCase();
    if (host === "civitai.com" || host.endsWith(".civitai.com")) {
      return `Bearer ${token}`;
    }
  } catch {
    return undefined;
  }
  return undefined;
}

// POST JSON 请求（Lexica 的 infinite-prompts 搜索接口只认 POST body 里的关键词）。
// 与 GET 版同样支持原生 fetch 失败后回退 PowerShell。
async function postJsonWithPowerShellFallback(targetUrl: string, body: unknown): Promise<unknown> {
  const payload = JSON.stringify(body);
  if (!nativeFetchConnectBroken) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), COLLECTION_NATIVE_FETCH_TIMEOUT_MS);
    try {
      const upstreamResponse = await fetch(targetUrl, {
        method: "POST",
        signal: controller.signal,
        headers: {
          Accept: "application/json",
          "Content-Type": "application/json",
          "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
        },
        body: payload,
      });
      if (!upstreamResponse.ok) throw new Error(`request failed: ${upstreamResponse.status}`);
      return await upstreamResponse.json() as unknown;
    } catch (fetchError) {
      if (process.platform !== "win32") throw fetchError;
      if (isConnectLevelFetchError(fetchError) && !nativeFetchConnectBroken) {
        nativeFetchConnectBroken = true;
        console.warn("[collection] native fetch connect failed, switching to PowerShell for this process", getErrorMessage(fetchError));
      }
    } finally {
      clearTimeout(timeout);
    }
  }
  return JSON.parse(await postJsonViaPowerShell(targetUrl, payload)) as unknown;
}

async function postJsonViaPowerShell(targetUrl: string, payload: string): Promise<string> {
  const escapedUrl = targetUrl.replace(/'/g, "''");
  const escapedBody = payload.replace(/'/g, "''");
  const script = [
    "$ProgressPreference='SilentlyContinue'",
    "[Console]::OutputEncoding = [System.Text.Encoding]::UTF8",
    `$url = '${escapedUrl}'`,
    "$headers = @{ Accept = 'application/json'; 'User-Agent' = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36' }",
    `$body = '${escapedBody}'`,
    `$response = Invoke-WebRequest -UseBasicParsing -Uri $url -Headers $headers -Method Post -ContentType 'application/json' -Body $body -TimeoutSec ${Math.ceil(COLLECTION_REQUEST_TIMEOUT_MS / 1000)}`,
    "$response.Content",
  ].join("; ");
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], {
    maxBuffer: 20 * 1024 * 1024,
    timeout: COLLECTION_REQUEST_TIMEOUT_MS + 10000,
    windowsHide: true,
  });
  return stdout;
}

function extractLexicaPromptFromHtml(html: string): LexicaHtmlFallback {
  const jsonLdMatches = [...html.matchAll(/<script[^>]+type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)];
  for (const match of jsonLdMatches) {
    try {
      const parsed = JSON.parse(match[1]);
      const records = Array.isArray(parsed) ? parsed : [parsed];
      for (const record of records) {
        if (!record || typeof record !== "object") continue;
        const text = getStringField(asPlainRecord(record), "description") || getStringField(asPlainRecord(record), "name");
        if (text) return { promptText: text };
      }
    } catch {
      // ignore malformed JSON-LD
    }
  }

  const promptLinks = [...html.matchAll(/href="\/prompt\/([^"]+)"/gi)];
  const images = [...html.matchAll(/<img[^>]+src="([^"]+)"/gi)];
  const promptText = html.match(/class="[^"]*prompt[^"]*"[^>]*>([\s\S]*?)<\/[^>]+>/i)?.[1];
  return {
    promptText: promptText ? promptText.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim() : "",
    promptId: promptLinks[0]?.[1],
    imageUrl: normalizeUrl(images[0]?.[1]),
  };
}

type LexicaHtmlFallback = {
  promptText: string;
  promptId?: string;
  imageUrl?: string;
};

function buildLexicaQueryVariants(query: string) {
  const trimmed = query.trim();
  const variants = new Set<string>();
  if (trimmed) variants.add(trimmed);

  const asciiWords = trimmed
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9\s-]{1,60}/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];
  for (const item of asciiWords) variants.add(item);

  const chineseMap: Array<[RegExp, string]> = [
    [/美女|女人|女孩|女性|人像|肖像/gi, "portrait woman"],
    [/男人|男生|男孩/gi, "portrait man"],
    [/风景|景色|自然|森林|山|海|天空|城市|街道|建筑/gi, "landscape scenery"],
    [/插画|绘本|手绘|概念图/gi, "illustration"],
    [/海报|封面|排版|banner/gi, "poster"],
    [/角色|头像|IP|吉祥物/gi, "character avatar"],
    [/二次元|动漫|漫画|赛璐璐/gi, "anime"],
    [/国风|汉服|水墨|武侠|仙侠|东方/gi, "chinese style"],
    [/3d|cg|渲染|虚幻|blender/gi, "3d cg render"],
    [/产品|商品|包装|器物|瓶子|鞋|包/gi, "product packaging"],
    [/室内|房间|客厅|卧室|厨房|办公/gi, "interior room"],
    [/猫/gi, "cat"],
    [/狗/gi, "dog"],
    [/科幻|太空|宇宙|飞船/gi, "sci-fi space"],
    [/赛博朋克|未来|霓虹/gi, "cyberpunk"],
    [/治愈|温暖|可爱/gi, "cute cozy"],
    [/暗黑|恐怖|悬疑/gi, "dark fantasy"],
  ];
  for (const [pattern, replacement] of chineseMap) {
    if (pattern.test(trimmed)) variants.add(replacement);
  }

  if (variants.size === 0) variants.add("");
  variants.add("");
  return [...variants];
}

function buildCivitaiQueryVariants(query: string) {
  const variants = new Set<string>();
  const trimmed = query.trim();
  if (trimmed) variants.add(trimmed);

  const chineseMap: Array<[RegExp, string]> = [
    [/人像|肖像|美女|女人|女孩|女性/gi, "portrait woman"],
    [/男人|男生|男孩/gi, "portrait man"],
    [/吉卜力|宫崎骏/gi, "ghibli style"],
    [/赛博朋克/gi, "cyberpunk"],
    [/国风|汉服|水墨|武侠|仙侠|东方/gi, "chinese style"],
    [/二次元|动漫|漫画|赛璐璐/gi, "anime"],
    [/角色|头像|IP|吉祥物/gi, "character"],
    [/风景|场景|建筑|室内|森林|山|城市/gi, "landscape"],
    [/产品|包装|商品/gi, "product"],
    [/海报|封面|排版/gi, "poster"],
    [/插画|绘本|概念图/gi, "illustration"],
    [/3d|cg|渲染/gi, "3d render"],
  ];
  for (const [pattern, replacement] of chineseMap) {
    if (pattern.test(trimmed)) variants.add(replacement);
  }

  const ascii = trimmed
    .toLowerCase()
    .match(/[a-z0-9][a-z0-9\s-]{1,80}/g)
    ?.map((item) => item.trim())
    .filter(Boolean) ?? [];
  for (const item of ascii) variants.add(item);

  if (variants.size === 0) variants.add("");
  return [...variants];
}
void buildCivitaiQueryVariants; // Civitai 已忽略 query 文本过滤，保留映射表备用，避免未使用告警。



function mapLexicaImageToCandidate(record: Record<string, unknown>, promptById: Map<string, Record<string, unknown>>): CollectedCandidate | null {
  const imageId = getStringField(record, "id");
  if (!imageId) return null;
  // Lexica 图片 URL 由图片 id 构造（full_jpg 原图，sm2 缩略图）。
  const originalImageUrl = `https://image.lexica.art/full_jpg/${imageId}`;
  const promptId = getStringField(record, "promptid") || getStringField(record, "promptId");
  const promptRecord = promptId ? promptById.get(promptId) : undefined;
  const prompt = promptRecord ? getStringField(promptRecord, "prompt") : "";
  const width = getNumberField(record, "width");
  const height = getNumberField(record, "height");
  return {
    provider: "lexica",
    sourceWorkId: imageId,
    sourcePageUrl: promptId ? `https://lexica.art/prompt/${promptId}` : undefined,
    originalImageUrl,
    displayUrl: originalImageUrl,
    thumbnailUrl: `https://image.lexica.art/sm2/${imageId}`,
    title: createCollectionTitle(prompt, "lexica"),
    prompt,
    negativePrompt: promptRecord ? getStringField(promptRecord, "negativePrompt") || undefined : undefined,
    model: (promptRecord ? getStringField(promptRecord, "model") : "") || "lexica-aperture",
    width,
    height,
    nsfw: record.nsfw === true || (promptRecord?.is_private === true),
    metadata: { ...record, promptRecord },
  };
}

async function fetchLexicaApiCandidates(query: string, limit: number) {
  // Lexica 的关键词搜索必须用 POST + body（GET 的 text 参数会被忽略，返回不相关结果）。
  // images[] 提供图片，prompts[] 提供 prompt，通过 image.promptid → prompt.id 关联。
  // 结果较稀疏，cursor 以 100 步进翻页，需累积多页才能凑够 limit 条。
  // 每次请求经 PowerShell 较慢（数秒），因此设墙钟预算：逼近运行超时前就停，
  // 返回已采集到的部分，避免翻页过多触发 45s 运行超时导致整批失败、零返回。
  const collected: CollectedCandidate[] = [];
  const seen = new Set<string>();
  let cursor = 0;
  const deadline = Date.now() + LEXICA_SEARCH_BUDGET_MS;
  for (let page = 0; page < LEXICA_MAX_SEARCH_PAGES && collected.length < limit; page += 1) {
    if (Date.now() > deadline) break;
    const data = asPlainRecord(await postJsonWithPowerShellFallback("https://lexica.art/api/infinite-prompts", {
      text: query,
      searchMode: "images",
      source: "search",
      cursor,
      model: "lexica-aperture-v2",
    }));
    const images = Array.isArray(data.images) ? data.images : [];
    const prompts = Array.isArray(data.prompts) ? data.prompts.map(asPlainRecord) : [];
    const promptById = new Map<string, Record<string, unknown>>();
    for (const prompt of prompts) {
      const id = getStringField(prompt, "id");
      if (id) promptById.set(id, prompt);
    }
    for (const item of images) {
      const candidate = mapLexicaImageToCandidate(asPlainRecord(item), promptById);
      if (candidate && !seen.has(candidate.sourceWorkId ?? "")) {
        seen.add(candidate.sourceWorkId ?? "");
        collected.push(candidate);
        if (collected.length >= limit) break;
      }
    }
    const nextCursor = getNumberField(data, "nextCursor");
    if (nextCursor === undefined || nextCursor === cursor) break;
    cursor = nextCursor;
  }
  return collected.slice(0, limit);
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

function isNewtokenProviderText(text: string) {
  return text.includes("newtoken") || text.includes("newtoken.club");
}

function isNewtokenGptImage2ModelText(text: string) {
  return /gpt-?image-?2/i.test(text);
}

function isNewtokenAsyncGptImage2Request(provider: Record<string, unknown> | undefined, payload: Record<string, unknown> | undefined) {
  const providerText = `${provider?.id ?? ""} ${provider?.name ?? ""} ${provider?.baseUrl ?? ""}`.toLowerCase();
  const modelText = typeof payload?.model === "string" ? payload.model.toLowerCase() : "";
  return isNewtokenProviderText(providerText) && isNewtokenGptImage2ModelText(modelText) && !modelText.includes("_sync");
}

function normalizeNewtokenGptImage2AspectRatio(payload: Record<string, unknown>) {
  const value = typeof payload.aspect_ratio === "string" ? payload.aspect_ratio : typeof payload.ratio === "string" ? payload.ratio : "";
  return ["16:9", "9:16", "3:4", "4:3", "1:1"].includes(value) ? value : "1:1";
}

function normalizeNewtokenGptImage2Attempt(attempt: ImageJobAttempt): ImageJobAttempt {
  const input = attempt.payload;
  const images = [
    ...(Array.isArray(input.images) ? input.images : []),
    ...(Array.isArray(input.reference_images) ? input.reference_images : []),
    ...(Array.isArray(input.referenceImages) ? input.referenceImages : []),
  ].filter((value): value is string => typeof value === "string" && Boolean(value));
  const payload: Record<string, unknown> = {
    model: input.model,
    prompt: input.prompt,
    aspect_ratio: normalizeNewtokenGptImage2AspectRatio(input),
  };
  if (images.length) payload.images = Array.from(new Set(images));
  return {
    ...attempt,
    label: "newtoken gpt-image2 async",
    endpoint: "/v1/videos",
    payload,
    referenceImages: undefined,
    useImageEdit: false,
    mediaType: "image",
  };
}

function normalizeNewtokenGptImage2JobRequest(
  provider: Record<string, unknown> | undefined,
  endpoint: string,
  payload: Record<string, unknown> | undefined,
  attempts: ImageJobAttempt[] | undefined,
) {
  if (!isNewtokenAsyncGptImage2Request(provider, payload)) return { endpoint, payload, attempts };

  const baseAttempt: ImageJobAttempt = {
    label: "newtoken gpt-image2 async",
    endpoint,
    payload: payload!,
    mediaType: "image",
  };
  const normalized = normalizeNewtokenGptImage2Attempt(baseAttempt);
  return {
    endpoint: normalized.endpoint,
    payload: normalized.payload,
    attempts: [normalized],
  };
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
      if (Array.isArray(state.deletedProjectIds)) summary.deletedProjectIds = state.deletedProjectIds.length;
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
    const state = (JSON.parse(value) as {
      state?: { projects?: unknown; items?: unknown; deletedItemIds?: unknown; deletedProjectIds?: unknown };
    }).state;
    return {
      projects: Array.isArray(state?.projects) ? state.projects.length : 0,
      items: Array.isArray(state?.items) ? state.items.length : 0,
      deletedItemIds: Array.isArray(state?.deletedItemIds) ? state.deletedItemIds.length : 0,
      deletedProjectIds: Array.isArray(state?.deletedProjectIds) ? state.deletedProjectIds.length : 0,
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
      nextCounts.deletedItemIds === 0 &&
      nextCounts.deletedProjectIds === 0 &&
      (currentCounts.projects > 0 || currentCounts.items > 0)
  );
}

function getRecordId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const id = (value as { id?: unknown }).id;
  return typeof id === "string" ? id : "";
}

function getRecordProjectId(value: unknown) {
  if (!value || typeof value !== "object") return "";
  const projectId = (value as { projectId?: unknown }).projectId;
  return typeof projectId === "string" ? projectId : "";
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
    const deletedProjectIds = Array.from(new Set([
      ...getStringList(current.state?.deletedProjectIds),
      ...getStringList(next.state?.deletedProjectIds),
    ]));
    const isDeletedProject = (project: unknown) => deletedProjectIds.includes(getRecordId(project));
    const isDeletedItem = (item: unknown) =>
      deletedItemIds.includes(getRecordId(item)) || deletedProjectIds.includes(getRecordProjectId(item));
    const projects = mergeById(currentProjects, nextProjects, (currentProject, nextProject) =>
      getProjectUpdatedAt(nextProject) >= getProjectUpdatedAt(currentProject) ? nextProject : currentProject
    ).filter((project) => !isDeletedProject(project));
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
        deletedProjectIds,
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
 
 // 异步图片任务若走 /videos 端点（如 newtoken GPT Image 2），任务状态同样查 /v1/videos/{id}。
 const usesVideoEndpoint = (attempt.endpoint ?? "").toLowerCase().includes("/videos");
 const taskEndpoints = mediaType === "video" || usesVideoEndpoint ? buildVideoTaskStatusEndpoints(taskId, attempt.endpoint) : [
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

function normalizeCollectionClassifierSettings(input: unknown): CollectionClassifierSettings {
  const raw = asPlainRecord(input);
  const provider = normalizeProviderRequest(raw.provider);
  const modelId = getStringField(raw, "modelId");
  return {
    enabled: raw.enabled === true,
    visionModelValue: getStringField(raw, "visionModelValue"),
    modelId,
    provider: provider || undefined,
    classificationPrompt: getStringField(raw, "classificationPrompt") || DEFAULT_COLLECTION_CLASSIFIER_SETTINGS.classificationPrompt,
  };
}

function getCollectionClassifierSettings() {
  const saved = appState.get(COLLECTION_CLASSIFIER_SETTINGS_KEY);
  if (!saved) return collectionClassifierSettings;
  try {
    return normalizeCollectionClassifierSettings(JSON.parse(saved));
  } catch {
    return collectionClassifierSettings;
  }
}

function normalizeCollectionCategoryConfig(value: unknown): CollectionCategoryConfig | null {
  const raw = asPlainRecord(value);
  const id = getStringField(raw, "id").toLowerCase().replace(/[^a-z0-9_-]/g, "");
  const name = getStringField(raw, "name");
  if (!id || !name) return null;
  return {
    id,
    name,
    keywords: normalizeStringArray(raw.keywords).slice(0, 80),
    custom: raw.custom === true || !DEFAULT_COLLECTION_CATEGORIES.some((category) => category.id === id),
  };
}

function normalizeGeneratedPublishSettings(input: unknown): GeneratedPublishSettings {
  const raw = asPlainRecord(input);
  const categories = Array.isArray(raw.categories)
    ? raw.categories.map(normalizeCollectionCategoryConfig).filter((item): item is CollectionCategoryConfig => Boolean(item))
    : DEFAULT_COLLECTION_CATEGORIES;
  const mediaTypes = normalizeStringArray(raw.mediaTypes)
    .filter((value): value is MediaJobType => value === "image" || value === "video");
  const defaultCategoryId = getStringField(raw, "defaultCategoryId") || "style";
  const defaultCategory = categories.find((category) => category.id === defaultCategoryId) ?? DEFAULT_COLLECTION_CATEGORIES.find((category) => category.id === defaultCategoryId);
  return {
    enabled: raw.enabled !== false,
    autoPublish: raw.autoPublish !== false,
    mediaTypes: mediaTypes.length ? mediaTypes : ["image"],
    defaultCategoryId,
    defaultCategoryName: getStringField(raw, "defaultCategoryName") || defaultCategory?.name || "风格",
    categories: categories.length ? categories : DEFAULT_COLLECTION_CATEGORIES,
  };
}

function getGeneratedPublishSettings() {
  const saved = appState.get(GENERATED_PUBLISH_SETTINGS_KEY);
  if (!saved) return generatedPublishSettings;
  try {
    return normalizeGeneratedPublishSettings(JSON.parse(saved));
  } catch {
    return generatedPublishSettings;
  }
}

function normalizePaymentSettings(input: unknown): PaymentSettings {
  const raw = asPlainRecord(input);
  return {
    enabled: raw.enabled === true,
    providerName: getStringField(raw, "providerName"),
    mode: raw.mode === "api" ? "api" : "external",
    createOrderUrl: getStringField(raw, "createOrderUrl"),
    method: raw.method === "GET" ? "GET" : "POST",
    headersJson: getStringField(raw, "headersJson"),
    payloadTemplate: getStringField(raw, "payloadTemplate") || DEFAULT_PAYMENT_SETTINGS.payloadTemplate,
    payUrlField: getStringField(raw, "payUrlField") || "payUrl",
    orderIdField: getStringField(raw, "orderIdField") || "orderId",
    webhookSecret: getStringField(raw, "webhookSecret"),
    successUrl: getStringField(raw, "successUrl"),
    cancelUrl: getStringField(raw, "cancelUrl"),
  };
}

function getPaymentSettings() {
  const saved = appState.get(PAYMENT_SETTINGS_KEY);
  if (!saved) return paymentSettings;
  try {
    return normalizePaymentSettings(JSON.parse(saved));
  } catch {
    return paymentSettings;
  }
}

type PaymentCreditPackage = {
  id: string;
  name: string;
  credits: number;
  bonusCredits: number;
  price: number;
  purchaseUrl: string;
  enabled: boolean;
};

function getCreditPackagesFromState(): PaymentCreditPackage[] {
  const saved = appState.get(CREDIT_STORE_KEY);
  if (!saved) return [];
  try {
    const envelope = JSON.parse(saved) as { state?: { packages?: unknown[] } };
    return (Array.isArray(envelope?.state?.packages) ? envelope.state.packages : [])
      .map((item) => {
        const raw = asPlainRecord(item);
        return {
          id: getStringField(raw, "id"),
          name: getStringField(raw, "name"),
          credits: getNumberField(raw, "credits") ?? 0,
          bonusCredits: getNumberField(raw, "bonusCredits") ?? 0,
          price: getNumberField(raw, "price") ?? 0,
          purchaseUrl: getStringField(raw, "purchaseUrl"),
          enabled: raw.enabled !== false,
        };
      })
      .filter((item) => item.id);
  } catch {
    return [];
  }
}

function getCreditPackageById(packageId: string) {
  return getCreditPackagesFromState().find((pkg) => pkg.id === packageId && pkg.enabled);
}

function fulfillPaymentOrder(pkg: PaymentCreditPackage, userId: string, orderId: string) {
  const saved = appState.get(CREDIT_STORE_KEY);
  const envelope = saved
    ? JSON.parse(saved) as { state?: Record<string, unknown>; version?: unknown }
    : { state: {}, version: 0 };
  const state = asPlainRecord(envelope.state);
  const accounts = Array.isArray(state.accounts) ? state.accounts.map(asPlainRecord) : [];
  const transactions = Array.isArray(state.transactions) ? state.transactions.map(asPlainRecord) : [];
  const existingTransaction = transactions.find((item) => getStringField(item, "generationTaskId") === orderId);
  if (existingTransaction) {
    return { ok: true, duplicated: true, orderId, amount: getNumberField(existingTransaction, "amount") ?? 0 };
  }

  const now = Date.now();
  const amount = Math.max(0, Math.round((pkg.credits + pkg.bonusCredits) * 10000) / 10000);
  if (amount <= 0) throw new Error("Credit package amount must be greater than 0");

  const accountIndex = accounts.findIndex((item) => getStringField(item, "userId") === userId);
  const currentAccount = accountIndex >= 0
    ? accounts[accountIndex]
    : { userId, balance: 0, totalEarned: 0, totalSpent: 0, updatedAt: now };
  const balanceBefore = getNumberField(currentAccount, "balance") ?? 0;
  const nextAccount = {
    ...currentAccount,
    userId,
    balance: Math.round((balanceBefore + amount) * 10000) / 10000,
    totalEarned: Math.round(((getNumberField(currentAccount, "totalEarned") ?? 0) + amount) * 10000) / 10000,
    updatedAt: now,
  };
  const nextAccounts = accountIndex >= 0
    ? accounts.map((item, index) => (index === accountIndex ? nextAccount : item))
    : [...accounts, nextAccount];
  const transaction = {
    id: `txn-${randomUUID().slice(0, 8)}`,
    userId,
    type: "payment_purchase",
    amount,
    balanceBefore,
    balanceAfter: nextAccount.balance,
    packageId: pkg.id,
    generationTaskId: orderId,
    note: `支付购买：${pkg.name}`,
    createdAt: now,
  };
  const nextEnvelope = {
    ...envelope,
    state: {
      ...state,
      accounts: nextAccounts,
      transactions: [transaction, ...transactions],
    },
  };
  const value = JSON.stringify(nextEnvelope);
  appState.set(CREDIT_STORE_KEY, value);
  logAppState("put", CREDIT_STORE_KEY, value);
  saveAppStateEntryInBackground(CREDIT_STORE_KEY, value);
  void saveAppStateSoon();
  return { ok: true, duplicated: false, orderId, amount, balanceAfter: nextAccount.balance };
}

function renderPaymentTemplate(template: string, values: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_match, key: string) => values[key] ?? "");
}

function getNestedFieldValue(payload: unknown, path: string): unknown {
  if (!path.trim()) return undefined;
  return path.split(".").reduce<unknown>((current, key) => {
    if (!current || typeof current !== "object") return undefined;
    return (current as Record<string, unknown>)[key];
  }, payload);
}

function parsePaymentHeaders(headersJson: string) {
  if (!headersJson.trim()) return {};
  const parsed = JSON.parse(headersJson) as unknown;
  const headers = asPlainRecord(parsed);
  return Object.fromEntries(Object.entries(headers).filter(([, value]) => typeof value === "string")) as Record<string, string>;
}

async function createPaymentOrder(settings: PaymentSettings, pkg: PaymentCreditPackage, userId: string, returnUrl: string) {
  if (!settings.enabled || settings.mode === "external") {
    if (!pkg.purchaseUrl) throw new Error("Payment is not configured for this package");
    return { mode: "external", payUrl: pkg.purchaseUrl, orderId: "" };
  }
  if (!settings.createOrderUrl) throw new Error("Payment create order URL is not configured");

  const orderId = `pay_${Date.now()}_${randomUUID().slice(0, 8)}`;
  const successUrl = settings.successUrl || returnUrl;
  const cancelUrl = settings.cancelUrl || returnUrl;
  const values = {
    orderId,
    packageId: pkg.id,
    packageName: pkg.name,
    price: String(pkg.price),
    amount: String(pkg.price),
    credits: String(pkg.credits + pkg.bonusCredits),
    userId,
    successUrl,
    cancelUrl,
    returnUrl,
  };
  const renderedPayload = renderPaymentTemplate(settings.payloadTemplate, values);
  const payload = renderedPayload.trim() ? JSON.parse(renderedPayload) as Record<string, unknown> : {};
  const headers = { "Content-Type": "application/json", ...parsePaymentHeaders(settings.headersJson) };
  const targetUrl = new URL(settings.createOrderUrl);
  const init: RequestInit = { method: settings.method, headers };
  if (settings.method === "GET") {
    for (const [key, value] of Object.entries(payload)) {
      if (value !== undefined && value !== null) targetUrl.searchParams.set(key, String(value));
    }
  } else {
    init.body = JSON.stringify(payload);
  }

  const upstreamResponse = await fetch(targetUrl, init);
  const responseText = await upstreamResponse.text();
  const responsePayload = parseJsonOrText(responseText);
  if (!upstreamResponse.ok) {
    throw new Error(getMessageFromPayload(responsePayload) || `Payment provider returned ${upstreamResponse.status}`);
  }

  const payUrl = getNestedFieldValue(responsePayload, settings.payUrlField);
  const upstreamOrderId = getNestedFieldValue(responsePayload, settings.orderIdField);
  if (typeof payUrl !== "string" || !payUrl) throw new Error("Payment provider response did not include a pay URL");
  return {
    mode: "api",
    payUrl,
    orderId: typeof upstreamOrderId === "string" && upstreamOrderId ? upstreamOrderId : orderId,
  };
}

function normalizeCollectionCategoryId(value: unknown) {
  const id = typeof value === "string" ? value.trim().toLowerCase() : "";
  return ["portrait", "character", "scene", "product", "poster", "illustration", "style", "anime", "cg", "chinese"].includes(id) ? id : "";
}

function getCategoryNameById(id: string) {
  const names: Record<string, string> = {
    portrait: "人像",
    character: "角色",
    scene: "场景",
    product: "产品",
    poster: "海报",
    illustration: "插画",
    style: "风格",
    anime: "二次元",
    cg: "3D/CG",
    chinese: "国风",
  };
  return names[id] || "风格";
}

function parseCollectionVisionClassification(content: string) {
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  try {
    const raw = asPlainRecord(JSON.parse(jsonMatch?.[0] ?? content));
    const categoryId = normalizeCollectionCategoryId(raw.categoryId);
    const confidence = Math.max(0, Math.min(1, getNumberField(raw, "confidence") ?? 0.5));
    if (!categoryId) return null;
    return {
      categoryId,
      categoryName: getStringField(raw, "categoryName") || getCategoryNameById(categoryId),
      tags: normalizeStringArray(raw.tags).slice(0, 12),
      confidence,
    };
  } catch {
    return null;
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

function getRuntimeDataCounts() {
  return {
    appStateKeys: appState.size,
    jobs: jobs.size,
    agents: agents.size,
    styles: styleLibrary.styles.length,
    styleCategories: styleLibrary.categories.length,
  };
}

function normalizeBackupFileName(value: string) {
  const fileName = basename(value);
  if (fileName !== value) return "";
  if (!/^ai-shorta-backup-\d{8}-\d{6}\.json$/i.test(fileName)) return "";
  return fileName;
}

function createBackupFileName(createdAt: number) {
  const timestamp = new Date(createdAt)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "")
    .replace("T", "-");
  return `ai-shorta-backup-${timestamp}.json`;
}

async function listLocalUploadFiles() {
  const results: Array<{ path: string; size: number; updatedAt: number }> = [];
  async function walk(directory: string, prefix = "") {
    let entries: Array<{ name: string; isDirectory(): boolean; isFile(): boolean }>;
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const entryPath = join(directory, entry.name);
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await walk(entryPath, relativePath);
        continue;
      }
      if (!entry.isFile()) continue;
      const fileStat = await stat(entryPath);
      results.push({
        path: relativePath,
        size: fileStat.size,
        updatedAt: fileStat.mtime.getTime(),
      });
    }
  }
  await walk(UPLOADS_DIR);
  return results.sort((a, b) => a.path.localeCompare(b.path));
}

async function listAllObjectStorageObjectsForBackup() {
  if (!isObjectStorageEnabled()) return [];
  const objects: Array<{ key: string; size: number; updatedAt: number; url: string }> = [];
  let continuationToken: string | undefined;
  const prefix = normalizeStoragePrefix(objectStorageConfig.prefix);

  do {
    const data = await createObjectStorageClient().send(new ListObjectsV2Command({
      Bucket: objectStorageConfig.bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken,
      MaxKeys: 1000,
    }));
    for (const item of data.Contents ?? []) {
      if (!item.Key) continue;
      objects.push({
        key: item.Key,
        size: item.Size ?? 0,
        updatedAt: item.LastModified?.getTime() ?? 0,
        url: publicUrlForObjectKey(item.Key),
      });
    }
    continuationToken = data.IsTruncated ? data.NextContinuationToken : undefined;
  } while (continuationToken);

  return objects;
}

async function createDataBackupManifest(): Promise<DataBackupManifest> {
  const imageJobs = Array.from(jobs.values()).map((job) => sanitizeJobForPersistence(job));
  const [localUploads, objectStorageObjects] = await Promise.all([
    listLocalUploadFiles(),
    listAllObjectStorageObjectsForBackup().catch((error) => {
      console.warn("[data-backup] failed to list object storage objects", error);
      return [];
    }),
  ]);

  return {
    version: 1,
    kind: "data-backup",
    createdAt: Date.now(),
    source: {
      runtime: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
      databaseConfigured: isPostgresEnabled(),
      dualWrite: shouldUsePostgresDualWrite(),
    },
    summary: {
      appStateKeys: appState.size,
      jobs: imageJobs.length,
      agents: agents.size,
      styles: styleLibrary.styles.length,
      localUploads: localUploads.length,
      objectStorageObjects: objectStorageObjects.length,
    },
    coverage: {
      included: [
        "运行状态 JSON：app-state、image-jobs、agents",
        "后台配置：邮箱、对象存储、风格库",
        "本地 uploads 文件清单",
        "对象存储对象清单",
      ],
      notIncluded: [
        "本地 uploads 文件二进制内容",
        "对象存储文件二进制内容",
        "PostgreSQL pg_dump 物理/逻辑转储",
        "应用源代码、构建产物、日志文件、环境变量文件",
      ],
    },
    appState: Object.fromEntries(appState.entries()),
    imageJobs,
    agents: Array.from(agents.values()),
    emailConfig,
    objectStorageConfig,
    styleLibrary,
    localUploads,
    objectStorageObjects,
  };
}

async function listDataBackups() {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const fileNames = (await readdir(BACKUPS_DIR)).filter((fileName) => normalizeBackupFileName(fileName));
  const backups = await Promise.all(fileNames.map(async (fileName) => {
    const filePath = join(BACKUPS_DIR, fileName);
    const fileStat = await stat(filePath);
    return {
      fileName,
      size: fileStat.size,
      createdAt: fileStat.mtime.getTime(),
      downloadUrl: `/api/admin/data/backups/${encodeURIComponent(fileName)}`,
    };
  }));
  return backups.sort((a, b) => b.createdAt - a.createdAt);
}

async function createDataBackup() {
  await mkdir(BACKUPS_DIR, { recursive: true });
  const manifest = await createDataBackupManifest();
  const fileName = createBackupFileName(manifest.createdAt);
  const filePath = join(BACKUPS_DIR, fileName);
  await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  const fileStat = await stat(filePath);
  return {
    fileName,
    size: fileStat.size,
    createdAt: manifest.createdAt,
    downloadUrl: `/api/admin/data/backups/${encodeURIComponent(fileName)}`,
    summary: manifest.summary,
    coverage: manifest.coverage,
  };
}

async function migrateRuntimeDataToPostgres() {
  await queryPostgres("select 1");
  const previousDualWrite = process.env.DB_DUAL_WRITE;
  process.env.DB_DUAL_WRITE = "1";
  try {
    await saveJobsSoon();
    await saveAppStateSoon();
    await saveAgentsSoon();
    await saveEmailConfigSoon();
    await saveObjectStorageConfigSoon();
    await saveStyleLibrarySoon();

    for (const [key, value] of appState.entries()) {
      await saveAppStateEntryToPostgres(key, value);
      await materializeAppStateToPostgres(key, value);
    }

    return {
      ok: true,
      migratedAt: Date.now(),
      counts: getRuntimeDataCounts(),
      database: {
        configured: true,
        dualWrite: shouldUsePostgresDualWrite(),
        readPrimary: process.env.DB_READ_PRIMARY === "postgres" ? "postgres" : "json",
      },
    };
  } finally {
    if (previousDualWrite === undefined) {
      delete process.env.DB_DUAL_WRITE;
    } else {
      process.env.DB_DUAL_WRITE = previousDualWrite;
    }
  }
}

async function ensureDataFiles() {
  await mkdir(DATA_DIR, { recursive: true });
  await mkdir(UPLOADS_DIR, { recursive: true });
  await mkdir(LOGS_DIR, { recursive: true });
  await mkdir(BACKUPS_DIR, { recursive: true });
  const preferPostgres = isPostgresEnabled() && process.env.DB_READ_PRIMARY === "postgres";
  let postgresSnapshot: Awaited<ReturnType<typeof loadLegacyStateFromPostgres>> | null = null;
  if (preferPostgres) {
    try {
      postgresSnapshot = await loadLegacyStateFromPostgres();
      console.log("[db] loaded legacy runtime snapshot from PostgreSQL");
    } catch (error) {
      console.warn("[db] failed to load PostgreSQL snapshot, falling back to JSON files", error);
    }
  }

  try {
    const savedJobs = (postgresSnapshot?.imageJobs ?? JSON.parse(await readFile(JOBS_FILE, "utf8"))) as ImageJob[];
    for (const job of savedJobs) jobs.set(job.id, job);
  } catch {
    await writeFile(JOBS_FILE, "[]", "utf8");
  }

  try {
    const savedState = postgresSnapshot?.appState ?? JSON.parse(await readFile(APP_STATE_FILE, "utf8")) as Record<string, string>;
    for (const [key, value] of Object.entries(savedState)) {
      if (typeof value === "string") appState.set(key, value);
    }
  } catch {
    await writeFile(APP_STATE_FILE, "{}", "utf8");
  }

  try {
    const savedAgents = (postgresSnapshot?.agents ?? JSON.parse(await readFile(AGENTS_FILE, "utf8"))) as Agent[];
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

  const postgresCollectionLibrary = process.env.DB_READ_PRIMARY === "postgres" ? await loadCollectionLibraryFromPostgres() : null;
  if (postgresCollectionLibrary) {
    collectionLibrary = postgresCollectionLibrary;
  } else {
    try {
      const raw = await readFile(COLLECTION_LIBRARY_FILE, "utf8");
      collectionLibrary = normalizeCollectionLibraryFromFile(JSON.parse(raw));
    } catch {
      collectionLibrary = { sources: [], works: [], runs: [] };
      await writeFile(COLLECTION_LIBRARY_FILE, JSON.stringify(collectionLibrary, null, 2), "utf8");
    }
  }

  markStaleCollectionRunsFailed();
  collectionClassifierSettings = getCollectionClassifierSettings();
  generatedPublishSettings = getGeneratedPublishSettings();
  paymentSettings = getPaymentSettings();
  // 优先使用后台保存的 token；未保存时保留环境变量 CIVITAI_API_TOKEN 的默认值。
  const savedCivitaiToken = appState.get(CIVITAI_API_TOKEN_KEY);
  if (savedCivitaiToken !== undefined) civitaiApiToken = savedCivitaiToken.trim();
}

function markStaleCollectionRunsFailed() {
  const cutoff = Date.now() - COLLECTION_RUN_TIMEOUT_MS;
  let changed = false;
  for (const run of collectionLibrary.runs) {
    if (run.status !== "running") continue;
    if (run.startedAt > cutoff) continue;
    run.status = "failed";
    run.error = `collection run was still running after restart and was marked failed`;
    run.finishedAt = Date.now();
    changed = true;
  }
  if (changed) void saveCollectionLibrarySoon();
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isRetryableFileReplaceError(error: unknown) {
  const code = typeof error === "object" && error !== null && "code" in error
    ? String((error as { code?: unknown }).code)
    : "";
  return code === "EPERM" || code === "EACCES" || code === "EBUSY";
}

async function replaceFileWithRetry(tempFile: string, targetFile: string, label: string) {
  const maxAttempts = 6;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      await rename(tempFile, targetFile);
      return;
    } catch (error) {
      if (!isRetryableFileReplaceError(error) || attempt === maxAttempts) throw error;
      console.warn(`[${label}] file replace busy, retrying`, {
        attempt,
        targetFile,
        error: error instanceof Error ? error.message : String(error),
      });
      await sleep(40 * attempt);
    }
  }
}

async function writeJsonFileAtomically(filePath: string, value: unknown, label: string) {
  await mkdir(dirname(filePath), { recursive: true });
  const tempFile = `${filePath}.${process.pid}.${Date.now()}.${randomUUID()}.tmp`;
  try {
    await writeFile(tempFile, JSON.stringify(value, null, 2), "utf8");
    await replaceFileWithRetry(tempFile, filePath, label);
  } catch (error) {
    await rm(tempFile, { force: true }).catch(() => undefined);
    throw error;
  }
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
    const persistedJobs = Array.from(jobs.values()).map((job) => sanitizeJobForPersistence(job));
    await writeJsonFileAtomically(JOBS_FILE, persistedJobs, "jobs");
    await saveImageJobsSnapshotToPostgres(persistedJobs);
  }).catch((error) => {
    console.error("[jobs] failed to save jobs", error);
  });
  return saveChain;
}

function saveAppStateSoon() {
  appStateSaveChain = appStateSaveChain.then(async () => {
    await writeJsonFileAtomically(APP_STATE_FILE, Object.fromEntries(appState.entries()), "app-state");
  }).catch((error) => {
    console.error("[app-state] failed to save state", error);
  });
  return appStateSaveChain;
}

function saveAgentsSoon() {
  agentsSaveChain = agentsSaveChain.then(async () => {
    const persistedAgents = Array.from(agents.values());
    await writeJsonFileAtomically(AGENTS_FILE, persistedAgents, "agents");
    await saveAgentsSnapshotToPostgres(persistedAgents);
  }).catch((error) => {
    console.error("[agents] failed to save agents", error);
  });
  return agentsSaveChain;
}

function saveEmailConfigSoon() {
  emailConfigSaveChain = emailConfigSaveChain.then(async () => {
    await writeJsonFileAtomically(EMAIL_CONFIG_FILE, emailConfig, "email-config");
    await saveConfigDocumentToPostgres("email-config", emailConfig);
  }).catch((error) => {
    console.error("[email-config] failed to save config", error);
  });
  return emailConfigSaveChain;
}

function saveObjectStorageConfigSoon() {
  storageConfigSaveChain = storageConfigSaveChain.then(async () => {
    await writeJsonFileAtomically(STORAGE_CONFIG_FILE, objectStorageConfig, "storage-config");
    await saveConfigDocumentToPostgres("storage-config", objectStorageConfig);
  }).catch((error) => {
    console.error("[storage-config] failed to save config", error);
  });
  return storageConfigSaveChain;
}

function saveStyleLibrarySoon() {
  styleLibrarySaveChain = styleLibrarySaveChain.then(async () => {
    await writeJsonFileAtomically(STYLE_LIBRARY_FILE, styleLibrary, "style-library");
    await saveConfigDocumentToPostgres("style-library", styleLibrary);
  }).catch((error) => {
    console.error("[style-library] failed to save library", error);
  });
  return styleLibrarySaveChain;
}

function saveCollectionLibrarySoon() {
  collectionLibrarySaveChain = collectionLibrarySaveChain.then(async () => {
    await writeJsonFileAtomically(COLLECTION_LIBRARY_FILE, collectionLibrary, "collection-library");
    await saveConfigDocumentToPostgres("collection-library", collectionLibrary);
    await saveCollectionLibraryToPostgres();
  }).catch((error) => {
    console.error("[collection-library] failed to save library", error);
  });
  return collectionLibrarySaveChain;
}

function dateOrNull(value: number | undefined) {
  return typeof value === "number" && Number.isFinite(value) ? new Date(value) : null;
}

async function saveCollectionLibraryToPostgres() {
  if (!isPostgresEnabled()) return;
  try {
    for (const source of collectionLibrary.sources) {
      await queryPostgres(
        `insert into collection_sources
          (id, provider, name, query, enabled, target_category_id, target_category_name, target_tags, auto_publish, filter_nsfw, max_items_per_run, schedule_every_hours, last_run_at, raw_source, created_at, updated_at, deleted_at)
         values
          ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10, $11, $12, $13, $14::jsonb, $15, $16, null)
         on conflict (id) do update set
          provider = excluded.provider,
          name = excluded.name,
          query = excluded.query,
          enabled = excluded.enabled,
          target_category_id = excluded.target_category_id,
          target_category_name = excluded.target_category_name,
          target_tags = excluded.target_tags,
          auto_publish = excluded.auto_publish,
          filter_nsfw = excluded.filter_nsfw,
          max_items_per_run = excluded.max_items_per_run,
          schedule_every_hours = excluded.schedule_every_hours,
          last_run_at = excluded.last_run_at,
          raw_source = excluded.raw_source,
          updated_at = excluded.updated_at,
          deleted_at = null`,
        [
          source.id,
          source.provider,
          source.name,
          source.query,
          source.enabled,
          source.targetCategoryId ?? null,
          source.targetCategoryName ?? null,
          JSON.stringify(source.targetTags),
          source.autoPublish,
          source.filterNsfw,
          source.maxItemsPerRun,
          source.scheduleEveryHours ?? null,
          dateOrNull(source.lastRunAt),
          JSON.stringify(source),
          dateOrNull(source.createdAt) ?? new Date(),
          dateOrNull(source.updatedAt) ?? new Date(),
        ],
      );
    }

    for (const work of collectionLibrary.works) {
      await queryPostgres(
        `insert into collection_works
          (id, source_id, provider, source_work_id, source_page_url, original_image_url, display_url, thumbnail_url, title, prompt, negative_prompt, model, aspect_ratio, width, height, category_id, category_name, tags, nsfw, quality_score, recommendation_score, featured, featured_at, status, failed_count, last_failed_at, metadata, collected_at, published_at, created_at, updated_at, deleted_at)
         values
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18::jsonb, $19, $20, $21, $22, $23, $24, $25, $26, $27::jsonb, $28, $29, $30, $31, null)
         on conflict (id) do update set
          source_id = excluded.source_id,
          provider = excluded.provider,
          source_work_id = excluded.source_work_id,
          source_page_url = excluded.source_page_url,
          original_image_url = excluded.original_image_url,
          display_url = excluded.display_url,
          thumbnail_url = excluded.thumbnail_url,
          title = excluded.title,
          prompt = excluded.prompt,
          negative_prompt = excluded.negative_prompt,
          model = excluded.model,
          aspect_ratio = excluded.aspect_ratio,
          width = excluded.width,
          height = excluded.height,
          category_id = excluded.category_id,
          category_name = excluded.category_name,
          tags = excluded.tags,
          nsfw = excluded.nsfw,
          quality_score = excluded.quality_score,
          recommendation_score = excluded.recommendation_score,
          featured = excluded.featured,
          featured_at = excluded.featured_at,
          status = excluded.status,
          failed_count = excluded.failed_count,
          last_failed_at = excluded.last_failed_at,
          metadata = excluded.metadata,
          published_at = excluded.published_at,
          updated_at = excluded.updated_at,
          deleted_at = null`,
        [
          work.id,
          work.sourceId ?? null,
          work.provider,
          work.sourceWorkId ?? null,
          work.sourcePageUrl ?? null,
          work.originalImageUrl,
          work.displayUrl,
          work.thumbnailUrl ?? null,
          work.title,
          work.prompt,
          work.negativePrompt ?? null,
          work.model ?? null,
          work.aspectRatio,
          work.width ?? null,
          work.height ?? null,
          work.categoryId,
          work.categoryName,
          JSON.stringify(work.tags),
          work.nsfw,
          work.qualityScore,
          work.recommendationScore,
          work.featured,
          dateOrNull(work.featuredAt),
          work.status,
          work.failedCount,
          dateOrNull(work.lastFailedAt),
          JSON.stringify(work.metadata),
          dateOrNull(work.collectedAt) ?? new Date(),
          dateOrNull(work.publishedAt),
          dateOrNull(work.createdAt) ?? new Date(),
          dateOrNull(work.updatedAt) ?? new Date(),
        ],
      );
    }

    for (const run of collectionLibrary.runs.slice(0, 300)) {
      await queryPostgres(
        `insert into collection_runs
          (id, source_id, provider, query, status, fetched, added, skipped, error, raw_run, started_at, finished_at)
         values
          ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11, $12)
         on conflict (id) do update set
          status = excluded.status,
          fetched = excluded.fetched,
          added = excluded.added,
          skipped = excluded.skipped,
          error = excluded.error,
          raw_run = excluded.raw_run,
          finished_at = excluded.finished_at`,
        [
          run.id,
          run.sourceId,
          run.provider,
          run.query,
          run.status,
          run.fetched,
          run.added,
          run.skipped,
          run.error ?? null,
          JSON.stringify(run),
          dateOrNull(run.startedAt) ?? new Date(),
          dateOrNull(run.finishedAt),
        ],
      );
    }
  } catch (error) {
    console.warn("[collection-library] postgres sync skipped", getErrorMessage(error));
  }
}

const runningCollectionSourceIds = new Set<string>();

async function runScheduledCollectionSources() {
  const now = Date.now();
  for (const source of collectionLibrary.sources) {
    if (!source.enabled || !source.scheduleEveryHours || source.scheduleEveryHours <= 0) continue;
    if (runningCollectionSourceIds.has(source.id)) continue;
    const intervalMs = source.scheduleEveryHours * 60 * 60 * 1000;
    if (source.lastRunAt && now - source.lastRunAt < intervalMs) continue;
    runningCollectionSourceIds.add(source.id);
    void runCollectionSourceQueued(source)
      .catch((error) => {
        console.warn("[collection] scheduled source failed", { sourceId: source.id, error: getErrorMessage(error) });
      })
      .finally(() => {
        runningCollectionSourceIds.delete(source.id);
      });
  }
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
  const nextJob = { ...job, ...updates, updatedAt: Date.now() };
  jobs.set(jobId, nextJob);
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
 const hasMediaUrl = extractMediaUrls(upstreamResponse, mediaType).length > 0;
 // /videos 端点（含 newtoken GPT Image 2 异步图片）始终是异步：只要拿到 task_id 就轮询，不依赖 status 字段。
 const usesVideoEndpointForTask = (endpoint ?? "").toLowerCase().includes("/videos");
 const asyncTaskId = hasMediaUrl
   ? null
   : (extractMediaTaskId(upstreamResponse, mediaType) ?? (usesVideoEndpointForTask ? extractTaskIdCandidate(upstreamResponse) : null));
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
 const clientTaskId = typeof request.headers["x-client-task-id"] === "string" ? request.headers["x-client-task-id"].trim() : "";
 if (clientTaskId && method === "POST" && /\/(?:chat\/completions|images\/generations|images\/edits|responses)(?:\?|$)/i.test(targetUrl)) {
   try {
     generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: payload, response: JSON.parse(responseText) });
   } catch {
     generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: payload, response: responseText });
   }
 }

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
 const clientTaskId = typeof request.headers["x-client-task-id"] === "string" ? request.headers["x-client-task-id"].trim() : "";
 if (clientTaskId && method === "POST" && /\/(?:chat\/completions|images\/generations|images\/edits|responses)(?:\?|$)/i.test(targetUrl)) {
   try {
     generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: payload, response: JSON.parse(responseText) });
   } catch {
     generationResultCache.set(clientTaskId, { createdAt: Date.now(), request: payload, response: responseText });
   }
 }
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
  const rawEndpoint = typeof body.endpoint === "string" ? body.endpoint : "/images/generations";
  const mediaType: MediaJobType = body.mediaType === "video" ? "video" : "image";
  const rawNormalizedPayload = rawPayload ? normalizeVideoPayloadImageFields(rawPayload, mediaType) : undefined;
  const rawAttempts = Array.isArray(body.attempts)
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
  const normalizedRequest = normalizeNewtokenGptImage2JobRequest(provider, rawEndpoint, rawNormalizedPayload, rawAttempts);
  const endpoint = normalizedRequest.endpoint;
  const payload = normalizedRequest.payload;
  const attempts = normalizedRequest.attempts;
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

  const providerBaseUrl = typeof provider?.baseUrl === "string" ? provider.baseUrl.trim() : "";
  const providerKey = typeof provider?.key === "string" ? provider.key.trim() : "";
  if (!provider || !providerBaseUrl || !providerKey || !payload) {
    logImageJob(clientTaskId ?? "job-request", "request.invalid", {
      hasProvider: Boolean(provider),
      hasProviderBaseUrl: Boolean(providerBaseUrl),
      hasProviderKey: Boolean(providerKey),
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
      baseUrl: providerBaseUrl,
      key: providerKey,
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

if (process.env.SERVE_FRONTEND !== "0") {
  app.use(express.static(FRONTEND_DIST_DIR, {
    fallthrough: true,
    index: false,
    maxAge: process.env.NODE_ENV === "production" ? "1h" : 0,
  }));

  app.get(/^(?!\/(?:api|uploads|health)(?:\/|$)).*/, async (_request, response, next) => {
    try {
      response.sendFile(FRONTEND_INDEX_FILE);
    } catch (error) {
      next(error);
    }
  });
}

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
void runScheduledCollectionSources();
setInterval(() => void cleanupExpiredJobs(), 60 * 60 * 1000);
setInterval(cleanupExpiredEmailVerificationRecords, 60 * 1000);
setInterval(() => void runScheduledCollectionSources(), 60 * 1000);
app.listen(PORT, HOST, () => {
  console.log(`[backend] listening on http://${HOST}:${PORT}`);
  console.log(`[backend] loaded ${jobs.size} image jobs`);
  console.log(`[backend] loaded ${agents.size} agents`);
  console.log(`[backend] loaded ${styleLibrary.styles.length} style presets`);
  console.log(`[backend] loaded ${collectionLibrary.works.length} collected works; scheduled sources: ${collectionLibrary.sources.filter((source) => source.enabled && source.scheduleEveryHours && source.scheduleEveryHours > 0).length}`);
  console.log(`[backend] email verification ${emailConfig.enabled ? "enabled" : "disabled"}`);
  console.log(`[backend] completed image job retention: ${Math.round(COMPLETED_JOB_RETENTION_MS / 60 / 60 / 1000)}h`);
});
