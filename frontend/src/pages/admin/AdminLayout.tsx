import { Link, Navigate, Outlet, useLocation } from "react-router-dom";
import { FolderOpen, Image, Home, Cpu, Ticket, Users, LogOut, Package, Shield, Coins, Type, Sparkles, Mail, Palette } from "lucide-react";
import { cn } from "../../lib/utils";
import { useAdminAuthStore } from "../../store/adminAuthStore";

export default function AdminLayout() {
  const location = useLocation();
  const { account, hasHydrated, loggedIn, logout } = useAdminAuthStore();

  if (!hasHydrated) return null;
  if (!loggedIn) return <Navigate to="/admin-login" replace />;

  const navItems = [
    { path: "/admin/users", label: "用户管理", icon: Users },
    { path: "/admin/home-content", label: "首页文案", icon: Type },
    { path: "/admin/packages", label: "积分套餐", icon: Package },
    { path: "/admin/redeem-codes", label: "兑换码管理", icon: Ticket },
    { path: "/admin/model-credits", label: "模型积分", icon: Coins },
    { path: "/admin/categories", label: "栏目管理", icon: FolderOpen },
    { path: "/admin/styles", label: "风格库管理", icon: Palette },
    { path: "/admin/works", label: "作品管理", icon: Image },
    { path: "/admin/models", label: "模型管理", icon: Cpu },
    { path: "/admin/agents", label: "智能体管理", icon: Sparkles },
    { path: "/admin/email", label: "邮箱配置", icon: Mail },
    { path: "/admin/settings", label: "管理员设置", icon: Shield },
  ];

  return (
    <div className="flex h-full bg-[#08090d] text-white">
      <aside className="w-64 border-r border-white/[0.06] bg-[#0d0f14] p-6">
        <div className="mb-8">
          <h1 className="text-xl font-semibold text-white">后台管理</h1>
          <p className="mt-1 text-xs text-[#8f97aa]">站点内容与系统管理</p>
        </div>

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

        <div className="mt-8 border-t border-white/[0.06] pt-6">
          <div className="mb-3 rounded-2xl border border-white/[0.06] bg-white/[0.03] p-3">
            <div className="truncate text-sm text-white">{account.username}</div>
            <button type="button" onClick={logout} className="mt-2 flex items-center gap-2 text-xs text-[#8f97aa] hover:text-white">
              <LogOut className="h-3.5 w-3.5" />
              退出后台
            </button>
          </div>
          <Link
            to="/"
            className="flex items-center gap-3 rounded-xl px-4 py-3 text-sm text-[#9aa3b7] transition hover:bg-white/[0.04] hover:text-white"
          >
            <Home className="h-4 w-4" />
            返回首页
          </Link>
        </div>
      </aside>

      <main className="flex-1 overflow-y-auto">
        <Outlet />
      </main>
    </div>
  );
}
