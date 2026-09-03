import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  [
    "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full",
    "text-sm font-semibold tracking-[-0.01em]",
    // A escala no toque é o retorno principal em mobile, onde não existe hover.
    "transition-[transform,box-shadow,background-color,color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
    "active:scale-[0.97]",
    "disabled:pointer-events-none disabled:opacity-40",
    "[&_svg]:size-4 [&_svg]:shrink-0",
  ],
  {
    variants: {
      variant: {
        // O gradiente quase imperceptível e o brilho interno superior evitam o
        // aspecto de retângulo chapado sem parecer um botão "skeuomórfico".
        default: [
          "bg-gradient-to-b from-zinc-800 to-zinc-950 text-white",
          "shadow-[0_1px_2px_rgba(24,24,27,0.24),inset_0_1px_0_rgba(255,255,255,0.11)]",
          "hover:from-zinc-700 hover:to-zinc-900",
          "active:shadow-[0_1px_1px_rgba(24,24,27,0.2)]",
        ],
        secondary: [
          "bg-zinc-100 text-zinc-950",
          "shadow-[inset_0_0_0_1px_rgba(24,24,27,0.04)]",
          "hover:bg-zinc-200/80",
        ],
        outline: [
          "bg-white text-zinc-950",
          "shadow-[0_1px_2px_rgba(24,24,27,0.05),inset_0_0_0_1px_rgba(24,24,27,0.1)]",
          "hover:bg-zinc-50",
        ],
        ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-950",
        danger: [
          "bg-gradient-to-b from-rose-500 to-rose-600 text-white",
          "shadow-[0_1px_2px_rgba(190,18,60,0.28),inset_0_1px_0_rgba(255,255,255,0.16)]",
          "hover:from-rose-500 hover:to-rose-700",
        ],
        success: [
          "bg-gradient-to-b from-emerald-500 to-emerald-600 text-white",
          "shadow-[0_1px_2px_rgba(5,150,105,0.28),inset_0_1px_0_rgba(255,255,255,0.18)]",
          "hover:from-emerald-500 hover:to-emerald-700",
        ],
      },
      size: {
        // 44px é o alvo mínimo de toque recomendado pela Apple; os tamanhos
        // menores existem só para ações secundárias em barras densas.
        default: "h-11 px-5",
        sm: "h-9 px-3.5 text-[13px]",
        lg: "h-13 px-6 text-base",
        icon: "size-10",
        iconSm: "size-8",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

export const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { buttonVariants };
