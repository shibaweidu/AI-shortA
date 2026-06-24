import { useEffect, useMemo, useState } from "react";
import { Check, Edit3, Play, Plus, RefreshCw, Star, Trash2, X } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { buildModelCatalogOptions } from "../../lib/modelCatalog";
import { parseSourcedProviderModelValue } from "../../lib/providerModels";
import { useSettingsStore, type ProviderConfig } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import {
  batchCollectionWorks,
  createCollectionSource,
  DEFAULT_COLLECTION_CLASSIFIER_SETTINGS,
  deleteCollectionSource,
  deleteCollectionWork,
  fetchCollectionClassifierSettings,
  fetchCollectionRuns,
  fetchCollectionSources,
  fetchCollectionWorks,
  publishCollectionWork,
  rejectCollectionWork,
  runEnabledCollectionSources,
  runCollectionSource,
  updateCollectionClassifierSettings,
  updateCollectionSource,
  updateCollectionWork,
  type CollectionClassifierSettings,
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
  const [targetCategoryId, setTargetCategoryId] = useState("style");
  const [maxItemsPerRun, setMaxItemsPerRun] = useState(30);
  const [scheduleEveryHours, setScheduleEveryHours] = useState(0);
  const [autoPublish, setAutoPublish] = useState(false);
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");
  const [classifierSettings, setClassifierSettings] = useState<CollectionClassifierSettings>(DEFAULT_COLLECTION_CLASSIFIER_SETTINGS);
  const [editing, setEditing] = useState<EditDraft | null>(null);

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

  const loadSources = async () => {
    const data = await fetchCollectionSources();
    setSources(data.sources);
  };

  const loadRuns = async () => {
    const data = await fetchCollectionRuns({ limit: 20 });
    setRuns(data.runs);
  };

  const loadWorks = async (nextStatus = status) => {
    const page = await fetchCollectionWorks({ status: nextStatus, limit: 60 });
    setWorks(page.items);
    setSelectedIds([]);
  };

  const refresh = async () => {
    setLoading(true);
    setMessage("");
    try {
      await Promise.all([loadSources(), loadWorks(), loadRuns()]);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
    void fetchCollectionClassifierSettings().then(setClassifierSettings);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const resolveClassifierProvider = (value: string): { provider: ProviderConfig; modelId: string } | null => {
    const parsed = parseSourcedProviderModelValue(value);
    if (!parsed) return null;
    const providerList = parsed.source === "custom" ? userProviders : providers;
    const provider = providerList.find((item) => item.id === parsed.providerId);
    if (!provider) return null;
    return { provider, modelId: parsed.modelId };
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

  const handleCreateSource = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setMessage("");
    try {
      await createCollectionSource({
        provider,
        query: query.trim(),
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
      await Promise.all([loadSources(), loadWorks(), loadRuns()]);
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
      await Promise.all([loadSources(), loadWorks(), loadRuns()]);
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

  const handleWorkAction = async (work: CollectionWork, action: "publish" | "reject" | "delete") => {
    setLoading(true);
    try {
      if (action === "publish") await publishCollectionWork(work.id);
      if (action === "reject") await rejectCollectionWork(work.id);
      if (action === "delete") await deleteCollectionWork(work.id);
      await loadWorks();
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
      await loadWorks();
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
      await loadWorks();
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
      await loadWorks();
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
    <div className="mx-auto max-w-7xl p-6 text-white">
      <div className="mb-8 flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">采集管理</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">从 Civitai、Lexica 采集作品 URL，审核后进入首页推荐流。</p>
        </div>
        <Button onClick={() => void refresh()} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
      </div>

      <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
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
        <Button onClick={() => void handleCreateSource()} disabled={loading || !query.trim()} className="mt-4 bg-cyan-400 text-black hover:bg-cyan-300">
          <Plus className="mr-2 h-4 w-4" />
          创建采集源
        </Button>
      </div>

      {message ? <div className="mb-6 rounded-2xl border border-white/[0.08] bg-white/[0.03] p-4 text-sm text-[#cfd6e2]">{message}</div> : null}

      <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
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

      <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h2 className="text-lg font-medium">采集源</h2>
          <Button onClick={() => void handleRunEnabled()} disabled={loading || sources.length === 0} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
            运行全部启用源
          </Button>
        </div>
        <div className="grid gap-3">
          {sources.map((source) => (
            <div key={source.id} className="flex flex-col gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 md:flex-row md:items-center md:justify-between">
              <div>
                <div className="font-medium">{source.name}</div>
                <div className="mt-1 text-xs text-[#8f97aa]">
                  {source.provider} · {source.query} · {source.targetCategoryName || "自动分类"} · 每次 {source.maxItemsPerRun} 条 · {source.autoPublish ? "自动发布" : "待审核"}
                  {source.scheduleEveryHours ? ` · 每 ${source.scheduleEveryHours} 小时自动采集` : " · 未启用定时"}
                </div>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => void handleToggleSourceEnabled(source)} disabled={loading} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]">
                  {source.enabled ? "停用" : "启用"}
                </Button>
                <select
                  value={source.scheduleEveryHours ?? 0}
                  onChange={(event) => void handleSourceScheduleChange(source, Number(event.target.value) || 0)}
                  className="h-10 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white"
                >
                  <option value={0}>不定时</option>
                  <option value={1}>每 1 小时</option>
                  <option value={6}>每 6 小时</option>
                  <option value={12}>每 12 小时</option>
                  <option value={24}>每天</option>
                  <option value={72}>每 3 天</option>
                  <option value={168}>每 7 天</option>
                </select>
                <Button onClick={() => void handleRun(source)} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
                  <Play className="mr-2 h-4 w-4" />
                  执行采集
                </Button>
                <Button onClick={() => void handleDeleteSource(source)} disabled={loading} variant="outline" className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            </div>
          ))}
          {sources.length === 0 ? <div className="text-sm text-[#8f97aa]">暂无采集源</div> : null}
        </div>
      </div>

      <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
        <h2 className="mb-4 text-lg font-medium">采集记录</h2>
        <div className="space-y-3">
          {runs.map((run) => (
            <div key={run.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm font-medium">{run.provider} · {run.query}</div>
                <span className={`rounded-full px-3 py-1 text-xs ${run.status === "completed" ? "bg-emerald-500/10 text-emerald-200" : run.status === "failed" ? "bg-red-500/10 text-red-200" : "bg-yellow-500/10 text-yellow-100"}`}>
                  {run.status === "completed" ? "完成" : run.status === "failed" ? "失败" : "运行中"}
                </span>
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

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {statusOptions.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => {
              setStatus(option.value);
              void loadWorks(option.value);
            }}
            className={`rounded-xl px-4 py-2 text-sm transition ${status === option.value ? "bg-white/10 text-white" : "text-[#8f97aa] hover:bg-white/[0.05] hover:text-white"}`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mb-4 flex flex-wrap items-center gap-2">
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

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
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
      </div>

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
