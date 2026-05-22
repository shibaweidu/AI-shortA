import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

interface SiteContentState {
  homeTitle: string;
  homeHighlight: string;
  homeSubtitle: string;
  setHomeContent: (input: { homeTitle: string; homeHighlight: string; homeSubtitle: string }) => void;
}

type PersistedSiteContentState = Pick<SiteContentState, "homeTitle" | "homeHighlight" | "homeSubtitle">;

export const useSiteContentStore = create<SiteContentState>()(
  persist(
    (set) => ({
      homeTitle: "开启你的 ，立即开始创作。",
      homeHighlight: "Agent 模式",
      homeSubtitle: "输入你的创意构想，探索无限视觉可能。",
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
        homeTitle: state.homeTitle,
        homeHighlight: state.homeHighlight,
        homeSubtitle: state.homeSubtitle,
      }),
    } satisfies PersistOptions<SiteContentState, PersistedSiteContentState>
  )
);
