import { NextResponse } from "next/server";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const TABLE = "workshop_app_snapshots";
const ROW_ID = "singleton";

type SnapshotState = Record<string, unknown> & {
  updatedAt?: string;
  company?: {
    id?: string;
  };
};

function isMissingTable(error: { code?: string; message?: string }) {
  return (
    error.code === "42P01" ||
    error.message?.includes("does not exist") ||
    error.message?.includes("relation") ||
    error.message?.includes("not found")
  );
}

function hasValidState(state: unknown): state is SnapshotState {
  return Boolean(state && typeof state === "object" && (state as SnapshotState).updatedAt);
}

export async function GET() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        state: null,
        updatedAt: null,
        source: "no_supabase",
        detail: "SUPABASE_SERVICE_ROLE_KEY ou NEXT_PUBLIC_SUPABASE_URL nao configuradas.",
      },
      { status: 503 },
    );
  }

  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select("state, updated_at")
      .eq("id", ROW_ID)
      .maybeSingle();

    if (error) {
      const missing = isMissingTable(error);
      return NextResponse.json(
        {
          state: null,
          updatedAt: null,
          source: missing ? "table_missing" : "error",
          detail: missing
            ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql no Supabase SQL Editor."
            : `Erro Supabase: ${error.message}`,
        },
        { status: missing ? 503 : 500 },
      );
    }

    if (!hasValidState(data?.state)) {
      return NextResponse.json(
        {
          state: null,
          updatedAt: data?.updated_at ?? null,
          source: "missing_seed",
          detail: "Snapshot inicial vazio. Execute SQLFINAL.sql no Supabase.",
        },
        { status: 503 },
      );
    }

    return NextResponse.json({
      state: data.state,
      updatedAt: data.updated_at ?? null,
      source: "supabase",
    });
  } catch (err) {
    return NextResponse.json(
      {
        state: null,
        updatedAt: null,
        source: "exception",
        detail: err instanceof Error ? err.message : String(err),
      },
      { status: 500 },
    );
  }
}

export async function PUT(request: Request) {
  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json(
      {
        ok: false,
        persisted: false,
        reason: "no_supabase",
        detail: "SUPABASE_SERVICE_ROLE_KEY nao configurada.",
      },
      { status: 503 },
    );
  }

  try {
    const body = await request.json();
    const state = body?.state as SnapshotState | undefined;

    if (!hasValidState(state)) {
      return NextResponse.json(
        { ok: false, error: "invalid_state", detail: "Estado invalido ou sem updatedAt." },
        { status: 400 },
      );
    }

    const { error } = await supabase.from(TABLE).upsert(
      {
        id: ROW_ID,
        company_id: state.company?.id ?? "00000000-0000-4000-8000-000000000001",
        state,
        updated_at: state.updatedAt,
        updated_by: "client",
      },
      { onConflict: "id" },
    );

    if (error) {
      const missing = isMissingTable(error);
      return NextResponse.json(
        {
          ok: false,
          persisted: false,
          reason: missing ? "table_missing" : "upsert_failed",
          detail: missing
            ? "Tabela workshop_app_snapshots nao existe. Execute SQLFINAL.sql."
            : `Erro Supabase: ${error.message} (code: ${error.code})`,
        },
        { status: missing ? 503 : 500 },
      );
    }

    return NextResponse.json({ ok: true, persisted: true, updatedAt: state.updatedAt });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { ok: false, error: "exception", detail: `Erro interno: ${message}` },
      { status: 500 },
    );
  }
}
