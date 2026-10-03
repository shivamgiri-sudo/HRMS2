import type { ElementType, ReactNode } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, Minus, TrendingDown, TrendingUp } from "lucide-react";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import type { InsightKpi } from "../../../../backend/src/modules/dashboards/role-insights/types";
import { formatDelta, formatUnit } from "./format";
import { Sparkline } from "./Sparkline";
import { TONE, type Tone } from "./tone";

export interface PulseTileProps {
  label: string;
  value: number | string | null | undefined;
  unit?: InsightKpi["unit"];
  /** Pre-formatted suffix for string values e.g. "/100". */
  suffix?: string;
  icon?: ElementType;
  tone?: Tone;
  delta?: number | null;
  deltaLabel?: string;
  higherIsBetter?: boolean;
  spark?: number[];
  helper?: ReactNode;
  /** Auditable calculation, shown on hover + to screen readers. */
  formula?: string;
  /** Page route to drill into (preferred: real page navigation). */
  href?: string;
  /** Opens the shared drilldown drawer when no page route exists. */
  onDrill?: () => void;
  unavailable?: string | null;
  loading?: boolean;
  /** Visual size: "hero" tiles are larger (use for the 1-2 numbers that matter most). */
  size?: "md" | "hero";
}

/**
 * KPI tile: value + trend + sparkline + status edge, whole card is the drill target.
 * A null value renders "—" with the reason, never a confident 0.
 */
export function PulseTile({
  label, value, unit = "count", suffix, icon: Icon, tone = "blue", delta, deltaLabel, higherIsBetter = true,
  spark, helper, formula, href, onDrill, unavailable, loading, size = "md",
}: PulseTileProps) {
  const t = TONE[tone];
  const numeric = typeof value === "number" ? value : value === null || value === undefined ? null : Number.isFinite(Number(value)) && String(value).trim() !== "" ? Number(value) : null;
  const shown = typeof value === "string" && numeric === null ? { text: value, suffix: suffix ?? "" } : (() => { const f = formatUnit(numeric, unit); return { text: f.text, suffix: suffix ?? f.suffix }; })();
  const deltaText = formatDelta(delta, unit);
  const good = delta === null || delta === undefined || delta === 0 ? null : (delta > 0) === higherIsBetter;
  const DeltaIcon = delta === null || delta === undefined || delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown;
  const interactive = Boolean(href || onDrill);

  const body = (
    <>
      <span aria-hidden className={cn("absolute inset-y-3 left-0 w-1 rounded-r-full", t.solid)} />
      <div className="flex items-start justify-between gap-3">
        {Icon ? <span className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-xl", t.soft, t.text)}><Icon className="h-[18px] w-[18px]" /></span> : <span />}
        {interactive ? <ArrowUpRight className="h-4 w-4 shrink-0 text-slate-300 transition-colors group-hover:text-slate-600" aria-hidden /> : null}
      </div>
      <p className="mt-2 line-clamp-2 break-words text-[12px] font-semibold uppercase leading-4 tracking-wide text-slate-500" title={label}>{label}</p>
      {loading ? (
        <Skeleton className={cn("mt-4 h-9 w-24", size === "hero" && "h-12 w-32")} />
      ) : (
        <>
        <div className="mt-2 flex items-end justify-between gap-2">
          <div className="min-w-0">
            <p className={cn("kit-num font-extrabold leading-none text-slate-900", size === "hero" ? "text-[40px]" : "text-[28px]")}>
              {shown.text}<span className="ml-0.5 text-[0.5em] font-bold text-slate-400">{shown.suffix}</span>
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
              {deltaText ? (
                <span className={cn("inline-flex items-center gap-0.5 rounded-md px-1.5 py-0.5 font-semibold", good === null ? "bg-slate-100 text-slate-600" : good ? "bg-emerald-50 text-emerald-700" : "bg-rose-50 text-rose-700")}>
                  <DeltaIcon className="h-3 w-3" />{deltaText}
                </span>
              ) : null}
              <span className="line-clamp-2 min-w-0 break-words text-slate-500">{unavailable ?? deltaLabel ?? helper}</span>
            </div>
          </div>
        </div>
        {spark && spark.length > 1 ? <div className="mt-2.5"><Sparkline values={spark} color={t.hex} width={240} height={size === "hero" ? 40 : 28} fluid /></div> : null}
        </>
      )}
      {!loading && deltaLabel && helper ? <p className="mt-1.5 line-clamp-2 text-[11px] text-slate-400">{helper}</p> : null}
      {formula ? <span className="sr-only">Calculation: {formula}</span> : null}
    </>
  );

  const cls = cn("kit-card kit-rise group relative block overflow-hidden p-4 text-left", interactive && "kit-lift cursor-pointer focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500");
  if (href) return <Link to={href} className={cls} title={formula}>{body}</Link>;
  if (onDrill) return <button type="button" onClick={onDrill} className={cn(cls, "w-full")} title={formula}>{body}</button>;
  return <div className={cls} title={formula}>{body}</div>;
}

/** Responsive grid: 2 cols on phone → 4/5/6 on wide screens. */
export function PulseGrid({ children, cols = 4, className }: { children: ReactNode; cols?: 3 | 4 | 5 | 6; className?: string }) {
  const map = { 3: "xl:grid-cols-3", 4: "xl:grid-cols-4", 5: "xl:grid-cols-5", 6: "xl:grid-cols-6" } as const;
  return <div className={cn("grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3", map[cols], className)}>{children}</div>;
}
