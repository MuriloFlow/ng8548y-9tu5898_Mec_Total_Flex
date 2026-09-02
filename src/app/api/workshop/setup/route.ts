import { NextResponse } from "next/server";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";
import { restSelectSnapshot } from "@/lib/supabase/rest";

export async function GET() {
  if (!isSupabaseServerConfigured()) {
    return NextResponse.json({
      configured: false,
      tableExists: false,
      detail: "Variáveis de ambiente não configuradas.",
    });
  }

  const rest = await restSelectSnapshot<{ id: string }>("workshop_app_snapshots", "singleton", "id");
  if (!rest.error) {
    return NextResponse.json({ configured: true, tableExists: true, detail: "Conexão OK" });
  }

  const message = rest.error.message.toLowerCase();
  const isMissing =
    rest.error.code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("schema cache") ||
    message.includes("not found");
  const isConnection =
    message.includes("fetch failed") ||
    message.includes("timeout") ||
    message.includes("abort") ||
    message.includes("network");

  return NextResponse.json({
    configured: true,
    tableExists: !isMissing && !isConnection,
    detail: isMissing
      ? "Tabela não existe. Execute SQL_COMPLETO.sql no Supabase SQL Editor."
      : isConnection
        ? "Sem resposta do Supabase. Verifique se o projeto está ativo e a URL no .env."
        : `Erro: ${rest.error.message}`,
  });
}
