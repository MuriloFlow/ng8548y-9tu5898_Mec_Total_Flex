import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { readEntitlementCache, writeEntitlementCache } from "@/lib/flowdesk/cache";

const EXEMPT_PREFIXES = ["/api/flowdesk/", "/api/health", "/api/auth/login"];

function flowdeskMode(): "enforce" | "monitor" | "off" {
  const raw = (process.env.FLOWDESK_MODE ?? "enforce").toLowerCase();
  if (raw === "monitor" || raw === "off") return raw;
  return "enforce";
}

async function isBlocked(): Promise<boolean | null> {
  const cached = readEntitlementCache();
  if (cached && !cached.degraded) {
    return !cached.allowed;
  }

  const secret = process.env.FLOWDESK_SECRET_KEY?.trim();
  if (!secret) return null;

  const base = (process.env.FLOWDESK_API_URL ?? "https://flowdeskbrasil.vercel.app").replace(
    /\/+$/,
    ""
  );

  const controller = new AbortController();
  const timer = setTimeout(
    () => controller.abort(),
    Number(process.env.FLOWDESK_TIMEOUT_MS ?? 8000)
  );

  try {
    const response = await fetch(`${base}/api/v1/entitlement`, {
      headers: {
        Authorization: `Bearer ${secret}`,
        Accept: "application/json",
      },
      cache: "no-store",
      signal: controller.signal,
    });

    if (!response.ok) return null;

    const data = (await response.json()) as { blocked?: boolean; has_access?: boolean };
    const blocked = data.blocked === true || data.has_access === false;
    writeEntitlementCache({ allowed: !blocked, degraded: false, entitlement: data as never });
    return blocked;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (!pathname.startsWith("/api/")) {
    return NextResponse.next();
  }

  if (EXEMPT_PREFIXES.some((prefix) => pathname.startsWith(prefix))) {
    return NextResponse.next();
  }

  const mode = flowdeskMode();
  if (mode === "off") {
    return NextResponse.next();
  }

  const blocked = await isBlocked();
  if (blocked === true && mode === "enforce") {
    return NextResponse.json(
      {
        error: "Acesso bloqueado por falta de pagamento.",
        code: "FLOWDESK_BLOCKED",
      },
      { status: 402 }
    );
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/api/:path*"],
};
