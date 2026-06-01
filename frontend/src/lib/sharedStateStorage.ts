import type { StateStorage } from "zustand/middleware";

const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";
const SHARED_STATE_EVENT_KEY = "koala-shared-state-updated";
const SHARED_STATE_CHANNEL = "koala-shared-state";
const SHARED_STATE_SOURCE_ID = Math.random().toString(36).slice(2);

type SharedStateMessage = { key: string; updatedAt: number; sourceId?: string };
type ScopedStorageWriteGuardInput = { name: string; scopedName: string; value: string; backendValue: string | null };

function makeStateUrl(key: string) {
  return `${BACKEND_API}/api/app-state/${encodeURIComponent(key)}`;
}

async function readBackendState(key: string) {
  const response = await fetch(makeStateUrl(key), { cache: "no-store" });
  if (!response.ok) throw new Error(`Failed to read app state: ${response.status}`);

  const data = (await response.json()) as { value?: unknown };
  return typeof data.value === "string" ? data.value : null;
}

export function broadcastSharedStateUpdate(key: string) {
  const message: SharedStateMessage = { key, updatedAt: Date.now(), sourceId: SHARED_STATE_SOURCE_ID };
  try {
    localStorage.setItem(SHARED_STATE_EVENT_KEY, JSON.stringify(message));
  } catch {
    // Local broadcast is a convenience; backend persistence is the source of truth.
  }

  try {
    const channel = new BroadcastChannel(SHARED_STATE_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel is not available in all contexts.
  }
}

async function writeBackendState(key: string, value: string | null) {
  const response = await fetch(makeStateUrl(key), {
    method: value === null ? "DELETE" : "PUT",
    headers: value === null ? undefined : { "Content-Type": "application/json" },
    body: value === null ? undefined : JSON.stringify({ value }),
  });
  if (!response.ok) throw new Error(`Failed to write app state: ${response.status}`);
}

function removeFallbackState(fallback: StateStorage, key: string) {
  return Promise.resolve(fallback.removeItem(key));
}

function resolveScopedKey(name: string, getScopeId?: () => string | undefined) {
  const scopeId = getScopeId?.()?.trim();
  return scopeId ? `${name}:${scopeId}` : name;
}

export function createLocalStorageStateStorage(): StateStorage<Promise<void>> {
  return {
    getItem: async (name) => localStorage.getItem(name),
    setItem: async (name, value) => localStorage.setItem(name, value),
    removeItem: async (name) => localStorage.removeItem(name),
  };
}

export function createBackendBackedStorage(fallback: StateStorage): StateStorage<Promise<void>> {
  return {
    getItem: async (name) => {
      try {
        const backendValue = await readBackendState(name);
        if (typeof backendValue === "string") {
          await fallback.setItem(name, backendValue);
          return backendValue;
        }
      } catch {
        // Fall back to the browser copy when the backend is not available.
      }

      const fallbackValue = await fallback.getItem(name);
      if (typeof fallbackValue === "string") {
        void writeBackendState(name, fallbackValue).catch(() => undefined);
      }
      return fallbackValue;
    },
    setItem: async (name, value) => {
      await fallback.setItem(name, value);
      try {
        await writeBackendState(name, value);
      } catch {
        // Keep the local copy even if the backend is temporarily unavailable.
      }
      broadcastSharedStateUpdate(name);
    },
    removeItem: async (name) => {
      await fallback.removeItem(name);
      try {
        await writeBackendState(name, null);
      } catch {
        // Keep local deletion; backend will be updated on the next successful write.
      }
      broadcastSharedStateUpdate(name);
    },
  };
}

export function createServerPrimaryStorage(fallback: StateStorage): StateStorage<Promise<void>> {
  return {
    getItem: async (name) => {
      try {
        const backendValue = await readBackendState(name);
        if (typeof backendValue === "string") {
          void removeFallbackState(fallback, name).catch(() => undefined);
          return backendValue;
        }
      } catch {
        // Avoid reading large browser-side flow history when the backend is down.
        return null;
      }

      return null;
    },
    setItem: async (name, value) => {
      try {
        await writeBackendState(name, value);
        void removeFallbackState(fallback, name).catch(() => undefined);
      } catch {
        // Server-primary stores should not keep writing large state into the browser.
      }
      broadcastSharedStateUpdate(name);
    },
    removeItem: async (name) => {
      await removeFallbackState(fallback, name);
      try {
        await writeBackendState(name, null);
      } catch {
        // Local deletion still prevents stale browser data from being restored.
      }
      broadcastSharedStateUpdate(name);
    },
  };
}

export function createScopedServerPrimaryStorage(
  fallback: StateStorage,
  getScopeId: () => string | undefined,
  options?: {
    guestScopeId?: string;
    shouldSkipWrite?: (input: ScopedStorageWriteGuardInput) => boolean;
  }
): StateStorage<Promise<void>> {
  const resolveName = (name: string) => resolveScopedKey(name, () => getScopeId() || options?.guestScopeId);

  return {
    getItem: async (name) => {
      const scopedName = resolveName(name);
      try {
        const backendValue = await readBackendState(scopedName);
        if (typeof backendValue === "string") {
          void removeFallbackState(fallback, scopedName).catch(() => undefined);
          return backendValue;
        }
      } catch {
        return null;
      }

      return null;
    },
    setItem: async (name, value) => {
      const scopedName = resolveName(name);
      let backendValue: string | null = null;
      try {
        backendValue = await readBackendState(scopedName);
      } catch {
        backendValue = null;
      }
      if (options?.shouldSkipWrite?.({ name, scopedName, value, backendValue })) return;
      try {
        await writeBackendState(scopedName, value);
        void removeFallbackState(fallback, scopedName).catch(() => undefined);
      } catch {
        // Server-primary stores should not keep writing large state into the browser.
      }
      broadcastSharedStateUpdate(name);
      if (scopedName !== name) broadcastSharedStateUpdate(scopedName);
    },
    removeItem: async (name) => {
      const scopedName = resolveName(name);
      await removeFallbackState(fallback, scopedName);
      try {
        await writeBackendState(scopedName, null);
      } catch {
        // Local deletion still prevents stale browser data from being restored.
      }
      broadcastSharedStateUpdate(name);
      if (scopedName !== name) broadcastSharedStateUpdate(scopedName);
    },
  };
}

export function subscribeSharedStateUpdates(onUpdate: (key: string) => void) {
  const handleMessage = (message: unknown) => {
    const data = message as Partial<SharedStateMessage> | undefined;
    if (data?.sourceId === SHARED_STATE_SOURCE_ID) return;
    if (typeof data?.key === "string") onUpdate(data.key);
  };

  const handleStorage = (event: StorageEvent) => {
    if (event.key !== SHARED_STATE_EVENT_KEY || !event.newValue) return;
    try {
      handleMessage(JSON.parse(event.newValue));
    } catch {
      // Ignore malformed local events.
    }
  };

  window.addEventListener("storage", handleStorage);

  let channel: BroadcastChannel | null = null;
  try {
    channel = new BroadcastChannel(SHARED_STATE_CHANNEL);
    channel.onmessage = (event) => handleMessage(event.data);
  } catch {
    channel = null;
  }

  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}
