import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

export function getFlowItemDisplayName(prompt?: string, maxChars = 10) {
  const firstLine = (prompt ?? "")
    .split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/\s+/g, " ");

  if (!firstLine) return "未命名作品";
  return Array.from(firstLine).slice(0, maxChars).join("");
}

function isBackendUploadUrl(url: string) {
  if (url.startsWith("/uploads/")) return true;
  try {
    const parsed = new URL(url);
    const backend = new URL(BACKEND_API);
    return parsed.origin === backend.origin && parsed.pathname.startsWith("/uploads/");
  } catch {
    return false;
  }
}

export function getDisplayAssetUrl(url?: string) {
  if (!url) return url;
  if (url.startsWith("/uploads/")) return `${BACKEND_API}${url}`;
  if (isBackendUploadUrl(url)) return url;
  if (!/^https?:\/\//i.test(url)) return url;
  return `/api-proxy/asset?url=${encodeURIComponent(url)}`;
}

export function getBackendAssetUrl(url: string) {
  if (url.startsWith("/uploads/")) return `${BACKEND_API}${url}`;
  return url;
}
