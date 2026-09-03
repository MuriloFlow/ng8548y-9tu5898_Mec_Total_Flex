import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Tenta aplicar patches de schema via RPC no Supabase. A funcao
 * `tf_apply_schema_patches` e criada pelo SQL_COMPLETO.sql / SQL_MIGRATION_cpf_hash.sql.
 * Se ainda nao existir no banco, retorna false sem quebrar o sync.
 */
export async function applyWorkshopSchemaPatches(supabase: SupabaseClient): Promise<boolean> {
  const { data, error } = await supabase.rpc("tf_apply_schema_patches");
  if (error) return false;
  return Boolean(data && typeof data === "object" && (data as { ok?: boolean }).ok === true);
}

export function isMissingColumnError(message: string, column: string) {
  const normalized = message.toLowerCase();
  const columnNeedle = column.toLowerCase();
  return (
    normalized.includes(columnNeedle) &&
    (normalized.includes("schema cache") ||
      normalized.includes("could not find") ||
      normalized.includes("column") ||
      normalized.includes("does not exist"))
  );
}
