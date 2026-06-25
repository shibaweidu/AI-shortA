import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ArrowLeft, Copy, Download, ExternalLink } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useDiscoverStore, type DiscoverWork } from "../../store/discoverStore";
import { fetchCollectionWork, fetchRelatedCollectionWorks, reportCollectionImageBroken, type CollectionWork } from "../../services/collection";

type DetailWork = {
  id: string;
  categoryId: string;
  categoryName?: string;
  title: string;
  coverUrl: string;
  prompt: string;
  promptHint?: string;
  negativePrompt?: string;
  model: string;
  aspectRatio: string;
  resolution?: string;
  sourcePageUrl?: string;
  provider?: string;
  tags?: string[];
};

function extractPromptFromMetadata(metadata?: Record<string, unknown>) {
  if (!metadata) return "";
  const meta = metadata.meta && typeof metadata.meta === "object" && !Array.isArray(metadata.meta)
    ? (metadata.meta as Record<string, unknown>)
    : undefined;
  const nested = metadata.metadata && typeof metadata.metadata === "object" && !Array.isArray(metadata.metadata)
    ? (metadata.metadata as Record<string, unknown>)
    : undefined;
  const candidates = [
    metadata.prompt,
    metadata.name,
    metadata.description,
    meta?.prompt,
    meta?.Prompt,
    nested?.prompt,
    nested?.Prompt,
  ];
  const found = candidates.find((value) => typeof value === "string" && value.trim());
  return typeof found === "string" ? found.trim() : "";
}

function fromLegacyWork(work: DiscoverWork): DetailWork {
  const prompt = work.prompt || extractPromptFromMetadata((work as unknown as { metadata?: Record<string, unknown> }).metadata);
  return {
    id: work.id,
    categoryId: work.categoryId,
    title: work.title,
    coverUrl: work.coverUrl,
    prompt,
    promptHint: prompt ? undefined : "这条作品暂时没有抓到完整提示词，可以先查看源站或等待补采集。",
    model: work.model,
    aspectRatio: work.aspectRatio,
    resolution: work.resolution,
  };
}

function fromCollectionWork(work: CollectionWork): DetailWork {
  const prompt = work.prompt || extractPromptFromMetadata(work.metadata);
  return {
    id: work.id,
    categoryId: work.categoryId,
    categoryName: work.categoryName,
    title: work.title,
    coverUrl: work.displayUrl || work.originalImageUrl,
    prompt,
    promptHint: prompt ? undefined : "这条作品暂时没有抓到完整提示词，可以先查看源站或等待补采集。",
    negativePrompt: work.negativePrompt,
    model: work.model || work.provider,
    aspectRatio: work.aspectRatio,
    resolution: work.width && work.height ? `${work.width}x${work.height}` : undefined,
    sourcePageUrl: work.sourcePageUrl,
    provider: work.provider,
    tags: work.tags,
  };
}

export default function DiscoverWorkDetail() {
  const { workId } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { works, categories, hasHydrated } = useDiscoverStore();
  const [copied, setCopied] = useState(false);
  const [collectionWork, setCollectionWork] = useState<CollectionWork | null>(null);
  const [relatedWorks, setRelatedWorks] = useState<CollectionWork[]>([]);
  const [collectionLoading, setCollectionLoading] = useState(false);
  const [collectionTried, setCollectionTried] = useState(false);

  const legacyWork = works.find((item) => item.id === workId);
  const shouldLoadCollection = Boolean(workId) && (searchParams.get("source") === "collection" || !legacyWork);

  useEffect(() => {
    if (!shouldLoadCollection || !workId) return;
    let cancelled = false;
    setCollectionLoading(true);
    setCollectionTried(false);
    fetchCollectionWork(workId)
      .then((work) => {
        if (!cancelled) setCollectionWork(work);
      })
      .catch(() => {
        if (!cancelled) setCollectionWork(null);
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionLoading(false);
          setCollectionTried(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [shouldLoadCollection, workId]);

  useEffect(() => {
    if (!collectionWork) {
      setRelatedWorks([]);
      return;
    }
    let cancelled = false;
    fetchRelatedCollectionWorks(collectionWork.id, 8)
      .then((items) => {
        if (!cancelled) setRelatedWorks(items);
      })
      .catch(() => {
        if (!cancelled) setRelatedWorks([]);
      });
    return () => {
      cancelled = true;
    };
  }, [collectionWork]);

  const detailWork = useMemo(() => {
    if (collectionWork) return fromCollectionWork(collectionWork);
    if (legacyWork) return fromLegacyWork(legacyWork);
    return null;
  }, [collectionWork, legacyWork]);

  const category = detailWork
    ? categories.find((item) => item.id === detailWork.categoryId) ?? { id: detailWork.categoryId, name: detailWork.categoryName || "未分类" }
    : null;

  useEffect(() => {
    if (!hasHydrated || collectionLoading) return;
    if (!detailWork && (!shouldLoadCollection || collectionTried)) {
      navigate("/", { replace: true });
    }
  }, [collectionLoading, collectionTried, detailWork, hasHydrated, navigate, shouldLoadCollection]);

  const handleRemake = () => {
    if (!detailWork) return;
    if (!detailWork.prompt.trim()) {
      navigate("/", { replace: false });
      return;
    }
    if (collectionWork) {
      navigate(`/?prompt=${encodeURIComponent(detailWork.prompt)}&ratio=${encodeURIComponent(detailWork.aspectRatio)}`);
      return;
    }
    navigate(`/?remake=${detailWork.id}`);
  };

  const handleCopyPrompt = () => {
    if (!detailWork?.prompt.trim()) return;
    void navigator.clipboard.writeText(detailWork.prompt);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!detailWork) return;
    const link = document.createElement("a");
    link.href = detailWork.coverUrl;
    link.download = `${detailWork.title}.png`;
    link.click();
  };

  const handleImageError = () => {
    if (!collectionWork) return;
    void reportCollectionImageBroken(collectionWork.id);
    navigate("/", { replace: true });
  };

  const handleRelatedImageError = (id: string) => {
    void reportCollectionImageBroken(id);
    setRelatedWorks((current) => current.filter((item) => item.id !== id));
  };

  if (!hasHydrated || collectionLoading || !detailWork) return null;

  return (
    <div className="min-h-screen bg-[#08090d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#08090d]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <button onClick={() => navigate("/")} className="flex items-center gap-2 text-[#9aa3b7] transition hover:text-white">
            <ArrowLeft className="h-5 w-5" />
            <span>返回</span>
          </button>

          <div className="flex items-center gap-3">
            {detailWork.sourcePageUrl ? (
              <Button asChild variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white">
                <a href={detailWork.sourcePageUrl} target="_blank" rel="noreferrer">
                  <ExternalLink className="mr-2 h-4 w-4" />
                  源站
                </a>
              </Button>
            ) : null}
            <Button onClick={handleDownload} variant="outline" className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white">
              <Download className="mr-2 h-4 w-4" />
              下载
            </Button>
            <Button onClick={handleRemake} className="bg-cyan-400 text-black hover:bg-cyan-300">
              做同款
            </Button>
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-7xl px-6 py-12">
        <div className="grid gap-8 lg:grid-cols-[1fr,400px]">
          <div className="flex items-center justify-center overflow-hidden rounded-[32px] border border-white/[0.08] bg-[#12151c] p-8">
            <img src={detailWork.coverUrl} alt={detailWork.title} onError={handleImageError} className="max-h-[80vh] w-full object-contain" />
          </div>

          <div className="space-y-6">
            <div>
              <div className="mb-2 text-sm text-[#8f97aa]">{category?.name}</div>
              <h1 className="text-3xl font-semibold text-white">{detailWork.title}</h1>
              {detailWork.provider || detailWork.tags?.length ? (
                <div className="mt-3 flex flex-wrap gap-2 text-xs text-[#9aa3b7]">
                  {detailWork.provider ? <span className="rounded-full bg-white/[0.05] px-3 py-1">来源：{detailWork.provider}</span> : null}
                  {detailWork.tags?.map((tag) => (
                    <span key={tag} className="rounded-full bg-white/[0.05] px-3 py-1">{tag}</span>
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-white">提示词</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyPrompt}
                  disabled={!detailWork.prompt.trim()}
                  className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06] hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Copy className="mr-2 h-3 w-3" />
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#e4e8f0]">{detailWork.prompt || "暂无提示词"}</p>
              {detailWork.promptHint ? (
                <div className="mt-3 rounded-2xl border border-amber-400/20 bg-amber-500/10 px-4 py-3 text-xs leading-6 text-amber-100">
                  {detailWork.promptHint}
                </div>
              ) : null}
            </div>

            {detailWork.negativePrompt ? (
              <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
                <div className="mb-4 text-sm font-medium text-white">负面提示词</div>
                <p className="whitespace-pre-wrap text-sm leading-7 text-[#c7cfdd]">{detailWork.negativePrompt}</p>
              </div>
            ) : null}

            <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
              <div className="mb-4 text-sm font-medium text-white">生成参数</div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between gap-4">
                  <span className="text-[#8f97aa]">模型</span>
                  <span className="text-right text-white">{detailWork.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8f97aa]">比例</span>
                  <span className="text-white">{detailWork.aspectRatio}</span>
                </div>
                {detailWork.resolution ? (
                  <div className="flex justify-between">
                    <span className="text-[#8f97aa]">分辨率</span>
                    <span className="text-white">{detailWork.resolution}</span>
                  </div>
                ) : null}
              </div>
            </div>

            <Button onClick={handleRemake} className="w-full bg-cyan-400 py-6 text-black hover:bg-cyan-300">
              做同款
            </Button>
          </div>
        </div>

        {relatedWorks.length > 0 ? (
          <section className="mt-12">
            <div className="mb-5 flex items-center justify-between">
              <h2 className="text-xl font-semibold text-white">相关推荐</h2>
              <span className="text-sm text-[#8f97aa]">{category?.name}</span>
            </div>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
              {relatedWorks.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => navigate(`/discover/${item.id}?source=collection`)}
                  className="group overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141b] text-left transition hover:-translate-y-0.5 hover:border-cyan-300/30"
                >
                  <img
                    src={item.coverUrl}
                    alt={item.title}
                    loading="lazy"
                    onError={() => handleRelatedImageError(item.id)}
                    className="aspect-[4/3] w-full object-cover transition duration-300 group-hover:scale-[1.03]"
                  />
                  <div className="p-3">
                    <div className="line-clamp-1 text-sm font-medium text-white">{item.title}</div>
                    <div className="mt-1 line-clamp-1 text-xs text-[#8f97aa]">{item.categoryName}</div>
                  </div>
                </button>
              ))}
            </div>
          </section>
        ) : null}
      </div>
    </div>
  );
}
