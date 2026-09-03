"use client";

import * as React from "react";
import { motion, useReducedMotion, type HTMLMotionProps } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import { springSnappy } from "@/lib/ui/motion";

type PressableProps = Omit<HTMLMotionProps<"button">, "ref"> & {
  /** Cartões grandes precisam encolher menos que botões para não afundar. */
  scale?: number;
  /** Desliga o retorno tátil em ações repetitivas, como itens de lista longa. */
  withHaptic?: boolean;
};

/**
 * Superfície tocável com mola e retorno tátil.
 *
 * Existe porque `hover:` não acontece em mobile: sem uma resposta ao toque, a
 * interface parece travada no instante entre o dedo e a navegação.
 */
export const Pressable = React.forwardRef<HTMLButtonElement, PressableProps>(
  ({ className, scale = 0.98, withHaptic = true, onPointerDown, ...props }, ref) => {
    const reduceMotion = useReducedMotion();

    return (
      <motion.button
        ref={ref}
        type="button"
        whileTap={reduceMotion ? undefined : { scale }}
        transition={springSnappy}
        className={cn("text-left outline-none", className)}
        onPointerDown={(event) => {
          // No pointerdown, não no click: o retorno precisa coincidir com o
          // toque, senão parece atrasado.
          if (withHaptic) haptic("tap");
          onPointerDown?.(event);
        }}
        {...props}
      />
    );
  },
);
Pressable.displayName = "Pressable";
