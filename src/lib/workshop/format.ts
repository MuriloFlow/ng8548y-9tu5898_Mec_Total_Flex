export const currencyFormatter = new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
});

export const dateFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
});

export const dateTimeFormatter = new Intl.DateTimeFormat("pt-BR", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function onlyDigits(value: string) {
  return value.replace(/\D/g, "");
}

export function normalizeCpf(value: string) {
  return onlyDigits(value).slice(0, 11);
}

export function formatCpf(value: string) {
  const digits = normalizeCpf(value);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/^(\d{3})\.(\d{3})\.(\d{3})(\d)/, "$1.$2.$3-$4");
}

export function isValidCpf(value: string) {
  const cpf = normalizeCpf(value);
  if (cpf.length !== 11 || /^(\d)\1{10}$/.test(cpf)) return false;

  const validateDigit = (factor: number) => {
    let total = 0;
    for (let index = 0; index < factor - 1; index += 1) {
      total += Number(cpf[index]) * (factor - index);
    }
    const rest = (total * 10) % 11;
    return rest === 10 ? 0 : rest;
  };

  return validateDigit(10) === Number(cpf[9]) && validateDigit(11) === Number(cpf[10]);
}

export function normalizePhone(value: string) {
  return onlyDigits(value).slice(0, 11);
}

export function formatPhone(value: string) {
  const digits = normalizePhone(value);
  if (digits.length <= 10) {
    return digits
      .replace(/^(\d{2})(\d)/, "($1) $2")
      .replace(/(\d{4})(\d)/, "$1-$2");
  }
  return digits
    .replace(/^(\d{2})(\d)/, "($1) $2")
    .replace(/(\d{5})(\d)/, "$1-$2");
}

export function normalizePlate(value: string) {
  return value
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 7);
}

export function formatPlate(value: string) {
  const plate = normalizePlate(value);
  if (plate.length <= 3) return plate;
  return `${plate.slice(0, 3)}-${plate.slice(3)}`;
}

export function isLikelyPlate(value: string) {
  const plate = normalizePlate(value);
  return /^[A-Z]{3}\d[A-Z0-9]\d{2}$/.test(plate) || /^[A-Z]{3}\d{4}$/.test(plate);
}

export function parseCurrencyInput(value: string) {
  if (!value) return 0;
  const hasComma = value.includes(',');
  const hasDot = value.includes('.');

  let normalized = value.replace(/[^\d,.-]/g, "");

  if (hasComma && hasDot) {
    // Both exist: e.g. "1.000,50" or "10.500,00"
    // Dot is thousands separator, comma is decimal
    normalized = normalized.replace(/\./g, "").replace(",", ".");
  } else if (hasComma) {
    // Only comma: "1000,50" → replace comma with dot
    normalized = normalized.replace(",", ".");
  } else if (hasDot) {
    // Only dot — figure out if it's decimal or thousands:
    // If ≤ 2 digits follow the dot, treat as decimal (e.g. "365.90" → 365.90)
    // If > 2 digits follow, treat as thousands separator (e.g. "1.000" → 1000)
    const lastDotIndex = normalized.lastIndexOf(".");
    const digitsAfter = normalized.length - lastDotIndex - 1;
    if (digitsAfter > 2) {
      normalized = normalized.replace(/\./g, "");
    }
    // Otherwise keep the dot as decimal separator (JS-native)
  }

  const parsed = Number.parseFloat(normalized);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function formatCurrency(value: number) {
  return currencyFormatter.format(Number.isFinite(value) ? value : 0);
}

export function formatDate(value?: string) {
  if (!value) return "Sem data";
  return dateFormatter.format(new Date(value));
}

export function formatDateTime(value?: string) {
  if (!value) return "Sem data";
  return dateTimeFormatter.format(new Date(value));
}

export function toDateTimeLocalValue(value?: string) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60_000);
  return local.toISOString().slice(0, 16);
}

export function fromDateTimeLocalValue(value: string) {
  if (!value) return undefined;
  return new Date(value).toISOString();
}

export function newId(prefix: string) {
  return `${prefix}_${crypto.randomUUID()}`;
}
