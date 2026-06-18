export function getProviderKeys(value?: string) {
  return (value ?? "")
    .split(/\r?\n/)
    .map((key) => key.trim())
    .filter(Boolean);
}

export function getProviderKeyCount(value?: string) {
  return getProviderKeys(value).length;
}

export function selectProviderKey(providerId: string, keyValue?: string) {
  const keys = getProviderKeys(keyValue);
  if (keys.length <= 1) return keys[0] ?? "";

  const storageKey = `koala-provider-key-round-robin:${providerId}`;
  let index = 0;
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored >= 0) index = stored;
  } catch {
    index = 0;
  }

  const selectedKey = keys[index % keys.length];
  try {
    window.localStorage.setItem(storageKey, String((index + 1) % keys.length));
  } catch {
    // Round-robin still works within this call even if localStorage is unavailable.
  }
  return selectedKey;
}

export function withSelectedProviderKey<T extends { id: string; key: string }>(provider: T): T {
  return { ...provider, key: selectProviderKey(provider.id, provider.key) };
}
