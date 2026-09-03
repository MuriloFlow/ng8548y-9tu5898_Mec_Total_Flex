/**
 * Contrato público do FlowDesk (endpoint GET /api/v1/entitlement).
 * Este arquivo é portável: pode ser copiado para qualquer outro projeto que
 * precise consultar o licenciamento financeiro.
 */

export type ProjectStatus =
  | "ACTIVE"
  | "TRIAL"
  | "GRACE"
  | "BLOCKED_PAYMENT"
  | "SUSPENDED"
  | "CANCELED"
  | "ARCHIVED";

export interface EntitlementCharge {
  id: string;
  code: string | null;
  description: string | null;
  amount: number;
  due_date: string | null;
  checkout_url: string | null;
  payment_url: string | null;
}

export interface Entitlement {
  object: "entitlement";
  project: {
    id: string;
    code: string | null;
    name: string;
    slug: string | null;
    domain: string | null;
  };
  status: ProjectStatus;
  has_access: boolean;
  blocked: boolean;
  blocked_reason: string | null;
  blocked_at: string | null;
  block_type?: "payment" | "manual" | "suspended" | null;
  grace_days: number;
  customer: { id: string; name: string; email: string | null };
  open_invoices: number;
  open_amount: number;
  charge: EntitlementCharge | null;
  checked_at: string;
}

/**
 * Resultado normalizado devolvido pelo client. `degraded` indica que não foi
 * possível falar com o FlowDesk — nesse caso o acesso é liberado (fail-open)
 * para que uma indisponibilidade nossa nunca derrube o sistema do cliente.
 */
export interface EntitlementResult {
  allowed: boolean;
  degraded: boolean;
  entitlement: Entitlement | null;
  error?: string;
}
