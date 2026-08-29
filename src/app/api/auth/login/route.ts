import { cookies } from "next/headers";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { createSupabaseAdminClient } from "@/lib/supabase/server";

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1),
});

type LoginRpcRow = {
  user_id: string;
  company_id: string;
  employee_id: string | null;
  username: string;
  display_name: string;
  role: "admin" | "attendant" | "mechanic";
  session_token: string;
  expires_at: string;
};

export async function POST(request: NextRequest) {
  const body = loginSchema.safeParse(await request.json().catch(() => null));
  if (!body.success) {
    return NextResponse.json({ error: "invalid_payload" }, { status: 400 });
  }

  const supabase = createSupabaseAdminClient();
  if (!supabase) {
    return NextResponse.json({ configured: false, error: "supabase_not_configured" }, { status: 503 });
  }

  const { data, error } = await supabase.rpc("app_verify_login", {
    p_username: body.data.username,
    p_password: body.data.password,
    p_user_agent: request.headers.get("user-agent"),
    p_ip: null,
  });

  if (error || !Array.isArray(data) || !data[0]) {
    return NextResponse.json({ error: "invalid_credentials" }, { status: 401 });
  }

  const row = data[0] as LoginRpcRow;
  const cookieStore = await cookies();
  cookieStore.set("tf_session", row.session_token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: new Date(row.expires_at),
  });

  return NextResponse.json({
    configured: true,
    user: {
      id: row.user_id,
      companyId: row.company_id,
      employeeId: row.employee_id ?? undefined,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
    },
  });
}
