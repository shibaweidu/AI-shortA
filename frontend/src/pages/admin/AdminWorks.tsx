import { useState, useRef } from "react";
import { Plus, Trash2, Image as ImageIcon } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { useDiscoverStore } from "../../store/discoverStore";

export default function AdminWorks() {
  const { categories, works, addWork, removeWork, hasHydrated } = useDiscoverStore();
  const [selectedCategory, setSelectedCategory] = useState("");
  const [title, setTitle] = useState("");
  const [prompt, setPrompt] = useState("");
  const [model, setModel] = useState("");
  const [aspectRatio, setAspectRatio] = useState("16:9");
  const [resolution, setResolution] = useState("1080p");
  const [coverUrl, setCoverUrl] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);

  const handleImageUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      setCoverUrl(event.target?.result as string);
    };
    reader.readAsDataURL(file);
  };

  const handleAdd = () => {
    if (!title.trim() || !prompt.trim() || !model.trim() || !coverUrl || !selectedCategory) {
      alert("请填写完整信息并上传封面图");
      return;
    }

    addWork({
      categoryId: selectedCategory,
      title: title.trim(),
      prompt: prompt.trim(),
      model: model.trim(),
      aspectRatio,
      resolution,
      coverUrl,
      order: Date.now(),
    });

    setTitle("");
    setPrompt("");
    setModel("");
    setCoverUrl("");
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  if (!hasHydrated) return null;

  const categoryWorks = selectedCategory
    ? works.filter((w) => w.categoryId === selectedCategory)
    : works;

  return (
    <div className="mx-auto max-w-6xl p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">作品管理</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">发布和管理发现页面的作品</p>
      </div>

      <div className="mb-8 rounded-3xl border border-white/[0.08] bg-[#11141b] p-6">
        <h2 className="mb-4 text-lg font-medium text-white">发布新作品</h2>
        <div className="grid gap-4 md:grid-cols-2">
          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">所属栏目</label>
            <select
              value={selectedCategory}
              onChange={(e) => setSelectedCategory(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white"
            >
              <option value="">选择栏目</option>
              {categories.map((cat) => (
                <option key={cat.id} value={cat.id}>
                  {cat.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">作品标题</label>
            <Input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="输入作品标题"
              className="border-white/[0.08] bg-white/[0.03] text-white"
            />
          </div>

          <div className="md:col-span-2">
            <label className="mb-2 block text-sm text-[#9aa3b7]">提示词</label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="输入生成提示词"
              className="min-h-[100px] border-white/[0.08] bg-white/[0.03] text-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">生成模型</label>
            <Input
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="如: FLUX.1 Pro"
              className="border-white/[0.08] bg-white/[0.03] text-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">比例</label>
            <select
              value={aspectRatio}
              onChange={(e) => setAspectRatio(e.target.value)}
              className="h-11 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 text-white"
            >
              <option value="16:9">16:9</option>
              <option value="9:16">9:16</option>
              <option value="1:1">1:1</option>
              <option value="4:3">4:3</option>
              <option value="3:4">3:4</option>
            </select>
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">分辨率</label>
            <Input
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              placeholder="如: 1080p"
              className="border-white/[0.08] bg-white/[0.03] text-white"
            />
          </div>

          <div>
            <label className="mb-2 block text-sm text-[#9aa3b7]">封面图</label>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleImageUpload}
              className="hidden"
            />
            <Button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              variant="outline"
              className="w-full border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
            >
              <ImageIcon className="mr-2 h-4 w-4" />
              {coverUrl ? "已上传" : "上传图片"}
            </Button>
          </div>
        </div>

        {coverUrl && (
          <div className="mt-4">
            <img src={coverUrl} alt="预览" className="h-32 rounded-xl object-cover" />
          </div>
        )}

        <Button onClick={handleAdd} className="mt-4 bg-cyan-400 text-black hover:bg-cyan-300">
          <Plus className="mr-2 h-4 w-4" />
          发布作品
        </Button>
      </div>

      <div>
        <div className="mb-4 flex items-center gap-3">
          <h2 className="text-lg font-medium text-white">已发布作品</h2>
          <select
            value={selectedCategory}
            onChange={(e) => setSelectedCategory(e.target.value)}
            className="h-9 rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white"
          >
            <option value="">全部栏目</option>
            {categories.map((cat) => (
              <option key={cat.id} value={cat.id}>
                {cat.name}
              </option>
            ))}
          </select>
        </div>

        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {categoryWorks.map((work) => {
            const category = categories.find((c) => c.id === work.categoryId);
            return (
              <div
                key={work.id}
                className="overflow-hidden rounded-2xl border border-white/[0.08] bg-[#11141b]"
              >
                <img src={work.coverUrl} alt={work.title} className="aspect-video w-full object-cover" />
                <div className="p-4">
                  <div className="mb-2 text-sm text-[#8f97aa]">{category?.name}</div>
                  <div className="mb-2 font-medium text-white">{work.title}</div>
                  <div className="mb-3 line-clamp-2 text-xs text-[#7f8798]">{work.prompt}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (confirm(`确定删除作品"${work.title}"？`)) {
                        removeWork(work.id);
                      }
                    }}
                    className="w-full border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
                  >
                    <Trash2 className="mr-2 h-4 w-4" />
                    删除
                  </Button>
                </div>
              </div>
            );
          })}
        </div>

        {categoryWorks.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center text-[#8f97aa]">
            {selectedCategory ? "该栏目下还没有作品" : "还没有发布任何作品"}
          </div>
        )}
      </div>
    </div>
  );
}
