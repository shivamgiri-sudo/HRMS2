import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { HealthRing } from "./charts";
import { HERO_GRADIENT, type Accent } from "./tone";

export interface HeroStat {
  label: string;
  value: ReactNode;
  tone?: "neutral" | "good" | "bad" | "warn";
  href?: string;
  onClick?: () => void;
}

/**
 * Role dashboard hero: gradient band with identity, one headline number, live stat chips and an
 * optional health ring. `right` hosts the filter bar / refresh control the page already provides.
 */
export function DashHero({
  eyebrow, title, subtitle, accent = "indigo", icon: Icon, headline, stats = [], health, right, children,
}: {
  eyebrow?: string;
  title: string;
  subtitle?: ReactNode;
  accent?: Accent;
  icon?: ElementType;
  headline?: { label: string; value: ReactNode; caption?: ReactNode };
  stats?: HeroStat[];
  health?: { value: number | null; label: string; basis?: string | null } | null;
  right?: ReactNode;
  children?: ReactNode;
}) {
  const toneCls = { neutral: "text-white", good: "text-emerald-300", bad: "text-rose-300", warn: "text-amber-300" } as const;
  return (
    <section className={cn("kit-on-dark kit-rise relative overflow-hidden rounded-3xl bg-gradient-to-br p-5 text-white shadow-[0_24px_60px_-28px_rgba(15,23,42,.65)] sm:p-7", HERO_GRADIENT[accent])}>
      <div aria-hidden className="kit-hero-grid pointer-events-none absolute inset-0 opacity-60 [mask-image:linear-gradient(120deg,transparent,black_40%,transparent)]" />
      <div aria-hidden className="pointer-events-none absolute -right-24 -top-24 h-72 w-72 rounded-full bg-white/10 blur-3xl" />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon ? <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-white/15 ring-1 ring-white/25 backdrop-blur"><Icon className="h-6 w-6" /></span> : null}
            <div className="min-w-0">
              {eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[.18em] text-white/70">{eyebrow}</p> : null}
              <h1 className="truncate text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
              {subtitle ? <p className="mt-0.5 text-[13px] text-white/75">{subtitle}</p> : null}
            </div>
          </div>
          {right ? <div className="rounded-2xl bg-white/95 px-3 py-2 text-slate-800 shadow-lg">{right}</div> : null}
        </div>

        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          {headline ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-white/70">{headline.label}</p>
              <p className="kit-num mt-1 text-[56px] font-black leading-none sm:text-[68px]">{headline.value}</p>
              {headline.caption ? <p className="mt-2 max-w-md text-[13px] text-white/80">{headline.caption}</p> : null}
            </div>
          ) : null}
          {health && health.value !== null ? (
            <div title={health.basis ?? undefined}>
              <HealthRing value={health.value} label={health.label} size={96} onDark />
            </div>
          ) : null}
          {stats.length ? (
            <div className="grid min-w-0 flex-1 grid-cols-2 gap-2.5 sm:grid-cols-3 xl:grid-cols-4">
              {stats.map((s) => {
                const inner = (
                  <>
                    <p className="text-[11px] font-semibold uppercase leading-3 tracking-wide text-white/65">{s.label}</p>
                    <p className={cn("kit-num mt-1 text-[22px] font-extrabold leading-none", toneCls[s.tone ?? "neutral"])}>{s.value}</p>
                  </>
                );
                const cls = "rounded-2xl bg-white/10 px-3.5 py-3 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/20 text-left";
                if (s.href) return <Link key={s.label} to={s.href} className={cls}>{inner}</Link>;
                if (s.onClick) return <button key={s.label} type="button" onClick={s.onClick} className={cls}>{inner}</button>;
                return <div key={s.label} className={cn(cls, "hover:bg-white/10")}>{inner}</div>;
              })}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}
