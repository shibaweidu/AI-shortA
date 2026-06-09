import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { LogOut, Save, UserCircle, Wallet } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { useAuthStore } from "../../store/authStore";
import { useCreditStore } from "../../store/creditStore";

export default function Profile() {
  const navigate = useNavigate();
  const { users, currentUserId, hasHydrated, updateDisplayName, updateUsername, updatePassword, logout } = useAuthStore();
  const { accounts } = useCreditStore();
  const currentUser = users.find((user) => user.id === currentUserId);
  const account = accounts.find((item) => item.userId === currentUserId);
  const [displayName, setDisplayName] = useState(currentUser?.displayName ?? "");
  const [email, setEmail] = useState(currentUser?.username ?? "");
  const [oldPassword, setOldPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [message, setMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);

  useEffect(() => {
    if (!currentUser) return;
    const timer = window.setTimeout(() => {
      setDisplayName(currentUser.displayName);
      setEmail(currentUser.username);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [currentUser]);

  if (!hasHydrated) return null;

  if (!currentUserId || !currentUser) return null;

  const handleUpdateEmail = () => {
    const result = updateUsername(currentUserId, email);
    setMessage(result.ok ? { type: "success", text: "邮箱已保存。" } : { type: "error", text: result.message });
  };

  const handleUpdateDisplayName = () => {
    const result = updateDisplayName(currentUserId, displayName);
    setMessage(result.ok ? { type: "success", text: "用户名已保存。" } : { type: "error", text: result.message });
  };

  const handleUpdatePassword = async () => {
    const result = await updatePassword(currentUserId, oldPassword, newPassword, confirmPassword);
    if (!result.ok) {
      setMessage({ type: "error", text: result.message });
      return;
    }
    setOldPassword("");
    setNewPassword("");
    setConfirmPassword("");
    setMessage({ type: "success", text: "密码已修改。" });
  };

  const handleLogout = () => {
    logout();
    navigate("/auth", { replace: true });
  };

  return (
    <div className="h-full overflow-y-auto rounded-[32px] bg-[#08090d] text-white">
      <div className="mx-auto max-w-6xl px-4 py-6 md:px-8 md:py-10">
        <div className="mb-8 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <div className="mb-2 text-xs uppercase tracking-[0.28em] text-cyan-300/70">Account</div>
            <h1 className="text-3xl font-semibold tracking-tight text-white">个人中心</h1>
            <p className="mt-2 max-w-2xl text-sm leading-6 text-[#8f97aa]">查看账户基本信息，管理登录邮箱和密码。</p>
          </div>
          <Link to="/credits" className="inline-flex h-11 items-center justify-center rounded-xl border border-cyan-400/20 bg-cyan-400/10 px-5 text-sm text-cyan-100 hover:bg-cyan-400/15">
            <Wallet className="mr-2 h-4 w-4" />
            查看积分
          </Link>
        </div>

        <section className="mb-5 rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
          <div className="mb-5 flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
              <UserCircle className="h-5 w-5" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">账户信息</h2>
              <p className="mt-1 text-sm text-[#8f97aa]">当前登录账户的基本资料。</p>
            </div>
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">用户ID</div>
              <div className="mt-2 break-all font-mono text-sm font-medium text-white">{currentUser.id}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">用户名</div>
              <div className="mt-2 text-sm font-medium text-white">{currentUser.displayName}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">邮箱</div>
              <div className="mt-2 text-sm font-medium text-white">{currentUser.username}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">角色</div>
              <div className="mt-2 text-sm font-medium text-white">user</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">余额</div>
              <div className="mt-2 text-sm font-medium text-white">{account?.balance ?? 0}</div>
            </div>
            <div className="rounded-2xl border border-white/[0.06] bg-white/[0.03] p-4">
              <div className="text-xs text-[#8f97aa]">注册时间</div>
              <div className="mt-2 text-sm font-medium text-white">{new Date(currentUser.createdAt).toLocaleString("zh-CN")}</div>
            </div>
          </div>
        </section>

        <div className="grid gap-5 lg:grid-cols-2">
          <section className="rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
            <h2 className="text-lg font-semibold text-white">修改用户名</h2>
            <div className="mt-5 space-y-3">
              <label className="block text-sm text-[#cfd6e2]">用户名</label>
              <Input value={displayName} onChange={(event) => setDisplayName(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              <Button type="button" onClick={handleUpdateDisplayName} className="h-10 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
                <Save className="mr-2 h-4 w-4" />
                保存
              </Button>
            </div>
          </section>

          <section className="rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
            <h2 className="text-lg font-semibold text-white">修改邮箱</h2>
            <div className="mt-5 space-y-3">
              <label className="block text-sm text-[#cfd6e2]">邮箱</label>
              <Input value={email} onChange={(event) => setEmail(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
              <Button type="button" onClick={handleUpdateEmail} className="h-10 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
                <Save className="mr-2 h-4 w-4" />
                保存
              </Button>
            </div>
          </section>

          <section className="rounded-[30px] border border-white/[0.08] bg-[#11141b] p-5">
            <h2 className="text-lg font-semibold text-white">修改密码</h2>
            <div className="mt-5 space-y-3">
              <label className="block text-sm text-[#cfd6e2]">旧密码</label>
              <Input type="password" value={oldPassword} onChange={(event) => setOldPassword(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white" />
              <label className="block text-sm text-[#cfd6e2]">新密码</label>
              <Input type="password" value={newPassword} onChange={(event) => setNewPassword(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white" />
              <label className="block text-sm text-[#cfd6e2]">确认新密码</label>
              <Input type="password" value={confirmPassword} onChange={(event) => setConfirmPassword(event.target.value)} className="h-11 border-white/[0.08] bg-white/[0.03] text-white" />
              <Button type="button" onClick={() => void handleUpdatePassword()} className="h-10 rounded-xl bg-cyan-400 px-5 text-black hover:bg-cyan-300">
                <Save className="mr-2 h-4 w-4" />
                修改密码
              </Button>
            </div>
          </section>
        </div>

        {message ? (
          <div className={message.type === "success" ? "mt-5 rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "mt-5 rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
            {message.text}
          </div>
        ) : null}

        <div className="mt-8 flex justify-center border-t border-white/[0.08] pt-8">
          <button
            type="button"
            onClick={handleLogout}
            className="inline-flex items-center gap-2 rounded-xl border border-white/[0.08] bg-white/[0.03] px-6 py-3 text-sm text-[#8f97aa] transition hover:border-red-400/20 hover:bg-red-500/10 hover:text-red-300"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </div>
    </div>
  );
}
