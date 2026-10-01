/** Shared visual bits for the attrition tabs: tier/factor colours, chips, gauge, error card, segmented control. */
import type { ReactNode } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { SERIES, STATUS } from "@/components/analytics/analytics-kit";
import { FACTOR_GROUPS, type FactorGroup, type FactorPoints, type Tier } from "./types";

export const TIER_COLOR: Record<Tier, string> = {
  CRITICAL: STATUS.critical,
  HIGH: STATUS.serious,
  MEDIUM: STATUS.warning,
  LOW: "#1baf7a",
};
export const TIER_LABEL: Record<Tier, string> = { CRITICAL: "Critical", HIGH: "High", MEDIUM: "Medium", LOW: "Low" };
const TIER_SOFT: Record<Tier, string> = {
  CRITICAL: "bg-rose-50 text-rose-700 border-rose-200",
  HIGH: "bg-orange-50 text-orange-700 border-orange-200",
  MEDIUM: "bg-amber-50 text-amber-700 border-amber-200",
  LOW: "bg-emerald-50 text-emerald-700 border-emerald-200",
};
/** Tier marks also carry a glyph so colour is never the only signal. */
const TIER_GLYPH: Record<Tier, string> = { CRITICAL: "▲▲", HIGH: "▲", MEDIUM: "●", LOW: "▽" };

export const GROUP_COLOR: Record<FactorGroup, string> = {
  lifecycle: SERIES[0],
  attendance: SERIES[1],
  performance: SERIES[6],
  compensation: SERIES[3],
  conduct: SERIES[4],
  team: SERIES[2],
};
export const GROUP_LABEL = Object.fromEntries(FACTOR_GROUPS.map(g => [g.key, g.label])) as Record<FactorGroup, string>;

export function TierChip({ tier, className = "" }: { tier: Tier; className?: string }) {
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] font-bold ${TIER_SOFT[tier]} ${className}`}>
      <span aria-hidden className="text-[8px]">{TIER_GLYPH[tier]}</span>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Small pill-style toggle button used for filter chips. */
export function ToggleChip({ active, onClick, children, title }: { active: boolean; onClick: () => void; children: ReactNode; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      title={title}
      onClick={onClick}
      className={`inline-flex min-h-[32px] cursor-pointer items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
        active ? "border-slate-800 bg-slate-800 text-white" : "border-slate-200 bg-white text-slate-700 hover:bg-slate-50"
      }`}
    >
      {children}
    </button>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, label,
}: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[]; label: string }) {
  return (
    <div role="group" aria-label={label} className="inline-flex gap-0.5 rounded-lg bg-slate-100 p-0.5">
      {options.map(o => (
        <button
          key={o.value}
          type="button"
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
          className={`cursor-pointer rounded-md px-2.5 py-1 text-xs font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 ${
            value === o.value ? "bg-white text-slate-900 shadow-sm" : "text-slate-500 hover:text-slate-800"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ErrorCard({ error, onRetry, what }: { error: unknown; onRetry: () => void; what: string }) {
  const msg = (error as Error)?.message || "Request failed";
  return (
    <div role="alert" className="flex items-start gap-3 rounded-xl border border-rose-200 bg-rose-50 p-4 text-sm text-rose-800">
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="min-w-0 flex-1">
        <p className="font-bold">Could not load {what}</p>
        <p className="mt-0.5 break-words text-xs">{msg}</p>
      </div>
      <button
        type="button"
        onClick={onRetry}
        className="inline-flex shrink-0 cursor-pointer items-center gap-1 rounded-md border border-rose-300 bg-white px-2.5 py-1 text-xs font-bold text-rose-700 hover:bg-rose-100"
      >
        <RefreshCw className="h-3 w-3" /> Retry
      </button>
    </div>
  );
}

/** Horizontal bar made of divs (cheap, accessible, no chart lib overhead per row). */
export function MiniBar({ value, max, color, label, height = 6 }: { value: number; max: number; color: string; label?: string; height?: number }) {
  const w = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  return (
    <div
      role={label ? "img" : undefined}
      aria-label={label}
      className="w-full overflow-hidden rounded-full bg-slate-100"
      style={{ height }}
    >
      <div className="h-full rounded-full motion-safe:transition-[width] motion-safe:duration-500" style={{ width: `${w}%`, background: color }} />
    </div>
  );
}

/** Six-segment stacked bar of factor points (shared scale across rows so rows are comparable). */
export function FactorStack({ factors, scaleMax = 100, height = 10 }: { factors: FactorPoints; scaleMax?: number; height?: number }) {
  const total = FACTOR_GROUPS.reduce((s, g) => s + (factors[g.key] || 0), 0);
  const text = FACTOR_GROUPS.map(g => `${g.label} ${Math.round(factors[g.key] || 0)}`).join(", ");
  return (
    <div
      role="img"
      aria-label={`Score breakdown, ${Math.round(total)} points: ${text}`}
      title={FACTOR_GROUPS.map(g => `${g.label}: ${(factors[g.key] || 0).toFixed(0)}`).join("\n")}
      className="flex w-full overflow-hidden rounded-full bg-slate-100"
      style={{ height }}
    >
      {FACTOR_GROUPS.map(g => {
        const v = factors[g.key] || 0;
        if (v <= 0) return null;
        return <div key={g.key} style={{ width: `${(v / scaleMax) * 100}%`, background: GROUP_COLOR[g.key] }} className="h-full border-r border-white/70 last:border-r-0" />;
      })}
    </div>
  );
}

export function FactorLegend() {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1" aria-label="Score groups">
      {FACTOR_GROUPS.map(g => (
        <li key={g.key} className="flex items-center gap-1.5 text-[11px] text-slate-600">
          <span aria-hidden className="h-2.5 w-2.5 rounded-sm" style={{ background: GROUP_COLOR[g.key] }} />
          {g.label}
        </li>
      ))}
    </ul>
  );
}

/** Semi-circle gauge, 0-100. */
export function ScoreGauge({ score, tier }: { score: number; tier: Tier }) {
  const r = 52, c = Math.PI * r;
  const frac = Math.max(0, Math.min(1, score / 100));
  return (
    <div role="img" aria-label={`Risk score ${Math.round(score)} out of 100, ${TIER_LABEL[tier]} tier`} className="relative mx-auto w-[140px]">
      <svg viewBox="0 0 120 68" className="w-full">
        <path d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke="#e2e8f0" strokeWidth="10" strokeLinecap="round" />
        <path
          d="M8 60 A52 52 0 0 1 112 60" fill="none" stroke={TIER_COLOR[tier]} strokeWidth="10" strokeLinecap="round"
          strokeDasharray={`${c * frac} ${c}`} className="motion-safe:transition-[stroke-dasharray] motion-safe:duration-700"
        />
      </svg>
      <div className="absolute inset-x-0 bottom-0 text-center">
        <div className="text-2xl font-bold tabular-nums leading-none text-slate-900">{Math.round(score)}</div>
        <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">of 100</div>
      </div>
    </div>
  );
}

export const fmtMonth = (m: string) => {
  const [y, mo] = m.split("-").map(Number);
  if (!y || !mo) return m;
  return new Date(y, mo - 1, 1).toLocaleString("en-IN", { month: "short" }) + (mo === 1 ? ` ’${String(y).slice(2)}` : "");
};

export const fmtAon = (days: number) => {
  if (days < 90) return `${days}d`;
  if (days < 730) return `${Math.round(days / 30)}mo`;
  return `${(days / 365).toFixed(1)}y`;
};
