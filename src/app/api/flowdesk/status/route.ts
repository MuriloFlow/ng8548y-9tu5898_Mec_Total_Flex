import { NextResponse } from "next/server";
import { revalidateTag } from "next/cache";
import { bustEntitlementCache } from "@/lib/flowdesk/cache";
import { fetchEntitlementFresh } from "@/lib/flowdesk/client";

export const dynamic = "force-dynamic";

/**
 * Proxy consultado pelo monitor em tempo real e pela tela de bloqueio.
 * Sempre consulta o FlowDesk sem cache local.
 */
export async function GET() {
  const result = await fetchEntitlementFresh();

  if (result.allowed) {
    bustEntitlementCache();
    revalidateTag("flowdesk-entitlement", "max");
  }

  return NextResponse.json(
    {
      allowed: result.allowed,
      degraded: result.degraded,
      status: result.entitlement?.status ?? null,
      entitlement: result.entitlement,
      error: result.error ?? null,
    },
    { headers: { "Cache-Control": "no-store, no-cache, must-revalidate" } }
  );
}
