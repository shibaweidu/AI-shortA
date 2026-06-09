const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export interface StyleCategory {
  id: string;
  name: string;
  order: number;
}

export interface StylePreset {
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
}

export interface StyleLibrary {
  categories: StyleCategory[];
  styles: StylePreset[];
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
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Request failed: ${response.status}`);
  }
  return response.json() as Promise<T>;
}

export async function fetchStyleLibrary(admin = false) {
  return requestJson<StyleLibrary>(admin ? "/api/admin/style-library" : "/api/style-library");
}

export async function createStyleCategory(input: Pick<StyleCategory, "name"> & Partial<Pick<StyleCategory, "order">>) {
  return requestJson<StyleCategory>("/api/admin/style-categories", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateStyleCategory(id: string, input: Partial<Pick<StyleCategory, "name" | "order">>) {
  return requestJson<StyleCategory>(`/api/admin/style-categories/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteStyleCategory(id: string) {
  return requestJson<{ ok: true }>(`/api/admin/style-categories/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function createStylePreset(input: Partial<StylePreset> & Pick<StylePreset, "name" | "coverImageUrl">) {
  return requestJson<StylePreset>("/api/admin/styles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createCustomStylePreset(input: Partial<StylePreset> & Pick<StylePreset, "name" | "coverImageUrl">) {
  return requestJson<StylePreset>("/api/styles", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function updateStylePreset(id: string, input: Partial<StylePreset>) {
  return requestJson<StylePreset>(`/api/admin/styles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function updateCustomStylePreset(id: string, input: Partial<Pick<StylePreset, "name">>) {
  return requestJson<StylePreset>(`/api/styles/${encodeURIComponent(id)}`, {
    method: "PUT",
    body: JSON.stringify(input),
  });
}

export async function deleteCustomStylePreset(id: string) {
  return requestJson<{ ok: true }>(`/api/styles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function deleteStylePreset(id: string) {
  return requestJson<{ ok: true }>(`/api/admin/styles/${encodeURIComponent(id)}`, { method: "DELETE" });
}

export async function uploadStyleImage(file: File) {
  const formData = new FormData();
  formData.append("images", file);
  const response = await fetch(makeBackendUrl("/api/uploads/images"), {
    method: "POST",
    body: formData,
  });
  if (!response.ok) {
    const text = await response.text();
    throw new Error(text || `Upload failed: ${response.status}`);
  }
  const data = await response.json();
  const uploaded = Array.isArray(data?.files) ? data.files[0] : null;
  const url = typeof uploaded?.url === "string" ? uploaded.url : "";
  if (!url) throw new Error("Upload did not return an image URL");
  return url;
}
