import { z } from "zod";
import { isLikelyPlate, isValidCpf, normalizeCpf, normalizePhone, normalizePlate } from "./format";

const emptyToUndefined = (value: unknown) => (value === "" || value === null ? undefined : value);
const nextVehicleYear = new Date().getFullYear() + 1;

export const cpfSchema = z
  .string()
  .transform(normalizeCpf)
  .refine((value) => value.length === 11, "Informe os 11 dígitos do CPF.")
  .refine(isValidCpf, "CPF inválido.");

export const customerSchema = z
  .object({
    cpf: cpfSchema,
    name: z.string().trim().min(3, "Informe o nome completo."),
    phone: z
      .string()
      .transform(normalizePhone)
      .refine((value) => value.length >= 10, "Informe um telefone válido."),
    email: z.string().trim().email("E-mail inválido.").optional().or(z.literal("")),
    noEmail: z.boolean(),
    address: z.string().trim().optional(),
    district: z.string().trim().optional(),
  })
  .refine((value) => value.noEmail || Boolean(value.email), {
    message: "Informe um e-mail ou marque que o cliente não possui e-mail.",
    path: ["email"],
  });

export const vehicleSchema = z.object({
  plate: z
    .string()
    .transform(normalizePlate)
    .refine((value) => value.length === 7 && isLikelyPlate(value), "Placa inválida."),
  brand: z.string().trim().min(2, "Informe a marca."),
  model: z.string().trim().min(2, "Informe o modelo."),
  version: z.string().trim().optional(),
  year: z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ error: "Informe um ano válido." })
      .int("Informe um ano sem casas decimais.")
      .min(1950, "Informe um ano a partir de 1950.")
      .max(nextVehicleYear, `Informe um ano até ${nextVehicleYear}.`)
      .optional(),
  ),
  color: z.string().trim().optional(),
  category: z.enum(["car", "motorcycle", "truck", "van", "other"]),
});

export const orderDraftSchema = z.object({
  currentMileage: z.preprocess(
    emptyToUndefined,
    z.coerce.number().int("Informe a quilometragem sem casas decimais.").min(0, "Quilometragem inválida.").optional(),
  ),
  fuelLevel: z.preprocess(emptyToUndefined, z.coerce.number().min(0, "Combustível inválido.").max(100, "Combustível inválido.").optional()),
  entryState: z.string().trim().optional(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  mechanicId: z.string().optional(),
  estimatedDeliveryAt: z.string().optional(),
  customerNotes: z.string().trim().optional(),
  internalNotes: z.string().trim().optional(),
});

export const orderItemSchema = z.object({
  type: z.enum(["service", "part", "custom"]),
  catalogId: z.string().optional(),
  description: z.string().trim().min(2, "Informe a descrição."),
  quantity: z.coerce.number().positive("Quantidade precisa ser maior que zero."),
  unitPrice: z.coerce.number().min(0, "Preço inválido."),
  laborPrice: z.coerce.number().min(0, "Mão de obra inválida."),
  discount: z.coerce.number().min(0, "Desconto inválido."),
  cost: z.coerce.number().min(0, "Custo inválido."),
  notes: z.string().trim().optional(),
  doneAt: z.string().optional(),
  doneBy: z.string().optional(),
  sortOrder: z.coerce.number().int().min(0).optional(),
});

export const paymentSchema = z.object({
  method: z.enum(["pix", "cash", "debit", "credit", "transfer", "other"]),
  amount: z.coerce.number().positive("Informe um valor maior que zero."),
  reference: z.string().trim().optional(),
});

export const catalogServiceSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome do serviço."),
  description: z.string().trim().optional(),
  internalCode: z.string().trim().optional(),
  defaultPrice: z.coerce.number().min(0),
  defaultLabor: z.coerce.number().min(0),
  cost: z.coerce.number().min(0),
  estimatedMinutes: z.coerce.number().int().min(0),
  category: z.string().trim().min(2, "Informe a categoria."),
  status: z.enum(["active", "inactive"]),
});

export const catalogProductSchema = z.object({
  name: z.string().trim().min(2, "Informe o nome da peça."),
  description: z.string().trim().optional(),
  sku: z.string().trim().min(2, "Informe o SKU."),
  defaultPrice: z.coerce.number().min(0),
  cost: z.coerce.number().min(0),
  stockQuantity: z.coerce.number().int().min(0),
  category: z.string().trim().min(2, "Informe a categoria."),
  status: z.enum(["active", "inactive"]),
});
