export const ADMIN_API_TOKEN_STORAGE_KEY = "koala-admin-api-token";

export function getAdminApiToken() {
  if (typeof window === "undefined") return "";
  return window.localStorage.getItem(ADMIN_API_TOKEN_STORAGE_KEY)?.trim() ?? "";
}

export function setAdminApiToken(token: string) {
  if (typeof window === "undefined") return;
  const value = token.trim();
  if (value) {
    window.localStorage.setItem(ADMIN_API_TOKEN_STORAGE_KEY, value);
  } else {
    window.localStorage.removeItem(ADMIN_API_TOKEN_STORAGE_KEY);
  }
}

export function withAdminHeaders(init: RequestInit = {}, json = false): RequestInit {
  const headers = new Headers(init.headers);
  if (json && !headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const token = getAdminApiToken();
  if (token) headers.set("X-Admin-Token", token);
  return {
    ...init,
    headers,
  };
}
