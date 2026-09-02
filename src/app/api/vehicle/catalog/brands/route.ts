import { NextResponse } from "next/server";
import { fetchBrands, isFipeCategory } from "@/lib/workshop/fipe";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const category = new URL(request.url).searchParams.get("category") ?? "carros";

  if (!isFipeCategory(category)) {
    return NextResponse.json({ ok: false, message: "Categoria inválida.", items: [] }, { status: 400 });
  }

  const items = await fetchBrands(category);

  if (items.length === 0) {
    return NextResponse.json(
      { ok: false, message: "Catálogo de marcas indisponível. Digite a marca manualmente.", items: [] },
      { status: 503 },
    );
  }

  return NextResponse.json(
    { ok: true, items },
    { headers: { "Cache-Control": "public, max-age=43200, stale-while-revalidate=86400" } },
  );
}
