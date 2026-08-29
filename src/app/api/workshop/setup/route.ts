import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Setup check: verifies if workshop_app_snapshots table exists.
 * Does NOT create anything — user runs SQLFINAL.sql manually.
 */

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return NextResponse.json({ configured: false, tableExists: false });

  try {
    const { data, error } = await supabase
      .from("workshop_app_snapshots")
      .select("id, updated_at")
      .eq("id", "singleton")
      .maybeSingle();

    if (error) {
      const isMissing = error.code === "42P01" || error.message?.includes("does not exist");
      return NextResponse.json({ configured: true, tableExists: !isMissing, error: isMissing ? "table_missing" : error.message });
    }

    return NextResponse.json({ configured: true, tableExists: true, lastSync: data?.updated_at ?? null });
  } catch {
    return NextResponse.json({ configured: true, tableExists: false });
  }
}
