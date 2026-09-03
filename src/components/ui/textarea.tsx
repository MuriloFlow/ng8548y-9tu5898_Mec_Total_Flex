import * as React from "react";
import { cn } from "@/lib/utils";

export type TextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export const Textarea = React.forwardRef<HTMLTextAreaElement, TextareaProps>(({ className, ...props }, ref) => (
  <textarea
    className={cn(
      "min-h-24 w-full resize-y rounded-xl bg-white px-3.5 py-3 text-base text-zinc-950",
      "outline-none transition-[box-shadow] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
      // Mesmo contorno-por-sombra do Input, para os campos parecerem irmãos.
      "shadow-[0_1px_2px_rgba(24,24,27,0.04),inset_0_0_0_1px_rgba(24,24,27,0.11)]",
      "placeholder:text-zinc-400",
      "hover:shadow-[0_1px_2px_rgba(24,24,27,0.05),inset_0_0_0_1px_rgba(24,24,27,0.18)]",
      "focus:shadow-[0_0_0_3.5px_rgba(24,24,27,0.09),inset_0_0_0_1.5px_rgb(24,24,27)]",
      "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:text-zinc-400",
      className,
    )}
    ref={ref}
    {...props}
  />
));
Textarea.displayName = "Textarea";
