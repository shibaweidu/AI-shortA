import { useEffect, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { KeyRound, Lock, Mail, UserPlus } from "lucide-react";
import { Button } from "../../components/ui/button";
import { Input } from "../../components/ui/input";
import { sendRegistrationEmailCode, verifyRegistrationEmailCode } from "../../services/email";
import { useAuthStore } from "../../store/authStore";

type AuthMode = "login" | "register";

export default function Auth() {
  const navigate = useNavigate();
  const { currentUserId, hasHydrated, login, register, users } = useAuthStore();
  const [mode, setMode] = useState<AuthMode>("login");
  const [displayName, setDisplayName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [emailCode, setEmailCode] = useState("");
  const [message, setMessage] = useState("");
  const [messageType, setMessageType] = useState<"success" | "error">("error");
  const [sendingCode, setSendingCode] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (cooldown <= 0) return undefined;
    const timer = window.setInterval(() => {
      setCooldown((value) => Math.max(0, value - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [cooldown]);

  if (!hasHydrated) return null;
  if (currentUserId) return <Navigate to="/credits" replace />;

  const email = username.trim().toLowerCase();
  const validEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const sendCode = async () => {
    if (!validEmail) {
      setMessageType("error");
      setMessage("请输入有效的邮箱地址。");
      return;
    }
    if (users.some((user) => user.username === email)) {
      setMessageType("error");
      setMessage("该邮箱已注册，请直接登录。");
      return;
    }

    setSendingCode(true);
    setMessage("");
    try {
      await sendRegistrationEmailCode(email);
      setEmailCode("");
      setCooldown(60);
      setMessageType("success");
      setMessage("验证码已发送，请查看邮箱。");
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSendingCode(false);
    }
  };

  const submit = async () => {
    if (mode === "login") {
      const result = login({ username: email || username, password });
      if (!result.ok) {
        setMessageType("error");
        setMessage(result.message);
        return;
      }
      navigate("/credits", { replace: true });
      return;
    }

    if (!validEmail) {
      setMessageType("error");
      setMessage("注册需要使用有效邮箱。");
      return;
    }
    if (!displayName.trim()) {
      setMessageType("error");
      setMessage("请输入用户名。");
      return;
    }
    if (displayName.trim().length > 24) {
      setMessageType("error");
      setMessage("用户名不能超过 24 个字符。");
      return;
    }
    if (!/^\d{6}$/.test(emailCode.trim())) {
      setMessageType("error");
      setMessage("请输入邮箱收到的 6 位验证码。");
      return;
    }
    if (users.some((user) => user.username === email)) {
      setMessageType("error");
      setMessage("该邮箱已注册，请直接登录。");
      return;
    }

    setSubmitting(true);
    setMessage("");
    try {
      await verifyRegistrationEmailCode(email, emailCode.trim());
      const result = register({ username: email, password, displayName });
      if (!result.ok) {
        setMessageType("error");
        setMessage(result.message);
        return;
      }
      navigate("/credits", { replace: true });
    } catch (error) {
      setMessageType("error");
      setMessage(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#08090d] px-4 text-white">
      <div className="w-full max-w-md rounded-[32px] border border-white/[0.08] bg-[#11141b] p-6 shadow-[0_30px_100px_rgba(0,0,0,0.45)]">
        <div className="mb-6 flex items-center gap-3">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-cyan-400/10 text-cyan-300">
            {mode === "login" ? <Lock className="h-5 w-5" /> : <UserPlus className="h-5 w-5" />}
          </div>
          <div>
            <h1 className="text-xl font-semibold text-white">{mode === "login" ? "登录账号" : "注册账号"}</h1>
          </div>
        </div>

        <div className="space-y-3">
          <Input
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="用户名"
            className={mode === "register" ? "h-12 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]" : "hidden"}
          />
          <Input
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            placeholder="邮箱"
            className="h-12 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
          />
          <Input
            type="password"
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") void submit();
            }}
            placeholder="密码，至少 6 个字符"
            className="h-12 border-white/[0.08] bg-white/[0.03] text-white placeholder:text-[#667085]"
          />
          {mode === "register" ? (
            <div className="flex gap-2">
              <div className="relative flex-1">
                <KeyRound className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-[#667085]" />
                <Input
                  value={emailCode}
                  onChange={(event) => setEmailCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                  onKeyDown={(event) => {
                    if (event.key === "Enter") void submit();
                  }}
                  inputMode="numeric"
                  placeholder="6 位验证码"
                  className="h-12 border-white/[0.08] bg-white/[0.03] pl-9 text-white placeholder:text-[#667085]"
                />
              </div>
              <Button
                type="button"
                onClick={() => void sendCode()}
                disabled={sendingCode || cooldown > 0}
                className="h-12 shrink-0 rounded-xl bg-white/[0.06] px-4 text-white hover:bg-white/[0.10]"
              >
                <Mail className="mr-2 h-4 w-4" />
                {cooldown > 0 ? `${cooldown}s` : sendingCode ? "发送中" : "获取验证码"}
              </Button>
            </div>
          ) : null}
          {message ? (
            <div className={messageType === "success" ? "rounded-2xl border border-emerald-400/20 bg-emerald-400/10 px-4 py-3 text-sm text-emerald-100" : "rounded-2xl border border-red-400/20 bg-red-500/10 px-4 py-3 text-sm text-red-100"}>
              {message}
            </div>
          ) : null}
          <Button type="button" onClick={() => void submit()} disabled={submitting} className="h-12 w-full rounded-xl bg-cyan-400 text-black hover:bg-cyan-300">
            {mode === "login" ? "登录" : "注册并登录"}
          </Button>
        </div>

        <button
          type="button"
          onClick={() => {
            setMode(mode === "login" ? "register" : "login");
            setMessage("");
            setMessageType("error");
            setEmailCode("");
            setDisplayName("");
          }}
          className="mt-5 w-full rounded-xl border border-white/[0.08] bg-white/[0.03] px-4 py-3 text-sm text-[#cfd6e2] transition hover:border-white/[0.14] hover:text-white"
        >
          {mode === "login" ? "还没有账号？去注册" : "已有账号？去登录"}
        </button>
      </div>
    </div>
  );
}
