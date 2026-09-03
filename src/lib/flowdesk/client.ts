import "server-only";

import type { Entitlement, EntitlementResult } from "./types";
import {
  bustEntitlementCache,
  readEntitlementCache,
  writeEntitlementCache,
} from "./cache";

const DEFAULT_BASE_URL = "https://flowdeskbrasil.vercel.app";

/** Cache curto — o cliente faz polling a cada 3s via /api/flowdesk/status. */
const CACHE_TTL = Number(process.env.FLOWDESK_CACHE_SECONDS ?? 5);

/** Timeout generoso — o endpoint do FlowDesk agora responde em <1s. */
const TIMEOUT_MS = Number(process.env.FLOWDESK_TIMEOUT_MS ?? 8000);

export function flowdeskBaseUrl(): string {
  return (process.env.FLOWDESK_API_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
}

export function isFlowdeskConfigured(): boolean {
  return Boolean(process.env.FLOWDESK_SECRET_KEY?.trim());
}

function mode(): "enforce" | "monitor" | "off" {
  const raw = (process.env.FLOWDESK_MODE ?? "enforce").toLowerCase();
  if (raw === "monitor" || raw === "off") return raw;
  return "enforce";
}

const ALLOW: EntitlementResult = { allowed: true, degraded: false, entitlement: null };

function normalizeBlocked(entitlement: Entitlement): boolean {
  return entitlement.blocked === true || entitlement.has_access === false;
}

async function requestEntitlement(signal: AbortSignal): Promise<Response> {
  const secret = process.env.FLOWDESK_SECRET_KEY!.trim();
  const url = `${flowdeskBaseUrl()}/api/v1/entitlement`;

  return fetch(url, {
    headers: {
      Authorization: `Bearer ${secret}`,
      Accept: "application/json",
    },
    signal,
    cache: "no-store",
  });
}

function parseResult(entitlement: Entitlement, httpStatus?: number): EntitlementResult {
  const blocked = normalizeBlocked(entitlement);

  if (blocked && mode() === "monitor") {
    console.warn("[flowdesk] projeto bloqueado (modo monitor — acesso liberado)");
    return { allowed: true, degraded: false, entitlement };
  }

  if (httpStatus === 404) {
    return {
      allowed: true,
      degraded: true,
      entitlement: null,
      error:
        "Projeto não encontrado no FlowDesk. Verifique FLOWDESK_SECRET_KEY e se o projeto existe no painel.",
    };
  }

  return { allowed: !blocked, degraded: false, entitlement };
}

/**
 * Consulta o licenciamento financeiro do projeto no FlowDesk.
 * Fail-open quando o painel está indisponível.
 */
export async function fetchEntitlement(options?: { fresh?: boolean }): Promise<EntitlementResult> {
  if (mode() === "off") return ALLOW;

  const secret = process.env.FLOWDESK_SECRET_KEY?.trim();
  if (!secret) {
    return { ...ALLOW, degraded: true, error: "FLOWDESK_SECRET_KEY não configurada" };
  }

  if (!options?.fresh) {
    const cached = readEntitlementCache();
    if (cached) return cached;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await requestEntitlement(controller.signal);

    if (!response.ok) {
      if (response.status === 401) {
        return {
          ...ALLOW,
          degraded: true,
          error: "Chave FlowDesk inválida. Gere uma nova em Credenciais → Nova chave.",
        };
      }

      const body = await response.text().catch(() => "");
      const result: EntitlementResult = {
        ...ALLOW,
        degraded: true,
        error: `FlowDesk respondeu ${response.status}: ${body.slice(0, 160)}`,
      };
      writeEntitlementCache(result, 5_000);
      return result;
    }

    const entitlement = (await response.json()) as Entitlement;
    const result = parseResult(entitlement);
    writeEntitlementCache(result, CACHE_TTL * 1000);
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const hint =
      message.includes("aborted") || message.includes("AbortError")
        ? `Timeout ao consultar ${flowdeskBaseUrl()} — confira FLOWDESK_API_URL (FlowDesk local: http://localhost:3000, não :3001).`
        : message;

    console.error("[flowdesk] falha ao consultar entitlement:", hint);

    const result: EntitlementResult = { ...ALLOW, degraded: true, error: hint };
    writeEntitlementCache(result, 5_000);
    return result;
  } finally {
    clearTimeout(timer);
  }
}

/** Sem cache — usada pelo polling da tela de bloqueio. */
export async function fetchEntitlementFresh(): Promise<EntitlementResult> {
  bustEntitlementCache();
  return fetchEntitlement({ fresh: true });
}
