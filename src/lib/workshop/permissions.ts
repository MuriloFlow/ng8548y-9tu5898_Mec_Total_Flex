import type { Role } from "./types";

export type Permission =
  | "customers:write"
  | "vehicles:write"
  | "orders:create"
  | "orders:update_execution"
  | "orders:approve"
  | "payments:write"
  | "documents:generate"
  | "catalog:write"
  | "reports:view"
  | "settings:write";

const rolePermissions: Record<Role, Permission[]> = {
  admin: [
    "customers:write",
    "vehicles:write",
    "orders:create",
    "orders:update_execution",
    "orders:approve",
    "payments:write",
    "documents:generate",
    "catalog:write",
    "reports:view",
    "settings:write",
  ],
  attendant: [
    "customers:write",
    "vehicles:write",
    "orders:create",
    "orders:approve",
    "payments:write",
    "documents:generate",
    "reports:view",
  ],
  mechanic: ["orders:update_execution", "documents:generate"],
};

export function hasPermission(role: Role, permission: Permission) {
  return rolePermissions[role].includes(permission);
}
