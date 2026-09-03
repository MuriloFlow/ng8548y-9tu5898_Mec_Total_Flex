import type { ReactNode } from "react";
import { unstable_noStore as noStore } from "next/cache";
import { fetchEntitlement } from "@/lib/flowdesk/client";
import { FlowdeskBlockedScreen } from "./blocked-screen";
import { FlowdeskLiveMonitor } from "./live-monitor";

/**
 * Checagem inicial no servidor + monitoramento contínuo no cliente (sem F5).
 */
export async function FlowdeskAccessGate({ children }: { children: ReactNode }) {
  noStore();
  const result = await fetchEntitlement({ fresh: true });

  if (!result.allowed && !result.degraded) {
    return <FlowdeskBlockedScreen entitlement={result.entitlement} />;
  }

  return <FlowdeskLiveMonitor>{children}</FlowdeskLiveMonitor>;
}
