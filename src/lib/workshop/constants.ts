import type { DocumentType, OrderStatus, PaymentMethod, PaymentStatus, Priority, Role } from "./types";

export const ROLE_LABEL: Record<Role, string> = {
  admin: "Administrador",
  attendant: "Atendente",
  mechanic: "Mecânico",
};

export const ORDER_STATUS_LABEL: Record<OrderStatus, string> = {
  draft: "Rascunho",
  waiting_approval: "Aguardando aprovação",
  approved: "Aprovado",
  in_service: "Em serviço",
  waiting_parts: "Aguardando peça",
  finished: "Finalizado",
  delivered: "Entregue",
  cancelled: "Cancelado",
};

export const ORDER_STATUS_SEQUENCE: OrderStatus[] = [
  "draft",
  "waiting_approval",
  "approved",
  "in_service",
  "waiting_parts",
  "finished",
  "delivered",
];

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = {
  unpaid: "Pendente",
  partial: "Parcial",
  paid: "Pago",
  refunded: "Estornado",
  cancelled: "Cancelado",
};

export const PAYMENT_METHOD_LABEL: Record<PaymentMethod, string> = {
  pix: "Pix",
  cash: "Dinheiro",
  debit: "Débito",
  credit: "Crédito",
  transfer: "Transferência",
  other: "Outro",
};

export const PRIORITY_LABEL: Record<Priority, string> = {
  low: "Baixa",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente",
};

export const DOCUMENT_TYPE_LABEL: Record<DocumentType, string> = {
  service_order: "Ordem de Serviço",
  quote: "Orçamento",
  receipt: "Recibo",
  fiscal_receipt: "Recibo de Nota Fiscal",
};
