import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva(
  [
    "inline-flex items-center gap-1 rounded-full px-2 py-0.5",
    // 11px com tracking positivo: em tamanhos pequenos o espaçamento extra é o
    // que mantém a legibilidade, não o peso da fonte.
    "text-[11px] font-semibold leading-5 tracking-[0.01em]",
    "whitespace-nowrap",
  ],
  {
    variants: {
      variant: {
        default: "bg-zinc-950 text-white",
        muted: "bg-zinc-100 text-zinc-600",
        success: "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/15",
        warning: "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/15",
        danger: "bg-rose-50 text-rose-700 ring-1 ring-inset ring-rose-600/15",
        info: "bg-sky-50 text-sky-700 ring-1 ring-inset ring-sky-600/15",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
