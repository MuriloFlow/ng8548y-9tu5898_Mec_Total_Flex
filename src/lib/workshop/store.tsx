"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import { ORDER_STATUS_SEQUENCE } from "./constants";
import { newId } from "./format";
import { hasPermission, type Permission } from "./permissions";
import { createSeedState } from "./seed";
import {
  calculateItemsTotals,
  findCustomerByCpf,
  findVehicleByPlate,
  getOrderItems,
  getOrderPayments,
  getOrderTotals,
  nextOrderNumber,
} from "./selectors";
import type {
  AuditAction,
  CatalogProduct,
  CatalogService,
  Customer,
  DocumentRecord,
  DocumentType,
  InspectionStatus,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentMethod,
  QuoteRevision,
  ServiceOrder,
  Vehicle,
  VehicleLookupResult,
  WorkshopState,
} from "./types";
import {
  catalogProductSchema,
  catalogServiceSchema,
  customerSchema,
  orderDraftSchema,
  orderItemSchema,
  paymentSchema,
  vehicleSchema,
} from "./validation";

const STORAGE_KEY = "total-flex-workshop-state-v2";
const AUTH_KEY = "total-flex-auth-user-v1";

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "local_only";

type StoreSnapshot = {
  state: WorkshopState | null;
  currentUserId: string | null;
  ready: boolean;
  syncStatus: SyncStatus;
};

const serverSnapshot: StoreSnapshot = {
  state: null,
  currentUserId: null,
  ready: false,
  syncStatus: "idle",
};

let snapshot: StoreSnapshot = serverSnapshot;
let initialized = false;
let remoteLoadStarted = false;
const listeners = new Set<() => void>();

type StoreContextValue = {
  state: WorkshopState | null;
  ready: boolean;
  syncStatus: SyncStatus;
  currentUser: WorkshopState["users"][number] | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  resetDemoData: () => void;
  forceSync: () => Promise<void>;
  createOrUpdateCustomer: (
    input: {
      cpf: string;
      name: string;
      phone: string;
      email?: string;
      noEmail: boolean;
      address?: string;
      district?: string;
    },
  ) => { customer: Customer; created: boolean };
  createOrUpdateVehicle: (
    customerId: string,
    input: {
      plate: string;
      brand: string;
      model: string;
      version?: string;
      year?: number;
      color?: string;
      category: Vehicle["category"];
    },
    lookup?: VehicleLookupResult,
  ) => { vehicle: Vehicle; created: boolean };
  createOrder: (
    customerId: string,
    vehicleId: string,
    input: {
      currentMileage?: number;
      fuelLevel?: number;
      entryState?: string;
      priority: ServiceOrder["priority"];
      mechanicId?: string;
      estimatedDeliveryAt?: string;
      customerNotes?: string;
      internalNotes?: string;
    },
    idempotencyKey: string,
  ) => ServiceOrder;
  updateOrder: (orderId: string, patch: Partial<ServiceOrder>, action?: AuditAction) => ServiceOrder;
  advanceOrderStatus: (orderId: string, status?: OrderStatus) => ServiceOrder;
  upsertInspectionItem: (orderId: string, itemId: string, status: InspectionStatus, notes?: string) => void;
  addPhoto: (orderId: string, dataUrl: string, label: string) => void;
  removePhoto: (photoId: string) => void;
  addOrderItem: (orderId: string, input: Omit<OrderItem, "id" | "orderId" | "createdAt" | "updatedAt">) => OrderItem;
  updateOrderItem: (itemId: string, patch: Partial<Omit<OrderItem, "id" | "orderId" | "createdAt" | "updatedAt">>) => OrderItem;
  toggleOrderItemDone: (itemId: string, done: boolean) => void;
  removeOrderItem: (itemId: string) => void;
  createQuoteRevision: (orderId: string, status: QuoteRevision["status"]) => QuoteRevision;
  approveQuoteRevision: (revisionId: string) => QuoteRevision;
  recordPayment: (
    orderId: string,
    input: { method: PaymentMethod; amount: number; reference?: string },
    idempotencyKey: string,
  ) => Payment;
  generateDocument: (orderId: string, type: DocumentType, idempotencyKey: string) => DocumentRecord;
  finishService: (orderId: string, input: { finalAmount: number; mechanicSignatureDataUrl?: string; userChangedAmount?: boolean }, idempotencyKey: string) => DocumentRecord;
  addCatalogService: (input: Omit<CatalogService, "id" | "createdAt" | "updatedAt">) => CatalogService;
  addCatalogProduct: (input: Omit<CatalogProduct, "id" | "createdAt" | "updatedAt">) => CatalogProduct;
};

const StoreContext = createContext<StoreContextValue | null>(null);

function cloneState(state: WorkshopState): WorkshopState {
  return structuredClone(state);
}

function readStoredState() {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSeedState();
    return JSON.parse(raw) as WorkshopState;
  } catch {
    return createSeedState();
  }
}

function emitStoreChange() {
  listeners.forEach((listener) => listener());
}

function getClientSnapshot() {
  if (typeof window === "undefined") return serverSnapshot;

  if (!initialized) {
    snapshot = {
      state: readStoredState(),
      currentUserId: window.localStorage.getItem(AUTH_KEY),
      ready: true,
      syncStatus: "idle",
    };
    initialized = true;
  }

  return snapshot;
}

function subscribeStore(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setWorkshopSnapshot(next: StoreSnapshot) {
  snapshot = next;
  if (typeof window !== "undefined") {
    if (next.state) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next.state));
    if (next.currentUserId) window.localStorage.setItem(AUTH_KEY, next.currentUserId);
    else window.localStorage.removeItem(AUTH_KEY);
  }
  emitStoreChange();
}

let syncRetryCount = 0;
let lastSyncTime = 0;
const MAX_SYNC_RETRIES = 3;
const MIN_SYNC_INTERVAL = 3000; // Don't sync more than once every 3 seconds

async function syncToSupabase(state: WorkshopState): Promise<SyncStatus> {
  // Prevent rapid-fire syncs
  const now = Date.now();
  if (now - lastSyncTime < MIN_SYNC_INTERVAL) {
    return "synced";
  }
  lastSyncTime = now;

  try {
    const response = await fetch("/api/workshop/sync", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ state }),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
      if (body?.reason === "table_missing") {
        console.warn("[TF] Tabela não existe. Tentando auto-setup...");
        // Try to auto-create the table
        const setupResponse = await fetch("/api/workshop/setup", { method: "POST" });
        const setupBody = await setupResponse.json().catch(() => ({}));
        if (setupBody?.ok) {
          // Table created, retry sync
          const retryResponse = await fetch("/api/workshop/sync", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ state }),
          });
          if (retryResponse.ok) return "synced";
        }
        return "local_only";
      }
      throw new Error(`Sync failed: ${response.status}`);
    }

    syncRetryCount = 0;
    return "synced";
  } catch (err) {
    syncRetryCount++;
    if (syncRetryCount < MAX_SYNC_RETRIES) {
      await new Promise((resolve) => setTimeout(resolve, 1000 * syncRetryCount));
      return syncToSupabase(state);
    }
    console.error("[TF] Sync failed after retries:", err);
    return "error";
  }
}

function setWorkshopState(nextState: WorkshopState) {
  const current = getClientSnapshot();
  setWorkshopSnapshot({ ...current, state: nextState, ready: true });
}

function setAuthenticatedUser(userId: string | null) {
  const current = getClientSnapshot();
  setWorkshopSnapshot({ ...current, currentUserId: userId, ready: true });
}

function pushAudit(
  state: WorkshopState,
  userId: string,
  entityType: string,
  entityId: string,
  action: AuditAction,
  summary: string,
  before?: unknown,
  after?: unknown,
) {
  state.auditEvents.unshift({
    id: newId("audit"),
    entityType,
    entityId,
    action,
    userId,
    before,
    after,
    occurredAt: new Date().toISOString(),
    summary,
  });
  state.auditEvents = state.auditEvents.slice(0, 150);
}

function updatePaymentStatus(state: WorkshopState, orderId: string) {
  const order = state.orders.find((item) => item.id === orderId);
  if (!order) return;
  const totals = getOrderTotals(state, orderId);
  order.paymentStatus = totals.total <= 0 ? "unpaid" : totals.balance === 0 ? "paid" : totals.paid > 0 ? "partial" : "unpaid";
  order.updatedAt = new Date().toISOString();
  order.version += 1;
}

function ensurePermission(currentUser: StoreContextValue["currentUser"], permission: Permission) {
  if (!currentUser || !hasPermission(currentUser.role, permission)) {
    throw new Error("Seu perfil não tem permissão para esta ação.");
  }
}

export function WorkshopProvider({ children }: { children: ReactNode }) {
  const { state, currentUserId, ready } = useSyncExternalStore(subscribeStore, getClientSnapshot, () => serverSnapshot);

  // ─────────────────────────────────────────────────────────────
  // Hydrate from Supabase on first load
  // Always tries remote first, falls back to localStorage
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !state || remoteLoadStarted) return;
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL) {
      // No Supabase configured — mark as local only
      setWorkshopSnapshot({ ...snapshot, syncStatus: "local_only" });
      return;
    }
    remoteLoadStarted = true;

    setWorkshopSnapshot({ ...snapshot, syncStatus: "syncing" });

    void (async () => {
      try {
        // Step 1: Check if table exists, auto-create if not
        const setupRes = await fetch("/api/workshop/setup", { method: "POST" });
        const setupBody = await setupRes.json().catch(() => ({}));

        if (!setupBody?.ok && setupBody?.error === "table_missing") {
          // Table couldn't be auto-created — user needs to run SQL manually
          setWorkshopSnapshot({ ...snapshot, syncStatus: "local_only" });
          return;
        }

        // Step 2: Load state from Supabase
        const syncRes = await fetch("/api/workshop/sync");
        if (!syncRes.ok) {
          setWorkshopSnapshot({ ...snapshot, syncStatus: "error" });
          return;
        }

        const syncBody = (await syncRes.json()) as {
          state?: WorkshopState | null;
          updatedAt?: string | null;
          source?: string;
        };

        if (!syncBody.state?.updatedAt) {
          // Supabase is empty — push local state to it
          setWorkshopSnapshot({ ...snapshot, syncStatus: "syncing" });
          const pushResult = await syncToSupabase(state);
          setWorkshopSnapshot({ ...snapshot, syncStatus: pushResult });
          return;
        }

        // Step 3: Compare timestamps — use the newer one
        const remoteTime = new Date(syncBody.state.updatedAt).getTime();
        const localTime = new Date(state.updatedAt).getTime();

        if (remoteTime > localTime) {
          // Remote is newer — use it and update localStorage cache
          setWorkshopSnapshot({ ...snapshot, state: syncBody.state, syncStatus: "synced" });
        } else if (localTime > remoteTime) {
          // Local is newer — push to Supabase
          setWorkshopSnapshot({ ...snapshot, syncStatus: "syncing" });
          const pushResult = await syncToSupabase(state);
          setWorkshopSnapshot({ ...snapshot, syncStatus: pushResult });
        } else {
          // Same timestamp — already in sync
          setWorkshopSnapshot({ ...snapshot, syncStatus: "synced" });
        }
      } catch (err) {
        console.error("[TF] Hydration failed:", err);
        setWorkshopSnapshot({ ...snapshot, syncStatus: "error" });
      }
    })();
  }, [ready, state]);

  // ─────────────────────────────────────────────────────────────
  // Sync to Supabase after every change (debounced)
  // ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!ready || !state || !process.env.NEXT_PUBLIC_SUPABASE_URL) return;
    if (snapshot.syncStatus === "local_only") return; // Don't try if table doesn't exist

    const timeout = window.setTimeout(() => {
      setWorkshopSnapshot({ ...snapshot, syncStatus: "syncing" });
      void syncToSupabase(state).then((status) => {
        setWorkshopSnapshot({ ...snapshot, syncStatus: status });
      });
    }, 500);

    return () => window.clearTimeout(timeout);
  }, [ready, state]);

  // ─────────────────────────────────────────────────────────────
  // Manual force sync
  // ─────────────────────────────────────────────────────────────
  const forceSync = useCallback(async () => {
    if (!state) return;
    setWorkshopSnapshot({ ...snapshot, syncStatus: "syncing" });
    const status = await syncToSupabase(state);
    setWorkshopSnapshot({ ...snapshot, syncStatus: status });
    if (status === "synced") {
      toast.success("Dados sincronizados com sucesso!");
    } else if (status === "local_only") {
      toast.error("Tabela não encontrada no Supabase. Execute o SQL manualmente.");
    } else {
      toast.error("Erro ao sincronizar. Verifique a conexão.");
    }
  }, [state, snapshot]);

  const currentUser = useMemo(() => {
    if (!state || !currentUserId) return null;
    return state.users.find((user) => user.id === currentUserId && user.active) ?? null;
  }, [currentUserId, state]);

  const commit = useCallback(
    <T,>(producer: (draft: WorkshopState, userId: string) => T) => {
      if (!state) throw new Error("Base de dados ainda não carregada.");
      const userId = currentUser?.id ?? state.users[0]?.id;
      if (!userId) throw new Error("Usuário não identificado.");

      const draft = cloneState(state);
      const result = producer(draft, userId);
      draft.updatedAt = new Date().toISOString();
      setWorkshopState(draft);
      return result;
    },
    [currentUser?.id, state],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (!state) return false;
      const normalized = username.trim().toLowerCase();
      let user = state.users.find((item) => item.username === normalized && item.active);
      const isSeedPassword = normalized === "totalflex" && password === "1234";
      let remoteAccepted = false;

      try {
        const response = await fetch("/api/auth/login", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ username: normalized, password }),
        });

        if (response.ok) {
          remoteAccepted = true;
          const payload = (await response.json()) as {
            user?: { id: string; username: string; displayName: string; role: "admin" | "attendant" | "mechanic"; employeeId?: string };
          };

          if (payload.user) {
            user = {
              id: payload.user.id,
              username: payload.user.username,
              displayName: payload.user.displayName,
              role: payload.user.role,
              active: true,
              employeeId: payload.user.employeeId,
              createdAt: new Date().toISOString(),
            };
            const current = getClientSnapshot().state;
            if (current) {
              const next = cloneState(current);
              const index = next.users.findIndex((item) => item.id === user?.id);
              if (index >= 0 && user) next.users[index] = user;
              if (index < 0 && user) next.users.push(user);
              setWorkshopState(next);
            }
          }
        }
      } catch {
        // Development without Supabase credentials falls back to the seeded local user.
      }

      if (!user || (!remoteAccepted && !isSeedPassword)) {
        toast.error("Usuário ou senha inválidos.");
        return false;
      }

      setAuthenticatedUser(user.id);
      toast.success("Login realizado.");
      return true;
    },
    [state],
  );

  const logout = useCallback(() => {
    setAuthenticatedUser(null);
  }, []);

  const can = useCallback(
    (permission: Permission) => Boolean(currentUser && hasPermission(currentUser.role, permission)),
    [currentUser],
  );

  const resetDemoData = useCallback(() => {
    const next = createSeedState();
    setWorkshopState(next);
    toast.success("Base local restaurada.");
  }, []);

  const createOrUpdateCustomer: StoreContextValue["createOrUpdateCustomer"] = useCallback(
    (input) => {
      ensurePermission(currentUser, "customers:write");
      const parsed = customerSchema.parse(input);

      return commit((draft, userId) => {
        const existing = findCustomerByCpf(draft, parsed.cpf);
        const now = new Date().toISOString();

        if (existing) {
          const before = cloneState(draft).customers.find((customer) => customer.id === existing.id);
          Object.assign(existing, {
            name: parsed.name,
            phone: parsed.phone,
            email: parsed.noEmail ? "" : parsed.email,
            noEmail: parsed.noEmail,
            address: parsed.address,
            district: parsed.district,
            updatedAt: now,
          });
          pushAudit(draft, userId, "customer", existing.id, "updated", `Cliente ${existing.name} atualizado.`, before, existing);
          return { customer: existing, created: false };
        }

        const customer: Customer = {
          id: newId("customer"),
          cpf: parsed.cpf,
          name: parsed.name,
          phone: parsed.phone,
          email: parsed.noEmail ? "" : parsed.email,
          noEmail: parsed.noEmail,
          address: parsed.address,
          district: parsed.district,
          createdAt: now,
          updatedAt: now,
        };
        draft.customers.unshift(customer);
        pushAudit(draft, userId, "customer", customer.id, "created", `Cliente ${customer.name} criado.`, undefined, customer);
        return { customer, created: true };
      });
    },
    [commit, currentUser],
  );

  const createOrUpdateVehicle: StoreContextValue["createOrUpdateVehicle"] = useCallback(
    (customerId, input, lookup) => {
      ensurePermission(currentUser, "vehicles:write");
      const parsed = vehicleSchema.parse(input);

      return commit((draft, userId) => {
        const customer = draft.customers.find((item) => item.id === customerId && !item.deletedAt);
        if (!customer) throw new Error("Cliente não encontrado.");

        const duplicate = findVehicleByPlate(draft, parsed.plate);
        if (duplicate && duplicate.customerId !== customerId) {
          throw new Error("Essa placa já está vinculada a outro cliente.");
        }

        const now = new Date().toISOString();
        if (duplicate) {
          const before = cloneState(draft).vehicles.find((vehicle) => vehicle.id === duplicate.id);
          Object.assign(duplicate, {
            brand: parsed.brand,
            model: parsed.model,
            version: parsed.version,
            year: parsed.year,
            color: parsed.color,
            category: parsed.category,
            lookupStatus: lookup?.status === "found" ? "found" : duplicate.lookupStatus,
            lookupProvider: lookup?.status === "found" ? lookup.provider : duplicate.lookupProvider,
            imageUrl: lookup?.status === "found" ? lookup.imageUrl : duplicate.imageUrl,
            updatedAt: now,
          });
          pushAudit(draft, userId, "vehicle", duplicate.id, "updated", `Veículo ${duplicate.plate} atualizado.`, before, duplicate);
          return { vehicle: duplicate, created: false };
        }

        const vehicle: Vehicle = {
          id: newId("vehicle"),
          customerId,
          plate: parsed.plate,
          brand: parsed.brand,
          model: parsed.model,
          version: parsed.version,
          year: parsed.year,
          color: parsed.color,
          category: parsed.category,
          lookupStatus: lookup?.status === "found" ? "found" : "manual",
          lookupProvider: lookup?.status === "found" ? lookup.provider : "Cadastro manual",
          imageUrl: lookup?.status === "found" ? lookup.imageUrl : undefined,
          createdAt: now,
          updatedAt: now,
        };
        draft.vehicles.unshift(vehicle);
        pushAudit(draft, userId, "vehicle", vehicle.id, "created", `Veículo ${vehicle.plate} criado.`, undefined, vehicle);
        return { vehicle, created: true };
      });
    },
    [commit, currentUser],
  );

  const createOrder: StoreContextValue["createOrder"] = useCallback(
    (customerId, vehicleId, input, idempotencyKey) => {
      ensurePermission(currentUser, "orders:create");
      const parsed = orderDraftSchema.parse(input);

      return commit((draft, userId) => {
        const duplicate = draft.orders.find((order) => order.idempotencyKey === idempotencyKey);
        if (duplicate) return duplicate;

        const customer = draft.customers.find((item) => item.id === customerId && !item.deletedAt);
        const vehicle = draft.vehicles.find((item) => item.id === vehicleId && !item.deletedAt);
        if (!customer || !vehicle) throw new Error("Cliente ou veículo não encontrado.");
        if (vehicle.customerId !== customerId) throw new Error("Veículo não pertence ao cliente informado.");

        const now = new Date().toISOString();
        const order: ServiceOrder = {
          id: newId("order"),
          number: nextOrderNumber(draft),
          customerId,
          vehicleId,
          status: "draft",
          paymentStatus: "unpaid",
          currentMileage: parsed.currentMileage ?? 0,
          fuelLevel: parsed.fuelLevel ?? 0,
          entryState: parsed.entryState ?? "",
          priority: parsed.priority,
          advisorId: currentUser?.employeeId ?? draft.employees[0]?.id,
          mechanicId: parsed.mechanicId,
          estimatedDeliveryAt: parsed.estimatedDeliveryAt,
          customerNotes: parsed.customerNotes,
          internalNotes: parsed.internalNotes,
          idempotencyKey,
          version: 1,
          createdAt: now,
          updatedAt: now,
        };

        draft.orders.unshift(order);
        if (parsed.currentMileage && parsed.currentMileage > 0) {
          draft.mileageRecords.unshift({
            id: newId("mileage"),
            vehicleId,
            orderId: order.id,
            mileage: parsed.currentMileage,
            recordedAt: now,
          });
        }
        draft.processedOperationKeys.push(idempotencyKey);
        pushAudit(draft, userId, "order", order.id, "created", `OS ${order.number} criada.`, undefined, order);
        return order;
      });
    },
    [commit, currentUser],
  );

  const updateOrder: StoreContextValue["updateOrder"] = useCallback(
    (orderId, patch, action = "updated") => {
      ensurePermission(currentUser, action === "updated" ? "orders:update_execution" : "orders:approve");
      return commit((draft, userId) => {
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const before = cloneState(draft).orders.find((item) => item.id === orderId);
        Object.assign(order, patch, { updatedAt: new Date().toISOString(), version: order.version + 1 });
        pushAudit(draft, userId, "order", order.id, action, `OS ${order.number} atualizada.`, before, order);
        return order;
      });
    },
    [commit, currentUser],
  );

  const advanceOrderStatus: StoreContextValue["advanceOrderStatus"] = useCallback(
    (orderId, status) => {
      ensurePermission(currentUser, "orders:update_execution");
      return commit((draft, userId) => {
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const before = cloneState(draft).orders.find((item) => item.id === orderId);
        const nextStatus =
          status ??
          ORDER_STATUS_SEQUENCE[Math.min(ORDER_STATUS_SEQUENCE.indexOf(order.status) + 1, ORDER_STATUS_SEQUENCE.length - 1)] ??
          order.status;
        order.status = nextStatus;
        order.updatedAt = new Date().toISOString();
        order.version += 1;
        if (nextStatus === "in_service" && !order.startedAt) order.startedAt = order.updatedAt;
        if (nextStatus === "finished" && !order.finishedAt) order.finishedAt = order.updatedAt;
        if (nextStatus === "delivered" && !order.deliveredAt) order.deliveredAt = order.updatedAt;
        pushAudit(draft, userId, "order", order.id, "status_changed", `OS ${order.number} mudou para ${nextStatus}.`, before, order);
        return order;
      });
    },
    [commit, currentUser],
  );

  const upsertInspectionItem: StoreContextValue["upsertInspectionItem"] = useCallback(
    (orderId, itemId, status, notes) => {
      ensurePermission(currentUser, "orders:update_execution");
      commit((draft, userId) => {
        const item = draft.inspectionItems.find((inspection) => inspection.id === itemId && inspection.orderId === orderId);
        if (!item) throw new Error("Item de inspeção não encontrado.");
        const before = { ...item };
        item.status = status;
        item.notes = notes;
        item.updatedAt = new Date().toISOString();
        pushAudit(draft, userId, "inspection", item.id, "updated", `Checklist ${item.label} atualizado.`, before, item);
      });
    },
    [commit, currentUser],
  );

  const addPhoto: StoreContextValue["addPhoto"] = useCallback(
    (orderId, dataUrl, label) => {
      ensurePermission(currentUser, "orders:update_execution");
      commit((draft, userId) => {
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const photo = {
          id: newId("photo"),
          orderId,
          label,
          dataUrl,
          createdAt: new Date().toISOString(),
          createdBy: userId,
        };
        draft.photos.unshift(photo);
        pushAudit(draft, userId, "photo", photo.id, "created", `Foto anexada à OS ${order.number}.`, undefined, {
          id: photo.id,
          label: photo.label,
        });
      });
    },
    [commit, currentUser],
  );

  const removePhoto: StoreContextValue["removePhoto"] = useCallback(
    (photoId) => {
      ensurePermission(currentUser, "orders:update_execution");
      commit((draft, userId) => {
        const photo = draft.photos.find((item) => item.id === photoId);
        if (!photo) return;
        draft.photos = draft.photos.filter((item) => item.id !== photoId);
        pushAudit(draft, userId, "photo", photo.id, "cancelled", `Foto removida da OS.`, photo, undefined);
      });
    },
    [commit, currentUser],
  );

  const addOrderItem: StoreContextValue["addOrderItem"] = useCallback(
    (orderId, input) => {
      ensurePermission(currentUser, "orders:approve");
      const parsed = orderItemSchema.parse(input);
      return commit((draft, userId) => {
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const now = new Date().toISOString();
        const item: OrderItem = {
          id: newId("item"),
          orderId,
          ...parsed,
          createdAt: now,
          updatedAt: now,
        };
        draft.orderItems.push(item);
        order.status = order.status === "draft" ? "waiting_approval" : order.status;
        order.updatedAt = now;
        order.version += 1;
        updatePaymentStatus(draft, orderId);
        pushAudit(draft, userId, "order_item", item.id, "created", `Item adicionado à OS ${order.number}.`, undefined, item);
        return item;
      });
    },
    [commit, currentUser],
  );

  const updateOrderItem: StoreContextValue["updateOrderItem"] = useCallback(
    (itemId, patch) => {
      ensurePermission(currentUser, "orders:approve");
      return commit((draft, userId) => {
        const item = draft.orderItems.find((entry) => entry.id === itemId);
        if (!item) throw new Error("Item não encontrado.");
        const before = { ...item };
        const parsed = orderItemSchema.parse({ ...item, ...patch });
        Object.assign(item, parsed, { updatedAt: new Date().toISOString() });
        const order = draft.orders.find((entry) => entry.id === item.orderId);
        if (order) {
          order.updatedAt = item.updatedAt;
          order.version += 1;
          updatePaymentStatus(draft, order.id);
        }
        pushAudit(draft, userId, "order_item", item.id, "updated", `Item ${item.description} atualizado.`, before, item);
        return item;
      });
    },
    [commit, currentUser],
  );

  const removeOrderItem: StoreContextValue["removeOrderItem"] = useCallback(
    (itemId) => {
      ensurePermission(currentUser, "orders:approve");
      commit((draft, userId) => {
        const item = draft.orderItems.find((entry) => entry.id === itemId);
        if (!item) return;
        const order = draft.orders.find((entry) => entry.id === item.orderId);
        draft.orderItems = draft.orderItems.filter((entry) => entry.id !== itemId);
        if (order) {
          order.updatedAt = new Date().toISOString();
          order.version += 1;
          updatePaymentStatus(draft, order.id);
        }
        pushAudit(draft, userId, "order_item", item.id, "cancelled", `Item removido da OS ${order?.number ?? item.orderId}.`, item);
      });
    },
    [commit, currentUser],
  );

  const toggleOrderItemDone: StoreContextValue["toggleOrderItemDone"] = useCallback(
    (itemId, done) => {
      ensurePermission(currentUser, "orders:update_execution");
      commit((draft, userId) => {
        const item = draft.orderItems.find((entry) => entry.id === itemId);
        if (!item) throw new Error("Item não encontrado.");
        const before = { ...item };
        item.doneAt = done ? new Date().toISOString() : undefined;
        item.doneBy = done ? userId : undefined;
        item.updatedAt = new Date().toISOString();
        const order = draft.orders.find((entry) => entry.id === item.orderId);
        if (order) {
          order.updatedAt = item.updatedAt;
          order.version += 1;
        }
        pushAudit(draft, userId, "order_item", item.id, "updated", `${item.description} ${done ? "marcado como feito" : "reaberto"}.`, before, item);
      });
    },
    [commit, currentUser],
  );

  const createQuoteRevision: StoreContextValue["createQuoteRevision"] = useCallback(
    (orderId, status) => {
      ensurePermission(currentUser, "orders:approve");
      return commit((draft, userId) => {
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const items = getOrderItems(draft, orderId);
        if (!items.length) throw new Error("Inclua ao menos um serviço ou peça antes do orçamento.");
        const totals = calculateItemsTotals(items, getOrderPayments(draft, orderId));
        const version =
          draft.quoteRevisions.filter((revision) => revision.orderId === orderId).reduce((max, revision) => Math.max(max, revision.version), 0) +
          1;
        const now = new Date().toISOString();
        const revision: QuoteRevision = {
          id: newId("quote"),
          orderId,
          version,
          status,
          subtotalParts: totals.subtotalParts,
          subtotalLabor: totals.subtotalLabor,
          discount: totals.discount,
          total: totals.total,
          itemsSnapshot: items,
          sentAt: status === "sent" ? now : undefined,
          createdAt: now,
          createdBy: userId,
        };
        draft.quoteRevisions.unshift(revision);
        order.status = status === "sent" ? "waiting_approval" : order.status;
        order.updatedAt = now;
        order.version += 1;
        pushAudit(draft, userId, "quote_revision", revision.id, "created", `Revisão ${version} da OS ${order.number} criada.`, undefined, revision);
        return revision;
      });
    },
    [commit, currentUser],
  );

  const approveQuoteRevision: StoreContextValue["approveQuoteRevision"] = useCallback(
    (revisionId) => {
      ensurePermission(currentUser, "orders:approve");
      return commit((draft, userId) => {
        const revision = draft.quoteRevisions.find((item) => item.id === revisionId);
        if (!revision) throw new Error("Revisão não encontrada.");
        const order = draft.orders.find((item) => item.id === revision.orderId);
        if (!order) throw new Error("OS não encontrada.");
        const before = { ...revision };
        revision.status = "approved";
        revision.approvedAt = new Date().toISOString();
        revision.approvedBy = order.customerId;
        order.status = "approved";
        order.approvedQuoteRevisionId = revision.id;
        order.updatedAt = revision.approvedAt;
        order.version += 1;
        pushAudit(draft, userId, "quote_revision", revision.id, "approved", `Orçamento ${revision.version} aprovado.`, before, revision);
        return revision;
      });
    },
    [commit, currentUser],
  );

  const recordPayment: StoreContextValue["recordPayment"] = useCallback(
    (orderId, input, idempotencyKey) => {
      ensurePermission(currentUser, "payments:write");
      const parsed = paymentSchema.parse(input);
      return commit((draft, userId) => {
        const duplicate = draft.payments.find((payment) => payment.idempotencyKey === idempotencyKey);
        if (duplicate) return duplicate;
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const totals = getOrderTotals(draft, orderId);
        if (parsed.amount > totals.balance && totals.balance > 0) {
          throw new Error("Pagamento maior que o saldo restante.");
        }
        const now = new Date().toISOString();
        const payment: Payment = {
          id: newId("payment"),
          orderId,
          method: parsed.method,
          amount: parsed.amount,
          status: "confirmed",
          reference: parsed.reference,
          paidAt: now,
          createdAt: now,
          createdBy: userId,
          idempotencyKey,
        };
        draft.payments.unshift(payment);
        draft.processedOperationKeys.push(idempotencyKey);
        updatePaymentStatus(draft, orderId);
        pushAudit(draft, userId, "payment", payment.id, "payment_received", `Pagamento registrado na OS ${order.number}.`, undefined, payment);
        return payment;
      });
    },
    [commit, currentUser],
  );

  const generateDocument: StoreContextValue["generateDocument"] = useCallback(
    (orderId, type, idempotencyKey) => {
      ensurePermission(currentUser, "documents:generate");
      return commit((draft, userId) => {
        const duplicate = draft.documents.find((document) => document.idempotencyKey === idempotencyKey);
        if (duplicate) return duplicate;
        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");
        const totals = getOrderTotals(draft, orderId);
        const version =
          draft.documents
            .filter((document) => document.orderId === orderId && document.type === type)
            .reduce((max, document) => Math.max(max, document.version), 0) + 1;
        const document: DocumentRecord = {
          id: newId("document"),
          orderId,
          type,
          status: "generated",
          version,
          publicToken: `${order.number.toLowerCase()}-${type}-${version}`.replace(/[^a-z0-9-]/g, "-"),
          total: totals.total,
          createdAt: new Date().toISOString(),
          createdBy: userId,
          idempotencyKey,
        };
        draft.documents.unshift(document);
        draft.processedOperationKeys.push(idempotencyKey);
        pushAudit(draft, userId, "document", document.id, "document_generated", `Documento ${document.type} gerado para ${order.number}.`, undefined, document);
        return document;
      });
    },
    [commit, currentUser],
  );

  const finishService: StoreContextValue["finishService"] = useCallback(
    (orderId, input, idempotencyKey) => {
      ensurePermission(currentUser, "orders:update_execution");
      ensurePermission(currentUser, "orders:approve");
      ensurePermission(currentUser, "documents:generate");
      if (!Number.isFinite(input.finalAmount) || input.finalAmount < 0) {
        throw new Error("Informe um valor final válido.");
      }

      return commit((draft, userId) => {
        const duplicate = draft.documents.find((document) => document.idempotencyKey === idempotencyKey);
        if (duplicate) return duplicate;

        const order = draft.orders.find((item) => item.id === orderId);
        if (!order) throw new Error("OS não encontrada.");

        const now = new Date().toISOString();
        const totalsBefore = getOrderTotals(draft, orderId);

        // Only add an adjustment item when the user explicitly changed the final value
        // (i.e., the entered value differs from the current calculated total)
        const adjustment = Math.round((input.finalAmount - totalsBefore.total) * 100) / 100;
        const userChangedAmount = input.userChangedAmount === true;

        if (userChangedAmount && Math.abs(adjustment) >= 0.01) {
          const item: OrderItem = {
            id: newId("item"),
            orderId,
            type: "custom",
            description: "Ajuste do valor final",
            quantity: 1,
            unitPrice: adjustment > 0 ? adjustment : 0,
            laborPrice: 0,
            discount: adjustment < 0 ? Math.abs(adjustment) : 0,
            cost: 0,
            notes: "Ajuste aplicado na finalização do serviço.",
            createdAt: now,
            updatedAt: now,
          };
          draft.orderItems.push(item);
          pushAudit(draft, userId, "order_item", item.id, "created", `Valor final ajustado na OS ${order.number}.`, undefined, item);
        }

        const before = { ...order };
        order.status = "finished";
        order.finishedAt = order.finishedAt ?? now;
        order.mechanicSignatureDataUrl = input.mechanicSignatureDataUrl || order.mechanicSignatureDataUrl;
        order.updatedAt = now;
        order.version += 1;
        updatePaymentStatus(draft, orderId);
        pushAudit(draft, userId, "order", order.id, "status_changed", `OS ${order.number} finalizada.`, before, order);

        const totals = getOrderTotals(draft, orderId);
        const version =
          draft.documents
            .filter((document) => document.orderId === orderId && document.type === "service_order")
            .reduce((max, document) => Math.max(max, document.version), 0) + 1;
        const document: DocumentRecord = {
          id: newId("document"),
          orderId,
          type: "service_order",
          status: "generated",
          version,
          publicToken: `${order.number.toLowerCase()}-service_order-${version}`.replace(/[^a-z0-9-]/g, "-"),
          total: totals.total,
          createdAt: now,
          createdBy: userId,
          idempotencyKey,
        };
        draft.documents.unshift(document);
        draft.processedOperationKeys.push(idempotencyKey);
        pushAudit(draft, userId, "document", document.id, "document_generated", `Documento final gerado para ${order.number}.`, undefined, document);
        return document;
      });
    },
    [commit, currentUser],
  );

  const addCatalogService: StoreContextValue["addCatalogService"] = useCallback(
    (input) => {
      ensurePermission(currentUser, "catalog:write");
      const parsed = catalogServiceSchema.parse(input);
      return commit((draft, userId) => {
        const now = new Date().toISOString();
        const service: CatalogService = {
          id: newId("service"),
          ...parsed,
          createdAt: now,
          updatedAt: now,
        };
        draft.services.unshift(service);
        pushAudit(draft, userId, "catalog_service", service.id, "created", `Serviço ${service.name} cadastrado.`, undefined, service);
        return service;
      });
    },
    [commit, currentUser],
  );

  const addCatalogProduct: StoreContextValue["addCatalogProduct"] = useCallback(
    (input) => {
      ensurePermission(currentUser, "catalog:write");
      const parsed = catalogProductSchema.parse(input);
      return commit((draft, userId) => {
        const now = new Date().toISOString();
        const product: CatalogProduct = {
          id: newId("product"),
          ...parsed,
          createdAt: now,
          updatedAt: now,
        };
        draft.products.unshift(product);
        pushAudit(draft, userId, "catalog_product", product.id, "created", `Peça ${product.name} cadastrada.`, undefined, product);
        return product;
      });
    },
    [commit, currentUser],
  );

  const { syncStatus } = snapshot;

  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      ready,
      syncStatus,
      currentUser,
      login,
      logout,
      can,
      resetDemoData,
      forceSync,
      createOrUpdateCustomer,
      createOrUpdateVehicle,
      createOrder,
      updateOrder,
      advanceOrderStatus,
      upsertInspectionItem,
      addPhoto,
      removePhoto,
      addOrderItem,
      updateOrderItem,
      toggleOrderItemDone,
      removeOrderItem,
      createQuoteRevision,
      approveQuoteRevision,
      recordPayment,
      generateDocument,
      finishService,
      addCatalogService,
      addCatalogProduct,
    }),
    [
      addCatalogProduct,
      addCatalogService,
      addOrderItem,
      addPhoto,
      advanceOrderStatus,
      approveQuoteRevision,
      can,
      createOrUpdateCustomer,
      createOrUpdateVehicle,
      createOrder,
      createQuoteRevision,
      currentUser,
      finishService,
      generateDocument,
      login,
      logout,
      ready,
      recordPayment,
      removeOrderItem,
      removePhoto,
      forceSync,
      resetDemoData,
      state,
      syncStatus,
      toggleOrderItemDone,
      updateOrderItem,
      updateOrder,
      upsertInspectionItem,
    ],
  );

  return <StoreContext.Provider value={value}>{children}</StoreContext.Provider>;
}

export function useWorkshop() {
  const context = useContext(StoreContext);
  if (!context) throw new Error("useWorkshop precisa estar dentro de WorkshopProvider.");
  return context;
}
