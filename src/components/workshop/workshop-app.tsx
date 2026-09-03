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
  ArrowDownLeft,
  ArrowUpRight,
  Bell,
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
  FilePlus2,
  FileText,
  Home,
  Images,
  Info,
  Landmark,
  LogOut,
  Menu,
  Plus,
  ReceiptText,
  Search,
  Trash2,
  Share2,
  Settings,
  ShieldCheck,
  Printer,
  UserRound,
  UserSearch,
  UsersRound,
  Wallet,
  Wrench,
  X,
} from "lucide-react";
import { ZodError } from "zod";
import { toast, Toaster } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Pressable } from "@/components/ui/pressable";
import { Segmented } from "@/components/ui/segmented";
import { haptic } from "@/lib/ui/haptics";
import { pageVariants, popIn, springSmooth, springSnappy, staggerContainer, staggerItem } from "@/lib/ui/motion";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { buildDocumentPdf, DocumentPreview } from "@/components/workshop/document-preview";
import { BrandMark, BrandLogoInline } from "@/components/workshop/brand-mark";
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
  DocumentRecord,
  OrderItem,
  OrderStatus,
  PaymentMethod,
  ServiceOrder,
  Vehicle,
  VehicleLookupResult,
  WorkshopState,
} from "@/lib/workshop/types";
import { VehicleIdentityFields } from "@/components/workshop/vehicle-identity-fields";
import { getVehicleCategoryImageFallback, localImageForCategory, resolveVehicleImageUrl } from "@/lib/workshop/vehicle-image";
import { useLogoPngDataUrl } from "@/lib/workshop/logo-raster";
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
type FinanceTab = "extract" | "pending" | "receipts";
type FinanceTransaction = {
  id: string;
  type: "Entrada" | "Saída" | "Pendente";
  title: string;
  detail: string;
  amount: number;
  date: string;
  icon: typeof Home;
  tone: string;
  orderId: string;
};

const selectClass =
  "h-12 w-full appearance-none rounded-xl bg-white px-3.5 text-base text-zinc-950 outline-none transition-[box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)] shadow-[0_1px_2px_rgba(24,24,27,0.04),inset_0_0_0_1px_rgba(24,24,27,0.11)] hover:shadow-[0_1px_2px_rgba(24,24,27,0.05),inset_0_0_0_1px_rgba(24,24,27,0.18)] focus:shadow-[0_0_0_3.5px_rgba(24,24,27,0.09),inset_0_0_0_1.5px_rgb(24,24,27)]";

const tabs: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Início", icon: Home },
  { id: "orders", label: "OS", icon: ClipboardCheck },
  { id: "customers", label: "Clientes", icon: UsersRound },
  { id: "finance", label: "Financeiro", icon: CircleDollarSign },
  { id: "history", label: "Histórico", icon: Clock },
];

const mobileTabs: Array<{ id: ViewId; label: string; icon: typeof Home }> = [
  { id: "home", label: "Início", icon: Home },
  { id: "orders", label: "OS", icon: ClipboardCheck },
  { id: "customers", label: "Clientes", icon: UsersRound },
  { id: "finance", label: "Faturamento", icon: Landmark },
  { id: "history", label: "Histórico", icon: Clock },
  { id: "settings", label: "Menu", icon: Menu },
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

/** Ordem visual das abas, usada para decidir o sentido da transição de tela. */
const NAV_ORDER: ViewId[] = ["home", "orders", "customers", "finance", "history", "settings"];

/**
 * Sentido da troca de tela: avançar na ordem das abas entra pela direita,
 * voltar entra pela esquerda. É o que dá a sensação de pilha de navegação em
 * vez de telas trocando aleatoriamente.
 */
function useNavDirection(view: ViewId): 1 | -1 {
  const [tracked, setTracked] = useState<{ view: ViewId; direction: 1 | -1 }>({ view, direction: 1 });

  if (tracked.view !== view) {
    const from = NAV_ORDER.indexOf(tracked.view);
    const to = NAV_ORDER.indexOf(view);
    setTracked({ view, direction: to >= from ? 1 : -1 });
  }

  return tracked.direction;
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

/* O contorno dos campos é uma sombra interna, não `border`, para o anel de foco
   crescer por fora sem mudar a altura. O estado de erro segue a mesma técnica. */
const invalidFieldShadow =
  "bg-rose-50/50 text-rose-950 shadow-[0_1px_2px_rgba(190,18,60,0.06),inset_0_0_0_1.5px_rgb(244,63,94)] hover:shadow-[0_1px_2px_rgba(190,18,60,0.08),inset_0_0_0_1.5px_rgb(225,29,72)] focus:shadow-[0_0_0_3.5px_rgba(244,63,94,0.16),inset_0_0_0_1.5px_rgb(225,29,72)]";

function invalidFieldClass(error?: string) {
  return error ? invalidFieldShadow : undefined;
}

function selectFieldClass(error?: string) {
  return `${selectClass} ${error ? invalidFieldShadow : ""}`;
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
      {/* `top-center` porque no mobile a base da tela é ocupada pelo dock e pelo
          teclado. O offset acompanha a área segura do notch. */}
      <Toaster
        position="top-center"
        offset="calc(env(safe-area-inset-top) + 12px)"
        gap={8}
        duration={3200}
        toastOptions={{
          classNames: {
            toast:
              "!rounded-2xl !border-0 !bg-white !shadow-float !px-4 !py-3.5 !gap-3 !font-sans",
            title: "!text-[14px] !font-semibold !tracking-[-0.01em] !text-zinc-950",
            description: "!text-[13px] !leading-5 !text-zinc-500",
            actionButton: "!rounded-full !bg-zinc-950 !text-white !text-[13px] !font-semibold",
            cancelButton: "!rounded-full !bg-zinc-100 !text-zinc-700 !text-[13px] !font-semibold",
            closeButton: "!rounded-full !border-0 !bg-zinc-100 !text-zinc-500",
            success: "!text-emerald-600",
            error: "!text-rose-600",
            warning: "!text-amber-600",
            info: "!text-sky-600",
          },
        }}
      />
      <WorkshopRuntime />
    </WorkshopProvider>
  );
}
function WorkshopRuntime() {
  const { ready, currentUser, state, syncStatus, syncError, retryConnection } = useWorkshop();

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
    return <DatabaseSkeleton status={syncStatus} error={syncError} onRetry={retryConnection} />;
  }

  return currentUser ? <WorkspaceShell /> : <LoginScreen />;
}

function DatabaseSkeleton({
  status,
  error,
  onRetry,
}: {
  status: string;
  error?: string;
  onRetry: () => Promise<void>;
}) {
  const [retrying, setRetrying] = useState(false);
  const isError = status === "error" || status === "table_missing";
  const title =
    status === "table_missing"
      ? "Banco ainda não configurado"
      : isError
        ? "Não foi possível conectar"
        : "Preparando seu ambiente";

  const subtitle =
    status === "table_missing"
      ? "Execute o SQL_COMPLETO.sql no Supabase para criar as tabelas."
      : isError
        ? error || "Verifique URL e service role key no .env, e se o projeto Supabase está ativo."
        : "Sincronizando dados da oficina com segurança.";

  async function handleRetry() {
    setRetrying(true);
    await onRetry();
    setRetrying(false);
  }

  return (
    <main className="boot-screen relative flex min-h-dvh items-center justify-center px-6 py-10 text-zinc-950">
      <div className="relative z-10 w-full max-w-sm">
        <div className="rounded-[1.75rem] border border-white/60 bg-white/85 p-8 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.28)] backdrop-blur-xl">
          <BrandMark size="md" />

          <div className="mt-8">
            {!isError ? (
              <div className="flex items-center justify-center gap-1.5">
                {[0, 1, 2].map((dot) => (
                  <span
                    key={dot}
                    className="size-1.5 rounded-full bg-zinc-900/70"
                    style={{ animation: `boot-dot 1.2s ease-in-out ${dot * 0.15}s infinite` }}
                  />
                ))}
              </div>
            ) : (
              <div className="mx-auto flex size-10 items-center justify-center rounded-full bg-rose-50 ring-1 ring-rose-100">
                <span className="size-2 rounded-full bg-rose-500" />
              </div>
            )}
          </div>

          <div className="mt-6 space-y-2 text-center">
            <h1 className="text-base font-semibold tracking-[-0.02em] text-zinc-900">{title}</h1>
            <p className="text-sm leading-relaxed text-zinc-500">{subtitle}</p>
          </div>

          {isError ? (
            <div className="mt-6 space-y-3">
              <Button type="button" className="h-11 w-full rounded-xl" disabled={retrying} onClick={handleRetry}>
                {retrying ? "Conectando..." : "Tentar novamente"}
              </Button>
              <p className="text-center text-xs leading-relaxed text-zinc-400">
                Abra o Supabase → SQL Editor → cole o arquivo <strong>SQL_COMPLETO.sql</strong> → Run.
              </p>
            </div>
          ) : (
            <p className="mt-6 text-center text-[11px] font-medium uppercase tracking-[0.22em] text-zinc-400">Sincronizando</p>
          )}
        </div>
      </div>
    </main>
  );
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
    <main className="boot-screen min-h-dvh px-5 py-8 text-zinc-950">
      <div className="mx-auto grid min-h-[calc(100dvh-4rem)] w-full max-w-5xl items-center gap-10 lg:grid-cols-[1fr,400px] lg:gap-16">
        <section className="hidden flex-col justify-center lg:flex">
          <BrandMark size="lg" subtitle={false} align="left" />
          <p className="mt-6 max-w-md text-lg leading-relaxed text-zinc-500">
            Gestão completa de ordens de serviço, clientes, veículos e pagamentos — tudo sincronizado na nuvem.
          </p>
          <ul className="mt-8 space-y-3 text-sm text-zinc-600">
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-zinc-900" />
              Ordens de serviço com fotos e histórico
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-zinc-900" />
              Cadastro de clientes e veículos
            </li>
            <li className="flex items-center gap-2">
              <span className="size-1.5 rounded-full bg-zinc-900" />
              Pagamentos e documentos integrados
            </li>
          </ul>
        </section>

        <section className="w-full">
          <div className="rounded-[1.75rem] border border-white/60 bg-white/90 p-6 shadow-[0_24px_80px_-32px_rgba(0,0,0,0.28)] backdrop-blur-xl sm:p-8">
            <div className="mb-8 lg:hidden">
              <BrandMark size="sm" />
            </div>

            <form onSubmit={handleSubmit} className="space-y-6">
              <div className="space-y-1">
                <h2 className="text-xl font-semibold tracking-[-0.02em] text-zinc-900">Entrar no sistema</h2>
                <p className="text-sm text-zinc-500">Acesse com seu usuário e senha</p>
              </div>

              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Usuário
                  </Label>
                  <Input
                    id="username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="seu.usuario"
                    className="h-11 rounded-xl border-zinc-200 bg-zinc-50/80 px-4"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs font-medium uppercase tracking-wide text-zinc-500">
                    Senha
                  </Label>
                  <Input
                    id="password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    placeholder="••••••••"
                    className="h-11 rounded-xl border-zinc-200 bg-zinc-50/80 px-4"
                  />
                </div>
              </div>

              <Button type="submit" size="lg" className="h-11 w-full rounded-xl font-medium" disabled={loading}>
                <ShieldCheck className="size-4" /> {loading ? "Validando acesso..." : "Acessar"}
              </Button>

              <p className="border-t border-zinc-100 pt-4 text-center text-xs text-zinc-400">
                Primeiro acesso: <span className="font-medium text-zinc-500">totalflex</span> ·{" "}
                <span className="font-medium text-zinc-500">1234</span>
              </p>
            </form>
          </div>
        </section>
      </div>
    </main>
  );
}

function WorkspaceShell() {
  const { state, currentUser, logout } = useWorkshop();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const view = viewFromPath(pathname);
  const navDirection = useNavDirection(view);
  const search = searchParams.toString();
  const [customerSheetOpen, setCustomerSheetOpen] = useState(false);
  const [orderSheetOpen, setOrderSheetOpen] = useState(false);
  const [orderFlowKey, setOrderFlowKey] = useState(0);
  const [fiscalSheetOpen, setFiscalSheetOpen] = useState(false);
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
    return os ? state.orders.find((item) => !item.deletedAt && (item.number.toLowerCase() === os || item.id === os))?.id : undefined;
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
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0, behavior: "smooth" }));
  }

  function openCustomer(customerId: string) {
    const customer = currentState.customers.find((item) => item.id === customerId);
    navigateTo("customers", { cpf: customer?.cpf });
  }

  function openOrder(orderId: string) {
    const order = currentState.orders.find((item) => item.id === orderId && !item.deletedAt);
    navigateTo("orders", { os: order?.number });
  }

  function openOrderFlow() {
    setOrderFlowKey((current) => current + 1);
    setOrderSheetOpen(true);
  }

  return (
    <main className="min-h-dvh bg-surface-app text-zinc-950 lg:flex">
      <aside className="hidden lg:flex lg:w-[272px] lg:shrink-0 lg:flex-col lg:border-r lg:border-zinc-200/80 lg:bg-white">
        <div className="flex items-center gap-3 border-b border-zinc-100 px-6 py-6">
          <BrandLogoInline className="h-9" />
          <div>
            <p className="text-base font-semibold tracking-[-0.02em] text-zinc-900">Total Flex</p>
            <p className="text-xs text-zinc-500">Oficina digital</p>
          </div>
        </div>

        <nav className="flex-1 space-y-0.5 px-3 py-5">
          {[...tabs, { id: "settings" as ViewId, label: "Ajustes", icon: Settings }].map((tab) => {
            const active = view === tab.id;
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => navigateTo(tab.id)}
                className={`relative flex h-10 w-full items-center gap-3 rounded-[10px] px-3 text-sm font-medium transition-colors duration-200 ${
                  active ? "text-zinc-950" : "text-zinc-500 hover:bg-zinc-100/70 hover:text-zinc-900"
                }`}
              >
                {active ? (
                  <motion.span
                    layoutId="desktop-nav-active"
                    className="absolute inset-0 rounded-[10px] bg-zinc-100"
                    transition={springSnappy}
                  />
                ) : null}
                <Icon className={`relative size-[17px] ${active ? "text-zinc-950" : "text-zinc-400"}`} />
                <span className="relative">{tab.label}</span>
              </button>
            );
          })}
        </nav>

        <div className="space-y-2 border-t border-zinc-100 px-3 py-4">
          <Button type="button" className="h-10 w-full rounded-[10px]" onClick={() => setCustomerSheetOpen(true)}>
            <Plus className="size-4" /> Novo cliente
          </Button>
          <Button type="button" variant="outline" className="h-10 w-full rounded-[10px]" onClick={openOrderFlow}>
            <FilePlus2 className="size-4" /> Nova OS
          </Button>
        </div>
      </aside>

      <div className="w-full lg:flex lg:min-h-dvh lg:flex-1 lg:flex-col">
        <section className="mx-auto flex min-h-dvh w-full max-w-xl flex-col overflow-x-hidden bg-white lg:mx-0 lg:max-w-none lg:min-h-dvh lg:min-w-0 lg:flex-1 lg:bg-transparent">
          {/* A saturação extra no blur mantém as cores vivas sob a barra
              translúcida, como nas barras de navegação do iOS. */}
          <header className="safe-top sticky top-0 z-30 border-b border-zinc-200/70 bg-white/80 px-4 pb-3 backdrop-blur-xl backdrop-saturate-150 lg:bg-surface-app/80">
            <div className="lg:mx-auto lg:max-w-5xl">
              <div className="flex items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <button
                    type="button"
                    onClick={() => navigateTo("settings")}
                    className="press grid size-9 shrink-0 place-items-center rounded-full bg-white text-zinc-700 shadow-[0_1px_2px_rgba(24,24,27,0.06),inset_0_0_0_1px_rgba(24,24,27,0.09)] lg:hidden"
                    title="Menu"
                  >
                    <UserRound className="size-[18px]" />
                  </button>
                  <div className="min-w-0">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-zinc-400 lg:hidden">
                      Total Flex
                    </p>
                    <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.025em]">
                      {view === "home" ? "Início" : tabs.find((tab) => tab.id === view)?.label ?? "Menu"}
                    </h1>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1.5">
                  <div className="hidden items-center gap-2 lg:flex">
                    <Button type="button" size="sm" className="rounded-[10px]" onClick={() => setCustomerSheetOpen(true)}>
                      <Plus className="size-4" /> Cliente
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="rounded-[10px]" onClick={openOrderFlow}>
                      <FilePlus2 className="size-4" /> Nova OS
                    </Button>
                  </div>
                  <Button type="button" variant="ghost" size="icon" className="size-9" onClick={() => navigateTo("history")} title="Alertas">
                    <Bell />
                  </Button>
                  <Button type="button" variant="ghost" size="icon" className="size-9" onClick={logout} title="Sair">
                    <LogOut />
                  </Button>
                </div>
              </div>
              <GlobalSearchBox onOpenCustomer={openCustomer} onOpenOrder={openOrder} />
            </div>
          </header>

          <div className="flex-1 px-4 pb-32 pt-5 lg:px-8 lg:pb-8">
            <div className="lg:mx-auto lg:max-w-5xl">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={view}
                  variants={pageVariants(navDirection)}
                  initial="hidden"
                  animate="visible"
                  exit="exit"
                >
                  {view === "home" ? (
                    <HomeView
                      onOpenOrder={openOrder}
                      onOpenCustomer={openCustomer}
                      onNewOrder={openOrderFlow}
                      onNewCustomer={() => setCustomerSheetOpen(true)}
                      onOpenFiscalDocument={() => setFiscalSheetOpen(true)}
                      onNavigate={navigateTo}
                    />
                  ) : null}
                  {view === "customers" ? (
                    <CustomersView
                      selectedCustomerId={selectedCustomerId || undefined}
                      onSelectCustomer={(customerId) => {
                        if (!customerId) navigateTo("customers");
                        else openCustomer(customerId);
                      }}
                      onNewOrder={openOrderFlow}
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
                  {view === "history" ? <HistoryView onOpenOrder={openOrder} /> : null}
                  {view === "settings" ? <SettingsView /> : null}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>

          {/* Gradiente atrás do dock: o conteúdo rolando some suavemente por
              baixo da barra em vez de ser cortado numa linha reta. */}
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-30 h-32 bg-gradient-to-t from-surface-app via-surface-app/85 to-transparent lg:hidden" />

          <nav className="fixed inset-x-0 bottom-0 z-40 mx-auto max-w-xl px-4 pb-[calc(env(safe-area-inset-bottom)+10px)] lg:hidden">
            <div className="relative grid grid-cols-7 items-end rounded-[24px] bg-white/85 px-1.5 pb-2 pt-2.5 shadow-[0_0_0_1px_rgba(24,24,27,0.06),0_-1px_0_rgba(255,255,255,0.9)_inset,0_16px_40px_-12px_rgba(24,24,27,0.22)] backdrop-blur-2xl backdrop-saturate-150">
              {mobileTabs.slice(0, 3).map((tab) => (
                <MobileNavButton key={tab.id} tab={tab} active={view === tab.id} onClick={() => navigateTo(tab.id)} />
              ))}

              {/* Coluna vazia: reserva o espaço central para o botão flutuante. */}
              <div aria-hidden />

              {mobileTabs.slice(3).map((tab) => (
                <MobileNavButton key={tab.id} tab={tab} active={view === tab.id} onClick={() => navigateTo(tab.id)} />
              ))}

              {/* Centro do botão na borda superior do dock (`top:0` + `y:-50%`):
                  metade dentro, metade fora — padrão de FAB em barra inferior.
                  O deslocamento vai em `style`, não em classe, porque o Motion
                  reescreve `transform` ao pressionar. */}
              <motion.button
                type="button"
                onPointerDown={() => haptic("select")}
                onClick={() => setCustomerSheetOpen(true)}
                style={{ x: "-50%", y: "-50%" }}
                whileTap={{ scale: 0.92 }}
                transition={springSnappy}
                className="absolute left-1/2 top-3 z-10 grid size-14 place-items-center rounded-full bg-gradient-to-b from-zinc-800 to-zinc-950 text-white shadow-[0_1px_0_rgba(255,255,255,0.14)_inset,0_10px_28px_-8px_rgba(24,24,27,0.6)] ring-[3px] ring-white"
                title="Novo cliente"
                aria-label="Novo cliente"
              >
                <Plus className="size-6" strokeWidth={2.4} />
              </motion.button>
            </div>
          </nav>
        </section>
      </div>

      <CustomerFlowSheet open={customerSheetOpen} onOpenChange={setCustomerSheetOpen} onSelectCustomer={openCustomer} />
      <FiscalDocumentSheet
        open={fiscalSheetOpen}
        onOpenChange={setFiscalSheetOpen}
        onOpenOrder={openOrder}
      />
      <OrderFlowSheet
        key={`${selectedCustomerId || "order-flow"}-${orderFlowKey}`}
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
    <div className="relative mt-3 w-full min-w-0">
      <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-zinc-400" />
      <Input
        value={query}
        onChange={(event) => setQuery(event.target.value)}
        placeholder="Buscar CPF, nome, placa ou OS"
        className="h-11 w-full max-w-full bg-zinc-100/70 pl-10 text-[15px] shadow-none focus:bg-white"
        inputMode="search"
      />
      {query ? (
        <button
          type="button"
          onClick={() => setQuery("")}
          className="absolute right-2.5 top-1/2 z-10 grid size-6 -translate-y-1/2 place-items-center rounded-full bg-zinc-300/70 text-white transition active:scale-90"
          aria-label="Limpar busca"
        >
          <X className="size-3.5" strokeWidth={3} />
        </button>
      ) : null}

      <AnimatePresence>
        {results.length ? (
          <motion.div
            initial={{ opacity: 0, y: -6, scale: 0.99 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -6, scale: 0.99 }}
            transition={springSnappy}
            className="absolute inset-x-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-2xl bg-white shadow-float"
          >
            {results.map((result) => (
              <button
                key={`${result.type}-${result.label}-${result.detail}`}
                type="button"
                className="flex w-full items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 text-left transition-colors last:border-0 hover:bg-zinc-50 active:bg-zinc-100"
                onClick={() => {
                  haptic("select");
                  setQuery("");
                  if (result.type === "order") onOpenOrder(result.order.id);
                  if (result.type === "customer") onOpenCustomer(result.customer.id);
                  if (result.type === "vehicle" && result.customer) onOpenCustomer(result.customer.id);
                }}
              >
                <span className="min-w-0">
                  <span className="block truncate text-[15px] font-medium tracking-[-0.01em] text-zinc-950">
                    {result.label}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-zinc-500">{result.detail}</span>
                </span>
                <ChevronRight className="size-4 shrink-0 text-zinc-300" />
              </button>
            ))}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function MobileNavButton({
  tab,
  active,
  onClick,
}: {
  tab: { id: ViewId; label: string; icon: typeof Home };
  active: boolean;
  onClick: () => void;
}) {
  const Icon = tab.icon;

  return (
    <button
      type="button"
      onPointerDown={() => {
        if (!active) haptic("tap");
      }}
      onClick={onClick}
      className="relative flex flex-col items-center justify-end gap-1 rounded-2xl pb-0.5 pt-1.5"
      title={tab.label}
      aria-label={tab.label}
      aria-current={active ? "page" : undefined}
    >
      {active ? (
        <motion.span
          layoutId="mobile-nav-active"
          className="absolute inset-x-0.5 inset-y-0 rounded-[16px] bg-zinc-100/90"
          transition={springSnappy}
        />
      ) : null}

      {/* O ícone sobe e cresce ao ativar: o movimento vertical é o que faz a
          troca de aba ser percebida sem precisar de uma pílula colorida. */}
      <motion.span
        className={`relative grid place-items-center transition-colors duration-200 ${active ? "text-zinc-950" : "text-zinc-400"}`}
        animate={{ scale: active ? 1.06 : 1, y: active ? -1 : 0 }}
        transition={springSnappy}
      >
        <Icon className="size-[19px]" strokeWidth={active ? 2.3 : 2} />
      </motion.span>

      <span
        className={`relative text-[9.5px] leading-none tracking-[-0.01em] transition-colors duration-200 ${
          active ? "font-semibold text-zinc-950" : "font-medium text-zinc-400"
        }`}
      >
        {tab.label}
      </span>
    </button>
  );
}

function HomeView({
  onOpenOrder,
  onOpenCustomer,
  onNewOrder,
  onNewCustomer,
  onOpenFiscalDocument,
  onNavigate,
}: {
  onOpenOrder: (orderId: string) => void;
  onOpenCustomer: (customerId: string) => void;
  onNewOrder: () => void;
  onNewCustomer: () => void;
  onOpenFiscalDocument: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  const { state } = useWorkshop();
  if (!state) return null;

  const activeOrders = state.orders.filter((order) => !order.deletedAt);
  const openOrders = activeOrders.filter((order) => !["finished", "delivered", "cancelled"].includes(order.status));

  /* A cor aqui carrega significado (aguardando, em serviço, concluído), por isso
     fica reduzida a um ponto e ao número. Chapar o cartão inteiro de gradiente
     dava peso visual igual a todos os estados e escondia a informação. */
  const statusCards = [
    { label: "Abertas", value: openOrders.length, dot: "bg-sky-500", icon: ClipboardCheck },
    { label: "Em andamento", value: activeOrders.filter((order) => order.status === "in_service").length, dot: "bg-amber-500", icon: Wrench },
    { label: "Aguardando", value: activeOrders.filter((order) => order.status === "waiting_approval" || order.status === "waiting_parts").length, dot: "bg-violet-500", icon: Clock },
    { label: "Concluídas", value: activeOrders.filter((order) => order.status === "finished" || order.status === "delivered").length, dot: "bg-emerald-500", icon: Check },
  ];
  const primaryActions = [
    { title: "Nova OS", text: "Criar ordem", icon: FilePlus2, onClick: onNewOrder },
    { title: "Buscar cliente", text: "Encontrar cadastro", icon: UserSearch, onClick: () => onNavigate("customers") },
    { title: "Buscar veículo", text: "Localizar placa", icon: Car, onClick: () => onNavigate("customers") },
    { title: "Emitir nota", text: "Buscar por CPF", icon: ReceiptText, onClick: onOpenFiscalDocument },
  ];
  const quickActions = [
    { label: "Agenda", icon: CalendarClock, onClick: () => onNavigate("history") },
    { label: "Cliente", icon: UserRound, onClick: onNewCustomer },
    { label: "Histórico", icon: Clock, onClick: () => onNavigate("history") },
    { label: "Faturamento", icon: Landmark, onClick: () => onNavigate("finance") },
  ];
  const focusOrders = openOrders.slice(0, 3);

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-8 pb-2">
      <motion.section variants={staggerItem}>
        <h2 className="text-[26px] font-semibold leading-tight tracking-[-0.03em] text-zinc-950 sm:text-3xl">
          O que deseja fazer hoje?
        </h2>
        <div className="mt-4 grid grid-cols-2 gap-2.5">
          {primaryActions.map((action) => {
            const Icon = action.icon;
            return (
              <Pressable
                key={action.title}
                onClick={action.onClick}
                scale={0.975}
                className="group flex min-h-[124px] flex-col justify-between rounded-2xl bg-white p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
              >
                <span className="grid size-10 place-items-center rounded-xl bg-zinc-100 text-zinc-700 transition-colors duration-200 group-hover:bg-zinc-950 group-hover:text-white">
                  <Icon className="size-[18px]" />
                </span>
                <span className="mt-4 block">
                  <span className="block text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">
                    {action.title}
                  </span>
                  <span className="mt-0.5 block text-[13px] text-zinc-500">{action.text}</span>
                </span>
              </Pressable>
            );
          })}
        </div>
      </motion.section>

      <motion.section variants={staggerItem}>
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">Acesso rápido</h2>
        <div className="mt-3 grid grid-cols-4 gap-2">
          {quickActions.map((action) => {
            const Icon = action.icon;
            return (
              <Pressable
                key={action.label}
                onClick={action.onClick}
                scale={0.94}
                className="flex flex-col items-center gap-2 text-center"
              >
                <span className="grid size-[52px] place-items-center rounded-2xl bg-white text-zinc-700 shadow-card">
                  <Icon className="size-[19px]" />
                </span>
                <span className="text-[11px] font-medium leading-tight tracking-[-0.01em] text-zinc-600">
                  {action.label}
                </span>
              </Pressable>
            );
          })}
        </div>
      </motion.section>

      <motion.section variants={staggerItem}>
        <div className="flex items-baseline justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">Status das OS</h2>
          <Pressable
            onClick={() => onNavigate("orders")}
            withHaptic={false}
            scale={0.96}
            className="text-[13px] font-medium text-zinc-500 transition-colors hover:text-zinc-950"
          >
            Ver todas
          </Pressable>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2.5">
          {statusCards.map((card) => {
            const Icon = card.icon;
            return (
              <Pressable
                key={card.label}
                onClick={() => onNavigate("orders")}
                scale={0.975}
                className="rounded-2xl bg-white p-3.5 shadow-card transition-shadow duration-300 hover:shadow-raised"
              >
                <span className="flex items-center justify-between">
                  <span className="flex items-center gap-1.5">
                    <span className={`size-1.5 rounded-full ${card.dot}`} />
                    <span className="text-[12px] font-medium tracking-[-0.01em] text-zinc-500">{card.label}</span>
                  </span>
                  <Icon className="size-3.5 text-zinc-300" />
                </span>
                <motion.strong
                  variants={popIn}
                  className="tabular mt-2 block text-[28px] font-semibold leading-none tracking-[-0.03em] text-zinc-950"
                >
                  {card.value}
                </motion.strong>
              </Pressable>
            );
          })}
        </div>
      </motion.section>

      <motion.section variants={staggerItem} className="space-y-2.5">
        <div className="flex items-center justify-between">
          <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">Em foco</h2>
          {focusOrders.length ? <Badge variant="muted">{focusOrders.length} agora</Badge> : null}
        </div>
        {focusOrders.length ? (
          focusOrders.map((order) => (
            <OrderListCard key={order.id} order={order} onOpenOrder={onOpenOrder} onOpenCustomer={onOpenCustomer} compact />
          ))
        ) : (
          <EmptyState icon={ClipboardCheck} title="Nenhuma OS aberta" text="Crie uma OS ou busque um cliente para iniciar o atendimento." />
        )}
      </motion.section>
    </motion.div>
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

  const selectedCustomer = state.customers.find((customer) => customer.id === selectedCustomerId && !customer.deletedAt);
  const filteredCustomers = state.customers.filter((customer) => {
    if (customer.deletedAt) return false;
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
    <div className="space-y-3">
      <Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filtrar clientes" />

      {/* `key` no contêiner remonta a lista quando o filtro muda, então os
          resultados entram em cascata em vez de trocar de conteúdo no lugar. */}
      <motion.div
        key={filter}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {filteredCustomers.map((customer) => (
          <motion.div key={customer.id} variants={staggerItem}>
            <Pressable
              scale={0.99}
              className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
              onClick={() => onSelectCustomer(customer.id)}
            >
              <span className="min-w-0">
                <span className="block truncate text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">
                  {customer.name}
                </span>
                <span className="tabular mt-0.5 block truncate text-[13px] text-zinc-500">
                  {formatCpf(customer.cpf)} · {formatPhone(customer.phone)}
                </span>
              </span>
              <ChevronRight className="size-[18px] shrink-0 text-zinc-300" />
            </Pressable>
          </motion.div>
        ))}
      </motion.div>

      {!filteredCustomers.length ? (
        <EmptyState icon={UsersRound} title="Nenhum cliente" text="Use o + da barra inferior para cadastrar o primeiro cliente." />
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
  const { state, deleteCustomer } = useWorkshop();
  if (!state) return null;
  const vehicles = getVehiclesForCustomer(state, customer.id);
  const orders = getOrdersForCustomer(state, customer.id);
  const pending = orders.filter((order) => order.paymentStatus !== "paid");
  const totalSpent = orders.reduce((sum, order) => sum + getOrderTotals(state, order.id).total, 0);

  function handleDeleteCustomer() {
    if (!window.confirm(`Excluir ${customer.name}? Cliente, veículos e OS vinculadas sairão das listas principais.`)) return;
    try {
      deleteCustomer(customer.id);
      toast.success("Cliente excluido.");
      onBack();
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="relative space-y-5">
      <motion.div variants={staggerItem}>
        <BackLink label="Clientes" onClick={onBack} />
      </motion.div>

      <motion.section variants={staggerItem} className="rounded-2xl bg-white p-5 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-[22px] font-semibold leading-tight tracking-[-0.025em] text-zinc-950">
              {customer.name}
            </h2>
            <p className="tabular mt-1 text-[13px] text-zinc-500">
              {formatCpf(customer.cpf)} · {formatPhone(customer.phone)}
            </p>
            <p className="mt-0.5 truncate text-[13px] text-zinc-400">{customer.email || "Cliente sem e-mail"}</p>
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
        {/* Excluir fica como texto discreto, não como botão vermelho cheio: a
            ação destrutiva precisa estar disponível sem competir com a primária. */}
        <button
          type="button"
          onClick={handleDeleteCustomer}
          className="mt-3 flex h-9 w-full items-center justify-center gap-1.5 rounded-full text-[13px] font-medium text-zinc-400 transition-colors hover:bg-rose-50 hover:text-rose-600 active:scale-[0.98]"
        >
          <Trash2 className="size-3.5" /> Excluir cliente
        </button>
      </motion.section>

      {vehicles.length ? (
        <motion.section variants={staggerItem} className="space-y-2.5">
          <SectionHeading>Veículos</SectionHeading>
          {vehicles.map((vehicle) => (
            <VehicleCard key={vehicle.id} vehicle={vehicle} />
          ))}
        </motion.section>
      ) : null}

      {orders.length ? (
        <motion.section variants={staggerItem} className="space-y-2.5">
          <SectionHeading>Histórico de serviços</SectionHeading>
          {orders.map((order) => (
            <OrderListCard key={order.id} order={order} onOpenOrder={onOpenOrder} />
          ))}
        </motion.section>
      ) : null}
    </motion.div>
  );
}

/** Cabeçalho de seção. Centraliza tamanho e peso para não variar entre telas. */
function SectionHeading({ children }: { children: ReactNode }) {
  return <h3 className="text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">{children}</h3>;
}

/**
 * Volta para a tela anterior. A seta ligeiramente deslocada no toque reforça a
 * direção do gesto, como o botão de voltar do iOS.
 */
function BackLink({ label, onClick }: { label: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onPointerDown={() => haptic("tap")}
      onClick={onClick}
      className="group -ml-1.5 inline-flex h-9 items-center gap-1 rounded-full pl-1.5 pr-3 text-[15px] font-medium text-zinc-500 transition-colors hover:text-zinc-950"
    >
      <ArrowLeft className="size-[18px] transition-transform duration-200 group-active:-translate-x-0.5" />
      {label}
    </button>
  );
}

function MiniStat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl bg-zinc-50 px-3 py-2.5 shadow-inset">
      {/* O rótulo vem antes do valor na hierarquia visual (menor e mais claro),
          mas depois na leitura — o número é o que se procura na varredura. */}
      <p className="text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400">{label}</p>
      <p className="tabular mt-0.5 truncate text-[14px] font-semibold tracking-[-0.015em] text-zinc-950">{value}</p>
    </div>
  );
}

function VehicleCard({ vehicle }: { vehicle: Vehicle }) {
  return (
    <div className="rounded-xl bg-white p-4 shadow-card">
      <VehicleVisual vehicle={vehicle} />
      <div className="mt-3 flex items-start justify-between gap-3">
        <div>
          <p className="font-semibold">
            {vehicle.brand} {vehicle.model}
          </p>
          <p className="mt-1 text-sm text-zinc-500">
            {formatPlate(vehicle.plate)} - {vehicle.year ?? "ano n/i"} - {vehicle.color ?? "cor n/i"}
          </p>
        </div>
        <Badge variant={vehicle.lookupStatus === "found" ? "success" : "muted"}>{vehicle.lookupStatus === "found" ? "API" : "Manual"}</Badge>
      </div>
    </div>
  );
}

function VehicleVisual({ vehicle }: { vehicle: Vehicle }) {
  const imageSrc = resolveVehicleImageUrl(vehicle);
  const fallbackSrc = getVehicleCategoryImageFallback(vehicle.category);

  return (
    <div className="relative overflow-hidden rounded-xl border border-zinc-200 bg-[linear-gradient(135deg,#fafafa,#eef8f5_48%,#fff7ed)]">
      <div className="absolute left-4 top-4 z-10 rounded-full bg-white/85 px-2.5 py-1 text-[11px] font-semibold text-zinc-700 shadow-card backdrop-blur">
        {vehicle.category === "motorcycle" ? "Moto" : vehicle.category === "truck" || vehicle.category === "van" ? "Utilitário" : "Carro"}
      </div>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={imageSrc}
        alt={`${vehicle.brand} ${vehicle.model}`}
        className="h-36 w-full object-contain p-4"
        onError={(event) => {
          if (event.currentTarget.src.endsWith(".svg")) return;
          event.currentTarget.src = fallbackSrc;
        }}
      />
      <div className="absolute bottom-0 left-0 right-0 flex items-end justify-between gap-3 bg-gradient-to-t from-white/95 to-transparent px-5 pb-4 pt-8">
        <div>
          <p className="text-sm font-semibold text-zinc-950">{vehicle.brand}</p>
          <p className="text-xs font-semibold text-zinc-500">{vehicle.model}</p>
        </div>
        <div className="flex items-center gap-2 rounded-full bg-white px-2.5 py-1.5 text-[11px] font-semibold text-zinc-700 shadow-card">
          <span
            className="size-3 rounded-full border border-zinc-300 bg-white"
            style={{ backgroundColor: vehicle.color?.toLowerCase().includes("branco") ? "#ffffff" : "#d4d4d8" }}
          />
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
  const orders = state.orders.filter((order) => !order.deletedAt && (statusFilter === "all" || order.status === statusFilter));

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

  const allOrders = state.orders.filter((order) => !order.deletedAt);
  const filterOptions = (["all", ...ORDER_STATUS_SEQUENCE, "cancelled"] as Array<"all" | OrderStatus>).map((status) => ({
    value: status,
    label: status === "all" ? "Todas" : ORDER_STATUS_LABEL[status],
    count: status === "all" ? allOrders.length : allOrders.filter((order) => order.status === status).length,
  }));

  return (
    <div className="space-y-3">
      <Segmented
        options={filterOptions}
        value={statusFilter}
        onChange={setStatusFilter}
        layoutId="orders-filter-active"
      />

      <motion.div
        key={statusFilter}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {orders.map((order) => (
          <motion.div key={order.id} variants={staggerItem}>
            <OrderListCard order={order} onOpenOrder={onSelectOrder} />
          </motion.div>
        ))}
      </motion.div>

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

  const progress = items.length ? (doneItems / items.length) * 100 : 0;

  return (
    <Pressable
      scale={0.99}
      className="w-full rounded-2xl bg-white p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
      onClick={() => onOpenOrder(order.id)}
      onDoubleClick={() => onOpenCustomer?.(order.customerId)}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="tabular text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">{order.number}</p>
          <p className="mt-0.5 truncate text-[13px] text-zinc-500">
            {customer?.name} · {vehicle?.model} {formatPlate(vehicle?.plate ?? "")}
          </p>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <Badge variant={badgeForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge>
          <Badge variant={badgeForPayment(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
        </div>
      </div>
      {compact ? (
        <div className="mt-3.5 rounded-xl bg-zinc-50 p-3 shadow-inset">
          <div className="flex items-center justify-between gap-3">
            <span className="truncate text-[13px] font-medium text-zinc-600">
              {nextItem ? nextItem.description : items.length ? "Tudo marcado como feito" : "Sem tarefa adicionada"}
            </span>
            <strong className="tabular shrink-0 text-[13px] font-semibold text-zinc-950">
              {items.length ? `${doneItems}/${items.length}` : "0/0"}
            </strong>
          </div>
          <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-zinc-200/80">
            {/* A barra cresce a partir de zero ao aparecer, o que comunica
                progresso melhor que um preenchimento já estático. */}
            <motion.div
              className="h-full rounded-full bg-zinc-950"
              initial={{ width: 0 }}
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1], delay: 0.12 }}
            />
          </div>
        </div>
      ) : (
        <div className="mt-3.5 grid grid-cols-3 gap-2">
          <MiniStat label="KM" value={order.currentMileage.toLocaleString("pt-BR")} />
          <MiniStat label="Total" value={formatCurrency(totals.total)} />
          <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
        </div>
      )}
    </Pressable>
  );
}

function OrderDetail({ order, onBack, onOpenCustomer }: { order: ServiceOrder; onBack: () => void; onOpenCustomer: () => void }) {
  const { state, advanceOrderStatus, updateOrder, deleteOrder, createQuoteRevision, approveQuoteRevision } = useWorkshop();
  const [actionSheetOpen, setActionSheetOpen] = useState(false);
  const [actionPanel, setActionPanel] = useState<"menu" | "budget" | "status" | "info" | "execution" | "photos" | "finish" | "delete">("menu");
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

  function handleDeleteOrder() {
    if (!window.confirm(`Excluir ${order.number}? Essa OS sera removida das listas do sistema.`)) return;
    try {
      deleteOrder(order.id);
      toast.success("OS excluida.");
      setActionSheetOpen(false);
      onBack();
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
    { id: "execution" as const, label: "Diagnóstico e execução", icon: Wrench },
    { id: "photos" as const, label: "Fotos e Anexos", icon: Images },
    { id: "finish" as const, label: isAlreadyFinalized ? "Comprovante e documento" : "Finalizar Serviço", icon: CreditCard },
    { id: "delete" as const, label: "Excluir OS", icon: Trash2 },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <BackLink label="Ordens" onClick={onBack} />
        <Button type="button" variant="outline" onClick={onOpenCustomer}>
          <UserRound /> Cliente
        </Button>
      </div>

      <section className="rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-bold text-zinc-500">{customer?.name}</p>
            <h2 className="mt-1 text-2xl font-semibold tracking-tight">{order.number}</h2>
            <p className="mt-1 text-sm text-zinc-500">
              {vehicle?.brand} {vehicle?.model} - {formatPlate(vehicle?.plate ?? "")}
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

      <section className="space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">O que fazer no carro</h3>
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
        <div className="rounded-xl bg-zinc-50 p-3">
          <div className="flex justify-between text-sm">
            <span>Total</span>
            <strong>{formatCurrency(totals.total)}</strong>
          </div>
          <div className="mt-1 flex justify-between text-sm text-zinc-500">
            <span>Pago</span>
            <span>{formatCurrency(totals.paid)}</span>
          </div>
          <div className="mt-3 flex justify-between text-lg font-semibold">
            <span>Falta receber</span>
            <span>{formatCurrency(totals.balance)}</span>
          </div>
        </div>
        {latestQuote ? (
          <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
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

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Status da OS</h3>
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

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center gap-2">
          <CalendarClock className="size-5 text-zinc-500" />
          <h3 className="font-semibold">Agenda e responsáveis</h3>
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

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Entrada do veículo</h3>
          <Badge variant="muted">{order.currentMileage.toLocaleString("pt-BR")} km</Badge>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <MiniStat label="Combustível" value={`${order.fuelLevel}%`} />
          <MiniStat label="Prioridade" value={PRIORITY_LABEL[order.priority]} />
        </div>
        <div className="rounded-xl bg-zinc-50 p-3 text-sm text-zinc-600">
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
                className="aspect-square rounded-xl border border-zinc-200 object-cover"
              />
            ))}
          </div>
        ) : null}
      </section>

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <h3 className="font-semibold">Diagnóstico e execução</h3>
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

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Financeiro</h3>
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
          <div key={payment.id} className="flex items-center justify-between rounded-xl bg-zinc-50 p-3">
            <div>
              <p className="text-sm font-bold">{PAYMENT_METHOD_LABEL[payment.method]}</p>
              <p className="text-xs text-zinc-500">{formatDateTime(payment.paidAt)}</p>
            </div>
            <strong>{formatCurrency(payment.amount)}</strong>
          </div>
        ))}
      </section>

      <section className="hidden space-y-3 rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h3 className="font-semibold">Documento</h3>
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
          <div className="sheet-scroll-area px-5">
            {actionPanel === "menu" ? (
              <div className="space-y-2">
                {actionItems.map((item) => {
                  const Icon = item.icon;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActionPanel(item.id)}
                      className="flex w-full items-center justify-between rounded-xl bg-white p-4 text-left shadow-card transition-shadow duration-300 hover:shadow-raised"
                    >
                      <span className="flex items-center gap-3">
                        <span className="grid size-10 place-items-center rounded-full bg-zinc-100 text-zinc-700">
                          <Icon className="size-5" />
                        </span>
                        <span className="text-sm font-semibold">{item.label}</span>
                      </span>
                      <ChevronRight className="size-5 text-zinc-400" />
                    </button>
                  );
                })}
              </div>
            ) : null}

            {actionPanel === "budget" ? (
              <div className="space-y-4">
                <BackLink label="Ações" onClick={() => setActionPanel("menu")} />
                <QuickTaskEntry orderId={order.id} />
                <div className="space-y-2">
                  {items.map((item) => (
                    <OrderItemRow key={item.id} item={item} />
                  ))}
                </div>
                {items.length > 0 && (
                  <div className="rounded-xl bg-zinc-50 p-3">
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
                <BackLink label="Ações" onClick={() => setActionPanel("menu")} />
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
                <BackLink label="Ações" onClick={() => setActionPanel("menu")} />
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

            {actionPanel === "execution" ? (
              <div className="space-y-4">
                <BackLink label="Ações" onClick={() => setActionPanel("menu")} />
                <Field label="Diagnóstico">
                  <Textarea value={executionDraft.diagnosis} onChange={(event) => setExecutionDraft((current) => ({ ...current, diagnosis: event.target.value }))} />
                </Field>
                <Field label="Recomendacoes do mecanico">
                  <Textarea
                    value={executionDraft.mechanicRecommendations}
                    onChange={(event) => setExecutionDraft((current) => ({ ...current, mechanicRecommendations: event.target.value }))}
                  />
                </Field>
                <Field label="Observacao para o cliente">
                  <Textarea value={executionDraft.customerNotes} onChange={(event) => setExecutionDraft((current) => ({ ...current, customerNotes: event.target.value }))} />
                </Field>
                <Field label="Observacao interna">
                  <Textarea value={executionDraft.internalNotes} onChange={(event) => setExecutionDraft((current) => ({ ...current, internalNotes: event.target.value }))} />
                </Field>
                <SignaturePad order={order} />
                <Button type="button" className="w-full" onClick={handleSaveExecution}>
                  <Check /> Salvar execucao
                </Button>
              </div>
            ) : null}

            {actionPanel === "delete" ? (
              <div className="space-y-4">
                <BackLink label="Ações" onClick={() => setActionPanel("menu")} />
                <div className="rounded-2xl border border-rose-200 bg-rose-50 p-4">
                  <div className="flex items-start gap-3">
                    <div className="grid size-10 place-items-center rounded-full bg-rose-100 text-rose-700">
                      <Trash2 className="size-5" />
                    </div>
                    <div>
                      <p className="font-semibold text-rose-950">Excluir esta OS?</p>
                      <p className="mt-1 text-sm font-medium text-rose-700">
                        Ela sera removida com itens, pagamentos, documentos e anexos vinculados.
                      </p>
                    </div>
                  </div>
                </div>
                <Button type="button" variant="danger" className="w-full" onClick={handleDeleteOrder}>
                  <Trash2 /> Confirmar exclusao
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
      <BackLink label="Ações" onClick={onBack} />
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
                className="aspect-square rounded-xl border border-zinc-200 object-cover"
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
    <div className={`rounded-xl border p-3 ${done ? "border-emerald-200 bg-emerald-50/60" : "border-zinc-200 bg-zinc-50"}`}>
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
          <p className="text-sm font-semibold">{formatCurrency(total)}</p>
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

function EmptyState({
  icon: Icon,
  title,
  text,
  action,
}: {
  icon: typeof Home;
  title: string;
  text: string;
  action?: ReactNode;
}) {
  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={springSmooth}
      className="grid place-items-center rounded-2xl bg-zinc-50/80 px-6 py-10 text-center shadow-inset"
    >
      <span className="grid size-12 place-items-center rounded-2xl bg-white text-zinc-400 shadow-card">
        <Icon className="size-5" />
      </span>
      <p className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">{title}</p>
      <p className="mt-1 max-w-[34ch] text-[13px] leading-5 text-zinc-500">{text}</p>
      {action ? <div className="mt-5">{action}</div> : null}
    </motion.div>
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
        <div className="sheet-scroll-area px-5">
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
              <BackLink label="CPF" onClick={() => patchDraft({ step: "cpf" })} />
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
              <label className="flex items-center gap-3 rounded-xl bg-zinc-50 p-3 text-sm font-semibold text-zinc-700">
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

function createOrderFlowDraft(customerId?: string) {
  return {
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
  };
}

type OrderFlowDraft = ReturnType<typeof createOrderFlowDraft>;

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
  const [knownVehicle, setKnownVehicle] = useState(false);
  const [draft, setDraft] = useState<OrderFlowDraft>(() => createOrderFlowDraft(customerId));
  const [errors, setErrors] = useState<Record<string, string>>({});

  const patchDraft = useCallback((patch: Partial<OrderFlowDraft>) => {
    setDraft((current) => ({ ...current, ...patch }));
  }, []);

  if (!state) return null;
  const currentState = state;
  const customer = currentState.customers.find((item) => item.id === String(draft.customerId));
  const selectedVehicle = currentState.vehicles.find((item) => item.id === String(draft.vehicleId));

  function handlePlate(event: FormEvent<HTMLFormElement>) {
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
      setKnownVehicle(true);
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
      toast.success(`${existing.brand} ${existing.model} reconhecido pela placa.`);
      return;
    }
    setKnownVehicle(false);
    patchDraft({ plate, step: "vehicle" });
  }

  async function handleVehicle(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    try {
      const category = String(draft.category) as Vehicle["category"];
      const lookupForSave: VehicleLookupResult = {
        status: "found",
        brand: String(draft.brand),
        model: String(draft.model),
        version: String(draft.version) || undefined,
        year: draft.year ? Number(draft.year) : undefined,
        color: String(draft.color) || undefined,
        category,
        provider: "Catálogo FIPE",
        imageUrl: localImageForCategory(category),
      };
      const result = createOrUpdateVehicle(
        String(draft.customerId),
        {
          plate: String(draft.plate),
          brand: String(draft.brand),
          model: String(draft.model),
          version: String(draft.version),
          year: draft.year ? Number(draft.year) : undefined,
          color: String(draft.color),
          category,
        },
        lookupForSave,
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
      setDraft(createOrderFlowDraft(customerId));
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
        <div className="sheet-scroll-area px-5">
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
              <div className="rounded-xl bg-zinc-50 p-3">
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
              <Button type="submit" className="w-full">
                Continuar
              </Button>
              <p className="text-center text-xs text-zinc-500">
                Se o veículo já passou pela oficina, os dados são preenchidos automaticamente.
              </p>
            </form>
          ) : null}

          {customer && draft.step === "vehicle" ? (
            <form onSubmit={handleVehicle} className="space-y-4">
              <BackLink label="Placa" onClick={() => patchDraft({ step: "plate" })} />
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <p className="text-sm font-bold">Placa {formatPlate(String(draft.plate))}</p>
                <p className="mt-0.5 text-xs text-zinc-500">
                  Primeiro cadastro desta placa. Selecione os dados abaixo.
                </p>
              </div>

              <VehicleIdentityFields
                values={{
                  category: String(draft.category) as Vehicle["category"],
                  brand: String(draft.brand),
                  model: String(draft.model),
                  version: String(draft.version),
                  year: String(draft.year),
                  color: String(draft.color),
                }}
                onChange={patchDraft}
                errors={errors}
              />

              <Button type="submit" className="w-full">
                Continuar
              </Button>
            </form>
          ) : null}

          {customer && draft.step === "order" ? (
            <form onSubmit={handleOrder} className="space-y-4">
              <BackLink label="Veículo" onClick={() => patchDraft({ step: "vehicle" })} />
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
                      className={`h-11 rounded-xl border text-sm font-semibold transition ${
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
          <div className="rounded-xl bg-zinc-50 p-3">
            <p className="text-sm font-bold">Saldo restante</p>
            <p className="text-2xl font-semibold">{formatCurrency(totals?.balance ?? 0)}</p>
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
        <div className="sheet-scroll-area px-5">
          <DocumentPreview orderId={orderId} />
        </div>
      </SheetContent>
    </Sheet>
  );
}

function FiscalDocumentSheet({
  open,
  onOpenChange,
  onOpenOrder,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenOrder: (orderId: string) => void;
}) {
  const { state, generateDocument } = useWorkshop();
  const [cpf, setCpf] = useState("");
  const [selectedCustomerId, setSelectedCustomerId] = useState("");
  const [feedback, setFeedback] = useState("");
  const logoDataUrl = useLogoPngDataUrl(open);
  const generatedFiscalDocs = useRef<Set<string>>(new Set());

  if (!state) return null;
  const currentState = state;

  const customer = selectedCustomerId ? getCustomer(currentState, selectedCustomerId) : undefined;
  const customerOrders = customer ? getOrdersForCustomer(currentState, customer.id).filter((order) => order.status !== "cancelled") : [];
  const openOrders = customerOrders.filter((order) => !["finished", "delivered", "cancelled"].includes(order.status));
  const selectedOrder = openOrders[0] ?? customerOrders[0];
  const selectedVehicle = selectedOrder ? getVehicle(currentState, selectedOrder.vehicleId) : undefined;
  const selectedTotals = selectedOrder ? getOrderTotals(currentState, selectedOrder.id) : undefined;
  const latestFiscalDocument = selectedOrder
    ? currentState.documents
        .filter((document) => document.orderId === selectedOrder.id && document.type === "fiscal_receipt" && document.status === "generated")
        .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0]
    : undefined;

  function handleOpenChange(nextOpen: boolean) {
    if (!nextOpen) {
      setCpf("");
      setSelectedCustomerId("");
      setFeedback("");
    }
    onOpenChange(nextOpen);
  }

  function handleCpfSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = normalizeCpf(cpf);
    if (!isValidCpf(normalized)) {
      setFeedback("CPF invalido.");
      return;
    }

    const found = findCustomerByCpf(currentState, normalized);
    if (!found) {
      setSelectedCustomerId("");
      setFeedback("Nenhum cliente cadastrado com este CPF.");
      return;
    }

    setSelectedCustomerId(found.id);
    setFeedback("");
  }

  function ensureFiscalDocument() {
    if (!selectedOrder) throw new Error("Nenhuma OS encontrada para este cliente.");
    if (latestFiscalDocument || generatedFiscalDocs.current.has(selectedOrder.id)) return;
    generateDocument(selectedOrder.id, "fiscal_receipt", newId("document_op"));
    generatedFiscalDocs.current.add(selectedOrder.id);
  }

  function handlePdf(mode: "download" | "print" | "share") {
    if (!selectedOrder) {
      toast.error("Nenhuma OS encontrada para emitir.");
      return;
    }

    try {
      ensureFiscalDocument();
      const pdf = buildDocumentPdf(currentState, selectedOrder, "fiscal_receipt", logoDataUrl);
      const fileName = `${selectedOrder.number}-nota-fiscal.pdf`;

      if (mode === "download") {
        pdf.save(fileName);
        toast.success("Nota fiscal baixada.");
        return;
      }

      const blob = pdf.output("blob");
      const url = URL.createObjectURL(blob);
      if (mode === "print") {
        window.open(url, "_blank", "noopener,noreferrer");
        toast.success("Arquivo aberto para impressao.");
        return;
      }

      const file = new File([blob], fileName, { type: "application/pdf" });
      if (navigator.canShare?.({ files: [file] })) {
        void navigator.share({ title: fileName, files: [file] });
      } else {
        pdf.save(fileName);
      }
    } catch (error) {
      toast.error(errorMessage(error));
    }
  }

  return (
    <Sheet open={open} onOpenChange={handleOpenChange}>
      <SheetContent className="sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle>Emitir nota fiscal</SheetTitle>
          <SheetDescription>Busque o CPF; o sistema usa automaticamente a última OS aberta ou, se não houver, a última OS do cliente.</SheetDescription>
        </SheetHeader>
        <div className="sheet-scroll-area space-y-4 px-5">
          <form onSubmit={handleCpfSearch} className="space-y-3">
            <Field label="CPF do cliente">
              <Input
                value={formatCpf(cpf)}
                onChange={(event) => {
                  setCpf(normalizeCpf(event.target.value));
                  setFeedback("");
                }}
                inputMode="numeric"
                autoFocus
                placeholder="000.000.000-00"
              />
            </Field>
            {feedback ? <p className="text-sm font-semibold text-rose-600">{feedback}</p> : null}
            <Button type="submit" className="w-full">
              <Search /> Buscar OS
            </Button>
          </form>

          {customer ? (
            <section className="space-y-3 rounded-xl bg-white p-4 shadow-card">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold">{customer.name}</p>
                  <p className="mt-1 text-sm text-zinc-500">{formatCpf(customer.cpf)} - {formatPhone(customer.phone)}</p>
                </div>
                <Badge variant={openOrders.length ? "warning" : "muted"}>{openOrders.length ? "OS aberta" : "última OS"}</Badge>
              </div>

              {selectedOrder && selectedTotals ? (
                <div className="rounded-xl bg-zinc-50 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{selectedOrder.number}</p>
                      <p className="mt-1 text-xs font-semibold text-zinc-500">
                        {selectedVehicle ? `${formatPlate(selectedVehicle.plate)} - ${selectedVehicle.brand} ${selectedVehicle.model}` : "Veículo não encontrado"}
                      </p>
                    </div>
                    <Badge variant={selectedOrder.status === "finished" || selectedOrder.status === "delivered" ? "success" : "info"}>
                      {ORDER_STATUS_LABEL[selectedOrder.status]}
                    </Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MiniStat label="Total" value={formatCurrency(selectedTotals.total)} />
                    <MiniStat label="Pago" value={formatCurrency(selectedTotals.paid)} />
                    <MiniStat label="Saldo" value={formatCurrency(selectedTotals.balance)} />
                  </div>
                  {latestFiscalDocument ? (
                    <p className="mt-3 text-xs font-semibold text-emerald-700">
                      Nota fiscal registrada em {formatDateTime(latestFiscalDocument.createdAt)}.
                    </p>
                  ) : (
                    <p className="mt-3 text-xs font-semibold text-amber-700">
                      Ao baixar, imprimir ou compartilhar, o registro fiscal fica salvo no historico da OS.
                    </p>
                  )}
                </div>
              ) : (
                <EmptyState icon={ReceiptText} title="Cliente sem OS" text="Abra uma OS para este cliente antes de emitir a nota." />
              )}

              {selectedOrder ? (
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <Button type="button" variant="outline" onClick={() => handlePdf("download")}>
                    <Download /> Baixar
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handlePdf("print")}>
                    <Printer /> Imprimir
                  </Button>
                  <Button type="button" variant="outline" onClick={() => handlePdf("share")}>
                    <Share2 /> Compartilhar
                  </Button>
                  <Button type="button" onClick={() => { onOpenChange(false); onOpenOrder(selectedOrder.id); }}>
                    <ClipboardCheck /> Ver OS
                  </Button>
                </div>
              ) : null}
            </section>
          ) : null}
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
  const currentFinalLabor = order?.finalLaborAmount ?? 0;
  const originalTotal = totals ? Math.max(0, totals.total - currentFinalLabor) : 0;

  const [finalAmount, setFinalAmount] = useState(originalTotal);
  const [finalAmountInput, setFinalAmountInput] = useState(originalTotal.toFixed(2).replace(".", ","));
  const [laborAmount, setLaborAmount] = useState(currentFinalLabor);
  const [laborAmountInput, setLaborAmountInput] = useState(currentFinalLabor.toFixed(2).replace(".", ","));
  const [userChangedAmount, setUserChangedAmount] = useState(false);
  const [signature, setSignature] = useState("");
  const [document, setDocument] = useState<DocumentRecord | null>(null);
  const logoDataUrl = useLogoPngDataUrl();
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
  const documentTotal = finalAmount + laborAmount;
  const change = cashReceived ? Math.max(0, cashReceivedNum - documentTotal) : 0;
  const remaining = cashReceived ? Math.max(0, documentTotal - cashReceivedNum) : documentTotal;
  const installmentValue = effectiveInstallments > 0 ? documentTotal / effectiveInstallments : documentTotal;

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

  function handleLaborAmountChange(raw: string) {
    setLaborAmountInput(raw);
    setLaborAmount(parseCurrencyInput(raw));
  }

  function finish() {
    try {
      const generated = finishService(
        currentOrder.id,
        {
          finalAmount: documentTotal,
          laborAmount,
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
        <BackLink label="Ações" onClick={onBack} />

        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4">
          <div className="flex items-center gap-3">
            <div className="grid size-10 place-items-center rounded-full bg-emerald-100">
              <Check className="size-5 text-emerald-700" />
            </div>
            <div>
              <p className="font-semibold text-emerald-950">Serviço já finalizado</p>
              <p className="text-sm text-emerald-700">Esta OS já foi concluída e possui documento gerado.</p>
            </div>
          </div>
        </div>

        <p className="text-sm text-zinc-600">Deseja alterar algo na nota ou apenas realizar o download novamente do comprovante?</p>

        <div className="space-y-2">
          {latestDoc && (
            <div className="rounded-xl border border-zinc-200 bg-white p-3">
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
      <BackLink label="Ações" onClick={onBack} />

      {/* Summary */}
      <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
        <p className="text-sm font-bold">{showReFinalize ? "Gerar nova versão" : "Conferência final"}</p>
        <p className="mt-1 text-xs text-zinc-500">Confirme os valores antes de gerar o documento final.</p>
        <div className="mt-3 grid grid-cols-3 gap-2">
          <MiniStat label="Itens" value={getOrderItems(currentState, currentOrder.id).length} />
          <MiniStat label="Subtotal" value={formatCurrency(currentTotals.total)} />
          <MiniStat label="M.O. final" value={formatCurrency(laborAmount)} />
          <MiniStat label="Saldo" value={formatCurrency(currentTotals.balance)} />
        </div>
      </div>

      {/* Final amount - only show edit if not yet finalized */}
      {!document ? (
        <>
          <Field label="Valor do cliente sem M.O. final">
            <Input
              value={finalAmountInput}
              onChange={(event) => handleFinalAmountChange(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
            {userChangedAmount && (
              <p className="mt-1 text-xs font-semibold text-amber-600">
                Valor alterado - sera adicionado um item de ajuste ao orcamento.
              </p>
            )}
          </Field>

          <Field label="Mao de obra do mecanico">
            <Input
              value={laborAmountInput}
              onChange={(event) => handleLaborAmountChange(event.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
            <p className="mt-1 text-xs font-semibold text-zinc-500">
              Entra como item de mao de obra, aparece no comprovante e soma no total.
            </p>
          </Field>

          <div className="rounded-2xl bg-white p-4 shadow-card">
            <div className="flex items-center justify-between text-sm font-semibold text-zinc-500">
              <span>Subtotal</span>
              <span>{formatCurrency(finalAmount)}</span>
            </div>
            <div className="mt-2 flex items-center justify-between text-sm font-semibold text-zinc-500">
              <span>Mao de obra</span>
              <span>{formatCurrency(laborAmount)}</span>
            </div>
            <div className="mt-3 flex items-center justify-between border-t border-zinc-100 pt-3">
              <span className="text-sm font-semibold text-zinc-950">Total do comprovante</span>
              <span className="text-xl font-semibold text-zinc-950">{formatCurrency(documentTotal)}</span>
            </div>
          </div>

          {/* Payment method */}
          <div className="space-y-3">
            <Label>Como o cliente pagou?</Label>
            <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-5">
              {paymentMethods.map((method) => (
                <button
                  key={method.id}
                  type="button"
                  onClick={() => { setPaymentMethod(method.id); setShowCustomInstallment(false); setCustomInstallment(""); }}
                  className={`rounded-xl border px-2 py-2.5 text-xs font-bold transition ${
                    paymentMethod === method.id
                      ? "border-zinc-950 bg-zinc-950 text-white"
                      : "border-zinc-200 bg-white text-zinc-600 hover:bg-zinc-50"
                  }`}
                >
                  {method.label}
                </button>
              ))}
            </div>

            {/* Cash / Pix - show change */}
            {(paymentMethod === "cash" || paymentMethod === "pix") && (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
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
                      <div className="rounded-xl bg-emerald-50 p-3 text-center">
                        <p className="text-xs font-semibold text-emerald-700">Troco</p>
                        <p className="text-lg font-semibold text-emerald-900">{formatCurrency(change)}</p>
                      </div>
                    ) : null}
                    {remaining > 0 ? (
                      <div className="rounded-xl bg-amber-50 p-3 text-center">
                        <p className="text-xs font-semibold text-amber-700">Falta pagar</p>
                        <p className="text-lg font-semibold text-amber-900">{formatCurrency(remaining)}</p>
                      </div>
                    ) : (
                      change === 0 && cashReceived ? (
                        <div className="col-span-2 rounded-xl bg-emerald-50 p-3 text-center">
                          <p className="text-sm font-semibold text-emerald-900">Pagamento exato!</p>
                        </div>
                      ) : null
                    )}
                  </div>
                )}
              </div>
            )}

            {/* Credit - show installments */}
            {paymentMethod === "credit" && (
              <div className="space-y-3 rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <Field label="Número de parcelas">
                  <div className="grid grid-cols-4 gap-1.5 sm:grid-cols-7">
                    {[1, 2, 3, 4, 6, 12].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => { setCreditInstallments(n); setShowCustomInstallment(false); setCustomInstallment(""); }}
                        className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
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
                      className={`rounded-xl border py-2.5 text-sm font-semibold transition ${
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
                <div className="rounded-xl bg-white p-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-zinc-600">
                      {effectiveInstallments}x de
                    </span>
                    <span className="text-lg font-semibold">{formatCurrency(installmentValue)}</span>
                  </div>
                  <div className="mt-1 flex items-center justify-between">
                    <span className="text-xs text-zinc-500">Total</span>
                    <span className="text-sm font-bold">{formatCurrency(documentTotal)}</span>
                  </div>
                </div>
              </div>
            )}

            {/* Debit */}
            {paymentMethod === "debit" && (
              <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-3">
                <div className="flex items-center justify-between">
                  <span className="text-sm text-zinc-600">Total no débito</span>
                  <span className="text-lg font-semibold">{formatCurrency(documentTotal)}</span>
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
        <div className="space-y-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-semibold text-emerald-950">Documento salvo</p>
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
        className="h-32 w-full touch-none rounded-xl border border-dashed border-zinc-300 bg-white"
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
  const [financeTab, setFinanceTab] = useState<FinanceTab>("extract");
  const [selectedTransactionId, setSelectedTransactionId] = useState<string | null>(null);
  const [paymentOrderId, setPaymentOrderId] = useState<string | null>(null);
  const [documentOrderId, setDocumentOrderId] = useState<string | null>(null);
  if (!state) return null;
  const activeOrders = state.orders.filter((order) => !order.deletedAt);

  const totals = activeOrders.reduce(
    (acc, order) => {
      const orderTotals = getOrderTotals(state, order.id);
      acc.revenue += orderTotals.total;
      acc.paid += orderTotals.paid;
      acc.balance += orderTotals.balance;
      return acc;
    },
    { revenue: 0, paid: 0, balance: 0 },
  );
  const costs = state.orderItems.reduce((sum, item) => sum + item.cost * item.quantity, 0);
  const net = totals.paid - costs;
  const pending = activeOrders.filter((order) => getOrderTotals(state, order.id).balance > 0);
  const paymentTransactions: FinanceTransaction[] = state.payments
    .filter((payment) => payment.status === "confirmed" && activeOrders.some((order) => order.id === payment.orderId))
    .map((payment) => {
      const order = state.orders.find((entry) => entry.id === payment.orderId);
      const customer = order ? getCustomer(state, order.customerId) : null;
      return {
        id: payment.id,
        type: "Entrada",
        title: "Recebimento " + (order?.number ?? "OS"),
        detail: (customer?.name ?? "Cliente") + " - " + PAYMENT_METHOD_LABEL[payment.method],
        amount: payment.amount,
        date: payment.paidAt,
        icon: ArrowDownLeft,
        tone: "text-emerald-700 bg-emerald-50",
        orderId: payment.orderId,
      };
    });
  const costTransactions: FinanceTransaction[] = state.orderItems
    .filter((item) => item.cost > 0 && activeOrders.some((order) => order.id === item.orderId))
    .map((item) => ({
      id: "cost-" + item.id,
      type: "Saída",
      title: item.description,
      detail: "Custo de peça/serviço",
      amount: item.cost * item.quantity,
      date: item.updatedAt,
      icon: ArrowUpRight,
      tone: "text-rose-700 bg-rose-50",
      orderId: item.orderId,
    }));
  const pendingTransactions: FinanceTransaction[] = pending.map((order) => {
    const customer = getCustomer(state, order.customerId);
    const orderTotals = getOrderTotals(state, order.id);
    return {
      id: "pending-" + order.id,
      type: "Pendente",
      title: "Saldo " + order.number,
      detail: customer?.name ?? "Cliente",
      amount: orderTotals.balance,
      date: order.updatedAt,
      icon: Clock,
      tone: "text-amber-700 bg-amber-50",
      orderId: order.id,
    };
  });
  const transactions = [...paymentTransactions, ...costTransactions, ...pendingTransactions]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 24);
  const selectedTransaction = transactions.find((transaction) => transaction.id === selectedTransactionId) ?? null;
  const receipts = state.documents
    .filter((document) => document.status === "generated" && activeOrders.some((order) => order.id === document.orderId))
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  return (
    <div className="space-y-5">
      <section className="overflow-hidden rounded-3xl bg-zinc-950 p-5 text-white shadow-2xl shadow-zinc-950/20">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-bold uppercase text-white/50">Saldo disponivel</p>
            <h2 className="mt-2 text-3xl font-semibold tracking-tight sm:text-4xl">{formatCurrency(totals.paid)}</h2>
          </div>
          <div className="grid size-11 place-items-center rounded-full bg-white/10 text-white ring-1 ring-white/10">
            <Wallet className="size-5" />
          </div>
        </div>
        <div className="mt-7 grid grid-cols-2 gap-3 text-sm">
          <div className="rounded-2xl bg-white/8 p-3 ring-1 ring-white/10">
            <p className="font-semibold text-white/50">Liquido estimado</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(net)}</p>
          </div>
          <div className="rounded-2xl bg-white/8 p-3 ring-1 ring-white/10">
            <p className="font-semibold text-white/50">A receber</p>
            <p className="mt-1 text-lg font-semibold">{formatCurrency(totals.balance)}</p>
          </div>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-2">
        <BankMetric label="Recebido" value={formatCurrency(totals.paid)} icon={Landmark} tone="emerald" />
        <BankMetric label="Pendente" value={formatCurrency(totals.balance)} icon={Clock} tone="amber" />
        <BankMetric label="Faturado" value={formatCurrency(totals.revenue)} icon={ReceiptText} tone="sky" />
      </section>

      <section className="grid grid-cols-3 gap-1 rounded-2xl bg-white p-1 shadow-card">
        <FinanceSegmentButton active={financeTab === "extract"} icon={ArrowDownLeft} label="Extrato" onClick={() => setFinanceTab("extract")} />
        <FinanceSegmentButton active={financeTab === "pending"} icon={Clock} label="Pendentes" onClick={() => setFinanceTab("pending")} />
        <FinanceSegmentButton active={financeTab === "receipts"} icon={ReceiptText} label="Comprovantes" onClick={() => setFinanceTab("receipts")} />
      </section>

      {financeTab === "extract" ? (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Extrato</h2>
          <Badge variant="muted">{transactions.length} logs</Badge>
        </div>
        <div className="overflow-hidden rounded-2xl bg-white shadow-card">
          {transactions.map((transaction) => {
            const Icon = transaction.icon;
            const isOut = transaction.type === "Saída";
            return (
              <button
                key={transaction.id}
                type="button"
                onClick={() => setSelectedTransactionId(transaction.id)}
                className="flex w-full items-center gap-3 border-b border-zinc-100 p-4 text-left transition last:border-0 hover:bg-zinc-50"
              >
                <span className={"grid size-11 shrink-0 place-items-center rounded-full " + transaction.tone}>
                  <Icon className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-zinc-950">{transaction.title}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-zinc-500">{transaction.detail}</span>
                </span>
                <span className="text-right">
                  <span className={"block text-sm font-semibold " + (isOut ? "text-rose-600" : "text-zinc-950")}>
                    {isOut ? "-" : "+"}{formatCurrency(transaction.amount)}
                  </span>
                  <span className="mt-0.5 block text-[11px] font-semibold text-zinc-400">{formatDate(transaction.date)}</span>
                </span>
              </button>
            );
          })}
          {!transactions.length ? (
            <div className="p-4">
              <EmptyState icon={CircleDollarSign} title="Sem movimentação" text="Pagamentos, custos e saldos pendentes aparecem aqui quando houver OS." />
            </div>
          ) : null}
        </div>
      </section>
      ) : null}

      {financeTab === "pending" ? (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <SectionHeading>Saldos pendentes</SectionHeading>
          <Badge variant="warning">{pending.length}</Badge>
        </div>
        <motion.div variants={staggerContainer} initial="hidden" animate="visible" className="space-y-2">
          {pending.map((order) => (
            <motion.div key={order.id} variants={staggerItem}>
              <Pressable
                onClick={() => setPaymentOrderId(order.id)}
                scale={0.99}
                className="flex w-full items-center justify-between gap-3 rounded-2xl bg-white p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
              >
                <span className="min-w-0">
                  <span className="tabular block text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">
                    {order.number}
                  </span>
                  <span className="mt-0.5 block truncate text-[13px] text-zinc-500">
                    {getCustomer(state, order.customerId)?.name ?? "Cliente"}
                  </span>
                </span>
                <span className="shrink-0 text-right">
                  <span className="tabular block text-[15px] font-semibold tracking-[-0.015em] text-amber-700">
                    {formatCurrency(getOrderTotals(state, order.id).balance)}
                  </span>
                  <span className="mt-0.5 block text-[10px] font-medium uppercase tracking-[0.08em] text-zinc-400">
                    Receber
                  </span>
                </span>
              </Pressable>
            </motion.div>
          ))}
        </motion.div>
        {!pending.length ? (
          <EmptyState icon={Check} title="Nada pendente" text="Todas as ordens com valor fechado aparecem como quitadas." />
        ) : null}
      </section>
      ) : null}

      {financeTab === "receipts" ? (
      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Comprovantes</h2>
          <Badge variant="info">{receipts.length}</Badge>
        </div>
        <div className="space-y-2">
          {receipts.map((document) => {
            const order = state.orders.find((entry) => entry.id === document.orderId);
            return (
              <button
                key={document.id}
                type="button"
                onClick={() => setDocumentOrderId(document.orderId)}
                className="flex w-full items-center gap-3 rounded-2xl bg-white p-4 text-left shadow-card transition-shadow duration-300 hover:shadow-raised"
              >
                <span className="grid size-11 place-items-center rounded-full bg-sky-50 text-sky-700">
                  <ReceiptText className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">Comprovante {order?.number ?? "OS"}</span>
                  <span className="mt-0.5 block truncate text-xs font-semibold text-zinc-500">Versão {document.version} - {formatDateTime(document.createdAt)}</span>
                </span>
                <span className="text-sm font-semibold">{formatCurrency(document.total)}</span>
              </button>
            );
          })}
          {!receipts.length ? (
            <EmptyState icon={ReceiptText} title="Sem comprovantes" text="Finalize uma OS ou gere um documento para ele aparecer aqui." />
          ) : null}
        </div>
      </section>
      ) : null}

      <FinanceTransactionSheet
        transaction={selectedTransaction}
        onOpenChange={(open) => {
          if (!open) setSelectedTransactionId(null);
        }}
        onOpenOrder={onOpenOrder}
        onOpenPayment={setPaymentOrderId}
        onOpenDocument={setDocumentOrderId}
      />
      {paymentOrderId ? <PaymentSheet open={Boolean(paymentOrderId)} onOpenChange={(open) => !open && setPaymentOrderId(null)} orderId={paymentOrderId} /> : null}
      {documentOrderId ? <DocumentSheet open={Boolean(documentOrderId)} onOpenChange={(open) => !open && setDocumentOrderId(null)} orderId={documentOrderId} /> : null}
    </div>
  );
}

function BankMetric({
  label,
  value,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  icon: typeof Home;
  tone: "sky" | "amber" | "emerald";
}) {
  const toneClass = {
    sky: "bg-sky-50 text-sky-700 ring-sky-100",
    amber: "bg-amber-50 text-amber-700 ring-amber-100",
    emerald: "bg-emerald-50 text-emerald-700 ring-emerald-100",
  }[tone];

  return (
    <div className="min-h-28 rounded-2xl bg-white p-3 shadow-card">
      <div className={"grid size-9 place-items-center rounded-full ring-1 " + toneClass}>
        <Icon className="size-4" />
      </div>
      <p className="mt-3 truncate text-sm font-semibold tracking-tight text-zinc-950 sm:text-base">{value}</p>
      <p className="mt-1 text-[11px] font-semibold uppercase text-zinc-400">{label}</p>
    </div>
  );
}

function FinanceSegmentButton({
  active,
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: typeof Home;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onPointerDown={() => {
        if (!active) haptic("select");
      }}
      onClick={onClick}
      className={`flex min-h-11 items-center justify-center gap-2 rounded-xl px-2 text-[13px] font-semibold tracking-[-0.01em] transition-colors duration-200 active:scale-[0.97] ${
        active
          ? "bg-zinc-950 text-white shadow-[0_1px_3px_rgba(24,24,27,0.28)]"
          : "text-zinc-500 hover:bg-zinc-100/70 hover:text-zinc-950"
      }`}
    >
      <Icon className="size-4" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function FinanceTransactionSheet({
  transaction,
  onOpenChange,
  onOpenOrder,
  onOpenPayment,
  onOpenDocument,
}: {
  transaction: FinanceTransaction | null;
  onOpenChange: (open: boolean) => void;
  onOpenOrder: (orderId: string) => void;
  onOpenPayment: (orderId: string) => void;
  onOpenDocument: (orderId: string) => void;
}) {
  const { state } = useWorkshop();
  const order = transaction && state ? state.orders.find((entry) => entry.id === transaction.orderId) : null;
  const customer = order && state ? getCustomer(state, order.customerId) : null;
  const isOut = transaction?.type === "Saída";

  return (
    <Sheet open={Boolean(transaction)} onOpenChange={onOpenChange}>
      <SheetContent>
        <SheetHeader>
          <SheetTitle>{transaction?.type ?? "Lançamento"}</SheetTitle>
          <SheetDescription>Detalhe financeiro do valor selecionado no extrato.</SheetDescription>
        </SheetHeader>
        {transaction ? (
          <div className="space-y-4 px-5 pb-6">
            <div className="rounded-3xl bg-zinc-950 p-5 text-white">
              <p className="text-xs font-bold uppercase text-white/50">{transaction.title}</p>
              <p className={`mt-3 text-3xl font-semibold ${isOut ? "text-rose-200" : "text-white"}`}>
                {isOut ? "-" : "+"}{formatCurrency(transaction.amount)}
              </p>
              <p className="mt-2 text-sm font-semibold text-white/60">{formatDateTime(transaction.date)}</p>
            </div>
            <div className="rounded-2xl bg-white p-4 shadow-card">
              <InfoRow label="Descrição" value={transaction.detail} />
              <InfoRow label="OS" value={order?.number ?? "Não vinculada"} />
              <InfoRow label="Cliente" value={customer?.name ?? "Cliente"} />
              <InfoRow label="Tipo" value={transaction.type} />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {transaction.type === "Pendente" ? (
                <Button type="button" onClick={() => { onOpenChange(false); onOpenPayment(transaction.orderId); }}>
                  <CreditCard /> Receber
                </Button>
              ) : (
                <Button type="button" onClick={() => { onOpenChange(false); onOpenDocument(transaction.orderId); }}>
                  <ReceiptText /> Comprovante
                </Button>
              )}
              <Button type="button" variant="outline" onClick={() => { onOpenChange(false); onOpenOrder(transaction.orderId); }}>
                <ClipboardCheck /> Ver OS
              </Button>
            </div>
          </div>
        ) : null}
      </SheetContent>
    </Sheet>
  );
}

function HistoryView({ onOpenOrder }: { onOpenOrder: (orderId: string) => void }) {
  const { state } = useWorkshop();
  const [filter, setFilter] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "finished" | "delivered" | "cancelled" | "partial" | "paid">("all");
  if (!state) return null;

  const normalizedQuery = filter.trim().toLowerCase();

  const filtered = state.orders.filter((order) => {
    if (order.deletedAt) return false;
    const customer = getCustomer(state, order.customerId);
    const vehicle = getVehicle(state, order.vehicleId);
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
        <Search className="pointer-events-none absolute left-3.5 top-1/2 z-10 size-[17px] -translate-y-1/2 text-zinc-400" />
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
      <Segmented
        options={[
          { value: "all", label: "Todos" },
          { value: "finished", label: "Finalizados" },
          { value: "delivered", label: "Entregues" },
          { value: "paid", label: "Pagos" },
          { value: "partial", label: "Parcial" },
          { value: "cancelled", label: "Cancelados" },
        ]}
        value={statusFilter}
        onChange={setStatusFilter}
        layoutId="history-filter-active"
      />

      {/* Results count */}
      <p className="tabular text-[12px] font-medium text-zinc-400">
        {filtered.length} registro{filtered.length === 1 ? "" : "s"} encontrado{filtered.length === 1 ? "" : "s"}
      </p>

      {/* Order list */}
      <motion.div
        key={`${statusFilter}-${filter}-${dateFrom}-${dateTo}`}
        variants={staggerContainer}
        initial="hidden"
        animate="visible"
        className="space-y-2"
      >
        {filtered.map((order) => {
          const customer = getCustomer(state, order.customerId);
          const vehicle = getVehicle(state, order.vehicleId);
          const totals = getOrderTotals(state, order.id);
          return (
            <motion.div key={order.id} variants={staggerItem}>
              <Pressable
                scale={0.99}
                className="w-full rounded-2xl bg-white p-4 shadow-card transition-shadow duration-300 hover:shadow-raised"
                onClick={() => onOpenOrder(order.id)}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="tabular text-[15px] font-semibold tracking-[-0.015em] text-zinc-950">{order.number}</p>
                    <p className="mt-0.5 truncate text-[13px] text-zinc-500">
                      {customer?.name} · {vehicle?.model} {formatPlate(vehicle?.plate ?? "")}
                    </p>
                    <p className="tabular mt-0.5 truncate text-[12px] text-zinc-400">
                      {formatDate(order.createdAt)} · {formatCpf(customer?.cpf ?? "")}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Badge variant={badgeForOrder(order.status)}>{ORDER_STATUS_LABEL[order.status]}</Badge>
                    <Badge variant={badgeForPayment(order.paymentStatus)}>{PAYMENT_STATUS_LABEL[order.paymentStatus]}</Badge>
                  </div>
                </div>
                <div className="mt-3.5 grid grid-cols-3 gap-2">
                  <MiniStat label="Total" value={formatCurrency(totals.total)} />
                  <MiniStat label="Pago" value={formatCurrency(totals.paid)} />
                  <MiniStat label="Saldo" value={formatCurrency(totals.balance)} />
                </div>
              </Pressable>
            </motion.div>
          );
        })}
      </motion.div>

      {!filtered.length ? (
        <EmptyState icon={Clock} title="Nenhum registro" text="Altere os filtros para ver o histórico de atendimentos." />
      ) : null}
    </div>
  );
}

function SettingsView() {
  const { state, currentUser, syncStatus, forceSync } = useWorkshop();
  const [notifPermission, setNotifPermission] = useState<PermissionState>("unsupported");
  const [dbStatus, setDbStatus] = useState<{ configured: boolean; tableExists: boolean; serverReady: boolean } | null>(null);

  useEffect(() => {
    const id = window.setTimeout(() => setNotifPermission(getNotificationPermission()), 0);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        const [health, setup] = await Promise.all([
          fetch("/api/health", { cache: "no-store" }).then((r) => r.json()),
          fetch("/api/workshop/setup", { cache: "no-store" }).then((r) => r.json()),
        ]);
        setDbStatus({
          configured: Boolean(setup.configured),
          tableExists: Boolean(setup.tableExists),
          serverReady: Boolean(health.supabaseConfigured),
        });
      } catch {
        setDbStatus({ configured: false, tableExists: false, serverReady: false });
      }
    })();
  }, [syncStatus]);

  async function handleToggleNotifications() {
    const result = await requestNotificationPermission();
    setNotifPermission(result);
    if (result === "granted") {
      toast.success("Notificações ativadas!");
    } else if (result === "denied") {
      toast.error("Permissão negada. Ative manualmente nas configurações do navegador.");
    }
  }

  if (!state || !currentUser) return null;
  const supabaseConfigured = dbStatus?.serverReady ?? false;
  const tableReady = dbStatus?.tableExists ?? false;
  const openReminders = state.reminders.filter((r) => r.status === "open" && r.dueDate);

  const syncLabel = {
    idle: "Aguardando",
    syncing: "Sincronizando...",
    synced: "Sincronizado",
    error: "Erro ao sincronizar",
    table_missing: "Tabela não existe",
  }[syncStatus];
  const syncVariant = {
    idle: "muted" as const,
    syncing: "info" as const,
    synced: "success" as const,
    error: "danger" as const,
    table_missing: "danger" as const,
  }[syncStatus];

  return (
    <div className="space-y-4">
      <section className="rounded-xl bg-white p-4 shadow-card">
        <h2 className="text-lg font-semibold">Conta e ambiente</h2>
        <div className="mt-3 grid gap-2">
          <InfoRow label="Usuário" value={currentUser.username} />
          <InfoRow label="Perfil" value={ROLE_LABEL[currentUser.role]} />
          <InfoRow
            label="Supabase"
            value={
              !dbStatus
                ? "Verificando..."
                : supabaseConfigured && tableReady
                  ? "Conectado"
                  : supabaseConfigured
                    ? "Conectado — tabela ausente"
                    : "SUPABASE_SERVICE_ROLE_KEY ausente"
            }
          />
          <InfoRow label="Clientes no banco" value={String(state.customers.length)} />
          <InfoRow label="Veículos no banco" value={String(state.vehicles.length)} />
          <InfoRow label="OS no banco" value={String(state.orders.length)} />
          <InfoRow label="Fotos no banco" value={String(state.photos.length)} />
          <InfoRow label="Fiscal" value={state.fiscalIntegration.status === "ready" ? "Pronto" : "Não configurado"} />
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Sincronização</h2>
          <Badge variant={syncVariant}>{syncLabel}</Badge>
        </div>
        <p className="mt-2 text-sm text-zinc-500">
          Dados são salvos automaticamente no Supabase — tabelas SQL (customers, vehicles, service_orders, photos, payments, documents…) e snapshot JSON completo com fotos em base64.
        </p>
        {supabaseConfigured && tableReady && syncStatus === "synced" && (
          <div className="mt-3 rounded-xl bg-emerald-50 p-3">
            <p className="text-sm font-semibold text-emerald-700">
              Todos os dados estao sincronizados com o banco de dados.
            </p>
          </div>
        )}
        {supabaseConfigured && !tableReady && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-700">
                Tabela workshop_app_snapshots não existe no Supabase.
              </p>
              <p className="mt-1 text-xs text-amber-600">
                Abra o SQL Editor no Supabase e execute o SQLFINAL.sql do repositorio.
              </p>
            </div>
            <Button type="button" className="w-full" onClick={forceSync}>
              Tentar sincronizar novamente
            </Button>
          </div>
        )}
        {tableReady && syncStatus === "table_missing" && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl bg-amber-50 p-3">
              <p className="text-sm font-semibold text-amber-700">
                Tabela workshop_app_snapshots não existe no Supabase.
              </p>
              <p className="mt-1 text-xs text-amber-600">
                Abra o SQL Editor no Supabase e execute o SQLFINAL.sql do repositório.
              </p>
            </div>
            <Button type="button" className="w-full" onClick={forceSync}>
              Tentar sincronizar novamente
            </Button>
          </div>
        )}
        {syncStatus === "error" && (
          <div className="mt-3 space-y-3">
            <div className="rounded-xl bg-rose-50 p-3">
              <p className="text-sm font-semibold text-rose-700">
                Erro ao sincronizar. Verifique SUPABASE_SERVICE_ROLE_KEY no Vercel.
              </p>
            </div>
            <Button type="button" variant="outline" className="w-full" onClick={forceSync}>
              Tentar novamente
            </Button>
          </div>
        )}
        {supabaseConfigured && syncStatus !== "table_missing" && syncStatus !== "error" && (
          <Button type="button" variant="outline" className="mt-3 w-full" onClick={forceSync}>
            Sincronizar agora
          </Button>
        )}
        {!supabaseConfigured && (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3">
            <p className="text-sm text-zinc-500">
              Configure NEXT_PUBLIC_SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY no arquivo .env (local) ou no Vercel (producao).
              A chave anon sozinha não salva dados — é necessária a service role key no servidor.
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">Notificações</h2>
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
            {notifPermission === "granted" ? "Notificações já ativas" : "Ativar notificações"}
          </Button>
        )}
        {openReminders.length > 0 && notifPermission === "granted" && (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3">
            <p className="text-xs font-semibold text-zinc-500">
              {openReminders.length} lembretes ativos - notificações disparam quando faltam {"<= "}3 dias
            </p>
          </div>
        )}
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card">
        <h2 className="text-lg font-semibold">Funcionários</h2>
        <div className="mt-3 space-y-2">
          {state.employees.map((employee) => (
            <div key={employee.id} className="flex items-center justify-between rounded-xl bg-zinc-50 p-3">
              <div>
                <p className="text-sm font-bold">{employee.name}</p>
                <p className="text-xs text-zinc-500">{ROLE_LABEL[employee.role]}</p>
              </div>
              <Badge variant={employee.active ? "success" : "muted"}>{employee.active ? "Ativo" : "Inativo"}</Badge>
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl bg-white p-4 shadow-card">
        <h2 className="text-lg font-semibold">Auditoria</h2>
        <div className="mt-3 space-y-2">
          {state.auditEvents.slice(0, 12).map((event) => (
            <div key={event.id} className="rounded-xl bg-zinc-50 p-3">
              <p className="text-sm font-bold">{event.summary}</p>
              <p className="text-xs text-zinc-500">{formatDateTime(event.occurredAt)}</p>
            </div>
          ))}
        </div>
      </section>

    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between rounded-xl bg-zinc-50 px-3 py-2">
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
        className="h-32 w-full touch-none rounded-xl border border-dashed border-zinc-300 bg-white"
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
