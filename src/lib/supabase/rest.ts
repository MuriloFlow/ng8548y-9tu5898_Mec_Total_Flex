import "server-only";
import { getSupabaseEnv, supabaseFetch, supabaseRestHeaders } from "./fetch";

type RestError = { code?: string; message: string };

export async function restSelectSnapshot<T>(table: string, rowId: string, select: string): Promise<{ data: T | null; error: RestError | null }> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return { data: null, error: { message: "Variaveis de ambiente Supabase ausentes." } };
  }

  try {
    const response = await supabaseFetch(`${url}/rest/v1/${table}?id=eq.${encodeURIComponent(rowId)}&select=${encodeURIComponent(select)}`, {
      headers: supabaseRestHeaders(serviceRoleKey),
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      const missing = text.includes("does not exist") || text.includes("42P01") || response.status === 404;
      return {
        data: null,
        error: {
          code: missing ? "42P01" : undefined,
          message: text.slice(0, 240) || `HTTP ${response.status}`,
        },
      };
    }

    const rows = text ? (JSON.parse(text) as T[]) : [];
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}

export async function restUpsertSnapshot<T>(table: string, payload: Record<string, unknown>): Promise<{ data: T | null; error: RestError | null }> {
  const { url, serviceRoleKey } = getSupabaseEnv();
  if (!url || !serviceRoleKey) {
    return { data: null, error: { message: "Variaveis de ambiente Supabase ausentes." } };
  }

  try {
    const response = await supabaseFetch(`${url}/rest/v1/${table}?on_conflict=id`, {
      method: "POST",
      headers: {
        ...supabaseRestHeaders(serviceRoleKey),
        Prefer: "resolution=merge-duplicates,return=representation",
      },
      body: JSON.stringify(payload),
      cache: "no-store",
    });

    const text = await response.text();
    if (!response.ok) {
      const missing = text.includes("does not exist") || text.includes("42P01");
      return {
        data: null,
        error: {
          code: missing ? "42P01" : undefined,
          message: text.slice(0, 240) || `HTTP ${response.status}`,
        },
      };
    }

    const rows = text ? (JSON.parse(text) as T[]) : [];
    return { data: rows[0] ?? null, error: null };
  } catch (err) {
    return {
      data: null,
      error: { message: err instanceof Error ? err.message : String(err) },
    };
  }
}
