"use client";

import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import NextImage from "next/image";
import { usePathname, useSearchParams } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import {
  ArrowLeft,
  CalendarClock,
  Camera,
  Car,
  Check,
  ChevronRight,
  CircleDollarSign,
  ClipboardCheck,
  CreditCard,
  Clock,
  Download,
  FileText,
  Home,
  Images,
  Info,
  LogOut,
  Package,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Share2,
  Settings,
  ShieldCheck,
  Printer,
  UserRound,
  UsersRound,
  Wrench,
} from "lucide-react";
import { ZodError } from "zod";
import { toast, Toaster } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { buildDocumentPdf, DocumentPreview } from "@/components/workshop/document-preview";
import {
  ORDER_STATUS_LABEL,
  ORDER_STATUS_SEQUENCE,
  PAYMENT_METHOD_LABEL,
  PAYMENT_STATUS_LABEL,
  PRIORITY_LABEL,
  ROLE_LABEL,
} from "@/lib/workshop/constants";
import {
  formatCpf,
  formatCurrency,
  formatDate,
  formatDateTime,
  formatPhone,
  formatPlate,
  fromDateTimeLocalValue,
  isLikelyPlate,
  isValidCpf,
  newId,
  normalizeCpf,
  normalizePhone,
  normalizePlate,
  parseCurrencyInput,
  toDateTimeLocalValue,
} from "@/lib/workshop/format";
import {
  findCustomerByCpf,
  findVehicleByPlate,
  globalSearch,
  getCustomer,
  getEmployeeName,
  getOrderItems,
  getOrderPayments,
  getOrderTotals,
  getOrdersForCustomer,
  getVehicle,
  getVehiclesForCustomer,
} from "@/lib/workshop/selectors";
import { useWorkshop, WorkshopProvider } from "@/lib/workshop/store";
import type {
  CatalogProduct,
  CatalogService,
  DocumentRecord,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  ServiceOrder,
  Vehicle,
  VehicleLookupResult,
  WorkshopState,
} from "@/lib/workshop/types";
import { lookupVehicleByPlate, lookupVehicleImage } from "@/lib/workshop/vehicle-lookup";
import {
  checkAndNotifyReminders,
  getNotificationPermission,
  registerServiceWorker,
  requestNotificationPermission,
  shouldCheckReminders,
  type PermissionState,
} from "@/lib/workshop/notifications";

type ViewId = "home" | "customers" | "orders" | "finance" | "history" | "settings";
type BadgeVariant = "default" | "muted" | "success" | "warning" | "danger" | "info";

const selectClass =
  "h-12 w-full rounded-lg border border-zinc-200 bg-white px-4 text-base text-zinc-950 shadow-sm outline-none transition focus:border-zinc-900 focus:ring-4 focus:ring-zinc-100";

const tabs: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Home", icon: Home },
  { id: "customers", label: "Clientes", icon: UsersRound },
  { id: "orders", label: "OS", icon: ClipboardCheck },
  { id: "finance", label: "Financeiro", icon: CircleDollarSign },
  { id: "history", label: "Histórico", icon: Clock },
];

const viewPath: Record<ViewId, string> = {
  home: "/",
  customers: "/clientes",
  orders: "/ordens",
  finance: "/financeiro",
  history: "/historico",
  settings: "/ajustes",
};

function viewFromPath(pathname: string): ViewId {
  const match = (Object.entries(viewPath) as Array<[ViewId, string]>).find(([, path]) => path !== "/" && pathname.startsWith(path));
  return match?.[0] ?? "home";
}

function errorMessage(error: unknown) {
  if (error instanceof ZodError) return error.issues[0]?.message ?? "Dados inválidos.";
  if (error instanceof Error) return error.message;
  return "Não foi possível concluir a ação.";
}

function fieldErrors(error: unknown) {
  if (!(error instanceof ZodError)) return {};
  return error.issues.reduce<Record<string, string>>((errors, issue) => {
    const key = String(issue.path[0] ?? "form");
    if (!errors[key]) errors[key] = issue.message;
    return errors;
  }, {});
}

function invalidFieldClass(error?: string) {
  return error ? "border-rose-500 bg-rose-50/60 text-rose-950 focus:border-rose-600 focus:ring-rose-100" : undefined;
}

function selectFieldClass(error?: string) {
  return `${selectClass} ${error ? "border-rose-500 bg-rose-50/60 text-rose-950 focus:border-rose-600 focus:ring-rose-100" : ""}`;
}

function badgeForOrder(status: OrderStatus): BadgeVariant {
  if (status === "approved" || status === "finished" || status === "delivered") return "success";
  if (status === "waiting_approval" || status === "waiting_parts") return "warning";
  if (status === "cancelled") return "danger";
  if (status === "in_service") return "info";
  return "muted";
}

function badgeForPayment(status: ServiceOrder["paymentStatus"]): BadgeVariant {
  if (status === "paid") return "success";
  if (status === "partial") return "warning";
  if (status === "cancelled" || status === "refunded") return "danger";
  return "muted";
}

function useDraftState<T extends Record<string, unknown>>(key: string, initialValue: T) {
  const [value, setValue] = useState<T>(() => {
    if (typeof window === "undefined") return initialValue;
    try {
      const raw = window.localStorage.getItem(key);
      return raw ? { ...initialValue, ...(JSON.parse(raw) as Partial<T>) } : initialValue;
    } catch {
      return initialValue;
    }
  });

  useEffect(() => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  const patchValue = useCallback((patch: Partial<T>) => {
    setValue((current) => ({ ...current, ...patch }));
  }, []);

  const reset = useCallback(() => {
    window.localStorage.removeItem(key);
    setValue(initialValue);
  }, [initialValue, key]);

  return [value, patchValue, reset, setValue] as const;
}

export function WorkshopApp() {
  return (
    <WorkshopProvider>
      <Toaster position="top-center" richColors closeButton />
      <WorkshopRuntime />
    </WorkshopProvider>
  );
}

function WorkshopRuntime() {
  const { ready, currentUser, state } = useWorkshop();

  // Register service worker on mount
  useEffect(() => {
    registerServiceWorker();
  }, []);

  // Periodically check reminders and fire notifications
  useEffect(() => {
    if (!currentUser || !state) return;
    const currentState = state;

    function check() {
      if (shouldCheckReminders()) {
        checkAndNotifyReminders(currentState);
      }
    }

    // Check immediately
    check();

    // Then every 15 minutes
    const interval = window.setInterval(check, 15 * 60 * 1000);
    return () => window.clearInterval(interval);
  }, [currentUser, state]);

  if (!ready) {
    return (
      <main className="grid min-h-dvh place-items-center bg-zinc-50 px-5">
        <div className="w-full max-w-sm space-y-4">
          <div className="h-24 animate-pulse rounded-lg bg-white shadow-sm" />
          <div className="h-12 animate-pulse rounded-lg bg-zinc-200" />
          <div className="h-12 animate-pulse rounded-lg bg-zinc-100" />
        </div>
      </main>
    );
  }

  return currentUser ? <WorkspaceShell /> : <LoginScreen />;
}

function LoginScreen() {
  const { login } = useWorkshop();
  const [username, setUsername] = useState("totalflex");
  const [password, setPassword] = useState("1234");
  const [loading, setLoading] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoading(true);
    await login(username, password);
    setLoading(false);
  }

  return (
    <main className="min-h-dvh bg-white px-5 py-6 text-zinc-950">
      <div className="mx-auto flex min-h-[calc(100dvh-48px)] w-full max-w-md flex-col">
        <header className="flex items-center justify-between">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.28em] text-zinc-400">Auto Mecânica</p>
            <h1 className="mt-1 text-3xl font-black tracking-tight">Total Flex</h1>
          </div>
          <div className="grid size-12 place-items-center rounded-2xl bg-zinc-950 text-white shadow-xl shadow-zinc-950/20">
            <Wrench className="size-5" />
          </div>
        </header>

        <section className="my-10 rounded-lg border border-zinc-200 bg-zinc-50 p-4">
          <div className="rounded-lg border border-zinc-200 bg-white p-4">
            <div className="flex items-center justify-between">
              <span className="text-sm font-semibold text-zinc-500">Fila de hoje</span>
              <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs font-bold text-zinc-700">limpa</span>
            </div>
            <div className="mt-5 space-y-3">
              {["Cliente", "Veículo", "Serviço", "Pagamento"].map((item, index) => (
                <div key={item} className="flex items-center gap-3">
                  <span className="grid size-7 place-items-center rounded-full bg-zinc-950 text-xs font-black text-white">{index + 1}</span>
                  <span className="text-sm font-semibold text-zinc-700">{item}</span>
                  <span className="h-px flex-1 bg-zinc-200" />
                </div>
              ))}
            </div>
          </div>
        </section>

        <form onSubmit={handleSubmit} className="mt-auto space-y-4 rounded-lg border border-zinc-200 bg-zinc-50 p-4 shadow-sm">
          <div>
            <h2 className="text-2xl font-black tracking-tight">Entrar no sistema</h2>
            <p className="mt-1 text-sm text-zinc-500">Acesso inicial configurado para a oficina.</p>
          </div>
          <div className="space-y-2">
            <Label htmlFor="username">Usuário</Label>
            <Input id="username" value={username} onChange={(event) => setUsername(event.target.value)} autoComplete="username" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
            />
          </div>
          <Button type="submit" size="lg" className="w-full" disabled={loading}>
            <ShieldCheck /> {loading ? "Validando..." : "Acessar"}
          </Button>
        </form>
      </div>
    </main>
  );
}

function WorkspaceShell() {
  const { state, currentUser, logout } = useWorkshop();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = viewFromPath(pathname);
  const search = searchParams.toString();
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const selectedCustomerId = useMemo(() => {
    if (!state || view !== "customers") return undefined;
    const params = new URLSearchParams(search);
    const cpf = normalizeCpf(params.get("cpf") ?? "");
    return cpf ? findCustomerByCpf(state, cpf)?.id : undefined;
  }, [search, state, view]);
  const selectedOrderId = useMemo(() => {
    if (!state || view !== "orders") return undefined;
    const params = new URLSearchParams(search);
    const os = params.get("os")?.trim().toLowerCase();
    return os ? state.orders.find((item) => item.number.toLowerCase() === os || item.id === os)?.id : undefined;
  }, [search, state, view]);

  if (!state || !currentUser) return null;
  const currentState = state;

  function navigateTo(nextView: ViewId, params?: Record<string, string | undefined>) {
    const query = new URLSearchParams();
    Object.entries(params ?? {}).forEach(([key, value]) => {
      if (value) query.set(key, value);
    });
    const nextUrl = `${viewPath[nextView]}${query.size ? `?${query.toString()}` : ""}`;
    window.history.pushState(null, "", nextUrl);
  }

  function openCustomer(customerId: string) {
    const customer = currentState.customers.find((item) => item.id === customerId);
    navigateTo("customers", { cpf: customer?.cpf });
  }

  function openOrder(orderId: string) {
    const order = currentState.orders.find((item) => item.id === orderId);
    navigateTo("orders", { os: order?.number });
  }

  return (
    <main className="min-h-dvh bg-[#f5f6f8] text-zinc-950">
      <div className="mx-auto min-h-dvh w-full max-w-7xl lg:grid lg:grid-cols-[280px_1fr]">
        <aside className="hidden border-r border-zinc-200 bg-white px-5 py-6 lg:block">
          <div className="flex items-center gap-3">
            <div className="grid size-11 place-items-center rounded-full bg-zinc-950 text-white">
              <Wrench className="size-5" />
            </div>
            <div>
              <p className="text-lg font-black">Total Flex</p>
              <p className="text-xs font-medium text-zinc-500">Oficina digital</p>
            </div>
          </div>
          <nav className="mt-8 space-y-1">
            {[...tabs, { id: "settings" as ViewId, label: "Ajustes", icon: Settings }].map((tab) => {
              const Icon = tab.icon;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => navigateTo(tab.id)}
                  className={`flex h-11 w-full items-center gap-3 rounded-lg px-3 text-sm font-semibold transition ${
                    view === tab.id ? "bg-zinc-950 text-white" : "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950"
                  }`}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </aside>

        <section className="mx-auto flex min-h-dvh w-full max-w-xl flex-col bg-white shadow-sm lg:max-w-none lg:bg-transparent lg:shadow-none">
          <header className="sticky top-0 z-30 border-b border-zinc-200 bg-white/95 px-4 py-3 backdrop-blur lg:bg-[#f5f6f8]/95">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-xs font-bold uppercase tracking-[0.22em] text-zinc-400">Total Flex</p>
                <h1 className="text-lg font-black tracking-tight">{view === "home" ? "Operação" : tabs.find((tab) => tab.id === view)?.label ?? "Ajustes"}</h1>
              </div>
              <div className="flex items-center gap-2">
                <Badge variant="muted">{ROLE_LABEL[currentUser.role]}</Badge>
                <Button type="button" variant="ghost" size="icon" onClick={() => navigateTo("settings")} title="Ajustes">
                  <Settings />
                </Button>
                <Button type="button" variant="ghost" size="icon" onClick={logout} title="Sair">
                  <LogOut />
                </Button>
              </div>
            </div>
            <GlobalSearchBox onOpenCustomer={openCustomer} onOpenOrder={openOrder} />
          </header>

          <div className="flex-1 px-4 pb-28 pt-4 lg:px-6">
            <AnimatePresence mode="wait">
              <motion.div
                key={view}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.18 }}
              >
                {view === "home" ? (
                  <HomeView
                    onOpenOrder={openOrder}
                    onOpenCustomer={openCustomer}
                  />
                ) : null}
                {view === "customers" ? (
                  <CustomersView
                    selectedCustomerId={selectedCustomerId || undefined}
                    onSelectCustomer={(customerId) => {
                      if (!customerId) navigateTo("customers");
                      else openCustomer(customerId);
                    }}
                    onNewOrder={() => setOrderSheetOpen(true)}
                    onOpenOrder={openOrder}
                  />
                ) : null}
                {view === "orders" ? (
                  <OrdersView
                    selectedOrderId={selectedOrderId || undefined}
                    onSelectOrder={(orderId) => {
                      if (!orderId) navigateTo("orders");
                      else openOrder(orderId);
                    }}
                    onOpenCustomer={openCustomer}
                  />
                ) : null}
                {view === "finance" ? <FinanceView onOpenOrder={openOrder} /> : null}
                {view === "history" ? <HistoryView onOpenOrder={openOrder} onOpenCustomer={openCustomer} /> : null}
                {view === "settings" ? <SettingsView /> : null}
              </motion.div>
            </AnimatePresence>
          </div>

          <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl border-t border-zinc-200 bg-white px-3 pb-[calc(env(safe-area-inset-bottom)+10px)] pt-2 shadow-[0_-12px_32px_rgba(24,24,27,0.08)] lg:hidden">
            <div className="grid grid-cols-5 gap-1">
              {tabs.map((tab) => {
                const Icon = tab.icon;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => navigateTo(tab.id)}
                  className={`grid h-14 place-items-center rounded-xl text-[11px] font-bold transition-all duration-200 ${
                    view === tab.id ? "bg-zinc-950 text-white shadow-lg shadow-zinc-950/20" : "text-zinc-500 active:text-zinc-950"
                  }`}
                  >
                    <Icon className="size-5" />
                    <span>{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </nav>
        </section>
      </div>

      {!(view === "orders" && selectedOrderId) ? (
        <Button
          type="button"
          size="icon"
          className="fixed bottom-24 right-5 z-50 size-14 shadow-xl lg:bottom-6 lg:right-6"
          onClick={() => setCustomerSheetOpen(true)}
          title="Cadastrar ou abrir cliente"
        >
          <UserRound className="size-6" />
        </Button>
      ) : null}

      <CustomerFlowSheet open={customerSheetOpen} onOpenChange={setCustomerSheetOpen} onSelectCustomer={openCustomer} />
      <OrderFlowSheet
        key={selectedCustomerId || "order-flow"}
        open={orderSheetOpen}
        onOpenChange={setOrderSheetOpen}
        customerId={selectedCustomerId}
        onOrderCreated={(orderId) => {
          openOrder(orderId);
        }}
      />
    </main>
  );
}

function GlobalSearchBox({
  onOpenCustomer,
  onOpenOrder,
}: {
  onOpenCustomer: (customerId: string) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { state } = useWorkshop();
  const [query, setQuery] = useState("");
  const results = useMemo(() => (state ? globalSearch(state, query) : []), [query, state]);

  return (
    <div className="relative mt-3">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar CPF, nome, placa ou OS"
        className="pl-10"
        inputMode="search"
      />
      {results.length ? (
        <div className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-lg border border-zinc-200 bg-white shadow-xl">
          {results.map((result) => (
            <button
              key={`${result.type}-${result.label}-${result.detail}`}
              type="button"
              className="flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-3 py-3 text-left last:border-0 hover:bg-zinc-50"
              onClick={() => {
                setQuery("");
                if (result.type === "order") onOpenOrder(result.order.id);
                if (result.type === "customer") onOpenCustomer(result.customer.id);
                if (result.type === "vehicle" && result.customer) onOpenCustomer(result.customer.id);
              }}
            >
              <span>
                <span className="block text-sm font-bold text-zinc-950">{result.label}</span>
                <span className="block text-xs text-zinc-500">{result.detail}</span>
              </span>
              <ChevronRight className="size-4 text-zinc-400" />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function HomeView({
  onOpenOrder,
  onOpenCustomer,
}: {
  onOpenOrder: (orderId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { state } = useWorkshop();
  if (!state) return null;

  const today = new Date().toISOString().slice(0, 10);
  const inService = state.orders.filter((order) => order.status === "in_service").length;
  const waitingApproval = state.orders.filter((order) => order.status === "waiting_approval").length;
  const waitingParts = state.orders.filter((order) => order.status === "waiting_parts").length;
  const ready = state.orders.filter((order) => order.status === "finished").length;
  const pendingPayments = state.orders.filter((order) => order.paymentStatus !== "paid").length;
  const todayOrders = state.orders.filter((order) => order.createdAt.slice(0, 10) === today).length;
  const openOrders = state.orders.filter((order) => !["finished", "delivered", "cancelled"].includes(order.status)).slice(0, 5);

  return (
    <div className="space-y-5">
      <section className="rounded-xl border border-zinc-200 bg-white p-5 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-zinc-400 uppercase tracking-wide">Hoje</p>
            <h2 className="mt-1 text-3xl font-black tracking-tight">{todayOrders} atendimento{todayOrders === 1 ? "" : "s"}</h2>
          </div>
          <div className="grid size-12 place-items-center rounded-2xl bg-zinc-950 text-white shadow-lg">
            <Clock className="size-5" />
          </div>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Fazendo" value={inService} />
          <MiniStat label="Aprovar" value={waitingApproval} />
          <MiniStat label="Retirar" value={ready} />
        </div>
      </section>

      <section className="grid grid-cols-2 gap-3">
        <MetricCard label="Aguard. peças" value={waitingParts} icon={Package} tone="zinc" />
        <MetricCard label="Pagamentos" value={pendingPayments} icon={CircleDollarSign} tone="zinc" />
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-black">Fila operacional</h2>
          <Badge variant="muted">{openOrders.length} abertas</Badge>
        </div>
        {openOrders.length ? (
          openOrders.map((order) => (
            <OrderListCard key={order.id} order={order} onOpenOrder={onOpenOrder} onOpenCustomer={onOpenCustomer} compact />
          ))
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nenhuma OS aberta" text="Use o botão de cliente no canto inferior para localizar ou cadastrar um cliente." />
        )}
      </section>

      {state.reminders.length ? (
        <section className="space-y-3">
          <h2 className="text-base font-black">Próximos retornos</h2>
          {state.reminders.slice(0, 3).map((reminder) => {
            const customer = getCustomer(state, reminder.customerId);
            const vehicle = getVehicle(state, reminder.vehicleId);
            return (
              <button
                key={reminder.id}
                type="button"
                className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm"
                onClick={() => onOpenCustomer(reminder.customerId)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="font-bold">{reminder.title}</p>
                    <p className="mt-1 text-sm text-zinc-500">
                      {customer?.name} · {vehicle?.model} · {reminder.dueMileage?.toLocaleString("pt-BR")} km
                    </p>
                  </div>
                  <Badge variant="info">{formatDate(reminder.dueDate)}</Badge>
                </div>
              </button>
            );
          })}
        </section>
      ) : null}
    </div>
  );
}

function MetricCard({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: number | string;
  icon: typeof Home;
  tone: "sky" | "amber" | "rose" | "emerald" | "zinc";
}) {
  const toneClass = {
    sky: "bg-sky-50 text-sky-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
    emerald: "bg-emerald-50 text-emerald-700",
    zinc: "bg-zinc-100 text-zinc-700",
  }[tone];
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-4 shadow-sm transition hover:shadow-md">
      <div className={`grid size-9 place-items-center rounded-xl ${toneClass}`}>
        <Icon className="size-4" />
      </div>
      <p className="mt-4 text-2xl font-black tracking-tight">{value}</p>
      <p className="mt-1 text-xs font-semibold text-zinc-400 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function CustomersView({
  selectedCustomerId,
  onSelectCustomer,
  onNewOrder,
  onOpenOrder,
}: {
  selectedCustomerId?: string;
  onSelectCustomer: (customerId: string) => void;
  onNewOrder: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { state } = useWorkshop();
  const [filter, setFilter] = useState("");
  if (!state) return null;

  const selectedCustomer = state.customers.find((customer) => customer.id === selectedCustomerId);
  const filteredCustomers = state.customers.filter((customer) => {
    const query = filter.trim().toLowerCase();
    if (!query) return true;
    return customer.name.toLowerCase().includes(query) || customer.cpf.includes(normalizeCpf(query)) || customer.phone.includes(normalizePhone(query));
  });

  if (selectedCustomer) {
    return (
      <CustomerProfile
        customer={selectedCustomer}
        onBack={() => onSelectCustomer("")}
        onNewOrder={onNewOrder}
        onOpenOrder={onOpenOrder}
      />
    );
  }

  return (
    <div className="space-y-4">
      <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar clientes" />
      {filteredCustomers.map((customer) => (
        <button
          key={customer.id}
          type="button"
          className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm"
          onClick={() => onSelectCustomer(customer.id)}
        >
          <span>
            <span className="block font-bold">{customer.name}</span>
            <span className="mt-1 block text-sm text-zinc-500">
              {formatCpf(customer.cpf)} · {formatPhone(customer.phone)}
            </span>
          </span>
          <ChevronRight className="size-5 text-zinc-400" />
        </button>
      ))}
      {!filteredCustomers.length ? (
        <EmptyState icon={UsersRound} title="Nenhum cliente" text="Use o botão no canto inferior para cadastrar o primeiro cliente." />
      ) : null}
    </div>
  );
}

function CustomerProfile({
  customer,
  onBack,
  onNewOrder,
  onOpenOrder,
}: {
  customer: WorkshopState["customers"][number];
  onBack: () => void;
  onNewOrder: () => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { state } = useWorkshop();
  if (!state) return null;
  const vehicles = getVehiclesForCustomer(state, customer.id);
  const orders = getOrdersForCustomer(state, customer.id);
  const pending = orders.filter((order) => order.paymentStatus !== "paid");
  const totalSpent = orders.reduce((sum, order) => sum + getOrderTotals(state, order.id).total, 0);

  return (
    <div className="relative space-y-4">
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft /> Clientes
      </Button>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-black tracking-tight">{customer.name}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {formatCpf(customer.cpf)} · {formatPhone(customer.phone)}
            </p>
            <p className="mt-1 text-sm text-zinc-500">{customer.email || "Cliente sem e-mail"}</p>
          </div>
          <Badge variant={pending.length ? "warning" : "success"}>{pending.length ? `${pending.length} pend.` : "em dia"}</Badge>
        </div>
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Atend." value={orders.length} />
          <MiniStat label="Veículos" value={vehicles.length} />
          <MiniStat label="Total" value={formatCurrency(totalSpent)} />
        </div>
        <Button type="button" className="mt-4 w-full" onClick={onNewOrder}>
          <Plus /> Nova OS deste cliente
        </Button>
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-black">Veículos</h3>
        {vehicles.map((vehicle) => (
          <VehicleCard key={vehicle.id} vehicle={vehicle} />
        ))}
      </section>

      <section className="space-y-3">
        <h3 className="text-base font-black">Histórico de serviços</h3>
        {orders.map((order) => (
          <OrderListCard key={order.id} order={order} onOpenOrder={onOpenOrder} />
        ))}
      </section>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg bg-zinc-50 p-3 transition hover:bg-zinc-100/80">
      <p className="text-sm font-black tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] font-semibold text-zinc-500 uppercase tracking-wide">{label}</p>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
      <VehicleVisual vehicle={vehicle} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-black">
            {vehicle.brand} {vehicle.model}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatPlate(vehicle.plate)} · {vehicle.year ?? "ano n/i"} · {vehicle.color ?? "cor n/i"}
          </p>
        </div>
        <Badge variant={vehicle.lookupStatus === "found" ? "success" : "muted"}>{vehicle.lookupStatus === "found" ? "API" : "Manual"}</Badge>
      </div>
    </div>
  );
}

function VehicleVisual({ vehicle }: { vehicle: Vehicle }) {
  if (vehicle.imageUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={vehicle.imageUrl}
        alt={`${vehicle.brand} ${vehicle.model}`}
        className="h-32 w-full rounded-lg border border-zinc-200 bg-zinc-50 object-contain p-2"
      />
    );
  }

  return (
    <div className="relative h-32 overflow-hidden rounded-lg border border-zinc-200 bg-[linear-gradient(135deg,#fafafa,#eef8f5_48%,#fff7ed)]">
      <div className="absolute left-4 top-4 rounded-full bg-white/80 px-3 py-1 text-xs font-bold text-zinc-700 shadow-sm">{vehicle.category}</div>
      <Car className="absolute left-1/2 top-1/2 size-20 -translate-x-1/2 -translate-y-1/2 text-zinc-900/15" />
      <div className="absolute bottom-4 left-5 right-5 flex items-end justify-between gap-3">
        <div>
          <p className="text-sm font-black text-zinc-950">{vehicle.brand}</p>
          <p className="text-xs font-semibold text-zinc-500">{vehicle.model}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white px-3 py-2 text-xs font-bold text-zinc-700 shadow-sm">
          <span className="size-3 rounded-full border border-zinc-300 bg-white" style={{ backgroundColor: vehicle.color?.toLowerCase().includes("branco") ? "#ffffff" : "#d4d4d8" }} />
          {vehicle.color || "cor"}
        </div>
      </div>
    </div>
  );
}

function OrdersView({
  selectedOrderId,
  onSelectOrder,
  onOpenCustomer,
}: {
  selectedOrderId?: string;
  onSelectOrder: (orderId: string) => void;
  onOpenCustomer: (customerId: string) => void;
}) {
  const { state } = useWorkshop();
  const [statusFilter, setStatusFilter] = useState<"all" | OrderStatus>("all");
  if (!state) return null;

  const selectedOrder = state.orders.find((order) => order.id === selectedOrderId);
  const orders = state.orders.filter((order) => statusFilter === "all" || order.status === statusFilter);

  if (selectedOrder) {
    return (
      <OrderDetail
        key={selectedOrder.id}
        order={selectedOrder}
        onBack={() => onSelectOrder("")}
        onOpenCustomer={() => onOpenCustomer(selectedOrder.customerId)}
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-2 overflow-x-auto pb-1">
        {(["all", ...ORDER_STATUS_SEQUENCE, "cancelled"] as Array<"all" | OrderStatus>).map((status) => (
          <Button
            key={status}
            type="button"
            size="sm"
            variant={statusFilter === status ? "default" : "outline"}
            onClick={() => setStatusFilter(status)}
          >
            {status === "all" ? "Todas" : ORDER_STATUS_LABEL[status]}
          </Button>
        ))}
      </div>
      {orders.map((order) => (
        <OrderListCard key={order.id} order={order} onOpenOrder={onSelectOrder} />
      ))}
      {!orders.length ? (
        <EmptyState icon={ClipboardCheck} title="Sem ordens" text="Abra um cliente e crie a primeira OS pela ficha dele." />
      ) : null}
    </div>
  );
}

function OrderListCard({
  order,
  onOpenOrder,
  onOpenCustomer,
  compact = false,
}: {
  order: ServiceOrder;
  onOpenOrder: (orderId: string) => void;
  onOpenCustomer?: (customerId: string) => void;
  compact?: boolean;
}) {
  const { state } = useWorkshop();
  if (!state) return null;
  const customer = getCustomer(state, order.customerId);
  const vehicle = getVehicle(state, order.vehicleId);
  const items = getOrderItems(state, order.id);
  const doneItems = items.filter((item) => item.doneAt).length;
  const nextItem = items.find((item) => !item.doneAt);
  const totals = getOrderTotals(state, order.id);

  return (
    <button
      type="button"
      className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300 active:scale-[0.995]"
      onClick={() => onOpenOrder(order.id)}
      onDoubleClick={() => onOpenCustomer?.(order.customerId)}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-black">{order.number}</p>
          <p className="mt-1 text-sm text-zinc-500">
            {customer?.name} · {vehicle?.model} {formatPlate(vehicle?.plate ?? "")}
          </p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Badge variant={badgeForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          <Badge variant={badgeForPayment(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
        </div>
      </div>
      {compact ? (
        <div className="mt-3 rounded-lg bg-zinc-50 p-3">
          <div className="flex items-center justify-between gap-3 text-sm">
            <span className="font-semibold text-zinc-600">{nextItem ? `Fazer: ${nextItem.description}` : items.length ? "Tudo marcado como feito" : "Sem tarefa adicionada"}</span>
            <strong>{items.length ? `${doneItems}/${items.length}` : "0/0"}</strong>
          </div>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-zinc-200">
            <div className="h-full rounded-full bg-zinc-950" style={{ width: `${items.length ? (doneItems / items.length) * 100 : 0}%` }} />
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="KM" value={order.currentMileage.toLocaleString("pt-BR")} />
          <MiniStat label="Total" value={formatCurrency(totals.total)} />
          <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
        </div>
      )}
    </button>
  );
}

function OrderDetail({ order, onBack, onOpenCustomer }: { order: ServiceOrder; onBack: () => void; onOpenCustomer: () => void }) {
  const { state, advanceOrderStatus, updateOrder, createQuoteRevision, approveQuoteRevision } = useWorkshop();
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionPanel, setActionPanel] = useState<"menu" | "budget" | "status" | "info" | "photos" | "finish">("menu");
  const [paymentSheetOpen, setPaymentSheetOpen] = useState(false);
  const [documentSheetOpen, setDocumentSheetOpen] = useState(false);
  const [executionDraft, setExecutionDraft] = useState({
    diagnosis: order.diagnosis ?? "",
    mechanicRecommendations: order.mechanicRecommendations ?? "",
    customerNotes: order.customerNotes ?? "",
    internalNotes: order.internalNotes ?? "",
    estimatedDeliveryAt: toDateTimeLocalValue(order.estimatedDeliveryAt),
    priority: order.priority,
    mechanicId: order.mechanicId ?? "",
  });

  if (!state) return null;
  const customer = getCustomer(state, order.customerId);
  const vehicle = getVehicle(state, order.vehicleId);
  const items = getOrderItems(state, order.id);
  const completedItems = items.filter((item) => item.doneAt).length;
  const photos = state.photos.filter((photo) => photo.orderId === order.id);
  const payments = getOrderPayments(state, order.id);
  const totals = getOrderTotals(state, order.id);
  const quoteRevisions = state.quoteRevisions.filter((revision) => revision.orderId === order.id);
  const latestQuote = quoteRevisions[0];

  function handleStatus(status?: OrderStatus) {
    try {
      advanceOrderStatus(order.id, status);
      toast.success("Status atualizado.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function handleSaveExecution() {
    try {
      updateOrder(order.id, {
        diagnosis: executionDraft.diagnosis,
        mechanicRecommendations: executionDraft.mechanicRecommendations,
        customerNotes: executionDraft.customerNotes,
        internalNotes: executionDraft.internalNotes,
        estimatedDeliveryAt: fromDateTimeLocalValue(executionDraft.estimatedDeliveryAt),
        priority: executionDraft.priority,
        mechanicId: executionDraft.mechanicId || undefined,
      });
      toast.success("Execução salva.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function handleCreateQuote(status: "draft" | "sent") {
    try {
      createQuoteRevision(order.id, status);
      toast.success(status === "sent" ? "Orçamento enviado para aprovação." : "Revisão criada.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function handleApproveQuote() {
    if (!latestQuote) return;
    try {
      approveQuoteRevision(latestQuote.id);
      toast.success("Orçamento aprovado.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function sendWhatsApp() {
    if (!customer) return;
    const text = `Olá, ${customer.name}. Sua ${order.number} da Auto Mecânica Total Flex está em ${ORDER_STATUS_LABEL[order.status]}. Total: ${formatCurrency(totals.total)}. Saldo: ${formatCurrency(totals.balance)}.`;
    window.open(`https://wa.me/55${customer.phone}?text=${encodeURIComponent(text)}`, "_blank", "noopener,noreferrer");
  }

  const isAlreadyFinalized = order.status === "finished" || order.status === "delivered";
  const actionItems = [
    { id: "budget" as const, label: "Adicionar ao orçamento", icon: ReceiptText },
    { id: "status" as const, label: "Status da OS", icon: ClipboardCheck },
    { id: "info" as const, label: "Data de entrega e informações", icon: Info },
    { id: "photos" as const, label: "Fotos e Anexos", icon: Images },
    { id: "finish" as const, label: isAlreadyFinalized ? "Comprovante e documento" : "Finalizar Serviço", icon: CreditCard },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft /> Ordens
        </Button>
        <Button type="button" variant="outline" onClick={onOpenCustomer}>
          <UserRound /> Cliente
        </Button>
      </div>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-zinc-500">{customer?.name}</p>
            <h2 className="mt-1 text-2xl font-black tracking-tight">{order.number}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {vehicle?.brand} {vehicle?.model} · {formatPlate(vehicle?.plate ?? "")}
            </p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Badge variant={badgeForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge>
            <Badge variant={badgeForPayment(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
          </div>
        </div>
        {vehicle ? <div className="mt-4"><VehicleVisual vehicle={vehicle} /></div> : null}
        <div className="mt-4 grid grid-cols-3 gap-2">
          <MiniStat label="Peças" value={formatCurrency(totals.subtotalParts)} />
          <MiniStat label="M.O." value={formatCurrency(totals.subtotalLabor)} />
          <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
        </div>
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-black">O que fazer no carro</h3>
          <Badge variant="muted">
            {completedItems}/{items.length}
          </Badge>
        </div>
        {items.length ? (
          <div className="space-y-2">
            {items.map((item) => (
              <OrderItemRow key={item.id} item={item} />
            ))}
          </div>
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nada adicionado" text="A lista da OS começa limpa." />
        )}
        <div className="rounded-lg bg-zinc-50 p-3">
          <div className="flex justify-between text-sm">
            <span>Total</span>
            <strong>{formatCurrency(totals.total)}</strong>
          </div>
          <div className="mt-1 flex justify-between text-sm text-zinc-500">
            <span>Pago</span>
            <span>{formatCurrency(totals.paid)}</span>
          </div>
          <div className="mt-3 flex justify-between text-lg font-black">
            <span>Falta receber</span>
            <span>{formatCurrency(totals.balance)}</span>
          </div>
        </div>
        {latestQuote ? (
          <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-bold">Revisão {latestQuote.version}</p>
                <p className="text-xs text-zinc-500">
                  {latestQuote.status} · {formatCurrency(latestQuote.total)}
                </p>
              </div>
              {latestQuote.status !== "approved" ? (
                <Button type="button" size="sm" variant="success" onClick={handleApproveQuote}>
                  Confirmar
                </Button>
              ) : (
                <Badge variant="success">Aprovado</Badge>
              )}
            </div>
          </div>
        ) : null}
      </section>

      <section className="hidden space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-black">Status da OS</h3>
          <Button type="button" size="sm" onClick={() => handleStatus()}>
            Avançar
          </Button>
        </div>
        <div className="flex gap-2 overflow-x-auto pb-1">
          {[...ORDER_STATUS_SEQUENCE, "cancelled"].map((status) => (
            <Button
              key={status}
              type="button"
              size="sm"
              variant={order.status === status ? "default" : "outline"}
              onClick={() => handleStatus(status as OrderStatus)}
            >
              {ORDER_STATUS_LABEL[status as OrderStatus]}
            </Button>
          ))}
        </div>
      </section>

      <section className="hidden space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-zinc-500" />
          <h3 className="font-black">Agenda e responsáveis</h3>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Previsão">
            <Input
              type="datetime-local"
              value={executionDraft.estimatedDeliveryAt}
              onChange={(event) => setExecutionDraft((current) => ({ ...current, estimatedDeliveryAt: event.target.value }))}
            />
          </Field>
          <Field label="Prioridade">
            <select
              className={selectClass}
              value={executionDraft.priority}
              onChange={(event) => setExecutionDraft((current) => ({ ...current, priority: event.target.value as ServiceOrder["priority"] }))}
            >
              {Object.entries(PRIORITY_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Mecânico">
            <select
              className={selectClass}
              value={executionDraft.mechanicId}
              onChange={(event) => setExecutionDraft((current) => ({ ...current, mechanicId: event.target.value }))}
            >
              <option value="">Não definido</option>
              {state.employees
                .filter((employee) => employee.role === "mechanic" || employee.role === "admin")
                .map((employee) => (
                  <option key={employee.id} value={employee.id}>
                    {employee.name}
                  </option>
                ))}
            </select>
          </Field>
          <Field label="Consultor">
            <Input value={getEmployeeName(state, order.advisorId)} readOnly />
          </Field>
        </div>
      </section>

      <section className="hidden space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-black">Entrada do veículo</h3>
          <Badge variant="muted">{order.currentMileage.toLocaleString("pt-BR")} km</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Combustível" value={`${order.fuelLevel}%`} />
          <MiniStat label="Prioridade" value={PRIORITY_LABEL[order.priority]} />
        </div>
        <div className="rounded-lg bg-zinc-50 p-3 text-sm text-zinc-600">
          {order.entryState}
        </div>
        <PhotoUploader orderId={order.id} />
        {photos.length ? (
          <div className="grid grid-cols-3 gap-2">
            {photos.slice(0, 6).map((photo) => (
              <NextImage
                key={photo.id}
                src={photo.dataUrl}
                alt={photo.label}
                width={160}
                height={160}
                unoptimized
                className="aspect-square rounded-lg border border-zinc-200 object-cover"
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h3 className="font-black">Diagnóstico e execução</h3>
        <Field label="Diagnóstico">
          <Textarea value={executionDraft.diagnosis} onChange={(event) => setExecutionDraft((current) => ({ ...current, diagnosis: event.target.value }))} />
        </Field>
        <Field label="Recomendações do mecânico">
          <Textarea
            value={executionDraft.mechanicRecommendations}
            onChange={(event) => setExecutionDraft((current) => ({ ...current, mechanicRecommendations: event.target.value }))}
          />
        </Field>
        <Field label="Observação para o cliente">
          <Textarea value={executionDraft.customerNotes} onChange={(event) => setExecutionDraft((current) => ({ ...current, customerNotes: event.target.value }))} />
        </Field>
        <Field label="Observação interna">
          <Textarea value={executionDraft.internalNotes} onChange={(event) => setExecutionDraft((current) => ({ ...current, internalNotes: event.target.value }))} />
        </Field>
        <SignaturePad order={order} />
        <Button type="button" className="w-full" onClick={handleSaveExecution}>
          <Check /> Salvar execução
        </Button>
      </section>

      <section className="hidden space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-black">Financeiro</h3>
          <Button type="button" size="sm" onClick={() => setPaymentSheetOpen(true)}>
            <Plus /> Pagamento
          </Button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          <MiniStat label="Total" value={formatCurrency(totals.total)} />
          <MiniStat label="Pago" value={formatCurrency(totals.paid)} />
          <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
        </div>
        {payments.map((payment) => (
          <div key={payment.id} className="flex items-center justify-between rounded-lg bg-zinc-50 p-3">
            <div>
              <p className="text-sm font-bold">{PAYMENT_METHOD_LABEL[payment.method]}</p>
              <p className="text-xs text-zinc-500">{formatDateTime(payment.paidAt)}</p>
            </div>
            <strong>{formatCurrency(payment.amount)}</strong>
          </div>
        ))}
      </section>

      <section className="hidden space-y-3 rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h3 className="font-black">Documento</h3>
          <Button type="button" size="sm" onClick={() => setDocumentSheetOpen(true)}>
            <FileText /> Preview
          </Button>
        </div>
        <Button type="button" variant="outline" className="w-full" onClick={sendWhatsApp}>
          Enviar resumo por WhatsApp
        </Button>
      </section>

      <Button
        type="button"
        size="icon"
        className="fixed bottom-24 right-5 z-50 size-14 shadow-xl lg:bottom-6 lg:right-6"
        onClick={() => {
          setActionPanel("menu");
          setActionSheetOpen(true);
        }}
        title="Ações da OS"
      >
        <Wrench className="size-6" />
      </Button>

      <Sheet open={actionSheetOpen} onOpenChange={setActionSheetOpen}>
        <SheetContent className="sm:max-w-2xl">
          <SheetHeader>
            <SheetTitle>{actionPanel === "menu" ? "Ações da OS" : actionItems.find((item) => item.id === actionPanel)?.label}</SheetTitle>
            <SheetDescription>{order.number} - {customer?.name}</SheetDescription>
          </SheetHeader>
          <div className="max-h-[72dvh] overflow-y-auto px-5 pb-6">
            {actionPanel === "menu" ? (
              <div className="space-y-2">
                {actionItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActionPanel(item.id)}
                      className="flex w-full items-center justify-between rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:bg-zinc-50"
                    >
                      <span className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                          <Icon className="size-5" />
                        </span>
                        <span className="text-sm font-black">{item.label}</span>
                      </span>
                      <ChevronRight className="size-5 text-zinc-400" />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {actionPanel === "budget" ? (
              <div className="space-y-4">
                <Button type="button" variant="ghost" onClick={() => setActionPanel("menu")}>
                  <ArrowLeft /> Ações
                </Button>
                <QuickTaskEntry orderId={order.id} />
                <div className="space-y-2">
                  {items.map((item) => (
                    <OrderItemRow key={item.id} item={item} />
                  ))}
                </div>
                {items.length > 0 && (
                  <div className="rounded-lg bg-zinc-50 p-3">
                    <div className="flex justify-between text-sm">
                      <span>Total orçamento</span>
                      <strong>{formatCurrency(totals.total)}</strong>
                    </div>
                  </div>
                )}
                <Button
                  type="button"
                  className="w-full"
                  onClick={() => {
                    if (!items.length) {
                      toast.error("Adicione ao menos um serviço antes de confirmar.");
                      return;
                    }
                    handleCreateQuote("sent");
                    setActionSheetOpen(false);
                  }}
                >
                  <Check /> Confirmar
                </Button>
              </div>
            ) : null}

            {actionPanel === "status" ? (
              <div className="space-y-4">
                <Button type="button" variant="ghost" onClick={() => setActionPanel("menu")}>
                  <ArrowLeft /> Ações
                </Button>
                <div className="grid gap-2">
                  {[...ORDER_STATUS_SEQUENCE, "cancelled"].map((status) => (
                    <Button
                      key={status}
                      type="button"
                      variant={order.status === status ? "default" : "outline"}
                      onClick={() => handleStatus(status as OrderStatus)}
                      className="justify-start"
                    >
                      {ORDER_STATUS_LABEL[status as OrderStatus]}
                    </Button>
                  ))}
                </div>
              </div>
            ) : null}

            {actionPanel === "info" ? (
              <div className="space-y-4">
                <Button type="button" variant="ghost" onClick={() => setActionPanel("menu")}>
                  <ArrowLeft /> Ações
                </Button>
                <Field label="Previsão">
                  <Input
                    type="datetime-local"
                    value={executionDraft.estimatedDeliveryAt}
                    onChange={(event) => setExecutionDraft((current) => ({ ...current, estimatedDeliveryAt: event.target.value }))}
                  />
                </Field>
                <Field label="Prioridade">
                  <select
                    className={selectClass}
                    value={executionDraft.priority}
                    onChange={(event) => setExecutionDraft((current) => ({ ...current, priority: event.target.value as ServiceOrder["priority"] }))}
                  >
                    {Object.entries(PRIORITY_LABEL).map(([key, label]) => (
                      <option key={key} value={key}>
                        {label}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Mecânico">
                  <select
                    className={selectClass}
                    value={executionDraft.mechanicId}
                    onChange={(event) => setExecutionDraft((current) => ({ ...current, mechanicId: event.target.value }))}
                  >
                    <option value="">Não definido</option>
                    {state.employees
                      .filter((employee) => employee.role === "mechanic" || employee.role === "admin")
                      .map((employee) => (
                        <option key={employee.id} value={employee.id}>
                          {employee.name}
                        </option>
                      ))}
                  </select>
                </Field>
                <Button type="button" className="w-full" onClick={handleSaveExecution}>
                  <Check /> Salvar informações
                </Button>
              </div>
            ) : null}

            {actionPanel === "photos" ? (
              <PhotoPanel orderId={order.id} photos={photos} onBack={() => setActionPanel("menu")} />
            ) : null}

            {actionPanel === "finish" ? (
              <FinalizeServicePanel orderId={order.id} onBack={() => setActionPanel("menu")} />
            ) : null}
          </div>
        </SheetContent>
      </Sheet>

      <PaymentSheet open={paymentSheetOpen} onOpenChange={setPaymentSheetOpen} orderId={order.id} />
      <DocumentSheet open={documentSheetOpen} onOpenChange={setDocumentSheetOpen} orderId={order.id} />
    </div>
  );
}

function Field({ label, children, error }: { label: string; children: ReactNode; error?: string }) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs font-bold text-rose-600">{error}</p> : null}
    </div>
  );
}

function PhotoUploader({ orderId }: { orderId: string }) {
  const { addPhoto } = useWorkshop();

  function handleFiles(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        addPhoto(orderId, String(reader.result), file.name);
        toast.success("Foto anexada.");
      } catch (error) {
        toast.error(errorMessage(error));
      }
    };
    reader.readAsDataURL(file);
  }

  return (
    <label className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-full border border-dashed border-zinc-300 bg-zinc-50 text-sm font-bold text-zinc-700">
      <Camera className="size-4" />
      Fotografar ou anexar
      <input type="file" accept="image/*" capture="environment" className="sr-only" onChange={handleFiles} />
    </label>
  );
}

function PhotoPanel({ orderId, photos, onBack }: { orderId: string; photos: { id: string; dataUrl: string; label: string; createdAt: string }[]; onBack: () => void }) {
  const { removePhoto } = useWorkshop();
  const [deletingId, setDeletingId] = useState<string | null>(null);

  function handleDelete(photoId: string) {
    try {
      removePhoto(photoId);
      toast.success("Foto removida.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft /> Ações
      </Button>
      <PhotoUploader orderId={orderId} />
      {photos.length ? (
        <div className="grid grid-cols-3 gap-2">
          {photos.map((photo) => (
            <div key={photo.id} className="relative group">
              <NextImage
                src={photo.dataUrl}
                alt={photo.label}
                width={160}
                height={160}
                unoptimized
                className="aspect-square rounded-lg border border-zinc-200 object-cover"
              />
              <button
                type="button"
                onClick={() => handleDelete(photo.id)}
                className="absolute top-1 right-1 grid size-7 place-items-center rounded-full bg-black/60 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                title="Remover foto"
              >
                <Trash2 className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <EmptyState icon={Camera} title="Sem anexos" text="Adicione fotos da entrada, peças ou execução." />
      )}
    </div>
  );
}

function QuickTaskEntry({ orderId }: { orderId: string }) {
  const { addOrderItem } = useWorkshop();
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const cleanDescription = description.trim();
    if (!cleanDescription) {
      toast.error("Digite o serviço.");
      return;
    }

    try {
      addOrderItem(orderId, {
        type: "custom",
        description: cleanDescription,
        quantity: 1,
        unitPrice: parseCurrencyInput(price),
        laborPrice: 0,
        discount: 0,
        cost: 0,
        notes: "",
      });
      setDescription("");
      setPrice("");
      toast.success("Item adicionado.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <form onSubmit={submit} className="grid grid-cols-[1fr_96px_44px] gap-2 sm:grid-cols-[1fr_128px_44px]">
      <Input
        value={description}
        onChange={(event) => setDescription(event.target.value)}
        placeholder="Ex.: Troca de óleo"
        enterKeyHint="done"
        aria-label="Serviço a fazer"
      />
      <Input
        value={price}
        onChange={(event) => setPrice(event.target.value)}
        placeholder="R$ 0,00"
        inputMode="decimal"
        enterKeyHint="done"
        aria-label="Valor"
      />
      <Button type="submit" size="icon" title="Adicionar">
        <Plus />
      </Button>
    </form>
  );
}

function OrderItemRow({ item }: { item: OrderItem }) {
  const { removeOrderItem, toggleOrderItemDone, updateOrderItem } = useWorkshop();
  const [editing, setEditing] = useState(false);
  const [description, setDescription] = useState(item.description);
  const [price, setPrice] = useState(String(item.unitPrice + item.laborPrice));
  const total = item.quantity * (item.unitPrice + item.laborPrice) - item.discount;
  const done = Boolean(item.doneAt);

  function saveEdit() {
    try {
      const value = parseCurrencyInput(price);
      updateOrderItem(item.id, { description, unitPrice: value, laborPrice: 0 });
      setEditing(false);
      toast.success("Item atualizado.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <div className={`rounded-lg border p-3 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-zinc-200 bg-zinc-50"}`}>
      <div className="flex items-center justify-between gap-3">
        <button
          type="button"
          onClick={() => toggleOrderItemDone(item.id, !done)}
          className={`grid size-10 shrink-0 place-items-center rounded-full border transition ${
            done ? "border-emerald-600 bg-emerald-600 text-white" : "border-zinc-300 bg-white text-zinc-400"
          }`}
          title={done ? "Reabrir" : "Marcar como feito"}
        >
          <Check className="size-5" />
        </button>
        <div className="min-w-0 flex-1">
          {editing ? (
            <div className="grid gap-2 sm:grid-cols-[1fr_120px_auto]">
              <Input value={description} onChange={(event) => setDescription(event.target.value)} className="h-10" />
              <Input value={price} onChange={(event) => setPrice(event.target.value)} className="h-10" inputMode="decimal" />
              <Button type="button" size="sm" onClick={saveEdit}>
                Salvar
              </Button>
            </div>
          ) : (
            <>
              <p className={`text-sm font-bold ${done ? "text-emerald-900 line-through decoration-emerald-600/60" : "text-zinc-950"}`}>
                {item.description}
              </p>
              <p className="mt-1 text-xs text-zinc-500">{done ? `Feito em ${formatDateTime(item.doneAt)}` : "Pendente"}</p>
            </>
          )}
        </div>
        <div className="text-right">
          <p className="text-sm font-black">{formatCurrency(total)}</p>
          <div className="mt-1 flex justify-end gap-2 text-xs font-bold">
            <button type="button" className="text-zinc-600" onClick={() => setEditing((value) => !value)}>
              editar
            </button>
            <button type="button" className="text-rose-600" onClick={() => removeOrderItem(item.id)}>
              remover
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function EmptyState({ icon: Icon, title, text }: { icon: typeof Home; title: string; text: string }) {
  return (
    <div className="grid place-items-center rounded-lg border border-dashed border-zinc-300 bg-zinc-50 p-6 text-center">
      <Icon className="size-8 text-zinc-400" />
      <p className="mt-3 font-black">{title}</p>
      <p className="mt-1 text-sm text-zinc-500">{text}</p>
    </div>
  );
}

function CustomerFlowSheet({
  open,
  onOpenChange,
  onSelectCustomer,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectCustomer: (customerId: string) => void;
}) {
  const { state, createOrUpdateCustomer } = useWorkshop();
  const initial = useMemo(
    () => ({
      step: "cpf",
      cpf: "",
      name: "",
      phone: "",
      email: "",
      noEmail: false,
      address: "",
      district: "",
    }),
    [],
  );
  const [draft, patchDraft, resetDraft] = useDraftState("tf-customer-flow", initial);
  const [feedback, setFeedback] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});

  function handleCpf(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!state) return;
    const cpf = normalizeCpf(String(draft.cpf));
    if (!isValidCpf(cpf)) {
      setErrors({ cpf: "CPF inválido." });
      setFeedback("CPF inválido.");
      return;
    }
    const existing = findCustomerByCpf(state, cpf);
    if (existing) {
      resetDraft();
      onSelectCustomer(existing.id);
      onOpenChange(false);
      toast.success("Cliente localizado.");
      return;
    }
    setFeedback("");
    setErrors({});
    patchDraft({ cpf, step: "profile" });
  }

  function handleProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const result = createOrUpdateCustomer({
        cpf: String(draft.cpf),
        name: String(draft.name),
        phone: String(draft.phone),
        email: String(draft.email),
        noEmail: Boolean(draft.noEmail),
        address: String(draft.address),
        district: String(draft.district),
      });
      resetDraft();
      setErrors({});
      onSelectCustomer(result.customer.id);
      onOpenChange(false);
      toast.success(result.created ? "Cliente cadastrado." : "Cliente atualizado.");
    } catch (error) {
      setErrors(fieldErrors(error));
      setFeedback(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Cliente</SheetTitle>
          <SheetDescription>Comece pelo CPF para evitar duplicidade e abrir a ficha correta.</SheetDescription>
        </SheetHeader>
        <div className="max-h-[72dvh] overflow-y-auto px-5 pb-6">
          {draft.step === "cpf" ? (
            <form onSubmit={handleCpf} className="space-y-4">
              <Field label="CPF" error={errors.cpf}>
                <Input
                  value={formatCpf(String(draft.cpf))}
                  onChange={(event) => {
                    setErrors((current) => ({ ...current, cpf: "" }));
                    patchDraft({ cpf: normalizeCpf(event.target.value) });
                  }}
                  inputMode="numeric"
                  autoFocus
                  placeholder="000.000.000-00"
                  className={invalidFieldClass(errors.cpf)}
                />
              </Field>
              {feedback ? <p className="text-sm font-semibold text-rose-600">{feedback}</p> : null}
              <Button type="submit" className="w-full">
                Continuar
              </Button>
            </form>
          ) : (
            <form onSubmit={handleProfile} className="space-y-4">
              <Button type="button" variant="ghost" onClick={() => patchDraft({ step: "cpf" })}>
                <ArrowLeft /> CPF
              </Button>
              <Field label="Nome completo" error={errors.name}>
                <Input value={String(draft.name)} onChange={(event) => patchDraft({ name: event.target.value })} autoFocus className={invalidFieldClass(errors.name)} />
              </Field>
              <Field label="Telefone" error={errors.phone}>
                <Input
                  value={formatPhone(String(draft.phone))}
                  onChange={(event) => patchDraft({ phone: normalizePhone(event.target.value) })}
                  inputMode="tel"
                  className={invalidFieldClass(errors.phone)}
                />
              </Field>
              <Field label="E-mail" error={errors.email}>
                <Input
                  value={String(draft.email)}
                  onChange={(event) => patchDraft({ email: event.target.value })}
                  type="email"
                  disabled={Boolean(draft.noEmail)}
                  className={invalidFieldClass(errors.email)}
                />
              </Field>
              <label className="flex items-center gap-3 rounded-lg bg-zinc-50 p-3 text-sm font-semibold text-zinc-700">
                <input
                  type="checkbox"
                  checked={Boolean(draft.noEmail)}
                  onChange={(event) => patchDraft({ noEmail: event.target.checked, email: event.target.checked ? "" : String(draft.email) })}
                  className="size-5 accent-zinc-950"
                />
                Cliente não possui e-mail
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Endereço">
                  <Input value={String(draft.address)} onChange={(event) => patchDraft({ address: event.target.value })} />
                </Field>
                <Field label="Bairro">
                  <Input value={String(draft.district)} onChange={(event) => patchDraft({ district: event.target.value })} />
                </Field>
              </div>
              {feedback ? <p className="text-sm font-semibold text-rose-600">{feedback}</p> : null}
              <Button type="submit" className="w-full">
                Salvar cliente
              </Button>
            </form>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function OrderFlowSheet({
  open,
  onOpenChange,
  customerId,
  onOrderCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  customerId?: string;
  onOrderCreated: (orderId: string) => void;
}) {
  const { state, createOrUpdateVehicle, createOrder } = useWorkshop();
  const [lookup, setLookup] = useState<VehicleLookupResult | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const initial = useMemo(
    () => ({
      step: "plate",
      customerId: customerId ?? "",
      plate: "",
      vehicleId: "",
      brand: "",
      model: "",
      version: "",
      year: "",
      color: "",
      category: "car",
      currentMileage: "",
      fuelLevel: "",
      entryState: "",
      priority: "normal",
      mechanicId: "",
      estimatedDeliveryAt: "",
      customerNotes: "",
      internalNotes: "",
      operationKey: newId("order_op"),
    }),
    [customerId],
  );
  const [draft, patchDraft, resetDraft] = useDraftState(`tf-order-flow-${customerId ?? "none"}`, initial);
  const [errors, setErrors] = useState<Record<string, string>>({});

  if (!state) return null;
  const currentState = state;
  const customer = currentState.customers.find((item) => item.id === String(draft.customerId));
  const selectedVehicle = currentState.vehicles.find((item) => item.id === String(draft.vehicleId));

  async function handlePlate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plate = normalizePlate(String(draft.plate));
    if (!isLikelyPlate(plate)) {
      setErrors({ plate: "Placa inválida." });
      toast.error("Placa inválida.");
      return;
    }
    setErrors({});
    const existing = findVehicleByPlate(currentState, plate);
    if (existing && existing.customerId !== String(draft.customerId)) {
      toast.error("Placa já vinculada a outro cliente.");
      return;
    }
    if (existing) {
      patchDraft({
        vehicleId: existing.id,
        brand: existing.brand,
        model: existing.model,
        version: existing.version ?? "",
        year: existing.year ? String(existing.year) : "",
        color: existing.color ?? "",
        category: existing.category,
        step: "order",
      });
      return;
    }
    setLookupLoading(true);
    const result = await lookupVehicleByPlate(plate);
    setLookup(result);
    setLookupLoading(false);
    if (result.status === "found") {
      patchDraft({
        plate,
        brand: result.brand,
        model: result.model,
        version: result.version ?? "",
        year: result.year ? String(result.year) : "",
        color: result.color ?? "",
        category: result.category ?? "car",
        step: "vehicle",
      });
    } else {
      patchDraft({ plate, step: "vehicle" });
      toast.info(result.message);
    }
  }

  async function handleVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const imageUrl =
        lookup?.status === "found" && lookup.imageUrl
          ? lookup.imageUrl
          : await lookupVehicleImage(String(draft.brand), String(draft.model), String(draft.year));
      const lookupForSave =
        lookup?.status === "found"
          ? { ...lookup, imageUrl: lookup.imageUrl ?? imageUrl }
          : imageUrl
            ? ({
                status: "found",
                brand: String(draft.brand),
                model: String(draft.model),
                version: String(draft.version) || undefined,
                year: draft.year ? Number(draft.year) : undefined,
                color: String(draft.color) || undefined,
                category: String(draft.category) as Vehicle["category"],
                provider: "Wikimedia Commons",
                imageUrl,
              } satisfies VehicleLookupResult)
            : lookup;
      const result = createOrUpdateVehicle(
        String(draft.customerId),
        {
          plate: String(draft.plate),
          brand: String(draft.brand),
          model: String(draft.model),
          version: String(draft.version),
          year: draft.year ? Number(draft.year) : undefined,
          color: String(draft.color),
          category: String(draft.category) as Vehicle["category"],
        },
        lookupForSave ?? undefined,
      );
      patchDraft({ vehicleId: result.vehicle.id, step: "order" });
      setErrors({});
      toast.success(result.created ? "Veículo cadastrado." : "Veículo atualizado.");
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    }
  }

  function handleOrder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const order = createOrder(
        String(draft.customerId),
        String(draft.vehicleId),
        {
          currentMileage: draft.currentMileage === "" ? undefined : Number(draft.currentMileage),
          fuelLevel: draft.fuelLevel === "" ? undefined : Number(draft.fuelLevel),
          entryState: String(draft.entryState),
          priority: String(draft.priority) as ServiceOrder["priority"],
          mechanicId: String(draft.mechanicId) || undefined,
          estimatedDeliveryAt: fromDateTimeLocalValue(String(draft.estimatedDeliveryAt)),
          customerNotes: String(draft.customerNotes),
          internalNotes: String(draft.internalNotes),
        },
        String(draft.operationKey),
      );
      resetDraft();
      setErrors({});
      onOrderCreated(order.id);
      onOpenChange(false);
      toast.success(`${order.number} criada.`);
    } catch (error) {
      setErrors(fieldErrors(error));
      toast.error(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Nova Ordem de Serviço</SheetTitle>
          <SheetDescription>Cliente, placa, veículo e entrada em etapas curtas.</SheetDescription>
        </SheetHeader>
        <div className="max-h-[72dvh] overflow-y-auto px-5 pb-6">
          {!customer ? (
            <div className="space-y-3">
              <Field label="Cliente">
                <select className={selectClass} value={String(draft.customerId)} onChange={(event) => patchDraft({ customerId: event.target.value })}>
                  <option value="">Selecione</option>
                  {currentState.customers.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name}
                    </option>
                  ))}
                </select>
              </Field>
            </div>
          ) : null}

          {customer && draft.step === "plate" ? (
            <form onSubmit={handlePlate} className="space-y-4">
              <div className="rounded-lg bg-zinc-50 p-3">
                <p className="text-sm font-bold">{customer.name}</p>
                <p className="text-xs text-zinc-500">{formatCpf(customer.cpf)}</p>
              </div>
              <Field label="Placa" error={errors.plate}>
                <Input
                  value={formatPlate(String(draft.plate))}
                  onChange={(event) => {
                    setErrors((current) => ({ ...current, plate: "" }));
                    patchDraft({ plate: normalizePlate(event.target.value) });
                  }}
                  placeholder="ABC-1D23"
                  autoFocus
                  className={invalidFieldClass(errors.plate)}
                />
              </Field>
              <Button type="submit" className="w-full" disabled={lookupLoading}>
                {lookupLoading ? "Consultando..." : "Consultar veículo"}
              </Button>
            </form>
          ) : null}

          {customer && draft.step === "vehicle" ? (
            <form onSubmit={handleVehicle} className="space-y-4">
              <Button type="button" variant="ghost" onClick={() => patchDraft({ step: "plate" })}>
                <ArrowLeft /> Placa
              </Button>
              {lookup ? (
                <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 text-sm">
                  <p className="font-bold">{lookup.status === "found" ? "Dados encontrados" : "Cadastro manual liberado"}</p>
                  <p className="mt-1 text-zinc-500">{lookup.status === "found" ? lookup.provider : lookup.message}</p>
                </div>
              ) : null}
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Marca" error={errors.brand}>
                  <Input value={String(draft.brand)} onChange={(event) => patchDraft({ brand: event.target.value })} className={invalidFieldClass(errors.brand)} />
                </Field>
                <Field label="Modelo" error={errors.model}>
                  <Input value={String(draft.model)} onChange={(event) => patchDraft({ model: event.target.value })} className={invalidFieldClass(errors.model)} />
                </Field>
                <Field label="Versão">
                  <Input value={String(draft.version)} onChange={(event) => patchDraft({ version: event.target.value })} />
                </Field>
                <Field label="Ano" error={errors.year}>
                  <Input value={String(draft.year)} onChange={(event) => patchDraft({ year: event.target.value })} inputMode="numeric" className={invalidFieldClass(errors.year)} />
                </Field>
                <Field label="Cor">
                  <Input value={String(draft.color)} onChange={(event) => patchDraft({ color: event.target.value })} />
                </Field>
                <Field label="Categoria" error={errors.category}>
                  <select className={selectFieldClass(errors.category)} value={String(draft.category)} onChange={(event) => patchDraft({ category: event.target.value })}>
                    <option value="car">Carro</option>
                    <option value="motorcycle">Moto</option>
                    <option value="truck">Caminhão</option>
                    <option value="van">Van</option>
                    <option value="other">Outro</option>
                  </select>
                </Field>
              </div>
              <Button type="submit" className="w-full">
                Continuar
              </Button>
            </form>
          ) : null}

          {customer && draft.step === "order" ? (
            <form onSubmit={handleOrder} className="space-y-4">
              <Button type="button" variant="ghost" onClick={() => patchDraft({ step: "vehicle" })}>
                <ArrowLeft /> Veículo
              </Button>
              {selectedVehicle ? <VehicleCard vehicle={selectedVehicle} /> : null}
              <Field label="Quilometragem atual" error={errors.currentMileage}>
                <Input
                  value={String(draft.currentMileage)}
                  onChange={(event) => patchDraft({ currentMileage: event.target.value })}
                  inputMode="numeric"
                  placeholder="Opcional"
                  className={invalidFieldClass(errors.currentMileage)}
                />
              </Field>
              <Field label="Combustível">
                <div className="grid grid-cols-5 gap-1.5">
                  {["0", "25", "50", "75", "100"].map((level) => (
                    <button
                      key={level}
                      type="button"
                      onClick={() => patchDraft({ fuelLevel: level })}
                      className={`h-11 rounded-lg border text-sm font-black transition ${
                        String(draft.fuelLevel) === level
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white text-zinc-600"
                      }`}
                    >
                      {level}%
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Estado de entrada">
                <Textarea
                  value={String(draft.entryState)}
                  onChange={(event) => patchDraft({ entryState: event.target.value })}
                  placeholder="Avarias, riscos, barulhos ou pedido do cliente"
                />
              </Field>
              <Button type="submit" className="w-full">
                Criar OS
              </Button>
            </form>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function PaymentSheet({ open, onOpenChange, orderId }: { open: boolean; onOpenChange: (open: boolean) => void; orderId: string }) {
  const { state, recordPayment } = useWorkshop();
  const totals = state ? getOrderTotals(state, orderId) : undefined;
  const [form, setForm] = useState({
    method: "pix" as PaymentMethod,
    amount: "" as number | "",
    reference: "",
  });
  const paymentAmount = form.amount === "" ? totals?.balance ?? 0 : form.amount;

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      recordPayment(orderId, { ...form, amount: paymentAmount }, newId("payment_op"));
      onOpenChange(false);
      toast.success("Pagamento registrado.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>Pagamento</SheetTitle>
          <SheetDescription>Registre recebimento parcial ou total sem alterar o status da execução.</SheetDescription>
        </SheetHeader>
        <form onSubmit={handleSubmit} className="space-y-4 px-5 pb-6">
          <div className="rounded-lg bg-zinc-50 p-3">
            <p className="text-sm font-bold">Saldo restante</p>
            <p className="text-2xl font-black">{formatCurrency(totals?.balance ?? 0)}</p>
          </div>
          <Field label="Forma">
            <select className={selectClass} value={form.method} onChange={(event) => setForm((current) => ({ ...current, method: event.target.value as PaymentMethod }))}>
              {Object.entries(PAYMENT_METHOD_LABEL).map(([key, label]) => (
                <option key={key} value={key}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Valor">
            <Input type="number" min="0" step="0.01" value={paymentAmount} onChange={(event) => setForm((current) => ({ ...current, amount: Number(event.target.value) }))} />
          </Field>
          <Field label="Referência">
            <Input value={form.reference} onChange={(event) => setForm((current) => ({ ...current, reference: event.target.value }))} />
          </Field>
          <Button type="submit" className="w-full">
            Receber
          </Button>
        </form>
      </SheetContent>
    </Sheet>
  );
}

function DocumentSheet({ open, onOpenChange, orderId }: { open: boolean; onOpenChange: (open: boolean) => void; orderId: string }) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="sm:max-w-3xl">
        <SheetHeader>
          <SheetTitle>Documento</SheetTitle>
          <SheetDescription>Preview do documento digital antes de baixar, imprimir ou compartilhar.</SheetDescription>
        </SheetHeader>
        <div className="max-h-[72dvh] overflow-y-auto px-5 pb-6">
          <DocumentPreview orderId={orderId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FinalizeServicePanel({ orderId, onBack }: { orderId: string; onBack: () => void }) {
  const { state, finishService } = useWorkshop();
  const order = state?.orders.find((item) => item.id === orderId);
  const totals = state && order ? getOrderTotals(state, order.id) : undefined;
  const docs = state?.documents.filter((d) => d.orderId === orderId && d.type === "service_order") ?? [];
  const latestDoc = docs[0];
  const alreadyFinished = order?.status === "finished" || order?.status === "delivered";

  // Track original total so we know if user actually changed the amount
  const originalTotal = totals ? totals.total : 0;

  const [finalAmount, setFinalAmount] = useState(originalTotal);
  const [finalAmountInput, setFinalAmountInput] = useState(originalTotal.toFixed(2).replace(".", ","));
  const [userChangedAmount, setUserChangedAmount] = useState(false);
  const [signature, setSignature] = useState("");
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const [logoDataUrl, setLogoDataUrl] = useState("");
  const [showReFinalize, setShowReFinalize] = useState(false);
  const [customInstallment, setCustomInstallment] = useState("");
  const [showCustomInstallment, setShowCustomInstallment] = useState(false);

  // Payment method state
  const [paymentMethod, setPaymentMethod] = useState<"none" | "cash" | "pix" | "credit" | "debit">("none");
  const [cashReceived, setCashReceived] = useState("");
  const [creditInstallments, setCreditInstallments] = useState(1);

  // Derived payment calculations
  const effectiveInstallments = showCustomInstallment && customInstallment ? Number(customInstallment) || 1 : creditInstallments;
  const cashReceivedNum = parseCurrencyInput(cashReceived);
  const change = cashReceived ? Math.max(0, cashReceivedNum - finalAmount) : 0;
  const remaining = cashReceived ? Math.max(0, finalAmount - cashReceivedNum) : finalAmount;
  const installmentValue = effectiveInstallments > 0 ? finalAmount / effectiveInstallments : finalAmount;

  useEffect(() => {
    let cancelled = false;
    void fetch("/assets/logo.png")
      .then((response) => response.blob())
      .then(
        (blob) =>
          new Promise<string>((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result));
            reader.onerror = reject;
            reader.readAsDataURL(blob);
          }),
      )
      .then((dataUrl) => {
        if (!cancelled) setLogoDataUrl(dataUrl);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  if (!state || !order || !totals) return null;
  const currentState = state;
  const currentOrder = order;
  const currentTotals = totals;

  function handleFinalAmountChange(raw: string) {
    setFinalAmountInput(raw);
    const parsed = parseCurrencyInput(raw);
    setFinalAmount(parsed);
    setUserChangedAmount(Math.abs(parsed - originalTotal) >= 0.01);
  }

  function finish() {
    try {
      const generated = finishService(
        currentOrder.id,
        {
          finalAmount,
          mechanicSignatureDataUrl: signature || undefined,
          userChangedAmount,
        },
        newId("document_op"),
      );
      setDocument(generated);
      toast.success("Serviço finalizado e documento salvo no histórico.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function handlePdf(mode: "download" | "print" | "share") {
    const pdfOrder = currentState.orders.find((item) => item.id === orderId) ?? currentOrder;
    const pdf = buildDocumentPdf(currentState, pdfOrder, "service_order", logoDataUrl);
    const fileName = `${pdfOrder.number}-final.pdf`;

    if (mode === "download") {
      pdf.save(fileName);
      return;
    }

    const blob = pdf.output("blob");
    const url = URL.createObjectURL(blob);
    if (mode === "print") {
      window.open(url, "_blank", "noopener,noreferrer");
      return;
    }

    const file = new File([blob], fileName, { type: "application/pdf" });
    if (navigator.canShare?.({ files: [file] })) {
      void navigator.share({ title: fileName, files: [file] });
    } else {
      pdf.save(fileName);
    }
  }

  const paymentMethods = [
    { id: "none" as const, label: "Não registrar" },
    { id: "cash" as const, label: "Dinheiro" },
    { id: "pix" as const, label: "Pix" },
    { id: "debit" as const, label: "Débito" },
    { id: "credit" as const, label: "Crédito" },
  ];

  // Already finalized view
  if (alreadyFinished && !showReFinalize && !document) {
    return (
      <div className="space-y-4">
        <Button type="button" variant="ghost" onClick={onBack}>
          <ArrowLeft /> Ações
        </Button>

        <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-emerald-100">
              <Check className="size-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-black text-emerald-950">Serviço já finalizado</p>
              <p className="text-sm text-emerald-700">Esta OS já foi concluída e possui documento gerado.</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-zinc-600">Deseja alterar algo na nota ou apenas realizar o download novamente do comprovante?</p>

        <div className="space-y-2">
          {latestDoc && (
            <div className="rounded-lg border border-zinc-200 bg-white p-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-bold">Documento v{latestDoc.version}</p>
                  <p className="text-xs text-zinc-500">{formatDateTime(latestDoc.createdAt)} · {formatCurrency(latestDoc.total)}</p>
                </div>
                <Badge variant="success">Gerado</Badge>
              </div>
            </div>
          )}

          {latestDoc && (
            <div className="grid grid-cols-3 gap-2">
              <Button type="button" variant="outline" onClick={() => handlePdf("download")}>
                <Download /> Baixar
              </Button>
              <Button type="button" variant="outline" onClick={() => handlePdf("share")}>
                <Share2 /> Compartilhar
              </Button>
              <Button type="button" variant="outline" onClick={() => handlePdf("print")}>
                <Printer /> Imprimir
              </Button>
            </div>
          )}

          <Button type="button" variant="outline" className="w-full" onClick={() => setShowReFinalize(true)}>
            <FileText /> Alterar e gerar nova versão
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <Button type="button" variant="ghost" onClick={onBack}>
        <ArrowLeft /> Ações
      </Button>

      {/* Summary */}
      <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm font-bold">{showReFinalize ? "Gerar nova versão" : "Conferência final"}</p>
        <p className="mt-1 text-xs text-zinc-500">Confirme os valores antes de gerar o documento final.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Itens" value={getOrderItems(currentState, currentOrder.id).length} />
          <MiniStat label="Total atual" value={formatCurrency(currentTotals.total)} />
          <MiniStat label="Saldo" value={formatCurrency(currentTotals.balance)} />
        </div>
      </div>

      {/* Final amount — only show edit if not yet finalized */}
      {!document ? (
        <>
          <Field label="Valor final (edite somente se precisar ajustar)">
            <Input
              value={finalAmountInput}
              onChange={(event) => handleFinalAmountChange(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
            {userChangedAmount && (
              <p className="mt-1 text-xs font-semibold text-amber-600">
                ⚠ Valor alterado — será adicionado um item de ajuste ao orçamento.
              </p>
            )}
          </Field>

          {/* Payment method */}
          <div className="space-y-3">
            <Label>Como o cliente pagou?</Label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => { setPaymentMethod(method.id); setShowCustomInstallment(false); setCustomInstallment(""); }}
                  className={`rounded-lg border px-2 py-2.5 text-xs font-bold transition ${
                    paymentMethod === method.id
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>

            {/* Cash / Pix — show change */}
            {(paymentMethod === "cash" || paymentMethod === "pix") && (
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <Field label="Valor recebido">
                  <Input
                    value={cashReceived}
                    onChange={(event) => setCashReceived(event.target.value)}
                    inputMode="decimal"
                    placeholder="0,00"
                  />
                </Field>
                {cashReceived && (
                  <div className="grid grid-cols-2 gap-2">
                    {change > 0 ? (
                      <div className="rounded-lg bg-emerald-50 p-3 text-center">
                        <p className="text-xs font-semibold text-emerald-700">Troco</p>
                        <p className="text-lg font-black text-emerald-900">{formatCurrency(change)}</p>
                      </div>
                    ) : null}
                    {remaining > 0 ? (
                      <div className="rounded-lg bg-amber-50 p-3 text-center">
                        <p className="text-xs font-semibold text-amber-700">Falta pagar</p>
                        <p className="text-lg font-black text-amber-900">{formatCurrency(remaining)}</p>
                      </div>
                    ) : (
                      change === 0 && cashReceived ? (
                        <div className="col-span-2 rounded-lg bg-emerald-50 p-3 text-center">
                          <p className="text-sm font-black text-emerald-900">✓ Pagamento exato!</p>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Credit — show installments */}
            {paymentMethod === "credit" && (
              <div className="space-y-3 rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <Field label="Número de parcelas">
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {[1, 2, 3, 4, 6, 12].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setCreditInstallments(n); setShowCustomInstallment(false); setCustomInstallment(""); }}
                        className={`rounded-lg border py-2.5 text-sm font-black transition ${
                          !showCustomInstallment && creditInstallments === n
                            ? "border-zinc-950 bg-zinc-950 text-white"
                            : "border-zinc-200 bg-white text-zinc-600"
                        }`}
                      >
                        {n}x
                      </button>
                    ))}
                    <button
                      type="button"
                      onClick={() => setShowCustomInstallment((v) => !v)}
                      className={`rounded-lg border py-2.5 text-sm font-black transition ${
                        showCustomInstallment
                          ? "border-zinc-950 bg-zinc-950 text-white"
                          : "border-zinc-200 bg-white text-zinc-600"
                      }`}
                    >
                      +
                    </button>
                  </div>
                </Field>
                {showCustomInstallment && (
                  <Field label="Quantas parcelas?">
                    <Input
                      type="number"
                      min="1"
                      max="48"
                      value={customInstallment}
                      onChange={(event) => setCustomInstallment(event.target.value)}
                      placeholder="Ex.: 15, 18, 24..."
                      inputMode="numeric"
                      autoFocus
                    />
                  </Field>
                )}
                <div className="rounded-lg bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-600">
                      {effectiveInstallments}x de
                    </span>
                    <span className="text-lg font-black">{formatCurrency(installmentValue)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Total</span>
                    <span className="text-sm font-bold">{formatCurrency(finalAmount)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Debit */}
            {paymentMethod === "debit" && (
              <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">Total no débito</span>
                  <span className="text-lg font-black">{formatCurrency(finalAmount)}</span>
                </div>
              </div>
            )}
          </div>

          <MechanicSignatureCapture value={signature} onChange={setSignature} />

          <Button type="button" className="w-full" onClick={finish}>
            <Check /> {showReFinalize ? "Gerar nova versão do documento" : "Confirmar e gerar documento"}
          </Button>
        </>
      ) : (
        <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-black text-emerald-950">Documento salvo</p>
              <p className="text-xs text-emerald-800">Versão {document.version} no histórico da OS.</p>
            </div>
            <Badge variant="success">Finalizado</Badge>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Button type="button" variant="outline" onClick={() => handlePdf("download")}>
              <Download /> Baixar
            </Button>
            <Button type="button" variant="outline" onClick={() => handlePdf("share")}>
              <Share2 /> Compartilhar
            </Button>
            <Button type="button" variant="outline" onClick={() => handlePdf("print")}>
              <Printer /> Imprimir
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function MechanicSignatureCapture({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#18181b";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    if (value) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = value;
    }
  }, [value]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawingRef.current = true;
    const position = point(event);
    context.beginPath();
    context.moveTo(position.x, position.y);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const position = point(event);
    context.lineTo(position.x, position.y);
    context.stroke();
  }

  function stop() {
    drawingRef.current = false;
    const canvas = canvasRef.current;
    if (canvas) onChange(canvas.toDataURL("image/png"));
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    onChange("");
  }

  return (
    <div className="space-y-2">
      <Label>Assinatura do mecânico (opcional)</Label>
      <canvas
        ref={canvasRef}
        width={680}
        height={220}
        className="h-32 w-full touch-none rounded-lg border border-dashed border-zinc-300 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
      />
      <Button type="button" variant="outline" className="w-full" onClick={clear}>
        Limpar assinatura
      </Button>
    </div>
  );
}

function FinanceView({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { state } = useWorkshop();
  if (!state) return null;
  const totals = state.orders.reduce(
    (acc, order) => {
      const orderTotals = getOrderTotals(state, order.id);
      acc.revenue += orderTotals.total;
      acc.paid += orderTotals.paid;
      acc.balance += orderTotals.balance;
      return acc;
    },
    { revenue: 0, paid: 0, balance: 0 },
  );
  const pending = state.orders.filter((order) => getOrderTotals(state, order.id).balance > 0);

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-3 gap-2">
        <MetricCard label="Faturado" value={formatCurrency(totals.revenue)} icon={CircleDollarSign} tone="emerald" />
        <MetricCard label="Recebido" value={formatCurrency(totals.paid)} icon={ReceiptText} tone="sky" />
        <MetricCard label="Aberto" value={formatCurrency(totals.balance)} icon={Clock} tone="amber" />
      </section>
      <section className="space-y-3">
        <h2 className="text-base font-black">Saldos pendentes</h2>
        {pending.map((order) => (
          <OrderListCard key={order.id} order={order} onOpenOrder={onOpenOrder} />
        ))}
      </section>
    </div>
  );
}

function HistoryView({ onOpenOrder, onOpenCustomer }: { onOpenOrder: (orderId: string) => void; onOpenCustomer: (customerId: string) => void }) {
  const { state } = useWorkshop();
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "finished" | "delivered" | "cancelled" | "partial" | "paid">("all");
  if (!state) return null;

  const normalizedQuery = filter.trim().toLowerCase();

  const filtered = state.orders.filter((order) => {
    const customer = getCustomer(state, order.customerId);
    const vehicle = getVehicle(state, order.vehicleId);
    const totals = getOrderTotals(state, order.id);

    // Status filter
    if (statusFilter === "finished" && order.status !== "finished") return false;
    if (statusFilter === "delivered" && order.status !== "delivered") return false;
    if (statusFilter === "cancelled" && order.status !== "cancelled") return false;
    if (statusFilter === "paid" && order.paymentStatus !== "paid") return false;
    if (statusFilter === "partial" && order.paymentStatus !== "partial") return false;

    // Date filter
    const orderDate = order.createdAt.slice(0, 10);
    if (dateFrom && orderDate < dateFrom) return false;
    if (dateTo && orderDate > dateTo) return false;

    // Text search (CPF, name, plate, OS number)
    if (normalizedQuery) {
      const cpf = customer?.cpf.replace(/\D/g, "") ?? "";
      const searchCpf = normalizedQuery.replace(/\D/g, "");
      const plate = vehicle?.plate.toLowerCase() ?? "";
      const name = customer?.name.toLowerCase() ?? "";
      const number = order.number.toLowerCase();
      if (!cpf.includes(searchCpf) && !name.includes(normalizedQuery) && !plate.includes(normalizedQuery) && !number.includes(normalizedQuery)) {
        return false;
      }
    }

    return true;
  });

  return (
    <div className="space-y-4">
      {/* Search */}
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-zinc-400" />
        <Input
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
          placeholder="Buscar por CPF, nome, placa ou OS"
          className="pl-10"
          inputMode="search"
        />
      </div>

      {/* Date range */}
      <div className="grid grid-cols-2 gap-2">
        <div className="space-y-1">
          <Label className="text-xs">De</Label>
          <Input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="h-10 text-sm" />
        </div>
        <div className="space-y-1">
          <Label className="text-xs">Até</Label>
          <Input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="h-10 text-sm" />
        </div>
      </div>

      {/* Status tabs */}
      <div className="flex gap-1.5 overflow-x-auto pb-1">
        {([
          { id: "all", label: "Todos" },
          { id: "finished", label: "Finalizados" },
          { id: "delivered", label: "Entregues" },
          { id: "paid", label: "Pagos" },
          { id: "partial", label: "Parcial" },
          { id: "cancelled", label: "Cancelados" },
        ] as const).map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => setStatusFilter(tab.id)}
            className={`shrink-0 rounded-full px-3 py-1.5 text-xs font-bold transition ${
              statusFilter === tab.id
                ? "bg-zinc-950 text-white"
                : "border border-zinc-200 bg-white text-zinc-600"
            }`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* Results count */}
      <p className="text-xs font-semibold text-zinc-400">
        {filtered.length} registro{filtered.length === 1 ? "" : "s"} encontrado{filtered.length === 1 ? "" : "s"}
      </p>

      {/* Order list */}
      <div className="space-y-2">
        {filtered.map((order) => {
          const customer = getCustomer(state, order.customerId);
          const vehicle = getVehicle(state, order.vehicleId);
          const totals = getOrderTotals(state, order.id);
          return (
            <button
              key={order.id}
              type="button"
              className="w-full rounded-lg border border-zinc-200 bg-white p-4 text-left shadow-sm transition hover:border-zinc-300"
              onClick={() => onOpenOrder(order.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-black">{order.number}</p>
                  <p className="mt-1 text-sm text-zinc-500">
                    {customer?.name} · {vehicle?.model} {formatPlate(vehicle?.plate ?? "")}
                  </p>
                  <p className="mt-1 text-xs text-zinc-400">
                    {formatDate(order.createdAt)} · {formatCpf(customer?.cpf ?? "")}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <Badge variant={badgeForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                  <Badge variant={badgeForPayment(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
                </div>
              </div>
              <div className="mt-3 grid grid-cols-3 gap-2">
                <MiniStat label="Total" value={formatCurrency(totals.total)} />
                <MiniStat label="Pago" value={formatCurrency(totals.paid)} />
                <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
              </div>
            </button>
          );
        })}
      </div>

      {!filtered.length ? (
        <EmptyState icon={Clock} title="Nenhum registro" text="Altere os filtros para ver o histórico de atendimentos." />
      ) : null}
    </div>
  );
}

function SettingsView() {
  const { state, currentUser, resetDemoData, syncStatus, forceSync } = useWorkshop();
  const [notifPermission, setNotifPermission] = useState<PermissionState>("unsupported");
  const [setupLoading, setSetupLoading] = useState(false);

  useEffect(() => {
    setNotifPermission(getNotificationPermission());
  }, []);

  async function handleToggleNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === "granted") {
      toast.success("Notificações ativadas!");
    } else if (result === "denied") {
      toast.error("Permissão negada. Ative manualmente nas configurações do navegador.");
    }
  }

  async function handleSetup() {
    setSetupLoading(true);
    try {
      const res = await fetch("/api/workshop/setup", { method: "POST" });
      const body = await res.json();
      if (body?.ok) {
        toast.success("Tabela criada no Supabase!");
        // Force sync after setup
        await forceSync();
      } else if (body?.sql) {
        toast.error("Execute o SQL manualmente no Supabase.");
      } else {
        toast.error(body?.message || "Erro na configuração.");
      }
    } catch {
      toast.error("Erro ao configurar Supabase.");
    } finally {
      setSetupLoading(false);
    }
  }

  if (!state || !currentUser) return null;
  const supabaseConfigured = Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
  const openReminders = state.reminders.filter((r) => r.status === "open" && r.dueDate);

  const syncLabel = {
    idle: "Aguardando",
    syncing: "Sincronizando...",
    synced: "Sincronizado ✓",
    error: "Erro ao sincronizar",
    local_only: "Somente local",
  }[syncStatus];
  const syncVariant = {
    idle: "muted" as const,
    syncing: "info" as const,
    synced: "success" as const,
    error: "danger" as const,
    local_only: "warning" as const,
  }[syncStatus];

  return (
    <div className="space-y-4">
      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Conta e ambiente</h2>
        <div className="mt-3 grid gap-2">
          <InfoRow label="Usuário" value={currentUser.username} />
          <InfoRow label="Perfil" value={ROLE_LABEL[currentUser.role]} />
          <InfoRow label="Supabase" value={supabaseConfigured ? "Configurado" : "Aguardando .env"} />
          <InfoRow label="Fiscal" value={state.fiscalIntegration.status === "ready" ? "Pronto" : "Não configurado"} />
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">Sincronização</h2>
          <Badge variant={syncVariant}>{syncLabel}</Badge>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Dados são salvos automaticamente no Supabase a cada alteração.
        </p>
        {supabaseConfigured && syncStatus === "synced" && (
          <div className="mt-3 rounded-lg bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-700">
              ✓ Todos os dados estão sincronizados com o banco de dados.
            </p>
          </div>
        )}
        {supabaseConfigured && syncStatus === "local_only" && (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-700">
                ⚠ Tabela não encontrada no Supabase.
              </p>
              <p className="mt-1 text-xs text-amber-600">
                Clique em "Configurar automaticamente" ou rode o SQL manualmente.
              </p>
            </div>
            <Button type="button" className="w-full" onClick={handleSetup} disabled={setupLoading}>
              {setupLoading ? "Configurando..." : "Configurar automaticamente"}
            </Button>
          </div>
        )}
        {syncStatus === "error" && (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg bg-rose-50 p-3">
              <p className="text-sm font-semibold text-rose-700">
                Erro ao sincronizar. Verifique as variáveis de ambiente no Vercel.
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={handleSetup} disabled={setupLoading}>
              {setupLoading ? "Configurando..." : "Tentar configurar novamente"}
            </Button>
          </div>
        )}
        {supabaseConfigured && syncStatus !== "local_only" && (
          <Button type="button" variant="outline" className="mt-3 w-full" onClick={forceSync} disabled={syncStatus === "syncing"}>
            {syncStatus === "syncing" ? "Sincronizando..." : "Sincronizar agora"}
          </Button>
        )}
        {!supabaseConfigured && (
          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            <p className="text-sm text-zinc-500">
              Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no Vercel para ativar a persistência remota.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black">Notificações</h2>
          <Badge variant={notifPermission === "granted" ? "success" : notifPermission === "denied" ? "danger" : "muted"}>
            {notifPermission === "granted" ? "Ativado" : notifPermission === "denied" ? "Bloqueado" : "Desativado"}
          </Badge>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Receba alertas quando lembretes de retorno estiverem próximos do vencimento.
        </p>
        {notifPermission === "unsupported" ? (
          <p className="mt-3 text-sm font-semibold text-amber-600">
            Seu navegador não suporta notificações push.
          </p>
        ) : notifPermission === "denied" ? (
          <p className="mt-3 text-sm text-zinc-500">
            A permissão foi negada. Para ativar, acesse as configurações do navegador e permita notificações para este site.
          </p>
        ) : (
          <Button type="button" className="mt-3 w-full" onClick={handleToggleNotifications}>
            {notifPermission === "granted" ? "Notificações já ativas ✓" : "Ativar notificações"}
          </Button>
        )}
        {openReminders.length > 0 && notifPermission === "granted" && (
          <div className="mt-3 rounded-lg bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-500">
              {openReminders.length} lembretes ativos — notificações disparam quando faltam ≤ 3 dias
            </p>
          </div>
        )}
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Funcionários</h2>
        <div className="mt-3 space-y-2">
          {state.employees.map((employee) => (
            <div key={employee.id} className="flex items-center justify-between rounded-lg bg-zinc-50 p-3">
              <div>
                <p className="text-sm font-bold">{employee.name}</p>
                <p className="text-xs text-zinc-500">{ROLE_LABEL[employee.role]}</p>
              </div>
              <Badge variant={employee.active ? "success" : "muted"}>{employee.active ? "Ativo" : "Inativo"}</Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-lg border border-zinc-200 bg-white p-4 shadow-sm">
        <h2 className="text-lg font-black">Auditoria</h2>
        <div className="mt-3 space-y-2">
          {state.auditEvents.slice(0, 12).map((event) => (
            <div key={event.id} className="rounded-lg bg-zinc-50 p-3">
              <p className="text-sm font-bold">{event.summary}</p>
              <p className="text-xs text-zinc-500">{formatDateTime(event.occurredAt)}</p>
            </div>
          ))}
        </div>
      </section>

      <Button type="button" variant="danger" className="w-full" onClick={resetDemoData}>
        Restaurar base local
      </Button>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-zinc-50 px-3 py-2">
      <span className="text-sm text-zinc-500">{label}</span>
      <strong className="text-sm">{value}</strong>
    </div>
  );
}

function SignaturePad({ order }: { order: ServiceOrder }) {
  const { updateOrder } = useWorkshop();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const drawingRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const context = canvas.getContext("2d");
    if (!context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.strokeStyle = "#18181b";
    context.lineWidth = 2.2;
    context.lineCap = "round";
    if (order.customerSignatureDataUrl) {
      const image = new Image();
      image.onload = () => context.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = order.customerSignatureDataUrl;
    }
  }, [order.customerSignatureDataUrl]);

  function point(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const rect = canvas.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * canvas.width,
      y: ((event.clientY - rect.top) / rect.height) * canvas.height,
    };
  }

  function start(event: ReactPointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    drawingRef.current = true;
    const position = point(event);
    context.beginPath();
    context.moveTo(position.x, position.y);
  }

  function move(event: ReactPointerEvent<HTMLCanvasElement>) {
    if (!drawingRef.current) return;
    const context = canvasRef.current?.getContext("2d");
    if (!context) return;
    const position = point(event);
    context.lineTo(position.x, position.y);
    context.stroke();
  }

  function stop() {
    drawingRef.current = false;
  }

  function save() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    try {
      updateOrder(order.id, { customerSignatureDataUrl: canvas.toDataURL("image/png") });
      toast.success("Assinatura salva.");
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  function clear() {
    const canvas = canvasRef.current;
    const context = canvas?.getContext("2d");
    if (!canvas || !context) return;
    context.fillStyle = "#ffffff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    try {
      updateOrder(order.id, { customerSignatureDataUrl: undefined });
    } catch {
      return;
    }
  }

  return (
    <div className="space-y-2">
      <Label>Assinatura do cliente</Label>
      <canvas
        ref={canvasRef}
        width={680}
        height={220}
        className="h-32 w-full touch-none rounded-lg border border-dashed border-zinc-300 bg-white"
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={stop}
        onPointerLeave={stop}
      />
      <div className="grid grid-cols-2 gap-2">
        <Button type="button" variant="outline" onClick={clear}>
          Limpar
        </Button>
        <Button type="button" variant="secondary" onClick={save}>
          Salvar assinatura
        </Button>
      </div>
    </div>
  );
}
