import type { EntitlementResult } from "./types";

const TTL_MS = 10_000;

let cache: { result: EntitlementResult; expiresAt: number } | null = null;

export function readEntitlementCache(): EntitlementResult | null {
  if (!cache) return null;
  if (Date.now() > cache.expiresAt) {
    cache = null;
    return null;
  }
  return cache.result;
}

export function writeEntitlementCache(result: EntitlementResult, ttlMs = TTL_MS) {
  cache = { result, expiresAt: Date.now() + ttlMs };
}

export function bustEntitlementCache() {
  cache = null;
}
