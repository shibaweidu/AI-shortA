import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export type SiteContentBlock =
  | { id: string; type: "heading"; text: string }
  | { id: string; type: "paragraph"; text: string }
  | { id: string; type: "image"; url: string; name: string }
  | { id: string; type: "file"; url: string; name: string; size: number; mimeType: string };

export type SiteNavItem = {
  id: string;
  label: string;
  pageTitle: string;
  enabled: boolean;
  blocks: SiteContentBlock[];
  content?: string;
  richContent?: string;
};

interface SiteContentState {
  siteLogoUrl: string;
  siteTitle: string;
  siteTagline: string;
  customNavItems: SiteNavItem[];
  homeTitle: string;
  homeHighlight: string;
  homeSubtitle: string;
  setSiteBrand: (input: { siteLogoUrl: string; siteTitle: string; siteTagline: string }) => void;
  setCustomNavItems: (items: SiteNavItem[]) => void;
  setHomeContent: (input: { homeTitle: string; homeHighlight: string; homeSubtitle: string }) => void;
}

type PersistedSiteContentState = Pick<
  SiteContentState,
  "siteLogoUrl" | "siteTitle" | "siteTagline" | "customNavItems" | "homeTitle" | "homeHighlight" | "homeSubtitle"
>;

export const DEFAULT_SITE_LOGO_URL = "/koala-ai-logo.png";

export function createSiteContentBlock(type: "heading" | "paragraph"): SiteContentBlock {
  return {
    id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    type,
    text: "",
  };
}

export function normalizeSiteNavItem(item: SiteNavItem): SiteNavItem {
  const legacyContent = typeof item.content === "string" ? item.content.trim() : "";
  const richContent = typeof item.richContent === "string" ? item.richContent.trim() : "";
  const blocks = Array.isArray(item.blocks) && item.blocks.length > 0
    ? item.blocks
    : legacyContent
      ? [{ id: `block-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`, type: "paragraph", text: legacyContent } as SiteContentBlock]
      : [createSiteContentBlock("paragraph")];

  return {
    id: item.id || `nav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    label: item.label ?? "",
    pageTitle: item.pageTitle ?? item.label ?? "",
    enabled: item.enabled !== false,
    blocks,
    richContent: richContent || undefined,
  };
}

export function hasRenderableSitePage(item: SiteNavItem) {
  if (!item.enabled || !item.label.trim() || !item.pageTitle.trim()) return false;

  // 如果有富文本内容，检查是否为空 HTML（例如 <p></p> 或 <p><br></p>）
  if (item.richContent && item.richContent.trim()) {
    const stripped = item.richContent.replace(/<[^>]*>/g, '').trim();
    if (stripped.length > 0) return true;
  }

  // 否则检查 blocks
  return item.blocks.some((block) => {
    if (block.type === "image" || block.type === "file") return Boolean(block.url);
    return Boolean(block.text.trim());
  });
}

export const useSiteContentStore = create<SiteContentState>()(
  persist(
    (set) => ({
      siteLogoUrl: DEFAULT_SITE_LOGO_URL,
      siteTitle: "考拉AI",
      siteTagline: "AI 创作工作台",
      customNavItems: [],
      homeTitle: "开启你的 Agent 模式，立即开始创作。",
      homeHighlight: "Agent 模式",
      homeSubtitle: "输入你的创意构想，探索无限视觉可能。",
      setSiteBrand: (input) =>
        set({
          siteLogoUrl: input.siteLogoUrl,
          siteTitle: input.siteTitle,
          siteTagline: input.siteTagline,
        }),
      setCustomNavItems: (items) => set({ customNavItems: items.map(normalizeSiteNavItem) }),
      setHomeContent: (input) =>
        set({
          homeTitle: input.homeTitle,
          homeHighlight: input.homeHighlight,
          homeSubtitle: input.homeSubtitle,
        }),
    }),
    {
      name: "koala-site-content-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({
        siteLogoUrl: state.siteLogoUrl,
        siteTitle: state.siteTitle,
        siteTagline: state.siteTagline,
        customNavItems: state.customNavItems,
        homeTitle: state.homeTitle,
        homeHighlight: state.homeHighlight,
        homeSubtitle: state.homeSubtitle,
      }),
    } satisfies PersistOptions<SiteContentState, PersistedSiteContentState>
  )
);
