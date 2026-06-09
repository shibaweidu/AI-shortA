import { useState, type ReactNode } from "react";
import { ArrowLeft, Edit2, Plus, RefreshCw, Search, Server, Trash2, Upload } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { Button } from "../../components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "../../components/ui/card";
import { Input } from "../../components/ui/input";
import { getDefaultModelApiRoutes, MODEL_API_ROUTE_OPTIONS, normalizeModelApiRoutes, type ModelApiRouteConfig, type ModelApiEndpoint } from "../../lib/modelApiRoutes";
import { buildProviderModelValue } from "../../lib/providerModels";
import { getProviderKeyCount, withSelectedProviderKey } from "../../lib/providerKeys";
import { cn } from "../../lib/utils";
import { useSettingsStore, type ModelType, type ProviderConfig } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";

const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "";

function makeBackendUrl(path: string) {
 return `${BACKEND_API}${path.startsWith("/") ? path : `/${path}`}`;
}

type FlowModelType = "language" | "image" | "video";
type PageView = "providers" | "routing";
type RemoteModel = { id: string; name: string; type: ModelType };
type ParsedRemoteModel = { id: string; name: string };
type ModelEditorDraft = {
  id: string;
  name: string;
  thumbnailUrl: string;
  providerDisplayName: string;
  description: string;
  tags: string;
  credits: string;
  apiRoutes: ModelApiRouteConfig[];
};

type ModelSelectionDraft = ModelEditorDraft & {
  providerId: string;
  type: FlowModelType;
};

function readImageFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") {
        resolve(reader.result);
        return;
      }
      reject(new Error("读取图片失败"));
    };
    reader.onerror = () => reject(reader.error ?? new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}

function parseModelTags(value: string) {
  return value.split(/\s+/).map((tag) => tag.trim()).filter(Boolean);
}

function buildDraftApiRoutes(provider: ProviderConfig | undefined, type: ModelType, modelId: string, modelName: string, routes?: ModelApiRouteConfig[]) {
  const fallback = getDefaultModelApiRoutes({
    providerId: provider?.id,
    providerName: provider?.name,
    providerBaseUrl: provider?.baseUrl,
    modelId,
    modelName,
    type,
  });
  return normalizeModelApiRoutes(routes, fallback, type);
}

function toggleDraftApiRoute(routes: ModelApiRouteConfig[], endpoint: ModelApiEndpoint, type: ModelType) {
  const current = new Set(normalizeModelApiRoutes(routes, [], type).map((route) => route.endpoint));
  if (current.has(endpoint)) {
    if (current.size <= 1) return normalizeModelApiRoutes(Array.from(current).map((item) => ({ endpoint: item })), [], type);
    current.delete(endpoint);
  }
  else current.add(endpoint);
  return normalizeModelApiRoutes(Array.from(current).map((item) => ({ endpoint: item })), [], type);
}

function ApiRouteSelector({
  type,
  routes,
  onChange,
}: {
  type: ModelType;
  routes: ModelApiRouteConfig[];
  onChange: (routes: ModelApiRouteConfig[]) => void;
}) {
  const selected = new Set(normalizeModelApiRoutes(routes, [], type).map((route) => route.endpoint));
  const options = MODEL_API_ROUTE_OPTIONS[type];
  if (!options.length) return null;

  return (
    <div className="space-y-2 md:col-span-2">
      <label className="text-sm font-medium text-white">接口选项</label>
      <div className="grid gap-2 sm:grid-cols-2">
        {options.map((option) => {
          const checked = selected.has(option.endpoint);
          return (
            <button
              key={option.endpoint}
              type="button"
              onClick={() => onChange(toggleDraftApiRoute(routes, option.endpoint, type))}
              className={cn(
                "flex items-center justify-between gap-3 rounded-xl border px-3 py-2 text-left text-sm transition",
                checked
                  ? "border-cyan-300/40 bg-cyan-300/10 text-cyan-100"
                  : "border-white/[0.08] bg-white/[0.03] text-[#cfd7e6] hover:bg-white/[0.06]"
              )}
            >
              <span className="min-w-0">
                <span className="block truncate">{option.label}</span>
                <span className="block truncate font-mono text-[11px] text-[#8f97aa]">{option.endpoint}</span>
              </span>
              <span className={cn("h-4 w-4 rounded border", checked ? "border-cyan-300 bg-cyan-300" : "border-white/20")} />
            </button>
          );
        })}
      </div>
      <p className="text-xs text-[#8f97aa]">可选择多个接口，生成时会按这里的顺序依次尝试，成功后停止。</p>
    </div>
  );
}

function ModelEditorModal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 px-4 backdrop-blur-sm">
      <div className="w-full max-w-[760px] rounded-[28px] border border-white/[0.08] bg-[#11141b] shadow-[0_24px_80px_rgba(0,0,0,0.45)]">
        <div className="flex items-center justify-between border-b border-white/[0.06] px-6 py-5">
          <div>
            <div className="text-lg font-semibold text-white">{title}</div>
            <div className="mt-1 text-xs text-[#8f97aa]">模型类型和模型 ID 必填，保存后会直接展示在前台模型选择里。</div>
          </div>
          <Button variant="outline" className={OUTLINE_BUTTON_CLASS_NAME} onClick={onClose}>
            关闭
          </Button>
        </div>
        <div className="max-h-[80vh] overflow-y-auto p-6">{children}</div>
      </div>
    </div>
  );
}

interface SettingsProps {
  embedded?: boolean;
  scope?: "admin" | "user";
  initialView?: PageView;
  hideBackButton?: boolean;
  title?: string;
  subtitle?: string;
}

const FLOW_MODEL_TYPES: FlowModelType[] = ["language", "image", "video"];
const PANEL_CLASS_NAME = "rounded-[24px] border border-white/[0.08] bg-[#11141b] text-white shadow-[0_18px_48px_rgba(0,0,0,0.28)]";
const INPUT_CLASS_NAME =
  "h-9 rounded-xl border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085] focus-visible:ring-cyan-400/50 focus-visible:ring-offset-0";
const TEXTAREA_CLASS_NAME =
  "rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white placeholder:text-[#667085] outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/50";
const OUTLINE_BUTTON_CLASS_NAME =
  "h-9 rounded-xl border-white/[0.08] bg-white/[0.03] px-4 text-[#cfd7e6] hover:bg-white/[0.06] hover:text-white";
const PRIMARY_BUTTON_CLASS_NAME = "h-9 rounded-xl bg-cyan-400 px-4 text-black hover:bg-cyan-300";

const META: Record<FlowModelType, { label: string; short: string; box: string; chip: string }> = {
  language: {
    label: "文本模型",
    short: "TXT",
    box: "border-violet-500/20 bg-violet-500/5",
    chip: "border-violet-500/20 bg-violet-500/10 text-violet-200",
  },
  image: {
    label: "图片模型",
    short: "IMG",
    box: "border-emerald-500/20 bg-emerald-500/5",
    chip: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
  },
  video: {
    label: "视频模型",
    short: "VID",
    box: "border-sky-500/20 bg-sky-500/5",
    chip: "border-sky-500/20 bg-sky-500/10 text-sky-200",
  },
};

const REMOTE_MODEL_TYPE_LABELS: Record<ModelType, string> = {
  language: "文本",
  image: "图片",
  video: "视频",
  audio: "音频",
};

function isGeminiProvider(provider: ProviderConfig) {
  const text = `${provider.id} ${provider.name} ${provider.baseUrl}`.toLowerCase();
  return text.includes("gemini") || text.includes("google") || text.includes("generativelanguage");
}

function buildModelEndpointCandidates(provider: ProviderConfig) {
const candidates = new Set<string>();
 candidates.add("/models");
 candidates.add("/pricing");
 if (isGeminiProvider(provider)) candidates.add("/v1beta/models");

return Array.from(candidates);
}

function inferModelType(id: string, name: string): ModelType {
  const text = `${id} ${name}`.toLowerCase();
  const hasKeyword = (keywords: string[]) => keywords.some((keyword) => text.includes(keyword));
  if (hasKeyword(["video", "runway", "kling", "pika", "hailuo", "veo", "sora", "vidu"])) return "video";
  if (hasKeyword(["image", "flux", "sdxl", "midjourney", "dall", "imagen", "recraft", "diffusion"])) return "image";
  if (hasKeyword(["audio", "tts", "speech", "voice", "whisper", "eleven", "bark"])) return "audio";
  return "language";
}

function normalizeRemoteModelItem(item: unknown): ParsedRemoteModel | null {
  if (typeof item === "string") {
    const id = item.trim();
    return id ? { id, name: id } : null;
  }

  if (!item || typeof item !== "object") return null;

  const current = item as Record<string, unknown>;
  const rawId =
    typeof current.id === "string"
      ? current.id
      : typeof current.model === "string"
        ? current.model
        : typeof current.model_name === "string"
          ? current.model_name
          : typeof current.modelName === "string"
            ? current.modelName
            : typeof current.name === "string" && current.name.startsWith("models/")
              ? current.name.replace(/^models\//, "")
              : typeof current.name === "string"
                ? current.name
                : "";
  const id = rawId.trim().replace(/^models\//, "");
  if (!id) return null;

  const rawName =
    typeof current.display_name === "string"
      ? current.display_name
      : typeof current.displayName === "string"
        ? current.displayName
        : typeof current.label === "string"
          ? current.label
          : typeof current.title === "string"
            ? current.title
            : typeof current.name === "string"
              ? current.name.replace(/^models\//, "")
              : id;

  return { id, name: rawName.trim() || id };
}

function collectRemoteModelItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];

  const json = payload as Record<string, unknown>;
  const directKeys = ["data", "models", "items", "result", "list", "model_prices", "modelPrices"];
  for (const key of directKeys) {
    if (Array.isArray(json[key])) return json[key];
  }

  if (json.data && typeof json.data === "object") {
    const nested = collectRemoteModelItems(json.data);
    if (nested.length) return nested;
  }

  return Object.entries(json)
    .filter(([, value]) => value && typeof value === "object")
    .map(([key, value]) => ({ id: key, ...(value as Record<string, unknown>) }));
}

function parseRemoteModels(payload: unknown): ParsedRemoteModel[] {
  const raw = collectRemoteModelItems(payload);

  const unique = new Map<string, ParsedRemoteModel>();
  raw.forEach((item) => {
    const model = normalizeRemoteModelItem(item);
    if (model && !unique.has(model.id)) unique.set(model.id, model);
  });

  return Array.from(unique.values());
}

function parsePayloadAsJsonOrText(text: string) {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function mergeRemoteModels(current: RemoteModel[], incoming: RemoteModel[]) {
  const merged = new Map(current.map((model) => [model.id, model]));
  incoming.forEach((model) => merged.set(model.id, model));
  return Array.from(merged.values()).sort((a, b) => a.name.localeCompare(b.name));
}

export default function Settings({
  embedded = false,
  scope = "user",
  initialView = "providers",
  hideBackButton = false,
  title = "设置",
  subtitle,
}: SettingsProps) {
  const navigate = useNavigate();
  const adminSettings = useSettingsStore();
  const userSettings = useUserModelStore();
  const activeStore = scope === "admin" ? adminSettings : userSettings;
  const {
    providers,
    routing,
    getCustomProviders,
    addCustomProvider,
    updateProvider,
    removeProvider,
    addProviderModel,
    updateProviderModel,
    removeProviderModel,
    toggleRoutingModel,
  } = activeStore;

  const customProviders = getCustomProviders();

  const [view, setView] = useState<PageView>(initialView);
  const [newProvider, setNewProvider] = useState({ name: "", baseUrl: "", key: "", logAccessToken: "", useReferenceImagesParam: false });
  const [addProviderOpen, setAddProviderOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState("");
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});
  const [drafts, setDrafts] = useState<Record<string, ModelEditorDraft>>({});
  const [editingModelKey, setEditingModelKey] = useState<string | null>(null);
  const [selectionDraft, setSelectionDraft] = useState<ModelSelectionDraft | null>(null);
  const [selectionEditingKey, setSelectionEditingKey] = useState<string | null>(null);
  const [search, setSearch] = useState<Record<string, string>>({});
  const [remoteLibraries, setRemoteLibraries] = useState<Record<string, RemoteModel[]>>({});
  const [libraryLoading, setLibraryLoading] = useState<Record<string, boolean>>({});
  const [libraryStatus, setLibraryStatus] = useState<Record<string, string>>({});
  const selectedProvider = customProviders.find((provider) => provider.id === selectedProviderId) ?? customProviders[0] ?? null;

  // Auto-detect if provider likely uses New API and should enable reference_images parameter
  const shouldUseReferenceImagesParam = (baseUrl: string) => {
    const url = baseUrl.toLowerCase();
    // Common New API indicators
    return url.includes('newapi') || url.includes('new-api') || url.includes('oneapi') || url.includes('one-api');
  };

  const createProvider = () => {
    const providerId = addCustomProvider({
      name: newProvider.name.trim() || `供应商 ${providers.length + 1}`,
      baseUrl: newProvider.baseUrl.trim(),
      key: newProvider.key.trim(),
      logAccessToken: newProvider.logAccessToken.trim() || undefined,
      useReferenceImagesParam: newProvider.useReferenceImagesParam,
    });
    setExpanded((prev) => ({ ...prev, [providerId]: true }));
    setSelectedProviderId(providerId);
    setNewProvider({ name: "", baseUrl: "", key: "", logAccessToken: "", useReferenceImagesParam: false });
    setAddProviderOpen(false);
  };

  const getDraft = (providerId: string, type: FlowModelType) =>
    drafts[`${providerId}:${type}`] ?? {
      id: "",
      name: "",
      thumbnailUrl: "",
      providerDisplayName: "",
      description: "",
      tags: "",
      credits: "",
      apiRoutes: buildDraftApiRoutes(customProviders.find((provider) => provider.id === providerId), type, "", ""),
    };

  const setDraft = (providerId: string, type: FlowModelType, data: Partial<ModelEditorDraft>) => {
    const key = `${providerId}:${type}`;
    setDrafts((prev) => ({ ...prev, [key]: { ...getDraft(providerId, type), ...data } }));
  };

  const fillDraftFromModel = (providerId: string, type: FlowModelType, model: { id: string; name: string; thumbnailUrl?: string; providerDisplayName?: string; description?: string; tags?: string[]; credits?: number; apiRoutes?: ModelApiRouteConfig[] }) => {
    const provider = customProviders.find((item) => item.id === providerId);
    setDraft(providerId, type, {
      id: model.id,
      name: model.name,
      thumbnailUrl: model.thumbnailUrl ?? "",
      providerDisplayName: model.providerDisplayName ?? "",
      description: model.description ?? "",
      tags: model.tags?.join(", ") ?? "",
      credits: model.credits === undefined ? "" : String(model.credits),
      apiRoutes: buildDraftApiRoutes(provider, type, model.id, model.name, model.apiRoutes),
    });
    setEditingModelKey(`${providerId}:${type}:${model.id}`);
  };

  const resetDraft = (providerId: string, type: FlowModelType) => {
    const provider = customProviders.find((item) => item.id === providerId);
    setDraft(providerId, type, {
      id: "",
      name: "",
      thumbnailUrl: "",
      providerDisplayName: "",
      description: "",
      tags: "",
      credits: "",
      apiRoutes: buildDraftApiRoutes(provider, type, "", ""),
    });
    setEditingModelKey(null);
  };

  const startEditSelectionModel = (
    providerId: string,
    type: FlowModelType,
    model: { id: string; name: string; thumbnailUrl?: string; providerDisplayName?: string; description?: string; tags?: string[]; credits?: number; apiRoutes?: ModelApiRouteConfig[] }
  ) => {
    const provider = customProviders.find((item) => item.id === providerId);
    setSelectionDraft({
      providerId,
      type,
      id: model.id,
      name: model.name,
      thumbnailUrl: model.thumbnailUrl ?? "",
      providerDisplayName: model.providerDisplayName ?? "",
      description: model.description ?? "",
      tags: model.tags?.join(", ") ?? "",
      credits: model.credits === undefined ? "" : String(model.credits),
      apiRoutes: buildDraftApiRoutes(provider, type, model.id, model.name, model.apiRoutes),
    });
    setSelectionEditingKey(`${providerId}:${type}:${model.id}`);
  };

  const resetSelectionDraft = () => {
    setSelectionDraft(null);
    setSelectionEditingKey(null);
  };

  const fetchModelLibrary = async (provider: ProviderConfig) => {
    if (!provider.baseUrl.trim()) {
      setLibraryStatus((prev) => ({ ...prev, [provider.id]: "请先填写 Base URL。" }));
      return;
    }
    if (getProviderKeyCount(provider.key) === 0) {
      setLibraryStatus((prev) => ({ ...prev, [provider.id]: "请先填写 API Key。" }));
      return;
    }
    const requestProvider = withSelectedProviderKey(provider);

    setLibraryLoading((prev) => ({ ...prev, [provider.id]: true }));
    setLibraryStatus((prev) => ({ ...prev, [provider.id]: "正在获取模型列表..." }));

    let lastError = "未知错误";
    let loadedModels: RemoteModel[] = [];
    const loadedUrls: string[] = [];

    try {
      for (const targetUrl of buildModelEndpointCandidates(provider)) {
        try {
 const proxyPath = targetUrl.startsWith("http") ? `?target=${encodeURIComponent(targetUrl)}` : targetUrl;
 const response = await fetch(makeBackendUrl(`/api/openai-compatible${proxyPath}`), {
 method: "GET",
 headers: {
 "Content-Type": "application/json",
 "X-Provider-Id": requestProvider.id,
 "X-Provider-Name": encodeURIComponent(requestProvider.name),
 "X-Provider-BaseUrl": requestProvider.baseUrl,
 "X-Provider-Key": requestProvider.key,
 },
});

          if (!response.ok) {
            lastError = `HTTP ${response.status}`;
            continue;
          }

          const payloadText = await response.text();
          const payload = parsePayloadAsJsonOrText(payloadText);
          const models = parseRemoteModels(payload)
            .map((model) => ({ ...model, type: inferModelType(model.id, model.name) }))
            .sort((a, b) => a.name.localeCompare(b.name));

          if (!models.length) {
            lastError = "接口返回了空模型列表。";
            continue;
          }

          loadedModels = mergeRemoteModels(loadedModels, models);
          loadedUrls.push(targetUrl);
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
        }
      }

      if (loadedModels.length) {
        setRemoteLibraries((prev) => ({ ...prev, [provider.id]: loadedModels }));
        setLibraryStatus((prev) => ({ ...prev, [provider.id]: `已加载 ${loadedModels.length} 个远程模型，来自 ${loadedUrls.length} 个接口。` }));
        return;
      }

      setRemoteLibraries((prev) => ({ ...prev, [provider.id]: [] }));
      setLibraryStatus((prev) => ({ ...prev, [provider.id]: `获取模型失败：${lastError}` }));
    } finally {
      setLibraryLoading((prev) => ({ ...prev, [provider.id]: false }));
    }
  };

  return (
    <div className={cn("mx-auto h-full max-w-[1120px] overflow-y-auto px-4 py-4 sm:px-5", embedded && "max-w-[1280px] p-6")}>
      <div className={cn("sticky top-0 z-20 -mx-4 mb-4 border-b border-white/[0.06] bg-[#08090d]/95 px-4 py-4 backdrop-blur sm:-mx-5 sm:px-5", embedded && "-mx-6 px-6")}>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-[26px] font-semibold tracking-tight text-white">{title}</h1>
            {subtitle ? <p className="mt-2 text-sm text-[#8f97aa]">{subtitle}</p> : null}
          </div>

          {!hideBackButton ? (
            <Button variant="outline" onClick={() => navigate("/")} className={OUTLINE_BUTTON_CLASS_NAME}>
              <ArrowLeft className="mr-2 h-4 w-4" />
              返回
            </Button>
          ) : null}
        </div>

        <div className="mt-4 flex gap-2">
          <Button
            variant="secondary"
            onClick={() => setView("providers")}
            className={cn(
              "h-9 rounded-xl px-4 text-sm",
              view === "providers"
                ? "bg-cyan-400 text-black hover:bg-cyan-300"
                : "bg-white/[0.03] text-[#cfd7e6] hover:bg-white/[0.06] hover:text-white"
            )}
          >
            模型供应商
          </Button>
          <Button
            variant="secondary"
            onClick={() => setView("routing")}
            className={cn(
              "h-9 rounded-xl px-4 text-sm",
              view === "routing"
                ? "bg-cyan-400 text-black hover:bg-cyan-300"
                : "bg-white/[0.03] text-[#cfd7e6] hover:bg-white/[0.06] hover:text-white"
            )}
          >
            模型选择
          </Button>
        </div>
      </div>

      {view === "providers" ? (
        <div className="space-y-4">
          {addProviderOpen ? (
            <ModelEditorModal title="添加供应商" onClose={() => setAddProviderOpen(false)}>
              <div className="grid gap-4 md:grid-cols-1">
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">供应商名称</label>
                  <Input
                    value={newProvider.name}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, name: event.target.value }))}
                    placeholder="例如 OpenRouter"
                    className={INPUT_CLASS_NAME}
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">Base URL</label>
                  <Input
                    value={newProvider.baseUrl}
                    onChange={(event) => {
                      const baseUrl = event.target.value;
                      setNewProvider((prev) => ({ 
                        ...prev, 
                        baseUrl,
                        // Auto-enable reference_images for New API providers
                        useReferenceImagesParam: prev.useReferenceImagesParam || shouldUseReferenceImagesParam(baseUrl)
                      }));
                    }}
                    placeholder="https://api.example.com/v1"
                    className={INPUT_CLASS_NAME}
                  />
                </div>
                <div className="space-y-2">
                  <label className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                    <span>API Key</span>
                    <span className="text-xs font-normal text-[#8f97aa]">{getProviderKeyCount(newProvider.key)} 个 Key</span>
                  </label>
                  <textarea
                    value={newProvider.key}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, key: event.target.value }))}
                    placeholder="一行一个 API Key"
                    className={`${TEXTAREA_CLASS_NAME} min-h-[92px] w-full resize-y font-mono leading-5`}
                  />
                  <p className="text-xs text-[#8f97aa]">多行时会按请求轮询使用；单行保持原逻辑。</p>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium text-white">日志访问令牌</label>
                  <Input
                    type="password"
                    value={newProvider.logAccessToken}
                    onChange={(event) => setNewProvider((prev) => ({ ...prev, logAccessToken: event.target.value }))}
                    placeholder="可选，用于 524 后查询日志"
                    className={INPUT_CLASS_NAME}
                  />
                </div>
<div className="space-y-2">
<label className="text-sm font-medium text-white">参考图传递方式</label>
<Button
                    type="button"
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left",
                      newProvider.useReferenceImagesParam 
                        ? "border-blue-500 bg-blue-500/10 text-blue-400" 
                        : "border-white/10 bg-white/5 text-white"
                    )}
                    onClick={() => setNewProvider((prev) => ({ ...prev, useReferenceImagesParam: !prev.useReferenceImagesParam }))}
                  >
                    {newProvider.useReferenceImagesParam ? "✓ 使用 reference_images 参数" : "使用 /images/edits 端点"}
                  </Button>
                  <p className="text-xs text-[#8f97aa]">
                    {newProvider.useReferenceImagesParam 
                      ? "参考图将通过 reference_images 参数传递到 /images/generations 端点（推荐用于 New API）" 
                      : "参考图将通过 FormData 上传到 /images/edits 端点（标准 OpenAI 格式）"}
                  </p>
</div>

 <div className="space-y-2">
 <label className="text-sm font-medium text-white">参考图传递方式（备用选择）</label>
 <select
 value={newProvider.useReferenceImagesParam ? "reference_images" : "images_edits"}
 onChange={(event) => setNewProvider((prev) => ({ ...prev, useReferenceImagesParam: event.target.value === "reference_images" }))}
 className={INPUT_CLASS_NAME}
 >
 <option value="images_edits">使用 /images/edits端点</option>
 <option value="reference_images">使用 reference_images 参数</option>
 </select>
 </div>

<div className="flex justify-end gap-2">
                  <Button variant="outline" className={OUTLINE_BUTTON_CLASS_NAME} onClick={() => setAddProviderOpen(false)}>
                    取消
                  </Button>
                <Button
                  className={PRIMARY_BUTTON_CLASS_NAME}
                  onClick={createProvider}
                >
                  <Plus className="mr-2 h-4 w-4" />
                  添加供应商
                </Button>
</div>
</div>
            </ModelEditorModal>
          ) : null}

          <div>
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-semibold text-white">模型供应商</h2>
              <Button className={PRIMARY_BUTTON_CLASS_NAME} onClick={() => setAddProviderOpen(true)}>
                <Plus className="mr-2 h-4 w-4" />
                添加供应商
              </Button>
            </div>

          {customProviders.length === 0 ? (
            <Card className={PANEL_CLASS_NAME}>
              <CardContent className="py-10 text-center text-sm text-[#8f97aa]">
                还没有模型供应商，请先添加供应商。
              </CardContent>
            </Card>
          ) : null}

          {selectedProvider ? (
          <div className="grid min-h-[620px] gap-4 lg:grid-cols-[300px_1fr]">
            <aside className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-3">
              <div className="mb-3 px-2 text-xs uppercase tracking-[0.18em] text-[#687183]">供应商列表</div>
              <div className="space-y-2">
                {customProviders.map((provider) => {
                  const totalFlowModels = FLOW_MODEL_TYPES.reduce((sum, type) => sum + provider.models[type].length, 0);
                  const selected = provider.id === selectedProvider.id;
                  return (
                    <button
                      key={provider.id}
                      type="button"
                      onClick={() => setSelectedProviderId(provider.id)}
                      className={cn(
                        "w-full rounded-2xl border px-3 py-3 text-left transition",
                        selected ? "border-sky-300/35 bg-sky-300/12" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.06]"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <Server className={cn("h-4 w-4", selected ? "text-cyan-300" : "text-[#8f97aa]")} />
                        <div className="min-w-0 flex-1 truncate text-sm font-medium text-white">{provider.name || "未命名供应商"}</div>
                      </div>
                      <div className="mt-2 truncate text-xs text-[#8f97aa]">{provider.baseUrl || "尚未填写 Base URL"}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[10px] text-[#8f97aa]">
                        <span className="rounded-full bg-white/[0.06] px-2 py-0.5">{totalFlowModels} 个模型</span>
                        <span className={getProviderKeyCount(provider.key) ? "rounded-full bg-emerald-400/10 px-2 py-0.5 text-emerald-200" : "rounded-full bg-amber-400/10 px-2 py-0.5 text-amber-200"}>
                          {getProviderKeyCount(provider.key) ? `${getProviderKeyCount(provider.key)} Key` : "未配置 Key"}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <div>
          {[selectedProvider].map((provider) => {
            const isOpen = expanded[provider.id] ?? true;
            const remoteModels = remoteLibraries[provider.id] ?? [];
            const totalFlowModels = FLOW_MODEL_TYPES.reduce((sum, type) => sum + provider.models[type].length, 0);

            return (
              <Card key={provider.id} className={PANEL_CLASS_NAME}>
                <CardHeader className="p-5 pb-0">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-cyan-400/12 text-cyan-300">
                        <Server className="h-4 w-4" />
                      </div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <CardTitle className="text-base text-white">{provider.name || "未命名供应商"}</CardTitle>
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#8f97aa]">
                            已添加 {totalFlowModels} 个模型
                          </span>
                          <span className="rounded-full bg-green-400/10 px-2 py-0.5 text-[10px] text-green-300">
                            免费
                          </span>
                        </div>
                        <div className="truncate text-xs text-[#8f97aa]">{provider.baseUrl || "尚未填写 Base URL"}</div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => void fetchModelLibrary(provider)}
                        disabled={libraryLoading[provider.id]}
                        className={OUTLINE_BUTTON_CLASS_NAME}
                      >
                        {libraryLoading[provider.id] ? (
                          <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                        ) : (
                          <Search className="mr-1.5 h-4 w-4" />
                        )}
                        获取模型
                      </Button>

                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => removeProvider(provider.id)}
                        className={OUTLINE_BUTTON_CLASS_NAME}
                      >
                        <Trash2 className="mr-1.5 h-4 w-4" />
                        删除
                      </Button>

                    </div>
                  </div>
                </CardHeader>

                {isOpen ? (
                  <CardContent className="space-y-5 p-5 pt-4">
                    <div className="grid gap-4 md:grid-cols-4">
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">供应商名称</label>
                        <Input
                          value={provider.name}
                          onChange={(event) => updateProvider(provider.id, { name: event.target.value })}
                          className={INPUT_CLASS_NAME}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">Base URL</label>
                        <Input
                          value={provider.baseUrl}
                          onChange={(event) => updateProvider(provider.id, { baseUrl: event.target.value })}
                          placeholder="https://api.example.com/v1"
                          className={INPUT_CLASS_NAME}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="flex items-center justify-between gap-2 text-sm font-medium text-white">
                          <span>API Key</span>
                          <span className="text-xs font-normal text-[#8f97aa]">{getProviderKeyCount(provider.key)} 个 Key</span>
                        </label>
                        <textarea
                          value={provider.key}
                          onChange={(event) => updateProvider(provider.id, { key: event.target.value })}
                          placeholder="一行一个 API Key"
                          className={`${TEXTAREA_CLASS_NAME} min-h-[92px] w-full resize-y font-mono leading-5`}
                        />
                        <p className="text-xs text-[#8f97aa]">多行时按请求轮询使用。</p>
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">日志访问令牌</label>
                        <Input
                          type="password"
                          value={provider.logAccessToken ?? ""}
                          onChange={(event) => updateProvider(provider.id, { logAccessToken: event.target.value.trim() || undefined })}
                          placeholder="可选，用于 524 后查询日志"
                          className={INPUT_CLASS_NAME}
                        />
                      </div>
                      <div className="space-y-2">
                        <label className="text-sm font-medium text-white">参考图传递方式</label>
                        <Button
                          type="button"
                          variant="outline"
                          className={cn(
                            "w-full justify-start text-left",
                            provider.useReferenceImagesParam 
                              ? "border-blue-500 bg-blue-500/10 text-blue-400" 
                              : "border-white/10 bg-white/5 text-white"
                          )}
                          onClick={() => updateProvider(provider.id, { useReferenceImagesParam: !provider.useReferenceImagesParam })}
                        >
                          {provider.useReferenceImagesParam ? "✓ 使用 reference_images 参数" : "使用 /images/edits 端点"}
                        </Button>
                        <p className="text-xs text-[#8f97aa]">
                          {provider.useReferenceImagesParam 
                            ? "参考图将通过 reference_images 参数传递到 /images/generations 端点" 
                            : "参考图将通过 FormData 上传到 /images/edits 端点"}
</p>
</div>
 <div className="space-y-2">
 <label className="text-sm font-medium text-white">参考图传递方式（备用选择）</label>
 <select
 value={provider.useReferenceImagesParam ? "reference_images" : "images_edits"}
 onChange={(event) => updateProvider(provider.id, { useReferenceImagesParam: event.target.value === "reference_images" })}
 className={INPUT_CLASS_NAME}
 >
 <option value="images_edits">使用 /images/edits端点</option>
 <option value="reference_images">使用 reference_images 参数</option>
 </select>
 </div>
</div>

                    {libraryStatus[provider.id] ? (
                      <div className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#8f97aa]">
                        {libraryStatus[provider.id]}
                      </div>
                    ) : null}

                    <div className="grid gap-4 xl:grid-cols-2">
                      {FLOW_MODEL_TYPES.map((type) => {
                        const meta = META[type];
                        const key = `${provider.id}:${type}`;
                        const currentModels = provider.models[type];
                        const keyword = (search[key] ?? "").trim().toLowerCase();
                        const filtered = remoteModels.filter((model) => {
                          if (currentModels.some((item) => item.id === model.id)) return false;
                          return !keyword || `${model.name} ${model.id}`.toLowerCase().includes(keyword);
                        });
                        const draft = getDraft(provider.id, type);

                        return (
                          <div key={key} className={cn("rounded-2xl border p-4", meta.box)}>
                            <div className="mb-4 flex items-center justify-between gap-3">
                              <div>
                                <div className="text-sm font-semibold text-white">{meta.label}</div>
                                <div className="text-xs text-[#8f97aa]">当前已添加 {currentModels.length} 个模型</div>
                              </div>
                              <span className="rounded-full border border-white/10 bg-black/20 px-2 py-1 text-[10px] font-semibold tracking-[0.2em] text-[#8f97aa]">
                                {meta.short}
                              </span>
                            </div>

                            {currentModels.length ? (
                              <div className="mb-4 space-y-2">
                                {currentModels.map((model) => (
                                  <div
                                    key={model.id}
                                    className="flex items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-3"
                                  >
                                    <div className="flex h-[72px] w-[72px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#161a22]">
                                      {model.thumbnailUrl ? (
                                        <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" />
                                      ) : (
                                        <span className="text-xs text-[#8f97aa]">IMG</span>
                                      )}
                                    </div>
                                    <div className="min-w-0 flex-1">
                                      <div className="truncate text-sm font-medium text-white">{model.name}</div>
                                      <div className="truncate text-[11px] text-[#8f97aa]">{model.id}</div>
                                      {model.description ? <div className="mt-1 truncate text-[11px] text-[#667085]">{model.description}</div> : null}
                                    </div>
                                    <button
                                      type="button"
                                      onClick={() => fillDraftFromModel(provider.id, type, model)}
                                      className="rounded-full p-1 text-[#8f97aa] opacity-70 hover:bg-white/10 hover:opacity-100"
                                      title="编辑模型"
                                    >
                                      <Edit2 className="h-3.5 w-3.5" />
                                    </button>
                                    <button
                                      type="button"
                                      onClick={() => removeProviderModel(provider.id, type, model.id)}
                                      className="rounded-full p-1 text-[#8f97aa] opacity-70 hover:bg-white/10 hover:opacity-100"
                                      title="删除模型"
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  </div>
                                ))}
                              </div>
                            ) : (
                              <div className="mb-4 rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-sm text-[#8f97aa]">
                                还没有添加{meta.label}。
                              </div>
                            )}

                            {editingModelKey?.startsWith(`${provider.id}:${type}:`) ? (
                              <ModelEditorModal title="编辑模型" onClose={() => resetDraft(provider.id, type)}>
                              <div className="mb-4 flex items-center justify-between gap-3">
                                <div>
                                  <div className="text-sm font-semibold text-white">编辑模型</div>
                                  <div className="text-xs text-[#8f97aa]">修改后会同步更新前台模型选择显示。</div>
                                </div>
                              </div>

                              <div className="grid gap-4 md:grid-cols-2">
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-white">模型类型</label>
                                  <Input value={meta.label} disabled className={cn(INPUT_CLASS_NAME, "opacity-70")} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-white">模型 ID</label>
                                  <Input value={draft.id} onChange={(event) => setDraft(provider.id, type, { id: event.target.value })} placeholder={`填写${meta.label}模型 ID`} className={INPUT_CLASS_NAME} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-sm font-medium text-white">模型缩略图</label>
                                  <div className="flex items-center gap-3">
                                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#161a22]">
                                      {draft.thumbnailUrl ? <img src={draft.thumbnailUrl} alt="模型缩略图预览" className="h-full w-full object-cover" /> : <span className="text-xs text-[#8f97aa]">IMG</span>}
                                    </div>
                                    <div className="flex-1 space-y-2">
                                      <Input value={draft.thumbnailUrl} onChange={(event) => setDraft(provider.id, type, { thumbnailUrl: event.target.value })} placeholder="https://example.com/model-thumb.png" className={INPUT_CLASS_NAME} />
                                      <div className="flex flex-wrap gap-2">
                                        <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#cfd7e6] transition hover:bg-white/[0.06] hover:text-white">
                                          <Upload className="h-4 w-4" />
                                          本地上传缩略图
                                          <input
                                            type="file"
                                            accept="image/*"
                                            className="hidden"
                                            onChange={async (event) => {
                                              const file = event.target.files?.[0];
                                              event.target.value = "";
                                              if (!file) return;
                                              const dataUrl = await readImageFileAsDataUrl(file);
                                              setDraft(provider.id, type, { thumbnailUrl: dataUrl });
                                            }}
                                          />
                                        </label>
                                        {draft.thumbnailUrl ? (
                                          <Button
                                            type="button"
                                            variant="outline"
                                            className={OUTLINE_BUTTON_CLASS_NAME}
                                            onClick={() => setDraft(provider.id, type, { thumbnailUrl: "" })}
                                          >
                                            移除缩略图
                                          </Button>
                                        ) : null}
                                      </div>
                                    </div>
                                  </div>
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-white">模型名称</label>
                                  <Input value={draft.name} onChange={(event) => setDraft(provider.id, type, { name: event.target.value })} placeholder={`填写${meta.label}显示名称`} className={INPUT_CLASS_NAME} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-sm font-medium text-white">模型描述</label>
                                  <Input value={draft.description} onChange={(event) => setDraft(provider.id, type, { description: event.target.value })} placeholder="描述模型能力、风格或适用场景" className={INPUT_CLASS_NAME} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-white">供应商</label>
                                  <Input value={provider.name} disabled className={cn(INPUT_CLASS_NAME, "opacity-70")} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-sm font-medium text-white">前台显示供应商名称</label>
                                  <Input value={draft.providerDisplayName} onChange={(event) => setDraft(provider.id, type, { providerDisplayName: event.target.value })} placeholder="不填则使用供应商名称" className={INPUT_CLASS_NAME} />
                                </div>
                                <div className="space-y-2">
                                  <label className="text-sm font-medium text-white">标签</label>
                                  <Input value={draft.tags} onChange={(event) => setDraft(provider.id, type, { tags: event.target.value })} placeholder="例如：超清4K 多参考图" className={INPUT_CLASS_NAME} />
                                </div>
                                <div className="space-y-2 md:col-span-2">
                                  <label className="text-sm font-medium text-white">消耗积分</label>
                                  <Input value={draft.credits} onChange={(event) => setDraft(provider.id, type, { credits: event.target.value })} placeholder="例如：10" className={INPUT_CLASS_NAME} />
                                </div>
                                <ApiRouteSelector
                                  type={type}
                                  routes={draft.apiRoutes}
                                  onChange={(apiRoutes) => setDraft(provider.id, type, { apiRoutes })}
                                />
                              </div>

                              <div className="mt-4 flex justify-end">
                                <Button
                                  className={PRIMARY_BUTTON_CLASS_NAME}
                                  onClick={() => {
                                    const modelId = draft.id.trim();
                                    if (!modelId) return;

                                    const payload = {
                                      id: modelId,
                                      name: draft.name.trim() || modelId,
                                      thumbnailUrl: draft.thumbnailUrl.trim() || undefined,
                                      providerDisplayName: draft.providerDisplayName.trim() || undefined,
                                      description: draft.description.trim() || undefined,
                                      tags: parseModelTags(draft.tags),
                                      credits: draft.credits.trim() ? Number(draft.credits) : undefined,
                                      apiRoutes: buildDraftApiRoutes(provider, type, modelId, draft.name.trim() || modelId, draft.apiRoutes),
                                    };

                                    if (editingModelKey?.startsWith(`${provider.id}:${type}:`)) {
                                      const editingId = editingModelKey.slice(`${provider.id}:${type}:`.length);
                                      updateProviderModel(provider.id, type, editingId, payload);
                                    } else {
                                      addProviderModel(provider.id, type, payload);
                                    }

                                    resetDraft(provider.id, type);
                                  }}
                                >
                                  <Plus className="mr-1.5 h-4 w-4" />
                                  保存模型
                                </Button>
                              </div>
                              </ModelEditorModal>
                            ) : null}

                            <div className="mt-4 space-y-3">
                              <div className="relative">
                                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
                                <Input
                                  className={cn(INPUT_CLASS_NAME, "pl-9")}
                                  value={search[key] ?? ""}
                                  onChange={(event) => setSearch((prev) => ({ ...prev, [key]: event.target.value }))}
                                  placeholder={`搜索全部远程模型并加入${meta.label}`}
                                />
                              </div>

                              {remoteModels.length ? (
                                filtered.length ? (
                                  <div className="max-h-80 overflow-y-auto pr-1">
                                    <div className="grid gap-2 md:grid-cols-2">
                                      {filtered.map((model) => (
                                        <button
                                          key={`${type}-${model.id}`}
                                          type="button"
                                          onClick={() =>
                                            addProviderModel(provider.id, type, {
                                              id: model.id,
                                              name: model.name,
                                              description: model.name,
                                              apiRoutes: buildDraftApiRoutes(provider, type, model.id, model.name),
                                            })
                                          }
                                          className="rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-left transition hover:border-cyan-400/30 hover:bg-cyan-400/8"
                                        >
                                          <div className="flex items-center gap-2">
                                            <div className="min-w-0 flex-1 truncate text-sm font-medium text-white">{model.name}</div>
                                            <span className="shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] px-2 py-0.5 text-[10px] text-[#8f97aa]">
                                              {REMOTE_MODEL_TYPE_LABELS[model.type]}
                                            </span>
                                          </div>
                                          <div className="truncate text-xs text-[#8f97aa]">{model.id}</div>
                                        </button>
                                      ))}
                                    </div>
                                  </div>
                                ) : (
                                  <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-sm text-[#8f97aa]">
                                    没有可加入的远程模型，或者它们已经在当前{meta.label}区域中。
                                  </div>
                                )
                              ) : (
                                <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-sm text-[#8f97aa]">
                                  点击上方“获取模型”后，可以在这里搜索全部远程模型并加入{meta.label}。
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                ) : null}
              </Card>
            );
          })}
            </div>
          </div>
          ) : null}
          </div>
        </div>
      ) : (
        <Card className={PANEL_CLASS_NAME}>
          <CardHeader className="p-5 pb-0">
            <div className="flex items-center justify-between gap-3">
              <CardTitle className="text-base text-white">模型选择</CardTitle>
            </div>
          </CardHeader>
          <CardContent className="space-y-5 p-5 pt-4">
            {FLOW_MODEL_TYPES.map((type) => {
              const meta = META[type];
              const activeValues = new Set(routing[type]);
              const modelsForType = customProviders.flatMap((provider) =>
                provider.models[type].map((model) => ({ provider, model }))
              );

              return (
                <div key={type} className={cn("rounded-2xl border p-4", meta.box)}>
                  <div className="mb-4">
                    <div className="text-base font-semibold text-white">{meta.label}</div>
                    <div className="text-xs text-[#8f97aa]">
                      已配置 {modelsForType.length} 个模型，已启用 {routing[type].length} 个默认模型。
                    </div>
                  </div>

                  {modelsForType.length ? (
                    <div className="mb-4 grid gap-3 md:grid-cols-2">
                      {modelsForType.map(({ provider, model }) => (
                        <div key={`${provider.id}:${model.id}`} className="rounded-xl border border-white/[0.08] bg-white/[0.03] p-3">
                          <div className="flex items-start gap-3">
                            <div className="flex h-[84px] w-[84px] shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-[#161a22]">
                              {model.thumbnailUrl ? <img src={model.thumbnailUrl} alt={model.name} className="h-full w-full object-cover" /> : <span className="text-xs text-[#8f97aa]">IMG</span>}
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="truncate text-sm font-semibold text-white">{model.name}</div>
                              <div className="mt-1 truncate text-[11px] text-[#8f97aa]">{model.providerDisplayName || provider.name} · {model.id}</div>
                              {model.description ? <div className="mt-2 line-clamp-2 text-[11px] text-[#667085]">{model.description}</div> : null}
                              <div className="mt-2 flex flex-wrap gap-2">
                                {model.tags?.map((tag) => (
                                  <span key={tag} className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-[#cfd7e6]">
                                    {tag}
                                  </span>
                                ))}
                                {model.credits !== undefined && model.credits > 0 ? <span className="rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300">{model.credits} 积分</span> : null}
                              </div>
                            </div>
                          </div>
                          <div className="mt-3 flex items-center justify-between">
                            <button
                              type="button"
                              onClick={() => toggleRoutingModel(type, buildProviderModelValue(provider.id, model.id))}
                              className={cn(
                                "relative inline-flex h-7 w-12 shrink-0 rounded-full transition",
                                activeValues.has(buildProviderModelValue(provider.id, model.id)) ? "bg-cyan-400" : "bg-white/[0.10]"
                              )}
                              title={activeValues.has(buildProviderModelValue(provider.id, model.id)) ? "已启用" : "未启用"}
                            >
                              <span
                                className={cn(
                                  "absolute top-1 h-5 w-5 rounded-full bg-white transition",
                                  activeValues.has(buildProviderModelValue(provider.id, model.id)) ? "left-6" : "left-1"
                                )}
                              />
                            </button>
                            <div className="flex gap-2">
                              <button type="button" onClick={() => startEditSelectionModel(provider.id, type, model)} className="rounded-full p-1 text-[#8f97aa] hover:bg-white/10 hover:text-white">
                                <Edit2 className="h-3.5 w-3.5" />
                              </button>
                              <button type="button" onClick={() => removeProviderModel(provider.id, type, model.id)} className="rounded-full p-1 text-[#8f97aa] hover:bg-white/10 hover:text-white">
                                <Trash2 className="h-3.5 w-3.5" />
                              </button>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}

                  {selectionDraft?.type === type ? (
                    <ModelEditorModal title="编辑模型" onClose={resetSelectionDraft}>
                      <div className="grid gap-4 md:grid-cols-2">
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">模型类型</label>
                          <Input value={meta.label} disabled className={cn(INPUT_CLASS_NAME, "opacity-70")} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">模型 ID</label>
                          <Input value={selectionDraft.id} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, id: event.target.value } : current))} placeholder="填写模型 ID" className={INPUT_CLASS_NAME} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium text-white">模型缩略图</label>
                          <div className="flex items-center gap-3">
                            <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-white/[0.08] bg-[#161a22]">
                              {selectionDraft.thumbnailUrl ? (
                                <img src={selectionDraft.thumbnailUrl} alt="模型缩略图预览" className="h-full w-full object-cover" />
                              ) : (
                                <span className="text-xs text-[#8f97aa]">IMG</span>
                              )}
                            </div>
                            <div className="flex-1 space-y-2">
                              <Input value={selectionDraft.thumbnailUrl} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, thumbnailUrl: event.target.value } : current))} placeholder="https://example.com/model-thumb.png" className={INPUT_CLASS_NAME} />
                              <div className="flex flex-wrap gap-2">
                                <label className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-[#cfd7e6] transition hover:bg-white/[0.06] hover:text-white">
                                  <Upload className="h-4 w-4" />
                                  本地上传缩略图
                                  <input
                                    type="file"
                                    accept="image/*"
                                    className="hidden"
                                    onChange={async (event) => {
                                      const file = event.target.files?.[0];
                                      event.target.value = "";
                                      if (!file) return;
                                      const dataUrl = await readImageFileAsDataUrl(file);
                                      setSelectionDraft((current) => (current ? { ...current, thumbnailUrl: dataUrl } : current));
                                    }}
                                  />
                                </label>
                                {selectionDraft.thumbnailUrl ? (
                                  <Button
                                    type="button"
                                    variant="outline"
                                    className={OUTLINE_BUTTON_CLASS_NAME}
                                    onClick={() => setSelectionDraft((current) => (current ? { ...current, thumbnailUrl: "" } : current))}
                                  >
                                    移除缩略图
                                  </Button>
                                ) : null}
                              </div>
                            </div>
                          </div>
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">模型名称</label>
                          <Input value={selectionDraft.name} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, name: event.target.value } : current))} placeholder="填写模型名称" className={INPUT_CLASS_NAME} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">供应商</label>
                          <select
                            value={selectionDraft.providerId}
                            onChange={(event) => setSelectionDraft((current) => (current ? { ...current, providerId: event.target.value } : current))}
                            className="h-9 w-full rounded-xl border border-white/[0.08] bg-[#1b1f29] px-3 text-white outline-none"
                          >
                            {customProviders.map((provider) => (
                              <option key={provider.id} value={provider.id}>
                                {provider.name}
                              </option>
                            ))}
                          </select>
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium text-white">前台显示供应商名称</label>
                          <Input value={selectionDraft.providerDisplayName} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, providerDisplayName: event.target.value } : current))} placeholder="不填则使用供应商名称" className={INPUT_CLASS_NAME} />
                        </div>
                        <div className="space-y-2 md:col-span-2">
                          <label className="text-sm font-medium text-white">模型描述</label>
                          <Input value={selectionDraft.description} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, description: event.target.value } : current))} placeholder="描述模型能力、风格或适用场景" className={INPUT_CLASS_NAME} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">标签</label>
                          <Input value={selectionDraft.tags} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, tags: event.target.value } : current))} placeholder="例如：超清4K 多参考图" className={INPUT_CLASS_NAME} />
                        </div>
                        <div className="space-y-2">
                          <label className="text-sm font-medium text-white">消耗积分</label>
                          <Input value={selectionDraft.credits} onChange={(event) => setSelectionDraft((current) => (current ? { ...current, credits: event.target.value } : current))} placeholder="例如：10" className={INPUT_CLASS_NAME} />
                        </div>
                        <ApiRouteSelector
                          type={type}
                          routes={selectionDraft.apiRoutes}
                          onChange={(apiRoutes) => setSelectionDraft((current) => (current ? { ...current, apiRoutes } : current))}
                        />
                      </div>

                      <div className="mt-4 flex justify-end">
                        <Button
                          className={PRIMARY_BUTTON_CLASS_NAME}
                          onClick={() => {
                            if (!selectionDraft) return;
                            const providerId = selectionDraft.providerId;
                            const modelId = selectionDraft.id.trim();
                            if (!providerId || !modelId) return;

                            const payload = {
                              id: modelId,
                              name: selectionDraft.name.trim() || modelId,
                              thumbnailUrl: selectionDraft.thumbnailUrl.trim() || undefined,
                              providerDisplayName: selectionDraft.providerDisplayName.trim() || undefined,
                              description: selectionDraft.description.trim() || undefined,
                              tags: parseModelTags(selectionDraft.tags),
                              credits: selectionDraft.credits.trim() ? Number(selectionDraft.credits) : undefined,
                              apiRoutes: buildDraftApiRoutes(
                                customProviders.find((provider) => provider.id === providerId),
                                type,
                                modelId,
                                selectionDraft.name.trim() || modelId,
                                selectionDraft.apiRoutes
                              ),
                            };

                            const [editingProviderId, , editingId] = selectionEditingKey?.split(":") ?? [];
                            if (!editingProviderId || !editingId) return;
                            updateProviderModel(editingProviderId, type, editingId, payload);

                            resetSelectionDraft();
                          }}
                        >
                          <Plus className="mr-1.5 h-4 w-4" />
                          保存模型
                        </Button>
                      </div>
                    </ModelEditorModal>
                  ) : null}

                  {modelsForType.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-white/[0.10] px-3 py-4 text-sm text-[#8f97aa]">
                      还没有可用的 {meta.label}。点击上方按钮添加模型，或先在供应商里拉取远程模型。
                    </div>
                  ) : null}
                </div>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
