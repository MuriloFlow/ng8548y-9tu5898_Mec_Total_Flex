"use client";

import * as React from "react";
import type { Entitlement } from "@/lib/flowdesk/types";

export interface FlowdeskStatusPayload {
  allowed: boolean;
  degraded?: boolean;
  status?: string | null;
  entitlement?: Entitlement | null;
  error?: string | null;
}

/**
 * Consulta /api/flowdesk/status em intervalo curto para detectar bloqueio ou
 * liberação sem precisar recarregar a página (F5).
 */
export function useFlowdeskLive(options?: { enabled?: boolean; intervalMs?: number }) {
  const enabled = options?.enabled ?? true;
  const intervalMs = options?.intervalMs ?? 3000;
  const [payload, setPayload] = React.useState<FlowdeskStatusPayload | null>(null);
  const [checking, setChecking] = React.useState(false);

  const check = React.useCallback(async (silent = true) => {
    if (!silent) setChecking(true);
    try {
      const response = await fetch("/api/flowdesk/status", { cache: "no-store" });
      if (!response.ok) return null;
      const data = (await response.json()) as FlowdeskStatusPayload;
      setPayload(data);
      return data;
    } catch {
      return null;
    } finally {
      if (!silent) setChecking(false);
    }
  }, []);

  React.useEffect(() => {
    if (!enabled) return;

    const timeoutId = window.setTimeout(() => void check(true), 0);
    const interval = window.setInterval(() => void check(true), intervalMs);
    const onFocus = () => void check(true);
    const onVisible = () => {
      if (document.visibilityState === "visible") void check(true);
    };

    window.addEventListener("focus", onFocus);
    document.addEventListener("visibilitychange", onVisible);

    return () => {
      clearTimeout(timeoutId);
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [check, enabled, intervalMs]);

  const blocked = payload?.allowed === false && payload?.degraded !== true;

  return {
    payload,
    checking,
    blocked,
    checkNow: () => check(false),
  };
}
