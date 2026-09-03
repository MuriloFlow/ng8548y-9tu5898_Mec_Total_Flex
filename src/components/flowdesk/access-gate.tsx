import type { ReactNode } from "react";
import { fetchEntitlement } from "@/lib/flowdesk/client";
import { FlowdeskBlockedScreen } from "./blocked-screen";

/**
 * Envolve a aplicação e substitui todo o conteúdo pela tela de bloqueio quando
 * o FlowDesk sinaliza inadimplência. Falhas de rede liberam o acesso.
 */
export async function FlowdeskAccessGate({ children }: { children: ReactNode }) {
  const result = await fetchEntitlement();

  if (!result.allowed) {
    return <FlowdeskBlockedScreen entitlement={result.entitlement} />;
  }

  return <>{children}</>;
}
