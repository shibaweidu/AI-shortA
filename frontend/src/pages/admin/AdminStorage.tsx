import { useEffect, useState } from "react";
import { Database, RefreshCw, Save, Trash2, UploadCloud } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import {
  deleteObjectStorageObject,
  getObjectStorageConfig,
  listObjectStorageObjects,
  testObjectStorage,
  updateObjectStorageConfig,
  type ObjectStorageConfig,
  type ObjectStorageConfigUpdate,
  type ObjectStorageItem,
} from "../../services/storage";

const inputClass = "h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";

function toDraft(config: ObjectStorageConfig): ObjectStorageConfigUpdate {
  return {
    enabled: config.enabled,
    endpoint: config.endpoint,
    region: config.region,
    bucket: config.bucket,
    accessKeyId: config.accessKeyId,
    secretAccessKey: "",
    publicBaseUrl: config.publicBaseUrl,
    prefix: config.prefix,
    forcePathStyle: config.forcePathStyle,
    useBackendProxy: config.useBackendProxy,
  };
}

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

export default function AdminStorage() {
  const [config, setConfig] = useState<ObjectStorageConfig | null>(null);
  const [draft, setDraft] = useState<ObjectStorageConfigUpdate | null>(null);
  const [clearSecret, setClearSecret] = useState(false);
  const [objects, setObjects] = useState<ObjectStorageItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [loadingObjects, setLoadingObjects] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const loadObjects = async (prefix?: string) => {
    setLoadingObjects(true);
    try {
      const data = await listObjectStorageObjects({ prefix, limit: 80 });
      setObjects(data.objects);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setLoadingObjects(false);
    }
  };

  useEffect(() => {
    let mounted = true;
    void getObjectStorageConfig()
      .then((nextConfig) => {
        if (!mounted) return;
        setConfig(nextConfig);
        setDraft(toDraft(nextConfig));
        if (nextConfig.enabled) void loadObjects(nextConfig.prefix);
      })
      .catch((error) => {
        if (mounted) setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    return () => {
      mounted = false;
    };
  }, []);

  const save = async () => {
    if (!draft) return;
    setSaving(true);
    setMessage(null);
    try {
      const nextConfig = await updateObjectStorageConfig({
        ...draft,
        secretAccessKey: draft.secretAccessKey?.trim() ? draft.secretAccessKey : undefined,
        clearSecretAccessKey: clearSecret,
      });
      setConfig(nextConfig);
      setDraft(toDraft(nextConfig));
      setClearSecret(false);
      setMessage({ type: "success", text: "对象存储配置已保存。" });
      if (nextConfig.enabled) void loadObjects(nextConfig.prefix);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    setMessage(null);
    try {
      await testObjectStorage();
      setMessage({ type: "success", text: "连接测试通过。" });
      if (draft?.prefix) void loadObjects(draft.prefix);
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  const removeObject = async (key: string) => {
    if (!window.confirm(`删除对象 ${key}？`)) return;
    setMessage(null);
    try {
      await deleteObjectStorageObject(key);
      setObjects((current) => current.filter((item) => item.key !== key));
      setMessage({ type: "success", text: "对象已删除。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    }
  };

  if (loading || !draft) {
    return <div className="min-h-full bg-[#08090d] p-8 text-sm text-[#8f97aa]">加载对象存储配置中...</div>;
  }

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">对象存储</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">配置 Bitiful S4 / S3 兼容存储，用于保存生成作品和后台上传资源。</p>
        </div>
        <div className={draft.enabled ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-sm text-emerald-100" : "rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-3 text-sm text-[#8f97aa]"}>
          {draft.enabled ? "已启用" : "未启用"}
        </div>
      </div>

      <div className="grid max-w-6xl gap-6 xl:grid-cols-[1fr_420px]">
        <div className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Database className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">S4 配置</div>
              <div className="mt-1 text-xs text-[#8f97aa]">Secret 留空会保留当前已保存的密钥。</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2] md:col-span-2">
              <input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
              启用对象存储保存
            </label>

            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Endpoint</label>
              <Input value={draft.endpoint} onChange={(event) => setDraft({ ...draft, endpoint: event.target.value })} placeholder="https://s3.bitiful.net" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Region</label>
              <Input value={draft.region} onChange={(event) => setDraft({ ...draft, region: event.target.value })} placeholder="cn-east-1" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Bucket</label>
              <Input value={draft.bucket} onChange={(event) => setDraft({ ...draft, bucket: event.target.value })} placeholder="your-bucket" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Prefix</label>
              <Input value={draft.prefix} onChange={(event) => setDraft({ ...draft, prefix: event.target.value })} placeholder="kaola/production/" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Access Key ID</label>
              <Input value={draft.accessKeyId} onChange={(event) => setDraft({ ...draft, accessKeyId: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">Secret Access Key</label>
              <Input type="password" value={draft.secretAccessKey ?? ""} onChange={(event) => setDraft({ ...draft, secretAccessKey: event.target.value })} placeholder={config?.hasSecretAccessKey ? "已保存，留空不修改" : "Secret Access Key"} className={inputClass} />
            </div>
            <div className="md:col-span-2">
              <label className="mb-2 block text-sm text-[#cfd6e2]">Public Base URL</label>
              <Input value={draft.publicBaseUrl} onChange={(event) => setDraft({ ...draft, publicBaseUrl: event.target.value })} placeholder="https://cdn.example.com 或公开 Bucket 域名" className={inputClass} />
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
              <input type="checkbox" checked={draft.forcePathStyle} onChange={(event) => setDraft({ ...draft, forcePathStyle: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
              使用 Path Style
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
              <input type="checkbox" checked={draft.useBackendProxy} onChange={(event) => setDraft({ ...draft, useBackendProxy: event.target.checked })} className="h-4 w-4 accent-cyan-400" />
              后端代理读取
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
              <input type="checkbox" checked={clearSecret} onChange={(event) => setClearSecret(event.target.checked)} className="h-4 w-4 accent-cyan-400" />
              清除已保存 Secret
            </label>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs leading-6 text-[#8f97aa]">
              关闭代理时，前端直接读取 Public Base URL 或 Bucket 默认域名；开启代理时，图片流量经过本站后端。
            </div>
          </div>

          {message ? (
            <div className={message.type === "success" ? "mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
              {message.text}
            </div>
          ) : null}

          <div className="mt-5 flex flex-wrap gap-3">
            <Button type="button" onClick={() => void save()} disabled={saving} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
              <Save className="mr-2 h-4 w-4" />
              {saving ? "保存中" : "保存配置"}
            </Button>
            <Button type="button" onClick={() => void test()} disabled={testing || !config?.enabled} className="h-11 rounded-xl bg-white/[0.06] px-5 text-white hover:bg-white/[0.10]">
              <UploadCloud className="mr-2 h-4 w-4" />
              {testing ? "测试中" : "测试连接"}
            </Button>
          </div>
        </div>

        <div className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
          <div className="mb-6 flex items-center justify-between gap-3">
            <div>
              <div className="text-lg font-semibold text-white">对象列表</div>
              <div className="mt-1 text-xs text-[#8f97aa]">显示当前 Prefix 下最近对象。</div>
            </div>
            <Button type="button" onClick={() => void loadObjects(draft.prefix)} disabled={loadingObjects || !draft.enabled} className="h-9 rounded-xl bg-white/[0.06] px-3 text-white hover:bg-white/[0.10]">
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>

          <div className="space-y-3">
            {objects.length === 0 ? (
              <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-6 text-center text-sm text-[#8f97aa]">
                {draft.enabled ? "暂无对象或尚未加载。" : "启用并测试对象存储后显示对象。"}
              </div>
            ) : objects.map((item) => (
              <div key={item.key} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <a href={item.url} target="_blank" rel="noreferrer" className="block truncate text-sm text-cyan-200 hover:text-cyan-100">{item.key}</a>
                    <div className="mt-1 text-xs text-[#8f97aa]">{formatBytes(item.size)} · {item.updatedAt ? new Date(item.updatedAt).toLocaleString("zh-CN") : "-"}</div>
                  </div>
                  <button type="button" onClick={() => void removeObject(item.key)} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-[#8f97aa] transition hover:bg-red-500/10 hover:text-red-200">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
