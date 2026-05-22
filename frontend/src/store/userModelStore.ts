import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { getDefaultModelApiRoutes, normalizeModelApiRoutes } from "../lib/modelApiRoutes";
import { buildProviderModelValue, getProviderModelLookupValues } from "../lib/providerModels";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";
import type { ModelType, ProviderConfig, ProviderModel, RoutingConfig } from "./settingsStore";

interface UserModelState {
  providers: ProviderConfig[];
  routing: RoutingConfig;
  getCustomProviders: () => ProviderConfig[];
 updateProvider: (providerId: string, data: Partial<Pick<ProviderConfig, "name" | "key" | "baseUrl" | "logAccessToken" | "useReferenceImagesParam">>) => void;
 addCustomProvider: (data?: Partial<Pick<ProviderConfig, "name" | "key" | "baseUrl" | "logAccessToken" | "useReferenceImagesParam">>) => string;
  removeProvider: (providerId: string) => void;
  addProviderModel: (
    providerId: string,
    type: ModelType,
    model: Pick<ProviderModel, "id" | "name"> & Partial<Pick<ProviderModel, "thumbnailUrl" | "providerDisplayName" | "description" | "tags" | "credits" | "apiRoutes">>
  ) => void;
  updateProviderModel: (
    providerId: string,
    type: ModelType,
    modelId: string,
    data: Partial<Pick<ProviderModel, "id" | "name" | "thumbnailUrl" | "providerDisplayName" | "description" | "tags" | "credits" | "apiRoutes">>
  ) => void;
  removeProviderModel: (providerId: string, type: ModelType, modelId: string) => void;
  updateRouting: (type: keyof RoutingConfig, modelIds: string[]) => void;
  toggleRoutingModel: (type: keyof RoutingConfig, modelId: string) => void;
}

type PersistedUserModels = Partial<Pick<UserModelState, "providers" | "routing">>;
const modelTypes: ModelType[] = ["language", "image", "video", "audio"];

function emptyModelGroup(): Record<ModelType, ProviderModel[]> {
  return { language: [], image: [], video: [], audio: [] };
}

function createDefaultState() {
  return { providers: [], routing: { language: [], image: [], video: [], audio: [] } satisfies RoutingConfig };
}

function createProviderId() {
  return `user-provider-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeModel(model: unknown, fallbackType: ModelType, provider?: Partial<ProviderConfig>): ProviderModel | null {
  if (!model || typeof model !== "object") return null;
  const raw = model as Partial<ProviderModel>;
  if (!raw.id || !raw.name) return null;
  const fallbackApiRoutes = getDefaultModelApiRoutes({
    providerId: provider?.id,
    providerName: provider?.name,
    providerBaseUrl: provider?.baseUrl,
    modelId: String(raw.id),
    modelName: String(raw.name),
    type: fallbackType,
  });
  return {
    id: String(raw.id),
    name: String(raw.name),
    type: fallbackType,
    thumbnailUrl: typeof raw.thumbnailUrl === "string" ? raw.thumbnailUrl : undefined,
    providerDisplayName: typeof raw.providerDisplayName === "string" ? raw.providerDisplayName : undefined,
    credits: typeof raw.credits === "number" ? raw.credits : undefined,
    description: typeof raw.description === "string" ? raw.description : undefined,
    tags: Array.isArray(raw.tags) ? raw.tags.filter((tag): tag is string => typeof tag === "string") : undefined,
    apiRoutes: normalizeModelApiRoutes(raw.apiRoutes, fallbackApiRoutes, fallbackType),
  };
}

function normalizeProvider(provider: unknown): ProviderConfig | null {
  if (!provider || typeof provider !== "object") return null;
  const raw = provider as Partial<ProviderConfig>;
  if (!raw.id || !raw.name) return null;
  const models = emptyModelGroup();
  for (const type of modelTypes) {
    const rawList = Array.isArray(raw.models?.[type]) ? raw.models[type] : [];
    models[type] = rawList.map((model) => normalizeModel(model, type, raw)).filter((model): model is ProviderModel => Boolean(model));
  }
  return {
    id: String(raw.id),
    name: String(raw.name),
    kind: "custom",
key: typeof raw.key === "string" ? raw.key : "",
baseUrl: typeof raw.baseUrl === "string" ? raw.baseUrl : "",
logAccessToken: typeof raw.logAccessToken === "string" ? raw.logAccessToken : undefined,
 useReferenceImagesParam: raw.useReferenceImagesParam === true,
models,
};
}

function normalizeProviders(input: unknown) {
  return Array.isArray(input) ? input.map(normalizeProvider).filter((provider): provider is ProviderConfig => Boolean(provider)) : [];
}

function findNormalizedModelValue(value: string, providers: ProviderConfig[]) {
  for (const provider of providers) {
    for (const type of modelTypes) {
      for (const model of provider.models[type]) {
        if (value === buildProviderModelValue(provider.id, model.id) || value === model.id) return buildProviderModelValue(provider.id, model.id);
      }
    }
  }
  return null;
}

function normalizeRouting(input: unknown, providers: ProviderConfig[]): RoutingConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const asArray = (value: unknown) => (Array.isArray(value) ? value : []);
  return {
    language: asArray(raw.language).map(String).map((id) => findNormalizedModelValue(id, providers)).filter((id): id is string => Boolean(id)),
    image: asArray(raw.image).map(String).map((id) => findNormalizedModelValue(id, providers)).filter((id): id is string => Boolean(id)),
    video: asArray(raw.video).map(String).map((id) => findNormalizedModelValue(id, providers)).filter((id): id is string => Boolean(id)),
    audio: asArray(raw.audio).map(String).map((id) => findNormalizedModelValue(id, providers)).filter((id): id is string => Boolean(id)),
  };
}

function removeModelsFromRouting(routing: RoutingConfig, modelIds: string[]): RoutingConfig {
  return {
    language: routing.language.filter((id) => !modelIds.includes(id)),
    image: routing.image.filter((id) => !modelIds.includes(id)),
    video: routing.video.filter((id) => !modelIds.includes(id)),
    audio: routing.audio.filter((id) => !modelIds.includes(id)),
  };
}

function replaceRoutingModelIds(routing: RoutingConfig, providerId: string, oldId: string, nextId: string): RoutingConfig {
  const oldValue = buildProviderModelValue(providerId, oldId);
  const nextValue = buildProviderModelValue(providerId, nextId);
  return {
    language: routing.language.map((id) => (id === oldValue || id === oldId ? nextValue : id)),
    image: routing.image.map((id) => (id === oldValue || id === oldId ? nextValue : id)),
    video: routing.video.map((id) => (id === oldValue || id === oldId ? nextValue : id)),
    audio: routing.audio.map((id) => (id === oldValue || id === oldId ? nextValue : id)),
  };
}

export const useUserModelStore = create<UserModelState>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),
      getCustomProviders: () => get().providers,
      updateProvider: (providerId, data) => set((state) => ({ providers: state.providers.map((provider) => (provider.id === providerId ? { ...provider, ...data } : provider)) })),
      addCustomProvider: (data) => {
        const id = createProviderId();
 const provider: ProviderConfig = { id, name: data?.name || "自定义供应商", kind: "custom", key: data?.key || "", baseUrl: data?.baseUrl || "", logAccessToken: data?.logAccessToken?.trim() || undefined, useReferenceImagesParam: data?.useReferenceImagesParam === true, models: emptyModelGroup() };
        set((state) => ({ providers: [provider, ...state.providers] }));
        return id;
      },
      removeProvider: (providerId) => set((state) => {
        const removed = state.providers.find((provider) => provider.id === providerId);
        const removedIds = removed ? modelTypes.flatMap((type) => removed.models[type].flatMap((model) => getProviderModelLookupValues(providerId, model.id))) : [];
        return { providers: state.providers.filter((provider) => provider.id !== providerId), routing: removeModelsFromRouting(state.routing, removedIds) };
      }),
      addProviderModel: (providerId, type, model) => set((state) => ({ providers: state.providers.map((provider) => provider.id !== providerId || provider.models[type].some((item) => item.id === model.id) ? provider : { ...provider, models: { ...provider.models, [type]: [...provider.models[type], { id: model.id.trim(), name: model.name.trim() || model.id.trim(), type, thumbnailUrl: model.thumbnailUrl?.trim() || undefined, providerDisplayName: model.providerDisplayName?.trim() || undefined, description: model.description?.trim() || undefined, tags: model.tags?.filter(Boolean), credits: typeof model.credits === "number" ? model.credits : undefined, apiRoutes: normalizeModelApiRoutes(model.apiRoutes, getDefaultModelApiRoutes({ providerId: provider.id, providerName: provider.name, providerBaseUrl: provider.baseUrl, modelId: model.id.trim(), modelName: model.name.trim() || model.id.trim(), type }), type) }] } }) })),
      updateProviderModel: (providerId, type, modelId, data) => set((state) => {
        const nextId = data.id?.trim() || modelId;
        return {
          providers: state.providers.map((provider) => provider.id !== providerId ? provider : { ...provider, models: { ...provider.models, [type]: provider.models[type].map((model) => model.id === modelId ? { ...model, id: nextId, name: data.name?.trim() || model.name, thumbnailUrl: data.thumbnailUrl === undefined ? model.thumbnailUrl : data.thumbnailUrl.trim() || undefined, providerDisplayName: data.providerDisplayName === undefined ? model.providerDisplayName : data.providerDisplayName.trim() || undefined, description: data.description === undefined ? model.description : data.description.trim() || undefined, tags: data.tags === undefined ? model.tags : data.tags.filter(Boolean), credits: data.credits === undefined ? model.credits : data.credits, apiRoutes: data.apiRoutes === undefined ? model.apiRoutes : normalizeModelApiRoutes(data.apiRoutes, getDefaultModelApiRoutes({ providerId: provider.id, providerName: provider.name, providerBaseUrl: provider.baseUrl, modelId: nextId, modelName: data.name?.trim() || model.name, type }), type) } : model) } }),
          routing: nextId !== modelId ? replaceRoutingModelIds(state.routing, providerId, modelId, nextId) : state.routing,
        };
      }),
      removeProviderModel: (providerId, type, modelId) => set((state) => ({ providers: state.providers.map((provider) => provider.id === providerId ? { ...provider, models: { ...provider.models, [type]: provider.models[type].filter((model) => model.id !== modelId) } } : provider), routing: removeModelsFromRouting(state.routing, getProviderModelLookupValues(providerId, modelId)) })),
      updateRouting: (type, modelIds) => set((state) => ({ routing: { ...state.routing, [type]: Array.from(new Set(modelIds)) } })),
      toggleRoutingModel: (type, modelId) => set((state) => ({ routing: { ...state.routing, [type]: state.routing[type].includes(modelId) ? state.routing[type].filter((id) => id !== modelId) : [...state.routing[type], modelId] } })),
    }),
    {
      name: "koala-user-models-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state): PersistedUserModels => ({ providers: state.providers, routing: state.routing }),
      merge: (persistedState, currentState) => {
        const raw = (persistedState ?? {}) as PersistedUserModels;
        const providers = normalizeProviders(raw.providers);
        return { ...currentState, providers, routing: normalizeRouting(raw.routing, providers) };
      },
    } as PersistOptions<UserModelState>
  )
);
