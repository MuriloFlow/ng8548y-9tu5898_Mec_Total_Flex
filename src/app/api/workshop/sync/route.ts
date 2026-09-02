import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
import { restSelectSnapshot, restUpsertSnapshot } from "@/lib/supabase/rest";
import { syncEntitiesToTables } from "@/lib/workshop/entity-sync";
import { createSeedState } from "@/lib/workshop/seed";
import type { WorkshopState } from "@/lib/workshop/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";
const DEFAULT_COMPANY_ID = "00000000-0000-4000-8000-000000000001";

type SnapshotRow = {
  state: WorkshopState | null;
  updated_at: string | null;
};

type SupabaseError = {
  code?: string;
  message?: string;
};

function missingTable(error: SupabaseError) {
  const message = error.message?.toLowerCase() ?? "";
  return error.code === "42P01" || message.includes("does not exist") || message.includes("relation") || message.includes("not found");
}

function isConnectionError(error: SupabaseError | Error) {
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("abort")
  );
}

function mapSupabaseReadError(error: SupabaseError) {
  if (missingTable(error)) {
    return serverError("Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase.", 503, "table_missing");
  }
  if (isConnectionError(error)) {
    return serverError(
      "Nao foi possivel conectar ao Supabase. Verifique NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY e se o projeto nao esta pausado.",
      503,
      "connection_failed",
    );
  }
  return serverError(`Erro Supabase: ${error.message}`, 500, "read_failed");
}

function validState(value: unknown): value is WorkshopState {
  if (!value || typeof value !== "object") return false;
  const state = value as Partial<WorkshopState>;
  return Boolean(
    state.company?.id &&
      state.updatedAt &&
      Array.isArray(state.users) &&
      Array.isArray(state.customers) &&
      Array.isArray(state.vehicles) &&
      Array.isArray(state.orders),
  );
}

function serverError(detail: string, status = 500, reason = "supabase_error") {
  return NextResponse.json({ ok: false, persisted: false, reason, detail }, { status });
}

async function readSnapshot() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      response: serverError("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configuradas.", 503, "no_supabase"),
    };
  }

  let lastError: SupabaseError | null = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    const { data, error } = await supabase.from(TABLE).select("state, updated_at").eq("id", ROW_ID).maybeSingle<SnapshotRow>();
    if (!error) {
      return { supabase, row: data ?? null };
    }
    lastError = error;
    if (!isConnectionError(error) || attempt === 2) break;
    await new Promise((resolve) => setTimeout(resolve, 400 * attempt));
  }

  // Fallback direto via REST quando o client JS falha (comum no Windows/Node)
  const rest = await restSelectSnapshot<SnapshotRow>(TABLE, ROW_ID, "state,updated_at");
  if (!rest.error) {
    return { supabase, row: rest.data };
  }

  const mergedError: SupabaseError = {
    code: rest.error.code ?? lastError?.code,
    message: rest.error.message || lastError?.message || "Erro desconhecido",
  };

  return { response: mapSupabaseReadError(mergedError) };
}

async function writeSnapshot(state: WorkshopState, updatedBy: string) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return {
      response: serverError("SUPABASE_SERVICE_ROLE_KEY nao configurada.", 503, "no_supabase"),
    };
  }

  const updatedAt = new Date().toISOString();
  const stateToSave: WorkshopState = { ...state, updatedAt };
  const rowPayload = {
    id: ROW_ID,
    company_id: stateToSave.company.id || DEFAULT_COMPANY_ID,
    state: stateToSave,
    updated_by: updatedBy,
    updated_at: updatedAt,
  };

  const { error } = await supabase.from(TABLE).upsert(rowPayload, { onConflict: "id" });

  if (error && isConnectionError(error)) {
    const restWrite = await restUpsertSnapshot<SnapshotRow>(TABLE, rowPayload);
    if (restWrite.error) {
      return {
        response: serverError(
          missingTable(restWrite.error) ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase." : `Erro Supabase: ${restWrite.error.message}`,
          missingTable(restWrite.error) ? 503 : 500,
          missingTable(restWrite.error) ? "table_missing" : "write_failed",
        ),
      };
    }
  } else if (error) {
    return {
      response: serverError(
        missingTable(error) ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase." : `Erro Supabase: ${error.message}`,
        missingTable(error) ? 503 : 500,
        missingTable(error) ? "table_missing" : "write_failed",
      ),
    };
  }

  let saved: SnapshotRow | null = null;
  const { data: savedClient, error: verifyError } = await supabase.from(TABLE).select("state, updated_at").eq("id", ROW_ID).maybeSingle<SnapshotRow>();
  if (!verifyError && validState(savedClient?.state)) {
    saved = savedClient;
  } else {
    const restRead = await restSelectSnapshot<SnapshotRow>(TABLE, ROW_ID, "state,updated_at");
    if (restRead.data && validState(restRead.data.state)) {
      saved = restRead.data;
    } else {
      return {
        response: serverError(
          verifyError?.message || restRead.error?.message
            ? `Salvou, mas nao confirmou leitura: ${verifyError?.message || restRead.error?.message}`
            : "Salvou, mas nao confirmou o snapshot.",
          500,
          "verify_failed",
        ),
      };
    }
  }

  const entitySync = await syncEntitiesToTables(supabase, saved.state!).catch((err) => ({
    ok: false as const,
    error: err instanceof Error ? err.message : String(err),
    tables: [] as string[],
  }));

  return {
    state: saved.state,
    updatedAt: saved.updated_at ?? updatedAt,
    entitySync,
  };
}

export async function GET() {
  try {
    const result = await readSnapshot();
    if ("response" in result) return result.response;

    if (!validState(result.row?.state)) {
      const seed = createSeedState();
      const saved = await writeSnapshot(seed, "server_seed");
      if ("response" in saved) return saved.response;
      return NextResponse.json({ ok: true, state: saved.state, updatedAt: saved.updatedAt, source: "supabase" });
    }

    return NextResponse.json({
      ok: true,
      state: result.row.state,
      updatedAt: result.row.updated_at ?? result.row.state.updatedAt,
      source: "supabase",
    });
  } catch (error) {
    if (error instanceof Error && isConnectionError(error)) {
      return serverError(
        "Nao foi possivel conectar ao Supabase. Verifique URL, service role key e conexao com a internet.",
        503,
        "connection_failed",
      );
    }
    return serverError(error instanceof Error ? error.message : String(error), 500, "exception");
  }
}

export async function PUT(request: Request) {
  try {
    const body = (await request.json().catch(() => null)) as { state?: unknown } | null;
    if (!validState(body?.state)) {
      return serverError("Payload invalido: envie { state } com company, users, customers, vehicles, orders e updatedAt.", 400, "invalid_state");
    }

    const saved = await writeSnapshot(body.state, "client");
    if ("response" in saved) return saved.response;

    return NextResponse.json({
      ok: true,
      persisted: true,
      state: saved.state,
      updatedAt: saved.updatedAt,
      source: "supabase",
      entitySync: saved.entitySync,
    });
  } catch (error) {
    if (error instanceof Error && isConnectionError(error)) {
      return serverError(
        "Nao foi possivel conectar ao Supabase. Verifique URL, service role key e conexao com a internet.",
        503,
        "connection_failed",
      );
    }
    return serverError(error instanceof Error ? error.message : String(error), 500, "exception");
  }
}