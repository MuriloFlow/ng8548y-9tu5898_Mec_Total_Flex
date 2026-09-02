import type {
  Customer,
  OrderItem,
  OrderTotals,
  Payment,
  ServiceOrder,
  Vehicle,
  WorkshopState,
} from "./types";
import { normalizeCpf, normalizePhone, normalizePlate } from "./format";

export function getCustomer(state: WorkshopState, customerId?: string) {
  return state.customers.find((customer) => customer.id === customerId && !customer.deletedAt);
}

export function getVehicle(state: WorkshopState, vehicleId?: string) {
  return state.vehicles.find((vehicle) => vehicle.id === vehicleId && !vehicle.deletedAt);
}

export function getEmployeeName(state: WorkshopState, employeeId?: string) {
  return state.employees.find((employee) => employee.id === employeeId)?.name ?? "Não definido";
}

export function isFinalLaborItem(item: OrderItem) {
  return item.description.trim().toLowerCase() === "mao de obra";
}

export function getOrderItems(state: WorkshopState, orderId: string) {
  return state.orderItems.filter((item) => item.orderId === orderId && !isFinalLaborItem(item));
}

export function getOrderPayments(state: WorkshopState, orderId: string) {
  return state.payments.filter((payment) => payment.orderId === orderId && payment.status === "confirmed");
}

export function getFinalLaborAmount(state: WorkshopState, orderId: string) {
  const order = state.orders.find((item) => item.id === orderId);
  if (typeof order?.finalLaborAmount === "number") return Math.max(0, order.finalLaborAmount);
  return state.orderItems
    .filter((item) => item.orderId === orderId && isFinalLaborItem(item))
    .reduce((total, item) => total + item.laborPrice * item.quantity, 0);
}

export function calculateItemsTotals(items: OrderItem[], payments: Payment[] = [], finalLaborAmount = 0): OrderTotals {
  const subtotalParts = items.reduce((total, item) => total + item.unitPrice * item.quantity, 0);
  const subtotalLabor = items.reduce((total, item) => total + item.laborPrice * item.quantity, 0) + finalLaborAmount;
  const discount = items.reduce((total, item) => total + item.discount, 0);
  const paid = payments.reduce((total, payment) => total + payment.amount, 0);
  const total = Math.max(0, subtotalParts + subtotalLabor - discount);

  return {
    subtotalParts,
    subtotalLabor,
    discount,
    total,
    paid,
    balance: Math.max(0, total - paid),
  };
}

export function getOrderTotals(state: WorkshopState, orderId: string) {
  return calculateItemsTotals(getOrderItems(state, orderId), getOrderPayments(state, orderId), getFinalLaborAmount(state, orderId));
}

export function getOrdersForCustomer(state: WorkshopState, customerId: string) {
  return state.orders
    .filter((order) => order.customerId === customerId && !order.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getOrdersForVehicle(state: WorkshopState, vehicleId: string) {
  return state.orders
    .filter((order) => order.vehicleId === vehicleId && !order.deletedAt)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function getVehiclesForCustomer(state: WorkshopState, customerId: string) {
  return state.vehicles
    .filter((vehicle) => vehicle.customerId === customerId && !vehicle.deletedAt)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function findCustomerByCpf(state: WorkshopState, cpf: string) {
  const normalized = normalizeCpf(cpf);
  return state.customers.find((customer) => customer.cpf === normalized && !customer.deletedAt);
}

export function findVehicleByPlate(state: WorkshopState, plate: string) {
  const normalized = normalizePlate(plate);
  return state.vehicles.find((vehicle) => vehicle.plate === normalized && !vehicle.deletedAt);
}

export function nextOrderNumber(state: WorkshopState) {
  const year = new Date().getFullYear();
  const sequence = state.orders.reduce((current, order) => {
    const match = order.number.match(/OS-\d{4}-(\d+)/);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `OS-${year}-${String(sequence + 1).padStart(4, "0")}`;
}

export type GlobalSearchResult =
  | { type: "customer"; label: string; detail: string; customer: Customer }
  | { type: "vehicle"; label: string; detail: string; vehicle: Vehicle; customer?: Customer }
  | {
      type: "order";
      label: string;
      detail: string;
      order: ServiceOrder;
      customer?: Customer;
      vehicle?: Vehicle;
    };

export function globalSearch(state: WorkshopState, query: string): GlobalSearchResult[] {
  const text = query.trim().toLowerCase();
  const cpf = normalizeCpf(query);
  const phone = normalizePhone(query);
  const plate = normalizePlate(query);
  if (!text && !cpf && !phone && !plate) return [];

  const customerResults = state.customers
    .filter((customer) => {
      const name = customer.name.toLowerCase();
      return (
        !customer.deletedAt &&
        (name.includes(text) ||
          customer.cpf.includes(cpf) ||
          customer.phone.includes(phone) ||
          Boolean(customer.email?.toLowerCase().includes(text)))
      );
    })
    .map<GlobalSearchResult>((customer) => ({
      type: "customer",
      label: customer.name,
      detail: `CPF ${customer.cpf} · ${customer.phone}`,
      customer,
    }));

  const vehicleResults = state.vehicles
    .filter((vehicle) => {
      const search = `${vehicle.brand} ${vehicle.model} ${vehicle.version ?? ""} ${vehicle.color ?? ""}`.toLowerCase();
      return !vehicle.deletedAt && (vehicle.plate.includes(plate) || search.includes(text));
    })
    .map<GlobalSearchResult>((vehicle) => ({
      type: "vehicle",
      label: `${vehicle.brand} ${vehicle.model}`,
      detail: `${vehicle.plate} · ${vehicle.year ?? "Ano não informado"}`,
      vehicle,
      customer: getCustomer(state, vehicle.customerId),
    }));

  const orderResults = state.orders
    .filter((order) => {
      const vehicle = getVehicle(state, order.vehicleId);
      return (
        !order.deletedAt &&
        (order.number.toLowerCase().includes(text) ||
          Boolean(vehicle?.plate.includes(plate)) ||
          Boolean(order.diagnosis?.toLowerCase().includes(text)))
      );
    })
    .map<GlobalSearchResult>((order) => ({
      type: "order",
      label: order.number,
      detail: `${order.status} · ${order.paymentStatus}`,
      order,
      customer: getCustomer(state, order.customerId),
      vehicle: getVehicle(state, order.vehicleId),
    }));

  return [...customerResults, ...vehicleResults, ...orderResults].slice(0, 12);
}
