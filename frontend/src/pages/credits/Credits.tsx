import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Gift, History, Ticket, Wallet } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { getCreditPackageTotal, useCreditStore } from "../../store/creditStore";
import { useAuthStore } from "../../store/authStore";

const transactionLabels = {
  redeem_code: "兑换码兑换",
  generation_cost: "生成消耗",
  generation_refund: "失败返还",
  admin_adjust: "后台调整",
};

export default function Credits() {
  const navigate = useNavigate();
  const { packages, accounts, transactions, redeemCode } = useCreditStore();
  const { currentUserId, hasHydrated: authHydrated } = useAuthStore();
  const [code, setCode] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  const account = accounts.find((item) => item.userId === currentUserId);
  const enabledPackages = useMemo(
    () => packages.filter((pkg) => pkg.enabled).sort((a, b) => b.sortOrder - a.sortOrder || b.createdAt - a.createdAt),
    [packages]
  );
  const userTransactions = currentUserId ? transactions.filter((item) => item.userId === currentUserId).slice(0, 20) : [];

  if (!authHydrated) return null;

  const handleRedeem = () => {
    if (!currentUserId) {
      setMessage({ type: "error", text: "请先登录或注册后再兑换积分。" });
      navigate("/auth");
      return;
    }

    const result = redeemCode(currentUserId, code);
    if (!result.ok) {
      setMessage({ type: "error", text: result.message });
      return;
    }

    setCode("");
    setMessage({ type: "success", text: `兑换成功，已获得 ${result.amount} 积分（${result.packageName}）。` });
  };

  return (
    <div className="h-full overflow-y-auto rounded-[32px] bg-[#08090d] text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-300/70">Credits</div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">积分套餐</h1>
          </div>

          <div className="rounded-3xl border border-cyan-400/20 bg-cyan-400/10 px-6 py-4 shadow-[0_20px_60px_rgba(34,211,238,0.08)]">
            <div className="flex items-center gap-3 text-sm text-cyan-100/80">
              <Wallet className="h-4 w-4" />
              当前可用积分
            </div>
            <div className="mt-2 text-4xl font-semibold text-white">{currentUserId ? account?.balance ?? 0 : "--"}</div>
            {!currentUserId ? <div className="mt-1 text-xs text-cyan-100/70">登录后查看余额</div> : null}
          </div>
        </div>

        <section className="mb-5 rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <Ticket className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">兑换码兑换</h2>
            </div>
          </div>

          <div className="mt-6 flex flex-col gap-3 md:flex-row">
            <Input
              value={code}
              onChange={(event) => setCode(event.target.value.toUpperCase())}
              onKeyDown={(event) => {
                if (event.key === "Enter") handleRedeem();
              }}
              placeholder="输入兑换码，例如 ABCD-2345-EFGH-6789"
              className="h-12 border-white/[0.08] bg-white/[0.03] font-mono text-white placeholder:text-[#667085]"
            />
            <Button type="button" onClick={handleRedeem} disabled={!code.trim()} className="h-12 rounded-xl bg-cyan-400 px-6 text-black hover:bg-cyan-300">
              立即兑换
            </Button>
          </div>

          {message ? (
            <div className={message.type === "success" ? "mt-4 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "mt-4 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
              {message.text}
            </div>
          ) : null}
        </section>

        <section className="rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-violet-400/10 text-violet-300">
              <Gift className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">可购买套餐</h2>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
            {enabledPackages.length ? (
              enabledPackages.map((pkg) => (
                <article key={pkg.id} className="relative min-h-[196px] rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4 pb-16">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <div className="font-medium text-white">{pkg.name}</div>
                      <div className="mt-1 text-xs leading-5 text-[#8f97aa]">{pkg.description || "暂无说明"}</div>
                    </div>
                    <div className="flex shrink-0 flex-col items-end gap-1 text-right">
                      <div className="text-xl font-semibold text-cyan-200">¥{(pkg.price ?? 0).toFixed(2)}</div>
                      {pkg.discountText ? (
                        <div className="inline-flex rounded-lg bg-cyan-400/15 px-3 py-1 text-sm font-semibold text-cyan-200 ring-1 ring-cyan-300/20">
                          {pkg.discountText}
                        </div>
                      ) : null}
                    </div>
                  </div>
                  <div className="mt-5 text-3xl font-semibold text-cyan-200">{getCreditPackageTotal(pkg)} <span className="text-xs text-[#8f97aa]">积分</span></div>
                  {pkg.bonusCredits > 0 ? <div className="mt-1 text-xs text-emerald-300">含赠送 {pkg.bonusCredits} 积分</div> : null}
                  {pkg.tags.length ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      {pkg.tags.map((tag) => (
                        <span key={tag} className="rounded-full bg-white/[0.06] px-2.5 py-1 text-[11px] text-[#cfd6e2]">{tag}</span>
                      ))}
                    </div>
                  ) : null}
                  <a
                    href={pkg.purchaseUrl || undefined}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => {
                      if (!pkg.purchaseUrl) event.preventDefault();
                    }}
                    className={
                      pkg.purchaseUrl
                        ? "absolute bottom-4 right-4 inline-flex h-9 items-center justify-center rounded-xl bg-cyan-400 px-4 text-sm font-medium text-black transition hover:bg-cyan-300"
                        : "absolute bottom-4 right-4 inline-flex h-9 cursor-not-allowed items-center justify-center rounded-xl bg-white/[0.06] px-4 text-sm font-medium text-[#7f8798]"
                    }
                  >
                    订购套餐
                  </a>
                </article>
              ))
            ) : (
              <div className="rounded-2xl border border-dashed border-white/[0.08] px-4 py-8 text-center text-sm text-[#8f97aa] md:col-span-2 xl:col-span-3">
                暂无启用套餐
              </div>
            )}
          </div>
        </section>

        {currentUserId ? (
          <section className="mt-5 rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
            <div className="mb-4 flex items-center gap-3">
              <History className="h-5 w-5 text-[#9aa3b7]" />
              <h2 className="text-lg font-semibold text-white">积分流水</h2>
            </div>

            <div className="overflow-hidden rounded-2xl border border-white/[0.06]">
              {userTransactions.length ? (
                userTransactions.map((item) => (
                  <div key={item.id} className="grid gap-3 border-b border-white/[0.06] px-4 py-3 text-sm last:border-b-0 md:grid-cols-[1fr_120px_140px] md:items-center">
                    <div>
                      <div className="text-white">{transactionLabels[item.type]}</div>
                      <div className="mt-1 text-xs text-[#7f8798]">{item.note}</div>
                    </div>
                    <div className={item.amount > 0 ? "font-medium text-emerald-300" : "font-medium text-cyan-300"}>{item.amount > 0 ? "+" : ""}{item.amount}</div>
                    <div className="text-xs text-[#8f97aa]">{new Date(item.createdAt).toLocaleString("zh-CN")}</div>
                  </div>
                ))
              ) : (
                <div className="px-4 py-8 text-center text-sm text-[#8f97aa]">暂无积分流水</div>
              )}
            </div>
          </section>
        ) : (
          <div className="mt-5 rounded-2xl border border-white/[0.08] bg-white/[0.03] px-4 py-4 text-sm text-[#8f97aa]">
            登录后可查看积分余额和流水。<Link to="/auth" className="text-cyan-300 hover:text-cyan-200">去登录/注册</Link>
          </div>
        )}
      </div>
    </div>
  );
}
