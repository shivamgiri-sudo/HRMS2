import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { HealthRing } from "./charts";
import { HERO_ACCENT, HERO_GRADIENT, type Accent } from "./tone";

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
  const toneCls = { neutral: "text-slate-900", good: "text-emerald-600", bad: "text-rose-600", warn: "text-amber-600" } as const;
  const a = HERO_ACCENT[accent];
  return (
    <section className={cn("kit-rise relative overflow-hidden rounded-3xl border border-slate-200 bg-gradient-to-br p-5 text-slate-900 shadow-sm sm:p-6", HERO_GRADIENT[accent])}>
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1.5", a.bar)} />
      <div className="relative flex flex-col gap-6">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-center gap-3">
            {Icon ? <span className={cn("flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl", a.chip)}><Icon className="h-6 w-6" /></span> : null}
            <div className="min-w-0">
              {eyebrow ? <p className={cn("text-[11px] font-bold uppercase tracking-[.18em]", a.eyebrow)}>{eyebrow}</p> : null}
              <h1 className="text-[26px] font-extrabold leading-tight tracking-tight sm:text-[30px]">{title}</h1>
              {subtitle ? <p className="mt-0.5 text-[13px] text-slate-600">{subtitle}</p> : null}
            </div>
          </div>
          {right ? <div className="rounded-2xl border border-slate-200 bg-white px-3 py-2 text-slate-800 shadow-sm">{right}</div> : null}
        </div>

        <div className="flex flex-wrap items-end gap-x-10 gap-y-5">
          {headline ? (
            <div>
              <p className="text-[12px] font-semibold uppercase tracking-wider text-slate-500">{headline.label}</p>
              <p className="kit-num mt-1 text-[48px] font-black leading-none text-slate-900 sm:text-[60px]">{headline.value}</p>
              {headline.caption ? <p className="mt-2 max-w-md text-[13px] text-slate-600">{headline.caption}</p> : null}
            </div>
          ) : null}
          {health && health.value !== null ? (
            <div title={health.basis ?? undefined}>
              <HealthRing value={health.value} label={health.label} size={96} />
            </div>
          ) : null}
          {stats.length ? (
            <div className="grid min-w-0 flex-1 basis-[440px] gap-2.5 [grid-template-columns:repeat(auto-fill,minmax(132px,1fr))] [&>*]:min-h-[68px] [&>*]:min-w-0">
              {stats.map((s) => {
                const inner = (
                  <>
                    <p className="text-[11px] font-semibold uppercase leading-3 tracking-wide text-slate-500">{s.label}</p>
                    <p className={cn("kit-num mt-1 break-words text-[20px] font-extrabold leading-none", toneCls[s.tone ?? "neutral"])}>{s.value}</p>
                  </>
                );
                const cls = "rounded-2xl border border-slate-200 bg-white px-3.5 py-3 text-left shadow-sm transition hover:border-slate-300 hover:shadow";
                if (s.href) return <Link key={s.label} to={s.href} className={cls}>{inner}</Link>;
                if (s.onClick) return <button key={s.label} type="button" onClick={s.onClick} className={cls}>{inner}</button>;
                return <div key={s.label} className={cn(cls, "hover:border-slate-200 hover:shadow-sm")}>{inner}</div>;
              })}
            </div>
          ) : null}
        </div>
        {children}
      </div>
    </section>
  );
}
