import "server-only";
import type { Vehicle } from "./types";

export type CatalogEntry = { code: string; name: string };

export type FipeCategory = "carros" | "motos" | "caminhoes";

const PARALLELUM = "https://parallelum.com.br/fipe/api/v1";
const BRASILAPI = "https://brasilapi.com.br/api/fipe";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const REQUEST_TIMEOUT_MS = 9_000;

type CacheEntry = { expiresAt: number; value: CatalogEntry[] };

const cache = new Map<string, CacheEntry>();

export function fipeCategoryFor(category: Vehicle["category"]): FipeCategory {
  switch (category) {
    case "motorcycle":
      return "motos";
    case "truck":
      return "caminhoes";
    default:
      return "carros";
  }
}

export function isFipeCategory(value: string): value is FipeCategory {
  return value === "carros" || value === "motos" || value === "caminhoes";
}

async function fetchJson<T>(url: string): Promise<T | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) return null;
    return (await response.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function sortByName(entries: CatalogEntry[]) {
  return entries.sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
}

function readCache(key: string) {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt < Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.value;
}

function writeCache(key: string, value: CatalogEntry[]) {
  if (value.length > 0) cache.set(key, { expiresAt: Date.now() + CACHE_TTL_MS, value });
  return value;
}

export async function fetchBrands(category: FipeCategory): Promise<CatalogEntry[]> {
  const key = `brands:${category}`;
  const cached = readCache(key);
  if (cached) return cached;

  const primary = await fetchJson<{ codigo: string; nome: string }[]>(`${PARALLELUM}/${category}/marcas`);
  if (Array.isArray(primary) && primary.length > 0) {
    return writeCache(
      key,
      sortByName(primary.map((item) => ({ code: String(item.codigo), name: item.nome }))),
    );
  }

  const fallback = await fetchJson<{ nome: string; valor: string }[]>(`${BRASILAPI}/marcas/v1/${category}`);
  if (Array.isArray(fallback) && fallback.length > 0) {
    return writeCache(
      key,
      sortByName(fallback.map((item) => ({ code: String(item.valor), name: item.nome }))),
    );
  }

  return [];
}

export async function fetchModels(category: FipeCategory, brandCode: string): Promise<CatalogEntry[]> {
  const key = `models:${category}:${brandCode}`;
  const cached = readCache(key);
  if (cached) return cached;

  const primary = await fetchJson<{ modelos?: { codigo: number | string; nome: string }[] }>(
    `${PARALLELUM}/${category}/marcas/${encodeURIComponent(brandCode)}/modelos`,
  );
  if (Array.isArray(primary?.modelos) && primary.modelos.length > 0) {
    return writeCache(
      key,
      sortByName(primary.modelos.map((item) => ({ code: String(item.codigo), name: item.nome }))),
    );
  }

  const fallback = await fetchJson<{ modelo: string; valor: string }[]>(
    `${BRASILAPI}/veiculos/v1/${category}/${encodeURIComponent(brandCode)}`,
  );
  if (Array.isArray(fallback) && fallback.length > 0) {
    return writeCache(
      key,
      sortByName(fallback.map((item) => ({ code: String(item.valor), name: item.modelo }))),
    );
  }

  return [];
}

/**
 * FIPE packs model and trim into one string ("HB20 1.0M COMFOR"). The first
 * token always belongs to the model; subsequent purely alphabetic tokens are
 * kept because several models are multi-word ("CROSS FOX"), but anything with
 * a digit marks the start of the trim.
 */
export function splitModelAndVersion(fipeName: string) {
  const tokens = fipeName.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return { model: "", version: "" };

  const modelTokens = [tokens[0]];
  for (let index = 1; index < tokens.length && modelTokens.length < 3; index += 1) {
    const token = tokens[index];
    if (!/^[A-Za-zÀ-ÿ-]+$/.test(token)) break;
    modelTokens.push(token);
  }

  return {
    model: modelTokens.join(" "),
    version: tokens.slice(modelTokens.length).join(" "),
  };
}
