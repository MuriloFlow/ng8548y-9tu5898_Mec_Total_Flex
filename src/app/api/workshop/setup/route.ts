import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

/**
 * Total Flex - Setup (simplified)
 * Returns config status so the UI can guide the user.
 * Table creation is done manually via SQLFINAL.sql.
 */

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({
      configured: false,
      detail: "Variáveis de ambiente não configuradas.",
    });
  }

  // Test connection by reading the table
  try {
    const { error } = await supabase
      .from("workshop_app_snapshots")
      .select("id")
      .eq("id", "singleton")
      .maybeSingle();

    if (error) {
      const isMissing =
        error.code === "42P01" ||
        error.message?.includes("does not exist") ||
        error.message?.includes("relation");
      return NextResponse.json({
        configured: true,
        tableExists: !isMissing,
        detail: isMissing
          ? "Tabela não existe. Execute SQLFINAL.sql no Supabase SQL Editor."
          : `Erro: ${error.message}`,
      });
    }

    return NextResponse.json({ configured: true, tableExists: true, detail: "Conexão OK ✅" });
  } catch (err) {
    return NextResponse.json({
      configured: true,
      tableExists: false,
      detail: `Erro de conexão: ${String(err)}`,
    });
  }
}
