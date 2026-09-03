"use client";

import * as React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/utils";
import { haptic } from "@/lib/ui/haptics";
import { springSnappy } from "@/lib/ui/motion";

export type SegmentedOption<T extends string> = {
  value: T;
  label: string;
  count?: number;
};

type SegmentedProps<T extends string> = {
  options: SegmentedOption<T>[];
  value: T;
  onChange: (value: T) => void;
  /** Diferencia a pílula animada quando há mais de um controle na mesma tela. */
  layoutId?: string;
  className?: string;
};

/**
 * Filtro em trilha horizontal com a pílula ativa deslizando entre as opções.
 *
 * O `layoutId` do Framer Motion move um único elemento entre posições, então a
 * seleção parece um objeto físico em vez de dois estados piscando.
 */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
  layoutId = "segmented-active",
  className,
}: SegmentedProps<T>) {
  const reduceMotion = useReducedMotion();
  const trackRef = React.useRef<HTMLDivElement | null>(null);
  const activeRef = React.useRef<HTMLButtonElement | null>(null);

  // Mantém a opção ativa visível: sem isso, ao voltar para a tela o filtro
  // selecionado pode estar fora da área rolável, parecendo que nada está ativo.
  React.useEffect(() => {
    const track = trackRef.current;
    const active = activeRef.current;
    if (!track || !active) return;

    const trackBox = track.getBoundingClientRect();
    const activeBox = active.getBoundingClientRect();
    const overflowsRight = activeBox.right > trackBox.right - 8;
    const overflowsLeft = activeBox.left < trackBox.left + 8;

    if (overflowsRight || overflowsLeft) {
      active.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest", inline: "center" });
    }
  }, [reduceMotion, value]);

  return (
    <div ref={trackRef} className={cn("scroll-x -mx-1 flex gap-1.5 px-1 py-1", className)} role="tablist">
      {options.map((option) => {
        const active = option.value === value;

        return (
          <button
            key={option.value}
            ref={active ? activeRef : undefined}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => {
              if (active) return;
              haptic("select");
              onChange(option.value);
            }}
            className={cn(
              "relative shrink-0 rounded-full px-3.5 py-2 text-[13px] font-semibold tracking-[-0.01em]",
              "transition-colors duration-200 active:scale-[0.97]",
              active ? "text-white" : "text-zinc-600 hover:text-zinc-900",
            )}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-0 rounded-full bg-zinc-950 shadow-[0_1px_3px_rgba(24,24,27,0.24)]"
                transition={reduceMotion ? { duration: 0 } : springSnappy}
              />
            ) : (
              <span className="absolute inset-0 rounded-full bg-white shadow-[inset_0_0_0_1px_rgba(24,24,27,0.09)]" />
            )}
            <span className="relative flex items-center gap-1.5">
              {option.label}
              {typeof option.count === "number" ? (
                <span className={cn("tabular text-[11px]", active ? "text-white/60" : "text-zinc-400")}>
                  {option.count}
                </span>
              ) : null}
            </span>
          </button>
        );
      })}
    </div>
  );
}
