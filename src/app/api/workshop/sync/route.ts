import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex — State Sync (simple version)
 *
 * GET  → reads state from Supabase
 * PUT  → writes state to Supabase
 *
 * NO auto-create, NO DDL. Table must exist (user runs SQLFINAL.sql once).
 * If table doesn't exist, returns clear error so UI can guide the user.
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({
      state: null,
      updatedAt: null,
      source: "no_supabase",
      detail: "SUPABASE_SERVICE_ROLE_KEY não configurada no Vercel.",
    });
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      const isMissing = error.code === "42P01" || error.message?.includes("does not exist") || error.message?.includes("relation");
      return NextResponse.json({
        state: null,
        updatedAt: null,
        source: isMissing ? "table_missing" : "error",
        detail: isMissing
          ? "Tabela workshop_app_snapshots não existe. Execute SQLFINAL.sql no Supabase SQL Editor."
          : error.message,
      });
    }

    const state = data?.state;
    const hasData = state && typeof state === "object" && Object.keys(state).length > 2 && state.updatedAt;

    return NextResponse.json({
      state: hasData ? state : null,
      updatedAt: data?.updated_at ?? null,
      source: "supabase",
    });
  } catch (err) {
    return NextResponse.json({ state: null, updatedAt: null, source: "exception", detail: String(err) });
  }
}

export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, persisted: false, reason: "no_supabase", detail: "SUPABASE_SERVICE_ROLE_KEY não configurada." });
  }

  try {
    const body = await request.json();
    const state = body?.state;

    if (!state || typeof state !== "object" || !state.updatedAt) {
      return NextResponse.json({ ok: false, error: "invalid_state" }, { status: 400 });
    }

    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          id: ROW_ID,
          company_id: state.company?.id ?? "default",
          state,
          updated_at: state.updatedAt,
          updated_by: "client",
        },
        { onConflict: "id" },
      );

    if (error) {
      const isMissing = error.code === "42P01" || error.message?.includes("does not exist") || error.message?.includes("relation");
      return NextResponse.json({
        ok: false,
        persisted: false,
        reason: isMissing ? "table_missing" : "upsert_failed",
        detail: isMissing
          ? "Tabela workshop_app_snapshots não existe. Execute SQLFINAL.sql."
          : error.message,
      });
    }

    return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt });
  } catch (err) {
    return NextResponse.json({ ok: false, error: "exception", detail: String(err) }, { status: 500 });
  }
}
