import { normalizePlate } from "./format";
import type { VehicleLookupResult } from "./types";

export async function lookupVehicleByPlate(plateValue: string): Promise<VehicleLookupResult> {
  const plate = normalizePlate(plateValue);

  try {
    const response = await fetch(`/api/vehicle/lookup/${plate}`, {
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json().catch(() => null)) as VehicleLookupResult | null;

    if (payload?.status) return payload;
  } catch {
    return {
      status: "unavailable",
      provider: "Consulta veicular",
      message: "Consulta veicular indisponível. Continue com cadastro manual.",
    };
  }

  return {
    status: "unavailable",
    provider: "Consulta veicular",
    message: "Consulta veicular indisponível. Continue com cadastro manual.",
  };
}

type CommonsPage = {
  imageinfo?: Array<{
    thumburl?: string;
    url?: string;
  }>;
};

export async function lookupVehicleImage(brand: string, model: string, year?: string | number) {
  const query = [brand, model, year, "car"].filter(Boolean).join(" ").trim();
  if (!brand.trim() || !model.trim()) return undefined;

  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "640",
    format: "json",
    origin: "*",
  });

  try {
    const response = await fetch(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, {
      headers: { Accept: "application/json" },
    });
    const payload = (await response.json()) as { query?: { pages?: Record<string, CommonsPage> } };
    const pages = Object.values(payload.query?.pages ?? {});
    for (const page of pages) {
      const image = page.imageinfo?.[0];
      const imageUrl = image?.thumburl || image?.url;
      if (imageUrl?.startsWith("https://upload.wikimedia.org/")) return imageUrl;
    }
  } catch {
    return undefined;
  }

  return undefined;
}
