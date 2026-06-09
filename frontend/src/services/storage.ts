const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export interface ObjectStorageConfig {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  publicBaseUrl: string;
  prefix: string;
  forcePathStyle: boolean;
  useBackendProxy: boolean;
  updatedAt: number;
  hasSecretAccessKey: boolean;
}

export interface ObjectStorageConfigUpdate {
  enabled: boolean;
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey?: string;
  clearSecretAccessKey?: boolean;
  publicBaseUrl: string;
  prefix: string;
  forcePathStyle: boolean;
  useBackendProxy: boolean;
}

export interface ObjectStorageItem {
  key: string;
  size: number;
  updatedAt: number;
  url: string;
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${BACKEND_API}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
}

export function getObjectStorageConfig() {
  return requestJson<ObjectStorageConfig>("/api/admin/storage-config", { cache: "no-store" });
}

export function updateObjectStorageConfig(config: ObjectStorageConfigUpdate) {
  return requestJson<ObjectStorageConfig>("/api/admin/storage-config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function testObjectStorage() {
  return requestJson<{ ok: true }>("/api/admin/storage-test", { method: "POST" });
}

export function listObjectStorageObjects(input: { prefix?: string; limit?: number } = {}) {
  const params = new URLSearchParams();
  if (input.prefix?.trim()) params.set("prefix", input.prefix.trim());
  if (input.limit) params.set("limit", String(input.limit));
  const suffix = params.toString() ? `?${params.toString()}` : "";
  return requestJson<{ objects: ObjectStorageItem[] }>(`/api/admin/storage-objects${suffix}`, { cache: "no-store" });
}

export function deleteObjectStorageObject(key: string) {
  return requestJson<{ ok: true }>(`/api/admin/storage-objects?key=${encodeURIComponent(key)}`, { method: "DELETE" });
}
