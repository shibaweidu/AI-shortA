import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Bot, Check, ChevronDown, Copy, Download, Image as ImageIcon, Loader2 } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { AgentSidebar } from "../../components/agent/AgentSidebar";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { FlowGeneratorBar, type SelectedStyleReference } from "./FlowGeneratorBar";
import { cn, getDisplayAssetUrl, getFlowItemDisplayName } from "../../lib/utils";
import {
  IMAGE_GENERATION_TIMEOUT_LABEL,
  IMAGE_GENERATION_TIMEOUT_MESSAGE,
  formatElapsedTime,
  getGenerationElapsedMs,
  isImageGenerationTimedOut,
} from "../../lib/generationStatus";
import { buildModelCatalogOptions, getPreferredModelValue } from "../../lib/modelCatalog";
import {
  IMAGE_RATIO_OPTIONS,
  VIDEO_DURATION_OPTIONS,
  buildGeneratorModelOptions,
  getImageSizeFromPreset,
} from "../../lib/generatorOptions";
import { generateImageAsset, MISSING_IMAGE_JOB_STATUS, recoverGeneratedImageAsset } from "../../services/media";
import { getDataUrlFromPersistedAssetFile } from "../../services/localFiles";
import { resolveReferenceImageDataUrl, resolveReferenceImageDataUrls } from "../../services/referenceImages";
import { useFlowUiStore } from "../../store/flowUiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { useFlowStore, type FlowReferenceRole } from "../../store/flowStore";
import { useAgentStore } from "../../store/agentStore";
import { useCreditStore } from "../../store/creditStore";
import { useAuthStore } from "../../store/authStore";
import { getModelCreditCost, useModelCreditStore } from "../../store/modelCreditStore";

function downloadAsset(url: string, id: string) {
  const link = document.createElement("a");
  link.href = url;
  link.download = `flow-${id}.png`;
  link.click();
}

const IMAGE_JOB_MISSING_GRACE_MS = 120_000;
const IMAGE_JOB_MISSING_ERROR_MESSAGE = "历史图片任务不存在，请重新生成。";

function isRenderableImageUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/uploads/") || /^https?:\/\//i.test(url) || /^data:image\//i.test(url) || /^blob:/i.test(url);
}

function isRecoverableImageError(saveError?: string) {
  return saveError === IMAGE_JOB_MISSING_ERROR_MESSAGE || saveError === IMAGE_GENERATION_TIMEOUT_MESSAGE;
}

export default function FlowWorkspace() {
  const navigate = useNavigate();
  const { projectId, itemId } = useParams();
  const { projects, items, addItem, updateItem, hasHydrated } = useFlowStore();
  const { spendCredits, refundCredits } = useCreditStore();
  const { currentUserId } = useAuthStore();
  const { rules: modelCreditRules } = useModelCreditStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const { selectedModels, setSelectedModel } = useFlowUiStore();
  const { isSidebarOpen, toggleSidebar } = useAgentStore();

  const [prompt, setPrompt] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2k");
  const [generationCount, setGenerationCount] = useState(1);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [externalReferenceImages, setExternalReferenceImages] = useState<string[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<Record<string, FlowReferenceRole>>({});
  const [openGeneratorPanel, setOpenGeneratorPanel] = useState<"type" | "model" | "ratio" | "count" | "assets" | "styles" | null>(null);
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyleReference | null>(null);
  const [promptExpanded, setPromptExpanded] = useState(false);
  const [now, setNow] = useState(() => Date.now());

  const generatorRef = useRef<HTMLDivElement>(null);

  const currentProject = useMemo(
    () => projects.find((project) => project.id === projectId) ?? null,
    [projectId, projects]
  );

  const currentItem = useMemo(
    () => items.find((item) => item.id === itemId && item.projectId === projectId && item.type === "image") ?? null,
    [itemId, items, projectId]
  );

  const rootId = useMemo(() => {
    if (!currentItem) return null;
    return currentItem.editRootId ?? currentItem.id;
  }, [currentItem]);

  const historyItems = useMemo(() => {
    if (!rootId) return [];
    return items
      .filter((item) => item.type === "image" && (item.editRootId ?? item.id) === rootId)
      .sort((a, b) => a.createdAt - b.createdAt);
  }, [items, rootId]);

  const imageModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "image", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "image", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const model = selectedModels.image;
  const ratioOptions = IMAGE_RATIO_OPTIONS;
  const ratioValues = ratioOptions.map((option) => option.value);
  const selectedModelOption = imageModelOptions.find((option) => option.value === model);
  const isCustomModel = selectedModelOption?.source === "custom";
  const estimatedCreditsPerItem = model
    ? getModelCreditCost({
        rules: modelCreditRules,
        modelValue: model,
        type: "image",
        resolution,
      })
    : undefined;
  const estimatedCredits = estimatedCreditsPerItem !== undefined ? estimatedCreditsPerItem * generationCount : undefined;
  const canGenerate = (!!prompt.trim() || referenceImages.length > 0) && !!model;

  useEffect(() => {
    if (!hasHydrated) return;
    if (!projects.length) {
      navigate("/projects", { replace: true });
      return;
    }

    if (!currentProject) {
      navigate("/projects", { replace: true });
      return;
    }

    if (!currentItem) {
      navigate(`/projects/${currentProject.id}`, { replace: true });
      return;
    }

    if (currentItem.projectId !== currentProject.id) {
      navigate("/projects", { replace: true });
    }
  }, [currentItem, currentProject, hasHydrated, navigate, projects.length]);

  useEffect(() => {
    if (!hasHydrated || !currentItem) return;

    const failTimedOutImage = () => {
      if (!isImageGenerationTimedOut(currentItem)) return;
      updateItem(currentItem.id, { status: "error", progress: undefined, saveError: IMAGE_GENERATION_TIMEOUT_MESSAGE });
    };

    failTimedOutImage();
    const interval = window.setInterval(failTimedOutImage, 1000);
    return () => window.clearInterval(interval);
  }, [currentItem, hasHydrated, updateItem]);

  useEffect(() => {
    if (currentItem?.status !== "generating") return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [currentItem?.id, currentItem?.status]);

  useEffect(() => {
    if (!currentItem) return;
    let cancelled = false;

    const loadReferenceImages = async () => {
      const localReferenceUrl =
        currentItem.url && currentItem.savedFileName
          ? await getDataUrlFromPersistedAssetFile(currentItem.id).catch(() => null)
          : null;
      const currentImageReference = currentItem.url
        ? [await resolveReferenceImageDataUrl(localReferenceUrl ?? currentItem.url)]
        : [];
      const inheritedSourceReferences = currentItem.referenceImages?.length
        ? currentItem.referenceImages
        : currentItem.referenceImage
          ? [currentItem.referenceImage]
          : [];
      const inheritedReferences = await resolveReferenceImageDataUrls(inheritedSourceReferences);

      if (cancelled) return;
      setPrompt("");
      setAspectRatio(currentItem.parameters.aspectRatio || "16:9");
      setResolution(currentItem.parameters.resolution || "2k");
      const nextReferences = currentImageReference.length ? currentImageReference : inheritedReferences;
      setReferenceImages(nextReferences);
      setExternalReferenceImages(nextReferences);
      setReferenceImageRoles(() => {
        if (currentImageReference.length) return {};
        const nextRoles: Record<string, FlowReferenceRole> = {};
        inheritedReferences.forEach((image, index) => {
          const source = inheritedSourceReferences[index];
          nextRoles[image] = source ? currentItem.referenceImageRoles?.[source] ?? "general" : "general";
        });
        return nextRoles;
      });
      setSelectedStyle(null);
    };

    void loadReferenceImages();
    return () => {
      cancelled = true;
    };
  }, [currentItem]);

  useEffect(() => {
    const preferredModel = getPreferredModelValue(imageModelOptions);
    if (model && imageModelOptions.some((option) => option.value === model)) return;
    setSelectedModel("image", preferredModel);
  }, [imageModelOptions, model, setSelectedModel]);

  useEffect(() => {
    if (ratioValues.includes(aspectRatio)) return;
    setAspectRatio(ratioValues[0] ?? "16:9");
  }, [aspectRatio, ratioValues]);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!generatorRef.current?.contains(target)) {
        setOpenGeneratorPanel(null);
      }
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  useEffect(() => {
    const shouldRecoverMissingJobError =
      currentItem?.status === "error" && isRecoverableImageError(currentItem.saveError) && !currentItem.url;
    if (!hasHydrated || !currentItem || currentItem.url || (currentItem.status !== "generating" && !shouldRecoverMissingJobError)) return;
    let cancelled = false;
    const recover = async () => {
      try {
        const url = await recoverGeneratedImageAsset(currentItem.id);
        if (!cancelled && url === MISSING_IMAGE_JOB_STATUS && Date.now() - currentItem.createdAt >= IMAGE_JOB_MISSING_GRACE_MS) {
          updateItem(currentItem.id, { status: "error", progress: undefined, saveError: IMAGE_JOB_MISSING_ERROR_MESSAGE });
        } else if (!cancelled && url && isRenderableImageUrl(url)) {
          updateItem(currentItem.id, { status: "completed", url, progress: 100, saveError: undefined });
        } else if (!cancelled && url && localStorage.getItem("media-debug") === "1") {
          console.log("[media-debug] ignore non-renderable workspace recovery url", { id: currentItem.id, url });
        }
      } catch (error) {
        if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image recovery failed", { id: currentItem.id, error });
        if (!cancelled && currentItem.status === "generating") {
          updateItem(currentItem.id, {
            status: "error",
            progress: undefined,
            saveError: error instanceof Error ? error.message : String(error),
          });
        }
      }
    };

    void recover();
    const interval = window.setInterval(() => void recover(), 3000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [currentItem, hasHydrated, updateItem]);

  const handleReusePrompt = async () => {
    if (!currentItem) return;
    const localReferenceUrl =
      currentItem.url && currentItem.savedFileName
        ? await getDataUrlFromPersistedAssetFile(currentItem.id).catch(() => null)
        : null;
    const currentImageReference = currentItem.url
      ? [await resolveReferenceImageDataUrl(localReferenceUrl ?? currentItem.url)]
      : [];
    const inheritedSourceReferences = currentItem.referenceImages?.length
      ? currentItem.referenceImages
      : currentItem.referenceImage
        ? [currentItem.referenceImage]
        : [];
    const inheritedReferences = await resolveReferenceImageDataUrls(inheritedSourceReferences);
    setPrompt(currentItem.prompt ?? "");
    setAspectRatio(currentItem.parameters.aspectRatio || "16:9");
    setResolution(currentItem.parameters.resolution || "2k");
    const nextReferences = currentImageReference.length ? currentImageReference : inheritedReferences;
    setReferenceImages(nextReferences);
    setExternalReferenceImages(nextReferences);
    setReferenceImageRoles(() => {
      if (currentImageReference.length) return {};
      const nextRoles: Record<string, FlowReferenceRole> = {};
      inheritedReferences.forEach((image, index) => {
        const source = inheritedSourceReferences[index];
        nextRoles[image] = source ? currentItem.referenceImageRoles?.[source] ?? "general" : "general";
      });
      return nextRoles;
    });
    setSelectedStyle(null);
  };

  const handleGenerate = async () => {
    if (!currentItem || !currentProject || (!prompt.trim() && referenceImages.length === 0) || !model) return;
    if (!isCustomModel && !currentUserId) {
      alert("请先登录后再生成内容。");
      navigate("/auth");
      return;
    }

    const modelLabel = selectedModelOption?.label ?? model;
    const creditCost = getModelCreditCost({
      rules: modelCreditRules,
      modelValue: model,
      type: "image",
      resolution,
    });
    const sourceReferenceImages = await resolveReferenceImageDataUrls(referenceImages);
    const sourceReference = sourceReferenceImages[0];
    const sourceReferenceRoles = sourceReferenceImages.map((image, index) => referenceImageRoles[referenceImages[index]] ?? referenceImageRoles[image] ?? "general");
    const itemStyle = selectedStyle;
    const itemStyleImages = itemStyle?.imageUrl ? [itemStyle.imageUrl] : [];
    const count = Math.min(4, Math.max(1, generationCount));
    const promptText = prompt.trim();
    let firstId: string | null = null;
    const tasks: Array<Promise<void>> = [];

    for (let index = 0; index < count; index += 1) {
      const id = addItem({
        projectId: currentProject.id,
        type: "image",
        prompt: promptText,
        status: "generating",
        parameters: {
          model: modelLabel,
          modelValue: model,
          aspectRatio,
          resolution,
        },
        referenceImage: sourceReference,
        referenceImages: sourceReferenceImages.length > 0 ? sourceReferenceImages : undefined,
        referenceImageRoles: sourceReferenceImages.length > 0
          ? Object.fromEntries(sourceReferenceImages.map((image, index) => [image, sourceReferenceRoles[index]]))
          : undefined,
        styleReference: itemStyle ?? undefined,
        styleReferenceImages: itemStyleImages.length > 0 ? itemStyleImages : undefined,
        editSourceId: currentItem.id,
        editRootId: rootId ?? currentItem.id,
      });

      firstId ??= id;

      if (!isCustomModel && currentUserId) {
        const spendResult = spendCredits({ userId: currentUserId, amount: creditCost, generationTaskId: id, note: `生成图片：${modelLabel}` });
        if (!spendResult.ok) {
          updateItem(id, { status: "error", saveError: spendResult.message });
          alert(spendResult.message);
          break;
        }
      }

      tasks.push((async () => {
        try {
          const url = await generateImageAsset({
            modelId: model,
            prompt: promptText,
            referenceImageUrl: sourceReference ?? undefined,
            referenceImageUrls: sourceReferenceImages,
            referenceImageRoles: sourceReferenceRoles,
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
          if (!isRenderableImageUrl(url)) {
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] workspace image generation returned non-renderable url; waiting for recovery", { id, url });
            return;
          }
          updateItem(id, { status: "completed", url, saveError: undefined });
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] generation failed", error);
          updateItem(id, {
            status: "error",
            saveError: error instanceof Error ? error.message : String(error),
          });
          if (!isCustomModel && currentUserId) {
            refundCredits({ userId: currentUserId, amount: creditCost, generationTaskId: id, note: `生成失败返还：${modelLabel}` });
          }
        }
      })());
    }

    if (firstId) navigate(`/projects/${currentProject.id}/works/${firstId}`);
    setOpenGeneratorPanel(null);

    await Promise.allSettled(tasks);
  };

  if (!hasHydrated || !currentItem) return null;

  const imageDimensions = (() => {
    const [width = "1440", height = "2560"] = getImageSizeFromPreset(aspectRatio, resolution).split("x");
    return { width, height };
  })();
  const currentReferenceImages =
    currentItem.referenceImages?.length ? currentItem.referenceImages : currentItem.referenceImage ? [currentItem.referenceImage] : [];
  const currentStyleImages = currentItem.styleReferenceImages ?? (currentItem.styleReference?.imageUrl ? [currentItem.styleReference.imageUrl] : []);

  return (
    <div className="relative -m-3 flex h-[calc(100%+88px)] flex-col overflow-hidden bg-[#08090d] text-white md:-m-8 md:h-[calc(100%+4rem)]">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#08090d] px-3 md:px-4">
        <div className="flex min-w-0 items-center gap-2 md:gap-3">
          <button
            type="button"
            onClick={() => navigate(currentProject ? `/projects/${currentProject.id}` : "/projects")}
            className="flex h-9 w-9 items-center justify-center rounded-full text-[#9aa3b7] transition hover:bg-white/[0.06] hover:text-white"
          >
            <ArrowLeft className="h-4.5 w-4.5" />
          </button>

          <div className="min-w-0">
            <div className="truncate text-sm font-medium text-[#f3f5fb]">作品详情</div>
            <div className="hidden truncate text-xs text-[#7f8798] sm:block">{getFlowItemDisplayName(currentItem.prompt)}</div>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 md:gap-2">
          {currentItem.url ? (
            <button
              type="button"
              onClick={() => downloadAsset(currentItem.url!, currentItem.id)}
              className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-sm text-[#d5d9e2] transition hover:border-white/[0.12] hover:text-white"
            >
              <Download className="h-4 w-4" />
              <span className="hidden sm:inline">下载</span>
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => toggleSidebar()}
            className={cn(
              "flex items-center gap-2 rounded-xl border px-3 py-2 text-sm transition",
              isSidebarOpen
                ? "border-cyan-400/30 bg-cyan-400/10 text-white"
                : "border-white/[0.06] bg-white/[0.03] text-[#d5d9e2] hover:border-white/[0.12] hover:text-white"
            )}
            aria-label="展开智能体面板"
          >
            <Bot className="h-4 w-4" />
            <span className="hidden sm:inline">Agent</span>
          </button>

          <button
            type="button"
            onClick={() => navigate(currentProject ? `/projects/${currentProject.id}` : "/projects")}
            className="flex items-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-3 py-2 text-sm text-white transition hover:border-emerald-400/30 hover:bg-emerald-400/15"
          >
            <Check className="h-4 w-4" />
            <span className="hidden sm:inline">完成</span>
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <section className="relative flex min-w-0 flex-1 flex-col bg-[#08090d]">
          <div className="min-h-0 flex-1 overflow-hidden px-3 pb-[238px] pt-3 md:px-8 md:pb-[228px] md:pt-5">
            <div className="flex h-full min-h-0 w-full gap-6 xl:gap-8">
              <div className="flex min-h-0 min-w-0 flex-1 items-center justify-center p-0 md:p-2">
                <div className="relative flex h-full min-h-0 w-full items-center justify-center overflow-hidden">
                  {currentItem.status === "generating" ? (
                    <div className="flex flex-col items-center gap-3 text-[#9aa3b7]">
                      <Loader2 className="h-8 w-8 animate-spin" />
                      <span className="text-sm">
                        正在生成新的结果 {formatElapsedTime(getGenerationElapsedMs(currentItem, now))} / {IMAGE_GENERATION_TIMEOUT_LABEL}
                      </span>
                    </div>
                  ) : currentItem.status === "error" ? (
                    <div className="max-w-md rounded-2xl border border-red-400/20 bg-red-500/10 px-5 py-4 text-center text-sm text-red-100">
                      {currentItem.saveError || "生成失败，请调整描述后重试。"}
                    </div>
                  ) : currentItem.url ? (
                    <LocalAssetImage itemId={currentItem.id} src={currentItem.url} alt={currentItem.prompt || "作品大图"} className="h-full w-full object-contain" />
                  ) : (
                    <div className="flex flex-col items-center gap-3 text-[#7a8295]">
                      <ImageIcon className="h-8 w-8" />
                      <span className="text-sm">等待图片加载</span>
                    </div>
                  )}
                </div>
              </div>

              <aside className="hidden min-h-0 w-[360px] shrink-0 flex-col overflow-hidden rounded-[28px] border border-white/[0.06] bg-[#0d0f14]/55 shadow-sm backdrop-blur-md lg:flex xl:w-[380px]">
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-[#7d879b]">作品与历史</div>
                    <span className="shrink-0 text-xs text-[#697286]">{historyItems.length} 条</span>
                  </div>

                  <div className="mt-3 flex items-start gap-3 rounded-[18px] bg-[#0d0f14]/80 p-3 shadow-inner">
                    <div className="h-[68px] w-[68px] shrink-0 overflow-hidden rounded-[16px] bg-[#12151c]">
                      {currentItem.url ? (
                        <LocalAssetImage itemId={currentItem.id} src={currentItem.url} alt={currentItem.prompt || "作品预览"} className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center text-[#7f8798]">
                          <ImageIcon className="h-6 w-6" />
                        </div>
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-2 text-sm font-medium text-white">{getFlowItemDisplayName(currentItem.prompt)}</div>
                      <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-[#9aa3b7]">
                        <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{currentItem.parameters.aspectRatio}</span>
                        {currentItem.parameters.resolution ? (
                          <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{currentItem.parameters.resolution}</span>
                        ) : null}
                      </div>
                      <div className="mt-2 line-clamp-2 text-xs text-[#8b94a7]">{currentItem.parameters.model}</div>
                    </div>
                  </div>

                  <div className="mt-3 flex gap-2">
                    <button
                      type="button"
                      onClick={() => void handleReusePrompt()}
                      className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-3 py-2.5 text-sm text-white transition hover:border-cyan-400/30 hover:bg-cyan-400/15"
                    >
                      <Copy className="h-4 w-4" />
                      复用提示词
                    </button>
                    {currentItem.url ? (
                      <button
                        type="button"
                        onClick={() => downloadAsset(currentItem.url!, currentItem.id)}
                        className="inline-flex shrink-0 items-center justify-center rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2.5 text-sm text-[#d5d9e2] transition hover:border-white/[0.12] hover:text-white"
                      >
                        下载
                      </button>
                    ) : null}
                  </div>

                  <div className="mt-4 border-t border-white/[0.06] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-[#7d879b]">提示词</div>
                      <button
                        type="button"
                        onClick={() => setPromptExpanded((current) => !current)}
                        className="flex items-center gap-2 text-left text-xs text-[#cfd6e2]"
                      >
                        <span>{promptExpanded ? "收起" : "展开"}</span>
                        <ChevronDown className={cn("h-4 w-4 text-[#8f97aa] transition", promptExpanded && "rotate-180")} />
                      </button>
                    </div>
                    <div
                      className={cn(
                        "mt-3 rounded-[16px] border border-white/[0.06] bg-[#0d0f14]/80 p-3 text-sm leading-6 text-[#e4e8f0] shadow-inner",
                        promptExpanded ? "max-h-[180px] overflow-y-auto pr-2" : "max-h-[64px] overflow-hidden"
                      )}
                    >
                      <p className="whitespace-pre-wrap">{currentItem.prompt || "当前作品没有记录提示词。"}</p>
                    </div>
                  </div>

                  {currentReferenceImages.length ? (
                    <div className="mt-4 border-t border-white/[0.06] pt-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-[#7d879b]">参考图</div>
                      <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
                        {currentReferenceImages.map((image, index) => (
                          <div
                            key={`${image}-${index}`}
                            className="shrink-0 overflow-hidden rounded-[12px] border border-white/[0.06] bg-[#0d0f14]"
                          >
                            {isRenderableImageUrl(image) ? (
                              <img src={getDisplayAssetUrl(image)} alt={`参考图 ${index + 1}`} className="h-12 w-12 object-cover" />
                            ) : (
                              <div className="flex h-12 w-12 items-center justify-center text-[#7f8798]">
                                <ImageIcon className="h-5 w-5" />
                              </div>
                            )}
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {currentItem.styleReference ? (
                    <div className="mt-4 border-t border-white/[0.06] pt-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-[#7d879b]">风格参考</div>
                      <div className="mt-3 flex items-center gap-3 rounded-[16px] border border-white/[0.06] bg-[#0d0f14]/80 p-3">
                        {currentStyleImages[0] ? (
                          <img src={getDisplayAssetUrl(currentStyleImages[0])} alt={currentItem.styleReference.name} className="h-12 w-12 rounded-[12px] object-cover" />
                        ) : null}
                        <div className="min-w-0">
                          <div className="truncate text-sm text-white">{currentItem.styleReference.name}</div>
                          <div className="mt-1 text-xs text-[#8f97aa]">只参考色彩、笔触、质感与整体视觉风格</div>
                        </div>
                      </div>
                    </div>
                  ) : null}

                  <div className="mt-4 border-t border-white/[0.06] pt-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <div className="text-sm font-medium text-white">版本历史</div>
                        <div className="mt-1 text-xs text-[#697286]">查看这张图的演变过程</div>
                      </div>
                    </div>

                    <div className="mt-3 space-y-2">
                      {historyItems.map((item, index) => (
                        <button
                          key={item.id}
                          type="button"
                          onClick={() => navigate(`/projects/${item.projectId}/works/${item.id}`)}
                          className={cn(
                            "flex w-full items-center gap-3 rounded-[16px] border p-2 text-left transition",
                            item.id === currentItem.id
                              ? "border-cyan-400/30 bg-cyan-400/10 shadow-[0_0_15px_rgba(34,211,238,0.12)]"
                              : "border-white/[0.06] bg-white/[0.02] hover:border-white/[0.12] hover:bg-white/[0.04]"
                          )}
                        >
                          <div className="h-[54px] w-[86px] shrink-0 overflow-hidden rounded-[12px] bg-[#0d0f14]">
                            {item.url ? (
                              <LocalAssetImage itemId={item.id} src={item.url} alt={item.prompt || "历史图片"} className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center text-[#7f8798]">
                                <Loader2 className="h-4 w-4 animate-spin" />
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="mb-1 flex items-center gap-2">
                              <span className="text-[11px] uppercase tracking-[0.16em] text-[#7d879b]">
                                {index === 0 ? "原图" : `版本 ${index}`}
                              </span>
                              {item.id === currentItem.id ? (
                                <span className="rounded-full bg-cyan-400/15 px-2 py-0.5 text-[10px] text-cyan-200">当前</span>
                              ) : null}
                            </div>
                            <div className="line-clamp-2 text-sm text-white">{getFlowItemDisplayName(item.prompt)}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              </aside>
            </div>
          </div>

          <div className="pointer-events-none absolute inset-x-0 bottom-[72px] z-20 px-3 pb-3 md:bottom-0 md:px-8 md:pb-4 xl:px-12">
            <div className="pointer-events-auto mx-auto w-full max-w-[1320px]">
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
                type="image"
                onTypeChange={() => undefined}
                model={model}
                onModelChange={(value) => setSelectedModel("image", value)}
                aspectRatio={aspectRatio}
                onAspectRatioChange={setAspectRatio}
                resolution={resolution}
                onResolutionChange={setResolution}
                duration="5s"
                onDurationChange={() => undefined}
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
                currentModelOptions={imageModelOptions}
                ratioOptions={ratioOptions}
                durationOptions={VIDEO_DURATION_OPTIONS}
                canGenerate={canGenerate}
                estimatedCredits={estimatedCredits}
                openGeneratorPanel={openGeneratorPanel}
                onOpenGeneratorPanelChange={setOpenGeneratorPanel}
                onGenerate={() => void handleGenerate()}
                projects={projects}
                assets={items}
                currentProjectId={currentProject?.id}
                imageDimensions={imageDimensions}
                promptPlaceholder="你想如何继续修改这张图？"
                hideTypeSelector
              />
            </div>
          </div>
        </section>
        <AgentSidebar mode="inline" />
      </div>
    </div>
  );
}
