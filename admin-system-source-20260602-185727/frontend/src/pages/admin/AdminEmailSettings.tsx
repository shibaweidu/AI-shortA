import { useEffect, useState } from "react";
import { Mail, Save, Send, Settings2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { getEmailConfig, sendTestEmail, updateEmailConfig, type EmailConfig, type EmailConfigUpdate } from "../../services/email";

const inputClass = "h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";

function toDraft(config: EmailConfig): EmailConfigUpdate {
  return {
    enabled: config.enabled,
    host: config.host,
    port: config.port,
    secure: config.secure,
    username: config.username,
    password: "",
    fromName: config.fromName,
    fromEmail: config.fromEmail,
    subject: config.subject,
    codeTtlMinutes: config.codeTtlMinutes,
  };
}

export default function AdminEmailSettings() {
  const [config, setConfig] = useState<EmailConfig | null>(null);
  const [draft, setDraft] = useState<EmailConfigUpdate | null>(null);
  const [clearPassword, setClearPassword] = useState(false);
  const [testEmail, setTestEmail] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    let mounted = true;
    void getEmailConfig()
      .then((nextConfig) => {
        if (!mounted) return;
        setConfig(nextConfig);
        setDraft(toDraft(nextConfig));
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
      const nextConfig = await updateEmailConfig({
        ...draft,
        password: draft.password?.trim() ? draft.password : undefined,
        clearPassword,
      });
      setConfig(nextConfig);
      setDraft(toDraft(nextConfig));
      setClearPassword(false);
      setMessage({ type: "success", text: "邮箱配置已保存。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setSaving(false);
    }
  };

  const sendTest = async () => {
    setTesting(true);
    setMessage(null);
    try {
      await sendTestEmail(testEmail);
      setMessage({ type: "success", text: "测试邮件已发送。" });
    } catch (error) {
      setMessage({ type: "error", text: error instanceof Error ? error.message : String(error) });
    } finally {
      setTesting(false);
    }
  };

  if (loading || !draft) {
    return <div className="min-h-full bg-[#08090d] p-8 text-sm text-[#8f97aa]">加载邮箱配置中...</div>;
  }

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">邮箱配置</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">配置注册验证码邮件发送所用的 SMTP 服务。</p>
        </div>
        <div className={draft.enabled ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-5 py-3 text-sm text-emerald-100" : "rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-3 text-sm text-[#8f97aa]"}>
          {draft.enabled ? "已启用" : "未启用"}
        </div>
      </div>

      <div className="grid max-w-5xl gap-6 xl:grid-cols-[1fr_360px]">
        <div className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Settings2 className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">SMTP 设置</div>
              <div className="mt-1 text-xs text-[#8f97aa]">密码留空时会保留当前已保存的密码。</div>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2] md:col-span-2">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(event) => setDraft({ ...draft, enabled: event.target.checked })}
                className="h-4 w-4 accent-cyan-400"
              />
              启用邮箱验证码注册
            </label>

            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">SMTP 服务器</label>
              <Input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="smtp.example.com" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">端口</label>
              <Input type="number" min={1} max={65535} value={draft.port} onChange={(event) => setDraft({ ...draft, port: Number(event.target.value) })} className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">SMTP 用户名</label>
              <Input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} placeholder="通常为邮箱地址" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">SMTP 密码/授权码</label>
              <Input type="password" value={draft.password ?? ""} onChange={(event) => setDraft({ ...draft, password: event.target.value })} placeholder={config?.hasPassword ? "已保存，留空不修改" : "邮箱授权码"} className={inputClass} />
            </div>
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
              <input
                type="checkbox"
                checked={draft.secure}
                onChange={(event) => setDraft({ ...draft, secure: event.target.checked })}
                className="h-4 w-4 accent-cyan-400"
              />
              SSL/TLS
            </label>
            <label className="flex items-center gap-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2]">
              <input
                type="checkbox"
                checked={clearPassword}
                onChange={(event) => setClearPassword(event.target.checked)}
                className="h-4 w-4 accent-cyan-400"
              />
              清除已保存密码
            </label>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">发件人名称</label>
              <Input value={draft.fromName} onChange={(event) => setDraft({ ...draft, fromName: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">发件邮箱</label>
              <Input value={draft.fromEmail} onChange={(event) => setDraft({ ...draft, fromEmail: event.target.value })} placeholder="noreply@example.com" className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">邮件标题</label>
              <Input value={draft.subject} onChange={(event) => setDraft({ ...draft, subject: event.target.value })} className={inputClass} />
            </div>
            <div>
              <label className="mb-2 block text-sm text-[#cfd6e2]">验证码有效期（分钟）</label>
              <Input type="number" min={1} max={60} value={draft.codeTtlMinutes} onChange={(event) => setDraft({ ...draft, codeTtlMinutes: Number(event.target.value) })} className={inputClass} />
            </div>
          </div>

          {message ? (
            <div className={message.type === "success" ? "mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
              {message.text}
            </div>
          ) : null}

          <Button type="button" onClick={() => void save()} disabled={saving} className="mt-5 h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
            <Save className="mr-2 h-4 w-4" />
            {saving ? "保存中" : "保存配置"}
          </Button>
        </div>

        <div className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
          <div className="mb-6 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Mail className="h-5 w-5" />
            </div>
            <div>
              <div className="text-lg font-semibold text-white">发送测试邮件</div>
              <div className="mt-1 text-xs text-[#8f97aa]">保存配置后再测试发送。</div>
            </div>
          </div>

          <div className="space-y-3">
            <Input value={testEmail} onChange={(event) => setTestEmail(event.target.value)} placeholder="测试收件邮箱" className={inputClass} />
            <Button type="button" onClick={() => void sendTest()} disabled={testing || !testEmail.trim()} className="h-11 w-full rounded-xl bg-white/[0.06] text-white hover:bg-white/[0.10]">
              <Send className="mr-2 h-4 w-4" />
              {testing ? "发送中" : "发送测试"}
            </Button>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3 text-xs leading-6 text-[#8f97aa]">
              当前密码状态：{config?.hasPassword ? "已保存" : "未保存"}
              <br />
              上次更新：{config ? new Date(config.updatedAt).toLocaleString("zh-CN") : "-"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
