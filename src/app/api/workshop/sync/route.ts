import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Simplified state sync endpoint.
 *
 * GET  → reads the current state from Supabase
 * PUT  → writes the full state to Supabase
 *
 * Uses the service_role key (server-side only) so no client auth is needed.
 * The table `workshop_app_snapshots` stores a single JSONB row per company.
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";
const DEFAULT_COMPANY = "default";

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    // No Supabase configured — return null so client falls back to localStorage
    return NextResponse.json({ state: null, updatedAt: null });
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      console.error("[sync:GET] Supabase error:", error.message);
      return NextResponse.json({ state: null, updatedAt: null });
    }

    return NextResponse.json({
      state: data?.state ?? null,
      updatedAt: data?.updated_at ?? null,
    });
  } catch (err) {
    console.error("[sync:GET] Unexpected error:", err);
    return NextResponse.json({ state: null, updatedAt: null });
  }
}

export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: true, persisted: false, reason: "no_supabase" });
  }

  try {
    const body = await request.json();
    const state = body?.state;

    if (!state || typeof state !== "object") {
      return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
    }

    const now = new Date().toISOString();

    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          id: ROW_ID,
          company_id: DEFAULT_COMPANY,
          state,
          updated_at: now,
          updated_by: "client",
        },
        { onConflict: "id" },
      );

    if (error) {
      console.error("[sync:PUT] Supabase error:", error.message);
      return NextResponse.json({ error: "sync_failed", detail: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true, persisted: true, updatedAt: now });
  } catch (err) {
    console.error("[sync:PUT] Unexpected error:", err);
    return NextResponse.json({ error: "unexpected_error" }, { status: 500 });
  }
}
