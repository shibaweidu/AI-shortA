import { useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Loader2, RefreshCw, Search, Terminal } from "lucide-react";
import { Button } from "../../components/ui/button";
import { fetchAdminLogs, type AdminLogResponse } from "../../services/adminLogs";

const lineCountOptions = [200, 500, 1000, 2000];

function formatBytes(value: number) {
  if (!value) return "0 B";
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(1)} KB`;
  return `${(value / 1024 / 1024).toFixed(1)} MB`;
}

function formatLogLine(line: string) {
  try {
    const parsed = JSON.parse(line) as Record<string, unknown>;
    const timestamp = typeof parsed.timestamp === "string" ? parsed.timestamp : "";
    const event = typeof parsed.event === "string" ? parsed.event : "";
    const jobId = typeof parsed.jobId === "string" ? parsed.jobId : "";
    const rest = { ...parsed };
    delete rest.timestamp;
    delete rest.event;
    delete rest.jobId;
    return {
      timestamp,
      event,
      jobId,
      details: Object.keys(rest).length ? JSON.stringify(rest) : "",
      raw: line,
    };
  } catch {
    return { timestamp: "", event: "", jobId: "", details: line, raw: line };
  }
}

export default function AdminLogs() {
  const [logData, setLogData] = useState<AdminLogResponse | null>(null);
  const [source, setSource] = useState("image-jobs");
  const [lineCount, setLineCount] = useState(500);
  const [query, setQuery] = useState("");
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const viewportRef = useRef<HTMLDivElement | null>(null);

  const loadLogs = async (nextSource = source, nextLineCount = lineCount, nextQuery = query) => {
    setLoading(true);
    setError("");
    try {
      const nextData = await fetchAdminLogs({ source: nextSource, lines: nextLineCount, query: nextQuery });
      setLogData(nextData);
      setSource(nextData.source);
      window.setTimeout(() => {
        if (viewportRef.current) viewportRef.current.scrollTop = viewportRef.current.scrollHeight;
      }, 0);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : String(loadError));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadLogs();
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void loadLogs(source, lineCount, query), 300);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    if (!autoRefresh) return undefined;
    const timer = window.setInterval(() => void loadLogs(source, lineCount, query), 5000);
    return () => window.clearInterval(timer);
  }, [autoRefresh, source, lineCount, query]);

  const formattedLines = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    const lines = logData?.lines ?? [];
    return lines
      .filter((line) => !normalizedQuery || line.toLowerCase().includes(normalizedQuery))
      .map(formatLogLine);
  }, [logData?.lines, query]);

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">系统日志</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">查看生成任务与接口调用的运行记录。</p>
        </div>
        <Button type="button" onClick={() => void loadLogs()} disabled={loading} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
          {loading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}
          刷新
        </Button>
      </div>

      <div className="mb-5 grid gap-3 xl:grid-cols-[1fr_160px_180px_180px]">
        <label className="flex h-11 items-center gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-[#cfd6e2]">
          <Search className="h-4 w-4 text-[#7f8798]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="搜索日志内容、任务 ID、事件名"
            className="w-full bg-transparent text-white outline-none placeholder:text-[#667085]"
          />
        </label>
        <select
          value={source}
          onChange={(event) => {
            setSource(event.target.value);
            void loadLogs(event.target.value, lineCount, query);
          }}
          className="h-11 rounded-xl border border-white/[0.08] bg-[#11141b] px-3 text-sm text-white outline-none"
        >
          {(logData?.sources ?? [{ id: "image-jobs", label: "生成任务日志" }]).map((item) => (
            <option key={item.id} value={item.id}>{item.label}</option>
          ))}
        </select>
        <select
          value={lineCount}
          onChange={(event) => {
            const nextLineCount = Number(event.target.value);
            setLineCount(nextLineCount);
            void loadLogs(source, nextLineCount, query);
          }}
          className="h-11 rounded-xl border border-white/[0.08] bg-[#11141b] px-3 text-sm text-white outline-none"
        >
          {lineCountOptions.map((option) => (
            <option key={option} value={option}>最近 {option} 行</option>
          ))}
        </select>
        <button
          type="button"
          onClick={() => setAutoRefresh((value) => !value)}
          className={autoRefresh ? "flex h-11 items-center justify-center gap-2 rounded-xl border border-emerald-400/20 bg-emerald-400/10 px-4 text-sm text-emerald-100" : "flex h-11 items-center justify-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-sm text-[#9aa3b7]"}
        >
          {autoRefresh ? <Check className="h-4 w-4" /> : <RefreshCw className="h-4 w-4" />}
          自动刷新
        </button>
      </div>

      <div className="mb-5 grid gap-3 md:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">日志源</div>
          <div className="mt-1 text-sm text-white">{logData?.label ?? "生成任务日志"}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">文件大小</div>
          <div className="mt-1 text-sm text-white">{formatBytes(logData?.size ?? 0)}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">显示行数</div>
          <div className="mt-1 text-sm text-white">{formattedLines.length} / {logData?.lines.length ?? 0}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">更新时间</div>
          <div className="mt-1 text-sm text-white">{logData?.updatedAt ? new Date(logData.updatedAt).toLocaleString("zh-CN") : "-"}</div>
        </div>
      </div>

      {error ? (
        <div className="mb-5 flex items-center gap-3 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">
          <CircleAlert className="h-4 w-4" />
          {error}
        </div>
      ) : null}

      {logData?.truncated ? (
        <div className="mb-5 rounded-2xl border border-amber-400/20 bg-amber-400/10 px-4 py-3 text-sm text-amber-100">
          当前只展示日志尾部内容。
        </div>
      ) : null}

      <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#05070a]">
        <div className="flex items-center gap-2 border-b border-white/[0.08] bg-[#11141b] px-4 py-3 text-sm text-[#cfd6e2]">
          <Terminal className="h-4 w-4 text-cyan-300" />
          日志窗口
        </div>
        <div ref={viewportRef} className="h-[calc(100vh-360px)] min-h-[420px] overflow-auto font-mono text-xs leading-6">
          {formattedLines.length ? (
            formattedLines.map((line, index) => (
              <div key={`${index}-${line.raw.slice(0, 24)}`} className="grid grid-cols-[190px_180px_140px_minmax(0,1fr)] gap-3 border-b border-white/[0.03] px-4 py-1.5 text-[#aab3c5] hover:bg-white/[0.03]">
                <span className="text-[#6f788a]">{line.timestamp ? new Date(line.timestamp).toLocaleString("zh-CN") : "-"}</span>
                <span className="truncate text-cyan-200">{line.event || "-"}</span>
                <span className="truncate text-[#93a4bc]">{line.jobId || "-"}</span>
                <span className="whitespace-pre-wrap break-words text-[#c7cfdb]">{line.details || line.raw}</span>
              </div>
            ))
          ) : (
            <div className="flex h-full items-center justify-center text-sm text-[#7f8798]">
              {loading ? "加载日志中..." : "没有匹配的日志"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
