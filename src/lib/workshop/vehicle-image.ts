import type { Vehicle } from "./types";

type AssetKey = "carro" | "moto" | "outros";

function assetKey(category: Vehicle["category"]): AssetKey {
  switch (category) {
    case "motorcycle":
      return "moto";
    case "van":
    case "truck":
    case "other":
      return "outros";
    case "car":
    default:
      return "carro";
  }
}

export function getVehicleCategoryImage(category: Vehicle["category"]): string {
  return `/assets/models/${assetKey(category)}.png`;
}

export function getVehicleCategoryImageFallback(category: Vehicle["category"]): string {
  return `/assets/models/${assetKey(category)}.svg`;
}

export function resolveVehicleImageUrl(vehicle: Pick<Vehicle, "category" | "imageUrl">): string {
  if (vehicle.imageUrl?.startsWith("/assets/models/")) return vehicle.imageUrl;
  return getVehicleCategoryImage(vehicle.category);
}

export function localImageForCategory(category: Vehicle["category"]): string {
  return getVehicleCategoryImage(category);
}
