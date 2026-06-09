import type { FlowReferenceRole } from "../store/flowStore";
import type { ProviderConfig } from "../store/settingsStore";

const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

export interface ReferenceSettings {
  visionModelValue: string;
  classificationPrompt: string;
  rolePrompts: Record<FlowReferenceRole, string>;
}

export const DEFAULT_REFERENCE_SETTINGS: ReferenceSettings = {
  visionModelValue: "",
  classificationPrompt:
    '判断这张图作为 AI 生图参考时最适合的类型。只能返回 JSON：{"role":"character|scene|object|general","confidence":0-1}。character=人物、动物、IP角色、角色设定；scene=环境、建筑、室内外空间、风景；object=商品、道具、装备、单个物品；general=无明确主体或不适合分类。',
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

export async function fetchReferenceSettings() {
  try {
    return await requestJson<ReferenceSettings>("/api/reference-settings");
  } catch {
    return DEFAULT_REFERENCE_SETTINGS;
  }
}

export async function updateReferenceSettings(settings: ReferenceSettings) {
  return requestJson<ReferenceSettings>("/api/reference-settings", {
    method: "PUT",
    body: JSON.stringify(settings),
  });
}

export async function classifyReferenceImage(input: {
  imageUrl: string;
  modelId: string;
  provider: Pick<ProviderConfig, "id" | "name" | "baseUrl" | "key" | "logAccessToken">;
}) {
  return requestJson<{ role: FlowReferenceRole; confidence: number }>("/api/reference-classify", {
    method: "POST",
    body: JSON.stringify(input),
  });
}
