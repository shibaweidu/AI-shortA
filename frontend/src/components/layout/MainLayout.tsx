import { useMemo, useState } from "react";
import { Bell, FileText as FileTextIcon, FolderKanban, Home, Pin, Settings, UserCircle, Wallet, X } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { cn, getDisplayAssetUrl } from "../../lib/utils";
import { useAuthStore } from "../../store/authStore";
import { hasRenderableSitePage, normalizeSiteAnnouncement, normalizeSiteNavItem, useSiteContentStore } from "../../store/siteContentStore";

const primaryNav = [
  { to: "/", label: "首页", icon: Home, end: true },
  { to: "/projects", label: "项目", icon: FolderKanban, end: false },
  { to: "/credits", label: "积分", icon: Wallet, end: false },
];

function BrandMark({ logoUrl, title }: { logoUrl: string; title: string }) {
  return <img src={getDisplayAssetUrl(logoUrl)} alt={title} className="h-10 w-10 rounded-none object-contain" />;
}

export function MainLayout() {
  const { users, currentUserId, hasHydrated } = useAuthStore();
  const { siteLogoUrl, siteTitle, siteTagline, customNavItems, announcementsEnabled, announcements } = useSiteContentStore();
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [selectedAnnouncementId, setSelectedAnnouncementId] = useState("");
  const currentUser = hasHydrated ? users.find((user) => user.id === currentUserId) : undefined;
  const customNav = customNavItems.map(normalizeSiteNavItem).filter(hasRenderableSitePage);
  const visibleAnnouncements = useMemo(
    () => announcements
      .map(normalizeSiteAnnouncement)
      .filter((item) => item.enabled && (item.title.trim() || item.summary.trim() || item.content.replace(/<[^>]*>/g, "").trim()))
      .sort((a, b) => {
        if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
        return (b.date || "").localeCompare(a.date || "") || b.updatedAt - a.updatedAt;
      }),
    [announcements]
  );
  const showAnnouncements = announcementsEnabled && visibleAnnouncements.length > 0;
  const selectedAnnouncement = visibleAnnouncements.find((item) => item.id === selectedAnnouncementId) ?? visibleAnnouncements[0];
  const mobileNav = [
    ...primaryNav,
    ...customNav.map((item) => ({ to: `/pages/${item.id}`, label: item.label, icon: FileTextIcon, end: false })),
    hasHydrated && currentUser
      ? { to: "/profile", label: "个人", icon: UserCircle, end: false }
      : { to: "/auth", label: "登录", icon: Wallet, end: false },
    { to: "/settings", label: "设置", icon: Settings, end: false },
  ];

  return (
    <div className="flex h-screen overflow-hidden bg-[#08090d] text-white">
      <aside className="hidden w-[220px] shrink-0 flex-col px-3 py-4 md:flex lg:w-[240px]">
        <Link to="/" className="mb-6 flex items-center gap-2.5 rounded-3xl px-2 py-1.5">
          <BrandMark logoUrl={siteLogoUrl} title={siteTitle} />
          <div className="flex min-w-0 flex-1 items-baseline gap-2 overflow-hidden">
            <div className="shrink-0 whitespace-nowrap text-[18px] font-semibold tracking-tight text-white">{siteTitle}</div>
            {siteTagline ? <div className="min-w-0 flex-1 whitespace-nowrap text-[11px] font-normal text-[#8f97aa]">{siteTagline}</div> : null}
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

        {customNav.length > 0 ? (
          <nav className="mt-5 flex flex-col gap-2 border-t border-white/[0.06] pt-5">
            {customNav.map((item) => (
              <NavLink
                key={item.id}
                to={`/pages/${item.id}`}
                className={({ isActive }) =>
                  cn(
                    "flex items-center gap-3 rounded-2xl px-3 py-3 text-sm transition",
                    isActive ? "bg-white/8 text-white" : "text-[#737b8b] hover:bg-white/4 hover:text-white"
                  )
                }
              >
                <FileTextIcon className="h-4 w-4" />
                <span className="truncate">{item.label}</span>
              </NavLink>
            ))}
          </nav>
        ) : null}

        {showAnnouncements ? (
          <div className={customNav.length > 0 ? "mt-5 border-t border-white/[0.06] pt-5" : "mt-2"}>
            <button
              type="button"
              onClick={() => {
                setSelectedAnnouncementId((current) => current || visibleAnnouncements[0]?.id || "");
                setAnnouncementOpen(true);
              }}
              className="flex w-full items-center gap-3 rounded-2xl px-3 py-3 text-left text-sm text-[#737b8b] transition hover:bg-white/4 hover:text-white"
            >
              <Bell className="h-4 w-4" />
              <span className="min-w-0 flex-1 truncate">公告</span>
              {visibleAnnouncements.some((item) => item.pinned) ? <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-[10px] text-cyan-200">置顶</span> : null}
            </button>
          </div>
        ) : null}

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
        <div className="grid auto-cols-fr grid-flow-col gap-1 overflow-x-auto">
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
          {showAnnouncements ? (
            <button
              type="button"
              onClick={() => {
                setSelectedAnnouncementId((current) => current || visibleAnnouncements[0]?.id || "");
                setAnnouncementOpen(true);
              }}
              className="flex min-w-0 flex-col items-center justify-center gap-1 rounded-xl px-1 py-1.5 text-[11px] text-[#737b8b] transition active:bg-white/6 active:text-white"
            >
              <Bell className="h-4 w-4" />
              <span className="max-w-full truncate">公告</span>
            </button>
          ) : null}
        </div>
      </nav>

      {announcementOpen && showAnnouncements ? (
        <div className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/60 p-3 backdrop-blur-sm">
          <div className="flex h-[min(760px,88dvh)] w-full max-w-5xl flex-col overflow-hidden rounded-[24px] border border-white/[0.08] bg-[#11141b] shadow-[0_30px_90px_rgba(0,0,0,0.55)]">
            <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-4 md:px-5">
              <div>
                <div className="text-lg font-semibold text-white">公告中心</div>
                <div className="mt-1 text-xs text-[#8f97aa]">{visibleAnnouncements.length} 条公告</div>
              </div>
              <button
                type="button"
                onClick={() => setAnnouncementOpen(false)}
                className="flex h-10 w-10 items-center justify-center rounded-xl text-[#8f97aa] transition hover:bg-white/[0.06] hover:text-white"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[360px_minmax(0,1fr)]">
              <div className="min-h-0 overflow-y-auto border-b border-white/[0.06] p-3 md:border-b-0 md:border-r md:p-4">
                <div className="space-y-2">
                  {visibleAnnouncements.map((item) => {
                    const selected = item.id === selectedAnnouncement?.id;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => setSelectedAnnouncementId(item.id)}
                        className={cn(
                          "w-full rounded-2xl border p-3 text-left transition",
                          selected ? "border-cyan-300/45 bg-cyan-400/10" : "border-white/[0.06] bg-white/[0.03] hover:bg-white/[0.05]"
                        )}
                      >
                        <div className="flex items-center gap-2">
                          {item.pinned ? <Pin className="h-3.5 w-3.5 shrink-0 text-cyan-200" /> : <Bell className="h-3.5 w-3.5 shrink-0 text-[#8f97aa]" />}
                          <div className="min-w-0 flex-1 truncate text-sm font-semibold text-white">{item.title || "未命名公告"}</div>
                        </div>
                        <div className="mt-2 line-clamp-2 text-xs leading-5 text-[#a4adbf]">{item.summary || "暂无摘要"}</div>
                        <div className="mt-2 flex items-center gap-2 text-[11px] text-[#71798a]">
                          <span>{item.date}</span>
                          {item.pinned ? <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-200">置顶</span> : null}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <article className="min-h-0 overflow-y-auto p-5 md:p-6">
                {selectedAnnouncement ? (
                  <>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-[#8f97aa]">
                      <span>{selectedAnnouncement.date}</span>
                      {selectedAnnouncement.pinned ? <span className="rounded-full bg-cyan-400/10 px-2 py-0.5 text-cyan-200">置顶</span> : null}
                    </div>
                    <h2 className="mt-3 text-2xl font-semibold leading-tight text-white">{selectedAnnouncement.title || "未命名公告"}</h2>
                    {selectedAnnouncement.summary ? <p className="mt-3 text-sm leading-6 text-[#b7c0d2]">{selectedAnnouncement.summary}</p> : null}
                    <div
                      className="prose prose-invert mt-6 max-w-none text-sm leading-7 text-[#e4e8f0] prose-a:text-cyan-300 prose-img:rounded-2xl"
                      dangerouslySetInnerHTML={{ __html: selectedAnnouncement.content }}
                    />
                  </>
                ) : null}
              </article>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
