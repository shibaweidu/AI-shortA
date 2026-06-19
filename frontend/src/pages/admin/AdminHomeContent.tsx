import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { RichTextEditor } from "../../components/editor/RichTextEditor";
import "../../components/editor/RichTextEditor.css";
import { getDisplayAssetUrl } from "../../lib/utils";
import { uploadImageFiles } from "../../services/uploads";
import {
  DEFAULT_SITE_LOGO_URL,
  createSiteContentBlock,
  normalizeSiteNavItem,
  useSiteContentStore,
  type SiteNavItem,
} from "../../store/siteContentStore";

function createNavItem(): SiteNavItem {
  return {
    id: `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: "新页面",
    pageTitle: "新页面",
    enabled: true,
    blocks: [createSiteContentBlock("paragraph")],
    richContent: "<p>在此输入页面内容...</p>",
  };
}

export default function AdminHomeContent() {
  const {
    siteLogoUrl,
    siteTitle,
    siteTagline,
    customNavItems,
    homeTitle,
    homeHighlight,
    homeSubtitle,
    setSiteBrand,
    setCustomNavItems,
    setHomeContent,
  } = useSiteContentStore();

  const [logoUrl, setLogoUrl] = useState(siteLogoUrl);
  const [brandTitle, setBrandTitle] = useState(siteTitle);
  const [tagline, setTagline] = useState(siteTagline);
  const [navItems, setNavItems] = useState<SiteNavItem[]>(customNavItems.map(normalizeSiteNavItem));
  const [selectedNavId, setSelectedNavId] = useState(navItems[0]?.id ?? "");
  const [title, setTitle] = useState(homeTitle);
  const [highlight, setHighlight] = useState(homeHighlight);
  const [subtitle, setSubtitle] = useState(homeSubtitle);
  const [message, setMessage] = useState("");
  const [uploading, setUploading] = useState(false);

  useEffect(() => {
    const normalized = customNavItems.map(normalizeSiteNavItem);
    setLogoUrl(siteLogoUrl);
    setBrandTitle(siteTitle);
    setTagline(siteTagline);
    setNavItems(normalized);
    setSelectedNavId((current) => current && normalized.some((item) => item.id === current) ? current : normalized[0]?.id ?? "");
    setTitle(homeTitle);
    setHighlight(homeHighlight);
    setSubtitle(homeSubtitle);
  }, [customNavItems, homeHighlight, homeSubtitle, homeTitle, siteLogoUrl, siteTagline, siteTitle]);

  const selectedItem = useMemo(() => navItems.find((item) => item.id === selectedNavId) ?? null, [navItems, selectedNavId]);
  const setSelectedItem = (patch: Partial<SiteNavItem>) => {
    if (!selectedItem) return;
    setNavItems((items) => items.map((item) => item.id === selectedItem.id ? { ...item, ...patch } : item));
  };

  const handleUploadLogo = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setUploading(true);
    setMessage("");
    try {
      const [uploaded] = await uploadImageFiles([file]);
      if (uploaded?.url) setLogoUrl(uploaded.url);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setUploading(false);
    }
  };

  const addNavItem = () => {
    const item = createNavItem();
    setNavItems((items) => [...items, item]);
    setSelectedNavId(item.id);
  };

  const removeNavItem = (id: string) => {
    setNavItems((items) => {
      const next = items.filter((item) => item.id !== id);
      if (selectedNavId === id) setSelectedNavId(next[0]?.id ?? "");
      return next;
    });
  };

  const handleUploadEditorImage = async (files: File[]): Promise<string[]> => {
    if (!files.length) return [];
    setUploading(true);
    try {
      const uploaded = await uploadImageFiles(files);
      return uploaded.map((file) => getDisplayAssetUrl(file.url)).filter((url): url is string => Boolean(url));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      throw error;
    } finally {
      setUploading(false);
    }
  };

  const save = () => {
    const cleanedNavItems = navItems
      .map(normalizeSiteNavItem)
      .map((item) => ({
        ...item,
        label: item.label.trim(),
        pageTitle: (item.pageTitle || item.label).trim(),
        richContent: item.richContent?.trim() || undefined,
      }))
      .filter((item) => {
        if (!item.label || !item.pageTitle) return false;
        // 有富文本内容就认为有效
        if (item.richContent && item.richContent.trim()) return true;
        // 否则检查 blocks（向后兼容）
        return item.blocks.some((block) => {
          if (block.type === "image" || block.type === "file") return Boolean(block.url);
          return Boolean(block.text.trim());
        });
      });

    setSiteBrand({
      siteLogoUrl: logoUrl.trim() || DEFAULT_SITE_LOGO_URL,
      siteTitle: brandTitle.trim() || "考拉AI",
      siteTagline: tagline.trim(),
    });
    setCustomNavItems(cleanedNavItems);
    setHomeContent({ homeTitle: title, homeHighlight: highlight, homeSubtitle: subtitle });
    setNavItems(cleanedNavItems);
    setSelectedNavId((current) => current && cleanedNavItems.some((item) => item.id === current) ? current : cleanedNavItems[0]?.id ?? "");
    setMessage("站点配置已保存，前台刷新后即可查看。");
  };

  return (
    <div className="flex h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#08090d] p-6 text-white">
      <div className="mb-5 shrink-0">
        <h1 className="text-2xl font-semibold text-white">站点内容</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">配置网站品牌、首页文案，以及全局导航的自定义内容页。</p>
      </div>

      <div className="grid min-h-0 flex-1 gap-5 overflow-hidden xl:grid-cols-[400px_minmax(0,1fr)]">
        <div className="min-h-0 overflow-y-auto pr-1">
          <div className="space-y-5">
            <section className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
              <h2 className="text-lg font-semibold">品牌信息</h2>
              <div className="mt-4 grid gap-4">
                <label className="flex cursor-pointer items-center gap-4 rounded-2xl border border-dashed border-white/[0.12] bg-[#0b0d12] p-4">
                  <input type="file" accept="image/*" className="hidden" onChange={handleUploadLogo} />
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-2xl border border-white/[0.08] bg-white/[0.03]">
                    {logoUrl ? <img src={getDisplayAssetUrl(logoUrl)} alt="网站 logo" className="h-full w-full object-contain" /> : <ImagePlus className="h-7 w-7 text-[#8f97aa]" />}
                  </div>
                  <div className="min-w-0">
                    <div className="font-medium text-white">{uploading ? "正在上传..." : "上传或替换 logo"}</div>
                    <div className="mt-2 text-xs leading-relaxed text-[#8f97aa]">建议上传透明 PNG 或方形图片。</div>
                  </div>
                </label>

                <Input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} placeholder="Logo URL" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
                <Input value={brandTitle} onChange={(event) => setBrandTitle(event.target.value)} placeholder="网站名称" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
                <Input value={tagline} onChange={(event) => setTagline(event.target.value)} placeholder="广告语" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              </div>
            </section>

            <section className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
              <div className="flex items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">全局导航页面</h2>
                <Button type="button" onClick={addNavItem} className="h-10 rounded-xl bg-cyan-400 px-3 text-black hover:bg-cyan-300">
                  <Plus className="mr-2 h-4 w-4" />
                  新增
                </Button>
              </div>

              <div className="mt-4 space-y-2">
                {navItems.length === 0 ? <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-5 text-sm text-[#8f97aa]">还没有自定义页面。</div> : null}
                {navItems.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedNavId(item.id)}
                    className={item.id === selectedNavId ? "w-full rounded-2xl border border-cyan-300/40 bg-cyan-400/10 p-3 text-left" : "w-full rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3 text-left hover:bg-white/[0.05]"}
                  >
                    <div className="flex items-center gap-3">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold text-white">{item.label || "未命名导航"}</div>
                        <div className="mt-1 truncate text-xs text-[#8f97aa]">{item.pageTitle || "未填写页面标题"}</div>
                      </div>
                      <span className={item.enabled ? "rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200" : "rounded-full bg-white/[0.05] px-2 py-1 text-xs text-[#8f97aa]"}>
                        {item.enabled ? "显示" : "隐藏"}
                      </span>
                    </div>
                  </button>
                ))}
              </div>
            </section>

            <section className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
              <h2 className="text-lg font-semibold">首页主文案</h2>
              <div className="mt-4 space-y-4">
                <Input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="首页标题文本" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
                <Input value={highlight} onChange={(event) => setHighlight(event.target.value)} placeholder="标题高亮文字" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
                <Input value={subtitle} onChange={(event) => setSubtitle(event.target.value)} placeholder="首页副标题" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              </div>
            </section>

            <Button type="button" onClick={save} className="h-11 w-full rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
              <Save className="mr-2 h-4 w-4" />
              保存站点配置
            </Button>
            {message ? <div className="rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100">{message}</div> : null}
          </div>
        </div>

        <section className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
          {selectedItem ? (
            <>
              <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">编辑内容页</h2>
                  <p className="mt-1 text-xs text-[#8f97aa]">使用富文本编辑器编排页面内容，支持图片、链接等。</p>
                </div>
                <button type="button" onClick={() => removeNavItem(selectedItem.id)} className="flex h-10 w-10 items-center justify-center rounded-xl border border-red-400/20 bg-red-500/10 text-red-200 hover:text-red-100">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>

              <div className="mb-3 grid shrink-0 gap-3 md:grid-cols-2">
                <Input value={selectedItem.label} onChange={(event) => setSelectedItem({ label: event.target.value })} placeholder="导航名称" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
                <Input value={selectedItem.pageTitle} onChange={(event) => setSelectedItem({ pageTitle: event.target.value })} placeholder="页面标题" className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              </div>

              <div className="mb-3 flex shrink-0 items-center gap-2">
                <label className="flex items-center gap-2 rounded-full bg-white/[0.04] px-3 py-1.5 text-sm text-[#d5d9e2]">
                  <input type="checkbox" checked={selectedItem.enabled} onChange={(event) => setSelectedItem({ enabled: event.target.checked })} />
                  前台显示
                </label>
              </div>

              <div className="min-h-0 flex-1 overflow-hidden">
                <RichTextEditor
                  content={selectedItem.richContent || "<p>开始输入内容...</p>"}
                  onChange={(html) => setSelectedItem({ richContent: html })}
                  placeholder="开始输入页面内容..."
                  onImageUpload={handleUploadEditorImage}
                />
              </div>
            </>
          ) : (
            <div className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] text-center">
              <div className="text-lg font-semibold">选择或新增一个导航页面</div>
              <Button type="button" onClick={addNavItem} className="mt-4 h-10 rounded-xl bg-cyan-400 px-4 text-black hover:bg-cyan-300">
                <Plus className="mr-2 h-4 w-4" />
                新增页面
              </Button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
