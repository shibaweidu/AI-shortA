export const PROVIDER_MODEL_SEPARATOR = "::";
export const MODEL_SOURCE_SEPARATOR = ":";
export type ProviderModelSource = "koala" | "custom";

export function buildProviderModelValue(providerId: string, modelId: string) {
  return `${providerId}${PROVIDER_MODEL_SEPARATOR}${modelId}`;
}

export function buildSourcedProviderModelValue(source: ProviderModelSource, providerId: string, modelId: string) {
  return `${source}${MODEL_SOURCE_SEPARATOR}${buildProviderModelValue(providerId, modelId)}`;
}

export function parseSourcedProviderModelValue(value: string): { source: ProviderModelSource; providerId: string; modelId: string } | null {
  const separatorIndex = value.indexOf(MODEL_SOURCE_SEPARATOR);
  if (separatorIndex === -1) return null;
  const source = value.slice(0, separatorIndex);
  if (source !== "koala" && source !== "custom") return null;
  const parsed = parseProviderModelValue(value.slice(separatorIndex + MODEL_SOURCE_SEPARATOR.length));
  if (!parsed) return null;
  return { source, ...parsed };
}

export function parseProviderModelValue(value: string) {
  const separatorIndex = value.indexOf(PROVIDER_MODEL_SEPARATOR);
  if (separatorIndex === -1) return null;

  return {
    providerId: value.slice(0, separatorIndex),
    modelId: value.slice(separatorIndex + PROVIDER_MODEL_SEPARATOR.length),
  };
}

export function getProviderModelLookupValues(providerId: string, modelId: string) {
  return [buildProviderModelValue(providerId, modelId), modelId];
}

export function matchesProviderModelValue(value: string, providerId: string, modelId: string) {
  const exactValue = buildProviderModelValue(providerId, modelId);
  return value === exactValue || value === modelId;
}
