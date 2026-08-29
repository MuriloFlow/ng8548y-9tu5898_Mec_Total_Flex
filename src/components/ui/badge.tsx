import type * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold", {
  variants: {
    variant: {
      default: "bg-zinc-950 text-white",
      muted: "bg-zinc-100 text-zinc-700",
      success: "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100",
      warning: "bg-amber-50 text-amber-700 ring-1 ring-amber-100",
      danger: "bg-rose-50 text-rose-700 ring-1 ring-rose-100",
      info: "bg-sky-50 text-sky-700 ring-1 ring-sky-100",
    },
  },
  defaultVariants: {
    variant: "default",
  },
});

export function Badge({ className, variant, ...props }: React.HTMLAttributes<HTMLDivElement> & VariantProps<typeof badgeVariants>) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}
