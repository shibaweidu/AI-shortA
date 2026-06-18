import { useEffect, useMemo, useState } from "react";
import { Brain, Save, Shield, Type } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAdminAuthStore } from "../../store/adminAuthStore";
import { useSiteContentStore } from "../../store/siteContentStore";
import { useSettingsStore } from "../../store/settingsStore";
import { useUserModelStore } from "../../store/userModelStore";
import { buildModelCatalogOptions } from "../../lib/modelCatalog";
import { DEFAULT_REFERENCE_SETTINGS, fetchReferenceSettings, updateReferenceSettings, type ReferenceSettings } from "../../services/referenceSettings";

const referenceRoleLabels: Record<keyof ReferenceSettings["rolePrompts"], string> = {
  character: "角色参考",
  scene: "场景参考",
  object: "物品参考",
  general: "普通参考",
};

export default function AdminSettings() {
  const { account, updateAccount } = useAdminAuthStore();
  const { homeTitle, homeHighlight, homeSubtitle, setHomeContent } = useSiteContentStore();
  const { providers, routing } = useSettingsStore();
  const { providers: userProviders, routing: userRouting } = useUserModelStore();
  const [username, setUsername] = useState(account.username);
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [title, setTitle] = useState(homeTitle);
  const [highlight, setHighlight] = useState(homeHighlight);
  const [subtitle, setSubtitle] = useState(homeSubtitle);
  const [contentMessage, setContentMessage] = useState("");
  const [referenceSettings, setReferenceSettings] = useState<ReferenceSettings>(DEFAULT_REFERENCE_SETTINGS);
  const [referenceMessage, setReferenceMessage] = useState("");
  const [referenceSaving, setReferenceSaving] = useState(false);

  const visionModelOptions = useMemo(
    () => [
      ...buildModelCatalogOptions(providers, routing, "language", "koala"),
      ...buildModelCatalogOptions(userProviders, userRouting, "language", "custom"),
      ...buildModelCatalogOptions(providers, routing, "image", "koala"),
      ...buildModelCatalogOptions(userProviders, userRouting, "image", "custom"),
    ],
    [providers, routing, userProviders, userRouting]
  );

  useEffect(() => {
    void fetchReferenceSettings().then(setReferenceSettings);
  }, []);

  const save = async () => {
    const result = await updateAccount({ username, password, currentPassword });
    if (!result.ok) {
      setMessage({ type: "error", text: result.message });
      return;
    }
    setCurrentPassword("");
    setPassword("");
    setMessage({ type: "success", text: "管理员账号已更新。" });
  };

  const saveHomeContent = () => {
    setHomeContent({ homeTitle: title, homeHighlight: highlight, homeSubtitle: subtitle });
    setContentMessage("首页文案已保存，返回首页即可查看最新内容。");
  };

  const saveReferenceSettings = async () => {
    setReferenceSaving(true);
    setReferenceMessage("");
    try {
      const saved = await updateReferenceSettings(referenceSettings);
      setReferenceSettings(saved);
      setReferenceMessage("参考图识别与提示词配置已保存。");
    } catch (error) {
      setReferenceMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setReferenceSaving(false);
    }
  };

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">管理员设置</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">配置首页文案，并修改后台管理员账号和密码。</p>
      </div>

      <div className="mb-6 max-w-4xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <Brain className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">参考图自动识别</div>
            <div className="mt-1 text-xs text-[#8f97aa]">选择用于推荐参考图类型的视觉模型，并配置不同类型写入生图提示词的文案。</div>
          </div>
        </div>

        <div className="space-y-4">
          <select
            value={referenceSettings.visionModelValue}
            onChange={(event) => setReferenceSettings((current) => ({ ...current, visionModelValue: event.target.value }))}
            className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none"
          >
            <option value="">不启用自动推荐</option>
            {visionModelOptions.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label} · {option.providerName ?? "模型"}
              </option>
            ))}
          </select>

          <textarea
            value={referenceSettings.classificationPrompt}
            onChange={(event) => setReferenceSettings((current) => ({ ...current, classificationPrompt: event.target.value }))}
            className="min-h-[96px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#667085]"
            placeholder="自动分类提示词"
          />

          <div className="grid gap-3 md:grid-cols-2">
            {(Object.keys(referenceRoleLabels) as Array<keyof ReferenceSettings["rolePrompts"]>).map((role) => (
              <label key={role} className="block">
                <span className="mb-1 block text-xs text-[#9aa3b7]">{referenceRoleLabels[role]}</span>
                <textarea
                  value={referenceSettings.rolePrompts[role]}
                  onChange={(event) =>
                    setReferenceSettings((current) => ({
                      ...current,
                      rolePrompts: { ...current.rolePrompts, [role]: event.target.value },
                    }))
                  }
                  className="min-h-[110px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#667085]"
                  placeholder={`{index} 会被替换成图片序号`}
                />
              </label>
            ))}
          </div>

          {referenceMessage ? <div className="rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-[#d5d9e2]">{referenceMessage}</div> : null}
          <Button type="button" onClick={saveReferenceSettings} disabled={referenceSaving} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
            <Save className="mr-2 h-4 w-4" />
            保存参考图配置
          </Button>
        </div>
      </div>

      <div className="mb-6 max-w-xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <Type className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">首页顶部文案</div>
            <div className="mt-1 text-xs text-[#8f97aa]">标题中的第一个空格会替换为高亮文字。</div>
          </div>
        </div>

        <div className="space-y-3">
          <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="标题文本" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input value={highlight} onChange={(event) => setHighlight(event.target.value)} placeholder="高亮文字" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="副标题" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="text-xs uppercase tracking-[0.24em] text-cyan-300/70">Preview</div>
            <div className="mt-2 text-lg font-semibold text-white">
              {title.includes(" ") ? (
                <>
                  {title.slice(0, title.indexOf(" "))} <span className="text-[#10c8ff]">{highlight}</span> {title.slice(title.indexOf(" ") + 1)}
                </>
              ) : (
                title
              )}
            </div>
            <div className="mt-1 text-sm text-white/60">{subtitle}</div>
          </div>
          {contentMessage ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{contentMessage}</div> : null}
          <Button type="button" onClick={saveHomeContent} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
            <Save className="mr-2 h-4 w-4" />
            保存首页文案
          </Button>
        </div>
      </div>

      <div className="max-w-xl rounded-[28px] border border-white/[0.08] bg-[#11141b] p-6">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <div className="text-lg font-semibold text-white">后台登录账号</div>
            <div className="mt-1 text-xs text-[#8f97aa]">上次更新：{new Date(account.updatedAt).toLocaleString("zh-CN")}</div>
          </div>
        </div>

        <div className="space-y-3">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="管理员账号" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input type="password" value={currentPassword} onChange={(event) => setCurrentPassword(event.target.value)} placeholder="当前管理员密码" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="新管理员密码，至少 6 个字符" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          {message ? (
            <div className={message.type === "success" ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
              {message.text}
            </div>
          ) : null}
          <Button type="button" onClick={() => void save()} className="h-11 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
            保存管理员账号
          </Button>
        </div>
      </div>
    </div>
  );
}
