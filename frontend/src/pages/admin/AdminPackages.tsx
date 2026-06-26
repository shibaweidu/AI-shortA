import { useMemo, useState } from "react";
import { PackagePlus, Plus, Trash2 } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { getCreditPackageTotal, useCreditStore, type CreditPackage, type PackageInput } from "../../store/creditStore";

const inputClass = "border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";

const emptyPackageForm: PackageInput = {
  name: "",
  description: "",
  credits: 1000,
  bonusCredits: 0,
  price: 0,
  discountText: "",
  purchaseUrl: "",
  enabled: true,
  tags: [],
  sortOrder: 0,
  note: "",
};

function parseTags(value: string) {
  return value
    .split(/[，,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export default function AdminPackages() {
  const { packages, redeemCodes, addPackage, updatePackage, removePackage } = useCreditStore();
  const [packageForm, setPackageForm] = useState<PackageInput>(emptyPackageForm);
  const [editingPackageId, setEditingPackageId] = useState<string | null>(null);
  const [tagsText, setTagsText] = useState("");
  const [message, setMessage] = useState("");

  const sortedPackages = useMemo(
    () => [...packages].sort((a, b) => b.sortOrder - a.sortOrder || b.createdAt - a.createdAt),
    [packages]
  );

  const beginEditPackage = (pkg: CreditPackage) => {
    setEditingPackageId(pkg.id);
    setPackageForm({
      name: pkg.name,
      description: pkg.description,
      credits: pkg.credits,
      bonusCredits: pkg.bonusCredits,
      price: pkg.price ?? 0,
      discountText: pkg.discountText ?? "",
      purchaseUrl: pkg.purchaseUrl ?? "",
      enabled: pkg.enabled,
      tags: pkg.tags,
      sortOrder: pkg.sortOrder,
      note: pkg.note,
    });
    setTagsText(pkg.tags.join(", "));
    setMessage("");
  };

  const resetPackageForm = () => {
    setEditingPackageId(null);
    setPackageForm(emptyPackageForm);
    setTagsText("");
  };

  const savePackage = () => {
    const input = { ...packageForm, tags: parseTags(tagsText) };
    if (editingPackageId) {
      updatePackage(editingPackageId, input);
      setMessage("套餐已更新。");
    } else {
      addPackage(input);
      setMessage("套餐已新增。");
    }
    resetPackageForm();
  };

  const deletePackage = (id: string) => {
    const result = removePackage(id);
    setMessage(result.ok ? "套餐已删除。" : result.message);
  };

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">积分套餐</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">管理兑换码绑定的积分套餐，兑换码请到“兑换码管理”页面生成。</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="text-xl font-semibold text-white">{packages.length}</div>
            <div className="text-xs text-[#8f97aa]">套餐</div>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="text-xl font-semibold text-white">{redeemCodes.length}</div>
            <div className="text-xs text-[#8f97aa]">关联兑换码</div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 xl:grid-cols-[420px_1fr]">
        <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
          <div className="mb-5 flex items-center gap-3">
            <PackagePlus className="h-5 w-5 text-cyan-300" />
            <h2 className="text-lg font-semibold">{editingPackageId ? "编辑套餐" : "新增套餐"}</h2>
          </div>
          <div className="space-y-3">
            <Input value={packageForm.name} onChange={(e) => setPackageForm((v) => ({ ...v, name: e.target.value }))} placeholder="套餐名称" className={inputClass} />
            <Input value={packageForm.description} onChange={(e) => setPackageForm((v) => ({ ...v, description: e.target.value }))} placeholder="套餐描述" className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" value={packageForm.credits} onChange={(e) => setPackageForm((v) => ({ ...v, credits: Number(e.target.value) }))} placeholder="积分数量" className={inputClass} />
              <Input type="number" value={packageForm.bonusCredits} onChange={(e) => setPackageForm((v) => ({ ...v, bonusCredits: Number(e.target.value) }))} placeholder="赠送积分" className={inputClass} />
            </div>
            <Input type="number" value={packageForm.price} onChange={(e) => setPackageForm((v) => ({ ...v, price: Number(e.target.value) }))} placeholder="价格，例如 9.9" className={inputClass} />
            <Input value={packageForm.discountText} onChange={(e) => setPackageForm((v) => ({ ...v, discountText: e.target.value }))} placeholder="折扣信息，例如 限时 8 折" className={inputClass} />
            <Input value={packageForm.purchaseUrl} onChange={(e) => setPackageForm((v) => ({ ...v, purchaseUrl: e.target.value }))} placeholder="购买链接，例如 https://example.com/buy" className={inputClass} />
            <div className="grid grid-cols-2 gap-3">
              <Input type="number" value={packageForm.sortOrder} onChange={(e) => setPackageForm((v) => ({ ...v, sortOrder: Number(e.target.value) }))} placeholder="排序权重" className={inputClass} />
              <select value={packageForm.enabled ? "true" : "false"} onChange={(e) => setPackageForm((v) => ({ ...v, enabled: e.target.value === "true" }))} className="h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none">
                <option value="true" className="bg-[#111318]">启用</option>
                <option value="false" className="bg-[#111318]">停用</option>
              </select>
            </div>
            <Input value={tagsText} onChange={(e) => setTagsText(e.target.value)} placeholder="标签，用逗号分隔" className={inputClass} />
            <Input value={packageForm.note} onChange={(e) => setPackageForm((v) => ({ ...v, note: e.target.value }))} placeholder="内部备注" className={inputClass} />
            <div className="flex gap-2">
              <Button type="button" onClick={savePackage} className="flex-1 rounded-xl bg-cyan-400 text-black hover:bg-cyan-300">
                <Plus className="mr-2 h-4 w-4" />
                保存套餐
              </Button>
              {editingPackageId ? <Button type="button" onClick={resetPackageForm} className="rounded-xl bg-white/[0.06] text-white hover:bg-white/[0.10]">取消</Button> : null}
            </div>
            {message ? <div className="text-sm text-cyan-200">{message}</div> : null}
          </div>
        </section>

        <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
          <h2 className="mb-4 text-lg font-semibold">套餐列表</h2>
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {sortedPackages.map((pkg) => (
              <article key={pkg.id} className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="font-medium text-white">{pkg.name}</div>
                    <div className="mt-1 text-xs text-[#8f97aa]">{pkg.description || "暂无说明"}</div>
                  </div>
                  <span className={pkg.enabled ? "rounded-full bg-emerald-400/10 px-2 py-1 text-xs text-emerald-200" : "rounded-full bg-white/[0.06] px-2 py-1 text-xs text-[#9aa3b7]"}>{pkg.enabled ? "启用" : "停用"}</span>
                </div>
                <div className="mt-4 flex items-end justify-between gap-3">
                  <div className="text-2xl font-semibold text-cyan-200">{getCreditPackageTotal(pkg)} <span className="text-xs text-[#8f97aa]">积分</span></div>
                  <div className="text-sm font-medium text-cyan-200">¥{(pkg.price ?? 0).toFixed(2)}</div>
                </div>
                {pkg.discountText ? <div className="mt-2 text-xs text-emerald-300">{pkg.discountText}</div> : null}
                {pkg.purchaseUrl ? <div className="mt-1 truncate text-xs text-[#8f97aa]">购买链接：{pkg.purchaseUrl}</div> : null}
                <div className="mt-4 flex gap-2">
                  <Button type="button" onClick={() => beginEditPackage(pkg)} className="h-9 flex-1 rounded-xl bg-white/[0.06] text-white hover:bg-white/[0.10]">编辑</Button>
                  <Button type="button" onClick={() => deletePackage(pkg.id)} className="h-9 rounded-xl bg-red-500/10 text-red-100 hover:bg-red-500/15"><Trash2 className="h-4 w-4" /></Button>
                </div>
              </article>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}
