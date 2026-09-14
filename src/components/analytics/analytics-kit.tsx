/**
 * Shared analytics design system for MAS PeopleOS.
 *
 * One visual language and one set of numeric conventions for every analytics
 * surface (Payroll Analytics, ATS Command Centre, Hiring Dashboard, Hiring Entry).
 * Built to the "Data-Dense Dashboard" style: tight grid, recessive chrome, the
 * data carrying the colour.
 *
 * Two rules this module exists to enforce:
 *
 *  1. Every number states its denominator and its provenance. A figure whose
 *     scope is not on screen is a figure someone will dispute.
 *  2. A chart that shows only part of its data says so, in words, next to itself.
 *     Silent top-N truncation is the most common way a dashboard misleads.
 */
import type { ReactNode } from "react";
import { AlertTriangle, ArrowDownRight, ArrowRight, ArrowUpRight, Info } from "lucide-react";

/* ── Colour ──────────────────────────────────────────────────────────────────
 * Categorical series palette, validated with the dataviz validator against the
 * light chart surface: lightness band PASS, chroma floor PASS, adjacent CVD
 * separation PASS (worst ΔE 9.1 protan), normal-vision floor PASS (worst 19.6).
 *
 * Three slots (aqua, yellow, magenta) sit under 3:1 contrast on a light surface,
 * so the relief rule applies: every chart built from this palette ships visible
 * direct labels or an accompanying table. Do not use these for text.
 *
 * Assign by fixed index, never cycle. A 9th series folds into "Other".
 */
export const SERIES = [
  "#2a78d6", // 1 blue
  "#eb6834", // 2 orange
  "#1baf7a", // 3 aqua
  "#eda100", // 4 yellow
  "#e87ba4", // 5 magenta
  "#008300", // 6 green
  "#4a3aa7", // 7 violet
  "#e34948", // 8 red
] as const;

/** Reserved status colours. Never reused as a categorical series slot. */
export const STATUS = {
  good: "#008300",
  warning: "#eda100",
  serious: "#eb6834",
  critical: "#e34948",
  neutral: "#64748b",
} as const;

/**
 * Funnel stage colours — a sequential blue→green progression, so "further along
 * the funnel" reads as a direction rather than as eight unrelated identities.
 */
export const FUNNEL_RAMP = ["#94a3b8", "#5b93dd", "#2a78d6", "#1f8fa8", "#1baf7a", "#008300"] as const;

/* ── Number formatting ───────────────────────────────────────────────────────
 * One implementation, so the same value never renders two ways across surfaces.
 */

export const inr = (value: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Number.isFinite(value) ? value : 0);

/** Indian-numbering short form. Uses ₹ (the glyph) — not the "Rs" ASCII fallback. */
export const inrShort = (value: number) => {
  if (!Number.isFinite(value)) return "—";
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1_00_00_000) return `${sign}₹${(abs / 1_00_00_000).toFixed(2)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${(abs / 1_00_000).toFixed(2)}L`;
  if (abs >= 1_000) return `${sign}₹${(abs / 1_000).toFixed(1)}K`;
  return `${sign}₹${Math.round(abs)}`;
};

export const num = (value: number) =>
  Number.isFinite(value) ? new Intl.NumberFormat("en-IN").format(value) : "—";

/** Percentages carry one decimal everywhere; rounding to integers made shares fail to sum to 100. */
export const pct = (value: number, digits = 1) =>
  Number.isFinite(value) ? `${value.toFixed(digits)}%` : "—";

/** Safe ratio. Returns null (renders "—") rather than 0 when the denominator is absent. */
export const ratio = (numerator: number, denominator: number): number | null =>
  denominator > 0 ? (numerator / denominator) * 100 : null;

/* ── Recharts shared axis/grid props ─────────────────────────────────────────
 * Recessive chrome: hairline grid, no axis lines, muted tick ink.
 */
export const AXIS_TICK = { fontSize: 11, fill: "#64748b" } as const;
export const GRID_PROPS = { stroke: "#e2e8f0", strokeDasharray: "3 3", vertical: false } as const;
export const TOOLTIP_STYLE = {
  borderRadius: 10,
  border: "1px solid #e2e8f0",
  fontSize: 12,
  boxShadow: "0 8px 24px -8px rgb(15 23 42 / 0.18)",
  padding: "8px 10px",
} as const;

/* ── Components ──────────────────────────────────────────────────────────── */

/**
 * A single headline figure. `denominator` is not decorative — it is the sentence
 * that stops the "what is this a percentage of?" question.
 */
export function StatTile({
  label,
  value,
  denominator,
  delta,
  deltaLabel,
  intent = "neutral",
  icon,
  provisional,
}: {
  label: string;
  value: ReactNode;
  denominator?: string;
  delta?: number | null;
  deltaLabel?: string;
  intent?: "neutral" | "good" | "warning" | "critical";
  icon?: ReactNode;
  provisional?: boolean;
}) {
  const accent = {
    neutral: "before:bg-slate-300",
    good: "before:bg-[#008300]",
    warning: "before:bg-[#eda100]",
    critical: "before:bg-[#e34948]",
  }[intent];

  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow duration-200 hover:shadow-md
                  before:absolute before:inset-y-0 before:left-0 before:w-1 ${accent}`}
    >
      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="truncate text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
            {provisional && (
              <span className="shrink-0 rounded bg-amber-100 px-1 py-px text-[9px] font-bold text-amber-700">
                PROVISIONAL
              </span>
            )}
          </div>
          <div className="mt-1.5 truncate text-2xl font-bold tabular-nums leading-none text-slate-900">{value}</div>
          {denominator && <div className="mt-1.5 truncate text-[11px] text-slate-500">{denominator}</div>}
          {delta !== undefined && delta !== null && (
            <div
              className={`mt-1.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold tabular-nums ${
                delta > 0
                  ? "bg-emerald-50 text-emerald-700"
                  : delta < 0
                    ? "bg-rose-50 text-rose-700"
                    : "bg-slate-100 text-slate-600"
              }`}
            >
              {delta > 0 ? <ArrowUpRight className="h-3 w-3" /> : delta < 0 ? <ArrowDownRight className="h-3 w-3" /> : <ArrowRight className="h-3 w-3" />}
              {delta > 0 ? "+" : ""}
              {delta.toFixed(1)}%{deltaLabel ? ` ${deltaLabel}` : ""}
            </div>
          )}
        </div>
        {icon && <div className="shrink-0 rounded-lg bg-slate-50 p-1.5 text-slate-400">{icon}</div>}
      </div>
    </div>
  );
}

/** Consistent frame for every chart: title, one-line method note, optional right slot. */
export function ChartCard({
  title,
  subtitle,
  action,
  children,
  footer,
  className = "",
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  return (
    <section className={`flex flex-col rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>
      <header className="flex flex-wrap items-start justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div className="min-w-0">
          <h3 className="text-sm font-bold leading-tight text-slate-900">{title}</h3>
          {subtitle && <p className="mt-0.5 text-[11px] leading-snug text-slate-500">{subtitle}</p>}
        </div>
        {action && <div className="shrink-0">{action}</div>}
      </header>
      <div className="flex-1 p-4">{children}</div>
      {footer && <div className="border-t border-slate-100 px-4 py-2">{footer}</div>}
    </section>
  );
}

/**
 * States what a capped chart is actually showing. Rendered in words, beside the
 * chart, so a top-N view is never mistaken for the whole dataset.
 */
export function CoverageNote({
  shownGroups,
  distinctGroups,
  shownRecords,
  otherGroups,
  otherRecords,
  unit = "records",
}: {
  shownGroups: number;
  distinctGroups: number;
  shownRecords: number;
  otherGroups: number;
  otherRecords: number;
  unit?: string;
}) {
  const complete = otherGroups === 0 && otherRecords === 0;
  return (
    <p
      className={`flex items-start gap-1.5 text-[11px] leading-snug ${
        complete ? "text-slate-500" : "text-amber-700"
      }`}
    >
      <Info className="mt-px h-3 w-3 shrink-0" />
      <span>
        {complete ? (
          <>
            All {num(distinctGroups)} groups shown · {num(shownRecords)} {unit} · 100% of scope
          </>
        ) : (
          <>
            Top {num(shownGroups)} of {num(distinctGroups)} groups · {num(shownRecords)} {unit} charted ·{" "}
            <strong className="font-semibold">
              {num(otherRecords)} {unit} across {num(otherGroups)} further group{otherGroups === 1 ? "" : "s"} not shown
            </strong>
          </>
        )}
      </span>
    </p>
  );
}

/**
 * Failed sub-queries render as zeros, which are indistinguishable from real
 * zeros. Say so loudly rather than let a zero pass as a measurement.
 */
export function DegradedBanner({ degraded, onRetry }: { degraded?: string[]; onRetry?: () => void }) {
  if (!degraded?.length) return null;
  return (
    <div role="alert" className="rounded-xl border-2 border-rose-200 bg-rose-50 px-4 py-3">
      <div className="flex items-start gap-2.5">
        <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-rose-600" />
        <div className="min-w-0 flex-1 text-xs text-rose-900">
          <p className="font-bold">Partial data — not safe to report from</p>
          <p className="mt-1 leading-relaxed">
            {degraded.length} section{degraded.length === 1 ? "" : "s"} failed to load and{" "}
            {degraded.length === 1 ? "is" : "are"} showing zero instead of a real value:{" "}
            <span className="font-semibold">{degraded.join(", ")}</span>.
          </p>
          {onRetry && (
            <button
              type="button"
              onClick={onRetry}
              className="mt-2 cursor-pointer rounded-md border border-rose-300 bg-white px-2.5 py-1 text-[11px] font-bold text-rose-700 transition-colors duration-150 hover:bg-rose-100"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * The provenance strip: what the figures cover and where they came from. Sits
 * directly under the page title on every analytics surface.
 */
export function ProvenanceBar({ items }: { items: Array<{ label: string; value: ReactNode; warn?: boolean }> }) {
  return (
    <div className="flex flex-wrap items-center gap-x-5 gap-y-1.5 rounded-xl border border-slate-200 bg-slate-50/70 px-4 py-2.5">
      {items.map((item) => (
        <div key={item.label} className="flex items-baseline gap-1.5">
          <span className="text-[10px] font-bold uppercase tracking-[0.12em] text-slate-400">{item.label}</span>
          <span className={`text-xs font-semibold ${item.warn ? "text-amber-700" : "text-slate-800"}`}>
            {item.value}
          </span>
        </div>
      ))}
    </div>
  );
}

/** Empty state that names the scope, so "no data" is never read as "broken". */
export function EmptyState({ label, hint, height = 200 }: { label: string; hint?: string; height?: number }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 text-center" style={{ height }}>
      <p className="text-sm font-medium text-slate-400">{label}</p>
      {hint && <p className="text-[11px] text-slate-400">{hint}</p>}
    </div>
  );
}

/** Skeleton matched to the real card geometry, so loading doesn't shift layout. */
export function ChartSkeleton({ height = 260 }: { height?: number }) {
  return (
    <div className="animate-pulse rounded-xl border border-slate-200 bg-white p-4">
      <div className="h-3.5 w-40 rounded bg-slate-200" />
      <div className="mt-2 h-2.5 w-56 rounded bg-slate-100" />
      <div className="mt-4 rounded-lg bg-slate-100" style={{ height }} />
    </div>
  );
}
