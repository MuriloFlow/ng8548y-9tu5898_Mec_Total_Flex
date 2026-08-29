import { NextResponse } from "next/server";
import { isSupabaseServerConfigured } from "@/lib/supabase/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    app: "total-flex-os",
    supabaseConfigured: isSupabaseServerConfigured(),
    generatedAt: new Date().toISOString(),
  });
}
