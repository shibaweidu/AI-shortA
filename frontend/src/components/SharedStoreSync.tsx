import { useEffect } from "react";
import { subscribeSharedStateUpdates } from "../lib/sharedStateStorage";
import { useAdminAuthStore } from "../store/adminAuthStore";
import { useAuthStore } from "../store/authStore";
import { useCreditStore } from "../store/creditStore";
import { useDiscoverStore } from "../store/discoverStore";
import { useFlowStore } from "../store/flowStore";
import { useModelCreditStore } from "../store/modelCreditStore";
import { useSettingsStore } from "../store/settingsStore";
import { useSiteContentStore } from "../store/siteContentStore";
import { useUserModelStore } from "../store/userModelStore";

const rehydrateByStorageKey: Record<string, () => void> = {
  "koala-site-content-v1": () => void useSiteContentStore.persist.rehydrate(),
  "ai-director-settings-v2": () => void useSettingsStore.persist.rehydrate(),
  "koala-user-models-v1": () => void useUserModelStore.persist.rehydrate(),
  "discover-store": () => void useDiscoverStore.persist.rehydrate(),
  "koala-credit-store-v1": () => void useCreditStore.persist.rehydrate(),
  "koala-auth-store-v1": () => void useAuthStore.persist.rehydrate(),
  "koala-admin-auth-store-v1": () => void useAdminAuthStore.persist.rehydrate(),
  "koala-model-credit-store-v1": () => void useModelCreditStore.persist.rehydrate(),
  "ai-director-flow-v2": () => void useFlowStore.persist.rehydrate(),
};

function resetAndRehydrateFlowStore() {
  useFlowStore.setState({ projects: [], items: [], hasHydrated: false });
  void useFlowStore.persist.rehydrate();
}

function getBaseStorageKey(key: string) {
  return key.split(":")[0];
}

export function SharedStoreSync() {
  const currentUserId = useAuthStore((state) => state.currentUserId);

  useEffect(() => {
    resetAndRehydrateFlowStore();
  }, [currentUserId]);

  useEffect(() => {
    let timeout: number | undefined;
    const pendingKeys = new Set<string>();

    const unsubscribe = subscribeSharedStateUpdates((key) => {
      const baseKey = getBaseStorageKey(key);
      if (!rehydrateByStorageKey[baseKey]) return;
      pendingKeys.add(baseKey);
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => {
        for (const pendingKey of pendingKeys) rehydrateByStorageKey[pendingKey]?.();
        pendingKeys.clear();
      }, 100);
    });

    return () => {
      window.clearTimeout(timeout);
      unsubscribe();
    };
  }, []);

  return null;
}
