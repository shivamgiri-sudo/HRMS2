import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

const companyLogo = "/mcn-logo.png?v=999";

export function HrmsLogoPlate({
  label = "MAS Callnet",
  className,
}: {
  label?: string;
  className?: string;
}) {
  return (
    <div className={cn("flex items-center gap-3 rounded-xl border border-slate-200 bg-white p-2 shadow-sm", className)}>
      <div className="flex h-11 w-11 items-center justify-center overflow-hidden rounded-lg bg-white ring-1 ring-slate-200">
        <img
          src={companyLogo}
          alt="Mas Callnet"
          className="h-9 w-9 object-contain"
          onError={(event) => {
            (event.currentTarget as HTMLImageElement).style.display = "none";
          }}
        />
      </div>
      <div className="min-w-0">
        <p className="truncate text-sm font-extrabold text-slate-950">{label}</p>
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">PeopleOS</p>
      </div>
    </div>
  );
}

export function HrmsModernShell({
  eyebrow,
  title,
  description,
  icon,
  actions,
  children,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("min-h-screen space-y-6 bg-slate-50 p-4 md:p-6", className)}>
      <section className="relative overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
        <div className="absolute inset-x-0 top-0 h-1 bg-gradient-to-r from-blue-600 via-cyan-500 to-emerald-500" />
        <div className="grid gap-5 p-5 lg:grid-cols-[1fr_auto] lg:items-center">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-slate-950 text-white shadow-sm">
              {icon}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {eyebrow && (
                  <p className="text-[11px] font-bold uppercase tracking-[0.2em] text-blue-700">
                    {eyebrow}
                  </p>
                )}
              </div>
              <h1 className="mt-1 text-2xl font-bold tracking-normal text-slate-950">{title}</h1>
              {description && <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">{description}</p>}
            </div>
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center lg:justify-end">
            <HrmsLogoPlate className="sm:min-w-[190px]" />
            {actions}
          </div>
        </div>
      </section>
      {children}
    </div>
  );
}

export function HrmsBentoTile({
  title,
  value,
  detail,
  icon,
  accentClassName = "from-blue-500 to-cyan-500",
  className,
}: {
  title: ReactNode;
  value: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  accentClassName?: string;
  className?: string;
}) {
  return (
    <div className={cn("group relative overflow-hidden rounded-xl border border-slate-200 bg-white p-4 shadow-sm transition hover:-translate-y-0.5 hover:shadow-md", className)}>
      <div className={cn("absolute inset-x-0 top-0 h-1 bg-gradient-to-r", accentClassName)} />
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-bold uppercase tracking-wide text-slate-500">{title}</p>
          <p className="mt-1 text-2xl font-black text-slate-950">{value}</p>
          {detail && <p className="mt-1 text-xs text-slate-500">{detail}</p>}
        </div>
        {icon && (
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-slate-50 text-slate-700 ring-1 ring-slate-200">
            {icon}
          </div>
        )}
      </div>
    </div>
  );
}

export function HrmsFlowTile({
  label,
  title,
  description,
  icon,
  active,
  className,
}: {
  label: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  active?: boolean;
  className?: string;
}) {
  return (
    <div className={cn(
      "relative rounded-xl border bg-white p-4 shadow-sm transition",
      active ? "border-blue-300 ring-2 ring-blue-100" : "border-slate-200 hover:border-blue-200",
      className,
    )}>
      <div className="flex items-start gap-3">
        <div className={cn(
          "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
          active ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-700",
        )}>
          {icon}
        </div>
        <div className="min-w-0">
          <p className="text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">{label}</p>
          <p className="mt-1 text-sm font-bold text-slate-950">{title}</p>
          {description && <p className="mt-1 text-xs leading-5 text-slate-500">{description}</p>}
        </div>
      </div>
    </div>
  );
}
