import type { ReactNode } from "react";
import { BarChart2, Target, TrendingUp, AlertTriangle, Users, Shield, PhoneCall } from "lucide-react";
import { AnimatedCounter } from "./AnimatedCounter";
import type { QDSummary } from "./types";
import { safeNum } from "./types";

interface Props {
  summary: QDSummary | undefined;
  loading: boolean;
}

interface Tile {
  label: string;
  raw: number;
  display: string;
  sub?: string;
  intent: "neutral" | "good" | "warning" | "critical";
  icon: ReactNode;
  animate: boolean;
}

const ACCENT = {
  neutral:  "before:bg-slate-300",
  good:     "before:bg-emerald-500",
  warning:  "before:bg-amber-400",
  critical: "before:bg-red-500",
} as const;

function Tile({ label, raw, display, sub, intent, icon, animate }: Tile) {
  return (
    <div
      className={`relative overflow-hidden rounded-xl border border-slate-200 bg-white p-3.5 shadow-sm transition-shadow hover:shadow-md
        before:absolute before:inset-y-0 before:left-0 before:w-1 ${ACCENT[intent]}`}
    >
      <div className="flex items-start justify-between gap-2 pl-1.5">
        <div className="min-w-0">
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-slate-500">{label}</span>
          <div className="mt-1 text-xl font-black tabular-nums leading-none text-slate-900 font-mono">
            {animate ? <AnimatedCounter target={raw} /> : display}
          </div>
          {sub && <div className="mt-1 text-[11px] text-slate-400">{sub}</div>}
        </div>
        <div className="shrink-0 rounded-lg bg-slate-50 p-1.5 text-slate-400">{icon}</div>
      </div>
    </div>
  );
}

export function QualityHeroStrip({ summary: s, loading }: Props) {
  if (loading || !s) {
    return (
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="h-[76px] animate-pulse rounded-xl border border-slate-200 bg-slate-100" />
        ))}
      </div>
    );
  }

  const total = safeNum(s.total_calls) || 1;

  const tiles: Tile[] = [
    {
      label: "Total Calls",
      raw: safeNum(s.total_calls),
      display: safeNum(s.total_calls).toLocaleString(),
      intent: "neutral",
      icon: <PhoneCall className="h-4 w-4" />,
      animate: true,
    },
    {
      label: "Audited",
      raw: safeNum(s.audited_calls),
      display: safeNum(s.audited_calls).toLocaleString(),
      sub: `${((safeNum(s.audited_calls) / total) * 100).toFixed(0)}% coverage`,
      intent: "neutral",
      icon: <BarChart2 className="h-4 w-4" />,
      animate: true,
    },
    {
      label: "Avg Quality",
      raw: safeNum(s.avg_quality_score),
      display: `${safeNum(s.avg_quality_score)}%`,
      intent: s.avg_quality_score >= 80 ? "good" : s.avg_quality_score >= 65 ? "warning" : "critical",
      icon: <Target className="h-4 w-4" />,
      animate: false,
    },
    {
      label: "Above 80%",
      raw: safeNum(s.calls_above_80),
      display: safeNum(s.calls_above_80).toLocaleString(),
      sub: `${((safeNum(s.calls_above_80) / total) * 100).toFixed(1)}% of total`,
      intent: "good",
      icon: <TrendingUp className="h-4 w-4" />,
      animate: true,
    },
    {
      label: "Below 50%",
      raw: safeNum(s.calls_below_50),
      display: safeNum(s.calls_below_50).toLocaleString(),
      sub: `${((safeNum(s.calls_below_50) / total) * 100).toFixed(1)}% of total`,
      intent: safeNum(s.calls_below_50) > 0 ? "critical" : "good",
      icon: <AlertTriangle className="h-4 w-4" />,
      animate: true,
    },
    {
      label: "Agents",
      raw: safeNum(s.unique_agents),
      display: safeNum(s.unique_agents).toLocaleString(),
      intent: "neutral",
      icon: <Users className="h-4 w-4" />,
      animate: true,
    },
    {
      label: "Fraud Flags",
      raw: safeNum(s.fraud_flags),
      display: safeNum(s.fraud_flags).toLocaleString(),
      intent: safeNum(s.fraud_flags) > 0 ? "critical" : "good",
      icon: <Shield className="h-4 w-4" />,
      animate: true,
    },
  ];

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 xl:grid-cols-7">
      {tiles.map((t) => (
        <Tile key={t.label} {...t} />
      ))}
    </div>
  );
}
