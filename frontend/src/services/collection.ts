const API_BASE = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export type CollectionProvider = "civitai" | "lexica" | "generated";
export type CollectionWorkStatus = "pending" | "published" | "rejected" | "broken";
export type CivitaiSort = "Most Reactions" | "Most Comments" | "Most Collected" | "Newest";
export type CivitaiPeriod = "Day" | "Week" | "Month" | "Year" | "AllTime";
export type GeneratedMediaType = "image" | "video";

export type CollectionSource = {
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
  createdAt: number;
  updatedAt: number;
};

export type CollectionRun = {
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

export type CollectionClassifierSettings = {
  enabled: boolean;
  visionModelValue: string;
  modelId: string;
  provider?: {
    id?: string;
    name?: string;
    baseUrl: string;
    key: string;
    logAccessToken?: string;
  };
  classificationPrompt: string;
};

export type CollectionCategoryConfig = {
  id: string;
  name: string;
  keywords: string[];
  custom?: boolean;
};

export type GeneratedPublishSettings = {
  enabled: boolean;
  autoPublish: boolean;
  mediaTypes: GeneratedMediaType[];
  defaultCategoryId: string;
  defaultCategoryName: string;
  categories: CollectionCategoryConfig[];
};

export const DEFAULT_COLLECTION_CLASSIFIER_SETTINGS: CollectionClassifierSettings = {
  enabled: false,
  visionModelValue: "",
  modelId: "",
  classificationPrompt:
    '你是 AI 作品采集分类器。请根据图片、prompt、模型和标签，把作品归入一个首页主分类。只能返回 JSON：{"categoryId":"portrait|character|scene|product|poster|illustration|style|anime|cg|chinese","categoryName":"中文分类名","tags":["标签1","标签2"],"confidence":0-1}。',
};

export const DEFAULT_GENERATED_PUBLISH_SETTINGS: GeneratedPublishSettings = {
  enabled: true,
  autoPublish: true,
  mediaTypes: ["image"],
  defaultCategoryId: "style",
  defaultCategoryName: "风格",
  categories: [
    { id: "portrait", name: "人像", keywords: ["portrait", "face", "人像", "头像"] },
    { id: "character", name: "角色", keywords: ["character", "role", "角色", "人物"] },
    { id: "scene", name: "场景", keywords: ["landscape", "scene", "interior", "场景", "风景"] },
    { id: "product", name: "产品", keywords: ["product", "packshot", "商品", "产品"] },
    { id: "poster", name: "海报", keywords: ["poster", "banner", "海报", "封面"] },
    { id: "illustration", name: "插画", keywords: ["illustration", "drawing", "插画"] },
    { id: "style", name: "风格", keywords: ["style", "aesthetic", "风格"] },
    { id: "anime", name: "二次元", keywords: ["anime", "manga", "二次元", "动漫"] },
    { id: "cg", name: "3D/CG", keywords: ["3d", "cg", "render", "渲染"] },
    { id: "chinese", name: "国风", keywords: ["chinese", "hanfu", "国风", "古风"] },
  ],
};

export type CollectionWork = {
  id: string;
  sourceId?: string;
  provider: CollectionProvider;
  sourceWorkId?: string;
  sourcePageUrl?: string;
  originalImageUrl: string;
  displayUrl: string;
  thumbnailUrl?: string;
  coverUrl: string;
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
  status: CollectionWorkStatus;
  failedCount: number;
  featured: boolean;
  featuredAt?: number;
  collectedAt: number;
  publishedAt?: number;
  recommendationScore: number;
  metadata?: Record<string, unknown>;
};

export type CollectionPage = {
  items: CollectionWork[];
  nextCursor?: string;
  hasMore: boolean;
};

async function readJson<T>(response: Response): Promise<T> {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const message = data && typeof data === "object" && "error" in data ? String((data as { error?: unknown }).error) : `Request failed: ${response.status}`;
    throw new Error(message);
  }
  return data as T;
}

export async function fetchHomeFeed(input: { cursor?: string; limit?: number; categoryId?: string } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 30));
  if (input.cursor) params.set("cursor", input.cursor);
  if (input.categoryId) params.set("categoryId", input.categoryId);
  const response = await fetch(`${API_BASE}/api/feed/home?${params.toString()}`, { cache: "no-store" });
  return readJson<CollectionPage>(response);
}

export async function fetchCollectionWork(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}`, { cache: "no-store" });
  const data = await readJson<{ work: CollectionWork }>(response);
  return data.work;
}

export async function fetchRelatedCollectionWorks(id: string, limit = 8) {
  const params = new URLSearchParams();
  params.set("limit", String(limit));
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}/related?${params.toString()}`, { cache: "no-store" });
  const data = await readJson<{ items: CollectionWork[] }>(response);
  return data.items;
}

export async function reportCollectionImageBroken(id: string) {
  await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}/broken`, {
    method: "POST",
  }).catch(() => undefined);
}

export async function fetchCollectionSources() {
  const response = await fetch(`${API_BASE}/api/collection/sources`, { cache: "no-store" });
  return readJson<{ sources: CollectionSource[] }>(response);
}

export async function fetchCollectionClassifierSettings() {
  try {
    const response = await fetch(`${API_BASE}/api/collection/classifier-settings`, { cache: "no-store" });
    return readJson<CollectionClassifierSettings>(response);
  } catch {
    return DEFAULT_COLLECTION_CLASSIFIER_SETTINGS;
  }
}

export async function updateCollectionClassifierSettings(settings: CollectionClassifierSettings) {
  const response = await fetch(`${API_BASE}/api/collection/classifier-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return readJson<CollectionClassifierSettings>(response);
}

export async function fetchGeneratedPublishSettings() {
  try {
    const response = await fetch(`${API_BASE}/api/collection/generated-publish-settings`, { cache: "no-store" });
    return readJson<GeneratedPublishSettings>(response);
  } catch {
    return DEFAULT_GENERATED_PUBLISH_SETTINGS;
  }
}

export async function updateGeneratedPublishSettings(settings: GeneratedPublishSettings) {
  const response = await fetch(`${API_BASE}/api/collection/generated-publish-settings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(settings),
  });
  return readJson<GeneratedPublishSettings>(response);
}

export async function publishGeneratedWork(input: {
  itemId?: string;
  projectId?: string;
  userId?: string;
  mediaType: GeneratedMediaType;
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
  const response = await fetch(`${API_BASE}/api/generated-works/publish`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ ok: true; work: CollectionWork | null }>(response);
}

export async function deleteCollectionSource(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/sources/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readJson<{ ok: true; deleted: boolean }>(response);
}

export async function fetchCollectionRuns(input: { sourceId?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 30));
  if (input.sourceId) params.set("sourceId", input.sourceId);
  const response = await fetch(`${API_BASE}/api/collection/runs?${params.toString()}`, { cache: "no-store" });
  return readJson<{ runs: CollectionRun[] }>(response);
}

export async function deleteCollectionRun(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/runs/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readJson<{ ok: true; deleted: boolean }>(response);
}

export async function clearCollectionRuns(input: { sourceId?: string } = {}) {
  const params = new URLSearchParams();
  if (input.sourceId) params.set("sourceId", input.sourceId);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${API_BASE}/api/collection/runs${suffix}`, { method: "DELETE" });
  return readJson<{ ok: true; deleted: number }>(response);
}

export type CivitaiTokenStatus = { configured: boolean; hint: string };

export async function fetchCivitaiTokenStatus() {
  try {
    const response = await fetch(`${API_BASE}/api/collection/civitai-token`, { cache: "no-store" });
    return readJson<CivitaiTokenStatus>(response);
  } catch {
    return { configured: false, hint: "" } satisfies CivitaiTokenStatus;
  }
}

export async function updateCivitaiToken(token: string) {
  const response = await fetch(`${API_BASE}/api/collection/civitai-token`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  return readJson<CivitaiTokenStatus>(response);
}

export async function createCollectionSource(input: {
  provider: CollectionProvider;
  name?: string;
  query: string;
  sort?: CivitaiSort;
  period?: CivitaiPeriod;
  targetCategoryId?: string;
  targetCategoryName?: string;
  targetTags?: string[];
  autoPublish?: boolean;
  filterNsfw?: boolean;
  maxItemsPerRun?: number;
  scheduleEveryHours?: number;
}) {
  const response = await fetch(`${API_BASE}/api/collection/sources`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ source: CollectionSource }>(response);
}

export async function runCollectionSource(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/sources/${encodeURIComponent(id)}/run`, {
    method: "POST",
  });
  return readJson<{ ok: true; fetched: number; added: number; skipped: number; source: CollectionSource }>(response);
}

export async function updateCollectionSource(id: string, input: Partial<Pick<CollectionSource, "enabled" | "autoPublish" | "filterNsfw" | "maxItemsPerRun" | "scheduleEveryHours" | "sort" | "period">>) {
  const response = await fetch(`${API_BASE}/api/collection/sources/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ source: CollectionSource }>(response);
}

export async function runEnabledCollectionSources() {
  const response = await fetch(`${API_BASE}/api/collection/run-enabled`, { method: "POST" });
  return readJson<{ ok: true; results: Array<{ sourceId: string; ok: boolean; fetched?: number; added?: number; skipped?: number; error?: string }> }>(response);
}

export async function fetchCollectionWorks(input: { status?: CollectionWorkStatus; cursor?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  params.set("limit", String(input.limit ?? 30));
  if (input.status) params.set("status", input.status);
  if (input.cursor) params.set("cursor", input.cursor);
  const response = await fetch(`${API_BASE}/api/collection/works?${params.toString()}`, { cache: "no-store" });
  return readJson<CollectionPage>(response);
}

export async function publishCollectionWork(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}/publish`, { method: "POST" });
  return readJson<{ work: CollectionWork }>(response);
}

export async function updateCollectionWork(id: string, input: Partial<Pick<CollectionWork, "title" | "prompt" | "negativePrompt" | "model" | "categoryId" | "categoryName" | "tags" | "displayUrl" | "thumbnailUrl" | "sourcePageUrl" | "featured">>) {
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ work: CollectionWork }>(response);
}

export async function batchCollectionWorks(input: { ids: string[]; action: "publish" | "reject" | "delete" }) {
  const response = await fetch(`${API_BASE}/api/collection/works/batch`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  return readJson<{ ok: true; affected: number }>(response);
}

export async function rejectCollectionWork(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}/reject`, { method: "POST" });
  return readJson<{ work: CollectionWork }>(response);
}

export async function deleteCollectionWork(id: string) {
  const response = await fetch(`${API_BASE}/api/collection/works/${encodeURIComponent(id)}`, { method: "DELETE" });
  return readJson<{ ok: true; deleted: boolean }>(response);
}
