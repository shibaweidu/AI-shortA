import { useEffect, useRef, useState } from "react";
import { AlertCircle, Copy, Download, Expand, Image as ImageIcon, Library, Link2, Loader2, Pause, Play, Trash2, Video } from "lucide-react";
import { LocalAssetImage } from "../../components/LocalAssetImage";
import { getFlowItemAspectRatioValue, isFlowItemPortrait } from "../../lib/flowItemMedia";
import { IMAGE_GENERATION_TIMEOUT_LABEL, formatElapsedTime, getGenerationElapsedMs } from "../../lib/generationStatus";
import { cn, getFlowItemDisplayName } from "../../lib/utils";
import type { FlowItem } from "../../store/flowStore";
import type { GridSize } from "./FlowGrid";

interface FlowCardProps {
  item: FlowItem;
  onRemove: (id: string) => void;
  onSave: (item: FlowItem) => void;
  onOpen?: (item: FlowItem) => void;
  onReusePrompt?: (item: FlowItem) => void;
  onUseAsReference?: (item: FlowItem) => void;
  className?: string;
  gridSize?: GridSize;
  showDetails?: boolean;
}

export function FlowCard({
  item,
  onRemove,
  onSave,
  onOpen,
  onReusePrompt,
  onUseAsReference,
  className,
  gridSize = "medium",
  showDetails = true,
}: FlowCardProps) {
  const [isPlaying, setIsPlaying] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const videoRef = useRef<HTMLVideoElement>(null);

  const createdAtLabel = new Date(item.createdAt).toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

  const radiusClass =
    gridSize === "small" ? "rounded-[18px]" : gridSize === "large" ? "rounded-[22px]" : "rounded-[20px]";
  const canOpen = Boolean(onOpen) && item.type === "image";
  const referenceCount = item.referenceImages?.length ?? (item.referenceImage ? 1 : 0);
  const isPortrait = isFlowItemPortrait(item);
  const aspectRatio = getFlowItemAspectRatioValue(item);
  const hasMeasuredProgress = item.type === "video" && typeof item.progress === "number";
  const progress = Math.max(0, Math.min(99, Math.round(item.progress ?? 0)));
  const elapsedLabel = formatElapsedTime(getGenerationElapsedMs(item, now));

  useEffect(() => {
    if (item.status !== "generating") return;
    setNow(Date.now());
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [item.status, item.id]);

  const handleDownload = () => {
    if (!item.url) return;
    const a = document.createElement("a");
    a.href = item.url;
    a.download = `flow-${item.id}.${item.type === "video" ? "mp4" : "png"}`;
    a.click();
  };

  const handlePlayToggle = () => {
    if (!videoRef.current) return;

    if (isPlaying) {
      videoRef.current.pause();
    } else {
      videoRef.current.muted = false;
      void videoRef.current.play();
    }
  };

  return (
    <article
      className={cn(
        "group relative overflow-hidden border border-white/[0.06] bg-[#10131a] transition-colors duration-200",
        canOpen && "cursor-pointer",
        "hover:border-white/[0.14]",
        radiusClass,
        className
      )}
      onClick={() => {
        if (!canOpen) return;
        onOpen?.(item);
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
    >
      <div className={cn("relative bg-[#090b10]", isPortrait && "mx-auto max-w-full")} style={{ aspectRatio }}>
        {item.status === "generating" ? (
          <div className="relative flex h-full w-full items-center justify-center overflow-hidden bg-white/[0.03]">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_35%,rgba(34,211,238,0.20),transparent_34%),linear-gradient(110deg,transparent,rgba(255,255,255,0.08),transparent)] bg-[length:100%_100%,220%_100%] animate-[pulse_2s_ease-in-out_infinite]" />
            <div className="relative flex w-[72%] flex-col items-center gap-3 text-[#cbd5e1]">
              <div className="relative flex h-14 w-14 items-center justify-center rounded-full border border-cyan-300/25 bg-cyan-300/10 shadow-[0_0_30px_rgba(34,211,238,0.18)]">
                <Loader2 className="h-6 w-6 animate-spin text-cyan-200" />
                <span className="absolute text-[10px] font-semibold text-white">
                  {hasMeasuredProgress ? `${progress}%` : elapsedLabel}
                </span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-white/10">
                <div
                  className={cn(
                    "h-full rounded-full bg-gradient-to-r from-cyan-300 via-sky-400 to-violet-400 shadow-[0_0_18px_rgba(56,189,248,0.55)]",
                    hasMeasuredProgress ? "transition-all duration-700" : "w-full animate-pulse"
                  )}
                  style={hasMeasuredProgress ? { width: `${progress}%` } : undefined}
                />
              </div>
              <span className="text-xs text-cyan-100/80">
                {hasMeasuredProgress ? `Generating ${progress}%` : `Generating ${elapsedLabel} / ${IMAGE_GENERATION_TIMEOUT_LABEL}`}
              </span>
            </div>
          </div>
        ) : item.status === "error" ? (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.03]">
            <div className="flex flex-col items-center gap-2 text-red-300/70">
              <AlertCircle className="h-6 w-6" />
              <span className="text-xs">Failed</span>
            </div>
          </div>
        ) : item.type === "image" && item.url ? (
          <LocalAssetImage itemId={item.id} src={item.url} alt={item.prompt} className="block h-full w-full object-cover" loading="lazy" />
        ) : item.type === "video" && item.url ? (
          <div className="relative h-full w-full">
            <video
              ref={videoRef}
              src={item.url}
              poster={item.thumbnail}
              className="h-full w-full object-contain"
              loop
              controls={isPlaying}
              playsInline
              onPlay={() => setIsPlaying(true)}
              onPause={() => setIsPlaying(false)}
              onClick={(event) => {
                event.stopPropagation();
                handlePlayToggle();
              }}
            />

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                handlePlayToggle();
              }}
              className={cn(
                "absolute inset-0 flex items-center justify-center transition-opacity duration-200",
                isPlaying && !hovered ? "opacity-0" : "opacity-100"
              )}
            >
              <div className="flex h-11 w-11 items-center justify-center rounded-full bg-black/55 text-white backdrop-blur-sm">
                {isPlaying ? <Pause className="h-4 w-4" /> : <Play className="ml-0.5 h-4 w-4" />}
              </div>
            </button>

          </div>
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-white/[0.03]" />
        )}

        {item.status === "completed" && showDetails ? (
          <div
            className={cn(
              "pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/82 via-black/38 to-transparent px-3 pb-3 pt-12 transition-all duration-200",
              hovered ? "translate-y-0 opacity-100" : "translate-y-1 opacity-0"
            )}
          >
            {item.prompt ? (
              <p className="line-clamp-1 max-w-[88%] text-xs leading-relaxed text-white/92">{getFlowItemDisplayName(item.prompt)}</p>
            ) : null}
          </div>
        ) : null}

        {item.status === "completed" || item.status === "error" ? (
          <div
            className={cn(
              "absolute right-3 top-3 flex gap-2 transition-all duration-200",
              hovered ? "translate-y-0 opacity-100" : "-translate-y-1 opacity-0"
            )}
          >
            {item.status === "completed" && item.type === "video" && onOpen ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onOpen(item);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                title="全屏查看视频"
              >
                <Expand className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {item.status === "completed" && onReusePrompt && item.prompt ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onReusePrompt(item);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                title="复用提示词"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {item.status === "completed" && onUseAsReference && item.type === "image" && item.url ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onUseAsReference(item);
                }}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                title="添加为参考图"
              >
                <Link2 className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {item.status === "completed" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onSave(item);
                }}
                className={cn(
                  "flex h-8 w-8 items-center justify-center rounded-xl text-white backdrop-blur-sm transition-colors",
                  item.savedFileName ? "bg-emerald-500/80 hover:bg-emerald-500" : "bg-black/55 hover:bg-black/75"
                )}
                title={item.savedFileName ? `已保存为 ${item.savedFileName}` : "保存到已选文件夹"}
              >
                <Library className="h-3.5 w-3.5" />
              </button>
            ) : null}

            {item.status === "completed" ? (
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  handleDownload();
                }}
                className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-black/75"
                title="Download"
              >
                <Download className="h-3.5 w-3.5" />
              </button>
            ) : null}

            <button
              type="button"
              onClick={(event) => {
                event.stopPropagation();
                onRemove(item.id);
              }}
              className="flex h-8 w-8 items-center justify-center rounded-xl bg-black/55 text-white backdrop-blur-sm transition-colors hover:bg-red-500/80"
              title="Delete"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ) : null}

        {showDetails ? (
          <div className="absolute left-3 top-3 flex max-w-[78%] flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/90 backdrop-blur-sm">
              {item.type === "image" ? <ImageIcon className="h-3 w-3" /> : <Video className="h-3 w-3" />}
              <span>{item.type === "image" ? "Image" : "Video"}</span>
            </div>

            <div className="rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/82 backdrop-blur-sm">
              {item.parameters.aspectRatio}
            </div>

            {item.parameters.duration ? (
              <div className="rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/82 backdrop-blur-sm">
                {item.parameters.duration}
              </div>
            ) : null}

            {item.parameters.resolution ? (
              <div className="rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/82 backdrop-blur-sm">
                {item.parameters.resolution}
              </div>
            ) : null}

            <div className="max-w-full truncate rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/72 backdrop-blur-sm">
              {item.parameters.model}
            </div>
          </div>
        ) : null}

        {showDetails ? (
          <div className="absolute bottom-3 right-3 rounded-full bg-black/48 px-2 py-1 text-[10px] text-white/78 backdrop-blur-sm">
            {item.savedFileName ? `Saved | ${createdAtLabel}` : createdAtLabel}
          </div>
        ) : null}

        {referenceCount > 0 && showDetails ? (
          <div className="absolute bottom-3 left-3 rounded-full bg-cyan-400/16 px-2 py-1 text-[10px] text-cyan-200 backdrop-blur-sm">
            REF {referenceCount}
          </div>
        ) : null}

        {item.saveError && item.status === "completed" ? (
          <div className="absolute inset-x-3 bottom-3 rounded-xl border border-red-400/20 bg-red-500/10 px-3 py-2 text-[10px] text-red-100 backdrop-blur-sm">
            Save failed: {item.saveError}
          </div>
        ) : null}
      </div>
    </article>
  );
}
