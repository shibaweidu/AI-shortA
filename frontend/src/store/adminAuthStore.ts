import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions } from "zustand/middleware";
import { createPasswordHashRecord, verifyPasswordHash, type PasswordHashRecord } from "../lib/passwordHash";
import { createBackendBackedStorage, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

interface AdminAccount extends Partial<PasswordHashRecord> {
  username: string;
  password?: string;
  updatedAt: number;
  lastLoginAt?: number;
}

interface AdminAuthState {
  account: AdminAccount;
  loggedIn: boolean;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  login: (username: string, password: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  logout: () => void;
  updateAccount: (input: { username: string; password: string; currentPassword: string }) => Promise<{ ok: true } | { ok: false; message: string }>;
  migrateLegacyPassword: () => Promise<void>;
}

type PersistedAdminAuthState = Pick<AdminAuthState, "account" | "loggedIn">;

const defaultAccount: AdminAccount = {
  username: "admin",
  password: "admin123",
  updatedAt: Date.now(),
};

function stripLegacyPassword(account: AdminAccount, hashRecord: PasswordHashRecord): AdminAccount {
  const { password: _password, ...rest } = account;
  return { ...rest, ...hashRecord };
}

async function verifyAdminPassword(account: AdminAccount, password: string) {
  if (account.passwordHash && account.passwordSalt && typeof account.passwordVersion === "number") {
    return verifyPasswordHash(password, {
      passwordHash: account.passwordHash,
      passwordSalt: account.passwordSalt,
      passwordVersion: account.passwordVersion,
    });
  }
  return typeof account.password === "string" && account.password === password;
}

export const useAdminAuthStore = create<AdminAuthState>()(
  persist(
    (set, get) => ({
      account: defaultAccount,
      loggedIn: false,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      login: async (username, password) => {
        const account = get().account;
        if (username.trim() !== account.username || !(await verifyAdminPassword(account, password))) {
          return { ok: false, message: "管理员账号或密码错误。" };
        }
        const migratedRecord = account.password ? await createPasswordHashRecord(password) : null;
        set((state) => {
          return {
            loggedIn: true,
            account: {
              ...(migratedRecord ? stripLegacyPassword(state.account, migratedRecord) : state.account),
              lastLoginAt: Date.now(),
            },
          };
        });
        return { ok: true };
      },
      logout: () => set({ loggedIn: false }),
      updateAccount: async ({ username, password, currentPassword }) => {
        const nextUsername = username.trim();
        if (nextUsername.length < 3) return { ok: false, message: "管理员账号至少需要 3 个字符。" };
        if (password.length < 6) return { ok: false, message: "管理员密码至少需要 6 个字符。" };

        const account = get().account;
        if (!(await verifyAdminPassword(account, currentPassword))) {
          return { ok: false, message: "当前管理员密码错误。" };
        }
        const passwordRecord = await createPasswordHashRecord(password);
        set((state) => {
          return {
            account: {
              username: nextUsername,
              ...passwordRecord,
              updatedAt: Date.now(),
              lastLoginAt: state.account.lastLoginAt,
            },
            loggedIn: true,
          };
        });
        return { ok: true };
      },
      migrateLegacyPassword: async () => {
        const account = get().account;
        if (!account.password || account.passwordHash) return;
        const passwordRecord = await createPasswordHashRecord(account.password);
        set((state) => ({
          account: stripLegacyPassword(state.account, passwordRecord),
        }));
      },
    }),
    {
      name: "koala-admin-auth-store-v1",
      storage: createJSONStorage(() => createBackendBackedStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({ account: state.account, loggedIn: state.loggedIn }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        void state?.migrateLegacyPassword();
      },
    } satisfies PersistOptions<AdminAuthState, PersistedAdminAuthState>
  )
);
