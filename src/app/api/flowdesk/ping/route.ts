import { NextResponse } from "next/server";
import { flowdeskBaseUrl, isFlowdeskConfigured } from "@/lib/flowdesk/client";

export const dynamic = "force-dynamic";

/**
 * GET /api/flowdesk/ping
 * Testa se a chave secreta e a URL do FlowDesk estão corretas.
 */
export async function GET() {
  if (!isFlowdeskConfigured()) {
    return NextResponse.json(
      {
        ok: false,
        message: "FLOWDESK_SECRET_KEY não configurada no .env.local",
      },
      { status: 503 }
    );
  }

  const secret = process.env.FLOWDESK_SECRET_KEY!;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 5000);

  try {
    const response = await fetch(`${flowdeskBaseUrl()}/api/v1/ping`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        {
          ok: false,
          message: `FlowDesk respondeu ${response.status}`,
          detail: body,
        },
        { status: 502 }
      );
    }

    return NextResponse.json({
      ok: true,
      message: "Conexão com o FlowDesk OK",
      flowdesk: body,
      api_url: flowdeskBaseUrl(),
    });
  } catch (error) {
    return NextResponse.json(
      {
        ok: false,
        message: error instanceof Error ? error.message : "Falha ao conectar",
      },
      { status: 502 }
    );
  } finally {
    clearTimeout(timer);
  }
}
