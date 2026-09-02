/** Cores padronizadas pelo DENATRAN no cadastro nacional de veículos. */
export const VEHICLE_COLORS = [
  "Amarela",
  "Azul",
  "Bege",
  "Branca",
  "Cinza",
  "Dourada",
  "Grena",
  "Laranja",
  "Marrom",
  "Prata",
  "Preta",
  "Rosa",
  "Roxa",
  "Verde",
  "Vermelha",
  "Fantasia",
] as const;

const COLOR_SWATCHES: Record<string, string> = {
  Amarela: "#facc15",
  Azul: "#2563eb",
  Bege: "#d6c7a1",
  Branca: "#ffffff",
  Cinza: "#71717a",
  Dourada: "#c9a227",
  Grena: "#6d1a2e",
  Laranja: "#f97316",
  Marrom: "#78462b",
  Prata: "#c8ccd1",
  Preta: "#18181b",
  Rosa: "#ec4899",
  Roxa: "#7c3aed",
  Verde: "#16a34a",
  Vermelha: "#dc2626",
  Fantasia: "linear-gradient(135deg,#f97316,#ec4899,#2563eb)",
};

export function colorSwatch(color: string) {
  return COLOR_SWATCHES[color] ?? "#d4d4d8";
}
