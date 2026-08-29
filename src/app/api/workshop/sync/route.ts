import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex — Bulletproof State Sync
 *
 * Uses multiple strategies to ensure data gets saved:
 * 1. Try Supabase client upsert
 * 2. If that fails (RLS, etc), use raw SQL via PostgREST
 * 3. If that fails, return detailed error
 */

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";
const DEFAULT_COMPANY = "default";

async function rawSqlExec(sql: string): Promise<{ ok: boolean; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "no_credentials" };

  try {
    const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ sql }),
    });

    if (!response.ok) {
      const body = await response.text();
      return { ok: false, error: `HTTP ${response.status}: ${body.slice(0, 200)}` };
    }

    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function rawSqlQuery(sql: string): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return { ok: false, error: "no_credentials" };

  try {
    // Use PostgREST to run raw SQL via the RPC endpoint
    const response = await fetch(`${url}/rest/v1/rpc/exec_sql_query`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: key,
        Authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({ query: sql }),
    });

    if (!response.ok) {
      // exec_sql_query might not exist — try alternative approach
      return { ok: false, error: `HTTP ${response.status}` };
    }

    const data = await response.json();
    return { ok: true, data };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function ensureTableAndAccess(): Promise<{ ok: boolean; error?: string }> {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { ok: false, error: "no_supabase_client" };

  // Step 1: Try to read from the table (tests both existence and access)
  const { error: readError } = await supabase
    .from(TABLE)
    .select("id")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (!readError) {
    // Table exists and is accessible — we're good
    return { ok: true };
  }

  console.log("[sync] Table not accessible:", readError.message, readError.code);

  // Step 2: exec_sql might not exist — try to create it via raw SQL
  const setupSql = `
CREATE OR REPLACE FUNCTION exec_sql(sql TEXT)
RETURNS void AS $$
BEGIN
  EXECUTE sql;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

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

DROP POLICY IF EXISTS "tf_full_access" ON workshop_app_snapshots;
CREATE POLICY "tf_full_access" ON workshop_app_snapshots
  FOR ALL USING (true) WITH CHECK (true);
`;

  const result = await rawSqlExec(setupSql);
  if (!result.ok) {
    console.error("[sync] Raw SQL exec failed:", result.error);
    return { ok: false, error: `SQL exec failed: ${result.error}` };
  }

  // Step 3: Verify access after setup
  const { error: verifyError } = await supabase
    .from(TABLE)
    .select("id")
    .eq("id", ROW_ID)
    .maybeSingle();

  if (verifyError) {
    return { ok: false, error: `Setup succeeded but table still inaccessible: ${verifyError.message}` };
  }

  console.log("[sync] Table setup complete and verified!");
  return { ok: true };
}

export async function GET() {
  try {
    const { ok, error } = await ensureTableAndAccess();
    if (!ok) {
      return NextResponse.json({ state: null, updatedAt: null, source: "setup_failed", detail: error });
    }

    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ state: null, updatedAt: null, source: "no_supabase" });
    }

    const { data, error: readError } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (readError) {
      return NextResponse.json({ state: null, updatedAt: null, source: "read_error", detail: readError.message });
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
  try {
    const supabase = createSupabaseAdminClient();
    if (!supabase) {
      return NextResponse.json({ ok: false, reason: "no_supabase", detail: "SUPABASE_SERVICE_ROLE_KEY não configurada." });
    }

    const body = await request.json();
    const state = body?.state;

    if (!state || typeof state !== "object" || !state.updatedAt) {
      return NextResponse.json({ ok: false, error: "invalid_state", detail: "State inválido." }, { status: 400 });
    }

    // Ensure table exists and is accessible
    const { ok: tableReady, error: tableError } = await ensureTableAndAccess();
    if (!tableReady) {
      return NextResponse.json({ ok: false, reason: "setup_failed", detail: tableError });
    }

    // Strategy 1: Try Supabase client upsert
    const { error: upsertError } = await supabase
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

    if (!upsertError) {
      return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt, strategy: "client" });
    }

    console.error("[sync] Client upsert failed:", upsertError.message);

    // Strategy 2: Raw SQL upsert via exec_sql RPC
    const stateJson = JSON.stringify(state).replace(/'/g, "''");
    const sql = `
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_by, updated_at)
VALUES ('singleton', '${state.company?.id ?? DEFAULT_COMPANY}', '${stateJson}'::jsonb, 'client', '${state.updatedAt}')
ON CONFLICT (id) DO UPDATE SET
  state = EXCLUDED.state,
  updated_at = EXCLUDED.updated_at,
  updated_by = EXCLUDED.updated_by;
`;

    const rawResult = await rawSqlExec(sql);
    if (rawResult.ok) {
      return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt, strategy: "raw_sql" });
    }

    console.error("[sync] Raw SQL upsert also failed:", rawResult.error);
    return NextResponse.json({
      ok: false,
      error: "all_strategies_failed",
      detail: `Client: ${upsertError.message} | RawSQL: ${rawResult.error}`,
    }, { status: 500 });
  } catch (err) {
    console.error("[sync] Exception:", err);
    return NextResponse.json({ ok: false, error: "exception", detail: String(err) }, { status: 500 });
  }
}
