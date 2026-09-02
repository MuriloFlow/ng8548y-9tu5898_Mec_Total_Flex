import { NextResponse } from "next/server";
import { createSupabaseAdminClient, isSupabaseServerConfigured } from "@/lib/supabase/server";
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
  return (
    error.code === "42P01" ||
    message.includes("does not exist") ||
    message.includes("relation") ||
    message.includes("schema cache") ||
    message.includes("not found")
  );
}

function isConnectionError(error: SupabaseError | Error) {
  const message = (error.message ?? "").toLowerCase();
  return (
    message.includes("fetch failed") ||
    message.includes("network") ||
    message.includes("timeout") ||
    message.includes("timed out") ||
    message.includes("econnrefused") ||
    message.includes("enotfound") ||
    message.includes("abort") ||
    message.includes("certificate")
  );
}

function mapSupabaseReadError(error: SupabaseError) {
  if (missingTable(error)) {
    return serverError("Tabela workshop_app_snapshots nao existe. Execute SQL_COMPLETO.sql no Supabase.", 503, "table_missing");
  }
  if (isConnectionError(error)) {
    return serverError(
      "Sem resposta do Supabase. Confirme: projeto ativo, SQL_COMPLETO.sql executado, .env reiniciado apos salvar.",
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
  if (!isSupabaseServerConfigured()) {
    return {
      response: serverError("NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configuradas.", 503, "no_supabase"),
    };
  }

  const rest = await restSelectSnapshot<SnapshotRow>(TABLE, ROW_ID, "state,updated_at");
  if (rest.error) {
    return { response: mapSupabaseReadError(rest.error) };
  }

  return { row: rest.data };
}

async function writeSnapshot(state: WorkshopState, updatedBy: string) {
  if (!isSupabaseServerConfigured()) {
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

  const restWrite = await restUpsertSnapshot<SnapshotRow>(TABLE, rowPayload);
  if (restWrite.error) {
    return {
      response: serverError(
        missingTable(restWrite.error)
          ? "Tabela workshop_app_snapshots nao existe. Execute SQL_COMPLETO.sql no Supabase."
          : `Erro Supabase: ${restWrite.error.message}`,
        missingTable(restWrite.error) ? 503 : 500,
        missingTable(restWrite.error) ? "table_missing" : "write_failed",
      ),
    };
  }

  const restRead = await restSelectSnapshot<SnapshotRow>(TABLE, ROW_ID, "state,updated_at");
  const saved = restRead.data && validState(restRead.data.state) ? restRead.data : restWrite.data;

  if (!saved || !validState(saved.state)) {
    return {
      response: serverError(
        restRead.error?.message ? `Salvou, mas nao confirmou leitura: ${restRead.error.message}` : "Salvou, mas nao confirmou o snapshot.",
        500,
        "verify_failed",
      ),
    };
  }

  const supabase = createSupabaseAdminClient();
  const entitySync = supabase
    ? await syncEntitiesToTables(supabase, saved.state!).catch((err) => ({
        ok: false as const,
        error: err instanceof Error ? err.message : String(err),
        tables: [] as string[],
      }))
    : { ok: false as const, error: "Client indisponivel", tables: [] as string[] };

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
        "Sem resposta do Supabase. Verifique internet, URL do projeto e se o SQL ja foi executado.",
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
        "Sem resposta do Supabase. Verifique internet, URL do projeto e se o SQL ja foi executado.",
        503,
        "connection_failed",
      );
    }
    return serverError(error instanceof Error ? error.message : String(error), 500, "exception");
  }
}
