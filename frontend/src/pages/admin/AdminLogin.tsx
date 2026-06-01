import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Shield } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { adminPath } from "../../lib/adminRoutes";
import { useAdminAuthStore } from "../../store/adminAuthStore";

export default function AdminLogin() {
  const navigate = useNavigate();
  const { loggedIn, hasHydrated, login } = useAdminAuthStore();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState("");

  if (!hasHydrated) return null;
  if (loggedIn) return <Navigate to={adminPath("users")} replace />;

  const submit = () => {
    const result = login(username, password);
    if (!result.ok) {
      setMessage(result.message);
      return;
    }
    navigate(adminPath("users"), { replace: true });
  };

  return (
    <div className="flex h-screen items-center justify-center bg-[#08090d] px-4 text-white">
      <div className="w-full max-w-md rounded-[32px] border border-white/[0.08] bg-[#11141b] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            <Shield className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">后台管理员登录</h1>
            <p className="mt-1 text-sm text-[#8f97aa]">默认账号 admin，默认密码 admin123。</p>
          </div>
        </div>

        <div className="space-y-3">
          <Input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="管理员账号" className="h-12 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") submit();
            }}
            placeholder="管理员密码"
            className="h-12 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
          />
          {message ? <div className="rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100">{message}</div> : null}
          <Button type="button" onClick={submit} className="h-12 w-full rounded-xl bg-cyan-400 text-black hover:bg-cyan-300">
            登录后台
          </Button>
        </div>
      </div>
    </div>
  );
}
