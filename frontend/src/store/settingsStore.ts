import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { getDefaultModelApiRoutes, normalizeModelApiRoutes, type ModelApiRouteConfig } from "../lib/modelApiRoutes";
import { buildProviderModelValue, getProviderModelLookupValues } from "../lib/providerModels";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export type ModelType = "language" | "image" | "video" | "audio";

export interface ProviderModel {
  id: string;
  name: string;
  type: ModelType;
  thumbnailUrl?: string;
  providerDisplayName?: string;
  credits?: number;
  description?: string;
  tags?: string[];
  apiRoutes?: ModelApiRouteConfig[];
}

export interface ProviderConfig {
  id: string;
  name: string;
  kind: "system" | "custom";
  key: string;
  baseUrl: string;
  logAccessToken?: string;
  models: Record<ModelType, ProviderModel[]>;
  useReferenceImagesParam?: boolean; // Use reference_images parameter in /images/generations instead of /images/edits
}

export interface RoutingConfig {
  language: string[];
  image: string[];
  video: string[];
  audio: string[];
}

export interface SettingsState {
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
  resetSettings: () => void;
}

type PersistedSettings = Partial<Pick<SettingsState, "providers" | "routing">>;

const modelTypes: ModelType[] = ["language", "image", "video", "audio"];

function emptyModelGroup(): Record<ModelType, ProviderModel[]> {
  return {
    language: [],
    image: [],
    video: [],
    audio: [],
  };
}

function createDefaultState() {
  return {
    providers: [],
    routing: {
      language: [],
      image: [],
      video: [],
      audio: [],
    } satisfies RoutingConfig,
  };
}

function findNormalizedModelValue(value: string, providers: ProviderConfig[]) {
  for (const provider of providers) {
    for (const type of modelTypes) {
      for (const model of provider.models[type]) {
        if (value === buildProviderModelValue(provider.id, model.id) || value === model.id) {
          return buildProviderModelValue(provider.id, model.id);
        }
      }
    }
  }

  return null;
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
    const rawList = Array.isArray(raw.models?.[type]) ? raw.models?.[type] : [];
    models[type] = rawList
      .map((model) => normalizeModel(model, type, raw))
      .filter((model): model is ProviderModel => Boolean(model));
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

const LEGACY_SYSTEM_IDS = new Set(["openai", "anthropic", "deepseek", "midjourney", "runway", "kling", "elevenlabs"]);

function normalizeProviders(input: unknown): ProviderConfig[] {
  if (!Array.isArray(input)) return [];

  return input
    .map(normalizeProvider)
    .filter((provider): provider is ProviderConfig => Boolean(provider))
    .filter((provider) => !LEGACY_SYSTEM_IDS.has(provider.id));
}

function normalizeRouting(input: unknown, providers: ProviderConfig[]): RoutingConfig {
  const raw = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const asArray = (value: unknown) => {
    if (Array.isArray(value)) return value.filter((item): item is string => typeof item === "string");
    if (typeof value === "string") return [value];
    return [];
  };

  const normalizeList = (value: unknown) =>
    Array.from(
      new Set(
        asArray(value)
          .map((modelId) => findNormalizedModelValue(modelId, providers))
          .filter((modelId): modelId is string => Boolean(modelId))
      )
    );

  return {
    language: normalizeList(raw.language ?? raw.text),
    image: normalizeList(raw.image),
    video: normalizeList(raw.video),
    audio: normalizeList(raw.audio),
  };
}

function removeModelsFromRouting(routing: RoutingConfig, modelIds: string[]): RoutingConfig {
  return {
    language: routing.language.filter((modelId) => !modelIds.includes(modelId)),
    image: routing.image.filter((modelId) => !modelIds.includes(modelId)),
    video: routing.video.filter((modelId) => !modelIds.includes(modelId)),
    audio: routing.audio.filter((modelId) => !modelIds.includes(modelId)),
  };
}

function replaceRoutingModelIds(
  routing: RoutingConfig,
  providerId: string,
  oldId: string,
  nextId: string
): RoutingConfig {
  const oldValues = new Set(getProviderModelLookupValues(providerId, oldId));
  const nextValue = buildProviderModelValue(providerId, nextId);
  const replaceList = (list: string[]) =>
    Array.from(new Set(list.map((item) => (oldValues.has(item) ? nextValue : item))));

  return {
    language: replaceList(routing.language),
    image: replaceList(routing.image),
    video: replaceList(routing.video),
    audio: replaceList(routing.audio),
  };
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      ...createDefaultState(),

      getCustomProviders: () => get().providers.filter((p) => p.kind === "custom"),

      updateProvider: (providerId, data) =>
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === providerId ? { ...provider, ...data } : provider
          ),
        })),

      addCustomProvider: (data) => {
        const providerId = `custom-${Date.now()}`;
        set((state) => ({
          providers: [
            ...state.providers,
            {
              id: providerId,
              name: data?.name?.trim() || "自定义供应商",
              kind: "custom",
key: data?.key ?? "",
baseUrl: data?.baseUrl ?? "",
logAccessToken: data?.logAccessToken?.trim() || undefined,
 useReferenceImagesParam: data?.useReferenceImagesParam === true,
models: emptyModelGroup(),
},
          ],
        }));
        return providerId;
      },

      removeProvider: (providerId) =>
        set((state) => {
          const provider = state.providers.find((item) => item.id === providerId);
          if (!provider) return state;

          const removedIds = modelTypes.flatMap((type) =>
            provider.models[type].flatMap((model) => getProviderModelLookupValues(provider.id, model.id))
          );

          return {
            providers: state.providers.filter((item) => item.id !== providerId),
            routing: removeModelsFromRouting(state.routing, removedIds),
          };
        }),

      addProviderModel: (providerId, type, model) =>
        set((state) => ({
          providers: state.providers.map((provider) => {
            if (provider.id !== providerId) return provider;
            if (provider.models[type].some((item) => item.id === model.id)) return provider;

            return {
              ...provider,
              models: {
                ...provider.models,
                [type]: [
                  ...provider.models[type],
                   {
                     id: model.id.trim(),
                     name: model.name.trim() || model.id.trim(),
                     type,
                     thumbnailUrl: model.thumbnailUrl?.trim() || undefined,
                     providerDisplayName: model.providerDisplayName?.trim() || undefined,
                     description: model.description?.trim() || undefined,
                     tags: model.tags?.filter(Boolean),
                     credits: typeof model.credits === "number" ? model.credits : undefined,
                     apiRoutes: normalizeModelApiRoutes(
                       model.apiRoutes,
                       getDefaultModelApiRoutes({
                         providerId: provider.id,
                         providerName: provider.name,
                         providerBaseUrl: provider.baseUrl,
                         modelId: model.id.trim(),
                         modelName: model.name.trim() || model.id.trim(),
                         type,
                       }),
                       type
                     ),
                   },
                 ],
               },
            };
          }),
        })),

      updateProviderModel: (providerId, type, modelId, data) =>
        set((state) => {
          const nextId = data.id?.trim() || modelId;

          return {
            providers: state.providers.map((provider) => {
              if (provider.id !== providerId) return provider;

              return {
                ...provider,
                models: {
                  ...provider.models,
                  [type]: provider.models[type].map((model) =>
                    model.id === modelId
                        ? {
                            ...model,
                            id: nextId,
                            name: data.name?.trim() || model.name,
                            thumbnailUrl:
                              data.thumbnailUrl === undefined ? model.thumbnailUrl : data.thumbnailUrl.trim() || undefined,
                            providerDisplayName:
                              data.providerDisplayName === undefined ? model.providerDisplayName : data.providerDisplayName.trim() || undefined,
                            description:
                              data.description === undefined ? model.description : data.description.trim() || undefined,
                            tags: data.tags === undefined ? model.tags : data.tags.filter(Boolean),
                            credits: data.credits === undefined ? model.credits : data.credits,
                            apiRoutes:
                              data.apiRoutes === undefined
                                ? model.apiRoutes
                                : normalizeModelApiRoutes(
                                    data.apiRoutes,
                                    getDefaultModelApiRoutes({
                                      providerId: provider.id,
                                      providerName: provider.name,
                                      providerBaseUrl: provider.baseUrl,
                                      modelId: nextId,
                                      modelName: data.name?.trim() || model.name,
                                      type,
                                    }),
                                    type
                                  ),
                          }
                        : model
                  ),
                },
              };
            }),
            routing:
              nextId !== modelId
                ? replaceRoutingModelIds(state.routing, providerId, modelId, nextId)
                : state.routing,
          };
        }),

      removeProviderModel: (providerId, type, modelId) =>
        set((state) => ({
          providers: state.providers.map((provider) =>
            provider.id === providerId
              ? {
                  ...provider,
                  models: {
                    ...provider.models,
                    [type]: provider.models[type].filter((model) => model.id !== modelId),
                  },
                }
              : provider
          ),
          routing: removeModelsFromRouting(state.routing, getProviderModelLookupValues(providerId, modelId)),
        })),

      updateRouting: (type, modelIds) =>
        set((state) => ({
          routing: {
            ...state.routing,
            [type]: Array.from(new Set(modelIds)),
          },
        })),

      toggleRoutingModel: (type, modelId) =>
        set((state) => {
          const exists = state.routing[type].includes(modelId);
          return {
            routing: {
              ...state.routing,
              [type]: exists
                ? state.routing[type].filter((item) => item !== modelId)
                : [...state.routing[type], modelId],
            },
          };
        }),

      resetSettings: () => set(createDefaultState()),
    }),
    {
      name: "ai-director-settings-v2",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state): PersistedSettings => ({
        providers: state.providers,
        routing: state.routing,
      }),
      merge: (persistedState, currentState) => {
        const raw = (persistedState ?? {}) as PersistedSettings;
        const customProviders = normalizeProviders(raw.providers);
        return {
          ...currentState,
          providers: customProviders,
          routing: normalizeRouting(raw.routing, customProviders),
        };
      },
    } as PersistOptions<SettingsState>
  )
);
