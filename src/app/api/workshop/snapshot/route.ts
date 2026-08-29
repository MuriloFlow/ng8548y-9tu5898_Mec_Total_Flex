import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const snapshotSchema = z.object({
  state: z.unknown(),
});

type SnapshotPayload = {
  company?: {
    id?: string;
  };
  updatedAt?: string;
};

async function authenticateSnapshotRequest() {
  const supabase = createSupabaseAdminClient();
  if (!supabase) return { error: NextResponse.json({ error: "supabase_not_configured" }, { status: 503 }) };

  const cookieStore = await cookies();
  const token = cookieStore.get("tf_session")?.value;
  if (!token) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const tokenHash = createHash("sha256").update(token).digest("hex");
  const { data, error } = await supabase
    .from("app_sessions")
    .select("app_user_id, app_users(company_id)")
    .eq("token_hash", tokenHash)
    .is("revoked_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();

  if (error || !data) return { error: NextResponse.json({ error: "unauthorized" }, { status: 401 }) };

  const companyId = (data as { app_users?: { company_id?: string } }).app_users?.company_id;
  if (!companyId) return { error: NextResponse.json({ error: "company_not_found" }, { status: 403 }) };

  return { supabase, companyId, userId: (data as { app_user_id: string }).app_user_id };
}

export async function GET() {
  const auth = await authenticateSnapshotRequest();
  if ("error" in auth) return auth.error;

  const { data, error } = await auth.supabase
    .from("workshop_app_snapshots")
    .select("state, updated_at")
    .eq("company_id", auth.companyId)
    .maybeSingle();

  if (error) return NextResponse.json({ error: "snapshot_read_failed" }, { status: 500 });
  return NextResponse.json({ state: data?.state ?? null, updatedAt: data?.updated_at ?? null });
}

export async function PUT(request: Request) {
  const auth = await authenticateSnapshotRequest();
  if ("error" in auth) return auth.error;

  const body = snapshotSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) return NextResponse.json({ error: "invalid_payload" }, { status: 400 });

  const state = body.data.state as SnapshotPayload;
  if (state.company?.id && state.company.id !== auth.companyId) {
    return NextResponse.json({ error: "company_mismatch" }, { status: 409 });
  }

  const { error } = await auth.supabase.from("workshop_app_snapshots").upsert({
    company_id: auth.companyId,
    state: body.data.state,
    updated_by: auth.userId,
    updated_at: new Date().toISOString(),
  });

  if (error) return NextResponse.json({ error: "snapshot_write_failed" }, { status: 500 });
  return NextResponse.json({ ok: true });
}
