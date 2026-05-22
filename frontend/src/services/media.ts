import { useSettingsStore, type ModelType, type ProviderConfig, type ProviderModel } from "../store/settingsStore";
import { useUserModelStore } from "../store/userModelStore";
import { getDefaultModelApiRoutes, getEnabledModelApiEndpoints, type ModelApiEndpoint } from "../lib/modelApiRoutes";
import { parseProviderModelValue, parseSourcedProviderModelValue } from "../lib/providerModels";
import { withSelectedProviderKey } from "../lib/providerKeys";
import { DEFAULT_REFERENCE_SETTINGS, fetchReferenceSettings } from "./referenceSettings";
import { resolveReferenceImageDataUrl } from "./referenceImages";

const API_PROXY = "/api-proxy";
const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";
const VIDEO_TASK_POLL_INTERVAL_MS = 3000;
const VIDEO_TASK_MAX_POLLS = 120;
const IMAGE_JOB_POLL_INTERVAL_MS = 2000;
const IMAGE_JOB_MAX_POLLS = 300;
export const MISSING_IMAGE_JOB_STATUS = "missing";

type BackendImageJobResponse = {
  id: string;
  status: string;
  mediaType?: MediaJobType;
  createdAt?: number;
  updatedAt?: number;
  resultUrl?: string;
  error?: string;
  missing?: boolean;
  request?: {
    prompt?: string;
    model?: string;
    size?: string;
    duration?: string | number;
  };
};
type MediaJobType = "image" | "video";

function isMediaDebugEnabled() {
  return typeof localStorage !== "undefined" && localStorage.getItem("media-debug") === "1";
}

function debugMedia(label: string, value: unknown) {
  if (!isMediaDebugEnabled()) return;
  console.log(`[media-debug] ${label}`, value);
}

function reportImageJobClientEvent(clientTaskId: string | undefined, event: string, details: Record<string, unknown> = {}) {
  void fetch(`${BACKEND_API}/api/client-log`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientTaskId, event, details }),
  }).catch(() => undefined);
}

function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.replace(/\/+$/, "");
}

function isGeminiProvider(provider: ProviderConfig) {
  const text = `${provider.id} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  if (text.includes("gemini") || text.includes("google") || text.includes("generativelanguage")) return true;
  return false;
}

function buildOpenAIEndpointCandidates(_baseUrl: string, path: string) {
return [path];
}

function buildOpenAIChatEndpointCandidates(baseUrl: string) {
  return buildOpenAIEndpointCandidates(baseUrl, "/chat/completions");
}

function buildOpenAIImageEndpointCandidates(baseUrl: string) {
  return buildOpenAIEndpointCandidates(baseUrl, "/images/generations");
}

function buildOpenAIResponsesEndpointCandidates(baseUrl: string) {
  return buildOpenAIEndpointCandidates(baseUrl, "/responses");
}

function buildGeminiImageEndpointCandidates(baseUrl: string, modelId: string, apiKey?: string) {
  const normalized = normalizeBaseUrl(baseUrl);
  const encodedModelId = encodeURIComponent(modelId);
  const keySuffix = apiKey ? `?key=${encodeURIComponent(apiKey)}` : "";
  const candidates = new Set<string>();
  const exactModelActionMatch = normalized.match(/^(.*\/models\/)([^/:]+)(:generateContent)$/i);
  if (exactModelActionMatch) {
    candidates.add(`${exactModelActionMatch[1]}${encodedModelId}${exactModelActionMatch[3]}${keySuffix}`);
    return Array.from(candidates);
  }

  if (/:generateContent$/i.test(normalized)) {
    candidates.add(`${normalized}${keySuffix}`);
    return Array.from(candidates);
  }

  const exactModelMatch = normalized.match(/^(.*\/models\/)([^/]+)$/i);
  if (exactModelMatch) {
    candidates.add(`${exactModelMatch[1]}${encodedModelId}:generateContent${keySuffix}`);
  }

  if (/\/v\d+(?:beta\d+)?$/i.test(normalized)) {
    candidates.add(`${normalized}/models/${encodedModelId}:generateContent${keySuffix}`);
    // Also try v1beta for aggregators that expose Gemini under /v1 but route internally via /v1beta
    const v1Match = normalized.match(/^(.*)\/v1$/i);
    if (v1Match) {
      candidates.add(`${v1Match[1]}/v1beta/models/${encodedModelId}:generateContent${keySuffix}`);
    }
  } else {
    candidates.add(`${normalized}/v1beta/models/${encodedModelId}:generateContent${keySuffix}`);
    candidates.add(`${normalized}/models/${encodedModelId}:generateContent${keySuffix}`);
  }

  return Array.from(candidates);
}

function buildVideoEndpointCandidates(_baseUrl: string) {
 return buildEndpointCandidates([
    "/video/generations",
    "/videos/generations",
    "/video/generate",
    "/videos",
  ]);
}

function buildVideoTaskEndpointCandidates(_baseUrl: string, taskId: string) {
const encodedTaskId = encodeURIComponent(taskId);
 return buildEndpointCandidates([
    `/video/generations/${encodedTaskId}`,
    `/videos/generations/${encodedTaskId}`,
    `/video/tasks/${encodedTaskId}`,
    `/videos/${encodedTaskId}`,
  ]);
}

function buildSoraVideoTaskEndpointCandidates(_baseUrl: string, taskId: string) {
const encodedTaskId = encodeURIComponent(taskId);
 return buildEndpointCandidates([`/video/generations/${encodedTaskId}`]);
}

function isSoraModel(model: ProviderModel) {
  return `${model.id} ${model.name}`.toLowerCase().includes("sora");
}

function isVeoModel(model: ProviderModel) {
  return `${model.id} ${model.name}`.toLowerCase().includes("veo");
}

function isVeoReferenceModel(model: ProviderModel) {
  return `${model.id} ${model.name}`.toLowerCase().includes("veo") && `${model.id} ${model.name}`.toLowerCase().includes("ref");
}

function isGrokVideoModel(model: ProviderModel) {
  const text = `${model.id} ${model.name}`.toLowerCase();
  return text.includes("grok-imagine-video") || text.includes("grok-video");
}

export function shouldPreferChatCompletionsVideo(provider: ProviderConfig, model: ProviderModel) {
  if (!isGrokVideoModel(model)) return false;
  const providerText = `${provider.id} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  return !providerText.includes("yunw") && !providerText.includes("云雾");
}

function isGptImageModel(model: ProviderModel) {
  return `${model.id} ${model.name}`.toLowerCase().includes("gpt-image");
}

function isGeekAIProvider(provider: ProviderConfig) {
  const value = `${provider.id} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  return value.includes("geekai") || value.includes("geeknow.top") || value.includes("geeknow.ai");
}

function isYunwuProvider(provider: ProviderConfig) {
  const value = `${provider.id} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  return value.includes("yunw") || value.includes("云雾");
}

function isGrokImageModel(model: ProviderModel) {
  const value = `${model.id} ${model.name}`.toLowerCase();
  return value.includes("grok") && value.includes("image");
}

function normalizeGrokImageResolution(resolution?: string, size?: string) {
  if (resolution === "1k" || resolution === "2k") return resolution;
  if (resolution === "4k") return "2k";
  if (!size) return undefined;
  const dimensions = size.split("x").map((part) => Number.parseInt(part, 10)).filter(Number.isFinite);
  const maxDim = dimensions.length > 0 ? Math.max(...dimensions) : 0;
  if (maxDim >= 1440) return "2k";
  return "1k";
}

function isQiyuanImageProvider(provider: ProviderConfig) {
  const value = `${provider.name} ${provider.baseUrl}`.toLowerCase();
  return value.includes("mingyu.it.com") || value.includes("启元") || value.includes("qiyuan");
}

export function shouldPreferChatReferenceImages(provider: ProviderConfig, model: ProviderModel) {
  const modelValue = `${model.id} ${model.name}`.toLowerCase();
  return isQiyuanImageProvider(provider) || modelValue.includes("nano-banana");
}

function isNanoBananaImageModel(model: ProviderModel) {
  return `${model.id} ${model.name}`.toLowerCase().includes("nano-banana");
}

function getQiyuanImageSize(size?: string, ratio?: string) {
  if (ratio && ratio !== "auto") return ratio.replace(":", "x");
  if (size === "2560x1440") return "16x9";
  if (size === "1440x2560") return "9x16";
  if (size === "1440x1440" || size === "1024x1024") return "1x1";
  return size;
}

function getVideoSizeFromRatio(ratio: string) {
  if (ratio === "9:16") return "720x1280";
  if (ratio === "16:9") return "1280x720";
  return undefined;
}

function getSoraVideoSizeFromRatio(ratio: string) {
  if (ratio === "9:16") return "9x16";
  return "16x9";
}

function normalizeVeoResolution(resolution?: string) {
  return resolution === "1080p" ? "1080p" : "720p";
}

function getVeoVideoSizeFromRatio(ratio: string, resolution?: string) {
  const ratioText = ratio === "9:16" ? "9x16" : "16x9";
  return `${ratioText}-${normalizeVeoResolution(resolution)}`;
}

function formatDurationSeconds(duration: number) {
  return `${duration}s`;
}

function buildSoraPrompt(prompt: string, ratio: string, duration: number) {
  const durationText = formatDurationSeconds(duration);
  return `${prompt}\n\nRequired video settings: aspect ratio ${ratio}; exact duration ${durationText}. Do not use any other duration.`;
}

function normalizeSoraDuration(duration: number) {
  const rounded = Math.round(duration);
  if (rounded === 4 || rounded === 8 || rounded === 12) return rounded;
  return 8;
}

function normalizeGrokVideoDuration(duration: number, provider?: ProviderConfig) {
  const providerText = `${provider?.id ?? ""} ${provider?.name ?? ""} ${provider?.baseUrl ?? ""}`.toLowerCase();
  if ((providerText.includes("geekai") || providerText.includes("geeknow.top") || providerText.includes("geeknow.ai")) && Math.round(duration) === 6) return 6;
  return 10;
}

function getFirstVideoReferenceImage(payload: Record<string, unknown>) {
  const directImage = typeof payload.image === "string" && payload.image ? payload.image : undefined;
  const inputReference = typeof payload.input_reference === "string" && payload.input_reference
    ? payload.input_reference
    : typeof payload.inputReference === "string" && payload.inputReference
      ? payload.inputReference
      : undefined;
  const images = Array.isArray(payload.images) ? payload.images.filter((value): value is string => typeof value === "string" && Boolean(value)) : [];
  const referenceImages = Array.isArray(payload.reference_images)
    ? payload.reference_images.filter((value): value is string => typeof value === "string" && Boolean(value))
    : Array.isArray(payload.referenceImages)
      ? payload.referenceImages.filter((value): value is string => typeof value === "string" && Boolean(value))
      : [];
  return directImage ?? inputReference ?? images[0] ?? referenceImages[0];
}

function normalizeSingleImageVideoPayload(payload: Record<string, unknown>) {
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

function getModelApiEndpoints(provider: ProviderConfig, model: ProviderModel, type: ModelType): ModelApiEndpoint[] {
  const configured = getEnabledModelApiEndpoints(model, type);
  if (configured.length) return configured;
  return getDefaultModelApiRoutes({
    providerId: provider.id,
    providerName: provider.name,
    providerBaseUrl: provider.baseUrl,
    modelId: model.id,
    modelName: model.name,
    type,
  }).map((route) => route.endpoint);
}

function resolveProviderModel(modelId: string, type: ModelType): { provider: ProviderConfig; model: ProviderModel } {
  const sourcedValue = parseSourcedProviderModelValue(modelId);
  const providers = sourcedValue?.source === "custom" ? useUserModelStore.getState().providers : useSettingsStore.getState().providers;
  const rawModelId = sourcedValue ? `${sourcedValue.providerId}::${sourcedValue.modelId}` : modelId;
  const parsedValue = sourcedValue ?? parseProviderModelValue(rawModelId);

  if (parsedValue) {
    const provider = providers.find((item) => item.id === parsedValue.providerId);
    const model = provider?.models[type].find((item) => item.id === parsedValue.modelId);
    if (provider && model) {
      if (!provider.baseUrl || !provider.key) {
        throw new Error(`Provider ${provider.name} is missing API Base URL or API Key`);
      }
      return { provider, model };
    }
  }

  for (const provider of providers) {
    const model = provider.models[type].find((item) => item.id === modelId);
    if (model) {
      if (!provider.baseUrl || !provider.key) {
        throw new Error(`Provider ${provider.name} is missing API Base URL or API Key`);
      }
      return { provider, model };
    }
  }

  throw new Error(`Model ${modelId} was not found in configured ${type} providers`);
}

function buildEndpointCandidates(suffixes: string[]) {
 return Array.from(new Set(suffixes));
}

async function postJson<T>(
  provider: ProviderConfig,
 paths: string[],
  payload: Record<string, unknown>,
  accept = "application/json",
  clientTaskId?: string
): Promise<T> {
const errors: string[] = [];

 for (const path of paths) {
 const endpoint = path;
 const proxyPath = path.startsWith("http") ? `?target=${encodeURIComponent(path)}` : `${path.startsWith("/") ? path : `/${path}`}`;
    try {
 const response = await fetch(makeBackendUrl(`/api/openai-compatible${proxyPath}`), {
        method: "POST",
        headers: {
 "Content-Type": "application/json",
 Accept: accept,
          ...(clientTaskId ? { "x-client-task-id": clientTaskId } : {}),
        },
 body: JSON.stringify({ provider: toBackendProvider(provider), path, payload }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.warn("[media] provider request failed", {
          endpoint,
          status: response.status,
          statusText: response.statusText,
          payload: {
            model: payload.model,
            size: payload.size,
            duration: payload.duration,
          },
          body: errText.slice(0, 1000),
        });
        errors.push(`HTTP ${response.status} @ ${endpoint}: ${errText.slice(0, 500)}`);
        continue;
      }

      const responseText = await response.text();
      debugMedia("postJson response", { endpoint, body: responseText.slice(0, 4000) });
      try {
        return JSON.parse(responseText) as T;
      } catch {
        errors.push(`Non-JSON response @ ${endpoint}: ${responseText.slice(0, 200)}`);
        continue;
      }
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

interface JsonAttempt {
  endpoints: string[];
  payload: Record<string, unknown>;
  label?: string;
  accept?: string;
  clientTaskId?: string;
}

async function postJsonWithFallbacks<T>(provider: ProviderConfig, attempts: JsonAttempt[]): Promise<T> {
  const errors: string[] = [];

  for (const attempt of attempts) {
    try {
      return await postJson<T>(provider, attempt.endpoints, attempt.payload, attempt.accept, attempt.clientTaskId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(attempt.label ? `[${attempt.label}] ${message}` : message);
    }
  }

  throw new Error(errors.join(" | "));
}

async function getJson<T>(provider: ProviderConfig, candidates: string[]): Promise<T> {
const errors: string[] = [];

for (const endpoint of candidates) {
try {
 const proxyPath = endpoint.startsWith("http") ? `?target=${encodeURIComponent(endpoint)}` : `${endpoint.startsWith("/") ? endpoint : `/${endpoint}`}`;
 const response = await fetch(makeBackendUrl(`/api/openai-compatible${proxyPath}`), {
 method: "POST",
 headers: { "Content-Type": "application/json" },
 body: JSON.stringify({ provider: toBackendProvider(provider), path: endpoint }),
});

      if (!response.ok) {
        const errText = await response.text();
        errors.push(`HTTP ${response.status} @ ${endpoint}: ${errText.slice(0, 500)}`);
        continue;
      }

      return (await response.json()) as T;
    } catch (error) {
      errors.push(`${endpoint}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  throw new Error(errors.join(" | "));
}

function sleep(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function makeBackendUrl(path: string) {
  return `${BACKEND_API}${path.startsWith("/") ? path : `/${path}`}`;
}

function absolutizeBackendUrl(url: string) {
if (/^https?:\/\//i.test(url)) return url;
return new URL(url, `${BACKEND_API}/`).href;
}

function toBackendProvider(provider: ProviderConfig) {
 const selectedProvider = withSelectedProviderKey(provider);
 return {
 id: selectedProvider.id,
 name: selectedProvider.name,
 baseUrl: selectedProvider.baseUrl,
 key: selectedProvider.key,
 logAccessToken: selectedProvider.logAccessToken,
 };
}

function toDataUrl(base64: string, mime = "image/png") {
  return `data:${mime};base64,${base64}`;
}

function isLikelyBase64Image(value: string) {
  return value.length > 100 && /^(?:iVBORw0KGgo|\/9j\/|UklGR|R0lGOD|AAAA)[a-z0-9+/]+=*$/i.test(value.replace(/\s+/g, ""));
}

function toImageDataUrl(base64: string) {
  return toDataUrl(base64.replace(/\s+/g, ""));
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
  const match = dataUrl.match(/^data:([^;]+);base64,([\s\S]+)$/i);
  if (!match) return dataUrl;
  const mimeType = match[1].toLowerCase();
  if (mimeType.startsWith("image/")) return dataUrl;

  const detectedMime = detectImageMimeFromBase64(match[2]);
  if (!detectedMime) return dataUrl;
  return `data:${detectedMime};base64,${match[2].replace(/\s+/g, "")}`;
}

function extractImagesFromParts(parts: any[]): string[] {
  const results: string[] = [];

  for (const part of parts) {
    if (typeof part?.inlineData?.data === "string") {
      results.push(toDataUrl(part.inlineData.data, part.inlineData.mimeType || "image/png"));
      continue;
    }
    if (typeof part?.inline_data?.data === "string") {
      results.push(toDataUrl(part.inline_data.data, part.inline_data.mime_type || "image/png"));
      continue;
    }
    if (typeof part?.image_url?.url === "string") {
      results.push(part.image_url.url);
      continue;
    }
    if (typeof part?.image_url === "string") {
      results.push(part.image_url);
      continue;
    }
    if (typeof part?.image?.url === "string") {
      results.push(part.image.url);
      continue;
    }
    if (typeof part?.image?.b64_json === "string") {
      results.push(toDataUrl(part.image.b64_json));
      continue;
    }
    if (typeof part?.url === "string") {
      results.push(part.url);
      continue;
    }
    if (typeof part?.text === "string") {
      // Handle markdown image syntax: ![alt](url)
      const mdMatches = Array.from(part.text.matchAll(/!\[.*?\]\((https?:\/\/[^\s)]+)\)/g)) as RegExpMatchArray[];
      if (mdMatches.length > 0) {
        results.push(...mdMatches.map((match) => match[1]));
      }
      // Plain URL
      const plainMatches = Array.from(part.text.matchAll(/https?:\/\/[^\s'"<>)]+/g)) as RegExpMatchArray[];
      if (plainMatches.length > 0) {
        results.push(...plainMatches.map((match) => match[0]));
      }
    }
  }

  return Array.from(new Set(results));
}

function parseImageResponses(response: any): string[] {
  const results: string[] = [];
  const pushImage = (value?: string | null) => {
    if (value) results.push(value);
  };
  const pushImages = (values?: string[] | null) => {
    if (!values?.length) return;
    results.push(...values);
  };

  if (typeof response === "string") pushImage(response);
  if (typeof response?.url === "string") pushImage(response.url);
  if (typeof response?.image_url === "string") pushImage(response.image_url);
  if (typeof response?.result_url === "string") pushImage(response.result_url);
  if (typeof response?.output === "string") pushImage(response.output);
  if (typeof response?.b64_json === "string") pushImage(toDataUrl(response.b64_json));
  if (typeof response?.base64 === "string") pushImage(toDataUrl(response.base64));
  if (typeof response?.image_base64 === "string") pushImage(toDataUrl(response.image_base64));
  if (typeof response?.result === "string" && isLikelyBase64Image(response.result)) pushImage(toImageDataUrl(response.result));
  if (typeof response?.data?.url === "string") pushImage(response.data.url);
  if (typeof response?.data?.image_url === "string") pushImage(response.data.image_url);
  if (typeof response?.data?.result_url === "string") pushImage(response.data.result_url);
  if (typeof response?.data?.b64_json === "string") pushImage(toDataUrl(response.data.b64_json));
  if (typeof response?.data?.base64 === "string") pushImage(toDataUrl(response.data.base64));
  if (typeof response?.data?.image_base64 === "string") pushImage(toDataUrl(response.data.image_base64));
  if (typeof response?.data?.data === "string" && isLikelyBase64Image(response.data.data)) pushImage(toImageDataUrl(response.data.data));
  if (typeof response?.data?.data?.url === "string") pushImage(response.data.data.url);
  if (typeof response?.data?.data?.image_url === "string") pushImage(response.data.data.image_url);
  if (typeof response?.data?.data?.output_url === "string") pushImage(response.data.data.output_url);
  if (typeof response?.data?.data?.result_url === "string") pushImage(response.data.data.result_url);
  if (typeof response?.data?.data?.b64_json === "string") pushImage(toDataUrl(response.data.data.b64_json));
  if (typeof response?.data?.data?.base64 === "string") pushImage(toDataUrl(response.data.data.base64));
  if (typeof response?.data?.data?.image_base64 === "string") pushImage(toDataUrl(response.data.data.image_base64));
  if (Array.isArray(response?.output) && typeof response.output[0] === "string") pushImages(response.output);
  if (Array.isArray(response?.output)) {
    for (const item of response.output) {
      if (typeof item?.url === "string") pushImage(item.url);
      if (typeof item?.image_url === "string") pushImage(item.image_url);
      if (typeof item?.b64_json === "string") pushImage(toDataUrl(item.b64_json));
      if (typeof item?.base64 === "string") pushImage(toDataUrl(item.base64));
      if (typeof item?.image_base64 === "string") pushImage(toDataUrl(item.image_base64));
      if (typeof item?.result === "string" && isLikelyBase64Image(item.result)) pushImage(toImageDataUrl(item.result));
      if (Array.isArray(item?.content)) pushImages(extractImagesFromParts(item.content));
    }
  }
  if (Array.isArray(response?.data) && response.data[0]) {
    for (const item of response.data) {
      if (typeof item?.url === "string") pushImage(item.url);
      if (typeof item?.b64_json === "string") pushImage(toDataUrl(item.b64_json));
      if (typeof item?.base64 === "string") pushImage(toDataUrl(item.base64));
      if (typeof item?.image_base64 === "string") pushImage(toDataUrl(item.image_base64));
      if (typeof item?.result === "string" && isLikelyBase64Image(item.result)) pushImage(toImageDataUrl(item.result));
      if (typeof item?.image_url === "string") pushImage(item.image_url);
    }
  }
  if (Array.isArray(response?.choices) && response.choices[0]?.message) {
    const message = response.choices[0].message;
    if (Array.isArray(message?.images) && message.images[0]) {
      for (const item of message.images) {
        if (typeof item?.url === "string") pushImage(item.url);
        if (typeof item?.image_url === "string") pushImage(item.image_url);
        if (typeof item?.b64_json === "string") pushImage(toDataUrl(item.b64_json));
        if (typeof item?.base64 === "string") pushImage(toDataUrl(item.base64));
        if (typeof item?.image_base64 === "string") pushImage(toDataUrl(item.image_base64));
        if (typeof item?.result === "string" && isLikelyBase64Image(item.result)) pushImage(toImageDataUrl(item.result));
      }
    }
    if (typeof message?.content === "string") {
      const matchedUrls = (Array.from(message.content.matchAll(/https?:\/\/[^\s'"<>)]+/g)) as RegExpMatchArray[]).map((match) => match[0]);
      pushImages(matchedUrls);
    }
    if (Array.isArray(message?.content)) {
      pushImages(extractImagesFromParts(message.content));
    }
  }
  if (Array.isArray(response?.candidates)) {
    for (const candidate of response.candidates) {
      if (!Array.isArray(candidate?.content?.parts)) continue;
      pushImages(extractImagesFromParts(candidate.content.parts));
    }
  }
  if (typeof response?.result?.url === "string") pushImage(response.result.url);
  if (typeof response?.result?.image_url === "string") pushImage(response.result.image_url);
  if (typeof response?.result?.result_url === "string") pushImage(response.result.result_url);
  if (typeof response?.result?.b64_json === "string") pushImage(toDataUrl(response.result.b64_json));
  if (typeof response?.result?.base64 === "string") pushImage(toDataUrl(response.result.base64));
  if (typeof response?.result?.image_base64 === "string") pushImage(toDataUrl(response.result.image_base64));

  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      if (/^data:image\//i.test(value) || /^https?:\/\//i.test(value)) {
        pushImage(value);
        return;
      }
      const matchedUrls = Array.from(value.matchAll(/https?:\/\/[^\s'"<>)]+/g)).map((match) => match[0]);
      pushImages(matchedUrls);
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
      if (typeof candidate === "string") pushImage(candidate);
    }
    if (typeof item.b64_json === "string") pushImage(toDataUrl(item.b64_json));
    if (typeof item.base64 === "string") pushImage(toDataUrl(item.base64));
    if (typeof item.image_base64 === "string") pushImage(toDataUrl(item.image_base64));
    if (typeof item.result === "string" && isLikelyBase64Image(item.result)) pushImage(toImageDataUrl(item.result));
    if (typeof item.data === "string" && isLikelyBase64Image(item.data)) pushImage(toImageDataUrl(item.data));

    for (const nested of Object.values(item)) {
      visit(nested);
    }
  };
  visit(response);

  const uniqueResults = Array.from(new Set(results));
  debugMedia("parseImageResponses results", { results: uniqueResults, response });
  if (uniqueResults.length > 0) return uniqueResults;

  throw new Error(`Provider returned no usable image URL. Response keys: ${Object.keys(response ?? {}).join(", ")}`);
}

function parseVideoResponse(response: any): string {
  const extractFromText = (text: string) => {
    const srcMatch = text.match(/<video\b[^>]*\bsrc=["']([^"']+)["']/i);
    if (srcMatch?.[1]) return srcMatch[1];
    const videoUrl = Array.from(text.matchAll(/https?:\/\/[^\s'"<>)]+/g))
      .map((match) => match[0].replace(/[),.;\]]+$/g, ""))
      .find((url) => /\.(?:mp4|webm|mov|m4v|mkv|avi|mpeg|mpg|m3u8)(?:[?#]|$)/i.test(url) || /\/(?:video|videos|generated|content)\//i.test(url));
    return videoUrl;
  };

  if (typeof response?.url === "string") return response.url;
  if (typeof response?.video_url === "string") return response.video_url;
  if (typeof response?.result_url === "string") return response.result_url;
  if (typeof response?.data?.result_url === "string") return response.data.result_url;
  if (typeof response?.data?.data?.url === "string") return response.data.data.url;
  if (typeof response?.data?.data?.output_url === "string") return response.data.data.output_url;
  if (Array.isArray(response?.data) && response.data[0]) {
    const item = response.data[0];
    if (typeof item?.url === "string") return item.url;
    if (typeof item?.video_url === "string") return item.video_url;
  }
  if (Array.isArray(response?.output) && typeof response.output[0] === "string") return response.output[0];
  if (typeof response?.result?.url === "string") return response.result.url;
  if (Array.isArray(response?.choices) && response.choices[0]?.message) {
    const message = response.choices[0].message;
    if (typeof message?.video_url === "string") return message.video_url;
    if (typeof message?.url === "string") return message.url;
    if (typeof message?.content === "string") {
      const matchedUrl = extractFromText(message.content);
      if (matchedUrl) return matchedUrl;
    }
    if (Array.isArray(message?.content)) {
      for (const part of message.content) {
        if (typeof part?.text === "string") {
          const matchedUrl = extractFromText(part.text);
          if (matchedUrl) return matchedUrl;
        }
        if (typeof part?.video_url?.url === "string") return part.video_url.url;
        if (typeof part?.url === "string") return part.url;
      }
    }
  }

  throw new Error("Provider returned no usable video URL");
}

function extractVideoTaskId(response: any): string | null {
  const candidates = [
    response?.task_id,
    response?.taskId,
    response?.id,
    response?.data?.task_id,
    response?.data?.taskId,
    response?.data?.id,
    response?.result?.task_id,
    response?.result?.taskId,
    response?.result?.id,
  ];
  return candidates.find((value) => typeof value === "string" && value.trim()) ?? null;
}

function extractProgress(response: any): number | undefined {
  const raw = response?.progress ?? response?.data?.progress ?? response?.data?.data?.progress ?? response?.result?.progress ?? response?.percentage ?? response?.data?.percentage;
  if (typeof raw === "number") return Math.max(0, Math.min(100, raw > 0 && raw <= 1 ? raw * 100 : raw));
  if (typeof raw === "string") {
    const parsed = Number.parseFloat(raw.replace("%", ""));
    if (Number.isFinite(parsed)) return Math.max(0, Math.min(100, parsed > 0 && parsed <= 1 ? parsed * 100 : parsed));
  }
  return undefined;
}

function isVideoTaskCompleted(response: any) {
  const status = String(response?.status ?? response?.data?.status ?? response?.result?.status ?? "").toLowerCase();
  return ["success", "succeeded", "completed", "complete", "finished", "done"].includes(status);
}

function isVideoTaskFailed(response: any) {
  const status = String(response?.status ?? response?.data?.status ?? response?.result?.status ?? "").toLowerCase();
  return ["failed", "failure", "error", "cancelled", "canceled"].includes(status);
}

function extractTaskError(response: any) {
  return response?.error?.message ?? response?.message ?? response?.data?.error ?? response?.data?.message ?? response?.result?.error;
}

async function pollVideoTask(provider: ProviderConfig, baseUrl: string, taskId: string, onProgress?: (progress: number) => void, isSora = false) {
  let optimisticProgress = 8;
  onProgress?.(optimisticProgress);

  for (let index = 0; index < VIDEO_TASK_MAX_POLLS; index += 1) {
    await sleep(VIDEO_TASK_POLL_INTERVAL_MS);
    const response = await getJson<any>(provider, isSora ? buildSoraVideoTaskEndpointCandidates(baseUrl, taskId) : buildVideoTaskEndpointCandidates(baseUrl, taskId));
    const progress = extractProgress(response);
    if (progress !== undefined) {
      onProgress?.(Math.min(99, progress));
    } else {
      optimisticProgress = Math.min(95, optimisticProgress + Math.max(1, Math.round((95 - optimisticProgress) * 0.12)));
      onProgress?.(optimisticProgress);
    }

    try {
      const url = parseVideoResponse(response);
      onProgress?.(100);
      return url;
    } catch {
      if (isVideoTaskFailed(response)) {
        throw new Error(String(extractTaskError(response) ?? "Video task failed"));
      }
      if (isVideoTaskCompleted(response)) {
        throw new Error("Video task completed but returned no usable video URL");
      }
    }
  }

  throw new Error("Video task polling timed out");
}

export interface GenerateImageOptions {
  modelId: string;
  prompt: string;
  referenceImageUrl?: string;
  referenceImageUrls?: string[];
  referenceImageRoles?: string[];
  styleReferenceImageUrls?: string[];
  styleReferencePrompt?: string;
  styleReferenceName?: string;
  styleStrength?: number;
  size?: string;
  ratio?: string;
  resolution?: string;
  n?: number;
  clientTaskId?: string;
}

function buildOpenAIChatContent(prompt: string, referenceImages: string[]) {
  const content: Array<Record<string, unknown>> = [{ type: "text", text: prompt }];
  for (const imageUrl of referenceImages) {
    content.push({ type: "image_url", image_url: { url: imageUrl } });
  }
  return content;
}

function buildOpenAIResponsesContent(prompt: string, referenceImages: string[]) {
  const content: Array<Record<string, unknown>> = [{ type: "input_text", text: prompt }];
  for (const imageUrl of referenceImages) {
    content.push({ type: "input_image", image_url: imageUrl });
  }
  return content;
}

function withImageOptions(payload: Record<string, unknown>, size?: string, ratio?: string) {
  if (size) payload.size = size;
  if (ratio) payload.aspect_ratio = ratio;
  return payload;
}

function withQiyuanImageOptions(payload: Record<string, unknown>, size?: string, ratio?: string) {
  const qiyuanSize = getQiyuanImageSize(size, ratio);
  if (qiyuanSize) payload.size = qiyuanSize;
  payload.quality = "medium";
  return payload;
}

function withGrokImageOptions(payload: Record<string, unknown>, size?: string, ratio?: string, resolution?: string) {
  if (ratio && ratio !== "auto") payload.aspect_ratio = ratio;
  const normalizedResolution = normalizeGrokImageResolution(resolution, size);
  if (normalizedResolution) payload.resolution = normalizedResolution;
  return payload;
}

function buildOpenAIImagePayload(modelId: string, prompt: string, n: number, size?: string, ratio?: string, referenceImages?: string[]) {
  const payload = withImageOptions({ model: modelId, prompt, n }, size, ratio);
  if (referenceImages && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }
  return payload;
}

function buildOpenAIResponsesImagePayload(modelId: string, prompt: string, referenceImages: string[], size?: string) {
  const imageGenerationTool: Record<string, unknown> = { type: "image_generation" };
  if (size) imageGenerationTool.size = size;

  return {
    model: modelId,
    input: [{ role: "user", content: buildOpenAIResponsesContent(prompt, referenceImages) }],
    tools: [imageGenerationTool],
  };
}

function buildOpenAIChatImagePayload(modelId: string, prompt: string, referenceImages: string[], n: number, size?: string, ratio?: string) {
  return withImageOptions(
    {
      model: modelId,
      messages: [
        {
          role: "user",
          content: referenceImages.length ? buildOpenAIChatContent(prompt, referenceImages) : prompt,
        },
      ],
      modalities: ["image", "text"],
      n,
    },
    size,
    ratio
  );
}

function buildQiyuanImagePayload(modelId: string, prompt: string, n: number, size?: string, ratio?: string, referenceImages?: string[]) {
  const payload = withQiyuanImageOptions({ model: modelId, prompt, n }, size, ratio);
  if (referenceImages && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }
  return payload;
}

function buildGrokImagePayload(modelId: string, prompt: string, n: number, size?: string, ratio?: string, resolution?: string, referenceImages?: string[]) {
  const payload = withGrokImageOptions({ model: modelId, prompt, n }, size, ratio, resolution);
  if (referenceImages && referenceImages.length > 0) {
    payload.reference_images = referenceImages;
  }
  return payload;
}

function buildQiyuanChatImagePayload(modelId: string, prompt: string, referenceImages: string[], size?: string, ratio?: string) {
  return withQiyuanImageOptions(
    {
      model: modelId,
      messages: [
        {
          role: "user",
          content: referenceImages.length ? buildOpenAIChatContent(prompt, referenceImages) : prompt,
        },
      ],
    },
    size,
    ratio
  );
}

function normalizeReferenceImageUrls(referenceImageUrls?: string[], referenceImageUrl?: string) {
  const urls = referenceImageUrls?.length ? referenceImageUrls : referenceImageUrl ? [referenceImageUrl] : [];
  return urls
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
    .map((url) => url.startsWith("/uploads/") ? absolutizeBackendUrl(url) : url);
}

function buildStyleReferenceInstruction(input: {
  prompt: string;
  styleReferenceCount: number;
  styleReferenceName?: string;
  styleReferencePrompt?: string;
  styleStrength?: number;
}) {
  if (!input.styleReferenceCount && !input.styleReferencePrompt?.trim()) return input.prompt;

  const strength =
    typeof input.styleStrength === "number"
      ? input.styleStrength >= 0.8
        ? "strong"
        : input.styleStrength <= 0.35
          ? "subtle"
          : "balanced"
      : "balanced";
  const lines = [
    input.prompt.trim(),
    "",
    "Style reference instruction:",
    `Apply a ${strength} style transfer from the selected style${input.styleReferenceName ? ` (${input.styleReferenceName})` : ""}.`,
    input.styleReferencePrompt ? `Style keywords: ${input.styleReferencePrompt.trim()}` : "",
    "Use the style reference image only for color palette, lighting, texture, rendering method, brushwork, material finish, mood, and overall visual treatment.",
    "Do not copy the style reference image's subject, character identity, pose, layout, objects, text, logo, or composition.",
    "Keep the generated content faithful to the user prompt and the ordinary content reference images.",
  ].filter(Boolean);
  return lines.join("\n");
}

function normalizeReferenceRole(role?: string) {
  return role === "character" || role === "scene" || role === "object" || role === "general" ? role : "general";
}

function buildContentReferenceInstruction(
  prompt: string,
  roles: string[],
  referenceCount: number,
  rolePrompts: Partial<Record<string, string>> = DEFAULT_REFERENCE_SETTINGS.rolePrompts
) {
  if (!referenceCount) return prompt;
  const roleLines = Array.from({ length: referenceCount }, (_, index) => {
    const number = index + 1;
    const role = normalizeReferenceRole(roles[index]);
    const template = rolePrompts[role] || DEFAULT_REFERENCE_SETTINGS.rolePrompts[role];
    return template.replaceAll("{index}", String(number));
  });
  return [
    prompt.trim(),
    "",
    "Content reference instruction:",
    "The ordinary content reference images are provided in order. Follow these roles:",
    ...roleLines,
    "Do not let a scene reference override the requested subject, and do not let an object reference become the main character unless the prompt asks for it.",
  ].filter(Boolean).join("\n");
}

async function normalizeReferenceImageForOpenAI(imageUrl: string) {
  if (typeof document === "undefined" || typeof Image === "undefined") return imageUrl;
  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode reference image"));
  });
  image.src = imageUrl;
  await loaded;

  const maxDimension = 1536;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to prepare reference image");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.86);
}

async function compressVideoReferenceImage(imageUrl: string) {
  if (typeof document === "undefined" || typeof Image === "undefined") return imageUrl;
  if (!/^data:image\//i.test(imageUrl) || imageUrl.length < 900_000) return imageUrl;

  const image = new Image();
  image.crossOrigin = "anonymous";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("Failed to decode video reference image"));
  });
  image.src = imageUrl;
  await loaded;

  const maxDimension = 1280;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Failed to prepare video reference image");
  context.fillStyle = "#fff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.drawImage(image, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.82);
}

async function normalizeReferenceImagesForOpenAI(referenceImages: string[], clientTaskId?: string) {
  const normalizedImages: string[] = [];
  for (const imageUrl of referenceImages) {
    try {
      normalizedImages.push(await normalizeReferenceImageForOpenAI(imageUrl));
    } catch (error) {
      reportImageJobClientEvent(clientTaskId, "reference.normalize.failed", {
        imageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      normalizedImages.push(imageUrl);
    }
  }
  return normalizedImages;
}

async function normalizeReferenceImagesForVideo(referenceImages: string[], clientTaskId?: string) {
  const normalizedImages: string[] = [];
  for (const imageUrl of referenceImages) {
    try {
      const resolvedUrl = normalizeImageDataUrlMime(await resolveReferenceImageDataUrl(imageUrl));
      normalizedImages.push(await compressVideoReferenceImage(resolvedUrl));
    } catch (error) {
      reportImageJobClientEvent(clientTaskId, "video.reference.normalize.failed", {
        imageUrl,
        error: error instanceof Error ? error.message : String(error),
      });
      normalizedImages.push(normalizeImageDataUrlMime(imageUrl));
    }
  }
  return normalizedImages.filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
}

async function createBackendImageJob({
  provider,
  endpoint,
  payload,
  referenceImages,
  useImageEdit,
  clientTaskId,
  attempts,
  mediaType = "image",
}: {
  provider: ProviderConfig;
  endpoint: string;
  payload: Record<string, unknown>;
  referenceImages?: string[];
  useImageEdit?: boolean;
  clientTaskId?: string;
  mediaType?: MediaJobType;
  attempts?: Array<{
    label?: string;
    endpoint: string;
    payload: Record<string, unknown>;
    referenceImages?: string[];
    useImageEdit?: boolean;
    mediaType?: MediaJobType;
  }>;
}) {
  reportImageJobClientEvent(clientTaskId, "backend-job.request", {
    endpoint,
    mediaType,
    referenceImageCount: referenceImages?.length ?? 0,
    useImageEdit: useImageEdit === true,
    attemptCount: attempts?.length ?? 0,
  });
  const selectedProvider = withSelectedProviderKey(provider);
  const response = await fetch(makeBackendUrl("/api/image-jobs"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      clientTaskId,
      provider: {
        id: selectedProvider.id,
        name: selectedProvider.name,
        baseUrl: selectedProvider.baseUrl,
        key: selectedProvider.key,
        logAccessToken: selectedProvider.logAccessToken,
      },
      endpoint,
      mediaType,
      payload,
      referenceImages,
      useImageEdit,
      attempts,
    }),
  });

  reportImageJobClientEvent(clientTaskId, "backend-job.response", {
    status: response.status,
    ok: response.ok,
  });

  if (!response.ok) {
    const text = await response.text();
    reportImageJobClientEvent(clientTaskId, "backend-job.failed", {
      status: response.status,
      bodyPreview: text.slice(0, 500),
    });
    throw new Error(`Backend image job failed to start: ${response.status} ${text.slice(0, 500)}`);
  }

  return response.json() as Promise<{ id: string; status: string; resultUrl?: string; error?: string }>;
}

function isMissingBackendImageJob(job: BackendImageJobResponse | null) {
  return job?.missing === true || job?.status === MISSING_IMAGE_JOB_STATUS;
}

async function getBackendImageJob(jobId: string) {
  try {
    const response = await fetch(makeBackendUrl(`/api/image-jobs/${encodeURIComponent(jobId)}`));
    if (!response.ok) return null;
    return response.json() as Promise<BackendImageJobResponse>;
  } catch {
    return null;
  }
}

async function listBackendMediaJobs(mediaType: MediaJobType, status = "completed", limit = 100) {
  try {
    const params = new URLSearchParams({
      mediaType,
      status,
      limit: String(limit),
    });
    const response = await fetch(makeBackendUrl(`/api/image-jobs?${params.toString()}`));
    if (!response.ok) return [];
    const data = await response.json();
    return Array.isArray(data?.jobs) ? data.jobs as BackendImageJobResponse[] : [];
  } catch {
    return [];
  }
}

async function waitForBackendImageJob(jobId: string) {
  for (let index = 0; index < IMAGE_JOB_MAX_POLLS; index += 1) {
    const job = await getBackendImageJob(jobId);
    if (job?.status === "completed" && job.resultUrl) return absolutizeBackendUrl(job.resultUrl);
    if (isMissingBackendImageJob(job)) throw new Error("Backend image job was not found");
    if (job?.status === "failed") throw new Error(job.error || "Backend image job failed");
    if (job?.status === "timeout-recoverable") throw new Error(job.error || "Backend image job timed out but may have succeeded upstream. Check provider dashboard.");
    await sleep(IMAGE_JOB_POLL_INTERVAL_MS);
  }
  throw new Error("Backend image job timed out");
}

async function waitForBackendMediaJob(jobId: string, mediaType: MediaJobType, onProgress?: (progress: number) => void) {
  let optimisticProgress = mediaType === "video" ? 8 : 0;
  if (mediaType === "video") onProgress?.(optimisticProgress);
  let lastRecoveryCheckAt = 0;

  for (let index = 0; index < IMAGE_JOB_MAX_POLLS; index += 1) {
    const job = await getBackendImageJob(jobId);
    if (job?.status === "completed" && job.resultUrl) {
      onProgress?.(100);
      return absolutizeBackendUrl(job.resultUrl);
    }
    if (isMissingBackendImageJob(job)) throw new Error(`Backend ${mediaType} job was not found`);
    if (job?.status === "failed") throw new Error(job.error || `Backend ${mediaType} job failed`);
    if (job?.status === "timeout-recoverable") throw new Error(job.error || `Backend ${mediaType} job timed out but may have succeeded upstream. Check provider dashboard.`);

    if (mediaType === "video") {
      optimisticProgress = Math.min(96, optimisticProgress + Math.max(1, Math.round((96 - optimisticProgress) * 0.06)));
      onProgress?.(optimisticProgress);
      const now = Date.now();
      if (optimisticProgress >= 90 && now - lastRecoveryCheckAt > 15000) {
        lastRecoveryCheckAt = now;
        const recoveredUrl = await recoverGeneratedVideoAsset(jobId).catch(() => null);
        if (recoveredUrl && recoveredUrl !== MISSING_IMAGE_JOB_STATUS) {
          onProgress?.(100);
          return recoveredUrl;
        }
      }
    }
    await sleep(IMAGE_JOB_POLL_INTERVAL_MS);
  }

  throw new Error(`Backend ${mediaType} job timed out`);
}

export async function generateImageAssets({
  modelId,
  prompt,
  referenceImageUrl,
  referenceImageUrls,
  referenceImageRoles,
  styleReferenceImageUrls,
  styleReferencePrompt,
  styleReferenceName,
  styleStrength,
  size = "1024x1024",
  ratio,
  resolution,
  n = 1,
  clientTaskId,
}: GenerateImageOptions) {
  const resolved = resolveProviderModel(modelId, "image");
  const provider = withSelectedProviderKey(resolved.provider);
  const { model } = resolved;
const imageGenEndpoints = buildOpenAIImageEndpointCandidates(provider.baseUrl);
const chatEndpoints = buildOpenAIChatEndpointCandidates(provider.baseUrl);
const rawReferenceImages = normalizeReferenceImageUrls(referenceImageUrls, referenceImageUrl);
const rawStyleReferenceImages = normalizeReferenceImageUrls(styleReferenceImageUrls);
reportImageJobClientEvent(clientTaskId, "generate.start", {
  modelId,
  providerId: provider.id,
  providerName: provider.name,
  providerBaseUrl: provider.baseUrl,
  promptLength: prompt.length,
  rawReferenceImageCount: rawReferenceImages.length,
  rawStyleReferenceImageCount: rawStyleReferenceImages.length,
  size,
  ratio,
  resolution,
  n,
});
const normalizedContentReferenceImages = await normalizeReferenceImagesForOpenAI(rawReferenceImages, clientTaskId);
const normalizedStyleReferenceImages = await normalizeReferenceImagesForOpenAI(rawStyleReferenceImages, clientTaskId);
const referenceSettings = await fetchReferenceSettings();
const normalizedReferenceImages = [...normalizedContentReferenceImages, ...normalizedStyleReferenceImages]
  .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index);
reportImageJobClientEvent(clientTaskId, "generate.references.ready", {
  normalizedReferenceImageCount: normalizedReferenceImages.length,
  normalizedStyleReferenceImageCount: normalizedStyleReferenceImages.length,
  dataImageCount: normalizedReferenceImages.filter((imageUrl) => /^data:image\//i.test(imageUrl)).length,
  remoteImageCount: normalizedReferenceImages.filter((imageUrl) => /^https?:\/\//i.test(imageUrl)).length,
});
let requestPrompt = prompt.trim() || (normalizedReferenceImages.length ? "Generate a new image based on the provided reference image." : prompt);
requestPrompt = buildContentReferenceInstruction(requestPrompt, referenceImageRoles ?? [], normalizedContentReferenceImages.length, referenceSettings.rolePrompts);
requestPrompt = buildStyleReferenceInstruction({
  prompt: requestPrompt,
  styleReferenceCount: normalizedStyleReferenceImages.length,
  styleReferenceName,
  styleReferencePrompt,
  styleStrength,
});

// Add aspect ratio and size instructions to prompt for providers that need it
  const instructions: string[] = [];
  if (ratio && ratio !== "auto") {
    instructions.push(`Make the aspect ratio ${ratio}`);
  }
  if (size) {
    instructions.push(`resolution ${size}`);
  }
  if (instructions.length > 0) {
    const instructionText = instructions.join(", ");
    requestPrompt = requestPrompt ? `${requestPrompt}, ${instructionText}` : instructionText;
  }

  if (isGeminiProvider(provider)) {
    const parts: Array<Record<string, unknown>> = [{ text: requestPrompt }];
    for (const imageUrl of normalizedReferenceImages) {
      const inlineData = parseDataUrl(imageUrl);
      if (!inlineData) continue;
      parts.push({
        inlineData: {
          mimeType: inlineData.mimeType,
          data: inlineData.data,
        },
      });
    }

    const response = await postJsonWithFallbacks<any>(provider, [
      {
        label: "gemini native generateContent",
        endpoints: buildGeminiImageEndpointCandidates(provider.baseUrl, model.id, provider.key),
        clientTaskId,
        payload: {
          contents: [
            {
              role: "user",
              parts,
            },
          ],
          generationConfig: {
            responseModalities: ["IMAGE"],
            candidateCount: n,
            imageConfig: {
              aspectRatio: ratio || "16:9",
              imageSize: (() => {
                const maxDim = Math.max(...size.split("x").map(Number));
                if (maxDim >= 2048) return "4K";
                if (maxDim >= 1536) return "2K";
                return "1K";
              })(),
            },
          },
        },
      },
    ]);
    const imageUrls = parseImageResponses(response);
    return imageUrls;
  }

  const isGptImage = isGptImageModel(model);
  const isNanoBanana = isNanoBananaImageModel(model);
  const isQiyuanImage = isQiyuanImageProvider(provider);
  const isGeekAIGrokImage = isGeekAIProvider(provider) && isGrokImageModel(model);
  const imagePayload = isGeekAIGrokImage
    ? buildGrokImagePayload(model.id, requestPrompt, n, size, ratio, resolution, provider.useReferenceImagesParam === true ? normalizedReferenceImages : undefined)
    : isQiyuanImage
    ? buildQiyuanImagePayload(model.id, requestPrompt, n, size, ratio, provider.useReferenceImagesParam === true ? normalizedReferenceImages : undefined)
    : buildOpenAIImagePayload(model.id, requestPrompt, n, size, ratio, provider.useReferenceImagesParam === true ? normalizedReferenceImages : undefined);
  const responsesImagePayload = buildOpenAIResponsesImagePayload(model.id, requestPrompt, normalizedReferenceImages, size);
  const chatImagePayload = isQiyuanImage
    ? buildQiyuanChatImagePayload(model.id, requestPrompt, normalizedReferenceImages, size, ratio)
    : buildOpenAIChatImagePayload(model.id, requestPrompt, normalizedReferenceImages, n, size, ratio);
  const useImageEdit = normalizedReferenceImages.length > 0;
// Check if provider supports reference_images parameter in /images/generations
  const supportsReferenceImagesInGenerations = provider.useReferenceImagesParam === true;
  const actualEndpoint = useImageEdit && !supportsReferenceImagesInGenerations ? "/images/edits" : "/images/generations";
  const actualUseImageEdit = useImageEdit && !supportsReferenceImagesInGenerations;
  
  // If provider supports reference_images in generations, add them to payload
  const finalImagePayload = supportsReferenceImagesInGenerations && normalizedReferenceImages.length > 0
    ? { ...imagePayload, reference_images: normalizedReferenceImages }
    : imagePayload;
  
  const imageAttempt = {
    label: actualUseImageEdit ? "openai images edits" : "openai images generations",
    endpoint: actualEndpoint,
    payload: finalImagePayload,
    referenceImages: actualUseImageEdit ? normalizedReferenceImages : undefined,
    useImageEdit: actualUseImageEdit,
  };
  const chatAttempt = {
    label: isQiyuanImage ? "mingyu chat completions image" : "openai chat completions image",
    endpoint: "/chat/completions",
    payload: chatImagePayload,
    referenceImages: undefined,
    useImageEdit: false,
  };
  const routeEndpoints = getModelApiEndpoints(provider, model, "image");
  const routeAttempts = routeEndpoints.flatMap((endpoint) => {
    if (endpoint === "/chat/completions") return [{ ...chatAttempt }];
    if (endpoint === "/responses") {
      return [{
        label: "openai responses image generation",
        endpoint: "/responses",
        payload: responsesImagePayload,
        referenceImages: undefined,
        useImageEdit: false,
      }];
    }
    if (endpoint === "/images/edits") {
      return [{
        label: "openai images edits",
        endpoint: "/images/edits",
        payload: imagePayload,
        referenceImages: normalizedReferenceImages.length ? normalizedReferenceImages : undefined,
        useImageEdit: normalizedReferenceImages.length > 0,
      }];
    }
    if (endpoint === "/images/generations") {
      return [{ ...imageAttempt, endpoint: "/images/generations", label: "openai images generations" }];
    }
    return [];
  });
  const backendAttemptsFromRoutes = routeAttempts.length ? routeAttempts : [imageAttempt];
  const firstBackendAttempt = backendAttemptsFromRoutes[0] ?? imageAttempt;

  if (isGptImage || isNanoBanana || isGeekAIGrokImage || actualUseImageEdit || (normalizedReferenceImages.length > 0 && supportsReferenceImagesInGenerations)) {
    try {
      const job = await createBackendImageJob({
        provider,
        endpoint: firstBackendAttempt.endpoint,
        payload: firstBackendAttempt.payload,
        referenceImages: firstBackendAttempt.referenceImages,
        useImageEdit: firstBackendAttempt.useImageEdit,
        clientTaskId,
        attempts: backendAttemptsFromRoutes,
      });
      const url = job.status === "completed" && job.resultUrl ? absolutizeBackendUrl(job.resultUrl) : await waitForBackendImageJob(job.id);
      return [url];
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/Failed to fetch|NetworkError|ERR_CONNECTION_REFUSED/i.test(message)) {
        throw new Error(`Backend image job service is unavailable. Start the backend service on ${BACKEND_API}. ${message}`);
      }
      throw error;
    }
  }

  const attempts: JsonAttempt[] = [];

  if (!useImageEdit) {
    attempts.push({
      label: "openai images generations",
      endpoints: imageGenEndpoints,
      payload: imagePayload,
      clientTaskId,
    });
  }

  if (!isGptImage) {
    attempts.push(
    {
      label: "openai responses image generation",
      endpoints: buildOpenAIResponsesEndpointCandidates(provider.baseUrl),
      payload: responsesImagePayload,
      clientTaskId,
    },
    {
      label: "openai chat completions image",
      endpoints: chatEndpoints,
      payload: chatImagePayload,
      clientTaskId,
    },
    );
  }

  const response = await postJsonWithFallbacks<any>(provider, attempts);
  const imageUrls = parseImageResponses(response);
  return imageUrls;
}

export async function generateImageAsset({
  modelId,
  prompt,
  referenceImageUrl,
  referenceImageUrls,
  referenceImageRoles,
  styleReferenceImageUrls,
  styleReferencePrompt,
  styleReferenceName,
  styleStrength,
  size = "1024x1024",
  ratio,
  resolution,
  n = 1,
  clientTaskId,
}: GenerateImageOptions) {
  try {
    const results = await generateImageAssets({
      modelId,
      prompt,
      referenceImageUrl,
      referenceImageUrls,
      referenceImageRoles,
      styleReferenceImageUrls,
      styleReferencePrompt,
      styleReferenceName,
      styleStrength,
      size,
      ratio,
      resolution,
      n,
      clientTaskId,
    });
    reportImageJobClientEvent(clientTaskId, "generate.completed", { resultCount: results.length });
    return results[0] ?? "";
  } catch (error) {
    reportImageJobClientEvent(clientTaskId, "generate.failed", {
      error: error instanceof Error ? error.message : String(error),
    });
    throw error;
  }
}

export async function recoverGeneratedImageAsset(clientTaskId: string) {
  const backendJob = await getBackendImageJob(clientTaskId);
  if (backendJob?.status === "completed" && backendJob.resultUrl) return absolutizeBackendUrl(backendJob.resultUrl);
  const backendJobMissing = isMissingBackendImageJob(backendJob);
  const isTimeoutRecoverable = backendJob?.status === "timeout-recoverable";

  const response = await fetch(`${API_PROXY}/generation-result/${encodeURIComponent(clientTaskId)}`);
  if (!response.ok) return backendJobMissing ? MISSING_IMAGE_JOB_STATUS : null;
  const data = await response.json();
  if (!data?.found || !data?.response) return backendJobMissing ? MISSING_IMAGE_JOB_STATUS : null;
  const imageUrls = parseImageResponses(data.response);
  const recoveredUrl = imageUrls[0];
  
  // If we recovered a URL for a timeout-recoverable job, attach it to the backend job
  if (recoveredUrl && isTimeoutRecoverable) {
    try {
      await fetch(makeBackendUrl(`/api/image-jobs/${encodeURIComponent(clientTaskId)}/result`), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ imageUrl: recoveredUrl }),
      });
    } catch {
      // Best effort - if attachment fails, still return the URL
    }
  }
  
  return recoveredUrl ?? (backendJobMissing ? MISSING_IMAGE_JOB_STATUS : null);
}

export async function recoverGeneratedImageAssets(): Promise<Array<{ clientTaskId?: string; prompt?: string; model?: string; url: string }>> {
  const response = await fetch(`${API_PROXY}/generation-results`);
  if (!response.ok) return [];
  const data = await response.json();
  if (!Array.isArray(data?.results)) return [];

  return data.results.flatMap((item: any) => {
    try {
      const imageUrls = parseImageResponses(item.response);
      return imageUrls.map((url) => ({
        clientTaskId: typeof item.clientTaskId === "string" ? item.clientTaskId : undefined,
        prompt: typeof item.request?.prompt === "string" ? item.request.prompt : undefined,
        model: typeof item.request?.model === "string" ? item.request.model : undefined,
        url,
      }));
    } catch {
      return [];
    }
  });
}

function normalizeRecoveredVideoPrompt(prompt?: string) {
  return (prompt ?? "")
    .replace(/\n\nRequired video settings:[\s\S]*$/i, "")
    .trim();
}

function normalizeRecoveredVideoRatio(size?: string) {
  if (!size) return undefined;
  return size.replace(/x/i, ":");
}

export async function recoverGeneratedVideoAsset(clientTaskId: string) {
  const backendJob = await getBackendImageJob(clientTaskId);
  if (backendJob?.status === "completed" && backendJob.resultUrl) return absolutizeBackendUrl(backendJob.resultUrl);
  if (isMissingBackendImageJob(backendJob)) return MISSING_IMAGE_JOB_STATUS;
  if (backendJob?.status === "failed") throw new Error(backendJob.error || "Backend video job failed");
  if (backendJob?.status === "timeout-recoverable") throw new Error(backendJob.error || "Backend video job timed out but may have succeeded upstream. Check provider dashboard.");
  return null;
}

export async function recoverGeneratedVideoAssets(): Promise<Array<{
  clientTaskId?: string;
  prompt?: string;
  model?: string;
  ratio?: string;
  duration?: string | number;
  updatedAt?: number;
  url: string;
}>> {
  const jobs = await listBackendMediaJobs("video", "completed", 100);
  return jobs.flatMap((job) => {
    if (!job.resultUrl) return [];
    return [{
      clientTaskId: job.id,
      prompt: normalizeRecoveredVideoPrompt(job.request?.prompt),
      model: job.request?.model,
      ratio: normalizeRecoveredVideoRatio(job.request?.size),
      duration: job.request?.duration,
      updatedAt: job.updatedAt,
      url: absolutizeBackendUrl(job.resultUrl),
    }];
  });
}

export async function deleteBackendImageAsset(jobId: string) {
  try {
    await fetch(makeBackendUrl(`/api/image-jobs/${encodeURIComponent(jobId)}/asset`), { method: "DELETE" });
  } catch {
    // Best-effort cleanup only; local saved files remain usable without this request.
  }
}

export interface GenerateVideoOptions {
  modelId: string;
  prompt: string;
  ratio?: string;
  resolution?: string;
  duration?: number;
  n?: number;
  startImageUrl?: string;
  endImageUrl?: string;
  referenceImageUrls?: string[];
  onProgress?: (progress: number) => void;
  clientTaskId?: string;
}

export async function generateVideoAsset({
  modelId,
  prompt,
  ratio = "16:9",
  resolution,
  duration = 5,
  startImageUrl,
  endImageUrl,
  referenceImageUrls,
  onProgress,
  clientTaskId,
}: GenerateVideoOptions) {
  const resolved = resolveProviderModel(modelId, "video");
  const provider = withSelectedProviderKey(resolved.provider);
  const { model } = resolved;
  const isSora = isSoraModel(model);
  const isVeo = isVeoModel(model);
  const isVeoRef = isVeoReferenceModel(model);
  const isGrokVideo = isGrokVideoModel(model);
  const isGeekAIGrokVideo = isGeekAIProvider(provider) && isGrokVideo;
  const maxReferenceImages = isSora || isGrokVideo ? 1 : isVeoRef ? 3 : isVeo ? 2 : 2;
  const rawInputReferenceImages = normalizeReferenceImageUrls(referenceImageUrls, startImageUrl)
    .concat(endImageUrl ? [endImageUrl] : [])
    .filter((value, index, list) => Boolean(value) && list.indexOf(value) === index)
    .slice(0, maxReferenceImages);
  const inputReferenceImages = await normalizeReferenceImagesForVideo(rawInputReferenceImages, clientTaskId);
  const videoSize = isSora ? getSoraVideoSizeFromRatio(ratio) : isVeo ? getVeoVideoSizeFromRatio(ratio, resolution) : getVideoSizeFromRatio(ratio);
  const normalizedDuration = isSora ? normalizeSoraDuration(duration) : isGrokVideo ? normalizeGrokVideoDuration(duration, provider) : duration;
  const chatPrompt = isSora
    ? buildSoraPrompt(prompt, ratio, normalizedDuration)
    : isGeekAIGrokVideo
    ? `${prompt}\n\nVideo settings: aspect ratio ${ratio}; duration ${formatDurationSeconds(normalizedDuration)}.`
    : prompt;
  const singleReferenceImage = inputReferenceImages.length === 1 ? inputReferenceImages[0] : undefined;
  const imageList = inputReferenceImages.length > 1 ? inputReferenceImages : undefined;
  const chatMessageContent = inputReferenceImages.length
    ? [
        { type: "text", text: chatPrompt },
        ...inputReferenceImages.map((imageUrl) => ({ type: "image_url", image_url: { url: imageUrl } })),
      ]
    : chatPrompt;
  const videoPayload = {
    model: model.id,
    prompt: chatPrompt,
    size: videoSize,
    aspect_ratio: ratio,
    resolution: isVeo ? normalizeVeoResolution(resolution) : undefined,
    duration: normalizedDuration,
    seconds: isSora ? String(normalizedDuration) : undefined,
    image: singleReferenceImage,
    images: imageList,
  };
  const normalizedVideoPayload = isSora ? normalizeSingleImageVideoPayload(videoPayload) : videoPayload;
  const chatPayload = {
    model: model.id,
    messages: [
      {
        role: "user",
        content: chatMessageContent,
      },
    ],
    ...(!isGeekAIGrokVideo
      ? {
          prompt: chatPrompt,
          size: videoSize,
          aspect_ratio: ratio,
          resolution: isVeo ? normalizeVeoResolution(resolution) : undefined,
          duration: normalizedDuration,
          seconds: isSora ? String(normalizedDuration) : undefined,
        }
      : {}),
  };
  const videoRouteEndpoints = getModelApiEndpoints(provider, model, "video");
  const isYunwuGrokVideo = isYunwuProvider(provider) && isGrokVideo;
  const yunwuGrokVideoPayload = {
    ...normalizedVideoPayload,
    image: undefined,
    images: inputReferenceImages.length ? inputReferenceImages : undefined,
  };
  const videoBackendAttempts = videoRouteEndpoints.flatMap((endpoint) => {
    if (endpoint === "/chat/completions") {
      return [{
        label: isGeekAIProvider(provider) ? "geekai chat completions video" : "chat completions video",
        endpoint: "/chat/completions",
        payload: chatPayload,
        mediaType: "video" as const,
      }];
    }
    if (endpoint === "/v1/video/create") {
      return [{
        label: "yunwu grok video create",
        endpoint: "/v1/video/create",
        payload: isYunwuGrokVideo ? yunwuGrokVideoPayload : normalizedVideoPayload,
        mediaType: "video" as const,
      }];
    }
    if (endpoint === "/video/generations") {
      return [{
        label: isGrokVideo ? "grok video generations" : "video generations",
        endpoint: "/video/generations",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      }];
    }
    if (endpoint === "/videos") {
      return [{
        label: isSora ? "sora videos" : isVeo ? "veo videos" : "videos",
        endpoint: "/videos",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      }];
    }
    if (endpoint === "/async/generations") {
      return [{
        label: "video async generations",
        endpoint: "/async/generations",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      }];
    }
    if (endpoint === "/video/create") {
      return [{
        label: "lnapi video create",
        endpoint: "/video/create",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      }];
    }
    return [];
  });

  if (videoBackendAttempts.length) {
    const firstAttempt = videoBackendAttempts[0];

    onProgress?.(5);
    const job = await createBackendImageJob({
      provider,
      endpoint: firstAttempt.endpoint,
      payload: firstAttempt.payload,
      clientTaskId,
      mediaType: "video",
      attempts: videoBackendAttempts,
    });
    return job.status === "completed" && job.resultUrl
      ? absolutizeBackendUrl(job.resultUrl)
      : await waitForBackendMediaJob(job.id, "video", onProgress);
  }

  if (isGrokVideo) {
    const grokVideoEndpoint = isYunwuGrokVideo ? "/v1/video/create" : "/video/generations";
    const grokVideoPayload = isYunwuGrokVideo
      ? {
          ...normalizedVideoPayload,
          image: undefined,
          images: inputReferenceImages.length ? inputReferenceImages : undefined,
        }
      : normalizedVideoPayload;
    const backendAttempts = [
      {
        label: isYunwuGrokVideo ? "yunwu grok video create" : "grok video generations",
        endpoint: grokVideoEndpoint,
        payload: grokVideoPayload,
        mediaType: "video" as const,
      },
    ];

    onProgress?.(5);
    const job = await createBackendImageJob({
      provider,
      endpoint: grokVideoEndpoint,
      payload: grokVideoPayload,
      clientTaskId,
      mediaType: "video",
      attempts: backendAttempts,
    });
    return job.status === "completed" && job.resultUrl
      ? absolutizeBackendUrl(job.resultUrl)
      : await waitForBackendMediaJob(job.id, "video", onProgress);
  }

  if (isSora || isVeo) {
    const backendAttempts = [
      {
        label: isSora ? "sora videos" : "veo videos",
        endpoint: "/videos",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      },
      {
        label: "video async generations",
        endpoint: "/async/generations",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      },
      {
        label: "lnapi video create",
        endpoint: "/video/create",
        payload: normalizedVideoPayload,
        mediaType: "video" as const,
      },
    ];

    onProgress?.(5);
    const job = await createBackendImageJob({
      provider,
      endpoint: "/videos",
      payload: normalizedVideoPayload,
      clientTaskId,
      mediaType: "video",
      attempts: backendAttempts,
    });
    return job.status === "completed" && job.resultUrl
      ? absolutizeBackendUrl(job.resultUrl)
      : await waitForBackendMediaJob(job.id, "video", onProgress);
  }

  const attempts: JsonAttempt[] = [
    { label: "video generations", endpoints: buildVideoEndpointCandidates(provider.baseUrl), payload: normalizedVideoPayload },
  ];

  onProgress?.(5);
  const response = await postJsonWithFallbacks<any>(provider, attempts);

  try {
    const url = parseVideoResponse(response);
    onProgress?.(100);
    return url;
  } catch (error) {
    const taskId = extractVideoTaskId(response);
    if (!taskId) throw error;
    onProgress?.(10);
    return pollVideoTask(provider, provider.baseUrl, taskId, onProgress, isSora);
  }
}
