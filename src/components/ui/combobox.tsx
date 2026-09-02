"use client";

import * as React from "react";
import { Check, ChevronDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export type ComboboxOption = {
  value: string;
  label: string;
  hint?: string;
};

type ComboboxProps = {
  options: ComboboxOption[];
  value: string;
  onValueChange: (value: string, option?: ComboboxOption) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  emptyMessage?: string;
  loading?: boolean;
  disabled?: boolean;
  allowCustomValue?: boolean;
  invalid?: boolean;
  className?: string;
};

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/\p{Diacritic}/gu, "")
    .toLowerCase();
}

export function Combobox({
  options,
  value,
  onValueChange,
  placeholder = "Selecione",
  searchPlaceholder = "Buscar...",
  emptyMessage = "Nenhum resultado.",
  loading = false,
  disabled = false,
  allowCustomValue = false,
  invalid = false,
  className,
}: ComboboxProps) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [activeIndex, setActiveIndex] = React.useState(0);

  const containerRef = React.useRef<HTMLDivElement>(null);
  const searchRef = React.useRef<HTMLInputElement>(null);
  const listRef = React.useRef<HTMLDivElement>(null);

  const filtered = React.useMemo(() => {
    if (!query.trim()) return options;
    const terms = normalize(query).split(/\s+/).filter(Boolean);
    return options.filter((option) => {
      const haystack = normalize(`${option.label} ${option.hint ?? ""}`);
      return terms.every((term) => haystack.includes(term));
    });
  }, [options, query]);

  const selected = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value],
  );

  const displayLabel = selected?.label ?? (value || "");

  React.useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [open]);

  React.useEffect(() => {
    if (open) {
      setQuery("");
      setActiveIndex(0);
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [open]);

  React.useEffect(() => {
    if (!open) return;
    const active = listRef.current?.children[activeIndex] as HTMLElement | undefined;
    active?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function commit(option: ComboboxOption) {
    onValueChange(option.value, option);
    setOpen(false);
  }

  function handleKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current) => Math.min(current + 1, filtered.length - 1));
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
      return;
    }
    if (event.key === "Enter") {
      event.preventDefault();
      const option = filtered[activeIndex];
      if (option) {
        commit(option);
      } else if (allowCustomValue && query.trim()) {
        onValueChange(query.trim());
        setOpen(false);
      }
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn("relative", className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        className={cn(
          "flex h-12 w-full items-center justify-between gap-2 rounded-lg border bg-white px-4 text-left text-base shadow-sm outline-none transition",
          "focus:border-zinc-900 focus:ring-4 focus:ring-zinc-100",
          "disabled:cursor-not-allowed disabled:bg-zinc-50 disabled:opacity-60",
          invalid ? "border-rose-400" : "border-zinc-200",
          open && "border-zinc-900 ring-4 ring-zinc-100",
        )}
      >
        <span className={cn("truncate", displayLabel ? "text-zinc-950" : "text-zinc-400")}>
          {displayLabel || placeholder}
        </span>
        {loading ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-zinc-400" />
        ) : (
          <ChevronDown className={cn("size-4 shrink-0 text-zinc-400 transition", open && "rotate-180")} />
        )}
      </button>

      {open ? (
        <div className="absolute z-50 mt-2 w-full overflow-hidden rounded-xl border border-zinc-200 bg-white shadow-[0_16px_48px_-12px_rgba(0,0,0,0.25)]">
          <div className="flex items-center gap-2 border-b border-zinc-100 px-3">
            <Search className="size-4 shrink-0 text-zinc-400" />
            <input
              ref={searchRef}
              value={query}
              onChange={(event) => {
                setQuery(event.target.value);
                setActiveIndex(0);
              }}
              onKeyDown={handleKeyDown}
              placeholder={searchPlaceholder}
              className="h-11 w-full bg-transparent text-base outline-none placeholder:text-zinc-400"
            />
          </div>

          <div ref={listRef} className="max-h-64 overflow-y-auto overscroll-contain py-1">
            {filtered.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-zinc-500">
                {loading ? "Carregando..." : emptyMessage}
              </p>
            ) : (
              filtered.map((option, index) => (
                <button
                  key={option.value}
                  type="button"
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => commit(option)}
                  className={cn(
                    "flex w-full items-start gap-2 px-4 py-2.5 text-left text-sm transition",
                    index === activeIndex ? "bg-zinc-100" : "bg-transparent",
                  )}
                >
                  <Check
                    className={cn(
                      "mt-0.5 size-4 shrink-0",
                      option.value === value ? "text-zinc-900" : "text-transparent",
                    )}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium text-zinc-900">{option.label}</span>
                    {option.hint ? (
                      <span className="block truncate text-xs text-zinc-500">{option.hint}</span>
                    ) : null}
                  </span>
                </button>
              ))
            )}
          </div>

          {allowCustomValue && query.trim() && !filtered.some((option) => option.label === query.trim()) ? (
            <button
              type="button"
              onClick={() => {
                onValueChange(query.trim());
                setOpen(false);
              }}
              className="w-full border-t border-zinc-100 px-4 py-2.5 text-left text-sm font-medium text-zinc-700 transition hover:bg-zinc-50"
            >
              Usar &ldquo;{query.trim()}&rdquo;
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
