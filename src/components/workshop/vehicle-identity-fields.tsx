"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Bike, Car, Truck } from "lucide-react";
import { Combobox, type ComboboxOption } from "@/components/ui/combobox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  fetchBrandOptions,
  fetchModelOptions,
  vehicleYearOptions,
  type BrandOption,
  type ModelOption,
} from "@/lib/workshop/vehicle-catalog";
import { colorSwatch, VEHICLE_COLORS } from "@/lib/workshop/vehicle-colors";
import type { Vehicle } from "@/lib/workshop/types";

export type VehicleIdentityValues = {
  category: Vehicle["category"];
  brand: string;
  model: string;
  version: string;
  year: string;
  color: string;
};

type Props = {
  values: VehicleIdentityValues;
  onChange: (patch: Partial<VehicleIdentityValues>) => void;
  errors?: Record<string, string>;
};

const CATEGORIES: Array<{ id: Vehicle["category"]; label: string; icon: typeof Car }> = [
  { id: "car", label: "Carro", icon: Car },
  { id: "motorcycle", label: "Moto", icon: Bike },
  { id: "truck", label: "Caminhão", icon: Truck },
  { id: "van", label: "Van", icon: Truck },
  { id: "other", label: "Outro", icon: Car },
];

const YEARS = vehicleYearOptions();

function FieldShell({
  label,
  error,
  hint,
  children,
}: {
  label: string;
  error?: string;
  hint?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label>{label}</Label>
      {children}
      {error ? <p className="text-xs font-bold text-rose-600">{error}</p> : null}
      {!error && hint ? <p className="text-xs text-zinc-500">{hint}</p> : null}
    </div>
  );
}

export function VehicleIdentityFields({ values, onChange, errors = {} }: Props) {
  const [brands, setBrands] = useState<BrandOption[]>([]);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [brandCode, setBrandCode] = useState("");
  const [loadingBrands, setLoadingBrands] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [catalogNotice, setCatalogNotice] = useState("");

  const catalogCategory = values.category;

  useEffect(() => {
    let active = true;
    setLoadingBrands(true);
    setCatalogNotice("");

    void fetchBrandOptions(catalogCategory).then((result) => {
      if (!active) return;
      setBrands(result.items);
      setLoadingBrands(false);
      if (!result.ok) setCatalogNotice(result.message ?? "Catálogo indisponível — digite manualmente.");
    });

    return () => {
      active = false;
    };
  }, [catalogCategory]);

  // Re-link a pre-filled brand name (edit flow) to its catalog code.
  useEffect(() => {
    if (brandCode || !values.brand || brands.length === 0) return;
    const match = brands.find(
      (item) => item.name.toLowerCase() === values.brand.toLowerCase(),
    );
    if (match) setBrandCode(match.code);
  }, [brandCode, brands, values.brand]);

  useEffect(() => {
    if (!brandCode) {
      setModels([]);
      return;
    }

    let active = true;
    setLoadingModels(true);

    void fetchModelOptions(catalogCategory, brandCode).then((result) => {
      if (!active) return;
      setModels(result.items);
      setLoadingModels(false);
    });

    return () => {
      active = false;
    };
  }, [brandCode, catalogCategory]);

  const brandOptions = useMemo<ComboboxOption[]>(
    () => brands.map((item) => ({ value: item.code, label: item.name })),
    [brands],
  );

  const modelOptions = useMemo<ComboboxOption[]>(
    () => models.map((item) => ({ value: item.code, label: item.model, hint: item.version || undefined })),
    [models],
  );

  const selectedModelCode = useMemo(() => {
    const match = models.find(
      (item) =>
        item.model.toLowerCase() === values.model.toLowerCase() &&
        (item.version || "").toLowerCase() === values.version.toLowerCase(),
    );
    return match?.code ?? "";
  }, [models, values.model, values.version]);

  const handleCategory = useCallback(
    (category: Vehicle["category"]) => {
      setBrandCode("");
      setModels([]);
      onChange({ category, brand: "", model: "", version: "" });
    },
    [onChange],
  );

  const handleBrand = useCallback(
    (code: string, option?: ComboboxOption) => {
      const name = option?.label ?? code;
      setBrandCode(option ? code : "");
      onChange({ brand: name, model: "", version: "" });
    },
    [onChange],
  );

  const handleModel = useCallback(
    (code: string, option?: ComboboxOption) => {
      const match = models.find((item) => item.code === code);
      if (match) {
        onChange({ model: match.model, version: match.version });
        return;
      }
      onChange({ model: option?.label ?? code });
    },
    [models, onChange],
  );

  const brandsUnavailable = !loadingBrands && brands.length === 0;

  return (
    <div className="space-y-4">
      <FieldShell label="Categoria" error={errors.category}>
        <div className="grid grid-cols-5 gap-1.5">
          {CATEGORIES.map((item) => {
            const Icon = item.icon;
            const active = values.category === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleCategory(item.id)}
                className={cn(
                  "flex flex-col items-center gap-1 rounded-lg border px-1 py-2.5 text-[11px] font-medium transition",
                  active
                    ? "border-zinc-900 bg-zinc-900 text-white"
                    : "border-zinc-200 bg-white text-zinc-600 hover:border-zinc-300",
                )}
              >
                <Icon className="size-4" />
                {item.label}
              </button>
            );
          })}
        </div>
      </FieldShell>

      <FieldShell
        label="Marca"
        error={errors.brand}
        hint={catalogNotice || (brandsUnavailable ? undefined : "Base oficial da Tabela FIPE")}
      >
        {brandsUnavailable ? (
          <Input
            value={values.brand}
            onChange={(event) => onChange({ brand: event.target.value })}
            placeholder="Ex.: Volkswagen"
          />
        ) : (
          <Combobox
            options={brandOptions}
            value={brandCode || values.brand}
            onValueChange={handleBrand}
            loading={loadingBrands}
            placeholder="Selecione a marca"
            searchPlaceholder="Digite a marca..."
            emptyMessage="Marca não encontrada."
            allowCustomValue
            invalid={Boolean(errors.brand)}
          />
        )}
      </FieldShell>

      <FieldShell
        label="Modelo"
        error={errors.model}
        hint={brandCode && !loadingModels && models.length === 0 ? "Catálogo sem modelos — digite manualmente." : undefined}
      >
        {brandCode && (loadingModels || models.length > 0) ? (
          <Combobox
            options={modelOptions}
            value={selectedModelCode || values.model}
            onValueChange={handleModel}
            loading={loadingModels}
            placeholder="Selecione o modelo"
            searchPlaceholder="Digite o modelo..."
            emptyMessage="Modelo não encontrado."
            allowCustomValue
            invalid={Boolean(errors.model)}
          />
        ) : (
          <Input
            value={values.model}
            onChange={(event) => onChange({ model: event.target.value })}
            placeholder={values.brand ? "Ex.: Gol" : "Selecione a marca primeiro"}
          />
        )}
      </FieldShell>

      <FieldShell label="Versão">
        <Input
          value={values.version}
          onChange={(event) => onChange({ version: event.target.value })}
          placeholder="Ex.: 1.0 MPI Total Flex 8V"
        />
      </FieldShell>

      <div className="grid gap-4 sm:grid-cols-2">
        <FieldShell label="Ano" error={errors.year}>
          <Combobox
            options={YEARS.map((year) => ({ value: year, label: year }))}
            value={values.year}
            onValueChange={(year) => onChange({ year })}
            placeholder="Ano"
            searchPlaceholder="Digite o ano..."
            emptyMessage="Ano inválido."
            allowCustomValue
            invalid={Boolean(errors.year)}
          />
        </FieldShell>

        <FieldShell label="Cor">
          <Combobox
            options={VEHICLE_COLORS.map((color) => ({ value: color, label: color }))}
            value={values.color}
            onValueChange={(color) => onChange({ color })}
            placeholder="Cor"
            searchPlaceholder="Digite a cor..."
            emptyMessage="Cor não encontrada."
            allowCustomValue
          />
        </FieldShell>
      </div>

      {values.color ? (
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          <span
            className="size-4 rounded-full ring-1 ring-inset ring-black/10"
            style={{ background: colorSwatch(values.color) }}
          />
          Cor selecionada: {values.color}
        </div>
      ) : null}
    </div>
  );
}
