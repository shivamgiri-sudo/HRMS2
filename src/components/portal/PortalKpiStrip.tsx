import type { ReactNode } from "react";

/**
 * Top-of-page KPI strip used on both the Executive Home (across all processes) and the
 * per-process Performance tab (across that process's metrics for the selected period).
 *
 * Visual language matches the neon "control tower" dashboards this portal is modeled on:
 * dark glass cards, a colored accent glow, and an optional inline sparkline/trend.
 * All values are passed in by the caller — this component renders only what real data
 * provides; it never fabricates a number when one is unavailable (pass null and it renders
 * "—" instead of guessing).
 */

export interface KpiStripItem {
  key: string;
  label: string;
  value: string | number | null;
  sub?: string;
  accent?: "cyan" | "emerald" | "amber" | "rose" | "violet" | "slate";
  icon?: ReactNode;
}

const ACCENT_TEXT: Record<NonNullable<KpiStripItem["accent"]>, string> = {
  cyan: "text-cyan-400",
  emerald: "text-emerald-400",
  amber: "text-amber-400",
  rose: "text-rose-400",
  violet: "text-violet-400",
  slate: "text-slate-300",
};

const ACCENT_GLOW: Record<NonNullable<KpiStripItem["accent"]>, string> = {
  cyan: "shadow-[0_0_24px_-8px_rgba(34,211,238,0.35)] border-cyan-500/20",
  emerald: "shadow-[0_0_24px_-8px_rgba(16,185,129,0.35)] border-emerald-500/20",
  amber: "shadow-[0_0_24px_-8px_rgba(245,158,11,0.35)] border-amber-500/20",
  rose: "shadow-[0_0_24px_-8px_rgba(244,63,94,0.35)] border-rose-500/20",
  violet: "shadow-[0_0_24px_-8px_rgba(167,139,250,0.35)] border-violet-500/20",
  slate: "shadow-none border-slate-800/80",
};

const ACCENT_ICON_BG: Record<NonNullable<KpiStripItem["accent"]>, string> = {
  cyan: "bg-cyan-500/10 text-cyan-400 border-cyan-500/20",
  emerald: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  amber: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  rose: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  violet: "bg-violet-500/10 text-violet-400 border-violet-500/20",
  slate: "bg-slate-500/10 text-slate-400 border-slate-500/20",
};

export function PortalKpiStrip({ items }: { items: KpiStripItem[] }) {
  return (
    <div className="grid grid-cols-2 sm:grid-cols-2 lg:grid-cols-4 gap-4">
      {items.map((item) => {
        const accent = item.accent ?? "slate";
        return (
          <div
            key={item.key}
            className={`bg-slate-900/70 backdrop-blur-md border rounded-xl p-4 ${ACCENT_GLOW[accent]}`}
          >
            <div className="flex items-center justify-between mb-2">
              <p className="text-[10px] font-bold text-slate-500 uppercase tracking-widest truncate">{item.label}</p>
              {item.icon && (
                <div className={`p-1.5 rounded-md border ${ACCENT_ICON_BG[accent]}`}>{item.icon}</div>
              )}
            </div>
            <p className={`text-2xl font-extrabold tabular-nums ${ACCENT_TEXT[accent]}`}>
              {item.value == null ? <span className="text-slate-600">—</span> : item.value}
            </p>
            {item.sub && <p className="text-[10px] text-slate-500 font-medium mt-1 truncate">{item.sub}</p>}
          </div>
        );
      })}
    </div>
  );
}
