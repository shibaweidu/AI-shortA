import type { ModelType } from "../store/settingsStore";

export type ModelApiEndpoint =
  | "/chat/completions"
  | "/images/generations"
  | "/images/edits"
  | "/responses"
  | "/video/generations"
  | "/videos"
  | "/async/generations"
  | "/video/create"
  | "/v1/video/create";

export interface ModelApiRouteConfig {
  endpoint: ModelApiEndpoint;
  enabled?: boolean;
}

export const MODEL_API_ROUTE_OPTIONS: Record<ModelType, Array<{ endpoint: ModelApiEndpoint; label: string }>> = {
  language: [{ endpoint: "/chat/completions", label: "Chat Completions" }],
  image: [
    { endpoint: "/images/generations", label: "Images Generations" },
    { endpoint: "/images/edits", label: "Images Edits" },
    { endpoint: "/chat/completions", label: "Chat Completions" },
    { endpoint: "/responses", label: "Responses" },
  ],
  video: [
    { endpoint: "/chat/completions", label: "Chat Completions" },
    { endpoint: "/video/generations", label: "Video Generations" },
    { endpoint: "/v1/video/create", label: "Yunwu Video Create" },
    { endpoint: "/videos", label: "Videos" },
    { endpoint: "/async/generations", label: "Async Generations" },
    { endpoint: "/video/create", label: "LNAPI Video Create" },
  ],
  audio: [],
};

function uniqEndpoints(endpoints: string[], type: ModelType): ModelApiRouteConfig[] {
  const allowed = new Set(MODEL_API_ROUTE_OPTIONS[type].map((option) => option.endpoint));
  return Array.from(new Set(endpoints))
    .filter((endpoint): endpoint is ModelApiEndpoint => allowed.has(endpoint as ModelApiEndpoint))
    .map((endpoint) => ({ endpoint, enabled: true }));
}

function isGeekAIProviderText(text: string) {
  return text.includes("geekai") || text.includes("geeknow.top") || text.includes("geeknow.ai");
}

function isYunwuProviderText(text: string) {
  return text.includes("yunw") || text.includes("云雾");
}

function isQiyuanProviderText(text: string) {
  return text.includes("mingyu.it.com") || text.includes("启元") || text.includes("qiyuan");
}

export function getDefaultModelApiRoutes(input: {
  providerId?: string;
  providerName?: string;
  providerBaseUrl?: string;
  modelId: string;
  modelName?: string;
  type: ModelType;
}): ModelApiRouteConfig[] {
  const providerText = `${input.providerId ?? ""} ${input.providerName ?? ""} ${input.providerBaseUrl ?? ""}`.toLowerCase();
  const modelText = `${input.modelId} ${input.modelName ?? ""}`.toLowerCase();

  if (input.type === "language") return uniqEndpoints(["/chat/completions"], input.type);

  if (input.type === "image") {
    if (isQiyuanProviderText(providerText) || modelText.includes("nano-banana")) {
      return uniqEndpoints(["/chat/completions", "/images/edits"], input.type);
    }
    if (modelText.includes("gpt-image") || (isGeekAIProviderText(providerText) && modelText.includes("grok") && modelText.includes("image"))) {
      return uniqEndpoints(["/images/generations", "/images/edits", "/responses", "/chat/completions"], input.type);
    }
    return uniqEndpoints(["/images/generations", "/responses", "/chat/completions"], input.type);
  }

  if (input.type === "video") {
    const isGrokVideo = modelText.includes("grok-imagine-video") || modelText.includes("grok-video");
    if (isYunwuProviderText(providerText) && isGrokVideo) return uniqEndpoints(["/v1/video/create"], input.type);
    if (isGrokVideo) return uniqEndpoints(["/chat/completions"], input.type);
    if (modelText.includes("sora") || modelText.includes("veo")) {
      return uniqEndpoints(["/videos", "/async/generations", "/video/create"], input.type);
    }
    return uniqEndpoints(["/video/generations"], input.type);
  }

  return [];
}

export function normalizeModelApiRoutes(
  routes: unknown,
  fallback: ModelApiRouteConfig[],
  type: ModelType
): ModelApiRouteConfig[] {
  const allowed = new Set(MODEL_API_ROUTE_OPTIONS[type].map((option) => option.endpoint));
  const rawRoutes = Array.isArray(routes) ? routes : [];
  const endpoints = rawRoutes
    .map((route) => {
      if (typeof route === "string") return route;
      if (route && typeof route === "object" && typeof (route as { endpoint?: unknown }).endpoint === "string") {
        return (route as { endpoint: string }).endpoint;
      }
      return "";
    })
    .filter((endpoint): endpoint is ModelApiEndpoint => allowed.has(endpoint as ModelApiEndpoint));

  const normalized = uniqEndpoints(endpoints, type);
  return normalized.length ? normalized : fallback;
}

export function getEnabledModelApiEndpoints(model: { apiRoutes?: ModelApiRouteConfig[] }, type: ModelType) {
  const allowed = new Set(MODEL_API_ROUTE_OPTIONS[type].map((option) => option.endpoint));
  return (model.apiRoutes ?? [])
    .filter((route) => route.enabled !== false && allowed.has(route.endpoint))
    .map((route) => route.endpoint);
}
