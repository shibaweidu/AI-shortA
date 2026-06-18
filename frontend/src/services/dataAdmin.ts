const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export interface DataBackupItem {
  fileName: string;
  size: number;
  createdAt: number;
  downloadUrl: string;
  summary?: {
    appStateKeys: number;
    jobs: number;
    agents: number;
    styles: number;
    localUploads?: number;
    objectStorageObjects?: number;
  };
  coverage?: {
    included: string[];
    notIncluded: string[];
  };
}

export interface DataStatusResponse {
  ok: true;
  runtime: "json" | "postgres";
  database: {
    configured: boolean;
    dualWrite: boolean;
    readPrimary: "json" | "postgres";
  };
  counts: {
    appStateKeys: number;
    jobs: number;
    agents: number;
    styles: number;
    styleCategories: number;
  };
  backups: DataBackupItem[];
}

export interface MigratePostgresResponse {
  ok: true;
  migratedAt: number;
  counts: DataStatusResponse["counts"];
  database: DataStatusResponse["database"];
}

function makeBackendUrl(path: string) {
  return `${BACKEND_API}${path.startsWith("/") ? path : `/${path}`}`;
}

async function requestJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(makeBackendUrl(path), {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) as { error?: string } : {};
  if (!response.ok) throw new Error(data.error || text || `Request failed: ${response.status}`);
  return data as T;
}

export function fetchDataStatus() {
  return requestJson<DataStatusResponse>("/api/admin/data/status", { cache: "no-store" });
}

export function migrateDataToPostgres() {
  return requestJson<MigratePostgresResponse>("/api/admin/data/migrate-postgres", { method: "POST" });
}

export function createDataBackup() {
  return requestJson<DataBackupItem>("/api/admin/data/backups", { method: "POST" });
}

export function deleteDataBackup(fileName: string) {
  return requestJson<{ ok: true }>(`/api/admin/data/backups/${encodeURIComponent(fileName)}`, { method: "DELETE" });
}

export function getDataBackupDownloadUrl(fileName: string) {
  return makeBackendUrl(`/api/admin/data/backups/${encodeURIComponent(fileName)}`);
}
