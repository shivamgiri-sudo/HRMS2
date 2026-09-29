import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Loader2, Search, Users } from "lucide-react";
import { hrmsApi, type HrmsEnvelope } from "@/lib/hrmsApi";
import { formatValue } from "./kpi-deck-model";

interface Analyst { employeeId: string; employeeCode: string; name: string; teamLeader: { employeeCode: string; name: string } | null; values: Array<number | null>; average: number | null }
interface Team { key: string; name: string; employeeCode: string | null; analysts: number; values: Array<number | null>; average: number | null }
interface Grid { available: boolean; reason: string | null; metricName: string | null; unit: string | null; direction: string | null; targetValue: number | null; dates: string[]; analysts: Analyst[]; teams: Team[]; truncated: boolean }

const CARD = "rounded-2xl border border-slate-200 bg-white shadow-sm dark:border-slate-800 dark:bg-slate-900";

function cellStyle(v: number | null, target: number | null, direction: string | null): { bg: string; fg: string } {
  if (v === null) return { bg: "transparent", fg: "#94a3b8" };
  if (target === null || !direction) return { bg: "#e2e8f0", fg: "#334155" };
  const ok = direction === "higher_is_better" ? v >= target : v <= target;
  return ok ? { bg: "#d1fae5", fg: "#065f46" } : { bg: "#ffe4e6", fg: "#9f1239" };
}

/** Metric by person / by team leader for each recent day. Loaded on request because it recomputes the metric per day. */
export function MetricDayGrid({ processId, metricKey }: { processId: string; metricKey: string }) {
  const [enabled, setEnabled] = useState(false);
  const [days, setDays] = useState(7);
  const [mode, setMode] = useState<"people" | "teams">("teams");
  const [q, setQ] = useState("");
  const { data, isFetching, isError, refetch } = useQuery({
    queryKey: ["process-operations", "day-analyst-grid", processId, metricKey, days],
    queryFn: () => hrmsApi.get<HrmsEnvelope<Grid>>(`/api/process-operations/${processId}/metric/${metricKey}/day-analyst-grid?days=${days}`, 290_000),
    enabled: enabled,
    staleTime: 5 * 60_000,
  });
  const g = data?.data;
  const rows = useMemo(() => {
    if (!g?.available) return [];
    const s = q.trim().toLowerCase();
    if (mode === "teams") return g.teams.filter((t) => !s || t.name.toLowerCase().includes(s)).map((t) => ({ id: t.key, title: t.name, sub: `${t.analysts} analyst${t.analysts === 1 ? "" : "s"}`, values: t.values, avg: t.average }));
    return g.analysts.filter((a) => !s || a.name.toLowerCase().includes(s) || a.employeeCode.toLowerCase().includes(s) || (a.teamLeader?.name ?? "").toLowerCase().includes(s))
      .map((a) => ({ id: a.employeeId, title: a.name, sub: `${a.employeeCode}${a.teamLeader ? ` · TL ${a.teamLeader.name}` : ""}`, values: a.values, avg: a.average }));
  }, [g, mode, q]);

  return (
    <section aria-label="By person and team leader, day by day" className={`${CARD} p-4`}>
      <div className="flex flex-wrap items-center gap-3">
        <Users className="h-4 w-4 text-blue-600" aria-hidden />
        <h3 className="text-sm font-extrabold text-slate-900 dark:text-slate-100">Who drove it: people and team leaders, day by day</h3>
        {!enabled && (
          <button type="button" onClick={() => setEnabled(true)} className="ml-auto rounded-xl bg-slate-900 px-4 py-2 text-xs font-bold text-amber-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500">Load day-by-day breakdown</button>
        )}
      </div>
      {!enabled && <p className="mt-2 text-xs text-slate-500">Recomputes this metric for every person on each recent day, then rolls them up to team leaders. It can take a minute the first time.</p>}
      {enabled && isFetching && !g && <p className="mt-3 flex items-center gap-2 text-sm text-slate-500"><Loader2 className="h-4 w-4 animate-spin" />Recomputing {days} days per person… this can take up to a few minutes on large audit data.</p>}
      {enabled && isError && (
        <div role="alert" className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" aria-hidden />Could not compute the breakdown.</span>
          <button type="button" onClick={() => refetch()} className="rounded-lg bg-rose-600 px-3 py-1 text-xs font-bold text-white">Retry</button>
        </div>
      )}
      {g && !g.available && <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700 dark:bg-slate-800/60 dark:text-slate-200">{g.reason}</p>}
      {g?.available && (
        <div className="mt-3 space-y-3">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex gap-1 rounded-xl bg-slate-100 p-1 dark:bg-slate-800" role="group" aria-label="Group by">
              {([["teams", "Team leaders"], ["people", "People"]] as const).map(([k, l]) => (
                <button key={k} type="button" aria-pressed={mode === k} onClick={() => setMode(k)} className={`rounded-lg px-3 py-1.5 text-xs font-bold ${mode === k ? "bg-slate-900 text-amber-300" : "text-slate-600 dark:text-slate-300"}`}>{l}</button>
              ))}
            </div>
            <label className="relative min-w-[180px] flex-1">
              <span className="sr-only">Search</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden />
              <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={mode === "teams" ? "Search team leader…" : "Search person, code or team leader…"} className="h-9 w-full rounded-xl border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-500 dark:border-slate-700 dark:bg-slate-900" />
            </label>
            <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 dark:text-slate-300">Days
              <select value={days} onChange={(e) => setDays(Number(e.target.value))} className="h-9 rounded-xl border border-slate-200 bg-white px-2 text-sm dark:border-slate-700 dark:bg-slate-900">
                {[5, 7, 10, 14].map((d) => <option key={d} value={d}>{d}</option>)}
              </select>
            </label>
          </div>
          <div className="max-h-[32rem] overflow-auto rounded-xl border border-slate-200 dark:border-slate-800">
            <table className="w-full min-w-[560px] border-collapse text-xs">
              <thead className="sticky top-0 z-10 bg-slate-50 text-slate-500 dark:bg-slate-800">
                <tr>
                  <th className="sticky left-0 z-10 bg-slate-50 px-3 py-2 text-left font-semibold dark:bg-slate-800">{mode === "teams" ? "Team leader" : "Person"} <span className="font-normal text-slate-400">(worst first)</span></th>
                  <th className="px-2 py-2 text-right font-semibold">Average</th>
                  {g.dates.map((d) => <th key={d} className="px-1 py-2 text-center font-semibold" title={d}>{d.slice(5)}</th>)}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const a = cellStyle(r.avg, g.targetValue, g.direction);
                  return (
                    <tr key={r.id} className="border-t border-slate-100 dark:border-slate-800">
                      <th scope="row" className="sticky left-0 bg-white px-3 py-1.5 text-left font-normal dark:bg-slate-900">
                        <span className="block text-[13px] font-semibold text-slate-900 dark:text-slate-100">{r.title}</span>
                        <span className="block text-[11px] text-slate-500">{r.sub}</span>
                      </th>
                      <td className="px-2 py-1.5 text-right font-extrabold tabular-nums" style={{ color: a.fg }}>{formatValue(r.avg, g.unit)}</td>
                      {r.values.map((v, i) => {
                        const c = cellStyle(v, g.targetValue, g.direction);
                        return <td key={i} className="px-1 py-1 text-center tabular-nums" style={{ background: c.bg, color: c.fg }} title={`${g.dates[i]}: ${v === null ? "no reading" : formatValue(v, g.unit)}`}>{v === null ? "·" : formatValue(v, g.unit).replace("%", "")}</td>;
                      })}
                    </tr>
                  );
                })}
                {rows.length === 0 && <tr><td colSpan={g.dates.length + 2} className="p-6 text-center text-slate-400">Nobody matches this search.</td></tr>}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-slate-500">
            {g.targetValue !== null ? <>Green met the target of {formatValue(g.targetValue, g.unit)}, red missed it. </> : "No target is set, so cells are not coloured pass/fail. "}
            Team-leader figures are the plain average of their people that day (each person counts equally, whatever their volume).
            {g.truncated && " Showing the 150 people with the most readings."}
          </p>
        </div>
      )}
    </section>
  );
}
