import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import { fetchAgents } from "../api";
import { DASH, formatValue } from "../format";
import { Empty, ErrorBox, FOCUS, Skeleton } from "../ui";
import type { DashUrlState } from "../urlState";
import { StatusChip } from "./status";
import type { ForecastKpi, ForecastResponse } from "./types";

function TlAgents({ processId, tl, kpi, data, state, onAgent }: { processId: string; tl: string; kpi: ForecastKpi; data: ForecastResponse; state: DashUrlState; onAgent: (code: string) => void }) {
  const to = data.asOf ?? data.range.to;
  const q = useQuery({
    queryKey: ["process-dashboard", processId, "forecast-agents", tl, data.range.from, to, kpi.key, state.lob],
    queryFn: () => fetchAgents(processId, { ...state, tl: tl === "Unassigned" ? "Unassigned" : tl, from: data.range.from, to, q: "", sort: kpi.key, dir: "desc", page: 1 }),
  });
  if (q.isLoading) return <Skeleton className="h-16" />;
  if (q.isError) return <ErrorBox message="Could not load this team's agents." onRetry={() => void q.refetch()} />;
  const rows = q.data?.rows ?? [];
  if (!rows.length) return <Empty>No agents for this team in the month so far.</Empty>;
  return (
    <ul aria-label={`Agents of ${tl}, month to date by ${kpi.label}`} className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
      {rows.map((a) => (
        <li key={a.agentCode}>
          <button type="button" onClick={() => onAgent(a.agentCode)} aria-label={`Open ${a.name ?? a.agentCode}`} className={`flex min-h-[40px] w-full cursor-pointer items-center justify-between gap-2 px-3 py-1.5 text-left text-xs hover:bg-slate-50 ${FOCUS}`}>
            <span className="min-w-0 truncate font-semibold text-blue-800">{a.name ?? a.agentCode} <span className="font-normal text-slate-600">{a.agentCode}</span></span>
            <span className="shrink-0 tabular-nums text-slate-900">{kpi.label} {formatValue(typeof a[kpi.key] === "number" ? (a[kpi.key] as number) : null, kpi.unit)}</span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function TlPacingTable({ processId, data, kpiKey, state, onAgent, onTl }: { processId: string; data: ForecastResponse; kpiKey: string; state: DashUrlState; onAgent: (code: string) => void; onTl: (tl: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const head = data.kpis.find((k) => k.key === kpiKey);
  if (!head) return null;
  const rows = data.byTl.map((t) => ({ t, k: t.kpis.find((x) => x.key === kpiKey) })).filter((r): r is { t: ForecastResponse["byTl"][number]; k: ForecastKpi } => !!r.k);
  if (!rows.length) return <Empty>No team-leader breakdown for this month.</Empty>;
  const th = "whitespace-nowrap px-3 py-2 text-right font-semibold";
  return (
    <div className="overflow-x-auto rounded-xl border border-slate-200 bg-white">
      <table className="w-full text-xs">
        <caption className="sr-only">{`Pacing by team leader for ${head.label}, ${data.month}`}</caption>
        <thead className="bg-slate-50 text-slate-700"><tr>
          <th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold">Team leader</th>
          <th scope="col" className={th}>Agents</th><th scope="col" className={th}>Month to date</th><th scope="col" className={th}>Projected</th>
          <th scope="col" className={th}>Range</th><th scope="col" className={th}>vs target</th><th scope="col" className={th}>Needed / day</th><th scope="col" className="whitespace-nowrap px-3 py-2 text-left font-semibold">Status</th>
        </tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(({ t, k }) => {
            const isOpen = open === t.tl; const id = `tl-${t.tl.replace(/\W+/g, "_")}`;
            return [
              <tr key={t.tl} className="hover:bg-slate-50">
                <th scope="row" className="whitespace-nowrap px-3 py-1.5 text-left font-semibold text-slate-900">
                  <button type="button" aria-expanded={isOpen} aria-controls={id} onClick={() => setOpen(isOpen ? null : t.tl)} className={`inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded text-blue-800 ${FOCUS}`}>
                    {isOpen ? <ChevronDown className="h-4 w-4" aria-hidden="true" /> : <ChevronRight className="h-4 w-4" aria-hidden="true" />}{t.tl}
                  </button>
                </th>
                <td className="px-3 py-1.5 text-right tabular-nums">{t.agents}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{formatValue(k.mtd, k.unit)}</td>
                <td className="px-3 py-1.5 text-right font-semibold tabular-nums">{formatValue(k.projected, k.unit)}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-slate-700">{k.band ? `${formatValue(k.band.low, k.unit)} to ${formatValue(k.band.high, k.unit)}` : DASH}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{k.pacingPct === null ? DASH : `${k.pacingPct.toFixed(0)}%`}</td>
                <td className="px-3 py-1.5 text-right tabular-nums">{k.requiredDailyRate === null ? DASH : formatValue(k.requiredDailyRate, k.unit)}</td>
                <td className="px-3 py-1.5"><StatusChip status={k.status} /></td>
              </tr>,
              isOpen && (
                <tr key={`${t.tl}-x`}><td colSpan={8} className="bg-slate-50 px-3 py-2">
                  <div id={id} className="space-y-2">
                    <button type="button" onClick={() => onTl(t.tl)} className={`inline-flex min-h-[32px] cursor-pointer items-center gap-1 rounded-lg border border-slate-300 bg-white px-2 text-xs font-semibold text-slate-800 hover:bg-slate-50 ${FOCUS}`}><Filter className="h-3.5 w-3.5" aria-hidden="true" />Filter whole dashboard to {t.tl}</button>
                    <TlAgents processId={processId} tl={t.tl} kpi={head} data={data} state={state} onAgent={onAgent} />
                  </div>
                </td></tr>
              ),
            ];
          })}
        </tbody>
      </table>
    </div>
  );
}
