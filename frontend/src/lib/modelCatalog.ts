import type { ModelType, ProviderConfig, RoutingConfig } from "../store/settingsStore";
import { buildProviderModelValue, buildSourcedProviderModelValue, type ProviderModelSource } from "./providerModels";

export type ModelCatalogOption = {
  value: string;
  label: string;
  hint?: string;
  providerName?: string;
  description?: string;
  thumbText?: string;
  thumbClassName?: string;
  imageUrl?: string;
  labels?: string[];
  source?: ProviderModelSource;
};

const palettes: Record<ModelType, string[]> = {
  language: [
    "from-sky-500 via-blue-500 to-indigo-700",
    "from-cyan-400 via-sky-500 to-violet-600",
    "from-blue-500 via-indigo-500 to-fuchsia-600",
  ],
  image: [
    "from-fuchsia-500 via-violet-500 to-cyan-300",
    "from-cyan-400 via-sky-500 to-indigo-700",
    "from-emerald-400 via-teal-500 to-cyan-700",
    "from-pink-500 via-rose-500 to-orange-400",
  ],
  video: [
    "from-orange-400 via-cyan-500 to-red-600",
    "from-pink-400 via-rose-500 to-orange-500",
    "from-sky-400 via-blue-500 to-indigo-600",
    "from-red-500 via-orange-500 to-cyan-400",
  ],
  audio: [
    "from-fuchsia-500 via-pink-500 to-rose-500",
    "from-violet-500 via-purple-500 to-fuchsia-500",
    "from-cyan-500 via-teal-500 to-emerald-500",
  ],
};

function hashKey(value: string) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function buildThumbText(label: string, fallback: string) {
  const cleaned = label
    .split(/[\s/_-]+/)
    .filter(Boolean)
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return cleaned || fallback.slice(0, 2).toUpperCase();
}

export function buildModelCatalogOptions(
  providers: ProviderConfig[],
  routing: RoutingConfig,
  type: ModelType,
  source?: ProviderModelSource
): ModelCatalogOption[] {
  const routedIds = new Set(routing[type]);

  return providers
    .flatMap((provider) =>
      provider.models[type].filter((model) => routedIds.has(buildProviderModelValue(provider.id, model.id))).map((model) => {
        const paletteSet = palettes[type];
        const palette = paletteSet[hashKey(`${provider.id}:${model.id}`) % paletteSet.length];
        const rawValue = buildProviderModelValue(provider.id, model.id);
        const value = source ? buildSourcedProviderModelValue(source, provider.id, model.id) : rawValue;

        return {
          value,
          label: model.name,
          hint: model.description || (routedIds.has(value) ? `${model.providerDisplayName || provider.name} · 已加入默认路由` : model.providerDisplayName || provider.name),
          providerName: model.providerDisplayName || provider.name,
          thumbText: buildThumbText(model.name, model.id),
          thumbClassName: palette,
          source,
          isRouted: routedIds.has(rawValue),
          imageUrl: model.thumbnailUrl || `https://api.dicebear.com/7.x/shapes/svg?seed=${hashKey(value)}`,
          labels: model.tags?.length ? model.tags : undefined,
          description: model.description,
        };
      })
    )
    .sort((left, right) => {
      if (left.isRouted !== right.isRouted) return left.isRouted ? -1 : 1;
      return left.label.localeCompare(right.label);
    })
    .map(({ isRouted: _isRouted, ...option }) => option);
}

export function getPreferredModelValue<T extends { value: string }>(options: T[]) {
  return options[0]?.value ?? "";
}
