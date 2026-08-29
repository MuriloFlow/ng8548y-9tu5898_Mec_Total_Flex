import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex — State Sync API
 *
 * Simplified persistence layer that stores the full app state as JSONB
 * in the `workshop_app_snapshots` table.
 *
 * GET  → reads the current state from Supabase
 * PUT  → writes the full state to Supabase
 *
 * Uses the service_role key (server-side only) — no client auth needed.
 * Falls back gracefully if Supabase is not configured.
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";
const DEFAULT_COMPANY = "default";

function getSupabase() {
  const client = createSupabaseAdminClient();
  if (!client) return null;
  return client;
}

export async function GET() {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ state: null, updatedAt: null, source: "no_supabase" });
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      // Table might not exist yet — return null so client falls back to localStorage
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        console.warn("[sync:GET] Table not found. Run the SQL migration first.");
        return NextResponse.json({ state: null, updatedAt: null, source: "table_missing" });
      }
      console.error("[sync:GET] Supabase error:", error.message);
      return NextResponse.json({ state: null, updatedAt: null, source: "error" });
    }

    const state = data?.state;
    const hasData = state && typeof state === "object" && Object.keys(state).length > 0 && state.updatedAt;

    return NextResponse.json({
      state: hasData ? state : null,
      updatedAt: data?.updated_at ?? null,
      source: "supabase",
    });
  } catch (err) {
    console.error("[sync:GET] Unexpected error:", err);
    return NextResponse.json({ state: null, updatedAt: null, source: "exception" });
  }
}

export async function PUT(request: Request) {
  const supabase = getSupabase();
  if (!supabase) {
    return NextResponse.json({ ok: true, persisted: false, reason: "no_supabase" });
  }

  try {
    const body = await request.json();
    const state = body?.state;

    if (!state || typeof state !== "object") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    // Validate that state has the expected shape
    if (!state.updatedAt || !state.company) {
      return NextResponse.json({ error: "invalid_state_shape" }, { status: 400 });
    }

    const now = new Date().toISOString();

    // Upsert — insert or update the singleton row
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          id: ROW_ID,
          company_id: state.company?.id ?? DEFAULT_COMPANY,
          state,
          updated_at: state.updatedAt || now,
          updated_by: "client",
        },
        { onConflict: "id" },
      );

    if (error) {
      if (error.message?.includes("does not exist") || error.code === "42P01") {
        console.warn("[sync:PUT] Table not found. Run the SQL migration first.");
        return NextResponse.json({ ok: false, persisted: false, reason: "table_missing" });
      }
      console.error("[sync:PUT] Supabase error:", error.message);
      return NextResponse.json({ error: "sync_failed", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt });
  } catch (err) {
    console.error("[sync:PUT] Unexpected error:", err);
    return NextResponse.json({ error: "unexpected_error" }, { status: 500 });
  }
}
