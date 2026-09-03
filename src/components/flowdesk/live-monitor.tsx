"use client";

import type { ReactNode } from "react";
import { FlowdeskBlockedScreen } from "./blocked-screen";
import { useFlowdeskLive } from "./use-flowdesk-live";

/**
 * Enquanto o usuário usa o sistema, verifica o entitlement a cada poucos segundos.
 * Se o FlowDesk bloquear, a tela muda automaticamente — sem F5.
 */
export function FlowdeskLiveMonitor({ children }: { children: ReactNode }) {
  const { payload, blocked } = useFlowdeskLive({ intervalMs: 3000 });

  if (blocked) {
    return <FlowdeskBlockedScreen entitlement={payload?.entitlement ?? null} />;
  }

  return <>{children}</>;
}
