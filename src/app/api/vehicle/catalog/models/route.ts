import { NextResponse } from "next/server";
import { fetchModels, isFipeCategory, splitModelAndVersion } from "@/lib/workshop/fipe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const category = params.get("category") ?? "carros";
  const brand = params.get("brand") ?? "";

  if (!isFipeCategory(category)) {
    return NextResponse.json({ ok: false, message: "Categoria inválida.", items: [] }, { status: 400 });
  }

  if (!brand) {
    return NextResponse.json({ ok: false, message: "Informe a marca.", items: [] }, { status: 400 });
  }

  const entries = await fetchModels(category, brand);

  if (entries.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Catálogo de modelos indisponível. Digite o modelo manualmente.", items: [] },
      { status: 503 },
    );
  }

  const items = entries.map((entry) => ({
    code: entry.code,
    name: entry.name,
    ...splitModelAndVersion(entry.name),
  }));

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "public, max-age=43200, stale-while-revalidate=86400" } },
  );
}
