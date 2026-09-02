import "server-only";

const FETCH_TIMEOUT_MS = 5_000;

export function supabaseFetch(input: RequestInfo | URL, init?: RequestInit) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const signals = [controller.signal];
  if (init?.signal) signals.push(init.signal);

  return fetch(input, {
    ...init,
    signal: signals.length > 1 ? mergeSignals(signals) : controller.signal,
  }).finally(() => clearTimeout(timeout));
}

function mergeSignals(signals: AbortSignal[]) {
  const controller = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      controller.abort();
      break;
    }
    signal.addEventListener("abort", () => controller.abort(), { once: true });
  }
  return controller.signal;
}

export function getSupabaseEnv() {
  const url = cleanEnv(process.env.NEXT_PUBLIC_SUPABASE_URL)?.replace(/\/$/, "");
  const serviceRoleKey = cleanEnv(process.env.SUPABASE_SERVICE_ROLE_KEY);
  return { url, serviceRoleKey };
}

function cleanEnv(value?: string) {
  if (!value) return undefined;
  return value.trim().replace(/^["']|["']$/g, "");
}

export function supabaseRestHeaders(serviceRoleKey: string) {
  return {
    apikey: serviceRoleKey,
    Authorization: `Bearer ${serviceRoleKey}`,
    Accept: "application/json",
    "Content-Type": "application/json",
    Prefer: "return=representation",
  };
}
