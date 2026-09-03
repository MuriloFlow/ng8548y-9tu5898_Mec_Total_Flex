import "server-only";

import type { Entitlement, EntitlementResult } from "./types";

const DEFAULT_BASE_URL = "https://flowdeskbrasil.vercel.app";

/** Segundos de cache do entitlement. Curto o bastante para liberar rápido após o pagamento. */
const CACHE_TTL = Number(process.env.FLOWDESK_CACHE_SECONDS ?? 60);

/** Timeout da chamada. Se estourar, liberamos o acesso (fail-open). */
const TIMEOUT_MS = Number(process.env.FLOWDESK_TIMEOUT_MS ?? 4000);

export function flowdeskBaseUrl(): string {
  return (process.env.FLOWDESK_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function isFlowdeskConfigured(): boolean {
  return Boolean(process.env.FLOWDESK_SECRET_KEY);
}

/**
 * Modo de operação:
 *  - "enforce"  bloqueia a aplicação quando o FlowDesk manda bloquear (padrão)
 *  - "monitor"  apenas registra no log, nunca bloqueia (útil em homologação)
 *  - "off"      desliga a verificação
 */
function mode(): "enforce" | "monitor" | "off" {
  const raw = (process.env.FLOWDESK_MODE ?? "enforce").toLowerCase();
  if (raw === "monitor" || raw === "off") return raw;
  return "enforce";
}

const ALLOW: EntitlementResult = { allowed: true, degraded: false, entitlement: null };

/**
 * Consulta o licenciamento financeiro do projeto no FlowDesk.
 *
 * Nunca lança: qualquer falha vira `degraded: true` com `allowed: true`.
 */
export async function fetchEntitlement(): Promise<EntitlementResult> {
  if (mode() === "off") return ALLOW;

  const secret = process.env.FLOWDESK_SECRET_KEY;
  if (!secret) {
    return { ...ALLOW, degraded: true, error: "FLOWDESK_SECRET_KEY não configurada" };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${flowdeskBaseUrl()}/api/v1/entitlement`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      signal: controller.signal,
      next: { revalidate: CACHE_TTL, tags: ["flowdesk-entitlement"] },
    });

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      return {
        ...ALLOW,
        degraded: true,
        error: `FlowDesk respondeu ${response.status}: ${body.slice(0, 200)}`,
      };
    }

    const entitlement = (await response.json()) as Entitlement;
    const blocked = entitlement.blocked === true || entitlement.has_access === false;

    if (blocked && mode() === "monitor") {
      console.warn("[flowdesk] projeto bloqueado (modo monitor, acesso liberado)");
      return { allowed: true, degraded: false, entitlement };
    }

    return { allowed: !blocked, degraded: false, entitlement };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error("[flowdesk] falha ao consultar entitlement:", message);
    return { ...ALLOW, degraded: true, error: message };
  } finally {
    clearTimeout(timer);
  }
}

/** Versão sem cache — usada pelo polling da tela de bloqueio. */
export async function fetchEntitlementFresh(): Promise<EntitlementResult> {
  const secret = process.env.FLOWDESK_SECRET_KEY;
  if (!secret || mode() === "off") return ALLOW;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(`${flowdeskBaseUrl()}/api/v1/entitlement`, {
      headers: { Authorization: `Bearer ${secret}`, Accept: "application/json" },
      signal: controller.signal,
      cache: "no-store",
    });
    if (!response.ok) return { ...ALLOW, degraded: true, error: `HTTP ${response.status}` };

    const entitlement = (await response.json()) as Entitlement;
    const blocked = entitlement.blocked === true || entitlement.has_access === false;
    return { allowed: mode() === "monitor" ? true : !blocked, degraded: false, entitlement };
  } catch (error) {
    return {
      ...ALLOW,
      degraded: true,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timer);
  }
}
