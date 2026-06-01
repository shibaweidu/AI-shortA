const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";

export interface AdminLogSource {
  id: string;
  label: string;
}

export interface AdminLogResponse {
  source: string;
  label: string;
  sources: AdminLogSource[];
  lines: string[];
  size: number;
  updatedAt: number;
  truncated: boolean;
  query?: string;
}

export async function fetchAdminLogs(input: { source?: string; lines?: number; query?: string } = {}) {
  const params = new URLSearchParams();
  if (input.source) params.set("source", input.source);
  if (input.lines) params.set("lines", String(input.lines));
  if (input.query?.trim()) params.set("q", input.query.trim());

  const suffix = params.toString() ? `?${params.toString()}` : "";
  const response = await fetch(`${BACKEND_API}/api/admin/logs${suffix}`, { cache: "no-store" });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as AdminLogResponse;
}
