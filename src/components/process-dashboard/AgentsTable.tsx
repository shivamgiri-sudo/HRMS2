import { useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Columns3 } from "lucide-react";
import { DASH, formatValue, humanize } from "./format";
import { Empty, FOCUS, Panel, Skeleton, Sparkline, btn, loadPref, savePref } from "./ui";
import { PAGE_SIZE } from "./api";
import type { AgentRow, Kpi, Overview } from "./types";
import type { DashUrlState } from "./urlState";

export interface AgentCol { key: string; label: string; unit?: string; available?: boolean }

/** Unit fallback for columns the KPI list does not carry (the profile lists column keys only). Canonical metric naming, not per-client. */
export function guessUnit(key: string): string | undefined {
  if (/(_rate|utilization|occupancy|conversion|qa_score)$/.test(key)) return "percent";
  if (key === "aht" || /_sec$/.test(key)) return "seconds";
  if (/_hours?$|_hr$/.test(key)) return "hours";
  if (key === "amount") return "currency";
  return undefined;
}

/** Columns come from the category profile (strings or {key,label,unit}) when present, else from the KPI list: never hard-coded per client. */
export function resolveColumns(overview?: Overview): AgentCol[] {
  const kpis = overview?.kpis ?? [];
  const prof = overview?.categoryProfile?.columns as Array<string | AgentCol> | undefined;
  if (prof?.length) {
    return prof.filter((c) => typeof c === "string" || c.available !== false).filter((c) => (typeof c === "string" ? c : c.key) !== "qa_score").map((c) => {
      if (typeof c !== "string") return { key: c.key, label: c.label, unit: c.unit ?? guessUnit(c.key) };
      const k = kpis.find((x) => x.key === c);
      return { key: c, label: k?.label ?? humanize(c), unit: k?.unit ?? guessUnit(c) };
    });
  }
  return kpis.filter((k) => k.available !== false && k.key !== "qa_score").map((k: Kpi) => ({ key: k.key, label: k.label, unit: k.unit }));
}

export function AgentsTable({ rows, total, loading, cols, state, onChange, onAgent, storageKey }: {
  rows: AgentRow[]; total: number; loading: boolean; cols: AgentCol[]; state: DashUrlState; onChange: (p: Partial<DashUrlState>) => void; onAgent: (code: string) => void; storageKey: string;
}) {
  const [hidden, setHidden] = useState<string[]>(() => loadPref<string[]>(storageKey, []));
  const [chooser, setChooser] = useState(false);
  const visible = useMemo(() => cols.filter((c) => !hidden.includes(c.key)), [cols, hidden]);
  const toggleCol = (k: string) => { const next = hidden.includes(k) ? hidden.filter((h) => h !== k) : [...hidden, k]; setHidden(next); savePref(storageKey, next); };
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const sortBy = (key: string) => onChange(state.sort === key ? { dir: state.dir === "desc" ? "asc" : "desc", page: 1 } : { sort: key, dir: ["rank", "name", "tl"].includes(key) ? "asc" : "desc", page: 1 });
  const Th = ({ k, label, left }: { k: string; label: string; left?: boolean }) => {
    const on = state.sort === k;
    return <th scope="col" aria-sort={on ? (state.dir === "asc" ? "ascending" : "descending") : "none"} className={`whitespace-nowrap px-3 py-2 font-semibold ${left ? "text-left" : "text-right"}`}>
      <button type="button" onClick={() => sortBy(k)} className={`inline-flex cursor-pointer items-center gap-1 rounded hover:text-slate-950 ${FOCUS}`}>{label}
        {on ? (state.dir === "asc" ? <ArrowUp className="h-3 w-3" aria-hidden="true" /> : <ArrowDown className="h-3 w-3" aria-hidden="true" />) : <ArrowUpDown className="h-3 w-3 opacity-50" aria-hidden="true" />}</button></th>;
  };
  return (
    <Panel title={`Agents${total ? ` (${total.toLocaleString("en-IN")})` : ""}`} action={
      <div className="relative">
        <button type="button" onClick={() => setChooser((v) => !v)} aria-expanded={chooser} aria-controls="pd-col-chooser" className={btn}><Columns3 className="h-3.5 w-3.5" aria-hidden="true" />Columns</button>
        {chooser && (
          <fieldset id="pd-col-chooser" className="absolute right-0 z-20 mt-1 max-h-72 w-56 overflow-y-auto rounded-xl border border-slate-200 bg-white p-2 shadow-lg" onKeyDown={(e) => e.key === "Escape" && setChooser(false)}>
            <legend className="sr-only">Choose visible columns</legend>
            {cols.map((c) => <label key={c.key} className="flex min-h-[32px] cursor-pointer items-center gap-2 rounded px-2 text-xs text-slate-900 hover:bg-slate-50">
              <input type="checkbox" checked={!hidden.includes(c.key)} onChange={() => toggleCol(c.key)} className={FOCUS} />{c.label}</label>)}
          </fieldset>
        )}
      </div>}>
      {loading && rows.length === 0 ? <Skeleton className="h-64" /> : rows.length === 0 ? <Empty>No agents match these filters.</Empty> : (
        <>
          <div className="overflow-x-auto rounded-xl border border-slate-200" style={{ opacity: loading ? 0.6 : 1 }} aria-busy={loading}>
            <table className="w-full text-xs">
              <caption className="sr-only">Agents with metrics for the selected range. Select an agent name to open details.</caption>
              <thead className="bg-slate-50 text-slate-700"><tr>
                <Th k="rank" label="Rank" left /><Th k="name" label="Agent" left /><Th k="tl" label="Team leader" left />
                {visible.map((c) => <Th key={c.key} k={c.key} label={c.label} />)}
                <Th k="qa_score" label="QA" /><th scope="col" className="px-3 py-2 text-right font-semibold">Trend</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {rows.map((r) => (
                  <tr key={r.agentCode} className="hover:bg-slate-50">
                    <td className="px-3 py-1.5 tabular-nums text-slate-700">{r.rank ?? DASH}</td>
                    <td className="whitespace-nowrap px-3 py-1.5"><button type="button" onClick={() => onAgent(r.agentCode)} className={`cursor-pointer rounded text-left font-semibold text-blue-800 hover:underline ${FOCUS}`}>{r.name ?? r.agentCode}</button><span className="ml-1 text-[10px] text-slate-600">{r.agentCode}</span></td>
                    <td className="whitespace-nowrap px-3 py-1.5 text-slate-700">{String(r.tlName ?? r.tl ?? DASH)}</td>
                    {visible.map((c) => <td key={c.key} className="whitespace-nowrap px-3 py-1.5 text-right tabular-nums text-slate-800">{typeof r[c.key] === "number" ? formatValue(r[c.key] as number, c.unit) : DASH}</td>)}
                    <td className="px-3 py-1.5 text-right tabular-nums text-slate-800">{formatValue((r.qaScore ?? r.qa_score) as number | null | undefined, "percent")}</td>
                    <td className="px-3 py-1.5 text-right"><Sparkline points={r.spark} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <nav aria-label="Agents pagination" className="mt-2 flex items-center justify-between gap-2 text-xs text-slate-700">
            <span>Page {state.page} of {pages}{state.sort ? ` · sorted by ${humanize(state.sort)} ${state.dir === "asc" ? "ascending" : "descending"}` : ""}</span>
            <span className="flex gap-1.5">
              <button type="button" disabled={state.page <= 1} onClick={() => onChange({ page: state.page - 1 })} className={btn} aria-label="Previous page"><ChevronLeft className="h-4 w-4" aria-hidden="true" /></button>
              <button type="button" disabled={state.page >= pages} onClick={() => onChange({ page: state.page + 1 })} className={btn} aria-label="Next page"><ChevronRight className="h-4 w-4" aria-hidden="true" /></button>
            </span>
          </nav>
        </>
      )}
    </Panel>
  );
}
