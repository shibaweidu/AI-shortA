const BACKEND_API = (import.meta.env.VITE_BACKEND_URL as string | undefined)?.replace(/\/+$/, "") || "http://127.0.0.1:8787";

export interface EmailConfig {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  fromName: string;
  fromEmail: string;
  subject: string;
  codeTtlMinutes: number;
  updatedAt: number;
  hasPassword: boolean;
}

export interface EmailConfigUpdate {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password?: string;
  clearPassword?: boolean;
  fromName: string;
  fromEmail: string;
  subject: string;
  codeTtlMinutes: number;
}

async function requestJson<T>(path: string, init?: RequestInit) {
  const response = await fetch(`${BACKEND_API}${path}`, {
    ...init,
    headers: init?.body ? { "Content-Type": "application/json", ...(init.headers ?? {}) } : init?.headers,
  });
  const data = await response.json().catch(() => ({})) as { error?: string };
  if (!response.ok) throw new Error(data.error || `请求失败：${response.status}`);
  return data as T;
}

export function getEmailConfig() {
  return requestJson<EmailConfig>("/api/email-config", { cache: "no-store" });
}

export function updateEmailConfig(config: EmailConfigUpdate) {
  return requestJson<EmailConfig>("/api/email-config", {
    method: "PUT",
    body: JSON.stringify(config),
  });
}

export function sendTestEmail(email: string) {
  return requestJson<{ ok: true }>("/api/email-config/test", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function sendRegistrationEmailCode(email: string) {
  return requestJson<{ ok: true; expiresAt: number; ttlSeconds: number }>("/api/email-verifications/register/send", {
    method: "POST",
    body: JSON.stringify({ email }),
  });
}

export function verifyRegistrationEmailCode(email: string, code: string) {
  return requestJson<{ ok: true }>("/api/email-verifications/register/verify", {
    method: "POST",
    body: JSON.stringify({ email, code }),
  });
}
