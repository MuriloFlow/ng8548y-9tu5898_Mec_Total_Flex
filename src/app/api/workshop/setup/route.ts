import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Auto-setup: creates exec_sql function + workshop_app_snapshots table.
 */

const SETUP_SQL = `
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

export async function POST() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ ok: false, error: "no_supabase", message: "SUPABASE_SERVICE_ROLE_KEY não configurada." });
  }

  try {
    // Try exec_sql RPC
    const { error } = await supabase.rpc("exec_sql", { sql: SETUP_SQL });

    if (error) {
      // exec_sql doesn't exist yet — create it via raw HTTP
      const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!url || !key) {
        return NextResponse.json({ ok: false, error: "no_url", message: "NEXT_PUBLIC_SUPABASE_URL não configurada." });
      }

      const response = await fetch(`${url}/rest/v1/rpc/exec_sql`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify({ sql: SETUP_SQL }),
      });

      if (!response.ok) {
        const body = await response.text();
        console.warn("[setup] Raw SQL exec failed:", response.status, body.slice(0, 200));
        return NextResponse.json({
          ok: false,
          error: "sql_failed",
          message: `SQL execution failed: ${response.status}`,
          detail: body.slice(0, 300),
        });
      }
    }

    // Verify
    const { data, error: verifyError } = await supabase
      .from("workshop_app_snapshots")
      .select("id")
      .eq("id", "singleton")
      .maybeSingle();

    if (verifyError) {
      return NextResponse.json({ ok: false, error: "verify_failed", message: verifyError.message });
    }

    return NextResponse.json({ ok: true, message: "Setup completo!", tableExists: true, singletonRow: !!data });
  } catch (err) {
    console.error("[setup] Exception:", err);
    return NextResponse.json({ ok: false, error: "exception", message: String(err) });
  }
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ configured: false });

  try {
    const { data, error } = await supabase
      .from("workshop_app_snapshots")
      .select("id, updated_at")
      .eq("id", "singleton")
      .maybeSingle();

    if (error) return NextResponse.json({ configured: true, tableExists: false, error: error.message });

    return NextResponse.json({ configured: true, tableExists: true, lastSync: data?.updated_at ?? null });
  } catch {
    return NextResponse.json({ configured: true, tableExists: false });
  }
}
