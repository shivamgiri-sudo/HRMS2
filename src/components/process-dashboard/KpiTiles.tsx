import { ArrowDownRight, ArrowUpRight, Minus, Target } from "lucide-react";
import { formatDelta, formatValue, statusMeta } from "./format";
import { FOCUS, Skeleton, Sparkline } from "./ui";
import type { Kpi } from "./types";
import { WhyButton } from "./rootcause/WhyButton";

const TONE = { good: "text-emerald-800", bad: "text-red-800", neutral: "text-slate-700" } as const;
const BAR = { good: "bg-emerald-500", warn: "bg-amber-500", bad: "bg-red-500", nodata: "bg-slate-300" } as const;

export function KpiTiles({ kpis, activeKey, onSelect, loading, onWhy }: { kpis?: Kpi[]; activeKey: string; onSelect: (key: string) => void; loading: boolean; onWhy?: (key: string) => void }) {
  if (loading && !kpis) return <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4">{Array.from({ length: 8 }, (_, i) => <Skeleton key={i} className="h-[112px]" />)}</div>;
  const shown = (kpis ?? []).filter((k) => k.available !== false); // unmapped metrics are hidden, not shown as zero
  if (!shown.length) return null;
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4" aria-label="Key metrics">
      {shown.map((k) => {
        const d = formatDelta(k.deltaPct, k.direction);
        const st = statusMeta(k.status);
        const Arrow = d.arrow === "up" ? ArrowUpRight : d.arrow === "down" ? ArrowDownRight : Minus;
        const active = activeKey === k.key;
        return (
          <li key={k.key} className="relative">
            <button type="button" onClick={() => onSelect(k.key)} aria-pressed={active}
              aria-label={`${k.label}: ${formatValue(k.value, k.unit)}. ${d.srText}. ${st.label}. Focus trend and sort table by this metric.`}
              className={`group relative flex h-full w-full cursor-pointer flex-col overflow-hidden rounded-xl border bg-white p-3 text-left shadow-sm transition-shadow hover:shadow-md ${FOCUS} ${active ? "border-blue-600 ring-1 ring-blue-600" : "border-slate-200"}`}>
              <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${BAR[(k.status ?? "nodata") as keyof typeof BAR] ?? BAR.nodata}`} />
              <span className="pl-1 text-[11px] font-medium leading-tight text-slate-700">{k.label}</span>
              <span className="mt-1 flex items-end justify-between gap-2 pl-1">
                <span className="text-xl font-bold leading-none tabular-nums text-slate-900">{formatValue(k.value, k.unit)}</span>
                <Sparkline points={k.spark} stroke={k.status === "bad" ? "#dc2626" : "#2563eb"} />
              </span>
              <span className={`mt-1.5 flex items-center gap-1 pl-1 text-[11px] font-semibold ${TONE[d.tone]}`}>
                <Arrow className="h-3.5 w-3.5" aria-hidden="true" />{d.text}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-1.5 pl-1">
                <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold ring-1 ${st.cls}`}>{st.label}</span>
                {typeof k.target === "number" && <span className="inline-flex items-center gap-0.5 text-[10px] text-slate-600"><Target className="h-3 w-3" aria-hidden="true" />{formatValue(k.target, k.unit)}</span>}
                {k.available === false && <span className="text-[10px] font-semibold text-slate-600">Field not mapped</span>}
              </span>
            </button>
            {onWhy && k.value !== null && <WhyButton label={k.label} onClick={() => onWhy(k.key)} className="absolute right-2 top-2 bg-white/90" />}
          </li>
        );
      })}
    </ul>
  );
}
