import { FolderKanban, Home, Settings, UserCircle, Wallet } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { cn } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";

const primaryNav = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/projects", label: "项目", icon: FolderKanban, end: false },
  { to: "/credits", label: "积分", icon: Wallet, end: false },
];

function BrandMark() {
  return <img src="/koala-ai-logo.png" alt="考拉AI" className="h-10 w-10 rounded-none object-cover" />;
}

export function MainLayout() {
  const { users, currentUserId, hasHydrated } = useAuthStore();
  const currentUser = hasHydrated ? users.find((user) => user.id === currentUserId) : undefined;
  const mobileNav = [
    ...primaryNav,
    hasHydrated && currentUser
      ? { to: "/profile", label: "个人", icon: UserCircle, end: false }
      : { to: "/auth", label: "登录", icon: Wallet, end: false },
    { to: "/settings", label: "设置", icon: Settings, end: false },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#08090d] text-white">
      <aside className="hidden w-[168px] shrink-0 flex-col px-3 py-4 md:flex lg:w-[180px]">
        <Link to="/" className="mb-6 flex items-center gap-2.5 rounded-3xl px-2 py-1.5">
          <BrandMark />
          <div className="min-w-0">
            <div className="text-[18px] font-semibold tracking-tight text-white">考拉AI</div>
          </div>
        </Link>

        <nav className="flex flex-col gap-2">
          {primaryNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                  isActive ? "bg-white/8 text-white" : "text-[#737b8b] hover:bg-white/4 hover:text-white"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto pt-4">
          <div className="border-t border-white/[0.06] pt-4">
            {hasHydrated && currentUser ? (
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  cn(
                    "mb-3 flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                    isActive ? "bg-white/8 text-white" : "text-[#737b8b] hover:bg-white/4 hover:text-white"
                  )
                }
              >
                <UserCircle className="h-4 w-4" />
                <span>个人中心</span>
              </NavLink>
            ) : (
              <NavLink
                to="/auth"
                className={({ isActive }) =>
                  cn(
                    "mb-3 flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                    isActive ? "bg-white/8 text-white" : "text-[#737b8b] hover:bg-white/4 hover:text-white"
                  )
                }
              >
                <Wallet className="h-4 w-4" />
                <span>登录/注册</span>
              </NavLink>
            )}
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                cn(
                  "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                  isActive ? "bg-white/8 text-white" : "text-[#737b8b] hover:bg-white/4 hover:text-white"
                )
              }
            >
              <Settings className="h-4 w-4" />
              <span>设置</span>
            </NavLink>
          </div>
        </div>
      </aside>

      <main className="min-w-0 flex-1 overflow-hidden">
        <div className="relative h-full p-3 pb-[76px] md:p-8 md:pb-8">
          <Outlet />
        </div>
      </main>

      <nav className="fixed inset-x-0 bottom-0 z-[900] border-t border-white/[0.08] bg-[#0b0d12]/95 px-2 pb-[max(env(safe-area-inset-bottom),8px)] pt-2 backdrop-blur md:hidden">
        <div className="grid grid-cols-5 gap-1">
          {mobileNav.map(({ to, label, icon: Icon, end }) => (
            <NavLink
              key={to}
              to={to}
              end={end}
              className={({ isActive }) =>
                cn(
                  "flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] transition",
                  isActive ? "bg-white/10 text-white" : "text-[#737b8b] active:bg-white/6 active:text-white"
                )
              }
            >
              <Icon className="h-4 w-4" />
              <span className="max-w-full truncate">{label}</span>
            </NavLink>
          ))}
        </div>
      </nav>
    </div>
  );
}
