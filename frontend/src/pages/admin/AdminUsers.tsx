import { useState } from "react";
import { UserCog } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { toPublicUser, useAuthStore } from "../../store/authStore";
import { useCreditStore } from "../../store/creditStore";

export default function AdminUsers() {
  const { users, updateUserStatus, renameUser } = useAuthStore();
  const { accounts, transactions, adjustCredits } = useCreditStore();
  const [editingNameByUserId, setEditingNameByUserId] = useState<Record<string, string>>({});
  const [adjustByUserId, setAdjustByUserId] = useState<Record<string, string>>({});

  const publicUsers = users.map(toPublicUser);

  return (
    <div className="min-h-full bg-[#08090d] p-8 text-white">
      <div className="mb-8 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-white">用户管理</h1>
          <p className="mt-2 text-sm text-[#8f97aa]">查看注册用户、账号状态和积分账户，可进行停用、启用和积分调整。</p>
        </div>
        <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-5 py-3 text-center">
          <div className="text-2xl font-semibold text-white">{publicUsers.length}</div>
          <div className="text-xs text-[#8f97aa]">注册用户</div>
        </div>
      </div>

      <div className="overflow-hidden rounded-[28px] border border-white/[0.08] bg-[#11141b]">
        {publicUsers.length ? (
          publicUsers.map((user) => {
            const account = accounts.find((item) => item.userId === user.id);
            const userTransactions = transactions.filter((item) => item.userId === user.id);
            const draftName = editingNameByUserId[user.id] ?? user.displayName;
            const adjustValue = adjustByUserId[user.id] ?? "";

            return (
              <div key={user.id} className="border-b border-white/[0.06] p-5 last:border-b-0">
                <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr_1fr] lg:items-center">
                  <div className="flex min-w-0 items-start gap-3">
                    <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
                      <UserCog className="h-5 w-5" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex gap-2">
                        <Input
                          value={draftName}
                          onChange={(event) => setEditingNameByUserId((current) => ({ ...current, [user.id]: event.target.value }))}
                          className="h-9 max-w-xs border-white/[0.08] bg-white/[0.03] text-white"
                        />
                        <Button type="button" onClick={() => renameUser(user.id, draftName)} className="h-9 rounded-xl bg-white/[0.06] px-3 text-white hover:bg-white/[0.10]">
                          保存
                        </Button>
                      </div>
                      <div className="mt-2 text-xs text-[#8f97aa]">用户ID：<span className="font-mono text-[#cfd6e2]">{user.id}</span></div>
                      <div className="mt-1 text-xs text-[#8f97aa]">账号：{user.username}</div>
                      <div className="mt-1 text-xs text-[#6f7890]">注册：{new Date(user.createdAt).toLocaleString("zh-CN")}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-3 gap-3 text-center">
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                      <div className="text-lg font-semibold text-white">{account?.balance ?? 0}</div>
                      <div className="text-[11px] text-[#8f97aa]">积分余额</div>
                    </div>
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                      <div className="text-lg font-semibold text-white">{account?.totalEarned ?? 0}</div>
                      <div className="text-[11px] text-[#8f97aa]">累计获得积分</div>
                    </div>
                    <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
                      <div className="text-lg font-semibold text-white">{userTransactions.length}</div>
                      <div className="text-[11px] text-[#8f97aa]">积分流水</div>
                    </div>
                  </div>

                  <div className="flex flex-wrap justify-end gap-2">
                    <Input
                      type="number"
                      step="0.01"
                      value={adjustValue}
                      onChange={(event) => setAdjustByUserId((current) => ({ ...current, [user.id]: event.target.value }))}
                      placeholder="调整积分，如 100、0.5 或 -50"
                      className="h-9 w-48 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
                    />
                    <Button
                      type="button"
                      onClick={() => {
                        adjustCredits(user.id, Number(adjustValue), "后台用户管理调整积分");
                        setAdjustByUserId((current) => ({ ...current, [user.id]: "" }));
                      }}
                      className="h-9 rounded-xl bg-cyan-400 px-3 text-black hover:bg-cyan-300"
                    >
                      调整积分
                    </Button>
                    <Button
                      type="button"
                      onClick={() => updateUserStatus(user.id, user.status === "active" ? "disabled" : "active")}
                      className={
                        user.status === "active"
                          ? "h-9 rounded-xl bg-red-500/10 px-3 text-red-100 hover:bg-red-500/15"
                          : "h-9 rounded-xl bg-emerald-400/10 px-3 text-emerald-100 hover:bg-emerald-400/15"
                      }
                    >
                      {user.status === "active" ? "停用" : "启用"}
                    </Button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="px-5 py-12 text-center text-sm text-[#8f97aa]">暂无注册用户</div>
        )}
      </div>
    </div>
  );
}
