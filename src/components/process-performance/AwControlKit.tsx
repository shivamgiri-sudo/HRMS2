import type { ComponentType, ReactNode } from "react";
import { ArrowUp, ArrowDown } from "lucide-react";

/**
 * Shared look for Appreciate Wealth's two "control center" slides (Agent-wise
 * and Inbound): a navy page with cream cards, tiles with a coloured delta
 * against the previous period, ring gauges and the small formatters both use.
 * Class strings are literal so Tailwind's static scan compiles them.
 */

export const TOOLTIP_PROPS = {
  contentStyle: { fontSize: 12, borderRadius: 10, border: "1px solid #cbd5e1", background: "#ffffff", boxShadow: "0 8px 24px rgba(15,23,42,0.18)", padding: "8px 12px" },
  itemStyle: { color: "#0f172a", fontWeight: 600 },
  labelStyle: { color: "#334155", fontWeight: 700, marginBottom: 4 },
} as const;

/** 12,345 s -> "3:25:45" (hours not capped). */
export function fmtHms(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  return `${Math.floor(t / 3600)}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
/** 195 s -> "00:03:15" (the inbound mock-up's clock format). */
export function fmtClock(totalSeconds: number): string {
  const t = Math.max(0, Math.round(totalSeconds));
  return `${String(Math.floor(t / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}:${String(t % 60).padStart(2, "0")}`;
}
export const fmtMins = (s: number): string => `${Math.round((s / 60) * 10) / 10} mins`;
export const fmtNum = (n: number): string => Math.round(n).toLocaleString("en-IN");
export const fmtPctVal = (n: number): string => `${Math.round(n * 10) / 10}%`;

export interface Delta { text: string; up: boolean; good: boolean }
/** "pp" = a percentage-point move (for rates); "pct" = a % change (for counts and durations). */
export function deltaOf(cur: number, prev: number | undefined, kind: "pct" | "pp", goodWhenUp: boolean): Delta | null {
  if (prev === undefined) return null;
  if (kind === "pp") {
    const d = Math.round((cur - prev) * 10) / 10;
    if (d === 0) return null;
    return { text: `${Math.abs(d)} pp`, up: d > 0, good: d > 0 === goodWhenUp };
  }
  if (!(prev > 0)) return null;
  const c = Math.round(((cur - prev) / prev) * 1000) / 10;
  if (c === 0) return null;
  return { text: `${Math.abs(c)}%`, up: c > 0, good: c > 0 === goodWhenUp };
}
export function DeltaText({ d }: { d: Delta | null }) {
  if (!d) return <span className="text-[11px] text-slate-400">—</span>;
  const Icon = d.up ? ArrowUp : ArrowDown;
  return <span className={`inline-flex items-center gap-0.5 text-[12px] font-bold ${d.good ? "text-emerald-600" : "text-rose-600"}`}><Icon className="h-3 w-3" />{d.text}</span>;
}

export function CcShell({ children }: { children: ReactNode }) {
  return <div className="space-y-3 rounded-3xl bg-gradient-to-br from-[#0b1440] via-[#101c52] to-[#0b1440] p-3 text-slate-100 shadow-xl sm:p-4">{children}</div>;
}

export function CcHeader({ title, subtitle, right }: { title: string; subtitle: string; right?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1">
      <div>
        <h2 className="text-lg font-extrabold uppercase tracking-tight text-white sm:text-xl">{title}</h2>
        <p className="text-xs font-medium text-indigo-200">{subtitle}</p>
      </div>
      {right && <div className="flex flex-wrap items-center gap-2">{right}</div>}
    </div>
  );
}

export function CcPanel({ title, icon: Icon, action, children, className = "" }: { title: string; icon?: ComponentType<{ className?: string }>; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl bg-[#fffbea] p-3 text-slate-800 shadow-md ${className}`}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="flex items-center gap-2 text-sm font-extrabold text-indigo-950">
          {Icon && <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-indigo-900 text-white"><Icon className="h-3.5 w-3.5" /></span>}
          {title}
        </p>
        {action}
      </div>
      {children}
    </div>
  );
}

export function CcTile({
  icon: Icon, label, value, delta, sub, tone, onClick, ring,
}: { icon: ComponentType<{ className?: string }>; label: string; value: string; delta: Delta | null; sub?: string; tone: string; onClick?: () => void; ring?: number }) {
  return (
    <button
      type="button" onClick={onClick} disabled={!onClick} title={onClick ? `${label} — click for details` : label}
      className={`flex items-center gap-3 rounded-2xl bg-[#fffbea] p-3 text-left text-slate-800 shadow-md transition-all ${onClick ? "cursor-pointer hover:-translate-y-0.5 hover:shadow-lg" : "cursor-default"}`}
    >
      {ring !== undefined
        ? <Ring pct={ring} color="#10b981" size={52} label={`${Math.round(ring)}%`} />
        : <span className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${tone}`}><Icon className="h-5 w-5" /></span>}
      <span className="min-w-0">
        <span className="block truncate text-[11px] font-semibold text-slate-500">{label}</span>
        <span className="block truncate text-xl font-extrabold leading-tight tracking-tight text-indigo-950">{value}</span>
        <span className="flex items-center gap-1.5 leading-none"><DeltaText d={delta} /><span className="text-[9px] text-slate-400">{sub ?? "vs previous period"}</span></span>
      </span>
    </button>
  );
}

/** Circular gauge (0-100). */
export function Ring({ pct, color, size = 96, label, sub }: { pct: number; color: string; size?: number; label?: string; sub?: string }) {
  const stroke = Math.max(6, Math.round(size / 9));
  const r = (size - stroke) / 2; const c = 2 * Math.PI * r;
  const v = Math.max(0, Math.min(100, pct));
  return (
    <span className="relative inline-flex shrink-0 flex-col items-center" style={{ width: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e5e7eb" strokeWidth={stroke} />
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke} strokeLinecap="round" strokeDasharray={c} strokeDashoffset={c * (1 - v / 100)} />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center text-center leading-tight" style={{ height: size }}>
        <span className="font-extrabold text-indigo-950" style={{ fontSize: Math.max(11, size / 5.2) }}>{label ?? `${Math.round(v)}%`}</span>
        {sub && <span className="text-[9px] text-slate-500">{sub}</span>}
      </span>
    </span>
  );
}

/** Green (good) -> amber -> red (bad) cell tint for a 0-100 rate; `goodHigh` flips the direction. */
export function rateTint(v: number, goodHigh: boolean, has = true): string {
  if (!has) return "bg-slate-100 text-slate-400";
  const score = goodHigh ? v : 100 - v;
  return score >= 80 ? "bg-emerald-200 text-emerald-900" : score >= 60 ? "bg-lime-100 text-lime-900" : score >= 40 ? "bg-amber-100 text-amber-900" : "bg-rose-200 text-rose-900";
}

export function CoverageNote({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-sky-300/40 bg-sky-500/10 px-3 py-2 text-[11px] font-medium text-sky-100">{children}</p>;
}
