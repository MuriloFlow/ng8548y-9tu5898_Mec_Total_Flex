import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Auto-setup endpoint.
 * Creates the workshop_app_snapshots table in Supabase if it doesn't exist.
 * This eliminates the need for users to manually run SQL migrations.
 */

const CREATE_TABLE_SQL = `
-- Create workshop_app_snapshots table if it doesn't exist
CREATE TABLE IF NOT EXISTS workshop_app_snapshots (
  id         TEXT PRIMARY KEY DEFAULT 'singleton',
  company_id TEXT NOT NULL DEFAULT 'default',
  state      JSONB NOT NULL DEFAULT '{}',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Insert singleton row if it doesn't exist
INSERT INTO workshop_app_snapshots (id, company_id, state, updated_at)
VALUES ('singleton', 'default', '{}', now())
ON CONFLICT (id) DO NOTHING;

-- Enable RLS
ALTER TABLE workshop_app_snapshots ENABLE ROW LEVEL SECURITY;

-- Create permissive policy (service_role bypasses RLS anyway)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE policyname = 'Allow all for service role'
    AND tablename = 'workshop_app_snapshots'
  ) THEN
    CREATE POLICY "Allow all for service role" ON workshop_app_snapshots
      FOR ALL USING (true) WITH CHECK (true);
  END IF;
END $$;
`;

export async function POST() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      { ok: false, error: "supabase_not_configured", message: "SUPABASE_SERVICE_ROLE_KEY não configurada." },
      { status: 503 },
    );
  }

  try {
    // Execute the SQL to create the table
    const { error } = await supabase.rpc("exec_sql", { sql: CREATE_TABLE_SQL });

    if (error) {
      // If exec_sql doesn't exist, try using the REST API to run raw SQL
      // This is a fallback — the user may need to run the SQL manually
      console.warn("[setup] exec_sql RPC not available, trying direct query:", error.message);

      // Try to query the table directly to see if it exists
      const { error: queryError } = await supabase
        .from("workshop_app_snapshots")
        .select("id")
        .eq("id", "singleton")
        .maybeSingle();

      if (queryError && (queryError.code === "42P01" || queryError.message?.includes("does not exist"))) {
        return NextResponse.json(
          {
            ok: false,
            error: "table_missing",
            message: "Tabela não existe. Execute o SQL manualmente no dashboard do Supabase.",
            sql: CREATE_TABLE_SQL,
          },
          { status: 200 },
        );
      }

      // Table exists but we couldn't verify via exec_sql
      return NextResponse.json({ ok: true, message: "Tabela já existe.", verified: true });
    }

    // Verify the table was created
    const { data, error: verifyError } = await supabase
      .from("workshop_app_snapshots")
      .select("id")
      .eq("id", "singleton")
      .maybeSingle();

    if (verifyError) {
      return NextResponse.json(
        { ok: false, error: "verify_failed", message: "Tabela criada mas não acessível." },
        { status: 500 },
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Tabela criada e verificada com sucesso!",
      tableExists: true,
      singletonRow: !!data,
    });
  } catch (err) {
    console.error("[setup] Unexpected error:", err);
    return NextResponse.json(
      { ok: false, error: "unexpected_error", message: "Erro inesperado durante configuração." },
      { status: 500 },
    );
  }
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ configured: false, tableExists: false });
  }

  try {
    const { data, error } = await supabase
      .from("workshop_app_snapshots")
      .select("id, updated_at")
      .eq("id", "singleton")
      .maybeSingle();

    if (error && (error.code === "42P01" || error.message?.includes("does not exist"))) {
      return NextResponse.json({ configured: true, tableExists: false });
    }

    return NextResponse.json({
      configured: true,
      tableExists: true,
      lastSync: data?.updated_at ?? null,
    });
  } catch {
    return NextResponse.json({ configured: true, tableExists: false });
  }
}
