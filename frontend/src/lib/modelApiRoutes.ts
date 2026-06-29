import type { ModelType } from "../store/settingsStore";

export type ModelApiEndpoint =
  | "/chat/completions"
  | "/images/generations"
  | "/images/edits"
  | "/responses"
  | "/video/generations"
  | "/videos"
  | "/v1/videos"
  | "/v1/async/generations"
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
    { endpoint: "/v1/async/generations", label: "Unified Async Generations" },
    { endpoint: "/v1/videos", label: "Newtoken Async (v1/videos)" },
  ],
  video: [
    { endpoint: "/chat/completions", label: "Chat Completions" },
    { endpoint: "/video/generations", label: "Video Generations" },
    { endpoint: "/v1/video/create", label: "Yunwu Video Create" },
    { endpoint: "/videos", label: "Videos" },
    { endpoint: "/v1/async/generations", label: "Unified Async Generations" },
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

function isZexiProviderText(text: string) {
  return text.includes("zexitongxue.com") || text.includes("zexi") || text.includes("泽西");
}

function isMaomiNewApiProviderText(text: string) {
  return text.includes("seedance.dadaowushilibai.cn") || text.includes("猫咪");
}

function isQiyuanProviderText(text: string) {
  return text.includes("mingyu.it.com") || text.includes("启元") || text.includes("qiyuan");
}

function isNewtokenProviderText(text: string) {
  return text.includes("newtoken") || text.includes("newtoken.club");
}

// newtoken 的 GPT Image 2：模型名含 gpt-image2（其专有命名，比域名可靠）。
// 带 _sync 后缀走同步 /images/generations，否则走异步 /v1/videos。
function isNewtokenGptImage2ModelText(text: string) {
  return /gpt-?image-?2/i.test(text);
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
    if (isNewtokenProviderText(providerText) && isNewtokenGptImage2ModelText(modelText)) {
      // _sync 后缀走同步图片接口，否则走异步 /v1/videos（图片任务也走这个）。
      return modelText.includes("_sync")
        ? uniqEndpoints(["/images/generations"], input.type)
        : uniqEndpoints(["/v1/videos"], input.type);
    }
    if (isMaomiNewApiProviderText(providerText) || modelText.includes("nano-banana-2")) {
      return uniqEndpoints(["/chat/completions"], input.type);
    }
    if (isQiyuanProviderText(providerText) || modelText.includes("nano-banana")) {
      return uniqEndpoints(["/v1/async/generations", "/chat/completions", "/images/edits"], input.type);
    }
    if (modelText.includes("gpt-image") || (isGeekAIProviderText(providerText) && modelText.includes("grok") && modelText.includes("image"))) {
      return uniqEndpoints(["/images/generations", "/images/edits", "/responses", "/chat/completions"], input.type);
    }
    return uniqEndpoints(["/images/generations", "/responses", "/chat/completions"], input.type);
  }

  if (input.type === "video") {
    const isGrokVideo = modelText.includes("grok-imagine-video") || modelText.includes("grok-video");
    const isMaomiNewApiVideo = isMaomiNewApiProviderText(providerText) || modelText.includes("seedance-2.0") || modelText.includes("kling-video-o-3");
    if (isMaomiNewApiVideo) return uniqEndpoints(["/chat/completions"], input.type);
    const isZexiSeedance = isZexiProviderText(providerText) && (modelText.includes("sora-v3") || modelText.includes("sora-vip3") || modelText.includes("seedance"));
    if (isZexiSeedance) return uniqEndpoints(["/videos"], input.type);
    if (isYunwuProviderText(providerText) && isGrokVideo) return uniqEndpoints(["/v1/video/create"], input.type);
    if (isGrokVideo) return uniqEndpoints(["/chat/completions"], input.type);
    if (modelText.includes("sora") || modelText.includes("veo")) {
      if (isQiyuanProviderText(providerText)) {
        return uniqEndpoints(["/v1/async/generations", "/async/generations", "/videos", "/video/create"], input.type);
      }
      return uniqEndpoints(["/videos", "/v1/async/generations", "/async/generations", "/video/create"], input.type);
    }
    return uniqEndpoints(["/video/generations"], input.type);
  }

  return [];
}

export function shouldForceDefaultModelApiRoutes(input: {
  providerId?: string;
  providerName?: string;
  providerBaseUrl?: string;
  modelId: string;
  modelName?: string;
  type: ModelType;
}) {
  const providerText = `${input.providerId ?? ""} ${input.providerName ?? ""} ${input.providerBaseUrl ?? ""}`.toLowerCase();
  const modelText = `${input.modelId} ${input.modelName ?? ""}`.toLowerCase();
  if (input.type === "image") return isMaomiNewApiProviderText(providerText) || modelText.includes("nano-banana-2") || (isNewtokenProviderText(providerText) && isNewtokenGptImage2ModelText(modelText));
  if (input.type === "video") {
    return isMaomiNewApiProviderText(providerText)
      || modelText.includes("seedance-2.0")
      || modelText.includes("kling-video-o-3")
      || (isZexiProviderText(providerText) && (modelText.includes("sora-v3") || modelText.includes("sora-vip3") || modelText.includes("seedance")));
  }
  return false;
}

export function normalizeModelApiRoutes(
  routes: unknown,
  fallback: ModelApiRouteConfig[],
  type: ModelType
): ModelApiRouteConfig[] {
  const allowed = new Set(MODEL_API_ROUTE_OPTIONS[type].map((option) => option.endpoint));
  const rawRoutes = Array.isArray(routes) ? routes : [];
  const normalized = rawRoutes
    .map((route): ModelApiRouteConfig | null => {
      if (typeof route === "string") {
        return allowed.has(route as ModelApiEndpoint) ? { endpoint: route as ModelApiEndpoint, enabled: true } : null;
      }
      if (route && typeof route === "object" && typeof (route as { endpoint?: unknown }).endpoint === "string") {
        const endpoint = (route as { endpoint: string }).endpoint;
        if (!allowed.has(endpoint as ModelApiEndpoint)) return null;
        if ((route as { enabled?: unknown }).enabled === false) return null;
        return {
          endpoint: endpoint as ModelApiEndpoint,
          enabled: true,
        };
      }
      return null;
    })
    .filter((route): route is ModelApiRouteConfig => Boolean(route));

  const seen = new Set<ModelApiEndpoint>();
  const unique = normalized.filter((route) => {
    if (seen.has(route.endpoint)) return false;
    seen.add(route.endpoint);
    return true;
  });
  return unique.length || rawRoutes.length ? unique : fallback;
}

export function getEnabledModelApiEndpoints(model: { apiRoutes?: ModelApiRouteConfig[] }, type: ModelType) {
  const allowed = new Set(MODEL_API_ROUTE_OPTIONS[type].map((option) => option.endpoint));
  return (model.apiRoutes ?? [])
    .filter((route) => route.enabled !== false && allowed.has(route.endpoint))
    .map((route) => route.endpoint);
}
