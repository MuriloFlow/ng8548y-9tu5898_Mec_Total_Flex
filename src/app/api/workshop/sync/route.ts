import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex — Bulletproof State Sync
 *
 * GET  → reads the full state from Supabase
 * PUT  → writes the full state to Supabase
 *
 * If the table doesn't exist, it auto-creates it.
 * Uses the service_role key — no client auth needed.
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";
const DEFAULT_COMPANY = "default";

const CREATE_TABLE_SQL = `
CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;
ALTER TABLE workshop_app_snapshots ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'tf_full_access' AND tablename = 'workshop_app_snapshots'
  ) THEN
    CREATE POLICY "tf_full_access" ON workshop_app_snapshots FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

async function ensureTable(supabase: ReturnType<typeof createSupabaseAdminClient> & object): Promise<boolean> {
  // First, try to read from the table
  const { error: readError } = await supabase
    .from(TABLE)
    .select("id")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (!readError) return true; // Table exists and is readable

  // Table doesn't exist or isn't accessible — try to create it
  console.log("[sync] Table not found, attempting auto-create...");

  try {
    // Use Supabase PostgREST to execute raw SQL via the rpc endpoint
    // We try the exec_sql RPC first, then fall back to direct table creation
    const { error: rpcError } = await supabase.rpc("exec_sql", { sql: CREATE_TABLE_SQL });

    if (rpcError) {
      console.warn("[sync] exec_sql RPC failed:", rpcError.message);
      // RPC doesn't exist — try alternative: use the REST API directly
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) return false;

      const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ sql: CREATE_TABLE_SQL }),
      });

      if (!response.ok) {
        console.warn("[sync] Direct SQL execution failed:", response.status);
        return false;
      }
    }

    // Verify table was created
    const { error: verifyError } = await supabase
      .from(TABLE)
      .select("id")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (verifyError) {
      console.error("[sync] Table creation verification failed:", verifyError.message);
      return false;
    }

    console.log("[sync] Table created successfully!");
    return true;
  } catch (err) {
    console.error("[sync] Auto-create failed:", err);
    return false;
  }
}

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
    const tableReady = await ensureTable(supabase);
    if (!tableReady) {
      return NextResponse.json({
        state: null,
        updatedAt: null,
        source: "setup_failed",
        detail: "Não foi possível criar/accessar a tabela. Execute o SQLFINAL.sql manualmente no Supabase.",
      });
    }

    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      console.error("[sync:GET] Read error:", error.message);
      return NextResponse.json({ state: null, updatedAt: null, source: "error", detail: error.message });
    }

    const state = data?.state;
    const hasData = state && typeof state === "object" && Object.keys(state).length > 2 && state.updatedAt;

    return NextResponse.json({
      state: hasData ? state : null,
      updatedAt: data?.updated_at ?? null,
      source: "supabase",
    });
  } catch (err) {
    console.error("[sync:GET] Exception:", err);
    return NextResponse.json({ state: null, updatedAt: null, source: "exception", detail: String(err) });
  }
}

export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({
      ok: false,
      persisted: false,
      reason: "no_supabase",
      detail: "SUPABASE_SERVICE_ROLE_KEY não configurada.",
    });
  }

  try {
    const body = await request.json();
    const state = body?.state;

    if (!state || typeof state !== "object") {
      return NextResponse.json({ ok: false, error: "invalid_payload", detail: "State é obrigatório." }, { status: 400 });
    }

    if (!state.updatedAt) {
      return NextResponse.json({ ok: false, error: "invalid_state", detail: "State.updatedAt é obrigatório." }, { status: 400 });
    }

    // Ensure table exists
    const tableReady = await ensureTable(supabase);
    if (!tableReady) {
      return NextResponse.json({
        ok: false,
        persisted: false,
        reason: "setup_failed",
        detail: "Não foi possível criar a tabela workshop_app_snapshots. Execute SQLFINAL.sql manualmente.",
      });
    }

    // Upsert the full state
    const { error } = await supabase
      .from(TABLE)
      .upsert(
        {
          id: ROW_ID,
          company_id: state.company?.id ?? DEFAULT_COMPANY,
          state,
          updated_at: state.updatedAt,
          updated_by: "client",
        },
        { onConflict: "id" },
      );

    if (error) {
      console.error("[sync:PUT] Upsert error:", error.message, error.code);
      return NextResponse.json({
        ok: false,
        error: "upsert_failed",
        detail: error.message,
        code: error.code,
      }, { status: 500 });
    }

    return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt });
  } catch (err) {
    console.error("[sync:PUT] Exception:", err);
    return NextResponse.json({ ok: false, error: "exception", detail: String(err) }, { status: 500 });
  }
}
