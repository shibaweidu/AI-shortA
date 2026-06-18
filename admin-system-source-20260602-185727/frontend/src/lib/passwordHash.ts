const PASSWORD_HASH_VERSION = 1;
const PASSWORD_HASH_ITERATIONS = 120_000;
const PASSWORD_HASH_ALGORITHM = "PBKDF2-SHA256";

export interface PasswordHashRecord {
  passwordHash: string;
  passwordSalt: string;
  passwordVersion: number;
}

function bytesToBase64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function arrayBufferToBase64(buffer: ArrayBuffer) {
  return bytesToBase64(new Uint8Array(buffer));
}

function randomSalt() {
  const bytes = new Uint8Array(16);
  globalThis.crypto?.getRandomValues?.(bytes);
  if (bytes.some(Boolean)) return bytesToBase64(bytes);
  return `${Date.now()}-${Math.random()}`;
}

async function derivePasswordHash(password: string, salt: string) {
  if (!globalThis.crypto?.subtle) {
    throw new Error("当前浏览器不支持安全密码哈希。");
  }

  const encoder = new TextEncoder();
  const key = await globalThis.crypto.subtle.importKey("raw", encoder.encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await globalThis.crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: encoder.encode(`${PASSWORD_HASH_ALGORITHM}:${salt}`),
      iterations: PASSWORD_HASH_ITERATIONS,
    },
    key,
    256
  );
  return arrayBufferToBase64(bits);
}

export async function createPasswordHashRecord(password: string): Promise<PasswordHashRecord> {
  const passwordSalt = randomSalt();
  return {
    passwordHash: await derivePasswordHash(password, passwordSalt),
    passwordSalt,
    passwordVersion: PASSWORD_HASH_VERSION,
  };
}

export async function verifyPasswordHash(password: string, record: PasswordHashRecord) {
  if (record.passwordVersion !== PASSWORD_HASH_VERSION) return false;
  const nextHash = await derivePasswordHash(password, record.passwordSalt);
  return nextHash === record.passwordHash;
}
