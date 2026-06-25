import { useEffect, useMemo, useState } from "react";
import { Check, Edit3, Play, Plus, RefreshCw, Star, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { buildModelCatalogOptions, getPreferredModelValue } from "../../lib/modelCatalog";
import { IMAGE_RATIO_OPTIONS, IMAGE_RESOLUTION_OPTIONS, buildGeneratorModelOptions, getImageSizeFromPreset } from "../../lib/generatorOptions";
import { parseSourcedProviderModelValue } from "../../lib/providerModels";
import { generateImageAsset } from "../../services/media";
import { useSettingsStore, type ProviderConfig } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import {
  batchCollectionWorks,
  clearCollectionRuns,
  createCollectionSource,
  DEFAULT_COLLECTION_CLASSIFIER_SETTINGS,
  DEFAULT_GENERATED_PUBLISH_SETTINGS,
  deleteCollectionRun,
  deleteCollectionSource,
  deleteCollectionWork,
  fetchCivitaiTokenStatus,
  fetchCollectionClassifierSettings,
  fetchGeneratedPublishSettings,
  fetchCollectionRuns,
  fetchCollectionSources,
  fetchCollectionWorks,
  publishCollectionWork,
  publishGeneratedWork,
  rejectCollectionWork,
  runEnabledCollectionSources,
  runCollectionSource,
  updateCivitaiToken,
  updateCollectionClassifierSettings,
  updateGeneratedPublishSettings,
  updateCollectionSource,
  updateCollectionWork,
  type CivitaiTokenStatus,
  type CollectionClassifierSettings,
  type CollectionCategoryConfig,
  type CivitaiPeriod,
  type CivitaiSort,
  type GeneratedPublishSettings,
  type CollectionProvider,
  type CollectionRun,
  type CollectionSource,
  type CollectionWork,
  type CollectionWorkStatus,
} from "../../services/collection";

const statusOptions: Array<{ value: CollectionWorkStatus; label: string }> = [
  { value: "pending", label: "待审核" },
  { value: "published", label: "已发布" },
  { value: "rejected", label: "已拒绝" },
  { value: "broken", label: "已失效" },
];

const civitaiSortOptions: Array<{ value: CivitaiSort; label: string }> = [
  { value: "Most Reactions", label: "最多点赞" },
  { value: "Most Comments", label: "最多评论" },
  { value: "Most Collected", label: "最多收藏" },
  { value: "Newest", label: "最新发布" },
];

const civitaiPeriodOptions: Array<{ value: CivitaiPeriod; label: string }> = [
  { value: "Day", label: "今日" },
  { value: "Week", label: "本周" },
  { value: "Month", label: "本月" },
  { value: "Year", label: "今年" },
  { value: "AllTime", label: "全部时间" },
];

const categoryOptions = [
  { id: "portrait", name: "人像" },
  { id: "character", name: "角色" },
  { id: "scene", name: "场景" },
  { id: "product", name: "产品" },
  { id: "poster", name: "海报" },
  { id: "illustration", name: "插画" },
  { id: "style", name: "风格" },
  { id: "anime", name: "二次元" },
  { id: "cg", name: "3D/CG" },
  { id: "chinese", name: "国风" },
];

type EditDraft = {
  id: string;
  title: string;
  prompt: string;
  negativePrompt: string;
  model: string;
  categoryId: string;
  tags: string;
  displayUrl: string;
  sourcePageUrl: string;
};

function getCategoryName(id: string) {
  return categoryOptions.find((item) => item.id === id)?.name ?? "风格";
}

function createCategoryId(name: string) {
  const slug = name.trim().toLowerCase().replace(/[^a-z0-9\u4e00-\u9fa5]+/g, "-").replace(/^-+|-+$/g, "");
  return slug ? `custom-${slug}` : `custom-${Date.now().toString(36)}`;
}

function keywordsToText(keywords: string[]) {
  return keywords.join(", ");
}

function textToKeywords(value: string) {
  return value.split(/[,，\n]/).map((item) => item.trim()).filter(Boolean);
}

function createDraft(work: CollectionWork): EditDraft {
  return {
    id: work.id,
    title: work.title,
    prompt: work.prompt,
    negativePrompt: work.negativePrompt ?? "",
    model: work.model ?? "",
    categoryId: work.categoryId,
    tags: work.tags.join(", "),
    displayUrl: work.displayUrl,
    sourcePageUrl: work.sourcePageUrl ?? "",
  };
}

function isRenderableAssetUrl(url?: string) {
  if (!url) return false;
  return url.startsWith("/uploads/") || /^https?:\/\//i.test(url) || /^data:(?:image|video)\//i.test(url) || /^blob:/i.test(url);
}

export default function AdminCollection() {
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const [sources, setSources] = useState<CollectionSource[]>([]);
  const [runs, setRuns] = useState<CollectionRun[]>([]);
  const [works, setWorks] = useState<CollectionWork[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [status, setStatus] = useState<CollectionWorkStatus>("pending");
  const [provider, setProvider] = useState<CollectionProvider>("civitai");
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<CivitaiSort>("Most Reactions");
  const [period, setPeriod] = useState<CivitaiPeriod>("Month");
  const [targetCategoryId, setTargetCategoryId] = useState("style");
  const [maxItemsPerRun, setMaxItemsPerRun] = useState(30);
  const [scheduleEveryHours, setScheduleEveryHours] = useState(0);
  const [autoPublish, setAutoPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [classifierSettings, setClassifierSettings] = useState<CollectionClassifierSettings>(DEFAULT_COLLECTION_CLASSIFIER_SETTINGS);
  const [generatedSettings, setGeneratedSettings] = useState<GeneratedPublishSettings>(DEFAULT_GENERATED_PUBLISH_SETTINGS);
  const [adminPrompt, setAdminPrompt] = useState("");
  const [adminModel, setAdminModel] = useState("");
  const [adminAspectRatio, setAdminAspectRatio] = useState("1:1");
  const [adminResolution, setAdminResolution] = useState("2k");
  const [adminCategoryId, setAdminCategoryId] = useState(DEFAULT_GENERATED_PUBLISH_SETTINGS.defaultCategoryId);
  const [adminPublishStatus, setAdminPublishStatus] = useState<"published" | "pending">("published");
  const [adminGenerating, setAdminGenerating] = useState(false);
  const [adminGeneratedUrl, setAdminGeneratedUrl] = useState("");
  const [editing, setEditing] = useState<EditDraft | null>(null);
  const [civitaiToken, setCivitaiToken] = useState<CivitaiTokenStatus>({ configured: false, hint: "" });
  const [civitaiTokenInput, setCivitaiTokenInput] = useState("");
  const [activeTab, setActiveTab] = useState<"config" | "review">("config");
  const [pageCursors, setPageCursors] = useState<(string | undefined)[]>([undefined]);
  const [pageIndex, setPageIndex] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [nextCursor, setNextCursor] = useState<string | undefined>(undefined);

  const selectedCount = selectedIds.length;
  const allCurrentSelected = works.length > 0 && works.every((work) => selectedIds.includes(work.id));

  const sourceById = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);
  const classifierModelOptions = useMemo(
    () => [
      ...buildModelCatalogOptions(providers, routing, "language", "koala"),
      ...buildModelCatalogOptions(userProviders, userRouting, "language", "custom"),
      ...buildModelCatalogOptions(providers, routing, "image", "koala"),
      ...buildModelCatalogOptions(userProviders, userRouting, "image", "custom"),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const adminImageModelOptions = useMemo(
    () => [
      ...buildGeneratorModelOptions(buildModelCatalogOptions(providers, routing, "image", "koala")),
      ...buildGeneratorModelOptions(buildModelCatalogOptions(userProviders, userRouting, "image", "custom")),
    ],
    [providers, routing, userProviders, userRouting]
  );
  const selectedAdminModelOption = adminImageModelOptions.find((option) => option.value === adminModel);

  const loadSources = async () => {
    const data = await fetchCollectionSources();
    setSources(data.sources);
  };

  const loadRuns = async () => {
    const data = await fetchCollectionRuns({ limit: 20 });
    setRuns(data.runs);
  };

  const WORKS_PAGE_SIZE = 24;

  const loadWorks = async (nextStatus = status, cursor?: string) => {
    const page = await fetchCollectionWorks({ status: nextStatus, cursor, limit: WORKS_PAGE_SIZE });
    setWorks(page.items);
    setHasMore(page.hasMore);
    setNextCursor(page.nextCursor);
    setSelectedIds([]);
  };

  // 切换审核状态或执行增删后，回到第一页重新加载，保持分页状态一致。
  const reloadFirstPage = async (nextStatus = status) => {
    setPageCursors([undefined]);
    setPageIndex(0);
    await loadWorks(nextStatus, undefined);
  };

  const handleNextPage = async () => {
    if (!hasMore || !nextCursor) return;
    setLoading(true);
    try {
      const targetIndex = pageIndex + 1;
      setPageCursors((current) => {
        const copy = [...current];
        copy[targetIndex] = nextCursor;
        return copy;
      });
      setPageIndex(targetIndex);
      await loadWorks(status, nextCursor);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handlePrevPage = async () => {
    if (pageIndex === 0) return;
    setLoading(true);
    try {
      const targetIndex = pageIndex - 1;
      setPageIndex(targetIndex);
      await loadWorks(status, pageCursors[targetIndex]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      setPageCursors([undefined]);
      setPageIndex(0);
      await Promise.all([loadSources(), loadWorks(status, undefined), loadRuns()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void fetchCollectionClassifierSettings().then(setClassifierSettings);
    void fetchCivitaiTokenStatus().then(setCivitaiToken);
    void fetchGeneratedPublishSettings().then((settings) => {
      setGeneratedSettings(settings);
      setAdminCategoryId(settings.defaultCategoryId);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (adminModel && adminImageModelOptions.some((option) => option.value === adminModel)) return;
    setAdminModel(getPreferredModelValue(adminImageModelOptions));
  }, [adminImageModelOptions, adminModel]);

  const resolveClassifierProvider = (value: string): { provider: ProviderConfig; modelId: string } | null => {
    const parsed = parseSourcedProviderModelValue(value);
    if (!parsed) return null;
    const providerList = parsed.source === "custom" ? userProviders : providers;
    const provider = providerList.find((item) => item.id === parsed.providerId);
    if (!provider) return null;
    return { provider, modelId: parsed.modelId };
  };

  const handleSaveCivitaiToken = async () => {
    setLoading(true);
    setMessage("");
    try {
      const status = await updateCivitaiToken(civitaiTokenInput.trim());
      setCivitaiToken(status);
      setCivitaiTokenInput("");
      setMessage(status.configured ? "Civitai Token 已保存，采集将能获取提示词。" : "Civitai Token 已清除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveClassifierSettings = async () => {
    setLoading(true);
    setMessage("");
    try {
      const resolved = resolveClassifierProvider(classifierSettings.visionModelValue);
      const saved = await updateCollectionClassifierSettings({
        ...classifierSettings,
        enabled: classifierSettings.enabled && Boolean(resolved),
        modelId: resolved?.modelId ?? "",
        provider: resolved
          ? {
              id: resolved.provider.id,
              name: resolved.provider.name,
              baseUrl: resolved.provider.baseUrl,
              key: resolved.provider.key,
              logAccessToken: resolved.provider.logAccessToken,
            }
          : undefined,
      });
      setClassifierSettings(saved);
      setMessage("视觉分类配置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveGeneratedSettings = async () => {
    setLoading(true);
    setMessage("");
    try {
      const defaultCategory = generatedSettings.categories.find((item) => item.id === generatedSettings.defaultCategoryId);
      const saved = await updateGeneratedPublishSettings({
        ...generatedSettings,
        defaultCategoryName: defaultCategory?.name ?? generatedSettings.defaultCategoryName,
      });
      setGeneratedSettings(saved);
      setMessage("生成作品发布设置已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const updateGeneratedCategory = (id: string, patch: Partial<CollectionCategoryConfig>) => {
    setGeneratedSettings((current) => {
      const categories = current.categories.map((category) => category.id === id ? { ...category, ...patch } : category);
      const defaultCategory = categories.find((category) => category.id === current.defaultCategoryId);
      return { ...current, categories, defaultCategoryName: defaultCategory?.name ?? current.defaultCategoryName };
    });
  };

  const handleAddGeneratedCategory = () => {
    const name = "自定义分类";
    const category: CollectionCategoryConfig = {
      id: createCategoryId(`${name}-${Date.now().toString(36)}`),
      name,
      keywords: [],
      custom: true,
    };
    setGeneratedSettings((current) => ({ ...current, categories: [...current.categories, category] }));
  };

  const handleDeleteGeneratedCategory = (id: string) => {
    setGeneratedSettings((current) => {
      const categories = current.categories.filter((category) => category.id !== id);
      const fallback = categories[0] ?? DEFAULT_GENERATED_PUBLISH_SETTINGS.categories[0];
      return {
        ...current,
        categories,
        defaultCategoryId: current.defaultCategoryId === id ? fallback.id : current.defaultCategoryId,
        defaultCategoryName: current.defaultCategoryId === id ? fallback.name : current.defaultCategoryName,
      };
    });
  };

  const toggleGeneratedMediaType = (mediaType: "image" | "video", checked: boolean) => {
    setGeneratedSettings((current) => {
      const mediaTypes = checked
        ? Array.from(new Set([...current.mediaTypes, mediaType]))
        : current.mediaTypes.filter((item) => item !== mediaType);
      return { ...current, mediaTypes };
    });
  };

  const handleAdminGenerateAndPublish = async () => {
    const prompt = adminPrompt.trim();
    if (!prompt || !adminModel) return;
    const category = generatedSettings.categories.find((item) => item.id === adminCategoryId)
      ?? generatedSettings.categories[0]
      ?? DEFAULT_GENERATED_PUBLISH_SETTINGS.categories[0];
    const itemId = `admin-generated-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setAdminGenerating(true);
    setMessage("");
    try {
      const url = await generateImageAsset({
        modelId: adminModel,
        prompt,
        size: getImageSizeFromPreset(adminAspectRatio, adminResolution),
        ratio: adminAspectRatio === "auto" ? undefined : adminAspectRatio,
        resolution: adminResolution,
        n: 1,
        clientTaskId: itemId,
      });
      if (!isRenderableAssetUrl(url)) {
        throw new Error("生成完成，但返回的图片 URL 无法展示。");
      }
      setAdminGeneratedUrl(url);
      const result = await publishGeneratedWork({
        itemId,
        mediaType: "image",
        url,
        prompt,
        model: selectedAdminModelOption?.label ?? adminModel,
        categoryId: category.id,
        categoryName: category.name,
        status: adminPublishStatus,
        manual: true,
        aspectRatio: adminAspectRatio,
        resolution: adminResolution,
        metadata: {
          modelValue: adminModel,
          entry: "admin-collection-publish",
        },
      });
      setStatus(adminPublishStatus);
      await reloadFirstPage(adminPublishStatus);
      setMessage(result.work ? `作品已生成并${adminPublishStatus === "published" ? "发布" : "加入待审核"}。` : "作品已生成，但未写入作品库。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setAdminGenerating(false);
    }
  };

  const handleCreateSource = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setMessage("");
    try {
      await createCollectionSource({
        provider,
        query: query.trim(),
        sort: provider === "civitai" ? sort : undefined,
        period: provider === "civitai" ? period : undefined,
        targetCategoryId,
        targetCategoryName: getCategoryName(targetCategoryId),
        maxItemsPerRun,
        scheduleEveryHours: scheduleEveryHours > 0 ? scheduleEveryHours : undefined,
        autoPublish,
        filterNsfw: true,
      });
      setQuery("");
      await Promise.all([loadSources(), loadRuns()]);
      setMessage("采集源已创建。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRunEnabled = async () => {
    setLoading(true);
    setMessage("");
    try {
      const result = await runEnabledCollectionSources();
      setPageCursors([undefined]);
      setPageIndex(0);
      await Promise.all([loadSources(), loadWorks(status, undefined), loadRuns()]);
      const succeeded = result.results.filter((item) => item.ok).length;
      const failed = result.results.length - succeeded;
      setMessage(`已执行 ${result.results.length} 个启用采集源，成功 ${succeeded} 个，失败 ${failed} 个。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleSourceEnabled = async (source: CollectionSource) => {
    setLoading(true);
    try {
      await updateCollectionSource(source.id, { enabled: !source.enabled });
      await loadSources();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSourceScheduleChange = async (source: CollectionSource, hours: number) => {
    setLoading(true);
    try {
      await updateCollectionSource(source.id, { scheduleEveryHours: hours > 0 ? hours : undefined });
      await loadSources();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleRun = async (source: CollectionSource) => {
    setLoading(true);
    setMessage("");
    try {
      const result = await runCollectionSource(source.id);
      setPageCursors([undefined]);
      setPageIndex(0);
      await Promise.all([loadSources(), loadWorks(status, undefined), loadRuns()]);
      setMessage(`采集完成：获取 ${result.fetched} 条，新增 ${result.added} 条，跳过 ${result.skipped} 条。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteSource = async (source: CollectionSource) => {
    if (!confirm(`确定删除采集源「${source.name}」？已采集作品不会被删除。`)) return;
    setLoading(true);
    try {
      await deleteCollectionSource(source.id);
      await loadSources();
      setMessage("采集源已删除。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleDeleteRun = async (run: CollectionRun) => {
    setLoading(true);
    try {
      await deleteCollectionRun(run.id);
      await loadRuns();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleClearRuns = async () => {
    if (runs.length === 0) return;
    if (!confirm("确定清空全部采集记录？（运行中的记录会保留）")) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await clearCollectionRuns();
      await loadRuns();
      setMessage(`已清空 ${result.deleted} 条采集记录。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleWorkAction = async (work: CollectionWork, action: "publish" | "reject" | "delete") => {
    setLoading(true);
    try {
      if (action === "publish") await publishCollectionWork(work.id);
      if (action === "reject") await rejectCollectionWork(work.id);
      if (action === "delete") await deleteCollectionWork(work.id);
      await reloadFirstPage();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleToggleFeatured = async (work: CollectionWork) => {
    setLoading(true);
    try {
      await updateCollectionWork(work.id, { featured: !work.featured });
      await reloadFirstPage();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleBatch = async (action: "publish" | "reject" | "delete") => {
    if (selectedIds.length === 0) return;
    if (action === "delete" && !confirm(`确定删除选中的 ${selectedIds.length} 个作品？`)) return;
    setLoading(true);
    setMessage("");
    try {
      const result = await batchCollectionWorks({ ids: selectedIds, action });
      await reloadFirstPage();
      setMessage(`批量操作完成，影响 ${result.affected} 个作品。`);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveEdit = async () => {
    if (!editing) return;
    setLoading(true);
    try {
      await updateCollectionWork(editing.id, {
        title: editing.title.trim(),
        prompt: editing.prompt,
        negativePrompt: editing.negativePrompt,
        model: editing.model.trim(),
        categoryId: editing.categoryId,
        categoryName: getCategoryName(editing.categoryId),
        tags: editing.tags.split(/[,，]/).map((item) => item.trim()).filter(Boolean),
        displayUrl: editing.displayUrl.trim(),
        sourcePageUrl: editing.sourcePageUrl.trim(),
      });
      setEditing(null);
      await reloadFirstPage();
      setMessage("作品已保存。");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id]);
  };

  return (
    <div className="mx-auto max-w-[1500px] p-6 text-white">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">采集管理</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">从 Civitai、Lexica 采集作品 URL，审核后进入首页推荐流。</p>
        </div>
        <Button onClick={() => void refresh()} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="mb-6 flex items-center gap-2 border-b border-white/[0.08]">
        <button
          type="button"
          onClick={() => setActiveTab("config")}
          className={`-mb-px border-b-2 px-4 py-3 text-sm transition ${activeTab === "config" ? "border-cyan-400 text-white" : "border-transparent text-[#8f97aa] hover:text-white"}`}
        >
          采集配置
        </button>
        <button
          type="button"
          onClick={() => {
            setActiveTab("review");
            void reloadFirstPage();
          }}
          className={`-mb-px border-b-2 px-4 py-3 text-sm transition ${activeTab === "review" ? "border-cyan-400 text-white" : "border-transparent text-[#8f97aa] hover:text-white"}`}
        >
          采集内容发布
        </button>
      </div>

      {message ? <div className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-[#cfd6e2]">{message}</div> : null}

      {activeTab === "config" ? (
      <div className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_380px] lg:items-start">
        <div className="min-w-0 space-y-8">
          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
            <div className="mb-5 flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-lg font-medium">管理员生成发布</h2>
                <p className="mt-1 text-sm text-[#8f97aa]">选择分类和发布状态后生成作品，生成成功会复用作品发布入口进入首页内容库。</p>
              </div>
              <span className="rounded-full border border-cyan-300/20 bg-cyan-400/10 px-3 py-1 text-xs text-cyan-100">仅后台管理员</span>
            </div>

            <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_280px]">
              <div className="space-y-4">
                <Textarea
                  value={adminPrompt}
                  onChange={(event) => setAdminPrompt(event.target.value)}
                  placeholder="输入要生成的作品提示词"
                  className="min-h-[116px] border-white/[0.08] bg-white/[0.03] text-white"
                />
                <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                  <select value={adminModel} onChange={(event) => setAdminModel(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    <option value="">选择图片模型</option>
                    {adminImageModelOptions.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select value={adminCategoryId} onChange={(event) => setAdminCategoryId(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    {generatedSettings.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                  <select value={adminAspectRatio} onChange={(event) => setAdminAspectRatio(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    {IMAGE_RATIO_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                  <select value={adminResolution} onChange={(event) => setAdminResolution(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    {IMAGE_RESOLUTION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
                    <input type="radio" checked={adminPublishStatus === "published"} onChange={() => setAdminPublishStatus("published")} />
                    生成后发布
                  </label>
                  <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
                    <input type="radio" checked={adminPublishStatus === "pending"} onChange={() => setAdminPublishStatus("pending")} />
                    生成后待审核
                  </label>
                  <Button onClick={() => void handleAdminGenerateAndPublish()} disabled={adminGenerating || !adminPrompt.trim() || !adminModel} className="bg-cyan-400 text-black hover:bg-cyan-300">
                    {adminGenerating ? "生成中..." : "一键生成"}
                  </Button>
                </div>
              </div>

              <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-white/[0.03]">
                {adminGeneratedUrl ? (
                  <img src={adminGeneratedUrl} alt="管理员生成预览" className="aspect-square w-full object-cover" />
                ) : (
                  <div className="flex aspect-square items-center justify-center px-6 text-center text-sm text-[#8f97aa]">生成后的作品会显示在这里</div>
                )}
                <div className="border-t border-white/[0.06] p-3 text-xs leading-5 text-[#8f97aa]">
                  当前分类：{generatedSettings.categories.find((item) => item.id === adminCategoryId)?.name ?? "未分类"} · {adminPublishStatus === "published" ? "发布到首页" : "进入待审核"}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">Civitai API Token</h2>
                <p className="mt-1 text-sm text-[#8f97aa]">
                  Civitai 对匿名请求隐藏提示词。填入个人 API Token 后，采集才能获取 prompt、负面提示词等参数。
                  {civitaiToken.configured ? ` 当前已配置（${civitaiToken.hint}）。` : " 当前未配置。"}
                </p>
              </div>
            </div>
            <div className="flex flex-wrap gap-3">
              <Input
                value={civitaiTokenInput}
                onChange={(event) => setCivitaiTokenInput(event.target.value)}
                type="password"
                placeholder={civitaiToken.configured ? "输入新 Token 以替换，留空保存则清除" : "粘贴 Civitai API Token"}
                className="min-w-[260px] flex-1 border-white/[0.08] bg-white/[0.03] text-white"
              />
              <Button onClick={() => void handleSaveCivitaiToken()} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
                保存 Token
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
            <h2 className="mb-4 text-lg font-medium">新增采集源</h2>
            <div className="grid gap-4 lg:grid-cols-[140px_1fr_140px_130px_150px_130px]">
              <select value={provider} onChange={(event) => setProvider(event.target.value as CollectionProvider)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                <option value="civitai">Civitai</option>
                <option value="lexica">Lexica</option>
              </select>
              <Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="关键词，例如 ghibli landscape" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <select value={targetCategoryId} onChange={(event) => setTargetCategoryId(event.target.value)} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <Input value={maxItemsPerRun} onChange={(event) => setMaxItemsPerRun(Number(event.target.value) || 30)} type="number" min={1} max={200} className="border-white/[0.08] bg-white/[0.03] text-white" />
              <Input value={scheduleEveryHours} onChange={(event) => setScheduleEveryHours(Number(event.target.value) || 0)} type="number" min={0} max={720} placeholder="间隔小时" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <label className="flex h-11 items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-[#cfd6e2]">
                <input type="checkbox" checked={autoPublish} onChange={(event) => setAutoPublish(event.target.checked)} />
                自动发布
              </label>
            </div>
            {provider === "civitai" ? (
              <div className="mt-4 grid gap-4 sm:grid-cols-2">
                <label className="text-sm text-[#cfd6e2]">
                  <span className="mb-1 block text-xs text-[#8f97aa]">排序方式</span>
                  <select value={sort} onChange={(event) => setSort(event.target.value as CivitaiSort)} className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    {civitaiSortOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
                <label className="text-sm text-[#cfd6e2]">
                  <span className="mb-1 block text-xs text-[#8f97aa]">时间周期</span>
                  <select value={period} onChange={(event) => setPeriod(event.target.value as CivitaiPeriod)} className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                    {civitaiPeriodOptions.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                  </select>
                </label>
              </div>
            ) : null}
            {provider === "civitai" ? (
              <p className="mt-3 text-xs leading-5 text-[#8f97aa]">
                Civitai 已不再支持关键词内容搜索，作品由「排序方式 × 时间周期」决定。关键词仅用于本地分类标记。要让多个采集源拿到不同内容，请为它们选择不同的排序或周期组合。
              </p>
            ) : null}
            <Button onClick={() => void handleCreateSource()} disabled={loading || !query.trim()} className="mt-4 bg-cyan-400 text-black hover:bg-cyan-300">
              <Plus className="mr-2 h-4 w-4" />
              创建采集源
            </Button>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
            <div className="mb-4 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-medium">视觉模型分类</h2>
                <p className="mt-1 text-sm text-[#8f97aa]">开启后，采集作品会先用选中的供应商模型识别分类和标签，失败时自动回退关键词规则。</p>
              </div>
              <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
                <input
                  type="checkbox"
                  checked={classifierSettings.enabled}
                  onChange={(event) => setClassifierSettings((current) => ({ ...current, enabled: event.target.checked }))}
                />
                启用
              </label>
            </div>
            <div className="grid gap-4">
              <select
                value={classifierSettings.visionModelValue}
                onChange={(event) => setClassifierSettings((current) => ({ ...current, visionModelValue: event.target.value }))}
                className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white"
              >
                <option value="">不启用视觉分类</option>
                {classifierModelOptions.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label} · {option.providerName ?? "模型"}
                  </option>
                ))}
              </select>
              <Textarea
                value={classifierSettings.classificationPrompt}
                onChange={(event) => setClassifierSettings((current) => ({ ...current, classificationPrompt: event.target.value }))}
                className="min-h-[96px] border-white/[0.08] bg-white/[0.03] text-white"
              />
              <Button onClick={() => void handleSaveClassifierSettings()} disabled={loading} className="w-fit bg-cyan-400 text-black hover:bg-cyan-300">
                保存视觉分类配置
              </Button>
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
            <div className="mb-5 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
              <div>
                <h2 className="text-lg font-medium">生成作品发布</h2>
                <p className="mt-1 text-sm text-[#8f97aa]">后台或前台生成完成后，按这里的规则自动进入首页推荐流和对应分类。</p>
              </div>
              <div className="flex flex-wrap gap-2">
                <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
                  <input
                    type="checkbox"
                    checked={generatedSettings.enabled}
                    onChange={(event) => setGeneratedSettings((current) => ({ ...current, enabled: event.target.checked }))}
                  />
                  启用
                </label>
                <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
                  <input
                    type="checkbox"
                    checked={generatedSettings.autoPublish}
                    onChange={(event) => setGeneratedSettings((current) => ({ ...current, autoPublish: event.target.checked }))}
                  />
                  自动发布
                </label>
              </div>
            </div>

            <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_260px]">
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-2 text-sm text-[#cfd6e2]">
                    <input
                      type="checkbox"
                      checked={generatedSettings.mediaTypes.includes("image")}
                      onChange={(event) => toggleGeneratedMediaType("image", event.target.checked)}
                    />
                    图片
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[#cfd6e2]">
                    <input
                      type="checkbox"
                      checked={generatedSettings.mediaTypes.includes("video")}
                      onChange={(event) => toggleGeneratedMediaType("video", event.target.checked)}
                    />
                    视频
                  </label>
                  <Button type="button" onClick={handleAddGeneratedCategory} variant="outline" size="sm" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    新增分类
                  </Button>
                </div>

                <div className="space-y-3">
                  {generatedSettings.categories.map((category) => (
                    <div key={category.id} className="grid gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 lg:grid-cols-[180px_minmax(0,1fr)_40px]">
                      <Input
                        value={category.name}
                        onChange={(event) => updateGeneratedCategory(category.id, { name: event.target.value })}
                        placeholder="分类名称"
                        className="border-white/[0.08] bg-white/[0.03] text-white"
                      />
                      <Input
                        value={keywordsToText(category.keywords)}
                        onChange={(event) => updateGeneratedCategory(category.id, { keywords: textToKeywords(event.target.value) })}
                        placeholder="关键词，用逗号分隔"
                        className="border-white/[0.08] bg-white/[0.03] text-white"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        disabled={generatedSettings.categories.length <= 1}
                        onClick={() => handleDeleteGeneratedCategory(category.id)}
                        className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>

              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <label className="text-sm text-[#cfd6e2]">
                  <span className="mb-2 block text-xs text-[#8f97aa]">默认分类</span>
                  <select
                    value={generatedSettings.defaultCategoryId}
                    onChange={(event) => {
                      const category = generatedSettings.categories.find((item) => item.id === event.target.value);
                      setGeneratedSettings((current) => ({
                        ...current,
                        defaultCategoryId: event.target.value,
                        defaultCategoryName: category?.name ?? current.defaultCategoryName,
                      }));
                    }}
                    className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white"
                  >
                    {generatedSettings.categories.map((category) => (
                      <option key={category.id} value={category.id}>{category.name}</option>
                    ))}
                  </select>
                </label>
                <p className="mt-3 text-xs leading-5 text-[#8f97aa]">视觉模型或关键词没有命中时，会放入默认分类。自定义分类会跟作品一起出现在首页分类筛选中。</p>
                <Button onClick={() => void handleSaveGeneratedSettings()} disabled={loading || generatedSettings.mediaTypes.length === 0} className="mt-4 w-full bg-cyan-400 text-black hover:bg-cyan-300">
                  保存发布设置
                </Button>
              </div>
            </div>
          </div>
        </div>

        <aside className="space-y-6 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] lg:overflow-y-auto lg:pr-1">
          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">采集源</h2>
              <Button onClick={() => void handleRunEnabled()} disabled={loading || sources.length === 0} variant="outline" size="sm" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                运行全部
              </Button>
            </div>
            <div className="max-h-[44vh] space-y-3 overflow-y-auto pr-1">
              {sources.map((source) => (
                <div key={source.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="font-medium">{source.name}</div>
                  <div className="mt-1 text-xs leading-5 text-[#8f97aa]">
                    {source.provider} · {source.query} · {source.targetCategoryName || "自动分类"} · 每次 {source.maxItemsPerRun} 条 · {source.autoPublish ? "自动发布" : "待审核"}
                    {source.scheduleEveryHours ? ` · 每 ${source.scheduleEveryHours} 小时自动采集` : " · 未启用定时"}
                  </div>
                  {source.provider === "civitai" ? (
                    <div className="mt-1 text-xs text-[#8f97aa]">
                      {civitaiSortOptions.find((item) => item.value === (source.sort ?? "Most Reactions"))?.label}
                      {" · "}
                      {civitaiPeriodOptions.find((item) => item.value === (source.period ?? "Month"))?.label}
                    </div>
                  ) : null}
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button onClick={() => void handleToggleSourceEnabled(source)} disabled={loading} variant="outline" size="sm" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                      {source.enabled ? "停用" : "启用"}
                    </Button>
                    <select
                      value={source.scheduleEveryHours ?? 0}
                      onChange={(event) => void handleSourceScheduleChange(source, Number(event.target.value) || 0)}
                      className="h-9 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white"
                    >
                      <option value={0}>不定时</option>
                      <option value={1}>每 1 小时</option>
                      <option value={6}>每 6 小时</option>
                      <option value={12}>每 12 小时</option>
                      <option value={24}>每天</option>
                      <option value={72}>每 3 天</option>
                      <option value={168}>每 7 天</option>
                    </select>
                    <Button onClick={() => void handleRun(source)} disabled={loading} size="sm" className="bg-cyan-400 text-black hover:bg-cyan-300">
                      <Play className="mr-1 h-3.5 w-3.5" />
                      执行
                    </Button>
                    <Button onClick={() => void handleDeleteSource(source)} disabled={loading} variant="outline" size="sm" className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </div>
              ))}
              {sources.length === 0 ? <div className="text-sm text-[#8f97aa]">暂无采集源</div> : null}
            </div>
          </div>

          <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-5">
            <div className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-lg font-medium">采集记录</h2>
              <Button onClick={() => void handleClearRuns()} disabled={loading || runs.length === 0} variant="outline" size="sm" className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
                <Trash2 className="mr-1 h-3.5 w-3.5" />
                清空
              </Button>
            </div>
            <div className="max-h-[44vh] space-y-3 overflow-y-auto pr-1">
              {runs.map((run) => (
                <div key={run.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="text-sm font-medium">{run.provider} · {run.query}</div>
                    <div className="flex items-center gap-2">
                      <span className={`rounded-full px-3 py-1 text-xs ${run.status === "completed" ? "bg-emerald-500/10 text-emerald-200" : run.status === "failed" ? "bg-red-500/10 text-red-200" : "bg-yellow-500/10 text-yellow-100"}`}>
                        {run.status === "completed" ? "完成" : run.status === "failed" ? "失败" : "运行中"}
                      </span>
                      {run.status !== "running" ? (
                        <button
                          type="button"
                          onClick={() => void handleDeleteRun(run)}
                          disabled={loading}
                          className="flex h-7 w-7 items-center justify-center rounded-lg border border-red-400/20 bg-red-500/10 text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                          aria-label="删除记录"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-[#8f97aa]">
                    {new Date(run.startedAt).toLocaleString("zh-CN")} · 获取 {run.fetched} · 新增 {run.added} · 跳过 {run.skipped}
                  </div>
                  {run.error ? <div className="mt-2 line-clamp-2 text-xs text-red-200">{run.error}</div> : null}
                </div>
              ))}
              {runs.length === 0 ? <div className="text-sm text-[#8f97aa]">暂无采集记录</div> : null}
            </div>
          </div>
        </aside>
      </div>
      ) : null}

      {activeTab === "review" ? (
      <div className="space-y-6">
        <div className="flex flex-wrap items-center gap-2">
          {statusOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setStatus(option.value);
                void reloadFirstPage(option.value);
              }}
              className={`rounded-xl px-4 py-2 text-sm transition ${status === option.value ? "bg-white/10 text-white" : "text-[#8f97aa] hover:bg-white/[0.05] hover:text-white"}`}
            >
              {option.label}
            </button>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <label className="flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-2 text-sm text-[#cfd6e2]">
            <input
              type="checkbox"
              checked={allCurrentSelected}
              onChange={() => setSelectedIds(allCurrentSelected ? [] : works.map((work) => work.id))}
            />
            全选当前页
          </label>
          <Button disabled={selectedCount === 0 || loading} onClick={() => void handleBatch("publish")} className="bg-cyan-400 text-black hover:bg-cyan-300">批量发布 {selectedCount || ""}</Button>
          <Button disabled={selectedCount === 0 || loading} onClick={() => void handleBatch("reject")} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">批量拒绝</Button>
          <Button disabled={selectedCount === 0 || loading} onClick={() => void handleBatch("delete")} variant="outline" className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">批量删除</Button>
        </div>

        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
          {works.map((work) => (
            <div key={work.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141b]">
              <div className="relative">
                <img src={work.coverUrl} alt={work.title} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                <label className="absolute left-3 top-3 flex h-8 w-8 items-center justify-center rounded-lg bg-black/50 backdrop-blur">
                  <input type="checkbox" checked={selectedIds.includes(work.id)} onChange={() => toggleSelect(work.id)} />
                </label>
              </div>
              <div className="p-4">
                <div className="mb-2 text-xs text-[#8f97aa]">
                  {work.provider} · {work.categoryName} · {sourceById.get(work.sourceId || "")?.query || "手动"}
                </div>
                <div className="line-clamp-1 font-medium">{work.title}</div>
                <div className="mt-2 line-clamp-3 text-xs leading-5 text-[#8f97aa]">{work.prompt || "暂无提示词"}</div>
                <div className="mt-4 flex gap-2">
                  <Button size="sm" variant="outline" onClick={() => setEditing(createDraft(work))} className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                    <Edit3 className="mr-1 h-3.5 w-3.5" />
                    编辑
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void handleToggleFeatured(work)}
                    className={`${work.featured ? "border-amber-300/30 bg-amber-300/10 text-amber-100" : "border-white/[0.08] bg-white/[0.03] text-white"} hover:bg-white/[0.06]`}
                  >
                    <Star className="mr-1 h-3.5 w-3.5" />
                    {work.featured ? "取消置顶" : "置顶"}
                  </Button>
                  {work.status !== "published" ? (
                    <Button size="sm" onClick={() => void handleWorkAction(work, "publish")} className="flex-1 bg-cyan-400 text-black hover:bg-cyan-300">
                      <Check className="mr-1 h-3.5 w-3.5" />
                      发布
                    </Button>
                  ) : null}
                  {work.status !== "rejected" ? (
                    <Button size="sm" variant="outline" onClick={() => void handleWorkAction(work, "reject")} className="flex-1 border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                      <X className="mr-1 h-3.5 w-3.5" />
                      拒绝
                    </Button>
                  ) : null}
                  <Button size="sm" variant="outline" onClick={() => void handleWorkAction(work, "delete")} className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            </div>
          ))}
          {works.length === 0 ? <div className="col-span-full py-12 text-center text-sm text-[#8f97aa]">暂无作品</div> : null}
        </div>

        <div className="flex items-center justify-center gap-4 pt-2">
          <Button
            onClick={() => void handlePrevPage()}
            disabled={loading || pageIndex === 0}
            variant="outline"
            className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
          >
            上一页
          </Button>
          <span className="text-sm text-[#8f97aa]">第 {pageIndex + 1} 页</span>
          <Button
            onClick={() => void handleNextPage()}
            disabled={loading || !hasMore}
            variant="outline"
            className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
          >
            下一页
          </Button>
        </div>
      </div>
      ) : null}


      {editing ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6">
          <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/[0.08] bg-[#11141b] p-6 shadow-2xl">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-lg font-semibold">编辑采集作品</h2>
              <button type="button" onClick={() => setEditing(null)} className="text-[#8f97aa] hover:text-white">关闭</button>
            </div>
            <div className="grid gap-4">
              <Input value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} placeholder="标题" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <select value={editing.categoryId} onChange={(event) => setEditing({ ...editing, categoryId: event.target.value })} className="h-11 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white">
                {categoryOptions.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
              </select>
              <Textarea value={editing.prompt} onChange={(event) => setEditing({ ...editing, prompt: event.target.value })} placeholder="提示词" className="min-h-[120px] border-white/[0.08] bg-white/[0.03] text-white" />
              <Textarea value={editing.negativePrompt} onChange={(event) => setEditing({ ...editing, negativePrompt: event.target.value })} placeholder="负面提示词" className="min-h-[80px] border-white/[0.08] bg-white/[0.03] text-white" />
              <Input value={editing.model} onChange={(event) => setEditing({ ...editing, model: event.target.value })} placeholder="模型" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <Input value={editing.tags} onChange={(event) => setEditing({ ...editing, tags: event.target.value })} placeholder="标签，用逗号分隔" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <Input value={editing.displayUrl} onChange={(event) => setEditing({ ...editing, displayUrl: event.target.value })} placeholder="展示图 URL" className="border-white/[0.08] bg-white/[0.03] text-white" />
              <Input value={editing.sourcePageUrl} onChange={(event) => setEditing({ ...editing, sourcePageUrl: event.target.value })} placeholder="来源页面 URL" className="border-white/[0.08] bg-white/[0.03] text-white" />
            </div>
            <div className="mt-6 flex justify-end gap-3">
              <Button variant="outline" onClick={() => setEditing(null)} className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">取消</Button>
              <Button onClick={() => void handleSaveEdit()} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">保存</Button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
