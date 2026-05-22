import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createIndexedDbStorage } from "../lib/indexedDbStorage";

export type ModelType = "llm" | "image" | "video";
export type ModelSource = "builtin" | "custom";

export interface Model {
  id: string;
  name: string;
  description: string;
  provider: string;
  type: ModelType;
  tags: string[];
  credits: number;
  source: ModelSource;
  enabled: boolean;
  createdAt: number;
}

interface ModelState {
  models: Model[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  addModel: (model: Omit<Model, "id" | "createdAt">) => string;
  updateModel: (id: string, updates: Partial<Omit<Model, "id" | "createdAt" | "source">>) => void;
  removeModel: (id: string) => void;
  toggleModel: (id: string) => void;
  getEnabledModels: (type?: ModelType) => Model[];
}

type PersistedModelState = Pick<ModelState, "models">;

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 9)}`;
}

// 内置模型定义
const BUILTIN_MODELS: Omit<Model, "createdAt">[] = [
  // OpenAI
  { id: "gpt-4o", name: "GPT-4o", description: "最新的多模态旗舰模型", provider: "OpenAI", type: "llm", tags: ["推荐", "多模态"], credits: 10, source: "builtin", enabled: true },
  { id: "gpt-4-turbo", name: "GPT-4 Turbo", description: "高性能的 GPT-4 版本", provider: "OpenAI", type: "llm", tags: ["高性能"], credits: 8, source: "builtin", enabled: true },
  { id: "gpt-3.5-turbo", name: "GPT-3.5 Turbo", description: "快速且经济的模型", provider: "OpenAI", type: "llm", tags: ["经济"], credits: 2, source: "builtin", enabled: true },
  { id: "dall-e-3", name: "DALL·E 3", description: "高质量图像生成", provider: "OpenAI", type: "image", tags: ["推荐", "高质量"], credits: 15, source: "builtin", enabled: true },
  { id: "dall-e-2", name: "DALL·E 2", description: "经典图像生成模型", provider: "OpenAI", type: "image", tags: [], credits: 8, source: "builtin", enabled: true },

  // Anthropic
  { id: "claude-3-5-sonnet-20241022", name: "Claude 3.5 Sonnet", description: "最强大的 Claude 模型", provider: "Anthropic", type: "llm", tags: ["推荐", "编程"], credits: 10, source: "builtin", enabled: true },
  { id: "claude-3-opus-20240229", name: "Claude 3 Opus", description: "最智能的 Claude 模型", provider: "Anthropic", type: "llm", tags: ["高级"], credits: 12, source: "builtin", enabled: true },
  { id: "claude-3-haiku-20240307", name: "Claude 3 Haiku", description: "快速响应的轻量模型", provider: "Anthropic", type: "llm", tags: ["快速"], credits: 3, source: "builtin", enabled: true },

  // FLUX
  { id: "flux-1-pro", name: "FLUX.1 Pro", description: "专业级图像生成", provider: "FLUX", type: "image", tags: ["推荐", "专业"], credits: 20, source: "builtin", enabled: true },
  { id: "flux-1-dev", name: "FLUX.1 Dev", description: "开发版图像生成", provider: "FLUX", type: "image", tags: ["开发"], credits: 12, source: "builtin", enabled: true },
  { id: "flux-1-schnell", name: "FLUX.1 Schnell", description: "快速图像生成", provider: "FLUX", type: "image", tags: ["快速"], credits: 5, source: "builtin", enabled: true },

  // Runway
  { id: "gen-3-alpha-turbo", name: "Gen-3 Alpha Turbo", description: "快速视频生成", provider: "Runway", type: "video", tags: ["推荐", "快速"], credits: 30, source: "builtin", enabled: true },
  { id: "gen-3-alpha", name: "Gen-3 Alpha", description: "高质量视频生成", provider: "Runway", type: "video", tags: ["高质量"], credits: 50, source: "builtin", enabled: true },

  // 可灵
  { id: "kling-v1", name: "可灵 1.0", description: "国产高质量视频生成", provider: "可灵", type: "video", tags: ["推荐", "国产"], credits: 40, source: "builtin", enabled: true },
];

export const useModelStore = create<ModelState>()(
  persist(
    (set, get) => ({
      models: BUILTIN_MODELS.map(m => ({ ...m, createdAt: Date.now() })),
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),

      addModel: (model) => {
        const id = createId("model");
        const newModel: Model = {
          ...model,
          id,
          createdAt: Date.now(),
        };
        set((state) => ({
          models: [...state.models, newModel],
        }));
        return id;
      },

      updateModel: (id, updates) => {
        set((state) => ({
          models: state.models.map((model) =>
            model.id === id ? { ...model, ...updates } : model
          ),
        }));
      },

      removeModel: (id) => {
        set((state) => ({
          models: state.models.filter((model) => !(model.id === id && model.source === "custom")),
        }));
      },

      toggleModel: (id) => {
        set((state) => ({
          models: state.models.map((model) =>
            model.id === id ? { ...model, enabled: !model.enabled } : model
          ),
        }));
      },

      getEnabledModels: (type) => {
        const models = get().models.filter((m) => m.enabled);
        return type ? models.filter((m) => m.type === type) : models;
      },
    }),
    {
      name: "model-store",
      storage: createJSONStorage(() => createIndexedDbStorage()),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
      partialize: (state): PersistedModelState => ({
        models: state.models,
      }),
      merge: (persistedState, currentState) => {
        const raw = (persistedState ?? {}) as PersistedModelState;
        const customModels = Array.isArray(raw.models)
          ? raw.models.filter((m: any) => m?.source === "custom")
          : [];

        const allModels = [
          ...BUILTIN_MODELS.map(m => ({ ...m, createdAt: Date.now() })),
          ...customModels,
        ];

        return {
          ...currentState,
          models: allModels,
        };
      },
    } as PersistOptions<ModelState, PersistedModelState>
  )
);
