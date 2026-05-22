import { useEffect, useState } from "react";
import { Archive, Copy, Download, Expand, Image as ImageIcon, Link2, Loader2, Sparkles, Trash2, Video } from "lucide-react";
import { Button } from "../../components/ui/button";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { getFlowItemAspectDimensions } from "../../lib/flowItemMedia";
import { IMAGE_GENERATION_TIMEOUT_LABEL, formatElapsedTime, getGenerationElapsedMs } from "../../lib/generationStatus";
import { cn, getFlowItemDisplayName } from "../../lib/utils";
import type { FlowItem } from "../../store/flowStore";
import type { GridSize } from "./FlowGrid";

interface FlowFeedProps {
  items: FlowItem[];
  gridSize?: GridSize;
  onRemove: (id: string) => void;
  onSave: (item: FlowItem) => void;
  showDetails?: boolean;
  onOpen?: (item: FlowItem) => void;
  onReusePrompt?: (item: FlowItem) => void;
  onUseAsReference?: (item: FlowItem) => void;
}

const SIZE_HEIGHT: Record<GridSize, number> = {
  small: 160,
  medium: 220,
  large: 320,
};

function downloadItem(item: FlowItem) {
  if (!item.url) return;
  const link = document.createElement("a");
  link.href = item.url;
  link.download = `flow-${item.id}.${item.type === "video" ? "mp4" : "png"}`;
  link.click();
}

function formatDate(timestamp: number) {
  try {
    return new Date(timestamp).toLocaleDateString("zh-CN", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  } catch {
    return "";
  }
}

function GeneratingPlaceholder({ item }: { item: FlowItem }) {
  const [now, setNow] = useState(() => Date.now());
  const hasMeasuredProgress = item.type === "video" && typeof item.progress === "number";
  const progress = Math.max(0, Math.min(99, Math.round(item.progress ?? 0)));
  const elapsedLabel = formatElapsedTime(getGenerationElapsedMs(item, now));

  useEffect(() => {
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [item.id]);

  return (
    <div className="relative flex h-full w-full flex-col items-center justify-center gap-3 overflow-hidden text-[#cbd5e1]">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(34,211,238,0.18),transparent_36%)] animate-pulse" />
      <Loader2 className="relative h-7 w-7 animate-spin text-cyan-200" />
      <div className="relative w-[70%]">
        <div className="mb-1 text-center text-xs text-cyan-100">
          {hasMeasuredProgress ? `${progress}%` : `${elapsedLabel} / ${IMAGE_GENERATION_TIMEOUT_LABEL}`}
        </div>
        <div className="h-2 overflow-hidden rounded-full bg-white/10">
          <div
            className={cn(
              "h-full rounded-full bg-gradient-to-r from-cyan-300 to-violet-400",
              hasMeasuredProgress ? "transition-all duration-700" : "w-full animate-pulse"
            )}
            style={hasMeasuredProgress ? { width: `${progress}%` } : undefined}
          />
        </div>
      </div>
      <span className="relative text-xs">{hasMeasuredProgress ? "Generating..." : "Generating image..."}</span>
    </div>
  );
}

export function FlowFeed({
  items,
  gridSize = "medium",
  onRemove,
  onSave,
  showDetails = true,
  onOpen,
  onReusePrompt,
  onUseAsReference,
}: FlowFeedProps) {
  if (items.length === 0) {
    return (
      <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center opacity-40">
        <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-muted">
          <Sparkles className="h-8 w-8 text-muted-foreground" />
        </div>
      </div>
    );
  }

  const mediaHeight = SIZE_HEIGHT[gridSize];

  return (
    <div className="flex w-full flex-col gap-4 pb-12">
      {items.map((item) => {
        const { width: aspectWidth, height: aspectHeight } = getFlowItemAspectDimensions(item);
        return (
        <div
          key={item.id}
          className="group flex w-full gap-4 rounded-2xl border border-white/[0.06] bg-[#10131a] p-3 shadow-sm transition hover:border-white/[0.12]"
        >
          {/* 左：图片 / 视频 */}
          <div
            className={cn(
               "relative flex shrink-0 items-center justify-center overflow-hidden rounded-xl bg-[#0a0c11]",
               onOpen && (item.type === "image" || item.type === "video") && "cursor-pointer"
            )}
            style={{
              height: mediaHeight,
              width: mediaHeight * (aspectWidth / aspectHeight),
            }}
            onClick={() => {
              if (item.type !== "image" && item.type !== "video") return;
              onOpen?.(item);
            }}
          >
            {item.status === "generating" ? (
              <GeneratingPlaceholder item={item} />
            ) : item.type === "image" ? (
              <LocalAssetImage
                itemId={item.id}
                src={item.url}
                alt={item.prompt}
                className="h-full w-full object-cover"
              />
            ) : (
              <>
                <video
                  src={item.url}
                  controls
                  className="h-full w-full object-contain"
                  poster={item.thumbnail}
                />
                {onOpen ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpen(item);
                    }}
                    className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition hover:bg-black/75"
                    title="全屏查看视频"
                  >
                    <Expand className="h-3.5 w-3.5" />
                  </button>
                ) : null}
              </>
            )}
          </div>

          {/* 右：信息 */}
          <div className="flex min-w-0 flex-1 flex-col">
            {/* 顶部操作 toolbar */}
            <div className="flex items-center gap-1 border-b border-white/[0.04] px-1 py-1">
              {onReusePrompt && item.prompt ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[#9aa3b7] hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onReusePrompt(item);
                  }}
                  title="复用提示词"
                >
                  <Copy className="h-4 w-4" />
                </Button>
              ) : null}
              {onUseAsReference && item.type === "image" && item.url ? (
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-8 w-8 text-[#9aa3b7] hover:text-white"
                  onClick={(event) => {
                    event.stopPropagation();
                    onUseAsReference(item);
                  }}
                  title="添加为参考图"
                >
                  <Link2 className="h-4 w-4" />
                </Button>
              ) : null}
              {item.status === "completed" ? (
                <>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#9aa3b7] hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      downloadItem(item);
                    }}
                    title="下载"
                  >
                    <Download className="h-4 w-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8 text-[#9aa3b7] hover:text-white"
                    onClick={(event) => {
                      event.stopPropagation();
                      onSave(item);
                    }}
                    title="存档 / 保存到本地"
                  >
                    <Archive className="h-4 w-4" />
                  </Button>
                </>
              ) : null}
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 text-[#9aa3b7] hover:text-red-400"
                onClick={(event) => {
                  event.stopPropagation();
                  onRemove(item.id);
                }}
                title="删除"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>

            {/* 基本信息 */}
            <div className="flex min-h-0 flex-1 flex-col gap-1.5 px-4 py-3 text-sm text-[#cfd6e2]">
              <div className="truncate text-base font-medium text-white">{getFlowItemDisplayName(item.prompt)}</div>

              <div className="flex items-center gap-2 text-[#cfd6e2]">
                {item.type === "image" ? (
                  <ImageIcon className="h-3.5 w-3.5 text-[#9aa3b7]" />
                ) : (
                  <Video className="h-3.5 w-3.5 text-[#9aa3b7]" />
                )}
                <span>创建日期 {formatDate(item.createdAt)}</span>
              </div>

              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[#9aa3b7]">
                {item.parameters.aspectRatio ? (
                  <span className="flex items-center gap-1">
                    <span className="text-[11px]">📐</span>
                    {item.parameters.aspectRatio}
                  </span>
                ) : null}
                {item.parameters.resolution ? <span>{item.parameters.resolution}</span> : null}
                {item.type === "video" && item.parameters.duration ? (
                  <span>{item.parameters.duration}</span>
                ) : null}
                {item.parameters.model ? (
                  <span className="rounded bg-white/[0.04] px-1.5 py-0.5 text-[11px]">
                    {item.parameters.model}
                  </span>
                ) : null}
              </div>

              {item.referenceImage ? (
                <div className="text-[#9aa3b7]">已上传的图片</div>
              ) : null}

              {showDetails && item.prompt ? (
                <p className="mt-1 line-clamp-3 text-[13px] leading-5 text-[#d5d9e2]">
                  {item.prompt}
                </p>
              ) : null}

              {item.savedFileName ? (
                <p className="mt-auto pt-2 text-xs text-emerald-400">
                  已保存：{item.savedFileName}
                </p>
              ) : null}
              {item.saveError ? (
                <p className="mt-auto pt-2 text-xs text-red-300">保存失败：{item.saveError}</p>
              ) : null}
            </div>
          </div>
        </div>
        );
      })}
    </div>
  );
}
