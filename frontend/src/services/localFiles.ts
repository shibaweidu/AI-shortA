import { normalizeImageDataUrlMime } from "./referenceImages";

const API_PROXY = "/api-proxy";
const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";
const DB_NAME = "ai-director-local-files";
const STORE_NAME = "handles";
const DIRECTORY_HANDLE_KEY = "save-directory";
const ASSET_FILE_HANDLE_PREFIX = "asset-file:";

export type GeneratedAssetType = "image" | "video";

export interface SaveGeneratedAssetOptions {
  directoryHandle: FileSystemDirectoryHandle;
  assetUrl: string;
  assetType: GeneratedAssetType;
  prompt: string;
  createdAt: number;
  itemId: string;
  providerKey?: string;
}

function openHandleDatabase() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);

    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME);
      }
    };

    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Failed to open IndexedDB"));
  });
}

function runRequest<T = void>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed"));
  });
}

function waitForTransaction(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed"));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted"));
  });
}

function inferExtensionFromMimeType(mimeType: string, assetType: GeneratedAssetType) {
  const normalized = mimeType.toLowerCase();
  const mimeToExtension: Record<string, string> = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "image/svg+xml": "svg",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "video/quicktime": "mov",
    "video/x-matroska": "mkv",
  };

  if (mimeToExtension[normalized]) {
    return mimeToExtension[normalized];
  }

  return assetType === "video" ? "mp4" : "png";
}

function inferExtensionFromUrl(assetUrl: string, assetType: GeneratedAssetType) {
  try {
    if (/^data:/i.test(assetUrl)) {
      const mimeType = assetUrl.match(/^data:([^;,]+)/i)?.[1];
      if (mimeType) return inferExtensionFromMimeType(mimeType, assetType);
    }

    if (/^blob:/i.test(assetUrl)) {
      return assetType === "video" ? "mp4" : "png";
    }

    const url = new URL(assetUrl);
    const pathname = url.pathname.toLowerCase();
    const match = pathname.match(/\.([a-z0-9]{2,5})$/i);
    if (match?.[1]) {
      return match[1];
    }
  } catch {
    return assetType === "video" ? "mp4" : "png";
  }

  return assetType === "video" ? "mp4" : "png";
}

function slugifyPrompt(prompt: string) {
  return prompt
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

function formatTimestamp(createdAt: number) {
  const date = new Date(createdAt);
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return `${parts[0]}${parts[1]}${parts[2]}-${parts[3]}${parts[4]}${parts[5]}`;
}

async function fetchRemoteAssetBlob(assetUrl: string, assetType: GeneratedAssetType, providerKey?: string) {
  const fetchDirect = async () => {
    const response = await fetch(assetUrl, {
      method: "GET",
      headers: {
        Accept: assetType === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
      },
    });

    if (response.ok) return response.blob();

    throw new Error(`Failed to fetch remote asset directly: ${response.status}`);
  };

  const buildHeaders = (includeProviderAuth: boolean) => ({
    Accept: assetType === "video" ? "video/*,*/*;q=0.8" : "image/*,*/*;q=0.8",
    "x-target-url": assetUrl,
    ...(includeProviderAuth && providerKey
      ? {
          Authorization: `Bearer ${providerKey}`,
        }
      : {}),
  });

  const fetchThroughProxy = async (includeProviderAuth: boolean) => {
    const response = await fetch(API_PROXY, {
      method: "GET",
      headers: buildHeaders(includeProviderAuth),
    });

    if (response.ok) return response.blob();

    throw new Error(`Failed to fetch remote asset through proxy: ${response.status}`);
  };

  try {
    return await fetchDirect();
  } catch {
    // Some providers do not allow browser downloads; fall back to the local proxy.
  }

  try {
    return await fetchThroughProxy(false);
  } catch (error) {
    if (!providerKey) throw error;
    return fetchThroughProxy(true);
  }
}

async function fetchAssetBlob(assetUrl: string, assetType: GeneratedAssetType, providerKey?: string) {
  if (assetUrl.startsWith("/uploads/")) {
    return fetchAssetBlob(`${BACKEND_API}${assetUrl}`, assetType, providerKey);
  }

  if (/^data:/i.test(assetUrl) || /^blob:/i.test(assetUrl)) {
    const response = await fetch(assetUrl);
    if (!response.ok) {
      throw new Error(`Failed to read browser asset: ${response.status}`);
    }
    return response.blob();
  }

  if (/^https?:\/\//i.test(assetUrl)) {
    return fetchRemoteAssetBlob(assetUrl, assetType, providerKey);
  }

  throw new Error("Unsupported asset URL format");
}

async function getWritePermission(handle: FileSystemHandle) {
  const descriptor: FileSystemPermissionDescriptor = { mode: "readwrite" };

  if (handle.queryPermission) {
    const current = await handle.queryPermission(descriptor);
    if (current === "granted") return true;
  }

  if (handle.requestPermission) {
    const requested = await handle.requestPermission(descriptor);
    return requested === "granted";
  }

  return true;
}

async function getReadPermission(handle: FileSystemHandle) {
  const descriptor: FileSystemPermissionDescriptor = { mode: "read" };

  if (handle.queryPermission) {
    const current = await handle.queryPermission(descriptor);
    if (current === "granted") return true;
  }

  if (handle.requestPermission) {
    const requested = await handle.requestPermission(descriptor);
    return requested === "granted";
  }

  return true;
}

export function isLocalFolderSaveSupported() {
  return typeof window !== "undefined" && typeof window.showDirectoryPicker === "function";
}

export async function persistDirectoryHandle(handle: FileSystemDirectoryHandle) {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, DIRECTORY_HANDLE_KEY);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function loadPersistedDirectoryHandle() {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const handle = await runRequest<FileSystemDirectoryHandle | undefined>(
      transaction.objectStore(STORE_NAME).get(DIRECTORY_HANDLE_KEY)
    );
    return handle ?? null;
  } finally {
    database.close();
  }
}

export async function clearPersistedDirectoryHandle() {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(DIRECTORY_HANDLE_KEY);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function persistAssetFileHandle(itemId: string, handle: FileSystemFileHandle) {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(handle, `${ASSET_FILE_HANDLE_PREFIX}${itemId}`);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function loadPersistedAssetFileHandle(itemId: string) {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const handle = await runRequest<FileSystemFileHandle | undefined>(
      transaction.objectStore(STORE_NAME).get(`${ASSET_FILE_HANDLE_PREFIX}${itemId}`)
    );
    return handle ?? null;
  } finally {
    database.close();
  }
}

export async function clearPersistedAssetFileHandle(itemId: string) {
  const database = await openHandleDatabase();
  try {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(`${ASSET_FILE_HANDLE_PREFIX}${itemId}`);
    await waitForTransaction(transaction);
  } finally {
    database.close();
  }
}

export async function getObjectUrlFromPersistedAssetFile(itemId: string) {
  const handle = await loadPersistedAssetFileHandle(itemId);
  if (!handle) return null;
  const granted = await getReadPermission(handle);
  if (!granted) return null;
  const file = await handle.getFile();
  return URL.createObjectURL(file);
}

export async function getDataUrlFromPersistedAssetFile(itemId: string) {
  const handle = await loadPersistedAssetFileHandle(itemId);
  if (!handle) return null;
  const granted = await getReadPermission(handle);
  if (!granted) return null;
  const file = await handle.getFile();
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(normalizeImageDataUrlMime(String(reader.result)));
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read local asset file"));
    reader.readAsDataURL(file);
  });
}

export async function pickDirectoryHandle() {
  if (!window.showDirectoryPicker) {
    throw new Error("当前浏览器不支持选择文件夹");
  }

  const handle = await window.showDirectoryPicker({
    id: "ai-short-output-folder",
    mode: "readwrite",
  });

  const granted = await getWritePermission(handle);
  if (!granted) {
    throw new Error("未获得文件夹写入权限");
  }

  await persistDirectoryHandle(handle);
  return handle;
}

export async function ensureDirectoryWritable(handle: FileSystemDirectoryHandle) {
  return getWritePermission(handle);
}

export async function saveGeneratedAssetToDirectory({
  directoryHandle,
  assetUrl,
  assetType,
  prompt,
  createdAt,
  itemId,
  providerKey,
}: SaveGeneratedAssetOptions) {
  const writable = await ensureDirectoryWritable(directoryHandle);
  if (!writable) {
    throw new Error("文件夹写入权限被拒绝");
  }

  const blob = await fetchAssetBlob(assetUrl, assetType, providerKey);
  const extension =
    blob.type && blob.type !== "application/octet-stream"
      ? inferExtensionFromMimeType(blob.type, assetType)
      : inferExtensionFromUrl(assetUrl, assetType);
  const promptSlug = slugifyPrompt(prompt);
  const fileName = `${formatTimestamp(createdAt)}-${promptSlug || assetType}-${itemId}.${extension}`;
  const fileHandle = await directoryHandle.getFileHandle(fileName, { create: true });
  const stream = await fileHandle.createWritable();
  await stream.write(blob);
  await stream.close();
  await persistAssetFileHandle(itemId, fileHandle);

  return {
    fileName,
    directoryName: directoryHandle.name,
  };
}
