import { AlertOctagon, AlertTriangle, Info, ShieldCheck, TrendingDown, TrendingUp } from "lucide-react";
import { DASH, formatValue, humanize } from "./format";
import { Empty, FOCUS, Panel } from "./ui";
import { SimpleTable, type SimpleCol } from "./SimpleTable";
import type { Anomaly, BreakdownRow, Kpi, Overview, PerformerRow } from "./types";

const SEV = {
  high: { Icon: AlertOctagon, cls: "border-red-300 bg-red-50 text-red-900", label: "High" },
  medium: { Icon: AlertTriangle, cls: "border-amber-300 bg-amber-50 text-amber-950", label: "Medium" },
  bad: { Icon: AlertOctagon, cls: "border-red-300 bg-red-50 text-red-900", label: "Critical" },
  warn: { Icon: AlertTriangle, cls: "border-amber-300 bg-amber-50 text-amber-950", label: "Warning" },
  low: { Icon: Info, cls: "border-slate-300 bg-slate-50 text-slate-800", label: "Low" },
} as const;

export function AnomaliesPanel({ anomalies, onAgent }: { anomalies?: Anomaly[]; onAgent: (code: string) => void }) {
  const list = anomalies ?? [];
  return (
    <Panel title={`Anomalies${list.length ? ` (${list.length})` : ""}`}>
      {list.length === 0 ? <Empty>No anomalies detected in this range.</Empty> : (
        <ul className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {list.map((a, i) => {
            const s = SEV[(a.severity as keyof typeof SEV)] ?? SEV.low;
            const body = <><s.Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span className="min-w-0 text-left text-xs"><span className="font-bold">{s.label}: {humanize(a.type)}</span>{a.name || a.agentCode ? ` · ${a.name ?? a.agentCode}` : ""}{a.date ? ` · ${a.date}` : ""}{a.detail && <span className="block font-normal">{a.detail}</span>}</span></>;
            return <li key={i}>{a.agentCode
              ? <button type="button" onClick={() => onAgent(a.agentCode!)} className={`flex w-full cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 ${s.cls} ${FOCUS}`}>{body}</button>
              : <div className={`flex items-start gap-2 rounded-lg border px-2.5 py-2 ${s.cls}`}>{body}</div>}</li>;
          })}
        </ul>
      )}
    </Panel>
  );
}

function Performers({ title, rows, icon: Icon, onAgent }: { title: string; rows: PerformerRow[]; icon: typeof TrendingUp; onAgent: (c: string) => void }) {
  return (
    <div>
      <h4 className="mb-1 flex items-center gap-1.5 text-xs font-bold text-slate-700"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{title}</h4>
      {rows.length === 0 ? <p className="text-xs text-slate-600">{DASH}</p> : (
        <ol className="space-y-0.5">
          {rows.map((r, i) => (
            <li key={`${r.agentCode}-${i}`}><button type="button" onClick={() => onAgent(r.agentCode)} className={`flex w-full min-h-[32px] cursor-pointer items-center justify-between gap-2 rounded-md px-2 text-xs hover:bg-slate-100 ${FOCUS}`}>
              <span className="truncate text-left font-medium text-slate-900">{i + 1}. {r.name ?? r.agentCode}</span>
              <span className="tabular-nums text-slate-700">{formatValue(r.value)}</span></button></li>
          ))}
        </ol>
      )}
    </div>
  );
}

export function TopBottomPanel({ data, onAgent }: { data?: Overview["topBottom"]; onAgent: (c: string) => void }) {
  const metric = data?.top?.[0]?.metric ?? data?.bottom?.[0]?.metric;
  return (
    <Panel title={`Top and bottom performers${metric ? ` — ${humanize(metric)}` : ""}`}>
      {!data?.top?.length && !data?.bottom?.length ? <Empty>No agent ranking available.</Empty> : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Performers title="Top" rows={data?.top ?? []} icon={TrendingUp} onAgent={onAgent} />
          <Performers title="Bottom" rows={data?.bottom ?? []} icon={TrendingDown} onAgent={onAgent} />
        </div>
      )}
    </Panel>
  );
}

export function BreakdownPanel({ title, labelKey, rows, kpis, active, onPick }: { title: string; labelKey: "tl" | "lob"; rows?: BreakdownRow[]; kpis?: Kpi[]; active: string; onPick: (v: string) => void }) {
  const data = (rows ?? []) as Array<Record<string, unknown>>;
  const metricCols = (kpis ?? []).filter((k) => data.some((r) => typeof r[k.key] === "number")).slice(0, 5);
  const cols: SimpleCol[] = [
    { key: labelKey, label: labelKey === "tl" ? "Team leader" : "LOB", align: "left", render: (r) => {
      const v = String(r[labelKey] ?? DASH);
      return <button type="button" aria-pressed={active === v} aria-label={`Filter dashboard to ${v}`} onClick={() => onPick(active === v ? "" : v)}
        className={`cursor-pointer rounded px-1 font-semibold ${FOCUS} ${active === v ? "bg-blue-700 text-white" : "text-blue-800 hover:underline"}`}>{v}</button>; } },
    { key: "agents", label: "Agents" },
    ...metricCols.map((k) => ({ key: k.key, label: k.label, unit: k.unit })),
  ];
  return (
    <Panel title={title}>
      {data.length === 0 ? <Empty>No breakdown for this range.</Empty> : <SimpleTable caption={title} cols={cols} rows={data} maxHeight="max-h-72" />}
    </Panel>
  );
}

export function QualityStrip({ quality }: { quality?: Overview["quality"] }) {
  if (!quality || (quality.audits ?? 0) === 0 && quality.avgScore == null) return null;
  return (
    <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-2xl border border-slate-200 bg-white px-4 py-2.5 text-xs text-slate-800" aria-label="Quality summary">
      <span className="inline-flex items-center gap-1.5 font-bold"><ShieldCheck className="h-4 w-4 text-emerald-700" aria-hidden="true" />Quality (QA)</span>
      <span>Average score <b className="tabular-nums">{formatValue(quality.avgScore, "pct")}</b></span>
      <span>Audits <b className="tabular-nums">{quality.audits ?? 0}</b></span>
      <span>Fatal <b className={`tabular-nums ${(quality.fatal ?? 0) > 0 ? "text-red-800" : ""}`}>{quality.fatal ?? 0}</b></span>
    </div>
  );
}
