import { normalizePlate } from "./format";
import type { VehicleLookupResult } from "./types";

export async function lookupVehicleByPlate(plateValue: string): Promise<VehicleLookupResult> {
  const plate = normalizePlate(plateValue);

  try {
    const response = await fetch(`/api/vehicle/lookup/${plate}`, {
      headers: { Accept: "application/json" },
      cache: "no-store",
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
