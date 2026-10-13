/**
 * Molecular Email Dashboard (MOL-01..MOL-06) — its own module, no longer a tab of
 * the Reginald dashboard (REG-07). Sections: Overview, Daily / Agents, Tickets.
 * Filters (date range on ticket created date, agent, category, status, priority,
 * TAT bucket, SLA hours) apply to every section, so each KPI reconciles to the
 * ticket table.
 */
import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MolecularOverviewSection } from "./MolecularOverviewSection";
import { MolecularAgentSection } from "./MolecularAgentSection";
import { MolecularTicketTable } from "./MolecularTicketTable";
import { defaultFilters, molApi, MOLECULAR_ROUTE, MOLECULAR_TITLE, TAT_BUCKETS, type MolFilters } from "./molecularApi";

type Section = "overview" | "agents" | "tickets";
const SECTIONS: { key: Section; label: string }[] = [
  { key: "overview", label: "Overview" },
  { key: "agents", label: "Daily / Agents" },
  { key: "tickets", label: "Tickets" },
];

function Select({ label, value, onChange, options, disabledHint }: {
  label: string; value: string; onChange: (v: string) => void;
  options: { value: string; label: string }[]; disabledHint?: string;
}) {
  const disabled = !!disabledHint;
  return (
    <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600" title={disabledHint}>
      {label}
      <select value={value} disabled={disabled} onChange={(e) => onChange(e.target.value)}
        className="h-8 min-w-28 rounded-md border border-slate-300 bg-white px-2 font-normal text-slate-800 disabled:bg-slate-100">
        <option value="">{disabled ? "N/A" : "All"}</option>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </label>
  );
}

export function MolecularEmailDashboard({ initialFrom, initialTo, showTitle = true }: {
  initialFrom?: string; initialTo?: string; showTitle?: boolean;
}) {
  const [f, setF] = useState<MolFilters>(() => defaultFilters(initialFrom, initialTo));
  const [section, setSection] = useState<Section>("overview");
  const opts = useQuery({ queryKey: ["mol", "filter-options"], queryFn: molApi.filterOptions, staleTime: 5 * 60_000 });
  const set = (patch: Partial<MolFilters>) => setF((p) => ({ ...p, ...patch }));
  const o = opts.data;
  const toOpts = (xs: string[] | undefined) => (xs ?? []).map((x) => ({ value: x, label: x }));

  return (
    <div className="space-y-4">
      {showTitle && (
        <div>
          <h2 className="text-lg font-extrabold text-slate-900">{MOLECULAR_TITLE}</h2>
          <p className="text-xs text-slate-500">
            Molecular email tickets (unique ticket IDs, synced from the Molecular ticketing system) with agent time from the MOEMAIL dialler campaign.
          </p>
        </div>
      )}

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
          Received from
          <input type="date" value={f.from} max={f.to} onChange={(e) => e.target.value && set({ from: e.target.value })} className="h-8 rounded-md border border-slate-300 px-2 font-normal" />
        </label>
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
          to
          <input type="date" value={f.to} min={f.from} onChange={(e) => e.target.value && set({ to: e.target.value })} className="h-8 rounded-md border border-slate-300 px-2 font-normal" />
        </label>
        <Select label="Agent" value={f.agent} onChange={(v) => set({ agent: v })} options={toOpts(o?.agents)} />
        <Select label="Category / Queue" value={f.category} onChange={(v) => set({ category: v })} options={toOpts(o?.categories)}
          disabledHint={o && o.categories.length === 0 ? "Category is not available in the Molecular source" : undefined} />
        <Select label="Status" value={f.status} onChange={(v) => set({ status: v as MolFilters["status"] })}
          options={[{ value: "open", label: "Pending / Open" }, { value: "closed", label: "Closed" }, { value: "reopened", label: "Reopened" }]} />
        <Select label="Priority" value={f.priority} onChange={(v) => set({ priority: v })} options={toOpts(o?.priorities)}
          disabledHint={o && o.priorities.length === 0 ? "Priority is not available in the Molecular source" : undefined} />
        <Select label="TAT bucket" value={f.tatBucket} onChange={(v) => set({ tatBucket: v as MolFilters["tatBucket"] })}
          options={TAT_BUCKETS.map((b) => ({ value: b, label: b }))} />
        <label className="flex flex-col gap-0.5 text-xs font-semibold text-slate-600">
          SLA (hours)
          <input type="number" min={1} max={720} value={f.slaHours}
            onChange={(e) => { const v = Number(e.target.value); if (v > 0 && v <= 720) set({ slaHours: v }); }}
            className="h-8 w-20 rounded-md border border-slate-300 px-2 font-normal" />
        </label>
        <button type="button" onClick={() => setF(defaultFilters(f.from, f.to))} className="h-8 rounded-md border border-slate-300 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
          Clear filters
        </button>
      </div>

      <div className="flex gap-1">
        {SECTIONS.map((s) => (
          <button key={s.key} type="button" onClick={() => setSection(s.key)}
            className={`h-8 rounded-lg px-3 text-xs font-bold ${section === s.key ? "bg-slate-800 text-white" : "bg-slate-100 text-slate-700 hover:bg-slate-200"}`}>
            {s.label}
          </button>
        ))}
      </div>

      {section === "overview" && <MolecularOverviewSection f={f} onDrill={(patch) => { set(patch); setSection("tickets"); }} />}
      {section === "agents" && <MolecularAgentSection f={f} />}
      {section === "tickets" && <MolecularTicketTable f={f} />}
    </div>
  );
}

/**
 * What the Reginald dashboard shows where its "Molecular Email" tab used to be:
 * a link, no Molecular data (REG-07), so the old entry point still leads there.
 */
export function MolecularMovedLink({ compact = false }: { compact?: boolean }) {
  return (
    <Link to={MOLECULAR_ROUTE}
      title="Molecular Email moved out of Reginald into its own dashboard"
      className={compact
        ? "inline-flex items-center rounded-lg px-3 py-1.5 text-xs font-extrabold text-sky-200 hover:bg-white/10 hover:text-white"
        : "inline-flex items-center rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs font-bold text-sky-800 hover:bg-sky-100"}>
      {MOLECULAR_TITLE} →
    </Link>
  );
}

export default MolecularEmailDashboard;
