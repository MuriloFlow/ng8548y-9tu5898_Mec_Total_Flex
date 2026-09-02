import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";
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

  const { data, error } = await supabase.from(TABLE).select("state, updated_at").eq("id", ROW_ID).maybeSingle<SnapshotRow>();
  if (error) {
    return {
      response: serverError(
        missingTable(error) ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase." : `Erro Supabase: ${error.message}`,
        missingTable(error) ? 503 : 500,
        missingTable(error) ? "table_missing" : "read_failed",
      ),
    };
  }

  return { supabase, row: data ?? null };
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
  const { error } = await supabase.from(TABLE).upsert(
    {
      id: ROW_ID,
      company_id: stateToSave.company.id || DEFAULT_COMPANY_ID,
      state: stateToSave,
      updated_by: updatedBy,
      updated_at: updatedAt,
    },
    { onConflict: "id" },
  );

  if (error) {
    return {
      response: serverError(
        missingTable(error) ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase." : `Erro Supabase: ${error.message}`,
        missingTable(error) ? 503 : 500,
        missingTable(error) ? "table_missing" : "write_failed",
      ),
    };
  }

  const { data: saved, error: verifyError } = await supabase.from(TABLE).select("state, updated_at").eq("id", ROW_ID).maybeSingle<SnapshotRow>();
  if (verifyError || !validState(saved?.state)) {
    return {
      response: serverError(verifyError?.message ? `Salvou, mas nao confirmou leitura: ${verifyError.message}` : "Salvou, mas nao confirmou o snapshot.", 500, "verify_failed"),
    };
  }

  const entitySync = await syncEntitiesToTables(supabase, saved.state);

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
    return serverError(error instanceof Error ? error.message : String(error), 500, "exception");
  }
}