import type { Vehicle } from "./types";

export type BrandOption = { code: string; name: string };
export type ModelOption = { code: string; name: string; model: string; version: string };

export type CatalogResponse<T> = { ok: boolean; items: T[]; message?: string };

const brandCache = new Map<string, BrandOption[]>();
const modelCache = new Map<string, ModelOption[]>();

export function fipeCategoryFor(category: Vehicle["category"]) {
  switch (category) {
    case "motorcycle":
      return "motos";
    case "truck":
      return "caminhoes";
    default:
      return "carros";
  }
}

async function getCatalog<T>(url: string): Promise<CatalogResponse<T>> {
  try {
    const response = await fetch(url, { headers: { Accept: "application/json" } });
    const payload = (await response.json().catch(() => null)) as CatalogResponse<T> | null;
    if (payload?.items) return payload;
    return { ok: false, items: [], message: "Catálogo indisponível." };
  } catch {
    return { ok: false, items: [], message: "Sem conexão com o catálogo." };
  }
}

export async function fetchBrandOptions(category: Vehicle["category"]): Promise<CatalogResponse<BrandOption>> {
  const fipe = fipeCategoryFor(category);
  const cached = brandCache.get(fipe);
  if (cached) return { ok: true, items: cached };

  const result = await getCatalog<BrandOption>(`/api/vehicle/catalog/brands?category=${fipe}`);
  if (result.ok && result.items.length > 0) brandCache.set(fipe, result.items);
  return result;
}

export async function fetchModelOptions(
  category: Vehicle["category"],
  brandCode: string,
): Promise<CatalogResponse<ModelOption>> {
  const fipe = fipeCategoryFor(category);
  const key = `${fipe}:${brandCode}`;
  const cached = modelCache.get(key);
  if (cached) return { ok: true, items: cached };

  const result = await getCatalog<ModelOption>(
    `/api/vehicle/catalog/models?category=${fipe}&brand=${encodeURIComponent(brandCode)}`,
  );
  if (result.ok && result.items.length > 0) modelCache.set(key, result.items);
  return result;
}

export function vehicleYearOptions() {
  const latest = new Date().getFullYear() + 1;
  return Array.from({ length: latest - 1959 }, (_, index) => String(latest - index));
}
