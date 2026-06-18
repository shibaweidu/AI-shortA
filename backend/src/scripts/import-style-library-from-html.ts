import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { closePostgresPool, isPostgresEnabled, waitForPostgres } from "../db/postgres.js";
import { saveConfigDocumentToPostgres } from "../db/legacyPersistence.js";

type ObjectStorageConfig = {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  publicBaseUrl?: string;
  prefix?: string;
  forcePathStyle?: boolean;
  useBackendProxy?: boolean;
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

const dataDir = process.env.DATA_DIR ?? join(process.cwd(), "data");
const defaultHtmlPath = "C:\\Users\\Administrator\\.codex\\attachments\\b900dd40-801e-4ed4-a131-4307f5789210\\pasted-text.txt";
const htmlPath = process.argv.find((arg) => !arg.startsWith("--") && arg !== process.argv[0] && arg !== process.argv[1]) ?? defaultHtmlPath;
const shouldUpload = !process.argv.includes("--skip-upload");
const shouldSyncPostgres = process.argv.includes("--sync-postgres") || process.env.SYNC_POSTGRES === "1";

const categories: StyleCategory[] = [
  { id: "all", name: "全部", order: 0 },
  { id: "my", name: "我的风格", order: 1 },
  { id: "recent", name: "最近使用", order: 2 },
  { id: "real-person", name: "真人剧", order: 3 },
  { id: "chinese", name: "国风", order: 4 },
  { id: "cg", name: "CG", order: 5 },
  { id: "2d", name: "2D", order: 6 },
  { id: "cute", name: "Q版", order: 7 },
  { id: "game", name: "游戏", order: 8 },
  { id: "anime", name: "日漫", order: 9 },
  { id: "western", name: "欧美", order: 10 },
  { id: "korean", name: "韩流", order: 11 },
];

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .trim();
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/https?:\/\//g, "")
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 90) || "asset";
}

function contentTypeFromUrl(url: string) {
  const path = new URL(url).pathname.toLowerCase();
  if (path.endsWith(".webp")) return "image/webp";
  if (path.endsWith(".png")) return "image/png";
  if (path.endsWith(".jpg") || path.endsWith(".jpeg")) return "image/jpeg";
  if (path.endsWith(".gif")) return "image/gif";
  return "application/octet-stream";
}

function getSourceFileName(url: string) {
  const parsed = new URL(url);
  const name = basename(parsed.pathname);
  return name || `${slugify(url)}.webp`;
}

function buildObjectKey(config: ObjectStorageConfig, directory: string, sourceUrl: string) {
  const prefix = (config.prefix ?? "kaola/").replace(/^\/+/, "").replace(/\/?$/, "/");
  const fileName = getSourceFileName(sourceUrl);
  const extension = extname(fileName) || ".webp";
  const baseName = basename(fileName, extname(fileName));
  return `${prefix}${directory.replace(/^\/+|\/+$/g, "")}/${slugify(baseName)}${extension}`.replace(/\/{2,}/g, "/");
}

function publicUrlForObjectKey(config: ObjectStorageConfig, key: string) {
  const encodedKey = key.split("/").map((part) => encodeURIComponent(part)).join("/");
  if (config.publicBaseUrl?.trim()) return `${config.publicBaseUrl.replace(/\/+$/, "")}/${encodedKey}`;
  const endpoint = new URL(config.endpoint);
  return `${endpoint.protocol}//${config.bucket}.${endpoint.host}/${encodedKey}`;
}

function categoryIdsForName(name: string) {
  const ids = new Set<string>();
  const lower = name.toLowerCase();

  if (/[真写真电影都市港风写真真人]/.test(name) || lower.includes("real")) ids.add("real-person");
  if (/[国风中国山海经水墨古风唐宋敦煌武侠仙侠]/.test(name)) ids.add("chinese");
  if (/(cg|3d|立体|渲染|赛博|机甲)/i.test(name)) ids.add("cg");
  if (/(2d|扁平|插画|手绘|漫画|卡通|素描|线稿|涂鸦|绘本)/i.test(name)) ids.add("2d");
  if (/(q版|q萌|可爱|萌|盲盒|泡泡|毛绒|玩偶)/i.test(name)) ids.add("cute");
  if (/[游戏像素赛博机甲英雄]/.test(name)) ids.add("game");
  if (/[日漫动漫新海诚宫崎骏漫画]/.test(name)) ids.add("anime");
  if (/[欧美美式欧式迪士尼皮克斯油画]/.test(name)) ids.add("western");
  if (/[韩流韩系kpopKPOP]/.test(name)) ids.add("korean");

  if (!ids.size) ids.add("2d");
  return [...ids];
}

function promptForStyle(name: string) {
  return `参考「${name}」视觉风格，保持画面主体不变，强化该风格的色彩、材质、光影、线条、构图和整体氛围，生成高质量一致风格画面。`;
}

function parseStyleCards(html: string) {
  const cardPattern = /<div class="_asset-effect_n5jye_187" data-effect-index="(?<index>\d+)">(?<body>[\s\S]*?)(?=<div class="_asset-effect_n5jye_187" data-effect-index="|<\/div><\/div><\/div>\s*$)/g;
  const styles: Array<{
    index: number;
    name: string;
    coverImageUrl: string;
    sampleImageUrls: string[];
    isNew: boolean;
  }> = [];

  for (const match of html.matchAll(cardPattern)) {
    const body = match.groups?.body ?? "";
    const index = Number(match.groups?.index ?? styles.length + 1);
    const name = decodeHtmlEntities(body.match(/_asset-effect-name_n5jye_247">(?<name>[\s\S]*?)<\/div>/)?.groups?.name ?? "");
    const coverImageUrl = decodeHtmlEntities(body.match(/<img alt="icon" class="_asset-effect-img_n5jye_223[^"]*" src="(?<url>[^"]+)"/)?.groups?.url ?? "");
    const sampleImageUrls = [...body.matchAll(/<img alt="spring-card" src="(?<url>[^"]+)"/g)]
      .map((item) => decodeHtmlEntities(item.groups?.url ?? ""))
      .filter(Boolean);

    if (!name || !coverImageUrl) continue;
    styles.push({
      index,
      name,
      coverImageUrl,
      sampleImageUrls,
      isNew: body.includes("_asset-effect-new-badge"),
    });
  }

  return styles;
}

async function readJson<T>(fileName: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(join(dataDir, fileName), "utf8")) as T;
  } catch {
    return fallback;
  }
}

function assertStorageReady(config: ObjectStorageConfig) {
  if (!config.enabled) throw new Error("object storage is not enabled");
  if (!config.endpoint || !config.region || !config.bucket || !config.accessKeyId || !config.secretAccessKey) {
    throw new Error("object storage config is incomplete");
  }
}

function createStorageClient(config: ObjectStorageConfig) {
  return new S3Client({
    region: config.region,
    endpoint: config.endpoint,
    forcePathStyle: config.forcePathStyle !== false,
    requestChecksumCalculation: "WHEN_REQUIRED",
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });
}

async function uploadRemoteImage(input: {
  client: S3Client;
  config: ObjectStorageConfig;
  sourceUrl: string;
  directory: string;
}) {
  const key = buildObjectKey(input.config, input.directory, input.sourceUrl);
  const response = await fetch(input.sourceUrl);
  if (!response.ok) throw new Error(`download failed ${response.status}: ${input.sourceUrl}`);

  const contentType = response.headers.get("content-type")?.split(";")[0] || contentTypeFromUrl(input.sourceUrl);
  const body = Buffer.from(await response.arrayBuffer());
  await input.client.send(new PutObjectCommand({
    Bucket: input.config.bucket,
    Key: key,
    Body: body,
    ContentType: contentType,
    ContentLength: body.byteLength,
  }));
  return publicUrlForObjectKey(input.config, key);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T, index: number) => Promise<R>) {
  const results = new Array<R>(items.length);
  let nextIndex = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await mapper(items[index], index);
    }
  });
  await Promise.all(workers);
  return results;
}

async function main() {
  const html = await readFile(htmlPath, "utf8");
  const parsedStyles = parseStyleCards(html);
  if (!parsedStyles.length) throw new Error(`no style cards found in ${htmlPath}`);

  const storageConfig = await readJson<ObjectStorageConfig>("storage-config.json", {} as ObjectStorageConfig);
  const storageClient = shouldUpload ? createStorageClient(storageConfig) : null;
  if (shouldUpload) assertStorageReady(storageConfig);

  const now = Date.now();
  console.log(`[style-library] parsed ${parsedStyles.length} styles from ${htmlPath}`);

  const styles = await mapWithConcurrency(parsedStyles, 4, async (style, index) => {
    const directory = `style-library/${String(style.index).padStart(3, "0")}`;
    const uploadedUrls = shouldUpload && storageClient
      ? await mapWithConcurrency([style.coverImageUrl, ...style.sampleImageUrls], 2, (sourceUrl) =>
        uploadRemoteImage({ client: storageClient, config: storageConfig, sourceUrl, directory }))
      : [style.coverImageUrl, ...style.sampleImageUrls];

    if ((index + 1) % 10 === 0 || index === parsedStyles.length - 1) {
      console.log(`[style-library] processed ${index + 1}/${parsedStyles.length}`);
    }

    return {
      id: `style-recommend-${String(style.index).padStart(3, "0")}`,
      name: style.name,
      categoryIds: categoryIdsForName(style.name),
      coverImageUrl: uploadedUrls[0],
      sampleImageUrls: uploadedUrls.slice(1),
      prompt: promptForStyle(style.name),
      strength: 0.7,
      isNew: style.isNew,
      isActive: true,
      source: "preset" as const,
      createdAt: now + style.index,
      updatedAt: now + style.index,
    };
  });

  const library: StyleLibrary = {
    categories,
    styles: styles.sort((a, b) => a.createdAt - b.createdAt),
  };

  await mkdir(dataDir, { recursive: true });
  await writeFile(join(dataDir, "style-library.json"), `${JSON.stringify(library, null, 2)}\n`, "utf8");
  console.log(`[style-library] wrote ${join(dataDir, "style-library.json")}`);

  if (shouldSyncPostgres) {
    if (!isPostgresEnabled()) throw new Error("DATABASE_URL is required for --sync-postgres");
    process.env.DB_DUAL_WRITE = "1";
    await waitForPostgres();
    await saveConfigDocumentToPostgres("style-library", library);
    console.log("[style-library] synced config_documents/style-library to Postgres");
  }
}

main()
  .catch((error) => {
    console.error("[style-library] import failed", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePostgresPool();
  });
