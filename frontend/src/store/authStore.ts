import { create } from "zustand";
import { createJSONStorage, persist, type PersistOptions, type StateStorage } from "zustand/middleware";
import { createLocalStorageStateStorage } from "../lib/sharedStateStorage";

export interface AppUser {
  id: string;
  username: string;
  displayName: string;
  status: "active" | "disabled";
  createdAt: number;
  updatedAt: number;
  lastLoginAt?: number;
}

interface StoredUser extends AppUser {
  password: string;
}

interface AuthState {
  users: StoredUser[];
  currentUserId?: string;
  hasHydrated: boolean;
  setHasHydrated: (value: boolean) => void;
  register: (input: AuthInput) => AuthResult;
  login: (input: AuthInput) => AuthResult;
  logout: () => void;
  updateUserStatus: (id: string, status: AppUser["status"]) => void;
  renameUser: (id: string, displayName: string) => void;
  updateDisplayName: (id: string, displayName: string) => { ok: true } | { ok: false; message: string };
  updateUsername: (id: string, username: string) => { ok: true } | { ok: false; message: string };
  updatePassword: (id: string, currentPassword: string, nextPassword: string, confirmPassword: string) => { ok: true } | { ok: false; message: string };
}

interface AuthInput {
  username: string;
  password: string;
  displayName?: string;
}

type AuthResult = { ok: true; userId: string } | { ok: false; message: string };
type PersistedAuthState = Pick<AuthState, "users" | "currentUserId">;
const AUTH_STORAGE_KEY = "koala-auth-store-v1";
const AUTH_LOCAL_SESSION_KEY = "koala-auth-local-session-v1";
const SHARED_STATE_EVENT_KEY = "koala-shared-state-updated";
const SHARED_STATE_CHANNEL = "koala-shared-state";
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

function readLocalCurrentUserId() {
  try {
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
  localStorage.setItem(AUTH_LOCAL_SESSION_KEY, JSON.stringify({ currentUserId }));
}

function broadcastAuthUsersUpdate() {
  const message = { key: AUTH_STORAGE_KEY, updatedAt: Date.now() };
  try {
    localStorage.setItem(SHARED_STATE_EVENT_KEY, JSON.stringify(message));
  } catch {
    // Backend state remains the source of truth for shared user data.
  }

  try {
    const channel = new BroadcastChannel(SHARED_STATE_CHANNEL);
    channel.postMessage(message);
    channel.close();
  } catch {
    // BroadcastChannel is optional.
  }
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
      await fallback.setItem(name, merged);
      return merged;
    },
    setItem: async (name, value) => {
      await fallback.setItem(name, value);
      const parsed = parsePersistedAuthState(value);
      const users = parsed?.state?.users ?? [];
      writeLocalCurrentUserId(parsed?.state?.currentUserId);
      try {
        await writeBackendAuthState(users);
        broadcastAuthUsersUpdate();
      } catch {
        // Local login state stays usable if the backend is temporarily unavailable.
      }
    },
    removeItem: async (name) => {
      await fallback.removeItem(name);
      writeLocalCurrentUserId(undefined);
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
    (set) => ({
      users: [],
      currentUserId: undefined,
      hasHydrated: false,
      setHasHydrated: (value) => set({ hasHydrated: value }),
      register: (input) => {
        const validation = validateInput(input);
        if (!validation.ok) return validation;
        const displayName = validateDisplayName(input.displayName);
        if (input.displayName?.trim() && !displayName) return { ok: false, message: "用户名不能超过 24 个字符。" };

        let result: AuthResult = { ok: false, message: "账号已存在。" };
        set((state) => {
          if (state.users.some((user) => user.username === validation.username)) return state;
          const now = Date.now();
          const user: StoredUser = {
            id: createId("user"),
            username: validation.username,
            displayName: displayName || validation.username,
            password: validation.password,
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
      login: (input) => {
        const validation = validateInput(input);
        if (!validation.ok) return validation;

        let result: AuthResult = { ok: false, message: "账号或密码错误。" };
        set((state) => {
          const user = state.users.find((item) => item.username === validation.username && item.password === validation.password);
          if (!user) return state;
          if (user.status === "disabled") {
            result = { ok: false, message: "账号已被停用，请联系管理员。" };
            return state;
          }
          result = { ok: true, userId: user.id };
          return {
            currentUserId: user.id,
            users: state.users.map((item) => (item.id === user.id ? { ...item, lastLoginAt: Date.now(), updatedAt: Date.now() } : item)),
          };
        });
        return result;
      },
      logout: () => set({ currentUserId: undefined }),
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
      updatePassword: (id, currentPassword, nextPassword, confirmPassword) => {
        if (nextPassword.length < 6) return { ok: false, message: "新密码至少需要 6 个字符。" };
        if (nextPassword !== confirmPassword) return { ok: false, message: "两次输入的新密码不一致。" };

        let result: { ok: true } | { ok: false; message: string } = { ok: false, message: "旧密码错误。" };
        set((state) => {
          const user = state.users.find((item) => item.id === id);
          if (!user || user.password !== currentPassword) return state;
          result = { ok: true };
          return {
            users: state.users.map((item) => (item.id === id ? { ...item, password: nextPassword, updatedAt: Date.now() } : item)),
          };
        });
        return result;
      },
    }),
    {
      name: AUTH_STORAGE_KEY,
      storage: createJSONStorage(() => createAuthStateStorage(createLocalStorageStateStorage())),
      partialize: (state) => ({ users: state.users, currentUserId: state.currentUserId }),
      onRehydrateStorage: () => (state) => {
        state?.setHasHydrated(true);
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
