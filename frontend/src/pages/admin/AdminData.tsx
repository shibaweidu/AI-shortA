import { useEffect, useMemo, useState } from "react";
import { Database, Download, RefreshCw, Trash2, UploadCloud } from "lucide-react";
import { Button } from "../../components/ui/button";
import {
  createDataBackup,
  deleteDataBackup,
  downloadDataBackup,
  fetchDataStatus,
  migrateDataToPostgres,
  type DataBackupItem,
  type DataStatusResponse,
} from "../../services/dataAdmin";

function formatBytes(value: number) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let index = 0;
  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }
  return `${size.toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function formatTime(value: number) {
  return value ? new Date(value).toLocaleString("zh-CN") : "-";
}

export default function AdminData() {
  const [status, setStatus] = useState<DataStatusResponse | null>(null);
  const [backups, setBackups] = useState<DataBackupItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<"backup" | "migrate" | "delete" | null>(null);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const load = async () => {
    setLoading(true);
    setMessage(null);
    try {
      const data = await fetchDataStatus();
      setStatus(data);
      setBackups(data.backups);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const databaseStatus = useMemo(() => {
    if (!status) return "";
    if (!status.database.configured) return "未配置 PostgreSQL";
    if (status.database.readPrimary === "postgres") return "PostgreSQL 已作为主读源";
    return "JSON 仍为主读源";
  }, [status]);

  const handleBackup = async () => {
    setBusy("backup");
    setMessage(null);
    try {
      const backup = await createDataBackup();
      setBackups((current) => [backup, ...current]);
      setMessage({ type: "success", text: "备份已创建。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleMigrate = async () => {
    setBusy("migrate");
    setMessage(null);
    try {
      const result = await migrateDataToPostgres();
      setStatus((current) => current ? { ...current, database: result.database, counts: result.counts } : current);
      setMessage({ type: "success", text: "当前运行数据已同步到 PostgreSQL。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleDelete = async (fileName: string) => {
    if (!window.confirm(`删除备份 ${fileName}？`)) return;
    setBusy("delete");
    setMessage(null);
    try {
      await deleteDataBackup(fileName);
      setBackups((current) => current.filter((item) => item.fileName !== fileName));
      setMessage({ type: "success", text: "备份已删除。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setBusy(null);
    }
  };

  const handleDownload = async (fileName: string) => {
    setMessage(null);
    try {
      await downloadDataBackup(fileName);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  if (loading || !status) {
    return <div className="min-h-full bg-[#08090d] p-8 text-sm text-[#8f97aa]">加载数据管理中...</div>;
  }

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">数据迁移与备份</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">同步当前运行数据到 PostgreSQL，并创建可下载的 JSON 备份。</p>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
          {databaseStatus}
        </div>
      </div>

      <div className="mb-6 grid gap-4 md:grid-cols-4">
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">运行源</div>
          <div className="mt-1 text-sm text-white">{status.runtime}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">风格数</div>
          <div className="mt-1 text-sm text-white">{status.counts.styles}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">备份数</div>
          <div className="mt-1 text-sm text-white">{backups.length}</div>
        </div>
        <div className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
          <div className="text-xs text-[#7f8798]">PostgreSQL</div>
          <div className="mt-1 text-sm text-white">{status.database.configured ? "已配置" : "未配置"}</div>
        </div>
      </div>

      {message ? (
        <div className={message.type === "success" ? "mb-6 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "mb-6 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
          {message.text}
        </div>
      ) : null}

      <div className="mb-6 flex flex-wrap gap-3">
        <Button type="button" onClick={() => void load()} className="h-11 rounded-xl bg-white/[0.06] px-5 text-white hover:bg-white/[0.10]">
          <RefreshCw className="mr-2 h-4 w-4" />
          刷新
        </Button>
        <Button type="button" onClick={() => void handleMigrate()} disabled={busy !== null || !status.database.configured} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300 disabled:opacity-50">
          <UploadCloud className="mr-2 h-4 w-4" />
          {busy === "migrate" ? "同步中" : "同步到 PostgreSQL"}
        </Button>
        <Button type="button" onClick={() => void handleBackup()} disabled={busy !== null} className="h-11 rounded-xl bg-white/[0.06] px-5 text-white hover:bg-white/[0.10]">
          <Database className="mr-2 h-4 w-4" />
          {busy === "backup" ? "备份中" : "创建备份"}
        </Button>
      </div>

      <div className="mb-8 grid gap-4 lg:grid-cols-5">
        {[
          ["appStateKeys", status.counts.appStateKeys],
          ["jobs", status.counts.jobs],
          ["agents", status.counts.agents],
          ["styles", status.counts.styles],
          ["categories", status.counts.styleCategories],
        ].map(([label, value]) => (
          <div key={label as string} className="rounded-2xl border border-white/[0.08] bg-[#11141b] px-4 py-3">
            <div className="text-xs text-[#7f8798]">{label as string}</div>
            <div className="mt-1 text-sm text-white">{value as number}</div>
          </div>
        ))}
      </div>

      <div className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-5 flex items-center justify-between gap-3">
          <div>
            <div className="text-lg font-semibold text-white">备份文件</div>
            <div className="mt-1 text-xs text-[#8f97aa]">备份保存在 `backend/data/backups`，可直接下载。</div>
          </div>
        </div>

        <div className="mb-5 grid gap-3 md:grid-cols-2">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs leading-6 text-[#cfd6e2]">
            已包含：运行状态 JSON、后台配置、本地 uploads 清单、对象存储对象清单。
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs leading-6 text-[#cfd6e2]">
            未包含：文件二进制、pg_dump、源码、构建产物、日志和环境变量。
          </div>
        </div>

        <div className="space-y-3">
          {backups.length ? backups.map((item) => (
            <div key={item.fileName} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm text-white">{item.fileName}</div>
                  <div className="mt-1 text-xs text-[#8f97aa]">
                    {formatBytes(item.size)} · {formatTime(item.createdAt)}
                    {item.summary ? ` · ${item.summary.styles} 个风格 · ${item.summary.localUploads ?? 0} 个本地文件 · ${item.summary.objectStorageObjects ?? 0} 个对象存储对象` : ""}
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => void handleDownload(item.fileName)} className="inline-flex h-9 items-center gap-2 rounded-xl bg-cyan-400 px-4 text-sm font-medium text-black hover:bg-cyan-300">
                    <Download className="h-4 w-4" />
                    下载
                  </button>
                  <button type="button" onClick={() => void handleDelete(item.fileName)} disabled={busy === "delete"} className="inline-flex h-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-[#cfd6e2] hover:bg-red-500/10 hover:text-red-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            </div>
          )) : (
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-8 text-center text-sm text-[#8f97aa]">
              暂无备份。
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
