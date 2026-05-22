import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

interface AdminAccount {
  username: string;
  password: string;
  updatedAt: number;
  lastLoginAt?: number;
}

interface AdminAuthState {
  account: AdminAccount;
  loggedIn: boolean;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  login: (username: string, password: string) => { ok: true } | { ok: false; message: string };
  logout: () => void;
  updateAccount: (input: { username: string; password: string; currentPassword: string }) => { ok: true } | { ok: false; message: string };
}

type PersistedAdminAuthState = Pick<AdminAuthState, "account" | "loggedIn">;

const defaultAccount: AdminAccount = {
  username: "admin",
  password: "admin123",
  updatedAt: Date.now(),
};

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set) => ({
      account: defaultAccount,
      loggedIn: false,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      login: (username, password) => {
        let result: { ok: true } | { ok: false; message: string } = { ok: false, message: "管理员账号或密码错误。" };
        set((state) => {
          if (username.trim() !== state.account.username || password !== state.account.password) return state;
          result = { ok: true };
          return {
            loggedIn: true,
            account: { ...state.account, lastLoginAt: Date.now() },
          };
        });
        return result;
      },
      logout: () => set({ loggedIn: false }),
      updateAccount: ({ username, password, currentPassword }) => {
        const nextUsername = username.trim();
        if (nextUsername.length < 3) return { ok: false, message: "管理员账号至少需要 3 个字符。" };
        if (password.length < 6) return { ok: false, message: "管理员密码至少需要 6 个字符。" };

        let result: { ok: true } | { ok: false; message: string } = { ok: false, message: "当前管理员密码错误。" };
        set((state) => {
          if (currentPassword !== state.account.password) return state;
          result = { ok: true };
          return {
            account: {
              username: nextUsername,
              password,
              updatedAt: Date.now(),
              lastLoginAt: state.account.lastLoginAt,
            },
            loggedIn: true,
          };
        });
        return result;
      },
    }),
    {
      name: "koala-admin-auth-store-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({ account: state.account, loggedIn: state.loggedIn }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
      },
    } satisfies PersistOptions<AdminAuthState, PersistedAdminAuthState>
  )
);
