import { NextResponse } from "next/server";
import { isLikelyPlate, normalizePlate } from "@/lib/workshop/format";
import type { Vehicle, VehicleLookupResult } from "@/lib/workshop/types";

type RouteContext = {
  params: Promise<{ plate: string }>;
};

type ApiRecord = Record<string, unknown>;
type ProviderResult = VehicleLookupResult & { provider: string };

export const dynamic = "force-dynamic";

function readText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function readNumber(value: unknown) {
  const parsed = Number.parseInt(readText(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readNestedText(payload: ApiRecord, key: string) {
  const extra = payload.extra;
  if (!extra || typeof extra !== "object") return "";
  return readText((extra as ApiRecord)[key]);
}

function inferCategory(payload: ApiRecord): Vehicle["category"] {
  const text = [
    readText(payload.tipo),
    readText(payload.tipo_veiculo),
    readText(payload.segmento),
    readText(payload.especie),
    readNestedText(payload, "tipo_veiculo"),
    readNestedText(payload, "segmento"),
    readNestedText(payload, "especie"),
  ]
    .join(" ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (text.includes("moto")) return "motorcycle";
  if (text.includes("caminh") || text.includes("truck")) return "truck";
  if (text.includes("van") || text.includes("utilitario")) return "van";
  return "car";
}

function cleanBrandModel(brandValue: string, modelValue: string) {
  const composite = modelValue || brandValue;
  const [left, right] = composite.includes("/") ? composite.split("/", 2).map((part) => part.trim()) : ["", ""];
  const brand = brandValue && brandValue !== modelValue ? brandValue : left || brandValue;
  let model = right || modelValue;

  if (brand && model.toLowerCase().startsWith(`${brand.toLowerCase()}/`)) {
    model = model.slice(brand.length + 1).trim();
  }

  return { brand, model };
}

function pickBestImage(payload: ApiRecord) {
  const imageUrl = readText(payload.imageUrl) || readText(payload.imagem) || readText(payload.foto) || readText(payload.photo);
  return imageUrl.startsWith("http://") || imageUrl.startsWith("https://") ? imageUrl : undefined;
}

function mapPlatePayload(payload: ApiRecord, provider: string): ProviderResult {
  const rawBrand = readText(payload.marca) || readText(payload.MARCA) || readNestedText(payload, "marca");
  const rawModel =
    readText(payload.modelo) ||
    readText(payload.MODELO) ||
    readText(payload.marcaModelo) ||
    readText(payload.modeloMarca) ||
    readNestedText(payload, "modelo");
  const { brand, model } = cleanBrandModel(rawBrand, rawModel);

  if (!brand || !model) {
    return {
      status: "not_found",
      provider,
      message: "Veículo não localizado automaticamente. Confira a placa ou preencha manualmente.",
    };
  }

  return {
    status: "found",
    brand,
    model,
    version: readText(payload.versão) || readText(payload.VERSAO) || readText(payload.submodelo) || readText(payload.SUBMODELO) || undefined,
    year:
      readNumber(payload.anoModelo) ??
      readNumber(payload.ano_modelo) ??
      readNumber(payload.ano) ??
      readNumber(readNestedText(payload, "ano_modelo")),
    color: readText(payload.cor) || readText(payload.COR) || undefined,
    category: inferCategory(payload),
    provider,
    imageUrl: pickBestImage(payload),
  };
}

async function fetchJson(url: string, timeoutMs = 6500, extraHeaders?: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "TotalFlexOS/1.0",
        ...extraHeaders,
      },
    });
    const text = await response.text();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) {
      if (text.toLowerCase().includes("<html")) {
        return { _rawHtml: text } as ApiRecord;
      }
      return null;
    }
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as ApiRecord;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function lookupApiCarros(plate: string): Promise<ProviderResult> {
  const provider = "API-Carros público";
  
  const headers = {
    Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
    "Accept-Language": "pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7"
  };

  let payload = await fetchJson(`http://apicarros.com/v1/consulta/${plate}/json`, 6500, headers);
  
  if (payload && payload._rawHtml) {
    // Handling Cheq/Cloudflare style HTML redirects
    const html = payload._rawHtml as string;
    const redirectMatch = html.match(/URL=([^"]+)/i);
    if (redirectMatch && redirectMatch[1]) {
      const redirectUrl = redirectMatch[1].replace(/&amp;/g, "&");
      payload = await fetchJson(redirectUrl, 6500, headers);
    } else {
      return { status: "unavailable", provider, message: "Bloqueio de segurança ao consultar API-Carros." };
    }
  }

  if (!payload || payload._rawHtml) {
    return { status: "unavailable", provider, message: "API-Carros não respondeu com dados de veículo." };
  }
  
  if (readText(payload.codigoRetorno) && readText(payload.codigoRetorno) !== "0") {
    return {
      status: "not_found",
      provider,
      message: readText(payload.mensagemRetorno) || "Placa não localizada no API-Carros.",
    };
  }
  return mapPlatePayload(payload, provider);
}

async function lookupWdapi(plate: string): Promise<ProviderResult> {
  const provider = "WD API público";
  const payload = await fetchJson(`https://wdapi2.com.br/consulta/${plate}`, 5000);
  if (!payload || payload._rawHtml) {
    return { status: "unavailable", provider, message: "WD API não respondeu com dados." };
  }
  return mapPlatePayload(payload, provider);
}

async function lookupMasterPlaca(plate: string): Promise<ProviderResult> {
  const provider = "MasterPlaca público";
  const urls = [
    `https://api.masterplaca.devplank.com/v2/placa/${plate}/json`,
    `http://api.masterplaca.devplank.com/v2/placa/${plate}/json`,
  ];

  for (const url of urls) {
    const payload = await fetchJson(url, 5000);
    if (!payload) continue;
    return mapPlatePayload(payload, provider);
  }

  return { status: "unavailable", provider, message: "MasterPlaca não respondeu com dados de veículo." };
}

async function lookupWikimediaVehicleImage(brand: string, model: string, year?: number) {
  const query = [brand, model, year, "car"].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "6",
    gsrlimit: "5",
    prop: "imageinfo",
    iiprop: "url",
    iiurlwidth: "640",
    format: "json",
    origin: "*",
  });
  const payload = await fetchJson(`https://commons.wikimedia.org/w/api.php?${params.toString()}`, 6000);
  const pages = payload?.query && typeof payload.query === "object" ? (payload.query as ApiRecord).pages : undefined;
  if (!pages || typeof pages !== "object") return undefined;

  for (const page of Object.values(pages as ApiRecord)) {
    if (!page || typeof page !== "object") continue;
    const imageInfo = (page as ApiRecord).imageinfo;
    const first = Array.isArray(imageInfo) ? imageInfo[0] : undefined;
    if (!first || typeof first !== "object") continue;
    const thumbUrl = readText((first as ApiRecord).thumburl);
    const url = readText((first as ApiRecord).url);
    const imageUrl = thumbUrl || url;
    if (imageUrl.startsWith("https://upload.wikimedia.org/")) return imageUrl;
  }

  return undefined;
}

export async function GET(_request: Request, context: RouteContext) {
  const { plate: rawPlate } = await context.params;
  const plate = normalizePlate(rawPlate);

  if (!isLikelyPlate(plate)) {
    return NextResponse.json(
      {
        status: "not_found",
        provider: "Consulta veicular",
        message: "Placa inválida. Confira os 7 caracteres e tente novamente.",
      } satisfies VehicleLookupResult,
      { status: 400 },
    );
  }

  const lookupFns = [lookupApiCarros, lookupWdapi, lookupMasterPlaca];
  let lastNotFound: ProviderResult | undefined;

  for (const fn of lookupFns) {
    const attempt = await fn(plate);
    if (attempt.status === "found") {
      return NextResponse.json({
        ...attempt,
        imageUrl: attempt.imageUrl ?? (await lookupWikimediaVehicleImage(attempt.brand, attempt.model, attempt.year)),
      } satisfies VehicleLookupResult);
    }
    if (attempt.status === "not_found") {
      lastNotFound = attempt;
    }
  }

  if (lastNotFound) return NextResponse.json(lastNotFound satisfies VehicleLookupResult);

  return NextResponse.json({
    status: "unavailable",
    provider: "Consulta veicular gratuita",
    message: "As consultas gratuitas de placa não retornaram agora. Continue com cadastro manual.",
  } satisfies VehicleLookupResult);
}
