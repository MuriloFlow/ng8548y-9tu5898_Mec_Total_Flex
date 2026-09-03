import "server-only";
import { decryptCpf, encryptCpf } from "@/lib/crypto/sensitive";
import type { WorkshopState } from "./types";

export function encryptWorkshopStateForStorage(state: WorkshopState): WorkshopState {
  return {
    ...state,
    customers: state.customers.map((customer) => ({
      ...customer,
      cpf: encryptCpf(customer.cpf),
    })),
  };
}

export function decryptWorkshopStateFromStorage(state: WorkshopState): WorkshopState {
  return {
    ...state,
    customers: state.customers.map((customer) => ({
      ...customer,
      cpf: decryptCpf(customer.cpf),
    })),
  };
}
