type HapticPattern = "tap" | "select" | "success" | "warning" | "error";

/**
 * Duração em ms por tipo de retorno. Valores curtos porque o Vibration API do
 * Android é bem mais "duro" que o Taptic Engine do iOS — acima de ~20ms para um
 * toque simples o retorno deixa de ser sutil e passa a parecer um alarme.
 */
const PATTERNS: Record<HapticPattern, number | number[]> = {
  tap: 8,
  select: 12,
  success: [10, 40, 18],
  warning: [16, 60, 16],
  error: [22, 50, 22, 50, 22],
};

/**
 * Retorno tátil em toques importantes. Silencioso onde não há suporte (iOS
 * Safari e desktop), então pode ser chamado sem verificação prévia.
 */
export function haptic(pattern: HapticPattern = "tap") {
  if (typeof navigator === "undefined" || typeof navigator.vibrate !== "function") return;

  try {
    navigator.vibrate(PATTERNS[pattern]);
  } catch {
    // Alguns navegadores expõem a API mas bloqueiam sem interação do usuário.
  }
}
