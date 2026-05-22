import { useState } from "react";
import { Plus, Trash2, GripVertical } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useDiscoverStore } from "../../store/discoverStore";

export default function AdminCategories() {
  const { categories, works, addCategory, updateCategory, removeCategory, hasHydrated } = useDiscoverStore();
  const [newName, setNewName] = useState("");

  const handleAdd = () => {
    if (!newName.trim()) return;
    addCategory({ name: newName });
    setNewName("");
  };

  if (!hasHydrated) return null;

  return (
    <div className="mx-auto max-w-4xl p-6">
      <div className="mb-8">
        <h1 className="text-2xl font-semibold text-white">栏目管理</h1>
        <p className="mt-2 text-sm text-[#8f97aa]">管理发现页面的栏目分类</p>
      </div>

      <div className="mb-6 flex gap-3">
        <Input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="输入栏目名称"
          className="flex-1 border-white/[0.08] bg-white/[0.03] text-white"
        />
        <Button onClick={handleAdd} className="bg-cyan-400 text-black hover:bg-cyan-300">
          <Plus className="mr-2 h-4 w-4" />
          添加栏目
        </Button>
      </div>

      <div className="space-y-3">
        {categories.map((category) => {
          const workCount = works.filter((w) => w.categoryId === category.id).length;
          return (
            <div
              key={category.id}
              className="flex items-center gap-3 rounded-2xl border border-white/[0.08] bg-[#11141b] p-4"
            >
              <GripVertical className="h-5 w-5 text-[#6f7890]" />
              <div className="flex-1">
                <div className="text-white">{category.name}</div>
                <div className="text-xs text-[#8f97aa]">{workCount} 个作品</div>
              </div>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  const name = prompt("修改栏目名称", category.name);
                  if (name && name.trim()) updateCategory(category.id, { name: name.trim() });
                }}
                className="border-white/[0.08] bg-white/[0.03] text-white hover:bg-white/[0.06]"
              >
                编辑
              </Button>
              <Button
                variant="outline"
                size="sm"
                onClick={() => {
                  if (confirm(`确定删除栏目"${category.name}"？这将同时删除该栏目下的所有作品。`)) {
                    removeCategory(category.id);
                  }
                }}
                className="border-red-400/20 bg-red-500/10 text-red-200 hover:bg-red-500/20"
              >
                <Trash2 className="h-4 w-4" />
              </Button>
            </div>
          );
        })}
        {categories.length === 0 && (
          <div className="rounded-2xl border border-dashed border-white/[0.08] bg-white/[0.02] p-8 text-center text-[#8f97aa]">
            还没有栏目，先添加一个吧
          </div>
        )}
      </div>
    </div>
  );
}
