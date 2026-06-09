import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Eraser, Eye, FolderOpen, LayoutGrid, Rows3, Search, Sparkles, Upload, Volume2, X } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { FlowFeed } from "./FlowFeed";
import { FlowGeneratorBar, type SelectedStyleReference } from "./FlowGeneratorBar";
import { FlowGrid, type GridSize } from "./FlowGrid";
import { AgentSidebar } from "../../components/agent/AgentSidebar";
import { cn } from "../../lib/utils";
import {
  IMAGE_GENERATION_TIMEOUT_MESSAGE,
  VIDEO_GENERATION_TIMEOUT_MESSAGE,
  isImageGenerationTimedOut,
  isVideoGenerationTimedOut,
} from "../../lib/generationStatus";
import { buildModelCatalogOptions, getPreferredModelValue } from "../../lib/modelCatalog";
import { parseSourcedProviderModelValue } from "../../lib/providerModels";
import { withSelectedProviderKey } from "../../lib/providerKeys";
import {
  IMAGE_RATIO_OPTIONS,
  VIDEO_RATIO_OPTIONS,
  buildGeneratorModelOptions,
  getImageSizeFromPreset,
  getVideoDurationOptionsForModel,
} from "../../lib/generatorOptions";
import {
  clearPersistedDirectoryHandle,
  getDataUrlFromPersistedAssetFile,
  isLocalFolderSaveSupported,
  loadPersistedDirectoryHandle,
  pickDirectoryHandle,
  saveGeneratedAssetToDirectory,
} from "../../services/localFiles";
import { uploadImageFiles } from "../../services/uploads";
import {
  generateImageAsset,
  generateVideoAsset,
  MISSING_IMAGE_JOB_STATUS,
  recoverGeneratedImageAsset,
  recoverGeneratedImageAssets,
  recoverGeneratedVideoAsset,
  recoverGeneratedVideoAssets,
} from "../../services/media";
import { useFlowUiStore } from "../../store/flowUiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { useFlowStore, type FlowItem, type FlowItemType, type FlowReferenceRole } from "../../store/flowStore";
import { useCreditStore } from "../../store/creditStore";
import { useAuthStore } from "../../store/authStore";
import { getModelCreditCost, useModelCreditStore } from "../../store/modelCreditStore";
import { useAgentStore } from "../../store/agentStore";

type ViewMode = "grid" | "batch";
type FilterBy = "all" | "image" | "video";
type SortBy = "newest" | "oldest";

const IMAGE_JOB_MISSING_GRACE_MS = 120_000;
const VIDEO_JOB_MISSING_GRACE_MS = 10 * 60 * 1000;
const IMAGE_JOB_MISSING_ERROR_MESSAGE = "历史图片任务不存在，请重新生成。";

const viewModeOptions: Array<{ value: ViewMode; label: string; icon: typeof LayoutGrid }> = [
  { value: "grid", label: "网格", icon: LayoutGrid },
  { value: "batch", label: "批量", icon: Rows3 },
];

const gridSizeOptions: Array<{ value: GridSize; label: string }> = [
  { value: "small", label: "S" },
  { value: "medium", label: "M" },
  { value: "large", label: "L" },
];

const VIDEO_JOB_MISSING_ERROR_MESSAGE = "Historical video job was not found. Please generate it again.";

type RecoveredVideoAsset = Awaited<ReturnType<typeof recoverGeneratedVideoAssets>>[number];

function normalizeRecoveredPrompt(prompt?: string) {
  return (prompt ?? "").trim();
}

function normalizeRatio(value?: string) {
  return value?.replace(/x/i, ":").trim();
}

function parseDurationSeconds(value?: string | number) {
  if (typeof value === "number") return Number.isFinite(value) ? value : undefined;
  if (!value) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isPastMissingJobGrace(item: FlowItem) {
  const graceMs = item.type === "video" ? VIDEO_JOB_MISSING_GRACE_MS : IMAGE_JOB_MISSING_GRACE_MS;
  return Date.now() - item.createdAt >= graceMs;
}

function isRecoverableImageError(item: FlowItem) {
  return item.status === "error" && (
    item.saveError === IMAGE_JOB_MISSING_ERROR_MESSAGE ||
    item.saveError === IMAGE_GENERATION_TIMEOUT_MESSAGE
  );
}

function isRecoverableVideoError(item: FlowItem) {
  return item.status === "error" && (
    item.saveError === VIDEO_JOB_MISSING_ERROR_MESSAGE ||
    item.saveError === VIDEO_GENERATION_TIMEOUT_MESSAGE
  );
}

function isSavableAssetUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/uploads/") || /^https?:\/\//i.test(url) || /^data:(?:image|video)\//i.test(url) || /^blob:/i.test(url);
}

function getItemModelId(item: FlowItem) {
  const parsed = item.parameters.modelValue ? parseSourcedProviderModelValue(item.parameters.modelValue) : null;
  return parsed?.modelId ?? item.parameters.modelValue ?? item.parameters.model;
}

function findRecoveredVideoAsset(item: FlowItem, cachedResults: RecoveredVideoAsset[]) {
  const itemPrompt = normalizeRecoveredPrompt(item.prompt);
  const itemRatio = normalizeRatio(item.parameters.aspectRatio);
  const itemDuration = parseDurationSeconds(item.parameters.duration);
  const itemModelId = getItemModelId(item);

  return cachedResults
    .filter((result) => {
      if (result.clientTaskId === item.id) return true;
      if (!result.prompt || normalizeRecoveredPrompt(result.prompt) !== itemPrompt) return false;

      const resultRatio = normalizeRatio(result.ratio);
      if (resultRatio && itemRatio && resultRatio !== itemRatio) return false;

      const resultDuration = parseDurationSeconds(result.duration);
      if (resultDuration !== undefined && itemDuration !== undefined && resultDuration !== itemDuration) return false;

      if (result.model && itemModelId && result.model !== itemModelId && result.model !== item.parameters.model) return false;
      return true;
    })
    .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))[0];
}

function EmptyState({ projectName }: { projectName: string }) {
  return (
    <div className="flex min-h-[46vh] flex-col items-center justify-center rounded-[28px] border border-dashed border-white/10 bg-white/[0.02] px-6 text-center">
      <div className="mb-5 flex h-16 w-16 items-center justify-center rounded-2xl bg-white/[0.04] text-cyan-300">
        <Sparkles className="h-7 w-7" />
      </div>
      <h3 className="text-lg font-semibold text-white">{projectName} 里还没有作品</h3>
    </div>
  );
}

export default function Flow() {
  const navigate = useNavigate();
  const { projectId } = useParams();
  const { projects, items, addItem, updateItem, removeItem, hasHydrated } = useFlowStore();
  const { spendCredits, refundCredits } = useCreditStore();
  const { currentUserId } = useAuthStore();
  const { isSidebarOpen, toggleSidebar } = useAgentStore();
  const { rules: modelCreditRules } = useModelCreditStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const {
    selectedModels,
    setSelectedModel,
    autoSaveDirectoryName,
    setAutoSaveDirectoryName,
    flowProjectViewMode,
    setFlowProjectViewMode,
    flowProjectGridSize,
    setFlowProjectGridSize,
  } = useFlowUiStore();

  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects]
  );

  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<FlowItemType>("image");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2k");
  const [duration, setDuration] = useState("10s");
  const [generationCount, setGenerationCount] = useState(1);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [externalReferenceImages, setExternalReferenceImages] = useState<string[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<Record<string, FlowReferenceRole>>({});
  const [openGeneratorPanel, setOpenGeneratorPanel] = useState<"type" | "model" | "ratio" | "count" | "assets" | "styles" | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyleReference | null>(null);
  const [openDisplayPanel, setOpenDisplayPanel] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [soundOnHover, setSoundOnHover] = useState(false);
  const [returnSilentVideos, setReturnSilentVideos] = useState(false);
  const [clearPromptOnSubmit, setClearPromptOnSubmit] = useState(false);
  const [filterBy, setFilterBy] = useState<FilterBy>("all");
  const [sortBy, setSortBy] = useState<SortBy>("newest");
  const [searchQuery, setSearchQuery] = useState("");
  const [saveDirectoryHandle, setSaveDirectoryHandle] = useState<FileSystemDirectoryHandle | null>(null);
  const [isPickingDirectory, setIsPickingDirectory] = useState(false);
  const [isStartingGeneration, setIsStartingGeneration] = useState(false);
  const [saveFeedback, setSaveFeedback] = useState("");
  const [previewVideo, setPreviewVideo] = useState<FlowItem | null>(null);

  const generatorRef = useRef<HTMLDivElement>(null);
  const displayPanelRef = useRef<HTMLDivElement>(null);
  const displayButtonRef = useRef<HTMLButtonElement>(null);
  const assetUploadInputRef = useRef<HTMLInputElement>(null);
  const isStartingGenerationRef = useRef(false);
  const localFolderSupported = isLocalFolderSaveSupported();

  const projectItems = useMemo(
    () => items.filter((item) => item.projectId === currentProject?.id),
    [currentProject?.id, items]
  );

  const imageModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "image", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "image", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const videoModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "video", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "video", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const model = selectedModels[type];
  const viewMode = flowProjectViewMode as ViewMode;
  const gridSize = flowProjectGridSize as GridSize;
  const currentModelOptions = type === "image" ? imageModelOptions : videoModelOptions;
  const ratioOptions = type === "image" ? IMAGE_RATIO_OPTIONS : VIDEO_RATIO_OPTIONS;
  const ratioValues = ratioOptions.map((option) => option.value);
  const selectedViewMode = viewModeOptions.find((option) => option.value === viewMode) ?? viewModeOptions[0];
  const SelectedViewModeIcon = selectedViewMode.icon;
  const selectedModelOption = currentModelOptions.find((option) => option.value === model);
  const durationOptions = useMemo(
    () => getVideoDurationOptionsForModel(model, selectedModelOption?.label, selectedModelOption?.providerName),
    [model, selectedModelOption?.label, selectedModelOption?.providerName]
  );
  const isCustomModel = selectedModelOption?.source === "custom";
  const estimatedCreditsPerItem = model
    ? getModelCreditCost({
        rules: modelCreditRules,
        modelValue: model,
        type,
        resolution: type === "image" ? resolution : undefined,
        duration: type === "video" ? duration : undefined,
        fallbackCredits: selectedModelOption?.credits,
      })
    : undefined;
  const estimatedCredits = estimatedCreditsPerItem !== undefined ? estimatedCreditsPerItem * generationCount : undefined;

  const totalImages = projectItems.filter((item) => item.type === "image").length;
  const totalVideos = projectItems.filter((item) => item.type === "video").length;
  const canGenerate = (!!prompt.trim() || referenceImages.length > 0) && !!model && !isStartingGeneration;

  const displayItems = useMemo(() => {
    let result = [...projectItems];

    if (filterBy !== "all") {
      result = result.filter((item) => item.type === filterBy);
    }

    const normalizedQuery = searchQuery.trim().toLowerCase();
    if (normalizedQuery) {
      result = result.filter((item) => {
        const haystack = [
          item.prompt,
          item.parameters.model,
          item.parameters.aspectRatio,
          item.parameters.duration,
          item.parameters.resolution,
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();

        return haystack.includes(normalizedQuery);
      });
    }

    result.sort((a, b) => (sortBy === "oldest" ? a.createdAt - b.createdAt : b.createdAt - a.createdAt));
    return result;
  }, [filterBy, projectItems, searchQuery, sortBy]);

  useEffect(() => {
    if (!hasHydrated) return;
    if (projects.length === 0) {
      navigate("/projects", { replace: true });
      return;
    }
    if (!currentProject) {
      navigate("/projects", { replace: true });
    }
  }, [currentProject, hasHydrated, navigate, projects.length]);

  useEffect(() => {
    const preferredModel = getPreferredModelValue(currentModelOptions);
    if (model && currentModelOptions.some((option) => option.value === model)) return;
    setSelectedModel(type, preferredModel);
  }, [currentModelOptions, model, setSelectedModel, type]);

  useEffect(() => {
    if (ratioValues.includes(aspectRatio)) return;
    setAspectRatio(ratioValues[0] ?? "16:9");
  }, [aspectRatio, ratioValues]);

  useEffect(() => {
    if (!hasHydrated) return;

    const failTimedOutMedia = () => {
      const now = Date.now();
      for (const item of projectItems) {
        if (isImageGenerationTimedOut(item, now)) {
          updateItem(item.id, { status: "error", progress: undefined, saveError: IMAGE_GENERATION_TIMEOUT_MESSAGE });
          continue;
        }
        if (isVideoGenerationTimedOut(item, now)) {
          updateItem(item.id, { status: "error", progress: undefined, saveError: VIDEO_GENERATION_TIMEOUT_MESSAGE });
        }
      }
    };

    failTimedOutMedia();
    const interval = window.setInterval(failTimedOutMedia, 1000);
    return () => window.clearInterval(interval);
  }, [hasHydrated, projectItems, updateItem]);

  useEffect(() => {
    if (type !== "video") return;
    if (durationOptions.some((option) => option.value === duration)) return;
    setDuration(durationOptions.find((option) => option.value === "10s")?.value ?? durationOptions[0]?.value ?? "10s");
  }, [duration, durationOptions, type]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!generatorRef.current?.contains(target)) {
        setOpenGeneratorPanel(null);
      }
      if (!displayPanelRef.current?.contains(target) && !displayButtonRef.current?.contains(target)) {
        setOpenDisplayPanel(false);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    if (!localFolderSupported) return;

    let cancelled = false;
    const restoreDirectory = async () => {
      try {
        const handle = await loadPersistedDirectoryHandle();
        if (!handle || cancelled) return;
        setSaveDirectoryHandle(handle);
        setAutoSaveDirectoryName(handle.name);
      } catch (error) {
        console.warn("[flow] failed to restore save directory:", error);
      }
    };

    void restoreDirectory();

    return () => {
      cancelled = true;
    };
  }, [localFolderSupported, setAutoSaveDirectoryName]);

  useEffect(() => {
    if (!saveFeedback) return;
    const timeout = window.setTimeout(() => setSaveFeedback(""), 4000);
    return () => window.clearTimeout(timeout);
  }, [saveFeedback]);

  useEffect(() => {
    if (!hasHydrated || !currentProject) return;
    let cancelled = false;
    const pendingImages = projectItems.filter(
      (item) =>
        item.type === "image" &&
        !item.url &&
        (item.status === "generating" || isRecoverableImageError(item))
    );
    const pendingVideos = projectItems.filter(
      (item) =>
        item.type === "video" &&
        !item.url &&
        (item.status === "generating" || isRecoverableVideoError(item))
    );
    if (pendingImages.length === 0 && pendingVideos.length === 0) return;

    const recover = async () => {
      const cachedResults = pendingImages.length ? await recoverGeneratedImageAssets() : [];
      const cachedVideoResults = pendingVideos.length ? await recoverGeneratedVideoAssets() : [];
      for (const item of pendingImages) {
        try {
          const cachedResult = cachedResults.find((result) => result.clientTaskId === item.id)
            ?? cachedResults.find((result) => result.prompt && result.prompt === item.prompt && (!result.model || result.model === item.parameters.modelValue));
          const url = cachedResult?.url ?? await recoverGeneratedImageAsset(item.id);
          if (!cancelled && url === MISSING_IMAGE_JOB_STATUS && isPastMissingJobGrace(item)) {
            updateItem(item.id, { status: "error", progress: undefined, saveError: "历史图片任务不存在，请重新生成。" });
          } else if (!cancelled && url && isSavableAssetUrl(url)) {
            updateItem(item.id, { status: "completed", url, progress: 100, saveError: undefined });
            if (saveDirectoryHandle) {
              void saveItemToFolder({ ...item, status: "completed", url, progress: 100 }, saveDirectoryHandle);
            }
          } else if (!cancelled && url && localStorage.getItem("media-debug") === "1") {
            console.log("[media-debug] ignore non-renderable image recovery url", { id: item.id, url });
          }
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image recovery failed", { id: item.id, error });
          if (!cancelled && item.status === "generating") {
            updateItem(item.id, {
              status: "error",
              progress: undefined,
              saveError: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }

      for (const item of pendingVideos) {
        try {
          const cachedResult = findRecoveredVideoAsset(item, cachedVideoResults);
          const url = cachedResult?.url ?? await recoverGeneratedVideoAsset(item.id);
          if (!cancelled && url === MISSING_IMAGE_JOB_STATUS && isPastMissingJobGrace(item)) {
            updateItem(item.id, { status: "error", progress: undefined, saveError: VIDEO_JOB_MISSING_ERROR_MESSAGE });
          } else if (!cancelled && url && isSavableAssetUrl(url)) {
            updateItem(item.id, { status: "completed", url, progress: 100, saveError: undefined });
            if (saveDirectoryHandle) {
              void saveItemToFolder({ ...item, status: "completed", url, progress: 100 }, saveDirectoryHandle);
            }
          } else if (!cancelled && url && localStorage.getItem("media-debug") === "1") {
            console.log("[media-debug] ignore non-renderable video recovery url", { id: item.id, url });
          }
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] video recovery failed", { id: item.id, error });
          if (!cancelled && item.status === "generating") {
            updateItem(item.id, {
              status: "error",
              progress: undefined,
              saveError: error instanceof Error ? error.message : String(error),
            });
          }
        }
      }
    };

    void recover();
    const interval = window.setInterval(() => void recover(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentProject, hasHydrated, projectItems, saveDirectoryHandle, updateItem]);

  // Listen for agent prompt apply events
  useEffect(() => {
    const handleAgentApplyPrompt = (event: CustomEvent<{ prompt: string }>) => {
      setPrompt(event.detail.prompt);
      // Optionally close the agent sidebar
      // useAgentStore.getState().closeSidebar();
    };

    window.addEventListener('agent-apply-prompt', handleAgentApplyPrompt as EventListener);
    return () => {
      window.removeEventListener('agent-apply-prompt', handleAgentApplyPrompt as EventListener);
    };
  }, []);

  const handlePickSaveDirectory = async () => {
    if (!localFolderSupported) {
      alert("当前浏览器不支持文件夹自动保存，请使用 Chrome 或 Edge。");
      return null;
    }

    setIsPickingDirectory(true);
    try {
      const handle = await pickDirectoryHandle();
      setSaveDirectoryHandle(handle);
      setAutoSaveDirectoryName(handle.name);
      setSaveFeedback(`已连接文件夹：${handle.name}`);
      return handle;
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        return null;
      }
      alert(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setIsPickingDirectory(false);
    }
  };

  const handleClearSaveDirectory = async () => {
    setSaveDirectoryHandle(null);
    setAutoSaveDirectoryName("");
    setSaveFeedback("已断开文件夹自动保存");
    try {
      await clearPersistedDirectoryHandle();
    } catch (error) {
      console.warn("[flow] failed to clear persisted directory:", error);
    }
  };

  const saveItemToFolder = async (item: FlowItem, preferredHandle?: FileSystemDirectoryHandle | null) => {
    if (!item.url) return false;
    if (!isSavableAssetUrl(item.url)) {
      if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] skip saving unsupported asset url", { id: item.id, url: item.url });
      return false;
    }

    let directoryHandle = preferredHandle ?? saveDirectoryHandle;
    if (!directoryHandle) {
      directoryHandle = await handlePickSaveDirectory();
      if (!directoryHandle) return false;
    }

    try {
      const savedModelValue = item.parameters.modelValue ?? model;
      const sourcedModel = parseSourcedProviderModelValue(savedModelValue);
      const providerForSave = sourcedModel
        ? (sourcedModel.source === "custom" ? userProviders : providers).find((provider) => provider.id === sourcedModel.providerId)
        : undefined;
      const providerKey = providerForSave ? withSelectedProviderKey(providerForSave).key : undefined;
      const saved = await saveGeneratedAssetToDirectory({
        directoryHandle,
        assetUrl: item.url,
        assetType: item.type,
        prompt: item.prompt,
        createdAt: item.createdAt,
        itemId: item.id,
        providerKey,
      });
      updateItem(item.id, { savedFileName: saved.fileName, saveError: undefined });
      setSaveFeedback(`已保存到文件夹：${saved.directoryName}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      updateItem(item.id, { saveError: message });
      alert(`素材已生成，但保存到文件夹失败：${message}`);
      return false;
    }
  };

  const handleAssetUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    if (!files.length || !currentProject) return;

    try {
      const uploadedFiles = await uploadImageFiles(files);
      for (const uploaded of uploadedFiles) {
        addItem({
          projectId: currentProject.id,
          type: "image",
          prompt: `上传的素材：${uploaded.name}`,
          status: "completed",
          url: uploaded.url,
          parameters: {
            model: "Upload",
            modelValue: "upload",
            aspectRatio: "16:9",
            resolution: "2k",
          },
        });
      }
    } catch (error) {
      console.error("Failed to upload asset:", error);
      alert(`上传素材失败：${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleGenerate = async () => {
    if (isStartingGenerationRef.current) return;
    if (!currentProject || (!prompt.trim() && referenceImages.length === 0) || !model) return;
    if (!isCustomModel && !currentUserId) {
      alert("请先登录后再生成内容。");
      navigate("/auth");
      return;
    }

    const itemPrompt = prompt;
    const itemType = type;
    const itemReferenceImages = referenceImages;
    const itemReferenceImage = itemReferenceImages[0];
    const itemReferenceRoles = itemReferenceImages.map((image) => referenceImageRoles[image] ?? "general");
    const itemStyle = selectedStyle;
    const itemStyleImages = itemStyle?.imageUrl ? [itemStyle.imageUrl] : [];
    const modelLabel = selectedModelOption?.label ?? model;
    const count = Math.min(4, Math.max(1, generationCount));
    const creditCost = getModelCreditCost({
      rules: modelCreditRules,
      modelValue: model,
      type: itemType,
      resolution,
      duration: itemType === "video" ? duration : undefined,
      fallbackCredits: selectedModelOption?.credits,
    });

    isStartingGenerationRef.current = true;
    setIsStartingGeneration(true);
    const tasks: Array<Promise<void>> = [];
    for (let index = 0; index < count; index += 1) {
      const itemCreatedAt = Date.now() + index;
      const id = addItem({
        projectId: currentProject.id,
        type: itemType,
        prompt: itemPrompt,
        status: "generating",
        parameters: {
          model: modelLabel,
          modelValue: model,
          aspectRatio,
          resolution,
          duration: itemType === "video" ? duration : undefined,
        },
        referenceImage: itemReferenceImage,
        referenceImages: itemReferenceImages.length > 0 ? itemReferenceImages : undefined,
        referenceImageRoles: itemReferenceImages.length > 0 ? referenceImageRoles : undefined,
        styleReference: itemStyle ?? undefined,
        styleReferenceImages: itemStyleImages.length > 0 ? itemStyleImages : undefined,
      });

      if (index === 0) {
        setPrompt("");
        setReferenceImages([]);
        setExternalReferenceImages([]);
        setReferenceImageRoles({});
        setOpenGeneratorPanel(null);
        isStartingGenerationRef.current = false;
        setIsStartingGeneration(false);
      }

      if (!isCustomModel && currentUserId) {
        const spendResult = spendCredits({
          userId: currentUserId,
          amount: creditCost,
          generationTaskId: id,
          note: `生成${itemType === "image" ? "图片" : "视频"}：${modelLabel}`,
        });
        if (!spendResult.ok) {
          updateItem(id, { status: "error", saveError: spendResult.message });
          alert(spendResult.message);
          break;
        }
      }

      tasks.push((async () => {
        try {
          if (itemType === "image") {
            const url = await generateImageAsset({
              modelId: model,
              prompt: itemPrompt,
              referenceImageUrl: itemReferenceImage,
              referenceImageUrls: itemReferenceImages,
              referenceImageRoles: itemReferenceRoles,
              styleReferenceImageUrls: itemStyleImages,
              styleReferencePrompt: itemStyle?.prompt,
              styleReferenceName: itemStyle?.name,
              styleStrength: itemStyle?.strength,
              size: getImageSizeFromPreset(aspectRatio, resolution),
              ratio: aspectRatio === "auto" ? undefined : aspectRatio,
              resolution,
              n: 1,
              clientTaskId: id,
            });
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation completed", { id, url });
            if (!isSavableAssetUrl(url)) {
              if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation returned non-renderable url; waiting for recovery", { id, url });
              return;
            }
            updateItem(id, { status: "completed", url, saveError: undefined });
            if (saveDirectoryHandle) {
              void saveItemToFolder(
                {
                  id,
                  projectId: currentProject.id,
                  type: itemType,
                  prompt: itemPrompt,
                  status: "completed",
                  url,
                  parameters: { model: modelLabel, modelValue: model, aspectRatio, resolution },
                  referenceImage: itemReferenceImage,
                  referenceImages: itemReferenceImages.length > 0 ? itemReferenceImages : undefined,
                  referenceImageRoles: itemReferenceImages.length > 0 ? referenceImageRoles : undefined,
                  styleReference: itemStyle ?? undefined,
                  styleReferenceImages: itemStyleImages.length > 0 ? itemStyleImages : undefined,
                  createdAt: itemCreatedAt,
                },
                saveDirectoryHandle
              );
            }
            return;
          }

          const durationNum = Number.parseFloat(duration) || 5;
          const url = await generateVideoAsset({
            modelId: model,
            prompt: itemPrompt,
            ratio: aspectRatio,
            resolution,
            duration: durationNum,
            n: 1,
            startImageUrl: itemReferenceImages[0],
            endImageUrl: itemReferenceImages[1],
            referenceImageUrls: itemReferenceImages,
            clientTaskId: id,
            onProgress: (progress) => updateItem(id, { progress: Math.round(progress) }),
          });
          if (!isSavableAssetUrl(url)) {
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] video generation returned non-renderable url; waiting for recovery", { id, url });
            return;
          }
          updateItem(id, { status: "completed", url, progress: 100, saveError: undefined });
          if (saveDirectoryHandle) {
            void saveItemToFolder(
              {
                id,
                projectId: currentProject.id,
                type: itemType,
                prompt: itemPrompt,
                status: "completed",
                url,
                parameters: { model: modelLabel, modelValue: model, aspectRatio, resolution, duration },
                referenceImage: itemReferenceImage,
                referenceImages: itemReferenceImages.length > 0 ? itemReferenceImages : undefined,
                referenceImageRoles: itemReferenceImages.length > 0 ? referenceImageRoles : undefined,
                createdAt: itemCreatedAt,
              },
              saveDirectoryHandle
            );
          }
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] generation failed", error);
          updateItem(id, { status: "error", url: undefined, progress: undefined, saveError: error instanceof Error ? error.message : String(error) });
          if (!isCustomModel && currentUserId) {
            refundCredits({ userId: currentUserId, amount: creditCost, generationTaskId: id, note: `生成失败返还：${modelLabel}` });
          }
        }
      })());
    }

    if (isStartingGenerationRef.current) {
      isStartingGenerationRef.current = false;
      setIsStartingGeneration(false);
    }

    await Promise.allSettled(tasks);
  };

  const handleReusePrompt = (item: FlowItem) => {
    setPrompt(item.prompt ?? "");
    if (item.type === "image" || item.type === "video") {
      setType(item.type);
    }
  };

  const handleUseAsReference = async (item: FlowItem) => {
    if (!item.url) return;
    let referenceUrl = item.url;
    if (item.savedFileName) {
      referenceUrl = (await getDataUrlFromPersistedAssetFile(item.id).catch(() => null)) ?? item.url;
    }
    setReferenceImages((current) => {
      const existingIndex = current.indexOf(referenceUrl);
      return existingIndex >= 0 ? current : [...current, referenceUrl];
    });
    setExternalReferenceImages((current) => (current.includes(referenceUrl) ? current : [...current, referenceUrl]));
    setReferenceImageRoles((current) => ({ ...current, [referenceUrl]: current[referenceUrl] ?? "general" }));
  };

  const handleOpenItem = (item: FlowItem) => {
    if (item.type === "image") {
      if (!currentProject) return;
      navigate(`/projects/${currentProject.id}/works/${item.id}`);
      return;
    }

    if (item.type === "video" && item.url) {
      setPreviewVideo(item);
    }
  };

  if (!hasHydrated || !currentProject) return null;

  const libraryTabs = [
    { key: "all" as const, label: "全部作品", count: projectItems.length },
    { key: "image" as const, label: "图片", count: totalImages },
    { key: "video" as const, label: "视频", count: totalVideos },
  ];

  const sortOptions: Array<{ value: SortBy; label: string }> = [
    { value: "newest", label: "最新" },
    { value: "oldest", label: "最早" },
  ];

  const imageDimensions = (() => {
    if (type === "video") {
      const height = resolution === "1080p" ? "1080" : "720";
      return aspectRatio === "9:16" ? { width: height, height: resolution === "1080p" ? "1920" : "1280" } : { width: resolution === "1080p" ? "1920" : "1280", height };
    }
    const [width = "1440", height = "2560"] = getImageSizeFromPreset(aspectRatio, resolution).split("x");
    return { width, height };
  })();

  return (
    <div className="relative -m-6 flex h-[calc(100%+3rem)] flex-col overflow-hidden bg-[#08090d] text-white md:h-[calc(100%+4rem)]">
      <nav className="sticky top-0 z-30 flex min-h-12 shrink-0 flex-col gap-2 border-b border-white/[0.06] bg-[#08090d] px-3 py-2 md:flex-row md:items-center md:justify-between md:px-4 md:py-3">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => navigate("/projects")}
            className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-[#9aa3b7] transition hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-medium text-[#e4e8f0]">{currentProject.name}</div>
            <div className="truncate text-xs text-[#758099]">{projectItems.length} 个作品</div>
          </div>
        </div>

        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
            {libraryTabs.map(({ key, label, count }) => (
              <button
                key={key}
                type="button"
                onClick={() => setFilterBy(key)}
                className={cn(
                  "rounded-lg px-2.5 py-1.5 text-xs sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm transition whitespace-nowrap",
                  filterBy === key
                    ? "bg-white text-black"
                    : "border border-white/[0.06] bg-white/[0.03] text-[#8f97aa] hover:text-white"
                )}
              >
                {label}
                <span className="ml-1.5 text-[10px] sm:ml-2 sm:text-xs opacity-70">{count}</span>
              </button>
            ))}

            {/* Upload asset button */}
            <input
              ref={assetUploadInputRef}
              type="file"
              accept="image/*"
              multiple
              onChange={handleAssetUpload}
              className="hidden"
            />
            <button
              type="button"
              onClick={() => assetUploadInputRef.current?.click()}
              className="rounded-lg px-2.5 py-1.5 text-xs sm:rounded-xl sm:px-4 sm:py-2 sm:text-sm transition whitespace-nowrap border border-white/[0.06] bg-white/[0.03] text-[#8f97aa] hover:text-white flex items-center gap-1.5"
              title="上传素材到当前项目"
            >
              <Upload className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline">上传素材</span>
            </button>
          </div>
          <div className="flex items-center gap-1.5 sm:gap-2">
            <span className="text-[10px] sm:text-xs text-[#758099] whitespace-nowrap">排序</span>
            <select
              value={sortBy}
              onChange={(event) => setSortBy(event.target.value as SortBy)}
              className="h-7 sm:h-9 rounded-lg sm:rounded-xl border border-white/[0.06] bg-white/[0.03] px-2 sm:px-3 text-xs sm:text-sm text-white outline-none"
            >
              {sortOptions.map((option) => (
                <option key={option.value} value={option.value} className="bg-[#111318] text-white">
                  {option.label}
                </option>
              ))}
            </select>
          </div>
          {saveFeedback ? <span className="hidden text-xs text-emerald-300 lg:inline">{saveFeedback}</span> : null}
        </div>

        <div className="flex items-center gap-1.5 sm:gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#6f7890]" />
            <input
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="搜索当前项目..."
              className="h-8 w-40 rounded-lg border border-white/[0.06] bg-white/[0.03] pl-8 pr-3 text-xs text-white outline-none placeholder:text-[#667085] transition-all focus:w-56 focus:border-white/10"
            />
          </div>

          {localFolderSupported ? (
            <>
              <button
                type="button"
                onClick={() => void handlePickSaveDirectory()}
                disabled={isPickingDirectory}
                className={cn(
                  "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs transition",
                  autoSaveDirectoryName
                    ? "border-emerald-400/30 bg-emerald-400/10 text-white hover:border-emerald-400/40"
                    : "border-white/[0.06] bg-white/[0.03] text-[#cfd6e2] hover:border-white/10 hover:text-white"
                )}
              >
                <FolderOpen className="h-3.5 w-3.5" />
                <span className="hidden md:inline">
                  {isPickingDirectory
                    ? "选择中..."
                    : autoSaveDirectoryName
                      ? `自动保存：${autoSaveDirectoryName}`
                      : "选择文件夹"}
                </span>
              </button>

              {saveDirectoryHandle || autoSaveDirectoryName ? (
                <button
                  type="button"
                  onClick={() => void handleClearSaveDirectory()}
                  title="取消文件夹自动保存"
                  aria-label="取消文件夹自动保存"
                  className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/[0.06] bg-white/[0.03] text-[#9aa3b7] transition hover:border-white/10 hover:text-white"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              ) : null}
            </>
          ) : null}

          <div className="relative">
            <button
              ref={displayButtonRef}
              type="button"
              onClick={() => setOpenDisplayPanel((current) => !current)}
              className={cn(
                "flex h-7 sm:h-8 items-center gap-1.5 sm:gap-2 rounded-lg border px-2 sm:px-3 text-xs transition",
                openDisplayPanel
                  ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                  : "border-white/[0.06] bg-white/[0.03] text-[#cfd6e2] hover:border-white/10 hover:text-white"
              )}
            >
              <SelectedViewModeIcon className="h-3 w-3 sm:h-3.5 sm:w-3.5" />
              <span className="hidden sm:inline">
                {selectedViewMode.label}
                {viewMode === "grid" ? ` / ${gridSizeOptions.find((item) => item.value === gridSize)?.label ?? "M"}` : ""}
              </span>
            </button>

            {openDisplayPanel ? (
              <div
                ref={displayPanelRef}
                className="absolute right-0 top-[calc(100%+10px)] z-30 w-[300px] rounded-2xl border border-white/8 bg-[#1f1f1f] p-2 shadow-[0_24px_50px_rgba(0,0,0,0.55)]"
              >
                <div className="px-3 pb-1.5 pt-2 text-[11px] text-[#9aa0a6]">视图模式</div>
                <div className="mx-2 mb-1 flex rounded-full bg-[#2a2a2a] p-1">
                  {viewModeOptions.map((option) => {
                    const Icon = option.icon;
                    const active = option.value === viewMode;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFlowProjectViewMode(option.value)}
                        className={cn(
                          "flex flex-1 items-center justify-center gap-1.5 rounded-full px-3 py-1.5 text-xs transition",
                          active ? "bg-[#3c3c3c] text-white" : "text-[#bdc1c6] hover:text-white"
                        )}
                      >
                        <Icon className="h-3.5 w-3.5" />
                        <span>{option.label}</span>
                      </button>
                    );
                  })}
                </div>

                <div className="px-3 pb-1.5 pt-3 text-[11px] text-[#9aa0a6]">网格大小</div>
                <div className="mx-2 mb-2 flex rounded-full bg-[#2a2a2a] p-1">
                  {gridSizeOptions.map((option) => {
                    const active = gridSize === option.value;
                    return (
                      <button
                        key={option.value}
                        type="button"
                        onClick={() => setFlowProjectGridSize(option.value)}
                        className={cn(
                          "flex-1 rounded-full px-3 py-1.5 text-xs transition",
                          active ? "bg-[#3c3c3c] text-white" : "text-[#bdc1c6] hover:text-white"
                        )}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>

                {[
                  { icon: Volume2, label: "鼠标悬停时播放声音", value: soundOnHover, onChange: setSoundOnHover },
                  { icon: Eye, label: "显示作品详细信息", value: showDetails, onChange: setShowDetails },
                  { icon: Eraser, label: "提交后清空提示词", value: clearPromptOnSubmit, onChange: setClearPromptOnSubmit },
                  { icon: Volume2, label: "Return silent videos", value: returnSilentVideos, onChange: setReturnSilentVideos },
                ].map(({ icon: Icon, label, value, onChange }) => (
                  <div key={label} className="flex items-center justify-between gap-3 px-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3 text-sm text-white">
                      <Icon className="h-5 w-5 shrink-0 text-[#bdc1c6]" />
                      <span className="truncate">{label}</span>
                    </div>
                    <div className="flex shrink-0 rounded-full bg-[#2a2a2a] p-1">
                      <button
                        type="button"
                        onClick={() => onChange(false)}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs transition",
                          !value ? "bg-[#3c3c3c] text-white" : "text-[#9aa0a6]"
                        )}
                      >
                        关闭
                      </button>
                      <button
                        type="button"
                        onClick={() => onChange(true)}
                        className={cn(
                          "rounded-full px-3 py-1 text-xs transition",
                          value ? "bg-[#3c3c3c] text-white" : "text-[#9aa0a6]"
                        )}
                      >
                        开启
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => toggleSidebar()}
            className={cn(
              "flex h-8 items-center gap-2 rounded-lg border px-3 text-xs transition",
              isSidebarOpen
                ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                : "border-white/[0.06] bg-white/[0.03] text-[#cfd6e2] hover:border-white/10 hover:text-white"
            )}
            aria-label="展开智能体面板"
          >
            <Bot className="h-3.5 w-3.5" />
            <span>Agent</span>
          </button>
        </div>
      </nav>

      <section className="relative flex min-h-0 flex-1 overflow-hidden">
        <div className="relative flex min-w-0 flex-1 flex-col overflow-hidden">
          <div className="min-h-0 flex-1 overflow-y-auto pl-2 pr-4 pb-[248px] pt-4 md:pl-3 md:pr-5 md:pb-[228px]">
            {displayItems.length === 0 ? (
              <EmptyState projectName={currentProject.name} />
            ) : (
              <>
                <div className={cn(viewMode !== "grid" && "hidden")} aria-hidden={viewMode !== "grid"}>
                  <FlowGrid
                    items={displayItems}
                    gridSize={gridSize}
                    showDetails={showDetails}
                    onRemove={removeItem}
                    onSave={(item) => void saveItemToFolder(item)}
                    onReusePrompt={handleReusePrompt}
                    onUseAsReference={handleUseAsReference}
                    onOpen={handleOpenItem}
                  />
                </div>

                <div className={cn(viewMode !== "batch" && "hidden")} aria-hidden={viewMode !== "batch"}>
                  <FlowFeed
                    items={displayItems}
                    gridSize={gridSize}
                    showDetails={showDetails}
                    onRemove={removeItem}
                    onSave={(item) => void saveItemToFolder(item)}
                    onReusePrompt={handleReusePrompt}
                    onUseAsReference={handleUseAsReference}
                    onOpen={handleOpenItem}
                  />
                </div>
              </>
            )}
          </div>
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 px-4 pb-4 md:px-10 lg:px-16 xl:px-24">
            <div className="pointer-events-auto mx-auto w-full max-w-[1180px]">
              <FlowGeneratorBar
                generatorRef={generatorRef}
                prompt={prompt}
                onPromptChange={setPrompt}
                onPromptKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleGenerate();
                  }
                }}
                type={type}
                onTypeChange={setType}
                model={model}
                onModelChange={(value) => setSelectedModel(type, value)}
                aspectRatio={aspectRatio}
                onAspectRatioChange={setAspectRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
                duration={duration}
                onDurationChange={setDuration}
                generationCount={generationCount}
                onGenerationCountChange={setGenerationCount}
            referenceImages={referenceImages}
            onReferenceImagesChange={setReferenceImages}
            externalReferenceImages={externalReferenceImages}
            onExternalReferenceImagesChange={setExternalReferenceImages}
            referenceImageRoles={referenceImageRoles}
            onReferenceImageRolesChange={setReferenceImageRoles}
            selectedStyle={selectedStyle}
            onSelectedStyleChange={setSelectedStyle}
                currentModelOptions={currentModelOptions}
                ratioOptions={ratioOptions}
                durationOptions={durationOptions}
                canGenerate={canGenerate}
                isGenerating={isStartingGeneration}
                estimatedCredits={estimatedCredits}
                openGeneratorPanel={openGeneratorPanel}
                onOpenGeneratorPanelChange={setOpenGeneratorPanel}
                onGenerate={() => void handleGenerate()}
                projects={projects}
                assets={items}
                currentProjectId={currentProject.id}
                imageDimensions={imageDimensions}
              />
            </div>
          </div>
        </div>
        <AgentSidebar mode="inline" />
      </section>

      {previewVideo?.url ? (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/86 px-4 py-6 backdrop-blur-sm" onClick={() => setPreviewVideo(null)}>
          <div className="relative flex h-full w-full max-w-[min(96vw,1440px)] items-center justify-center" onClick={(event) => event.stopPropagation()}>
            <button
              type="button"
              onClick={() => setPreviewVideo(null)}
              className="absolute right-0 top-0 z-10 rounded-full bg-white/10 px-4 py-2 text-sm text-white transition hover:bg-white/18"
            >
              关闭
            </button>
            <video
              src={previewVideo.url}
              poster={previewVideo.thumbnail}
              controls
              autoPlay
              className="max-h-full max-w-full rounded-2xl bg-black object-contain shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
            />
          </div>
        </div>
      ) : null}

    </div>
  );
}
