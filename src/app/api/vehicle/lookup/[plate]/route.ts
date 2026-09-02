import { NextResponse } from "next/server";
import { isLikelyPlate, normalizePlate } from "@/lib/workshop/format";
import { localImageForCategory } from "@/lib/workshop/vehicle-image";
import type { Vehicle, VehicleLookupResult } from "@/lib/workshop/types";

type RouteContext = {
  params: Promise<{ plate: string }>;
};

type ApiRecord = Record<string, unknown>;
type ProviderResult = VehicleLookupResult & { provider: string };

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function readText(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function readNumber(value: unknown) {
  const parsed = Number.parseInt(readText(value).replace(/\D/g, ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function readNested(payload: ApiRecord, ...keys: string[]) {
  let current: unknown = payload;
  for (const key of keys) {
    if (!current || typeof current !== "object") return "";
    current = (current as ApiRecord)[key];
  }
  return readText(current);
}

function inferCategory(payload: ApiRecord, brand: string, model: string): Vehicle["category"] {
  const text = [
    readText(payload.tipo),
    readText(payload.tipo_veiculo),
    readText(payload.segmento),
    readText(payload.especie),
    readText(payload.vehicleType),
    readNested(payload, "extra", "tipo_veiculo"),
    readNested(payload, "extra", "segmento"),
    brand,
    model,
  ]
    .join(" ")
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();

  if (text.includes("moto") || text.includes("motocic")) return "motorcycle";
  if (text.includes("caminh") || text.includes("truck") || text.includes("onibus")) return "truck";
  if (text.includes("van") || text.includes("utilit") || text.includes("furg")) return "van";
  return "car";
}

function cleanBrandModel(brandValue: string, modelValue: string) {
  const composite = modelValue || brandValue;
  const slashParts = composite.includes("/") ? composite.split("/").map((part) => part.trim()) : [];
  let brand = brandValue;
  let model = modelValue;

  if (slashParts.length >= 2) {
    brand = slashParts[0] || brandValue;
    model = slashParts.slice(1).join(" ") || modelValue;
  } else if (brand && model.toLowerCase().startsWith(`${brand.toLowerCase()} `)) {
    model = model.slice(brand.length).trim();
  } else if (!brand && composite) {
    brand = composite.split(" ")[0] ?? composite;
    model = composite.split(" ").slice(1).join(" ") || composite;
  }

  return { brand: brand.trim(), model: model.trim() };
}

function buildFound(payload: ApiRecord, provider: string): ProviderResult {
  const rawBrand =
    readText(payload.marca) ||
    readText(payload.MARCA) ||
    readText(payload.brand) ||
    readText(payload.fabricante) ||
    readNested(payload, "extra", "marca");

  const rawModel =
    readText(payload.modelo) ||
    readText(payload.MODELO) ||
    readText(payload.model) ||
    readText(payload.marcaModelo) ||
    readText(payload.modeloMarca) ||
    readNested(payload, "extra", "modelo");

  const { brand, model } = cleanBrandModel(rawBrand, rawModel);

  if (!brand && !model) {
    return {
      status: "not_found",
      provider,
      message: "Placa não localizada. Preencha marca e modelo manualmente.",
    };
  }

  const category = inferCategory(payload, brand, model);
  const year =
    readNumber(payload.anoModelo) ??
    readNumber(payload.ano_modelo) ??
    readNumber(payload.modelYear) ??
    readNumber(payload.model_year) ??
    readNumber(payload.ano);

  return {
    status: "found",
    brand: brand || model.split(" ")[0] || "Marca",
    model: model || brand || "Modelo",
    version:
      readText(payload.versão) ||
      readText(payload.VERSAO) ||
      readText(payload.submodelo) ||
      readText(payload.SUBMODELO) ||
      undefined,
    year: year ?? readNumber(payload.anoFabricacao) ?? readNumber(payload.manufacturingYear),
    color: readText(payload.cor) || readText(payload.COR) || readText(payload.color) || undefined,
    category,
    provider,
    imageUrl: localImageForCategory(category),
  };
}

async function fetchJson(url: string, timeoutMs = 8000, extraHeaders?: Record<string, string>) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      cache: "no-store",
      signal: controller.signal,
      headers: {
        Accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
        "User-Agent": "TotalFlexOS/1.0 (+consulta veicular interna)",
        ...extraHeaders,
      },
    });

    if (!response.ok) return null;
    const text = await response.text();
    const jsonStart = text.indexOf("{");
    const jsonEnd = text.lastIndexOf("}");
    if (jsonStart < 0 || jsonEnd <= jsonStart) return null;
    return JSON.parse(text.slice(jsonStart, jsonEnd + 1)) as ApiRecord;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

function randomGeolocation() {
  const lat = (-23.5 + Math.random() * 2).toFixed(6);
  const lng = (-46.6 + Math.random() * 2).toFixed(6);
  return `${lng},${lat}`;
}

async function lookupSinespCidadao(plate: string): Promise<ProviderResult> {
  const provider = "SINESP Cidadão";
  const payload = await fetchJson(`https://cidadao2.sinesp.gov.br/api/vehicles/${plate}`, 9000, {
    accept: "application/json",
    geolocation: randomGeolocation(),
    geolocationtimestamp: new Date().toISOString(),
    geolocationaccuracy: "20",
    adsid: crypto.randomUUID(),
    Host: "cidadao2.sinesp.gov.br",
    "User-Agent":
      "Mozilla/5.0 (Linux; Android 13; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36",
  });

  if (!payload) {
    return { status: "unavailable", provider, message: "SINESP indisponível no momento." };
  }

  if (payload.error || payload.message) {
    const message = readText(payload.message) || readText(payload.error);
    if (message.toLowerCase().includes("nao encontr") || message.toLowerCase().includes("não encontr")) {
      return { status: "not_found", provider, message: "Placa não encontrada no SINESP." };
    }
  }

  const mapped = buildFound(
    {
      marca: payload.brand ?? payload.marca ?? payload.fabricante,
      modelo: payload.model ?? payload.modelo ?? payload.modeloMarca,
      cor: payload.color ?? payload.cor,
      anoModelo: payload.modelYear ?? payload.anoModelo ?? payload.model_year,
      ano: payload.year ?? payload.ano ?? payload.manufacturingYear,
      tipo_veiculo: payload.vehicleType ?? payload.tipo,
      ...payload,
    },
    provider,
  );

  return mapped.status === "found" ? mapped : { status: "not_found", provider, message: "Placa não encontrada no SINESP." };
}

async function lookupApiCarros(plate: string): Promise<ProviderResult> {
  const provider = "API Carros";
  const payload = await fetchJson(`https://apicarros.com/v1/consulta/${plate}/json`, 8000, {
    Accept: "application/json",
    Referer: "https://apicarros.com/",
  });

  if (!payload) {
    return { status: "unavailable", provider, message: "API Carros indisponível." };
  }

  const code = readText(payload.codigoRetorno);
  if (code && code !== "0") {
    return {
      status: "not_found",
      provider,
      message: readText(payload.mensagemRetorno) || "Placa não localizada na API Carros.",
    };
  }

  return buildFound(payload, provider);
}

async function lookupWdapi(plate: string): Promise<ProviderResult> {
  const provider = "WD API";
  const payload = await fetchJson(`https://wdapi2.com.br/consulta/${plate}/json`, 7000);
  if (!payload) return { status: "unavailable", provider, message: "WD API indisponível." };
  return buildFound(payload, provider);
}

async function lookupMasterPlaca(plate: string): Promise<ProviderResult> {
  const provider = "MasterPlaca";
  const urls = [
    `https://api.masterplaca.devplank.com/v2/placa/${plate}/json`,
    `http://api.masterplaca.devplank.com/v2/placa/${plate}/json`,
  ];

  for (const url of urls) {
    const payload = await fetchJson(url, 6000);
    if (payload) return buildFound(payload, provider);
  }

  return { status: "unavailable", provider, message: "MasterPlaca indisponível." };
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

  const providers = [lookupSinespCidadao, lookupApiCarros, lookupWdapi, lookupMasterPlaca];
  let lastNotFound: ProviderResult | undefined;

  for (const lookup of providers) {
    const attempt = await lookup(plate);
    if (attempt.status === "found") {
      return NextResponse.json({
        ...attempt,
        imageUrl: localImageForCategory(attempt.category ?? "car"),
      } satisfies VehicleLookupResult);
    }
    if (attempt.status === "not_found") lastNotFound = attempt;
  }

  if (lastNotFound) return NextResponse.json(lastNotFound satisfies VehicleLookupResult);

  return NextResponse.json({
    status: "unavailable",
    provider: "Consulta veicular gratuita",
    message: "Consulta automática indisponível agora. Continue com cadastro manual.",
  } satisfies VehicleLookupResult);
}
