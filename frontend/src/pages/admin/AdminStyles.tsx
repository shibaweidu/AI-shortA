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
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">风格库管理</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">管理图生图风格库、分类、封面图和风格提示词。</p>
      </div>

      {message ? <div className="mb-5 rounded-2xl border border-white/[0.08] bg-white/[0.04] px-4 py-3 text-sm text-[#d5d9e2]">{message}</div> : null}

      <div className="mb-6 grid gap-6 xl:grid-cols-[380px_1fr]">
        <section className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
          <h2 className="mb-4 text-lg font-semibold">分类</h2>
          <div className="mb-4 flex gap-2">
            <Input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="新分类名称" className="border-white/[0.08] bg-white/[0.03] text-white" />
            <Button onClick={handleAddCategory} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
              <Plus className="h-4 w-4" />
            </Button>
          </div>
          <div className="space-y-2">
            {categories.map((category) => (
              <div key={category.id} className="flex items-center gap-2 rounded-xl bg-white/[0.04] px-3 py-2">
                <Input
                  value={category.name}
                  disabled={["all", "my", "recent"].includes(category.id)}
                  onChange={(event) => setCategories((current) => current.map((item) => item.id === category.id ? { ...item, name: event.target.value } : item))}
                  onBlur={() => void updateStyleCategory(category.id, { name: category.name }).then(load)}
                  className="h-8 border-white/[0.08] bg-transparent text-white"
                />
                {!["all", "my", "recent"].includes(category.id) ? (
                  <button type="button" onClick={() => void deleteStyleCategory(category.id).then(load)} className="text-red-200 hover:text-red-100">
                    <Trash2 className="h-4 w-4" />
                  </button>
                ) : null}
              </div>
            ))}
          </div>
        </section>

        <section className="rounded-[24px] border border-white/[0.08] bg-[#11141b] p-5">
          <h2 className="mb-4 text-lg font-semibold">{editingId ? "编辑风格" : "新增风格"}</h2>
          <div className="grid gap-4 lg:grid-cols-[180px_1fr]">
            <label className="flex aspect-[9/16] cursor-pointer items-center justify-center overflow-hidden rounded-2xl border border-dashed border-white/[0.12] bg-white/[0.04]">
              <input type="file" accept="image/*" className="hidden" onChange={handleUploadCover} />
              {draft.coverImageUrl ? (
                <img src={getDisplayAssetUrl(draft.coverImageUrl)} alt="cover" className="h-full w-full object-cover" />
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
              <textarea value={draft.prompt} onChange={(event) => setDraft((current) => ({ ...current, prompt: event.target.value }))} placeholder="风格提示词，建议描述色彩、光影、笔触、材质、渲染方式" className="min-h-[96px] w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-sm text-white outline-none placeholder:text-[#667085]" />
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
                <input type="range" min="0" max="1" step="0.05" value={draft.strength} onChange={(event) => setDraft((current) => ({ ...current, strength: Number(event.target.value) }))} />
                <span className="text-sm text-white">{Math.round(draft.strength * 100)}%</span>
              </div>
              <div className="flex gap-3">
                <Button onClick={handleSaveStyle} disabled={loading} className="bg-cyan-400 text-black hover:bg-cyan-300">
                  <Save className="mr-2 h-4 w-4" />
                  保存风格
                </Button>
                {editingId ? <Button variant="outline" onClick={resetDraft} className="border-white/[0.08] bg-white/[0.03] text-white">取消编辑</Button> : null}
              </div>
            </div>
          </div>
        </section>
      </div>

      <div className="grid gap-4 md:grid-cols-3 xl:grid-cols-5">
        {styles.map((style) => (
          <article key={style.id} className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141b]">
            <div className="aspect-[9/16] bg-[#1b1e25]">
              <img src={getDisplayAssetUrl(style.coverImageUrl)} alt={style.name} className="h-full w-full object-cover" />
            </div>
            <div className="p-4">
              <div className="font-semibold text-white">{style.name}</div>
              <div className="mt-1 line-clamp-2 text-xs text-[#8f97aa]">{style.prompt || "未填写风格提示词"}</div>
              <div className="mt-4 flex gap-2">
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
  );
}
