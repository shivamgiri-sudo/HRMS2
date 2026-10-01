/**
 * Crisp attrition card for the role dashboards (HR, branch head, managers). Self-contained: brings its own
 * DrillProvider so every number opens the people behind it, and fails soft (renders nothing) when /pulse
 * errors or the user has no access.
 */
import { memo } from "react";
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis } from "recharts";
import { ArrowDownRight, ArrowRight, ArrowUpRight, Minus } from "lucide-react";
import { ReferencePanel } from "@/pages/dashboards/ReferenceDashboardUI";
import { useHubPulse } from "./api";
import { DRILL_FOCUS, LIFT, Shimmer, TIER_COLOR, drillable, fmtMonth } from "./charts";
import { DrillProvider, alertLinkToDrill, useDrill } from "./DrillContext";
import type { AlertSeverity, DrillQuery, HubPulse } from "./types";

const SEV_DOT: Record<AlertSeverity, string> = { critical: "#e34948", warning: "#eda100", info: "#2a78d6" };
const SCOPE_SUB: Record<HubPulse["scope"], string> = { org: "Across the organisation", branch: "Your branch", team: "Your team" };
const n0 = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const fmt = (v: number) => v.toLocaleString("en-IN");

export function PulseBody({ data }: { data: Partial<HubPulse> | null | undefined }) {
  const drill = useDrill();
  const d = data ?? {};
  const critical = n0(d.critical), high = n0(d.high), absent = n0(d.absentStreak), expected = n0(d.expectedExits30);
  const exits30 = n0(d.exits30), prev = n0(d.exitsPrev30);
  const monthly = (d.monthlyExits ?? []).map(m => ({ ...m, label: fmtMonth(m.month) }));
  const alerts = (d.topAlerts ?? []).slice(0, 3);
  const diff = exits30 - prev;

  const nums: { label: string; value: string; color: string; query: DrillQuery; aria: string }[] = [
    { label: "Critical", value: fmt(critical), color: TIER_COLOR.CRITICAL, aria: `Open ${critical} people at critical risk`, query: { population: "active", tier: "CRITICAL", sort: "score", title: `Critical risk - ${fmt(critical)} people` } },
    { label: "High", value: fmt(high), color: TIER_COLOR.HIGH, aria: `Open ${high} people at high risk`, query: { population: "active", tier: "HIGH", sort: "score", title: `High risk - ${fmt(high)} people` } },
    { label: "Absent 3d+", value: fmt(absent), color: "#334155", aria: `Open people on an absence streak, ${absent} absent 3 days or more`, query: { population: "active", minAbsentStreak: 3, sort: "score", title: `Absent 3+ days in a row - ${fmt(absent)} people` } },
    { label: "Exits expected 30d", value: `~${fmt(Math.round(expected))}`, color: "#334155", aria: `Open the people most likely to leave in 30 days, about ${Math.round(expected)} expected`, query: { population: "active", sort: "score", title: `Most likely to leave in 30 days - ~${fmt(Math.round(expected))} expected` } },
  ];

  return (
    <div className="min-w-0 space-y-3 [&_*]:min-w-0">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
      <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-[11px] text-[#71809a]">{SCOPE_SUB[d.scope ?? "org"]}{d.headcount ? ` · ${fmt(n0(d.headcount))} people` : ""}</p>
        <button type="button" onClick={() => drill({ population: "exits", windowDays: 30, sort: "date", title: `Exits in the last 30 days - ${fmt(exits30)}` })}
          aria-label={`Open ${exits30} exits in the last 30 days`}
          className={`inline-flex max-w-full items-center gap-1 whitespace-normal rounded-full px-2 py-0.5 text-left text-[11px] font-semibold tabular-nums ${diff > 0 ? "bg-rose-50 text-rose-700" : diff < 0 ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-600"} ${DRILL_FOCUS}`}>
          {diff > 0 ? <ArrowUpRight className="h-3 w-3" aria-hidden /> : diff < 0 ? <ArrowDownRight className="h-3 w-3" aria-hidden /> : <Minus className="h-3 w-3" aria-hidden />}
          {fmt(exits30)} exits in 30d · {diff > 0 ? "+" : ""}{diff} vs prev 30d
        </button>
      </div>

      <div className="grid grid-cols-[repeat(auto-fit,minmax(72px,1fr))] gap-2">
        {nums.map(x => (
          <button key={x.label} type="button" onClick={() => drill(x.query)} aria-label={x.aria}
            className={`rounded-xl border border-[#e6edf7] bg-white px-3 py-2.5 text-left shadow-sm hover:border-[#c9d8ef] ${DRILL_FOCUS} ${LIFT}`}>
            <div className="text-2xl font-extrabold leading-none tabular-nums" style={{ color: x.color }}>{x.value}</div>
            <div className="mt-1.5 text-[11px] font-semibold text-[#61708a]">{x.label}</div>
          </button>
        ))}
      </div>

      </div>
      <div className="space-y-3">
      {monthly.length >= 2 && (
        <div role="img" aria-label={`Exits per month, last ${monthly.length} months: ${monthly.map(m => `${m.label} ${m.exits}`).join(", ")}`} className="-mx-1">
          <ResponsiveContainer width="100%" height={64}>
            <AreaChart data={monthly} margin={{ top: 4, right: 6, bottom: 0, left: 6 }}>
              <defs>
                <linearGradient id="pulseFill" x1="0" y1="0" x2="0" y2="1"><stop offset="0%" stopColor="#e34948" stopOpacity={0.35} /><stop offset="100%" stopColor="#e34948" stopOpacity={0.02} /></linearGradient>
              </defs>
              <XAxis dataKey="label" hide />
              <Tooltip contentStyle={{ fontSize: 11, borderRadius: 8, border: "1px solid #e2e8f0" }} formatter={(v: number | string) => [fmt(Number(v)), "Exits"]} />
              <Area type="monotone" dataKey="exits" stroke="#e34948" strokeWidth={2} fill="url(#pulseFill)" isAnimationActive={false} dot={false} />
            </AreaChart>
          </ResponsiveContainer>
          <div className="flex justify-between px-2 text-[10px] text-[#94a3b8]"><span>{monthly[0].label}</span><span>Monthly exits</span><span>{monthly[monthly.length - 1].label}</span></div>
        </div>
      )}

      {alerts.length > 0 && (
        <ul className="divide-y divide-[#edf1f6] rounded-lg border border-[#edf1f6]" aria-label="Top attrition alerts">
          {alerts.map(a => {
            const body = (
              <>
                <span aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: SEV_DOT[a.severity] ?? SEV_DOT.info }} />
                <span className="min-w-0 flex-1 truncate text-xs font-medium text-[#1d2b45]" title={a.detail}>{a.title}</span>
                {a.employeeCount !== undefined && <span className="shrink-0 text-[11px] font-bold tabular-nums text-[#61708a]">{a.employeeCount}</span>}
              </>
            );
            return a.link ? (
              <li key={a.id}><button type="button" onClick={() => drill(alertLinkToDrill(a.link!, a.employeeCount !== undefined ? `${a.title} - ${a.employeeCount} people` : a.title))} aria-label={`Open people for alert: ${a.title}`}
                className={`flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-[#f5f9ff] ${DRILL_FOCUS}`}>{body}</button></li>
            ) : <li key={a.id} className="flex items-center gap-2 px-3 py-2">{body}</li>;
          })}
        </ul>
      )}

      </div>
      </div>

      <div className="flex items-center justify-between pt-0.5">
        <span className="text-[10px] text-[#94a3b8]">{d.asOf ? `As of ${d.asOf}` : ""}</span>
        <a href="/workforce/aon-analytics" className="inline-flex items-center gap-1 text-xs font-semibold text-[#0b63e5] hover:underline">Open full analysis <ArrowRight className="h-3 w-3" aria-hidden /></a>
      </div>
    </div>
  );
}

function PulseInner() {
  const q = useHubPulse();
  if (q.isLoading) {
    return <ReferencePanel title="Attrition Pulse"><div aria-busy="true" className="space-y-3"><Shimmer className="h-4 w-40" /><div className="grid grid-cols-4 gap-2">{[0, 1, 2, 3].map(i => <Shimmer key={i} className="h-14" />)}</div><Shimmer className="h-16" /></div></ReferencePanel>;
  }
  // No access (403) or any failure: stay out of the way of the dashboard.
  if (q.error || !q.data) return null;
  return <ReferencePanel title="Attrition Pulse"><PulseBody data={q.data} /></ReferencePanel>;
}

function AttritionPulseCardImpl() {
  return <DrillProvider><PulseInner /></DrillProvider>;
}
export const AttritionPulseCard = memo(AttritionPulseCardImpl);
export default AttritionPulseCard;
