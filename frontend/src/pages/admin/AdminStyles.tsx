import { useEffect, useMemo, useState, type ChangeEvent } from "react";
import { ImagePlus, Plus, Save, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { getDisplayAssetUrl } from "../../lib/utils";
import {
  createStyleCategory,
  createStylePreset,
  deleteStyleCategory,
  deleteStylePreset,
  fetchStyleLibrary,
  updateStyleCategory,
  updateStylePreset,
  uploadStyleImage,
  type StyleCategory,
  type StylePreset,
} from "../../services/styleLibrary";

type DraftStyle = Pick<StylePreset, "name" | "coverImageUrl" | "prompt" | "strength" | "categoryIds" | "sampleImageUrls" | "isNew" | "isActive">;

const emptyDraft: DraftStyle = {
  name: "",
  coverImageUrl: "",
  prompt: "",
  strength: 0.65,
  categoryIds: [],
  sampleImageUrls: [],
  isNew: false,
  isActive: true,
};

export default function AdminStyles() {
  const [categories, setCategories] = useState<StyleCategory[]>([]);
  const [styles, setStyles] = useState<StylePreset[]>([]);
  const [categoryName, setCategoryName] = useState("");
  const [draft, setDraft] = useState<DraftStyle>(emptyDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  const editableCategories = useMemo(
    () => categories.filter((category) => !["all", "my", "recent"].includes(category.id)),
    [categories]
  );

  const load = async () => {
    const library = await fetchStyleLibrary(true);
    setCategories(library.categories);
    setStyles(library.styles);
  };

  useEffect(() => {
    void load().catch((error) => setMessage(error instanceof Error ? error.message : String(error)));
  }, []);

  const resetDraft = () => {
    setDraft(emptyDraft);
    setEditingId(null);
  };

  const handleAddCategory = async () => {
    if (!categoryName.trim()) return;
    setLoading(true);
    try {
      await createStyleCategory({ name: categoryName.trim(), order: categories.length });
      setCategoryName("");
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleUploadCover = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setLoading(true);
    try {
      const url = await uploadStyleImage(file);
      setDraft((current) => ({ ...current, coverImageUrl: url }));
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  const handleSaveStyle = async () => {
    if (!draft.name.trim() || !draft.coverImageUrl.trim()) {
      setMessage("请填写风格名称并上传或填写封面图。");
      return;
    }
    setLoading(true);
    try {
      if (editingId) {
        await updateStylePreset(editingId, draft);
        setMessage("风格已更新。");
      } else {
        await createStylePreset(draft);
        setMessage("风格已添加。");
      }
      resetDraft();
      await load();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex h-[100dvh] max-h-[100dvh] min-h-0 flex-col overflow-hidden bg-[#08090d] p-6 text-white 2xl:p-8">
      <div className="mb-5 shrink-0">
        <h1 className="text-2xl font-semibold text-white">风格库管理</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">管理图生图风格库、分类、封面图和风格提示词。</p>
      </div>

      {message ? (
        <div className="mb-5 shrink-0 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-[#d5d9e2]">{message}</div>
      ) : null}

      <div className="grid min-h-0 flex-1 overflow-hidden gap-5 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
          <h2 className="mb-4 shrink-0 text-lg font-semibold">分类</h2>
          <div className="mb-4 flex shrink-0 gap-2">
            <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="新分类名称" className="border-white/[0.08] bg-white/[0.03] text-white" />
            <Button onClick={handleAddCategory} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="grid shrink-0 grid-cols-4 gap-2">
            {categories.map((category) => (
              <div key={category.id} className="relative flex min-w-0 items-center rounded-xl bg-white/[0.04] px-1.5 py-1.5">
                <Input
                  value={category.name}
                  disabled={["all", "my", "recent"].includes(category.id)}
                  onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))}
                  onBlur={() => void updateStyleCategory(category.id, { name: category.name }).then(load)}
                  className="h-7 min-w-0 rounded-lg border-white/[0.08] bg-white/[0.02] px-0.5 pr-3 text-center text-[10px] text-white disabled:pr-0"
                />
                {!["all", "my", "recent"].includes(category.id) ? (
                  <button type="button" onClick={() => void deleteStyleCategory(category.id).then(load)} className="absolute right-1 top-1/2 -translate-y-1/2 text-red-200 hover:text-red-100">
                    <Trash2 className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="grid min-h-0 overflow-hidden gap-5 lg:grid-cols-[320px_minmax(0,1fr)] 2xl:grid-cols-[360px_minmax(0,1fr)]">
          <div className="flex min-h-0 flex-col overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
            <div className="mb-4 flex shrink-0 items-center justify-between gap-3">
              <h2 className="text-lg font-semibold">{editingId ? "编辑风格" : "新增风格"}</h2>
              {editingId ? <button type="button" onClick={resetDraft} className="text-sm text-[#8f97aa] hover:text-white">取消</button> : null}
            </div>

            <div className="min-h-0 flex-1 pr-1">
              <label className="mb-4 flex h-[210px] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/[0.12] bg-[#0b0d12] 2xl:h-[240px]">
                <input type="file" accept="image/*" className="hidden" onChange={handleUploadCover} />
                {draft.coverImageUrl ? (
                  <img src={getDisplayAssetUrl(draft.coverImageUrl)} alt="cover" className="h-full w-full object-contain" />
                ) : (
                  <div className="flex flex-col items-center text-[#8f97aa]">
                    <ImagePlus className="h-8 w-8" />
                    <span className="mt-2 text-sm">上传封面</span>
                  </div>
                )}
              </label>

              <div className="space-y-3">
                <Input value={draft.name} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} placeholder="风格名称" className="border-white/[0.08] bg-white/[0.03] text-white" />
                <Input value={draft.coverImageUrl} onChange={(event) => setDraft((current) => ({ ...current, coverImageUrl: event.target.value }))} placeholder="封面图 URL" className="border-white/[0.08] bg-white/[0.03] text-white" />
                <textarea value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} placeholder="风格提示词，建议描述色彩、光影、笔触、材质、渲染方式" className="h-[96px] w-full resize-none rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#667085] 2xl:h-[108px]" />
                <div className="flex flex-wrap gap-2">
                  {editableCategories.map((category) => {
                    const checked = draft.categoryIds.includes(category.id);
                    return (
                      <label key={category.id} className="flex cursor-pointer items-center gap-2 rounded-full bg-white/[0.05] px-3 py-1.5 text-sm text-[#d5d9e2]">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={(event) => setDraft((current) => ({
                            ...current,
                            categoryIds: event.target.checked
                              ? [...current.categoryIds, category.id]
                              : current.categoryIds.filter((id) => id !== category.id),
                          }))}
                        />
                        {category.name}
                      </label>
                    );
                  })}
                </div>
                <div className="flex items-center gap-3">
                  <label className="text-sm text-[#9aa3b7]">强度</label>
                  <input className="min-w-0 flex-1 accent-cyan-400" type="range" min="0" max="1" step="0.05" value={draft.strength} onChange={(event) => setDraft((current) => ({ ...current, strength: Number(event.target.value) }))} />
                  <span className="w-10 text-right text-sm text-white">{Math.round(draft.strength * 100)}%</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex shrink-0 gap-3 border-t border-white/[0.06] pt-4">
              <Button onClick={handleSaveStyle} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
                <Save className="mr-2 h-4 w-4" />
                保存风格
              </Button>
              {editingId ? <Button variant="outline" onClick={resetDraft} className="border-white/[0.08] bg-white/[0.03] text-white">取消编辑</Button> : null}
            </div>
          </div>

          <div className="flex min-h-0 flex-col rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
            <div className="mb-4 flex shrink-0 items-end justify-between gap-3">
              <div>
                <h2 className="text-lg font-semibold">风格列表</h2>
                <p className="mt-1 text-xs text-[#8f97aa]">{styles.length} 个风格，可独立滚动浏览。</p>
              </div>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto pr-1">
              <div className="grid grid-cols-4 gap-3">
                {styles.map((style) => (
                  <article key={style.id} className={editingId === style.id ? "overflow-hidden rounded-xl border border-cyan-300/50 bg-cyan-400/10" : "overflow-hidden rounded-xl border border-white/[0.08] bg-white/[0.03]"}>
                    <div className="aspect-[4/5] bg-[#0b0d12]">
                      <img src={getDisplayAssetUrl(style.coverImageUrl)} alt={style.name} className="h-full w-full object-contain" />
                    </div>
                    <div className="p-3">
                      <div className="truncate text-sm font-semibold text-white">{style.name}</div>
                      <div className="mt-1 line-clamp-2 min-h-[30px] text-[11px] leading-4 text-[#8f97aa]">{style.prompt || "未填写风格提示词"}</div>
                      <div className="mt-3 flex gap-2">
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => {
                            setEditingId(style.id);
                            setDraft({
                              name: style.name,
                              coverImageUrl: style.coverImageUrl,
                              prompt: style.prompt,
                              strength: style.strength,
                              categoryIds: style.categoryIds,
                              sampleImageUrls: style.sampleImageUrls,
                              isNew: style.isNew === true,
                              isActive: style.isActive,
                            });
                          }}
                          className="border-white/[0.08] bg-white/[0.03] text-white"
                        >
                          编辑
                        </Button>
                        <Button variant="outline" size="sm" onClick={() => void deleteStylePreset(style.id).then(load)} className="border-red-400/20 bg-red-500/10 text-red-200">
                          删除
                        </Button>
                      </div>
                    </div>
                  </article>
                ))}
              </div>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}
