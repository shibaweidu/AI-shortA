import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions, type StateStorage } from "zustand/middleware";
import { createPasswordHashRecord, verifyPasswordHash, type PasswordHashRecord } from "../lib/passwordHash";
import { broadcastSharedStateUpdate, createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
}

interface StoredUser extends AppUser, Partial<PasswordHashRecord> {
  password?: string;
}

interface AuthState {
  users: StoredUser[];
  currentUserId?: string;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  register: (input: AuthInput) => Promise<AuthResult>;
  login: (input: AuthInput) => Promise<AuthResult>;
  logout: () => void;
  updateUserStatus: (id: string, status: AppUser["status"]) => void;
  renameUser: (id: string, displayName: string) => void;
  updateDisplayName: (id: string, displayName: string) => { ok: true } | { ok: false; message: string };
  updateUsername: (id: string, username: string) => { ok: true } | { ok: false; message: string };
  updatePassword: (id: string, currentPassword: string, nextPassword: string, confirmPassword: string) => Promise<{ ok: true } | { ok: false; message: string }>;
  migrateLegacyPasswords: () => Promise<void>;
}

interface AuthInput {
  username: string;
  password: string;
  displayName?: string;
}

type AuthResult = { ok: true; userId: string } | { ok: false; message: string };
type PersistedAuthState = Pick<AuthState, "users"> & { currentUserId?: string };
const AUTH_STORAGE_KEY = "koala-auth-store-v1";
const AUTH_LOCAL_SESSION_KEY = "koala-auth-local-session-v1";
const AUTH_LOGOUT_MARKER_KEY = "koala-auth-logged-out-v1";
const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";
function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUsername(value: string) {
  return value.trim().toLowerCase();
}

function validateInput(input: AuthInput) {
  const username = normalizeUsername(input.username);
  const password = input.password;
  if (username.length < 3) return { ok: false as const, message: "账号至少需要 3 个字符。" };
  if (password.length < 6) return { ok: false as const, message: "密码至少需要 6 个字符。" };
  return { ok: true as const, username, password };
}

function validateDisplayName(value?: string) {
  const displayName = value?.trim();
  if (!displayName) return "";
  if (displayName.length > 24) return "";
  return displayName;
}

function makeStateUrl(key: string) {
  return `${BACKEND_API}/api/app-state/${encodeURIComponent(key)}`;
}

async function readBackendAuthState() {
  try {
    const response = await fetch(makeStateUrl(AUTH_STORAGE_KEY), { cache: "no-store" });
    if (!response.ok) return null;
    const data = await response.json() as { value?: unknown };
    if (typeof data.value !== "string") return null;
    return JSON.parse(data.value) as { state?: Partial<PersistedAuthState>; version?: number };
  } catch {
    return null;
  }
}

function parsePersistedAuthState(value?: string | null) {
  if (typeof value !== "string") return null;
  try {
    return JSON.parse(value) as { state?: Partial<PersistedAuthState>; version?: number };
  } catch {
    return null;
  }
}

async function writeBackendAuthState(users: StoredUser[]) {
  await fetch(makeStateUrl(AUTH_STORAGE_KEY), {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ value: JSON.stringify({ state: { users }, version: 0 }) }),
  });
}

function createPersistedUsersValue(users: StoredUser[], version = 0) {
  return JSON.stringify({ state: { users }, version });
}

function stripLegacyPassword(user: StoredUser, hashRecord: PasswordHashRecord): StoredUser {
  const { password: _password, ...rest } = user;
  return { ...rest, ...hashRecord };
}

async function verifyStoredUserPassword(user: StoredUser, password: string) {
  if (user.passwordHash && user.passwordSalt && typeof user.passwordVersion === "number") {
    return verifyPasswordHash(password, {
      passwordHash: user.passwordHash,
      passwordSalt: user.passwordSalt,
      passwordVersion: user.passwordVersion,
    });
  }
  return typeof user.password === "string" && user.password === password;
}

function readLocalCurrentUserId() {
  try {
    if (localStorage.getItem(AUTH_LOGOUT_MARKER_KEY)) return undefined;
    const raw = localStorage.getItem(AUTH_LOCAL_SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as { currentUserId?: unknown };
    return typeof parsed.currentUserId === "string" ? parsed.currentUserId : undefined;
  } catch {
    return undefined;
  }
}

function writeLocalCurrentUserId(currentUserId?: string) {
  if (!currentUserId) {
    localStorage.removeItem(AUTH_LOCAL_SESSION_KEY);
    return;
  }
  localStorage.removeItem(AUTH_LOGOUT_MARKER_KEY);
  localStorage.setItem(AUTH_LOCAL_SESSION_KEY, JSON.stringify({ currentUserId }));
}

function markLoggedOut() {
  writeLocalCurrentUserId(undefined);
  localStorage.setItem(AUTH_LOGOUT_MARKER_KEY, JSON.stringify({ loggedOutAt: Date.now() }));
}

async function clearPersistedCurrentUserId(fallback: StateStorage, name = AUTH_STORAGE_KEY) {
  markLoggedOut();
  const fallbackValue = await fallback.getItem(name);
  const fallbackState = parsePersistedAuthState(fallbackValue);
  if (!fallbackState?.state) return;
  await fallback.setItem(name, createPersistedUsersValue(fallbackState.state.users ?? [], fallbackState.version ?? 0));
}

function broadcastAuthUsersUpdate() {
  broadcastSharedStateUpdate(AUTH_STORAGE_KEY);
}

function createAuthStateStorage(fallback: StateStorage): StateStorage<Promise<void>> {
  return {
    getItem: async (name) => {
      const backendState = await readBackendAuthState();
      const fallbackValue = await fallback.getItem(name);
      const fallbackState = parsePersistedAuthState(fallbackValue);
      const users = backendState?.state?.users ?? fallbackState?.state?.users ?? [];
      const localCurrentUserId = readLocalCurrentUserId();
      const currentUserId = users.some((user) => user.id === localCurrentUserId) ? localCurrentUserId : undefined;
      const merged = JSON.stringify({ state: { users, currentUserId }, version: backendState?.version ?? fallbackState?.version ?? 0 });
      await fallback.setItem(name, createPersistedUsersValue(users, backendState?.version ?? fallbackState?.version ?? 0));
      return merged;
    },
    setItem: async (name, value) => {
      const parsed = parsePersistedAuthState(value);
      const users = parsed?.state?.users ?? [];
      const currentUserId = parsed?.state?.currentUserId;
      await fallback.setItem(name, createPersistedUsersValue(users, parsed?.version ?? 0));
      writeLocalCurrentUserId(users.some((user) => user.id === currentUserId) ? currentUserId : undefined);
      try {
        await writeBackendAuthState(users);
        broadcastAuthUsersUpdate();
      } catch {
        // Local login state stays usable if the backend is temporarily unavailable.
      }
    },
    removeItem: async (name) => {
      await clearPersistedCurrentUserId(fallback, name);
      try {
        await writeBackendAuthState([]);
        broadcastAuthUsersUpdate();
      } catch {
        // Keep local deletion even when backend persistence is unavailable.
      }
    },
  };
}

export const useAuthStore = create<AuthState>()(
  persist(
    (set, get) => ({
      users: [],
      currentUserId: undefined,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      register: async (input) => {
        const validation = validateInput(input);
        if (!validation.ok) return validation;
        const displayName = validateDisplayName(input.displayName);
        if (input.displayName?.trim() && !displayName) return { ok: false, message: "用户名不能超过 24 个字符。" };

        if (get().users.some((user) => user.username === validation.username)) {
          return { ok: false, message: "账号已存在。" };
        }
        const passwordRecord = await createPasswordHashRecord(validation.password);
        let result: AuthResult = { ok: false, message: "账号已存在。" };
        set((state) => {
          if (state.users.some((user) => user.username === validation.username)) return state;
          const now = Date.now();
          const user: StoredUser = {
            id: createId("user"),
            username: validation.username,
            displayName: displayName || validation.username,
            ...passwordRecord,
            status: "active",
            createdAt: now,
            updatedAt: now,
            lastLoginAt: now,
          };
          result = { ok: true, userId: user.id };
          return { users: [user, ...state.users], currentUserId: user.id };
        });
        return result;
      },
      login: async (input) => {
        const validation = validateInput(input);
        if (!validation.ok) return validation;

        const user = get().users.find((item) => item.username === validation.username);
        if (!user || !(await verifyStoredUserPassword(user, validation.password))) {
          return { ok: false, message: "账号或密码错误。" };
        }
        if (user.status === "disabled") {
          return { ok: false, message: "账号已被停用，请联系管理员。" };
        }

        const migratedRecord = user.password ? await createPasswordHashRecord(validation.password) : null;
        set((state) => {
          return {
            currentUserId: user.id,
            users: state.users.map((item) =>
              item.id === user.id
                ? {
                    ...(migratedRecord ? stripLegacyPassword(item, migratedRecord) : item),
                    lastLoginAt: Date.now(),
                    updatedAt: Date.now(),
                  }
                : item
            ),
          };
        });
        return { ok: true, userId: user.id };
      },
      logout: () => {
        markLoggedOut();
        void clearPersistedCurrentUserId(createLocalStorageStateStorage());
        set({ currentUserId: undefined });
      },
      updateUserStatus: (id, status) => {
        set((state) => ({
          currentUserId: state.currentUserId === id && status === "disabled" ? undefined : state.currentUserId,
          users: state.users.map((user) => (user.id === id ? { ...user, status, updatedAt: Date.now() } : user)),
        }));
      },
      renameUser: (id, displayName) => {
        const nextName = displayName.trim();
        if (!nextName) return;
        set((state) => ({
          users: state.users.map((user) => (user.id === id ? { ...user, displayName: nextName, updatedAt: Date.now() } : user)),
        }));
      },
      updateDisplayName: (id, displayName) => {
        const nextName = displayName.trim();
        if (!nextName) return { ok: false, message: "用户名不能为空。" };
        if (nextName.length > 24) return { ok: false, message: "用户名不能超过 24 个字符。" };
        set((state) => ({
          users: state.users.map((user) => (user.id === id ? { ...user, displayName: nextName, updatedAt: Date.now() } : user)),
        }));
        return { ok: true };
      },
      updateUsername: (id, username) => {
        const nextUsername = normalizeUsername(username);
        if (nextUsername.length < 3) return { ok: false, message: "账号至少需要 3 个字符。" };

        let result: { ok: true } | { ok: false; message: string } = { ok: true };
        set((state) => {
          if (state.users.some((user) => user.id !== id && user.username === nextUsername)) {
            result = { ok: false, message: "该账号已被使用。" };
            return state;
          }
          return {
            users: state.users.map((user) =>
              user.id === id ? { ...user, username: nextUsername, updatedAt: Date.now() } : user
            ),
          };
        });
        return result;
      },
      updatePassword: async (id, currentPassword, nextPassword, confirmPassword) => {
        if (nextPassword.length < 6) return { ok: false, message: "新密码至少需要 6 个字符。" };
        if (nextPassword !== confirmPassword) return { ok: false, message: "两次输入的新密码不一致。" };

        const user = get().users.find((item) => item.id === id);
        if (!user || !(await verifyStoredUserPassword(user, currentPassword))) {
          return { ok: false, message: "旧密码错误。" };
        }
        const passwordRecord = await createPasswordHashRecord(nextPassword);
        set((state) => {
          return {
            users: state.users.map((item) =>
              item.id === id ? { ...stripLegacyPassword(item, passwordRecord), updatedAt: Date.now() } : item
            ),
          };
        });
        return { ok: true };
      },
      migrateLegacyPasswords: async () => {
        const legacyUsers = get().users.filter((user) => user.password && !user.passwordHash);
        if (!legacyUsers.length) return;
        const migrated = await Promise.all(
          legacyUsers.map(async (user) => ({
            id: user.id,
            record: await createPasswordHashRecord(user.password!),
          }))
        );
        const records = new Map(migrated.map((item) => [item.id, item.record]));
        set((state) => ({
          users: state.users.map((user) => {
            const record = records.get(user.id);
            return record ? stripLegacyPassword(user, record) : user;
          }),
        }));
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => createAuthStateStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({ users: state.users, currentUserId: state.currentUserId }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
        void state?.migrateLegacyPasswords();
      },
    } satisfies PersistOptions<AuthState, PersistedAuthState>
  )
);

export function toPublicUser(user: StoredUser): AppUser {
  return {
    id: user.id,
    username: user.username,
    displayName: user.displayName,
    status: user.status,
    createdAt: user.createdAt,
    updatedAt: user.updatedAt,
    lastLoginAt: user.lastLoginAt,
  };
}
