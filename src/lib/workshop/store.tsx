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
import { newId, normalizePlate } from "./format";
import { hasPermission, type Permission } from "./permissions";
import { createSeedState } from "./seed";
import { normalizeWorkshopState } from "./normalize-state";
import { localImageForCategory } from "./vehicle-image";
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
  PlateMemory,
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

const LEGACY_STORAGE_KEY = "total-flex-workshop-state-v2";
const AUTH_KEY = "total-flex-auth-user-v1";

type SyncStatus = "idle" | "syncing" | "synced" | "error" | "table_missing";

type StoreSnapshot = {
  state: WorkshopState | null;
  currentUserId: string | null;
  ready: boolean;
  syncStatus: SyncStatus;
  syncError: string;
};

const serverSnapshot: StoreSnapshot = {
  state: null,
  currentUserId: null,
  ready: false,
  syncStatus: "idle",
  syncError: "",
};

let snapshot: StoreSnapshot = serverSnapshot;
let initialized = false;
const listeners = new Set<() => void>();

type StoreContextValue = {
  state: WorkshopState | null;
  ready: boolean;
  syncStatus: SyncStatus;
  syncError: string;
  retryConnection: () => Promise<void>;
  currentUser: WorkshopState["users"][number] | null;
  login: (username: string, password: string) => Promise<boolean>;
  logout: () => void;
  can: (permission: Permission) => boolean;
  resetDemoData: () => void;
  forceSync: () => Promise<void>;
  createOrUpdateCustomer: (
    input: {
      customerId?: string;
      cpf: string;
      name: string;
      phone: string;
      email?: string;
      noEmail: boolean;
      address?: string;
      district?: string;
    },
  ) => { customer: Customer; created: boolean };
  deleteCustomer: (customerId: string) => void;
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
  deleteOrder: (orderId: string) => void;
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
  finishService: (
    orderId: string,
    input: { finalAmount: number; mechanicSignatureDataUrl?: string; userChangedAmount?: boolean; laborAmount?: number },
    idempotencyKey: string,
  ) => DocumentRecord;
  addCatalogService: (input: Omit<CatalogService, "id" | "createdAt" | "updatedAt">) => CatalogService;
  addCatalogProduct: (input: Omit<CatalogProduct, "id" | "createdAt" | "updatedAt">) => CatalogProduct;
};

const StoreContext = createContext<StoreContextValue | null>(null);

function cloneState(state: WorkshopState): WorkshopState {
  return structuredClone(state);
}

function readStoredAuthUserId() {
  try {
    return window.localStorage.getItem(AUTH_KEY);
  } catch {
    return null;
  }
}

function clearLegacyLocalState() {
  try {
    window.localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    return;
  }
}

function emitStoreChange() {
  listeners.forEach((listener) => listener());
}

function getClientSnapshot() {
  if (typeof window === "undefined") return serverSnapshot;

  if (!initialized) {
    clearLegacyLocalState();
    snapshot = {
      state: null,
      currentUserId: readStoredAuthUserId(),
      ready: false,
      syncStatus: "idle",
      syncError: "",
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
    if (next.currentUserId) window.localStorage.setItem(AUTH_KEY, next.currentUserId);
    else window.localStorage.removeItem(AUTH_KEY);
  }
  emitStoreChange();
}

const MAX_SYNC_RETRIES = 3;
let syncInFlight: Promise<SyncStatus> | null = null;
let queuedSyncState: WorkshopState | null = null;
let lastSyncError = "";

let syncDebounceTimer: number | null = null;
let latestStateForSync: WorkshopState | null = null;

/** Keep the snapshot complete; Supabase is the source for every app record. */
function stripPhotosForSync(state: WorkshopState): Record<string, unknown> {
  return state as unknown as Record<string, unknown>;
}

function patchSyncStatus(status: SyncStatus, error = lastSyncError) {
  const current = getClientSnapshot();
  if (current.syncStatus === status && current.syncError === error) return;
  setWorkshopSnapshot({ ...current, syncStatus: status, syncError: error });
}

function scheduleSync(state: WorkshopState, immediate = false) {
  latestStateForSync = state;
  if (typeof window === "undefined") return;

  if (syncDebounceTimer) window.clearTimeout(syncDebounceTimer);

  const delay = immediate ? 0 : 250;
  syncDebounceTimer = window.setTimeout(() => {
    syncDebounceTimer = null;
    if (!latestStateForSync) return;
    const toSync = latestStateForSync;
    patchSyncStatus("syncing");
    void syncToSupabase(toSync).then((status) => {
      patchSyncStatus(status);
      if (status === "error" && lastSyncError) {
        toast.error(`Erro ao salvar: ${lastSyncError.slice(0, 120)}`);
      }
    });
  }, delay);
}

async function writeSnapshotToSupabase(state: WorkshopState): Promise<SyncStatus> {
  const stripped = stripPhotosForSync(state);
  const payload = JSON.stringify({ state: stripped });

  for (let attempt = 1; attempt <= MAX_SYNC_RETRIES; attempt += 1) {
    try {
      const response = await fetch("/api/workshop/sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload,
        cache: "no-store",
      });

      const body = await response.json().catch(() => ({}));

      if (!response.ok || body?.ok === false) {
        const detail = body?.detail || body?.error || `HTTP ${response.status}`;
        if (body?.reason === "table_missing") {
          lastSyncError = detail;
          return "table_missing";
        }
        throw new Error(detail);
      }

      if (body?.entitySync && body.entitySync.ok === false) {
        lastSyncError = body.entitySync.error || "Falha ao espelhar tabelas SQL.";
        toast.warning(`Salvo na nuvem, mas tabelas SQL: ${lastSyncError.slice(0, 100)}`);
      } else {
        lastSyncError = "";
      }
      return "synced";
    } catch (err) {
      lastSyncError = err instanceof Error ? err.message : String(err);
      if (attempt < MAX_SYNC_RETRIES) {
        await new Promise((resolve) => window.setTimeout(resolve, 600 * attempt));
      }
    }
  }

  return "error";
}

async function drainSyncQueue(): Promise<SyncStatus> {
  let finalStatus: SyncStatus = "synced";

  while (queuedSyncState) {
    const nextState = queuedSyncState;
    queuedSyncState = null;
    finalStatus = await writeSnapshotToSupabase(nextState);
    if (finalStatus !== "synced") break;
  }

  return finalStatus;
}

async function syncToSupabase(state: WorkshopState): Promise<SyncStatus> {
  queuedSyncState = state;
  if (!syncInFlight) {
    syncInFlight = drainSyncQueue().finally(() => {
      syncInFlight = null;
    });
  }
  return syncInFlight;
}
function wait(ms: number) {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

async function fetchRemoteStateOnce(): Promise<{ ok: true; state: WorkshopState } | { ok: false; reason: SyncStatus; detail: string }> {
  try {
    const response = await fetch("/api/workshop/sync", { cache: "no-store" });
    const body = (await response.json().catch(() => ({}))) as {
      ok?: boolean;
      state?: WorkshopState | null;
      source?: string;
      detail?: string;
      reason?: string;
    };

    if (response.ok && body.state?.updatedAt && (body.source === "supabase" || body.ok === true)) {
      return { ok: true, state: normalizeWorkshopState(body.state) };
    }

    const detail = body.detail || body.reason || `HTTP ${response.status}`;
    const reason: SyncStatus =
      body.reason === "table_missing" || body.source === "table_missing"
        ? "table_missing"
        : "error";
    return { ok: false, reason, detail };
  } catch (err) {
    return {
      ok: false,
      reason: "error",
      detail: err instanceof Error ? err.message : "Falha de rede ao conectar ao servidor.",
    };
  }
}

async function loadStateFromSupabaseUntilReady(isActive: () => boolean = () => true) {
  if (getClientSnapshot().ready && getClientSnapshot().state) return;

  const maxAttempts = 5;
  const retryDelays = [400, 800, 1500, 2500, 4000];

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    if (!isActive()) return;

    setWorkshopSnapshot({ ...snapshot, state: null, ready: false, syncStatus: "syncing", syncError: "" });

    const result = await fetchRemoteStateOnce();
    if (!isActive()) return;

    if (result.ok) {
      lastSyncError = "";
      setWorkshopSnapshot({
        ...snapshot,
        state: result.state,
        ready: true,
        syncStatus: "synced",
        syncError: "",
      });
      return;
    }

    lastSyncError = result.detail;
    const isLastAttempt = attempt === maxAttempts;
    setWorkshopSnapshot({
      ...snapshot,
      state: null,
      ready: false,
      syncStatus: result.reason,
      syncError: result.detail,
    });

    if (isLastAttempt || !isActive()) return;

    await wait(retryDelays[attempt - 1] ?? 2000);
  }
}

function setWorkshopState(nextState: WorkshopState, options?: { syncImmediately?: boolean }) {
  const current = getClientSnapshot();
  setWorkshopSnapshot({ ...current, state: nextState, ready: true });
  scheduleSync(nextState, options?.syncImmediately ?? false);
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

function upsertPlateMemory(
  draft: WorkshopState,
  input: Pick<
    PlateMemory,
    "plate" | "brand" | "model" | "version" | "year" | "color" | "category" | "lookupStatus" | "lookupProvider" | "imageUrl"
  >,
) {
  if (!draft.plateMemories) draft.plateMemories = [];
  const plate = normalizePlate(input.plate);
  const now = new Date().toISOString();
  const existing = draft.plateMemories.find((memory) => memory.plate === plate);
  const payload: PlateMemory = {
    id: existing?.id ?? newId("plate"),
    plate,
    brand: input.brand,
    model: input.model,
    version: input.version,
    year: input.year,
    color: input.color,
    category: input.category,
    lookupStatus: input.lookupStatus,
    lookupProvider: input.lookupProvider,
    imageUrl: input.imageUrl,
    updatedAt: now,
  };
  if (existing) {
    Object.assign(existing, payload);
    return;
  }
  draft.plateMemories.unshift(payload);
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
  const { state, currentUserId, ready, syncStatus, syncError } = useSyncExternalStore(
    subscribeStore,
    getClientSnapshot,
    () => serverSnapshot,
  );

  // ?????????????????????????????????????????????????????????????
  // Load from Supabase on first load
  // ?????????????????????????????????????????????????????????????
  useEffect(() => {
    let active = true;
    void loadStateFromSupabaseUntilReady(() => active);
    return () => {
      active = false;
    };
  }, []);

  // Flush pending sync when the tab closes
  useEffect(() => {
    function flushPendingSync() {
      if (!latestStateForSync || snapshot.syncStatus === "synced") return;
      const payload = JSON.stringify({ state: stripPhotosForSync(latestStateForSync) });
      void fetch("/api/workshop/sync", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: payload,
        keepalive: true,
        cache: "no-store",
      });
    }

    window.addEventListener("pagehide", flushPendingSync);
    return () => window.removeEventListener("pagehide", flushPendingSync);
  }, []);

  const retryConnection = useCallback(async () => {
    setWorkshopSnapshot({ ...getClientSnapshot(), ready: false, syncStatus: "syncing", syncError: "" });
    const result = await fetchRemoteStateOnce();
    if (result.ok) {
      lastSyncError = "";
      setWorkshopSnapshot({
        ...getClientSnapshot(),
        state: result.state,
        ready: true,
        syncStatus: "synced",
        syncError: "",
      });
      toast.success("Conectado ao Supabase.");
      return;
    }
    lastSyncError = result.detail;
    setWorkshopSnapshot({
      ...getClientSnapshot(),
      state: null,
      ready: false,
      syncStatus: result.reason,
      syncError: result.detail,
    });
    toast.error(result.detail.slice(0, 140));
  }, []);

  // ─────────────────────────────────────────────────────────────
  // Manual force sync
  // ─────────────────────────────────────────────────────────────
  const forceSync = useCallback(async () => {
    if (!state) return;
    scheduleSync(state, true);
    patchSyncStatus("syncing");
    const status = await syncToSupabase(state);
    patchSyncStatus(status);
    if (status === "synced") {
      toast.success("Dados salvos no Supabase com sucesso!");
    } else {
      const detail = lastSyncError || "Verifique SUPABASE_SERVICE_ROLE_KEY no .env ou Vercel.";
      toast.error(`Falha ao salvar: ${detail.slice(0, 150)}`);
    }
  }, [state]);

  const currentUser = useMemo(() => {
    if (!state || !currentUserId) return null;
    return state.users.find((user) => user.id === currentUserId && user.active) ?? null;
  }, [currentUserId, state]);

  const commit = useCallback(
    <T,>(producer: (draft: WorkshopState, userId: string) => T, options?: { syncImmediately?: boolean }) => {
      if (!state) throw new Error("Base de dados ainda não carregada.");
      const userId = currentUser?.id ?? state.users[0]?.id;
      if (!userId) throw new Error("Usuario nao identificado.");

      const draft = cloneState(state);
      const result = producer(draft, userId);
      draft.updatedAt = new Date().toISOString();
      setWorkshopState(draft, options);
      return result;
    },
    [currentUser?.id, state],
  );

  const login = useCallback(
    async (username: string, password: string) => {
      if (!state) {
        toast.error("A base do Supabase ainda esta carregando.");
        return false;
      }
      const normalized = username.trim().toLowerCase();
      let user = state.users.find((item) => item.username === normalized && item.active);
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
        } else if (response.status === 401) {
          toast.error("Usuario ou senha invalidos.");
          return false;
        } else {
          const payload = (await response.json().catch(() => ({}))) as { error?: string };
          toast.error(payload.error === "supabase_not_configured" ? "Supabase nao configurado." : "Banco de dados indisponivel.");
          return false;
        }
      } catch {
        toast.error("Nao foi possivel validar o login no banco.");
        return false;
      }

      if (!user || !remoteAccepted) {
        toast.error("Usuario ou senha invalidos.");
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
    setWorkshopState(next, { syncImmediately: true });
    toast.success("Base inicial enviada ao Supabase.");
  }, []);

  const createOrUpdateCustomer: StoreContextValue["createOrUpdateCustomer"] = useCallback(
    (input) => {
      ensurePermission(currentUser, "customers:write");
      const parsed = customerSchema.parse(input);

      return commit(
        (draft, userId) => {
          const existingById = input.customerId
            ? draft.customers.find((item) => item.id === input.customerId && !item.deletedAt)
            : undefined;
          const existing = existingById ?? findCustomerByCpf(draft, parsed.cpf);
          const now = new Date().toISOString();

          if (existing) {
            if (existingById) {
              const cpfTaken = draft.customers.some(
                (item) => item.id !== existing.id && !item.deletedAt && item.cpf === parsed.cpf,
              );
              if (cpfTaken) throw new Error("Este CPF já pertence a outro cliente.");
            }

            const before = cloneState(draft).customers.find((customer) => customer.id === existing.id);
            Object.assign(existing, {
              cpf: parsed.cpf,
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
        },
        { syncImmediately: true },
      );
    },
    [commit, currentUser],
  );

  const deleteCustomer: StoreContextValue["deleteCustomer"] = useCallback(
    (customerId) => {
      ensurePermission(currentUser, "customers:write");
      commit(
        (draft, userId) => {
          const customer = draft.customers.find((item) => item.id === customerId && !item.deletedAt);
          if (!customer) throw new Error("Cliente nao encontrado.");
          const before = { ...customer };
          const now = new Date().toISOString();

          customer.deletedAt = now;
          customer.updatedAt = now;

          draft.vehicles.forEach((vehicle) => {
            if (vehicle.customerId === customerId && !vehicle.deletedAt) {
              upsertPlateMemory(draft, {
                plate: vehicle.plate,
                brand: vehicle.brand,
                model: vehicle.model,
                version: vehicle.version,
                year: vehicle.year,
                color: vehicle.color,
                category: vehicle.category,
                lookupStatus: vehicle.lookupStatus,
                lookupProvider: vehicle.lookupProvider,
                imageUrl: vehicle.imageUrl,
              });
              vehicle.deletedAt = now;
              vehicle.updatedAt = now;
            }
          });

          draft.orders.forEach((order) => {
            if (order.customerId === customerId && !order.deletedAt) {
              order.deletedAt = now;
              order.updatedAt = now;
              order.version += 1;
            }
          });

          pushAudit(draft, userId, "customer", customer.id, "cancelled", `Cliente ${customer.name} excluido.`, before, customer);
        },
        { syncImmediately: true },
      );
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
            imageUrl: localImageForCategory(parsed.category),
            updatedAt: now,
          });
          pushAudit(draft, userId, "vehicle", duplicate.id, "updated", `Veículo ${duplicate.plate} atualizado.`, before, duplicate);
          upsertPlateMemory(draft, {
            plate: duplicate.plate,
            brand: duplicate.brand,
            model: duplicate.model,
            version: duplicate.version,
            year: duplicate.year,
            color: duplicate.color,
            category: duplicate.category,
            lookupStatus: duplicate.lookupStatus,
            lookupProvider: duplicate.lookupProvider,
            imageUrl: duplicate.imageUrl,
          });
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
          imageUrl: localImageForCategory(parsed.category),
          createdAt: now,
          updatedAt: now,
        };
        draft.vehicles.unshift(vehicle);
        pushAudit(draft, userId, "vehicle", vehicle.id, "created", `Veículo ${vehicle.plate} criado.`, undefined, vehicle);
        upsertPlateMemory(draft, {
          plate: vehicle.plate,
          brand: vehicle.brand,
          model: vehicle.model,
          version: vehicle.version,
          year: vehicle.year,
          color: vehicle.color,
          category: vehicle.category,
          lookupStatus: vehicle.lookupStatus,
          lookupProvider: vehicle.lookupProvider,
          imageUrl: vehicle.imageUrl,
        });
        return { vehicle, created: true };
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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

  const deleteOrder: StoreContextValue["deleteOrder"] = useCallback(
    (orderId) => {
      ensurePermission(currentUser, "orders:approve");
      commit(
        (draft, userId) => {
          const order = draft.orders.find((item) => item.id === orderId && !item.deletedAt);
          if (!order) throw new Error("OS nao encontrada.");
          const before = { ...order };
          const now = new Date().toISOString();
          order.deletedAt = now;
          order.updatedAt = now;
          order.version += 1;
          pushAudit(draft, userId, "order", order.id, "cancelled", `OS ${order.number} excluida.`, before, order);
        },
        { syncImmediately: true },
      );
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
      }, { syncImmediately: true });
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
        const laborAmount = Math.round((input.laborAmount ?? 0) * 100) / 100;
        if (!Number.isFinite(laborAmount) || laborAmount < 0) {
          throw new Error("Informe uma mao de obra valida.");
        }
        order.finalLaborAmount = laborAmount;

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
      }, { syncImmediately: true });
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


  const value = useMemo<StoreContextValue>(
    () => ({
      state,
      ready,
      syncStatus,
      syncError,
      retryConnection,
      currentUser,
      login,
      logout,
      can,
      resetDemoData,
      forceSync,
      createOrUpdateCustomer,
      createOrUpdateVehicle,
      createOrder,
      deleteCustomer,
      deleteOrder,
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
      deleteCustomer,
      deleteOrder,
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
      retryConnection,
      state,
      syncError,
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
