import type { WorkshopState } from "./types";

/** Garante campos novos em snapshots antigos sem quebrar o carregamento. */
export function normalizeWorkshopState(state: WorkshopState): WorkshopState {
  return {
    ...state,
    plateMemories: state.plateMemories ?? [],
  };
}
