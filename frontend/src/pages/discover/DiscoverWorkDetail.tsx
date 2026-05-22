import { useEffect, useState } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { ArrowLeft, Copy, Download } from "lucide-react";
import { Button } from "../../components/ui/button";
import { useDiscoverStore } from "../../store/discoverStore";

export default function DiscoverWorkDetail() {
  const { workId } = useParams();
  const navigate = useNavigate();
  const { works, categories, hasHydrated } = useDiscoverStore();
  const [copied, setCopied] = useState(false);

  const work = works.find((w) => w.id === workId);
  const category = work ? categories.find((c) => c.id === work.categoryId) : null;

  useEffect(() => {
    if (hasHydrated && !work) {
      navigate("/", { replace: true });
    }
  }, [hasHydrated, work, navigate]);

  const handleRemake = () => {
    if (!work) return;

    // 滚动到页面底部
    window.scrollTo({ top: document.body.scrollHeight, behavior: "smooth" });

    // 触发生成器填充（通过 URL 参数传递）
    navigate(`/?remake=${work.id}`);
  };

  const handleCopyPrompt = () => {
    if (!work) return;
    navigator.clipboard.writeText(work.prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    if (!work) return;
    const link = document.createElement("a");
    link.href = work.coverUrl;
    link.download = `${work.title}.png`;
    link.click();
  };

  if (!hasHydrated || !work) return null;

  return (
    <div className="min-h-screen bg-[#08090d] text-white">
      <header className="sticky top-0 z-30 border-b border-white/[0.06] bg-[#08090d]/80 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-7xl items-center justify-between px-6">
          <button
            onClick={() => navigate("/")}
            className="flex items-center gap-2 text-[#9aa3b7] transition hover:text-white"
          >
            <ArrowLeft className="h-5 w-5" />
            <span>返回</span>
          </button>

          <div className="flex items-center gap-3">
            <Button
              onClick={handleDownload}
              variant="outline"
              className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
            >
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
            <img src={work.coverUrl} alt={work.title} className="max-h-[80vh] w-full object-contain" />
          </div>

          <div className="space-y-6">
            <div>
              <div className="mb-2 text-sm text-[#8f97aa]">{category?.name}</div>
              <h1 className="text-3xl font-semibold text-white">{work.title}</h1>
            </div>

            <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
              <div className="mb-4 flex items-center justify-between">
                <div className="text-sm font-medium text-white">提示词</div>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={handleCopyPrompt}
                  className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
                >
                  <Copy className="mr-2 h-3 w-3" />
                  {copied ? "已复制" : "复制"}
                </Button>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-7 text-[#e4e8f0]">{work.prompt}</p>
            </div>

            <div className="rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
              <div className="mb-4 text-sm font-medium text-white">生成参数</div>
              <div className="space-y-3 text-sm">
                <div className="flex justify-between">
                  <span className="text-[#8f97aa]">模型</span>
                  <span className="text-white">{work.model}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-[#8f97aa]">比例</span>
                  <span className="text-white">{work.aspectRatio}</span>
                </div>
                {work.resolution && (
                  <div className="flex justify-between">
                    <span className="text-[#8f97aa]">分辨率</span>
                    <span className="text-white">{work.resolution}</span>
                  </div>
                )}
              </div>
            </div>

            <Button onClick={handleRemake} className="w-full bg-cyan-400 py-6 text-black hover:bg-cyan-300">
              做同款
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
