import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { Database, FolderOpen, Image, Home, Cpu, Ticket, Users, LogOut, Package, Shield, Coins, Type, Sparkles, Mail, Palette, Terminal, HardDriveDownload, WandSparkles } from "lucide-react";
import { ADMIN_LOGIN_PATH, adminPath } from "../../lib/adminRoutes";
import { cn } from "../../lib/utils";
import { useAdminAuthStore } from "../../store/adminAuthStore";

export default function AdminLayout() {
  const location = useLocation();
  const { account, hasHydrated, loggedIn, logout } = useAdminAuthStore();

  if (!hasHydrated) return null;
  if (!loggedIn) return <Navigate to={ADMIN_LOGIN_PATH} replace />;

  const navItems = [
    { path: adminPath("users"), label: "用户管理", icon: Users },
    { path: adminPath("home-content"), label: "首页文案", icon: Type },
    { path: adminPath("packages"), label: "积分套餐", icon: Package },
    { path: adminPath("redeem-codes"), label: "兑换码管理", icon: Ticket },
    { path: adminPath("model-credits"), label: "模型积分", icon: Coins },
    { path: adminPath("categories"), label: "栏目管理", icon: FolderOpen },
    { path: adminPath("styles"), label: "风格库管理", icon: Palette },
    { path: adminPath("works"), label: "作品管理", icon: Image },
    { path: adminPath("collection"), label: "采集管理", icon: WandSparkles },
    { path: adminPath("models"), label: "模型管理", icon: Cpu },
    { path: adminPath("agents"), label: "智能体管理", icon: Sparkles },
    { path: adminPath("email"), label: "邮箱配置", icon: Mail },
    { path: adminPath("storage"), label: "对象存储", icon: Database },
    { path: adminPath("data"), label: "数据备份", icon: HardDriveDownload },
    { path: adminPath("logs"), label: "系统日志", icon: Terminal },
    { path: adminPath("settings"), label: "管理员设置", icon: Shield },
  ];

  const currentLabel = navItems.find((item) => item.path === location.pathname)?.label ?? "";

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-[#08090d] text-white">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-white/[0.06] bg-[#0d0f14] px-6">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold text-white">后台管理</h1>
          {currentLabel ? (
            <>
              <span className="text-[#3a4150]">/</span>
              <span className="text-sm text-[#9aa3b7]">{currentLabel}</span>
            </>
          ) : null}
        </div>
        <div className="flex items-center gap-4">
          <span className="hidden text-sm text-[#9aa3b7] sm:block">{account.username}</span>
          <Link
            to="/"
            className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-[#9aa3b7] transition hover:bg-white/[0.06] hover:text-white"
          >
            <Home className="h-3.5 w-3.5" />
            返回首页
          </Link>
          <button
            type="button"
            onClick={logout}
            className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2 text-xs text-[#9aa3b7] transition hover:bg-white/[0.06] hover:text-white"
          >
            <LogOut className="h-3.5 w-3.5" />
            退出后台
          </button>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="w-64 shrink-0 overflow-y-auto border-r border-white/[0.06] bg-[#0d0f14] p-6">
          <nav className="space-y-2">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = location.pathname === item.path;
              return (
                <Link
                  key={item.path}
                  to={item.path}
                  className={cn(
                    "flex items-center gap-3 rounded-xl px-4 py-3 text-sm transition",
                    isActive
                      ? "bg-cyan-400/10 text-cyan-300"
                      : "text-[#9aa3b7] hover:bg-white/[0.04] hover:text-white"
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {item.label}
                </Link>
              );
            })}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 overflow-y-auto">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
