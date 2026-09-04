import { NextResponse } from "next/server";

/** Resposta mínima para probes do Chrome DevTools (`GET /json/version`). */
export async function GET() {
  return NextResponse.json({ Browser: "Mecanica Total Flex", "Protocol-Version": "1.3" });
}
