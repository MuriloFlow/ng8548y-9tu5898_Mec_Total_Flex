import * as React from "react";
import { cn } from "@/lib/utils";

export type InputProps = React.InputHTMLAttributes<HTMLInputElement>;

export const Input = React.forwardRef<HTMLInputElement, InputProps>(({ className, type, ...props }, ref) => (
  <input
    type={type}
    className={cn(
      "flex h-12 w-full rounded-xl bg-white px-3.5 text-zinc-950",
      // 16px evita o zoom automático do Safari no iOS ao focar o campo.
      "text-base",
      "outline-none transition-[box-shadow,background-color] duration-200 ease-[cubic-bezier(0.16,1,0.3,1)]",
      // Borda desenhada como sombra interna: assim o anel de foco cresce por
      // fora sem alterar a altura do campo e empurrar o layout.
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
Input.displayName = "Input";
