import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { fetchEntitlementFresh } from "@/lib/flowdesk/client";

export const dynamic = "force-dynamic";

/**
 * Proxy consultado pela tela de bloqueio. Mantém a secret key no servidor e
 * invalida o cache do entitlement quando o acesso é liberado, para que o
 * próximo render já entre no sistema.
 */
export async function GET() {
  const result = await fetchEntitlementFresh();

  if (result.allowed) {
    revalidateTag("flowdesk-entitlement", "max");
  }

  return NextResponse.json(
    {
      allowed: result.allowed,
      degraded: result.degraded,
      status: result.entitlement?.status ?? null,
    },
    { headers: { "Cache-Control": "no-store" } }
  );
}
