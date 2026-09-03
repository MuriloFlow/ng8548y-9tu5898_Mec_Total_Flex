"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  ArrowUpRight,
  CalendarClock,
  CheckCircle2,
  Loader2,
  Lock,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import type { Entitlement } from "@/lib/flowdesk/types";
import { useFlowdeskLive } from "./use-flowdesk-live";

const BRL = new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" });

function formatDate(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(`${value.slice(0, 10)}T12:00:00`);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleDateString("pt-BR", { day: "2-digit", month: "long", year: "numeric" });
}

function daysLate(value: string | null | undefined): number | null {
  if (!value) return null;
  const due = new Date(`${value.slice(0, 10)}T12:00:00`).getTime();
  if (Number.isNaN(due)) return null;
  const diff = Math.floor((Date.now() - due) / 86_400_000);
  return diff > 0 ? diff : null;
}

export function FlowdeskBlockedScreen({ entitlement }: { entitlement: Entitlement | null }) {
  const [released, setReleased] = useState(false);
  const { checking, checkNow, payload } = useFlowdeskLive({ intervalMs: 2500 });

  const active = payload?.entitlement ?? entitlement;

  useEffect(() => {
    if (payload?.allowed && !payload.degraded) {
      setReleased(true);
      const timer = setTimeout(() => window.location.reload(), 1200);
      return () => clearTimeout(timer);
    }
  }, [payload?.allowed, payload?.degraded]);

  const charge = active?.charge ?? null;
  const payUrl = charge?.payment_url ?? charge?.checkout_url ?? null;
  const late = daysLate(charge?.due_date);
  const blockType = active?.block_type ?? (charge ? "payment" : "manual");

  const title =
    blockType === "payment"
      ? "Aplicação bloqueada por falta de pagamento"
      : blockType === "suspended"
        ? "Aplicação suspensa"
        : "Acesso temporariamente bloqueado";

  const subtitle =
    blockType === "payment"
      ? "O acesso está suspenso até a regularização da cobrança abaixo."
      : active?.blocked_reason ??
        "Entre em contato com o responsável pelo sistema para regularizar o acesso.";

  if (released) {
    return (
      <main className="flex min-h-dvh items-center justify-center bg-slate-50 px-4">
        <div className="flex flex-col items-center gap-4 text-center">
          <span className="flex size-14 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600">
            <CheckCircle2 className="size-7" />
          </span>
          <div>
            <p className="text-lg font-semibold text-slate-900">Pagamento confirmado</p>
            <p className="mt-1 text-sm text-slate-500">Liberando o acesso ao sistema…</p>
          </div>
          <Loader2 className="size-4 animate-spin text-slate-400" />
        </div>
      </main>
    );
  }

  return (
    <main className="relative flex min-h-dvh flex-col items-center justify-center overflow-hidden bg-slate-50 px-4 py-10">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-x-0 -top-40 h-96 opacity-70 blur-3xl"
        style={{
          background:
            "radial-gradient(50% 60% at 50% 50%, rgba(244,63,94,0.10) 0%, rgba(244,63,94,0) 100%)",
        }}
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            "linear-gradient(to right, rgba(15,23,42,0.04) 1px, transparent 1px), linear-gradient(to bottom, rgba(15,23,42,0.04) 1px, transparent 1px)",
          backgroundSize: "44px 44px",
          maskImage: "radial-gradient(70% 60% at 50% 40%, black, transparent)",
        }}
      />

      <div className="relative w-full max-w-[520px]">
        <div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-[0_18px_50px_-24px_rgba(15,23,42,0.35)]">
          <div className="flex items-start gap-4 border-b border-slate-100 bg-gradient-to-b from-rose-50/70 to-white px-7 py-7">
            <span className="mt-0.5 flex size-11 shrink-0 items-center justify-center rounded-xl bg-rose-100 text-rose-600">
              <Lock className="size-5" />
            </span>
            <div className="min-w-0">
              <h1 className="text-[19px] font-semibold leading-tight tracking-[-0.015em] text-slate-900">
                {title}
              </h1>
              <p className="mt-1.5 text-[13.5px] leading-relaxed text-slate-600">
                O acesso ao{" "}
                <span className="font-medium text-slate-900">
                  {active?.project.name ?? "sistema"}
                </span>{" "}
                {subtitle}
              </p>
            </div>
          </div>

          {charge ? (
            <div className="px-7 py-6">
              <div className="rounded-xl border border-slate-200 bg-slate-50/60 p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="truncate text-[13.5px] font-medium text-slate-900">
                      {charge.description ?? "Cobrança em aberto"}
                    </p>
                    {charge.code && (
                      <p className="mt-0.5 font-mono text-[11.5px] uppercase tracking-wide text-slate-400">
                        {charge.code}
                      </p>
                    )}
                  </div>
                  <p className="shrink-0 text-[22px] font-semibold tracking-[-0.02em] text-slate-900 tabular-nums">
                    {BRL.format(charge.amount)}
                  </p>
                </div>

                <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-slate-200 pt-4 text-[12.5px]">
                  <span className="inline-flex items-center gap-1.5 text-slate-500">
                    <CalendarClock className="size-3.5" />
                    Venceu em {formatDate(charge.due_date)}
                  </span>
                  {late !== null && (
                    <span className="inline-flex items-center gap-1.5 rounded-md bg-rose-50 px-2 py-0.5 font-medium text-rose-600">
                      <AlertTriangle className="size-3.5" />
                      {late} {late === 1 ? "dia" : "dias"} em atraso
                    </span>
                  )}
                </div>
              </div>

              {payUrl ? (
                <a
                  href={payUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-5 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-900 text-[14px] font-medium text-white transition hover:bg-slate-800 active:scale-[0.99]"
                >
                  Realizar pagamento
                  <ArrowUpRight className="size-4" />
                </a>
              ) : (
                <p className="mt-5 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-[12.5px] text-amber-700">
                  O link de pagamento ainda não está disponível. Entre em contato com o
                  responsável pelo sistema.
                </p>
              )}

              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={checking}
                className="mt-2.5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[13.5px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Já paguei, verificar agora
              </button>

              <p className="mt-4 flex items-start gap-2 text-[12px] leading-relaxed text-slate-500">
                <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-emerald-500" />
                Verificação automática a cada poucos segundos — a liberação não exige F5.
              </p>
            </div>
          ) : (
            <div className="px-7 py-6">
              <p className="text-[13.5px] leading-relaxed text-slate-600">
                {active?.blocked_reason ??
                  "O acesso foi suspenso pelo administrador. Entre em contato para regularizar."}
              </p>
              {active && active.open_amount > 0 && (
                <p className="mt-3 text-[13px] text-slate-500">
                  Total em aberto:{" "}
                  <span className="font-semibold text-slate-900">
                    {BRL.format(active.open_amount)}
                  </span>{" "}
                  em {active.open_invoices}{" "}
                  {active.open_invoices === 1 ? "cobrança" : "cobranças"}.
                </p>
              )}
              <button
                type="button"
                onClick={() => void checkNow()}
                disabled={checking}
                className="mt-5 inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white text-[13.5px] font-medium text-slate-700 transition hover:bg-slate-50 disabled:opacity-60"
              >
                {checking ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <RefreshCw className="size-4" />
                )}
                Verificar novamente
              </button>
            </div>
          )}
        </div>

        <p className="mt-5 text-center text-[11.5px] text-slate-400">
          Cobrança e liberação gerenciadas pelo FlowDesk · atualização em tempo real
        </p>
      </div>
    </main>
  );
}
