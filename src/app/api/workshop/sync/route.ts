import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex — State Sync (v3 — bulletproof)
 *
 * GET  → reads state from Supabase
 * PUT  → writes state to Supabase (strips photo dataUrls to keep payload small)
 *
 * Photos are stored locally only — they're too large for JSONB.
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";

/** Strip photo dataUrls to keep payload under Supabase limits */
function stripPhotos(state: Record<string, unknown>) {
  if (!state || typeof state !== "object") return state;
  const copy = { ...state };
  if (Array.isArray(copy.photos)) {
    copy.photos = copy.photos.map((p: Record<string, unknown>) => {
      const { dataUrl, ...rest } = p as { dataUrl?: string; [k: string]: unknown };
      return rest;
    });
  }
  return copy;
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    console.error("[sync:GET] SUPABASE not configured — missing env vars");
    return NextResponse.json({
      state: null,
      updatedAt: null,
      source: "no_supabase",
      detail: "SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL não configuradas no Vercel.",
    });
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      const isMissing =
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation") ||
        error.message?.includes("not found");
      console.error("[sync:GET] Supabase error:", error.message, "code:", error.code);
      return NextResponse.json({
        state: null,
        updatedAt: null,
        source: isMissing ? "table_missing" : "error",
        detail: isMissing
          ? "Tabela workshop_app_snapshots não existe. Execute SQLFINAL.sql no Supabase SQL Editor."
          : `Erro Supabase: ${error.message}`,
      });
    }

    const state = data?.state as Record<string, unknown> | null;
    const hasData =
      state &&
      typeof state === "object" &&
      Object.keys(state).length > 2 &&
      (state as { updatedAt?: string }).updatedAt;

    if (hasData) {
      console.log(
        "[sync:GET] Estado encontrado, updatedAt:",
        (state as { updatedAt: string }).updatedAt,
        "tamanho:",
        JSON.stringify(state).length,
        "bytes",
      );
    } else {
      console.log("[sync:GET] Tabela vazia ou sem dados úteis");
    }

    return NextResponse.json({
      state: hasData ? state : null,
      updatedAt: data?.updated_at ?? null,
      source: "supabase",
    });
  } catch (err) {
    console.error("[sync:GET] Exception:", err);
    return NextResponse.json({
      state: null,
      updatedAt: null,
      source: "exception",
      detail: String(err),
    });
  }
}

export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    console.error("[sync:PUT] SUPABASE not configured");
    return NextResponse.json({
      ok: false,
      persisted: false,
      reason: "no_supabase",
      detail: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.",
    });
  }

  try {
    const body = await request.json();
    const state = body?.state as Record<string, unknown> | undefined;

    if (!state || typeof state !== "object" || !state.updatedAt) {
      console.error("[sync:PUT] Invalid state received:", typeof state);
      return NextResponse.json(
        { ok: false, error: "invalid_state", detail: "Estado inválido ou sem updatedAt" },
        { status: 400 },
      );
    }

    // Strip photos to keep payload small
    const stripped = stripPhotos(state);
    const payload = JSON.stringify(stripped);
    console.log("[sync:PUT] Payload size:", payload.length, "bytes");

    const { error } = await supabase.from(TABLE).upsert(
      {
        id: ROW_ID,
        company_id: (stripped.company as Record<string, unknown>)?.id ?? "default",
        state: stripped,
        updated_at: state.updatedAt,
        updated_by: "client",
      },
      { onConflict: "id" },
    );

    if (error) {
      const isMissing =
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation");
      console.error("[sync:PUT] Supabase upsert error:", error.message, "code:", error.code);
      return NextResponse.json({
        ok: false,
        persisted: false,
        reason: isMissing ? "table_missing" : "upsert_failed",
        detail: isMissing
          ? "Tabela workshop_app_snapshots não existe. Execute SQLFINAL.sql."
          : `Erro Supabase: ${error.message} (code: ${error.code})`,
      });
    }

    console.log("[sync:PUT] Estado salvo com sucesso em", state.updatedAt);
    return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[sync:PUT] Exception:", msg);
    return NextResponse.json(
      { ok: false, error: "exception", detail: `Erro interno: ${msg}` },
      { status: 500 },
    );
  }
}
