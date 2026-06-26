import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { parseProviderModelValue, parseSourcedProviderModelValue } from "../lib/providerModels";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export interface ModelCreditRule {
  modelValue: string;
  imageCreditsByResolution: Record<string, number>;
  videoCreditsByDuration: Record<string, number>;
  videoCreditsPerSecond?: number;
  textCreditsPerUse?: number;
  updatedAt: number;
}

interface ModelCreditState {
  rules: ModelCreditRule[];
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  setImageCredits: (modelValue: string, resolution: string, credits: number) => void;
  setVideoCredits: (modelValue: string, duration: string, credits: number) => void;
  setVideoCreditsPerSecond: (modelValue: string, credits: number) => void;
  setTextCreditsPerUse: (modelValue: string, credits: number) => void;
  clearRule: (modelValue: string) => void;
}

type PersistedModelCreditState = Pick<ModelCreditState, "rules">;

function normalizeCredits(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.round(value * 10000) / 10000);
}

function parseDurationSeconds(value?: string) {
  const seconds = Number.parseFloat(value ?? "");
  if (!Number.isFinite(seconds) || seconds <= 0) return 1;
  return seconds;
}

function getModelCreditLookupValues(modelValue: string) {
  const sourced = parseSourcedProviderModelValue(modelValue);
  if (sourced) return [modelValue, `${sourced.providerId}::${sourced.modelId}`, sourced.modelId];
  const parsed = parseProviderModelValue(modelValue);
  if (parsed) return [modelValue, parsed.modelId];
  return [modelValue];
}

export function findModelCreditRule(rules: ModelCreditRule[], modelValue: string) {
  const lookupValues = new Set(getModelCreditLookupValues(modelValue));
  return rules.find((item) => {
    if (lookupValues.has(item.modelValue)) return true;
    return getModelCreditLookupValues(item.modelValue).some((value) => lookupValues.has(value));
  });
}

function isSameModelCreditRule(ruleModelValue: string, modelValue: string) {
  const lookupValues = new Set(getModelCreditLookupValues(modelValue));
  if (lookupValues.has(ruleModelValue)) return true;
  return getModelCreditLookupValues(ruleModelValue).some((value) => lookupValues.has(value));
}

function upsertRule(rules: ModelCreditRule[], modelValue: string, updater: (rule: ModelCreditRule) => ModelCreditRule) {
  const existing = rules.find((rule) => rule.modelValue === modelValue) ?? {
    modelValue,
    imageCreditsByResolution: {},
    videoCreditsByDuration: {},
    updatedAt: Date.now(),
  };
  const next = updater(existing);
  return rules.some((rule) => rule.modelValue === modelValue)
    ? rules.map((rule) => (rule.modelValue === modelValue ? next : rule))
    : [next, ...rules];
}

export const useModelCreditStore = create<ModelCreditState>()(
  persist(
    (set) => ({
      rules: [],
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      setImageCredits: (modelValue, resolution, credits) => {
        set((state) => ({
          rules: upsertRule(state.rules, modelValue, (rule) => ({
            ...rule,
            imageCreditsByResolution: {
              ...rule.imageCreditsByResolution,
              [resolution]: normalizeCredits(credits),
            },
            updatedAt: Date.now(),
          })),
        }));
      },
      setVideoCredits: (modelValue, duration, credits) => {
        set((state) => ({
          rules: upsertRule(state.rules, modelValue, (rule) => ({
            ...rule,
            videoCreditsByDuration: {
              ...rule.videoCreditsByDuration,
              [duration]: normalizeCredits(credits),
            },
            updatedAt: Date.now(),
          })),
        }));
      },
      setVideoCreditsPerSecond: (modelValue, credits) => {
        set((state) => ({
          rules: upsertRule(state.rules, modelValue, (rule) => ({
            ...rule,
            videoCreditsPerSecond: normalizeCredits(credits),
            updatedAt: Date.now(),
          })),
        }));
      },
      setTextCreditsPerUse: (modelValue, credits) => {
        set((state) => ({
          rules: upsertRule(state.rules, modelValue, (rule) => ({
            ...rule,
            textCreditsPerUse: normalizeCredits(credits),
            updatedAt: Date.now(),
          })),
        }));
      },
      clearRule: (modelValue) => set((state) => ({ rules: state.rules.filter((rule) => !isSameModelCreditRule(rule.modelValue, modelValue)) })),
    }),
    {
      name: "koala-model-credit-store-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({ rules: state.rules }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    } satisfies PersistOptions<ModelCreditState, PersistedModelCreditState>
  )
);

export function getModelCreditCost(input: {
  rules: ModelCreditRule[];
  modelValue: string;
  type: "image" | "video" | "text";
  resolution?: string;
  duration?: string;
}) {
  const rule = findModelCreditRule(input.rules, input.modelValue);
  if (input.type === "image" && input.resolution) {
    const credits = rule?.imageCreditsByResolution[input.resolution];
    if (typeof credits === "number") return credits;
    return 0;
  }
  if (input.type === "video") {
    const creditsPerSecond = typeof rule?.videoCreditsPerSecond === "number" ? rule.videoCreditsPerSecond : 0;
    return normalizeCredits(creditsPerSecond * parseDurationSeconds(input.duration));
  }
  if (input.type === "text") {
    return typeof rule?.textCreditsPerUse === "number" ? rule.textCreditsPerUse : 0;
  }
  return 0;
}
