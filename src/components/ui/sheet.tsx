"use client";

import * as React from "react";
import * as DialogPrimitive from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";

export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetPortal = DialogPrimitive.Portal;

function useVisualViewportInset() {
  React.useEffect(() => {
    if (typeof window === "undefined" || !window.visualViewport) return;

    const viewport = window.visualViewport;
    const updateInset = () => {
      const inset = Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop);
      document.documentElement.style.setProperty("--keyboard-inset", `${Math.round(inset)}px`);
      document.documentElement.style.setProperty("--sheet-viewport-height", `${Math.round(viewport.height)}px`);
    };

    updateInset();
    viewport.addEventListener("resize", updateInset);
    viewport.addEventListener("scroll", updateInset);
    return () => {
      viewport.removeEventListener("resize", updateInset);
      viewport.removeEventListener("scroll", updateInset);
      document.documentElement.style.removeProperty("--keyboard-inset");
      document.documentElement.style.removeProperty("--sheet-viewport-height");
    };
  }, []);
}

/** Distância em px a partir da qual soltar o painel o fecha. */
const DISMISS_DISTANCE = 120;
/** Velocidade em px/ms que fecha o painel mesmo sem atingir a distância. */
const DISMISS_VELOCITY = 0.55;

/**
 * Arrastar-para-fechar a partir da alça superior, como nos painéis do iOS.
 *
 * Só a alça inicia o gesto — se o painel inteiro fosse arrastável, rolar um
 * formulário longo fecharia o painel sem querer.
 */
function useDragToDismiss(onDismiss: () => void) {
  const panelRef = React.useRef<HTMLDivElement | null>(null);
  const gesture = React.useRef<{ startY: number; lastY: number; lastTime: number; offset: number } | null>(null);

  const setTranslate = (offset: number) => {
    const panel = panelRef.current;
    if (panel) panel.style.transform = `translate3d(0, ${offset}px, 0)`;
  };

  const finish = React.useCallback(() => {
    const panel = panelRef.current;
    const current = gesture.current;
    gesture.current = null;
    if (!panel || !current) return;

    panel.removeAttribute("data-dragging");

    const elapsed = Math.max(1, performance.now() - current.lastTime);
    const velocity = (current.lastY - current.startY) / elapsed;
    const shouldDismiss = current.offset > DISMISS_DISTANCE || velocity > DISMISS_VELOCITY;

    if (shouldDismiss) {
      haptic("tap");
      onDismiss();
      return;
    }

    // Volta ao lugar com a mesma curva da abertura, então solta o controle do
    // transform para as animações de estado do Radix voltarem a valer.
    panel.setAttribute("data-settling", "true");
    setTranslate(0);
    window.setTimeout(() => {
      panel.removeAttribute("data-settling");
      panel.style.transform = "";
    }, 420);
  }, [onDismiss]);

  const onPointerDown = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.pointerType === "mouse" && event.button !== 0) return;
    const panel = panelRef.current;
    if (!panel) return;

    gesture.current = { startY: event.clientY, lastY: event.clientY, lastTime: performance.now(), offset: 0 };
    panel.setAttribute("data-dragging", "true");
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const current = gesture.current;
    if (!current) return;

    const delta = event.clientY - current.startY;
    // Arrastar para cima resiste progressivamente em vez de travar: o painel
    // acompanha o dedo só um pouco, sinalizando que já está no topo.
    current.offset = delta > 0 ? delta : delta / 4;
    current.lastY = event.clientY;
    current.lastTime = performance.now();
    setTranslate(current.offset);
  };

  return {
    panelRef,
    handleProps: {
      onPointerDown,
      onPointerMove,
      onPointerUp: finish,
      onPointerCancel: finish,
    },
  };
}

export const SheetOverlay = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Overlay>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Overlay>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Overlay
    className={cn("sheet-overlay fixed inset-0 z-50 bg-zinc-950/40 backdrop-blur-[3px]", className)}
    {...props}
    ref={ref}
  />
));
SheetOverlay.displayName = DialogPrimitive.Overlay.displayName;

export const SheetContent = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Content>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, style, ...props }, ref) => {
  useVisualViewportInset();

  const closeRef = React.useRef<HTMLButtonElement | null>(null);
  const { panelRef, handleProps } = useDragToDismiss(() => closeRef.current?.click());

  return (
    <SheetPortal>
      <SheetOverlay />
      <DialogPrimitive.Content
        ref={(node) => {
          panelRef.current = node;
          if (typeof ref === "function") ref(node);
          else if (ref) ref.current = node;
        }}
        className={cn(
          "sheet-panel fixed inset-x-0 z-50 flex flex-col rounded-t-[26px] bg-white p-0 shadow-modal outline-none",
          "sm:left-1/2 sm:max-w-xl sm:-translate-x-1/2",
          className,
        )}
        style={{
          bottom: 0,
          maxHeight: "min(92dvh, calc(var(--sheet-viewport-height, 100dvh) - 12px))",
          ...style,
        }}
        {...props}
      >
        {/* Área de toque generosa em volta da alça: o traço visual tem 5px de
            altura, mas o alvo do gesto precisa ser confortável para o dedo. */}
        <div
          {...handleProps}
          className="absolute inset-x-0 top-0 z-10 flex h-11 cursor-grab touch-none items-center justify-center active:cursor-grabbing"
          aria-hidden
        >
          <div className="h-[5px] w-10 rounded-full bg-zinc-300" />
        </div>

        <div className="min-h-0 flex-1 pt-11">{children}</div>

        <DialogPrimitive.Close
          ref={closeRef}
          className="absolute right-4 top-4 z-10 inline-flex size-8 items-center justify-center rounded-full bg-zinc-100/90 text-zinc-500 backdrop-blur transition duration-200 hover:bg-zinc-200 hover:text-zinc-900 active:scale-95"
        >
          <X className="size-4" />
          <span className="sr-only">Fechar</span>
        </DialogPrimitive.Close>
      </DialogPrimitive.Content>
    </SheetPortal>
  );
});
SheetContent.displayName = DialogPrimitive.Content.displayName;

export function SheetHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("space-y-1 px-5 pb-4", className)} {...props} />;
}

export const SheetTitle = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Title>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Title>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Title
    ref={ref}
    className={cn("text-[19px] font-semibold tracking-[-0.02em] text-zinc-950", className)}
    {...props}
  />
));
SheetTitle.displayName = DialogPrimitive.Title.displayName;

export const SheetDescription = React.forwardRef<
  React.ElementRef<typeof DialogPrimitive.Description>,
  React.ComponentPropsWithoutRef<typeof DialogPrimitive.Description>
>(({ className, ...props }, ref) => (
  <DialogPrimitive.Description ref={ref} className={cn("text-[13px] leading-5 text-zinc-500", className)} {...props} />
));
SheetDescription.displayName = DialogPrimitive.Description.displayName;
