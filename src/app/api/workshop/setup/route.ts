import { NextResponse } from "next/server";
import { createSupabaseAdminClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
import { restSelectSnapshot } from "@/lib/supabase/rest";

export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({
      configured: false,
      tableExists: false,
      detail: "Variáveis de ambiente não configuradas.",
    });
  }

  const supabase = createSupabaseAdminClient();
  if (supabase) {
    const { error } = await supabase.from("workshop_app_snapshots").select("id").eq("id", "singleton").maybeSingle();
    if (!error) {
      return NextResponse.json({ configured: true, tableExists: true, detail: "Conexão OK" });
    }

    const isMissing =
      error.code === "42P01" || error.message?.includes("does not exist") || error.message?.includes("relation");
    if (isMissing) {
      return NextResponse.json({
        configured: true,
        tableExists: false,
        detail: "Tabela não existe. Execute SQL_COMPLETO.sql no Supabase SQL Editor.",
      });
    }
  }

  const rest = await restSelectSnapshot<{ id: string }>("workshop_app_snapshots", "singleton", "id");
  if (!rest.error) {
    return NextResponse.json({ configured: true, tableExists: true, detail: "Conexão OK (REST)" });
  }

  const isMissing = rest.error.code === "42P01" || rest.error.message.includes("does not exist");
  return NextResponse.json({
    configured: true,
    tableExists: !isMissing,
    detail: isMissing
      ? "Tabela não existe. Execute SQL_COMPLETO.sql no Supabase SQL Editor."
      : `Erro: ${rest.error.message}`,
  });
}
