import "server-only";
import { createCipheriv, createDecipheriv, createHmac, randomBytes, scryptSync } from "crypto";

const PREFIX = "enc:v1:";
const ALGO = "aes-256-gcm";

function encryptionSecret() {
  return (
    process.env.DATA_ENCRYPTION_KEY?.trim() ||
    process.env.SUPABASE_SERVICE_ROLE_KEY?.trim() ||
    "total-flex-local-dev-key"
  );
}

function encryptionKey() {
  return scryptSync(encryptionSecret(), "total-flex-cpf-v1", 32);
}

function hashKey() {
  return scryptSync(encryptionSecret(), "total-flex-cpf-hash-v1", 32);
}

export function normalizeCpfDigits(value: string) {
  return value.replace(/\D/g, "").slice(0, 11);
}

export function isEncryptedCpf(value: string) {
  return value.startsWith(PREFIX);
}

/** Deterministic hash for unique DB index — never reversible alone. */
export function hashCpf(cpf: string) {
  const normalized = normalizeCpfDigits(cpf);
  return createHmac("sha256", hashKey()).update(normalized).digest("hex");
}

export function encryptCpf(cpf: string) {
  const normalized = normalizeCpfDigits(cpf);
  if (!normalized) return cpf;
  if (isEncryptedCpf(cpf)) return cpf;

  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(normalized, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  const payload = Buffer.concat([iv, tag, encrypted]).toString("base64url");
  return `${PREFIX}${payload}`;
}

export function decryptCpf(value: string) {
  if (!isEncryptedCpf(value)) {
    return normalizeCpfDigits(value) || value;
  }

  const raw = Buffer.from(value.slice(PREFIX.length), "base64url");
  const iv = raw.subarray(0, 12);
  const tag = raw.subarray(12, 28);
  const encrypted = raw.subarray(28);
  const decipher = createDecipheriv(ALGO, encryptionKey(), iv);
  decipher.setAuthTag(tag);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  return decrypted.toString("utf8");
}
