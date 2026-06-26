import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronDown,
  FolderPlus,
  Image as ImageIcon,
  Search,
  Video,
} from "lucide-react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { AgentSidebar } from "../../components/agent/AgentSidebar";
import { FlowGeneratorBar, type SelectedStyleReference } from "../flow/FlowGeneratorBar";
import { useFlowUiStore } from "../../store/flowUiStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { useSiteContentStore } from "../../store/siteContentStore";
import { useFlowStore, type FlowItemType, type FlowReferenceRole } from "../../store/flowStore";
import { useDiscoverStore } from "../../store/discoverStore";
import { useCreditStore } from "../../store/creditStore";
import { useAuthStore } from "../../store/authStore";
import { getModelCreditCost, useModelCreditStore } from "../../store/modelCreditStore";
import { buildModelCatalogOptions, getPreferredModelValue } from "../../lib/modelCatalog";
import {
  IMAGE_RATIO_OPTIONS,
  VIDEO_RATIO_OPTIONS,
  buildGeneratorModelOptions,
  getImageSizeFromPreset,
  getVideoDurationOptionsForModel,
} from "../../lib/generatorOptions";
import { generateImageAsset, generateVideoAsset } from "../../services/media";
import { fetchHomeFeed, reportCollectionImageBroken, type CollectionWork } from "../../services/collection";

function padNumber(value: number) {
  return value.toString().padStart(2, "0");
}

function createAutoProjectName(date = new Date()) {
  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1);
  const day = padNumber(date.getDate());
  const hours = padNumber(date.getHours());
  const minutes = padNumber(date.getMinutes());
  const seconds = padNumber(date.getSeconds());
  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
}

function isRenderableAssetUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/uploads/") || /^https?:\/\//i.test(url) || /^data:(?:image|video)\//i.test(url) || /^blob:/i.test(url);
}

export default function LandingHome() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const generatorRef = useRef<HTMLDivElement>(null);
  const feedLoadMoreRef = useRef<HTMLDivElement>(null);
  // 标记当前请求归属哪次拉取，切换导航时旧请求的结果会被丢弃，避免覆盖新分类内容。
  const feedRequestRef = useRef(0);
  const { projects, items, addProject, addItem, updateItem, hasHydrated } = useFlowStore();
  const { spendCredits, refundCredits } = useCreditStore();
  const { currentUserId } = useAuthStore();
  const { rules: modelCreditRules } = useModelCreditStore();
  const { categories, works, hasHydrated: discoverHydrated } = useDiscoverStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const { homeTitle, homeHighlight, homeSubtitle } = useSiteContentStore();
  const { selectedModels, setSelectedModel } = useFlowUiStore();

  const [activeTab, setActiveTab] = useState("");
  const [discoverQuery, setDiscoverQuery] = useState("");
  const [prompt, setPrompt] = useState("");
  const [type, setType] = useState<FlowItemType>("image");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("2k");
  const [duration, setDuration] = useState("10s");
  const [generationCount, setGenerationCount] = useState(1);
  const [referenceImages, setReferenceImages] = useState<string[]>([]);
  const [externalReferenceImages, setExternalReferenceImages] = useState<string[]>([]);
  const [referenceImageRoles, setReferenceImageRoles] = useState<Record<string, FlowReferenceRole>>({});
  const [selectedStyle, setSelectedStyle] = useState<SelectedStyleReference | null>(null);
  const [openGeneratorPanel, setOpenGeneratorPanel] = useState<"type" | "model" | "ratio" | "count" | "assets" | "styles" | null>(null);
  const [showAllProjects, setShowAllProjects] = useState(false);
  const [feedItems, setFeedItems] = useState<CollectionWork[]>([]);
  const [feedCursor, setFeedCursor] = useState<string | undefined>();
  const [feedHasMore, setFeedHasMore] = useState(false);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState("");
  // feedItems 当前对应的分类（数据真正返回后才更新），用于过滤与避免切换时闪烁。
  const [feedCategory, setFeedCategory] = useState("");
  // 累积出现过的采集分类（只增不减），保证切换到某分类后其它导航 Tab 不消失。
  const [knownFeedCategories, setKnownFeedCategories] = useState<Array<{ id: string; name: string }>>([]);

  // 处理做同款功能
  useEffect(() => {
    const remakeId = searchParams.get("remake");
    if (remakeId && discoverHydrated) {
      const work = works.find((w) => w.id === remakeId);
      if (work) {
        setPrompt(work.prompt);
        setAspectRatio(work.aspectRatio);
        setResolution(work.resolution || "2k");
        setType("image");
        setSearchParams({});
        setTimeout(() => {
          generatorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
        }, 100);
      }
    }
    const promptParam = searchParams.get("prompt");
    const ratioParam = searchParams.get("ratio");
    if (promptParam) {
      setPrompt(promptParam);
      if (ratioParam) setAspectRatio(ratioParam);
      setSearchParams({});
      setTimeout(() => {
        generatorRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 100);
    }
  }, [searchParams, works, discoverHydrated, setSearchParams]);

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
  const currentModelOptions = type === "image" ? imageModelOptions : videoModelOptions;
  const ratioOptions = type === "image" ? IMAGE_RATIO_OPTIONS : VIDEO_RATIO_OPTIONS;
  const ratioValues = ratioOptions.map((option) => option.value);
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
  const canGenerate = (!!prompt.trim() || referenceImages.length > 0) && !!model;

  const visibleProjects = currentUserId ? projects : [];
  const visibleItems = currentUserId ? items : [];

  const projectCards = useMemo(() => {
    return [...visibleProjects].sort((a, b) => b.updatedAt - a.updatedAt).map((project) => {
      const projectItems = visibleItems.filter((item) => item.projectId === project.id);
      const latestCover = [...projectItems]
        .filter((item) => item.url || item.thumbnail)
        .sort((a, b) => b.createdAt - a.createdAt)[0];
      return {
        id: project.id,
        name: project.name,
        updatedAt: project.updatedAt,
        imageCount: projectItems.filter((item) => item.type === "image").length,
        videoCount: projectItems.filter((item) => item.type === "video").length,
        workCount: projectItems.length,
        latestCover,
      };
    });
  }, [visibleItems, visibleProjects]);

  const visibleProjectCards = showAllProjects ? projectCards : projectCards.slice(0, 4);
  const hiddenProjectCount = Math.max(0, projectCards.length - 4);
  const titleHighlightIndex = homeTitle.indexOf(" ");
  const titlePrefix = titleHighlightIndex >= 0 ? homeTitle.slice(0, titleHighlightIndex) : homeTitle;
  const titleSuffix = titleHighlightIndex >= 0 ? homeTitle.slice(titleHighlightIndex + 1) : "";
  // 把当前 feed 里出现的分类并入累积列表（只增不减），避免筛选后导航 Tab 消失。
  useEffect(() => {
    if (feedItems.length === 0) return;
    setKnownFeedCategories((current) => {
      const map = new Map(current.map((item) => [item.id, item]));
      let changed = false;
      for (const work of feedItems) {
        if (!map.has(work.categoryId)) {
          map.set(work.categoryId, { id: work.categoryId, name: work.categoryName });
          changed = true;
        }
      }
      return changed ? Array.from(map.values()) : current;
    });
  }, [feedItems]);

  const publicCategories = useMemo(() => {
    const categoryIdsWithWorks = new Set(works.map((work) => work.categoryId));
    const legacyCategories = categories.filter((category) => categoryIdsWithWorks.has(category.id));
    return [...legacyCategories, ...knownFeedCategories.filter((category) => !legacyCategories.some((item) => item.id === category.id))];
  }, [categories, knownFeedCategories, works]);
  const hasPublishedDiscoverContent = works.length > 0 || feedItems.length > 0;

  const visibleCards = useMemo(() => {
    const collectionCards = feedItems.map((work) => ({
      id: work.id,
      categoryId: work.categoryId,
      title: work.title,
      coverUrl: work.coverUrl,
      prompt: work.prompt,
      source: "collection" as const,
      categoryName: work.categoryName,
    }));
    const legacyCards = works.map((work) => ({ ...work, source: "legacy" as const, categoryName: categories.find((category) => category.id === work.categoryId)?.name }));
    const sourceCards = feedItems.length > 0 ? collectionCards : legacyCards;
    // 用 feedCategory（数据已加载的分类）而非 activeTab 过滤：切换分类时旧内容先留着，
    // 等新数据返回再整体替换，避免列表瞬间清空导致塌缩、跳回顶部。
    const effectiveCategory = feedItems.length > 0 ? feedCategory : activeTab;
    const filtered = effectiveCategory
      ? sourceCards.filter((w) => w.categoryId === effectiveCategory)
      : sourceCards;

    const query = discoverQuery.trim().toLowerCase();
    if (!query) return filtered;
    return filtered.filter((work) =>
      `${work.title} ${work.prompt}`.toLowerCase().includes(query)
    );
  }, [activeTab, feedCategory, discoverQuery, feedItems, works, categories]);

  useEffect(() => {
    if (!activeTab) return;
    if (publicCategories.some((category) => category.id === activeTab)) return;
    const timer = window.setTimeout(() => setActiveTab(""), 0);
    return () => window.clearTimeout(timer);
  }, [activeTab, publicCategories]);

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
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const loadFeedPage = async (cursor?: string, categoryId = activeTab) => {
    // 翻页（带 cursor）时若已有请求在跑就跳过；切换分类的首屏加载（无 cursor）必须执行，不能被跳过。
    if (cursor && feedLoading) return;
    const requestId = cursor ? feedRequestRef.current : ++feedRequestRef.current;
    setFeedLoading(true);
    setFeedError("");
    try {
      const page = await fetchHomeFeed({ cursor, limit: 30, categoryId: categoryId || undefined });
      // 请求返回时若已切换到别的分类，丢弃这次结果，避免覆盖。
      if (requestId !== feedRequestRef.current) return;
      setFeedItems((current) => cursor ? [...current, ...page.items.filter((item) => !current.some((existing) => existing.id === item.id))] : page.items);
      if (!cursor) setFeedCategory(categoryId);
      setFeedCursor(page.nextCursor);
      setFeedHasMore(page.hasMore);
    } catch (error) {
      if (requestId !== feedRequestRef.current) return;
      setFeedError(error instanceof Error ? error.message : String(error));
    } finally {
      if (requestId === feedRequestRef.current) setFeedLoading(false);
    }
  };

  useEffect(() => {
    // 不在这里清空 feedItems：清空会让列表高度塌缩、页面跳回顶部。
    // loadFeedPage(无 cursor) 会在新数据到达时整体替换，切换时滚动位置得以保持。
    setFeedCursor(undefined);
    setFeedHasMore(false);
    void loadFeedPage(undefined, activeTab);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeTab]);

  useEffect(() => {
    const target = feedLoadMoreRef.current;
    if (!target) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting)) return;
      if (!feedHasMore || feedLoading || !feedCursor) return;
      void loadFeedPage(feedCursor, activeTab);
    }, { rootMargin: "800px 0px" });
    observer.observe(target);
    return () => observer.disconnect();
  }, [feedCursor, feedHasMore, feedLoading]);

  const handleCollectionImageError = (workId: string) => {
    setFeedItems((current) => current.filter((item) => item.id !== workId));
    void reportCollectionImageBroken(workId);
  };

  const handleGenerate = async () => {
    if ((!prompt.trim() && referenceImages.length === 0) || !model) return;
    if (!isCustomModel && !currentUserId) {
      alert("请先登录后再生成内容。");
      navigate("/auth");
      return;
    }

    const now = new Date();
    const projectId = addProject({ name: createAutoProjectName(now) });
    const itemPrompt = prompt.trim();
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

    setPrompt("");
    setReferenceImages([]);
    setReferenceImageRoles({});
    setOpenGeneratorPanel(null);
    navigate(`/projects/${projectId}`);

    const tasks: Array<Promise<void>> = [];
    for (let index = 0; index < count; index += 1) {
      const itemId = addItem({
        projectId,
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

      if (!isCustomModel && currentUserId) {
        const spendResult = spendCredits({
          userId: currentUserId,
          amount: creditCost,
          generationTaskId: itemId,
          note: `生成${itemType === "image" ? "图片" : "视频"}：${modelLabel}`,
        });
        if (!spendResult.ok) {
          updateItem(itemId, { status: "error", saveError: spendResult.message });
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
              clientTaskId: itemId,
            });
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation completed", { itemId, url });
            if (!isRenderableAssetUrl(url)) {
              if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] image generation returned non-renderable url; waiting for recovery", { itemId, url });
              return;
            }
            updateItem(itemId, { status: "completed", url });
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
            clientTaskId: itemId,
            onProgress: (progress) => updateItem(itemId, { progress: Math.round(progress) }),
          });
          if (!isRenderableAssetUrl(url)) {
            if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] video generation returned non-renderable url; waiting for recovery", { itemId, url });
            return;
          }
          updateItem(itemId, { status: "completed", url, progress: 100 });
        } catch (error) {
          if (localStorage.getItem("media-debug") === "1") console.log("[media-debug] generation failed", error);
          updateItem(itemId, {
            status: "error",
            url: undefined,
            progress: undefined,
            saveError: error instanceof Error ? error.message : String(error),
          });
          if (!isCustomModel && currentUserId) {
            refundCredits({ userId: currentUserId, amount: creditCost, generationTaskId: itemId, note: `生成失败返还：${modelLabel}` });
          }
        }
      })());
    }

    await Promise.allSettled(tasks);
  };

  if (!hasHydrated) return null;

  return (
    <div className="relative -m-6 flex h-[calc(100%+3rem)] overflow-hidden bg-[#08090d] text-white md:-m-8 md:h-[calc(100%+4rem)]">
      <div className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden">
        <div className="mx-auto max-w-[1920px] px-3 pb-24 pt-6 sm:px-4 md:px-12 md:pb-32 md:pt-16">
          <section className="px-2 text-center">
            <div className="text-[28px] leading-tight font-bold tracking-tight text-white sm:text-[32px] md:text-[56px] drop-shadow-2xl break-words">
              {titleHighlightIndex >= 0 ? (
                <>
                  {titlePrefix} <span className="text-[#10c8ff]">{homeHighlight}</span> {titleSuffix}
                </>
              ) : (
                homeTitle
              )}
            </div>
            <p className="mx-auto mt-4 max-w-[800px] text-sm leading-relaxed text-white/60 sm:text-base md:text-lg px-2">{homeSubtitle}</p>

            <div className="pointer-events-auto mx-auto mt-12 w-full max-w-[1200px]">
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
                estimatedCredits={estimatedCredits}
                openGeneratorPanel={openGeneratorPanel}
                onOpenGeneratorPanelChange={setOpenGeneratorPanel}
                onGenerate={() => void handleGenerate()}
                projects={visibleProjects}
                assets={visibleItems}
                imageDimensions={(() => {
                  if (type === "video") {
                    const height = resolution === "1080p" ? "1080" : "720";
                    return aspectRatio === "9:16" ? { width: height, height: resolution === "1080p" ? "1920" : "1280" } : { width: resolution === "1080p" ? "1920" : "1280", height };
                  }
                  const [width = "1440", height = "2560"] = getImageSizeFromPreset(aspectRatio, resolution).split("x");
                  return { width, height };
                })()}
                promptPlaceholder=""
                variant="home"
              />
            </div>

          <div className="mx-auto mt-12 max-w-[1536px] text-left px-2">
            <div className="mb-4 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 px-1">
              <div className="w-full sm:w-auto">
                <div className="text-sm font-medium text-white">最近项目</div>
                <div className="mt-1 text-xs text-[#7f8796]">首页生成内容会自动以当前时间创建项目。</div>
              </div>
              {hiddenProjectCount > 0 ? (
                <button
                  type="button"
                  onClick={() => setShowAllProjects((current) => !current)}
                  className="inline-flex items-center gap-2 rounded-full border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-xs text-[#cfd6e2] transition hover:border-white/[0.14] hover:text-white whitespace-nowrap"
                >
                  <span>{showAllProjects ? "收起项目" : `展开其余 ${hiddenProjectCount} 个项目`}</span>
                  <ChevronDown className={`h-3.5 w-3.5 transition ${showAllProjects ? "rotate-180" : ""}`} />
                </button>
              ) : null}
            </div>

            {projectCards.length === 0 ? (
              <div className="flex min-h-[180px] items-center gap-4 rounded-[28px] border border-dashed border-white/[0.08] bg-[#15171c] px-6">
                <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl bg-white/[0.05] text-[#8d96a8]">
                  <FolderPlus className="h-6 w-6" />
                </div>
                <div>
                  <div className="text-lg font-semibold text-white">暂无项目</div>
                  <div className="mt-1 text-sm text-[#71798a]">直接在下方生成内容，系统会自动创建以当前时间命名的项目。</div>
                </div>
              </div>
            ) : (
              <div className="grid gap-4 sm:gap-6 grid-cols-1 sm:grid-cols-2 lg:grid-cols-4">
                {visibleProjectCards.map((project) => (
                  <button
                    key={project.id}
                    type="button"
                    onClick={() => navigate(`/projects/${project.id}`)}
                    className="group overflow-hidden rounded-[32px] border border-white/10 bg-[#17191f] text-left transition duration-500 hover:-translate-y-1 hover:border-white/20 hover:bg-[#1b1e26] hover:shadow-[0_20px_40px_rgba(0,0,0,0.4)]"
                  >
                    <div className="relative aspect-[16/10] overflow-hidden bg-[#10141d]">
                      {project.latestCover?.type === "image" && project.latestCover.url ? (
                        <LocalAssetImage
                          itemId={project.latestCover.id}
                          src={project.latestCover.url}
                          alt={project.name}
                          className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                        />
                      ) : project.latestCover?.type === "video" && (project.latestCover.thumbnail || project.latestCover.url) ? (
                        <div className="relative h-full w-full">
                          <LocalAssetImage
                            itemId={project.latestCover.id}
                            src={project.latestCover.thumbnail || project.latestCover.url}
                            alt={project.name}
                            className="h-full w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                          />
                          <div className="absolute right-4 top-4 flex h-10 w-10 items-center justify-center rounded-full bg-black/40 text-white backdrop-blur-sm">
                            <Video className="h-4 w-4" />
                          </div>
                        </div>
                      ) : (
                        <div className="flex h-full items-center justify-center bg-[radial-gradient(circle_at_top,#1a2437,transparent_60%)]">
                          <FolderPlus className="h-10 w-10 text-[#5f6b85]" />
                        </div>
                      )}

                      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/78 via-black/24 to-transparent px-3 pb-3 pt-12 sm:px-4 sm:pb-4">
                        <div className="truncate text-sm sm:text-base font-semibold text-white">{project.name}</div>
                        <div className="mt-1 text-[10px] sm:text-xs text-white/70 truncate">
                          最近更新 {new Date(project.updatedAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 px-4 py-3 text-[11px] text-[#9ca5b5]">
                      <span className="rounded-full bg-white/[0.04] px-2.5 py-1">{project.workCount} 个作品</span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1">
                        <ImageIcon className="h-3.5 w-3.5" />
                        {project.imageCount}
                      </span>
                      <span className="inline-flex items-center gap-1 rounded-full bg-white/[0.04] px-2.5 py-1">
                        <Video className="h-3.5 w-3.5" />
                        {project.videoCount}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </section>

        {hasPublishedDiscoverContent ? (
        <section className="mt-12 mx-auto max-w-[2304px] px-2">
          <div className="mx-auto flex max-w-[1536px] flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="flex items-center gap-2 overflow-x-auto pb-2 scrollbar-hide">
              {publicCategories.length > 0 ? (
                <>
                  <button
                    type="button"
                    onClick={() => setActiveTab("")}
                    className={`rounded-xl px-4 py-2 text-sm md:text-base font-medium transition whitespace-nowrap ${
                      activeTab === "" ? "bg-white/10 text-white" : "text-[#7f8796] hover:bg-white/5 hover:text-white"
                    }`}
                  >
                    全部
                  </button>
                  {publicCategories.map((cat) => (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setActiveTab(cat.id)}
                      className={`rounded-xl px-4 py-2 text-sm md:text-base font-medium transition whitespace-nowrap ${
                        activeTab === cat.id ? "bg-white/10 text-white" : "text-[#7f8796] hover:bg-white/5 hover:text-white"
                      }`}
                    >
                      {cat.name}
                    </button>
                  ))}
                </>
              ) : null}
            </div>

            <label className="flex h-12 w-full md:max-w-[360px] items-center gap-3 rounded-xl border border-white/10 bg-[#12141a] px-4 transition focus-within:border-white/20 focus-within:bg-[#16181f]">
              <Search className="h-4 w-4 text-[#677083]" />
              <input
                value={discoverQuery}
                onChange={(event) => setDiscoverQuery(event.target.value)}
                placeholder="搜索作品"
                className="w-full border-0 bg-transparent text-sm text-white outline-none placeholder:text-[#677083]"
              />
            </label>
          </div>

          <div className="mt-8 columns-2 gap-6 sm:columns-3 lg:columns-4 xl:columns-5 2xl:columns-6">
            {visibleCards.map((work) => {
              const category = categories.find((c) => c.id === work.categoryId);
              return (
                <article
                  key={work.id}
                  onClick={() => navigate(work.source === "collection" ? `/discover/${work.id}?source=collection` : `/discover/${work.id}`)}
                  className="group mb-6 break-inside-avoid cursor-pointer overflow-hidden rounded-[24px] border border-white/10 bg-[#17191f] shadow-[0_20px_60px_rgba(0,0,0,0.4)] transition duration-500 hover:-translate-y-2 hover:border-white/20 hover:shadow-[0_30px_80px_rgba(0,0,0,0.6)]"
                >
                  <div className="relative aspect-[4/5] overflow-hidden">
                    <img
                      src={work.coverUrl}
                      alt={work.title}
                      loading="lazy"
                      onError={() => {
                        if (work.source === "collection") handleCollectionImageError(work.id);
                      }}
                      className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/80 via-black/20 to-transparent" />

                    <div className="absolute left-3 top-3 sm:left-4 sm:top-4">
                      <span className="rounded-full border border-white/10 bg-black/40 px-2.5 py-1 sm:px-3 sm:py-1.5 text-[10px] sm:text-xs font-medium text-white/90 backdrop-blur-md">
                        {category?.name || work.categoryName || "未分类"}
                      </span>
                    </div>

                    <div className="absolute inset-x-0 bottom-0 p-4 sm:p-5">
                      <div className="text-lg sm:text-xl font-bold tracking-wide text-white line-clamp-2">{work.title}</div>
                      <p className="mt-2 line-clamp-2 text-xs sm:text-sm leading-relaxed text-white/70">{work.prompt}</p>
                    </div>
                  </div>
                </article>
              );
            })}
          </div>

          {feedItems.length > 0 ? (
            <div ref={feedLoadMoreRef} className="flex min-h-16 items-center justify-center py-6 text-sm text-[#7f8796]">
              {feedLoading ? "加载更多作品中..." : feedHasMore ? "继续下滑加载更多" : "已经到底了"}
            </div>
          ) : null}

          {feedError ? (
            <div className="mt-4 rounded-2xl border border-yellow-400/20 bg-yellow-500/10 p-4 text-sm text-yellow-100">
              推荐流加载失败：{feedError}
            </div>
          ) : null}

          {visibleCards.length === 0 && (
            <div className="mt-8 rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-12 text-center text-[#8f97aa]">
              <p>没有找到相关作品</p>
            </div>
          )}
        </section>
        ) : null}
        </div>
      </div>
      <AgentSidebar mode="inline" />
    </div>
  );
}
