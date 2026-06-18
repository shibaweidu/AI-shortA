import { useMemo, useState } from "react";
import { Clipboard, Ticket } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { getRedeemCodeDisplayStatus, useCreditStore, type RedeemCode } from "../../store/creditStore";

const inputClass = "border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]";

const statusLabels = {
  unused: "未使用",
  used: "已使用",
  disabled: "已停用",
  expired: "已过期",
};

function toDateInputValue(timestamp?: number) {
  if (!timestamp) return "";
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export default function AdminRedeemCodes() {
  const { packages, redeemCodes, transactions, generateRedeemCodes, disableRedeemCode, removeRedeemCode } = useCreditStore();
  const [codePackageId, setCodePackageId] = useState(packages[0]?.id ?? "");
  const [codeQuantity, setCodeQuantity] = useState(10);
  const [batchName, setBatchName] = useState("");
  const [expiresAtText, setExpiresAtText] = useState("");
  const [codeNote, setCodeNote] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [batchFilter, setBatchFilter] = useState("");
  const [lastGeneratedCodes, setLastGeneratedCodes] = useState<RedeemCode[]>([]);
  const [copyMessage, setCopyMessage] = useState("");

  const sortedPackages = useMemo(
    () => [...packages].sort((a, b) => b.sortOrder - a.sortOrder || b.createdAt - a.createdAt),
    [packages]
  );
  const filteredCodes = redeemCodes.filter((code) => {
    const status = getRedeemCodeDisplayStatus(code);
    if (statusFilter !== "all" && status !== statusFilter) return false;
    if (batchFilter.trim() && !code.batchName.includes(batchFilter.trim())) return false;
    return true;
  });
  const redeemTransactions = transactions.filter((item) => item.type === "redeem_code");

  const handleGenerateCodes = () => {
    if (!codePackageId) return;
    const created = generateRedeemCodes({
      packageId: codePackageId,
      quantity: codeQuantity,
      batchName,
      expiresAt: expiresAtText ? new Date(`${expiresAtText}T23:59:59`).getTime() : undefined,
      note: codeNote,
    });
    setLastGeneratedCodes(created);
    setCopyMessage(`已生成 ${created.length} 个兑换码。`);
  };

  const copyCodes = async (codes: RedeemCode[]) => {
    if (!codes.length) return;
    await navigator.clipboard.writeText(codes.map((code) => code.code).join("\n"));
    setCopyMessage(`已复制 ${codes.length} 个兑换码。`);
  };

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold text-white">兑换码管理</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">按积分套餐生成兑换码，生成后可直接一键复制给外部平台使用。</p>
        </div>
        <div className="grid grid-cols-2 gap-3 text-center">
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="text-xl font-semibold text-white">{redeemCodes.length}</div>
            <div className="text-xs text-[#8f97aa]">兑换码</div>
          </div>
          <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-4 py-3">
            <div className="text-xl font-semibold text-white">{redeemTransactions.length}</div>
            <div className="text-xs text-[#8f97aa]">已兑换</div>
          </div>
        </div>
      </div>

      <section className="rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
        <div className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Ticket className="h-5 w-5 text-amber-300" />
            <h2 className="text-lg font-semibold">批量生成兑换码</h2>
          </div>
          <Button type="button" onClick={() => void copyCodes(filteredCodes)} className="rounded-xl bg-white/[0.06] text-white hover:bg-white/[0.10]">
            <Clipboard className="mr-2 h-4 w-4" />
            复制当前列表
          </Button>
        </div>
        <div className="grid gap-3 md:grid-cols-5">
          <select value={codePackageId} onChange={(e) => setCodePackageId(e.target.value)} className="h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none md:col-span-2">
            {sortedPackages.map((pkg) => (
              <option key={pkg.id} value={pkg.id} className="bg-[#111318]">{pkg.name}</option>
            ))}
          </select>
          <Input type="number" min={1} max={1000} value={codeQuantity} onChange={(e) => setCodeQuantity(Number(e.target.value))} placeholder="数量" className={inputClass} />
          <Input type="date" value={expiresAtText} onChange={(e) => setExpiresAtText(e.target.value)} className={inputClass} />
          <Button type="button" onClick={handleGenerateCodes} disabled={!codePackageId} className="rounded-xl bg-amber-300 text-black hover:bg-amber-200">
            生成兑换码
          </Button>
          <Input value={batchName} onChange={(e) => setBatchName(e.target.value)} placeholder="批次名称，例如 淘宝 2026-05" className={`${inputClass} md:col-span-2`} />
          <Input value={codeNote} onChange={(e) => setCodeNote(e.target.value)} placeholder="兑换码备注" className={`${inputClass} md:col-span-3`} />
        </div>

        <div className="mt-6 grid gap-3 md:grid-cols-3">
          <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="h-10 rounded-md border border-white/[0.08] bg-white/[0.03] px-3 text-sm text-white outline-none">
            <option value="all" className="bg-[#111318]">全部状态</option>
            <option value="unused" className="bg-[#111318]">未使用</option>
            <option value="used" className="bg-[#111318]">已使用</option>
            <option value="disabled" className="bg-[#111318]">已停用</option>
            <option value="expired" className="bg-[#111318]">已过期</option>
          </select>
          <Input value={batchFilter} onChange={(e) => setBatchFilter(e.target.value)} placeholder="按批次筛选" className={inputClass} />
        </div>

        {lastGeneratedCodes.length ? (
          <div className="mt-5 rounded-2xl border border-amber-300/20 bg-amber-300/10 p-4">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <div className="text-sm font-medium text-white">本次生成的兑换码</div>
                <div className="mt-1 text-xs text-amber-100/70">共 {lastGeneratedCodes.length} 个，可直接复制到外部平台。</div>
              </div>
              <Button type="button" onClick={() => void copyCodes(lastGeneratedCodes)} className="h-9 rounded-xl bg-amber-300 px-3 text-black hover:bg-amber-200">
                一键复制
              </Button>
            </div>
            <div className="max-h-40 overflow-y-auto rounded-xl bg-black/20 p-3 font-mono text-xs leading-6 text-amber-50">
              {lastGeneratedCodes.map((code) => <div key={code.id}>{code.code}</div>)}
            </div>
          </div>
        ) : null}

        {copyMessage ? <div className="mt-3 text-sm text-amber-200">{copyMessage}</div> : null}
      </section>

      <section className="mt-6 rounded-[28px] border border-white/[0.08] bg-[#11141b] p-5">
        <h2 className="mb-4 text-lg font-semibold">兑换码列表</h2>
        <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
          {filteredCodes.length ? (
            filteredCodes.slice(0, 200).map((code) => {
              const pkg = packages.find((item) => item.id === code.packageId);
              const status = getRedeemCodeDisplayStatus(code);
              return (
                <div key={code.id} className="grid gap-3 border-b border-white/[0.06] px-4 py-3 text-sm last:border-b-0 lg:grid-cols-[190px_1fr_120px_120px_120px] lg:items-center">
                  <div className="font-mono text-cyan-100">{code.code}</div>
                  <div>
                    <div className="text-white">{pkg?.name ?? "未知套餐"}</div>
                    <div className="mt-1 text-xs text-[#7f8798]">{code.batchName || "无批次"}</div>
                  </div>
                  <div className="text-[#cfd6e2]">{statusLabels[status]}</div>
                  <div className="text-xs text-[#8f97aa]">{code.expiresAt ? toDateInputValue(code.expiresAt) : "长期有效"}</div>
                  <div className="flex gap-2">
                    {status === "unused" ? <Button type="button" onClick={() => disableRedeemCode(code.id)} className="h-8 rounded-lg bg-white/[0.06] px-3 text-xs text-white hover:bg-white/[0.10]">停用</Button> : null}
                    {status !== "used" ? <Button type="button" onClick={() => removeRedeemCode(code.id)} className="h-8 rounded-lg bg-red-500/10 px-3 text-xs text-red-100 hover:bg-red-500/15">删除</Button> : null}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="px-4 py-8 text-center text-sm text-[#8f97aa]">暂无兑换码</div>
          )}
        </div>
      </section>
    </div>
  );
}
