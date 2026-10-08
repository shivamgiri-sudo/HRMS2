import { useEffect, useState } from "react";
import { Search, X } from "lucide-react";
import { PRESETS, detectPreset, presetRange, type DashUrlState } from "./urlState";
import { FOCUS } from "./ui";
import type { BreakdownRow } from "./types";

const field = `min-h-[36px] rounded-lg border border-slate-300 bg-white px-2.5 py-1.5 text-xs text-slate-900 ${FOCUS}`;

interface Props { state: DashUrlState; tls: BreakdownRow[]; lobs: BreakdownRow[]; onChange: (patch: Partial<DashUrlState>) => void }

export function FiltersBar({ state, tls, lobs, onChange }: Props) {
  const preset = detectPreset(state.from, state.to);
  const [q, setQ] = useState(state.q);
  useEffect(() => setQ(state.q), [state.q]);
  useEffect(() => { if (q === state.q) return undefined; const t = setTimeout(() => onChange({ q, page: 1 }), 350); return () => clearTimeout(t); }, [q]); // eslint-disable-line react-hooks/exhaustive-deps
  const tlNames = Array.from(new Set([...tls.map((r) => r.tl).filter(Boolean) as string[], ...(state.tl ? [state.tl] : [])]));
  const lobNames = Array.from(new Set([...lobs.map((r) => r.lob).filter(Boolean) as string[], ...(state.lob ? [state.lob] : [])]));
  return (
    <div role="search" aria-label="Dashboard filters" className="flex flex-wrap items-end gap-2 rounded-2xl border border-slate-200 bg-white p-3">
      <div role="group" aria-label="Date presets" className="flex flex-wrap gap-1">
        {PRESETS.map((p) => (
          <button key={p.key} type="button" aria-pressed={preset === p.key} onClick={() => onChange({ ...presetRange(p.key), page: 1 })}
            className={`min-h-[36px] cursor-pointer rounded-lg px-2.5 text-xs font-semibold ${FOCUS} ${preset === p.key ? "bg-blue-700 text-white" : "bg-slate-100 text-slate-800 hover:bg-slate-200"}`}>{p.label}</button>
        ))}
      </div>
      <label className="text-[11px] font-medium text-slate-700">From<input type="date" value={state.from} max={state.to} onChange={(e) => e.target.value && onChange({ from: e.target.value, page: 1 })} className={`${field} ml-1`} /></label>
      <label className="text-[11px] font-medium text-slate-700">To<input type="date" value={state.to} min={state.from} onChange={(e) => e.target.value && onChange({ to: e.target.value, page: 1 })} className={`${field} ml-1`} /></label>
      <label className="text-[11px] font-medium text-slate-700">Team leader
        <select value={state.tl} onChange={(e) => onChange({ tl: e.target.value, page: 1 })} className={`${field} ml-1 cursor-pointer`}>
          <option value="">All</option>{tlNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="text-[11px] font-medium text-slate-700">LOB
        <select value={state.lob} onChange={(e) => onChange({ lob: e.target.value, page: 1 })} className={`${field} ml-1 cursor-pointer`}>
          <option value="">All</option>{lobNames.map((n) => <option key={n} value={n}>{n}</option>)}</select></label>
      <label className="relative min-w-[160px] flex-1 text-[11px] font-medium text-slate-700"><span className="sr-only">Search agents</span>
        <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" aria-hidden="true" />
        <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search agent name or code" className={`${field} w-full pl-8`} /></label>
      {(state.tl || state.lob || state.q) && (
        <button type="button" onClick={() => { setQ(""); onChange({ tl: "", lob: "", q: "", page: 1 }); }} className={`inline-flex min-h-[36px] cursor-pointer items-center gap-1 rounded-lg px-2 text-xs font-semibold text-blue-800 hover:bg-blue-50 ${FOCUS}`}><X className="h-3.5 w-3.5" aria-hidden="true" />Clear filters</button>
      )}
    </div>
  );
}
