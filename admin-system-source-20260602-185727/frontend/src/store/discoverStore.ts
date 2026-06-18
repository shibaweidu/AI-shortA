import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createIndexedDbStorage } from "../lib/indexedDbStorage";
import { createBackendBackedStorage } from "../lib/sharedStateStorage";

export interface DiscoverCategory {
  id: string;
  name: string;
  order: number;
  createdAt: number;
}

export interface DiscoverWork {
  id: string;
  categoryId: string;
  title: string;
  coverUrl: string;
  prompt: string;
  model: string;
  aspectRatio: string;
  resolution?: string;
  referenceImages?: string[];
  createdAt: number;
  order: number;
}

interface DiscoverState {
  categories: DiscoverCategory[];
  works: DiscoverWork[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  addCategory: (input: { name: string }) => string;
  updateCategory: (id: string, updates: Partial<Pick<DiscoverCategory, "name" | "order">>) => void;
  removeCategory: (id: string) => void;
  addWork: (work: Omit<DiscoverWork, "id" | "createdAt">) => string;
  updateWork: (id: string, updates: Partial<Omit<DiscoverWork, "id" | "createdAt">>) => void;
  removeWork: (id: string) => void;
}

type PersistedDiscoverState = Pick<DiscoverState, "categories" | "works">;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

export const useDiscoverStore = create<DiscoverState>()(
  persist(
    (set) => ({
      categories: [],
      works: [],
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      addCategory: ({ name }) => {
        const id = createId("category");
        const category: DiscoverCategory = {
          id,
          name: name.trim(),
          order: Date.now(),
          createdAt: Date.now(),
        };
        set((state) => ({
          categories: [...state.categories, category].sort((a, b) => a.order - b.order),
        }));
        return id;
      },
      updateCategory: (id, updates) => {
        set((state) => ({
          categories: state.categories
            .map((cat) => (cat.id === id ? { ...cat, ...updates } : cat))
            .sort((a, b) => a.order - b.order),
        }));
      },
      removeCategory: (id) => {
        set((state) => ({
          categories: state.categories.filter((cat) => cat.id !== id),
          works: state.works.filter((work) => work.categoryId !== id),
        }));
      },
      addWork: (work) => {
        const id = createId("work");
        const newWork: DiscoverWork = {
          ...work,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          works: [...state.works, newWork],
        }));
        return id;
      },
      updateWork: (id, updates) => {
        set((state) => ({
          works: state.works.map((work) => (work.id === id ? { ...work, ...updates } : work)),
        }));
      },
      removeWork: (id) => {
        set((state) => ({
          works: state.works.filter((work) => work.id !== id),
        }));
      },
    }),
    {
      name: "discover-store",
      storage: createJSONStorage(() => createBackendBackedStorage(createIndexedDbStorage())),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state): PersistedDiscoverState => ({
        categories: state.categories,
        works: state.works,
      }),
    } as PersistOptions<DiscoverState, PersistedDiscoverState>
  )
);
