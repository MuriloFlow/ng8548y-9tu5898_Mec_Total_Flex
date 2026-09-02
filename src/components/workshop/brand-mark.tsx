import NextImage from "next/image";

type BrandMarkProps = {
  size?: "sm" | "md" | "lg";
  subtitle?: boolean;
  align?: "center" | "left";
  className?: string;
};

const sizes = {
  sm: { box: "size-12", logo: "h-7", title: "text-lg", sub: "text-[10px]" },
  md: { box: "size-16", logo: "h-9", title: "text-2xl", sub: "text-[11px]" },
  lg: { box: "size-20", logo: "h-11", title: "text-[1.65rem]", sub: "text-xs" },
} as const;

export function BrandMark({ size = "md", subtitle = true, align = "center", className = "" }: BrandMarkProps) {
  const s = sizes[size];
  const alignClass = align === "left" ? "items-start text-left" : "items-center text-center";

  return (
    <div className={`flex flex-col ${alignClass} ${className}`}>
      <div className={`grid ${s.box} place-items-center rounded-2xl bg-white shadow-[0_8px_30px_-12px_rgba(0,0,0,0.25)] ring-1 ring-black/[0.05]`}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/assets/logo.svg" alt="Total Flex" className={`${s.logo} w-auto object-contain`} />
      </div>
      <div className="mt-4 space-y-1">
        {subtitle ? (
          <p className={`${s.sub} font-semibold uppercase tracking-[0.28em] text-zinc-400`}>Auto Mecânica</p>
        ) : null}
        <p className={`${s.title} font-semibold tracking-[-0.03em] text-zinc-900`}>Total Flex</p>
      </div>
    </div>
  );
}

export function BrandLogoInline({ className = "" }: { className?: string }) {
  return (
    <NextImage
      src="/assets/logo.svg"
      alt="Total Flex"
      width={160}
      height={48}
      priority
      className={`h-8 w-auto object-contain ${className}`}
    />
  );
}
