import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";
import { useHierarchyFilters } from "./useHierarchyFilters";
import { CoachingDetail } from "@/components/coaching/CoachingDetail";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  DASH, EmptyNote, GranularityPills, SectionCard, describePeriod, fmtInt, fmtNum, fmtPct, presetRange, type DateRange, type Granularity,
} from "./onfidoReportShared";
import { OcDataTable, type OcColumn } from "./OcDataTable";

/**
 * Analyst Performance tab in the 23-Sep-26 format ("Analyst Performance.xlsx"), replacing the
 * earlier leaderboard / profile layout. One row per analyst who completed a DOC or POA task in
 * the period. Daily / Weekly / Monthly set the period ending on the Till date; From and Till
 * can also be edited directly. UL is Unplanned Leave (the only per-analyst UL any upload has).
 */

interface RateCell { errors: number; audits: number; errorPct: number | null }
type Stage = "classification" | "extraction" | "ewys" | "ewysAddress" | "labelling" | "poa" | "overall";
interface AnalystRow {
  analyst: string; tlName: string | null; amName: string | null;
  docTasks: number; docAht: number | null; poaTasks: number; poaAht: number | null;
  cre: number; crq: number; etm: number; taskSkip: number;
  unplannedLeaveDays: number | null; scheduledDays: number | null;
  internal: Record<Stage, RateCell>;
  external: Record<Exclude<Stage, "labelling">, RateCell>;
}

const INTERNAL_COLUMNS: { key: Stage; label: string }[] = [
  { key: "classification", label: "Classification" }, { key: "extraction", label: "Extraction" }, { key: "ewys", label: "EWYS" },
  { key: "ewysAddress", label: "EWYS Address" }, { key: "labelling", label: "Labelling" }, { key: "poa", label: "POA" },
];
const EXTERNAL_COLUMNS: { key: Exclude<Stage, "labelling">; label: string }[] = [
  { key: "classification", label: "Classification" }, { key: "extraction", label: "Extraction" }, { key: "ewys", label: "EWYS" },
  { key: "ewysAddress", label: "EWYS Address" }, { key: "poa", label: "POA" },
];

const todayIso = () => new Date().toISOString().slice(0, 10);

function cellPct(c: RateCell): string {
  return c.audits > 0 ? fmtPct(c.errorPct) : DASH;
}

export default function OnfidoAnalystReport({ initialRange }: { initialRange: DateRange }) {
  const [granularity, setGranularity] = useState<Granularity>("monthly");
  const [range, setRange] = useState<DateRange>(initialRange);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<AnalystRow | null>(null);
  const { tlFilter, setTlFilter, amFilter, setAmFilter, tlOptions: filteredTlNames, amOptions } = useHierarchyFilters(range);

  const report = useQuery({
    queryKey: ["onfido-process", "analyst-report", range, tlFilter, amFilter],
    queryFn: () => {
      let url = `/api/onfido-process/analyst-report?from=${range.from}&to=${range.to}`;
      if (tlFilter) url += `&tlName=${encodeURIComponent(tlFilter)}`;
      if (amFilter) url += `&amName=${encodeURIComponent(amFilter)}`;
      return hrmsApi.get<{ data: { from: string; to: string; rows: AnalystRow[] } }>(url);
    },
    enabled: range.from !== "" && range.to !== "" && range.from <= range.to,
  });
  const rows = useMemo(() => {
    const all = report.data?.data.rows ?? [];
    const needle = search.trim().toLowerCase();
    return needle ? all.filter((r) => r.analyst.toLowerCase().includes(needle)) : all;
  }, [report.data, search]);

  const rangeInvalid = range.from > range.to;
  return (
    <SectionCard title="Analyst Performance" accent="var(--blue)"
      subtitle="One row per analyst. Quality columns are error % (errors / audits); - means no data for that analyst in the period. Click a row for the full breakdown.">
      <div className="oc-filterbar" style={{ marginBottom: 12 }}>
        <div className="oc-field">
          <label>Range</label>
          <GranularityPills value={granularity} onChange={(g) => { setGranularity(g); setRange(presetRange(range.to || todayIso(), g)); }} />
        </div>
        <div className="oc-field">
          <label htmlFor="ar-from">From</label>
          <input id="ar-from" type="date" className="oc-input" value={range.from} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} />
        </div>
        <div className="oc-field">
          <label htmlFor="ar-till">Till</label>
          <input id="ar-till" type="date" className="oc-input" value={range.to} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} />
        </div>
        <div className="oc-field">
          <label htmlFor="ar-am">AM</label>
          <select
            id="ar-am"
            className="oc-select"
            value={amFilter}
            onChange={(e) => setAmFilter(e.target.value)}
          >
            <option value="">All AMs</option>
            {amOptions.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="oc-field">
          <label htmlFor="ar-tl">TL</label>
          <select
            id="ar-tl"
            className="oc-select"
            value={tlFilter}
            onChange={(e) => setTlFilter(e.target.value)}
          >
            <option value="">All TLs</option>
            {filteredTlNames.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <div className="oc-field">
          <label htmlFor="ar-search">Analyst</label>
          <input id="ar-search" type="search" className="oc-input" placeholder="Search by email" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
      </div>

      {!rangeInvalid && (
        <div style={{ marginBottom: 8, fontSize: 12, color: "var(--muted)" }} data-testid="ar-period">Showing: {describePeriod(range, granularity)}</div>
      )}
      {rangeInvalid && <EmptyNote>From must not be after Till.</EmptyNote>}
      {!rangeInvalid && report.isLoading && <EmptyNote>Loading...</EmptyNote>}
      {!rangeInvalid && report.error instanceof Error && <EmptyNote>Could not load analysts: {report.error.message}</EmptyNote>}
      {!rangeInvalid && !report.isLoading && !report.error && (
        <div style={{ overflowX: "auto" }}>
          <table className="oc-table">
            <thead>
              <tr>
                <th rowSpan={2}>Analyst Name</th><th rowSpan={2} className="oc-right">Doc AHT</th><th rowSpan={2} className="oc-right">POA AHT</th>
                <th rowSpan={2} className="oc-right">CRE</th><th rowSpan={2} className="oc-right">CRQ</th><th rowSpan={2} className="oc-right">ETM</th>
                <th rowSpan={2} className="oc-right">Task Skip</th><th rowSpan={2} className="oc-right" title="Unplanned leave days">UL</th>
                <th rowSpan={2} className="oc-right" title="Internal + external errors / audits">Overall Error %</th>
                <th colSpan={INTERNAL_COLUMNS.length} className="oc-right">Internal Quality</th>
                <th colSpan={EXTERNAL_COLUMNS.length} className="oc-right">External Quality</th>
              </tr>
              <tr>
                {INTERNAL_COLUMNS.map((c) => <th key={`i-${c.key}`} className="oc-right">{c.label}</th>)}
                {EXTERNAL_COLUMNS.map((c) => <th key={`e-${c.key}`} className="oc-right">{c.label}</th>)}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && <tr className="oc-empty-row"><td colSpan={9 + INTERNAL_COLUMNS.length + EXTERNAL_COLUMNS.length}>No analysts with completed tasks in this period</td></tr>}
              {rows.map((r) => (
                <tr key={r.analyst} className="oc-row-click" onClick={() => setSelected(r)}>
                  <td>{r.analyst}</td>
                  <td className="oc-right">{r.docAht === null ? DASH : `${fmtInt(r.docAht)}s`}</td>
                  <td className="oc-right">{r.poaAht === null ? DASH : `${fmtInt(r.poaAht)}s`}</td>
                  <td className="oc-right">{fmtInt(r.cre)}</td><td className="oc-right">{fmtInt(r.crq)}</td>
                  <td className="oc-right">{fmtInt(r.etm)}</td><td className="oc-right">{fmtInt(r.taskSkip)}</td>
                  <td className="oc-right">{r.unplannedLeaveDays === null ? DASH : fmtNum(r.unplannedLeaveDays, 1)}</td>
                  <td className="oc-right">{overallErrorPct(r)}</td>
                  {INTERNAL_COLUMNS.map((c) => <td key={`i-${c.key}`} className="oc-right">{cellPct(r.internal[c.key])}</td>)}
                  {EXTERNAL_COLUMNS.map((c) => <td key={`e-${c.key}`} className="oc-right">{cellPct(r.external[c.key])}</td>)}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AnalystDrawer row={selected} range={range} onClose={() => setSelected(null)} />
    </SectionCard>
  );
}

function AnalystDrawer({ row, range, onClose }: { row: AnalystRow | null; range: DateRange; onClose: () => void }) {
  return (
    <Sheet open={row !== null} onOpenChange={(v) => { if (!v) onClose(); }}>
      <SheetContent className="onfido-central-theme oc-sheet w-full overflow-y-auto sm:max-w-2xl">
        <SheetHeader>
          <SheetTitle className="!text-[color:var(--text)]">{row?.analyst}</SheetTitle>
          <SheetDescription className="!text-[color:var(--muted)]">{`${range.from.split("-").reverse().join("/")} to ${range.to.split("-").reverse().join("/")}`}</SheetDescription>
        </SheetHeader>
        {row && (
          <div className="mt-4 space-y-4">
            <div>
              <div className="oc-kv-label">Team</div>
              <div style={{ color: "var(--text)", fontSize: 13 }}>TL {row.tlName ?? DASH} · AM {row.amName ?? DASH}</div>
            </div>
            <div>
              <div className="oc-kv-label">Volume and time</div>
              <table className="oc-table"><tbody>
                <tr><td>DOC tasks</td><td className="oc-right">{fmtInt(row.docTasks)}</td></tr>
                <tr><td>Doc AHT</td><td className="oc-right">{row.docAht === null ? DASH : `${fmtInt(row.docAht)}s`}</td></tr>
                <tr><td>POA tasks</td><td className="oc-right">{fmtInt(row.poaTasks)}</td></tr>
                <tr><td>POA AHT</td><td className="oc-right">{row.poaAht === null ? DASH : `${fmtInt(row.poaAht)}s`}</td></tr>
                <tr><td>CRE / CRQ lines</td><td className="oc-right">{fmtInt(row.cre)} / {fmtInt(row.crq)}</td></tr>
                <tr><td>ETM tasks</td><td className="oc-right">{fmtInt(row.etm)}</td></tr>
                <tr><td>Task skips</td><td className="oc-right">{fmtInt(row.taskSkip)}</td></tr>
                <tr><td>Unplanned leave / scheduled days</td><td className="oc-right">{row.unplannedLeaveDays === null ? DASH : `${fmtNum(row.unplannedLeaveDays, 1)} / ${fmtInt(row.scheduledDays)}`}</td></tr>
              </tbody></table>
            </div>
            <CoachingSection email={row.analyst} />
            <AnalystWeeklyTable analyst={row.analyst} tlName={row.tlName} amName={row.amName} range={range} />
            <QualityTable title="Internal quality" cols={INTERNAL_COLUMNS} cells={row.internal} />
            <QualityTable title="External quality" cols={EXTERNAL_COLUMNS} cells={row.external} />
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

/** Coaching and training history for this analyst from the LMS, loaded only when the section is opened. */
function CoachingSection({ email }: { email: string }) {
  const [opened, setOpened] = useState(false);
  return (
    <details className="rounded-xl border border-slate-200 p-3" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open) setOpened(true); }}>
      <summary className="cursor-pointer text-sm font-semibold text-[color:var(--text)]">Coaching &amp; training (LMS)</summary>
      <div className="mt-3">{opened && <CoachingDetail source={{ email }} />}</div>
    </details>
  );
}

function overallErrorPct(r: AnalystRow): string {
  const errors = (r.internal.overall?.errors ?? 0) + (r.external.overall?.errors ?? 0);
  const audits = (r.internal.overall?.audits ?? 0) + (r.external.overall?.audits ?? 0);
  return audits > 0 ? fmtPct((errors / audits) * 100) : DASH;
}

interface WeekRow {
  weekStart: string; weekEnd: string; label: string;
  docTasks: number; docAht: number | null; poaTasks: number; poaAht: number | null;
  cre: number; crq: number; etm: number; taskSkip: number;
  errors: number; audits: number; overallErrorPct: number | null;
}

const WEEK_COLUMNS: OcColumn<WeekRow>[] = [
  { key: "week", header: "Week", headerText: "Week starting", accessor: (w) => w.weekStart, render: (w) => w.label },
  { key: "doc", header: "DOC", headerText: "DOC tasks", align: "right", accessor: (w) => w.docTasks, render: (w) => fmtInt(w.docTasks) },
  { key: "docAht", header: "Doc AHT", headerText: "Doc AHT (s)", align: "right", accessor: (w) => w.docAht, render: (w) => (w.docAht === null ? DASH : `${fmtInt(w.docAht)}s`) },
  { key: "poa", header: "POA", headerText: "POA tasks", align: "right", accessor: (w) => w.poaTasks, render: (w) => fmtInt(w.poaTasks) },
  { key: "poaAht", header: "POA AHT", headerText: "POA AHT (s)", align: "right", accessor: (w) => w.poaAht, render: (w) => (w.poaAht === null ? DASH : `${fmtInt(w.poaAht)}s`) },
  { key: "etm", header: "ETM", headerText: "ETM", align: "right", accessor: (w) => w.etm, render: (w) => fmtInt(w.etm) },
  { key: "skips", header: "Skips", headerText: "Task skips", align: "right", accessor: (w) => w.taskSkip, render: (w) => fmtInt(w.taskSkip) },
  { key: "err", header: "Overall Error %", headerText: "Overall error %", align: "right", accessor: (w) => w.overallErrorPct, render: (w) => (w.overallErrorPct === null ? DASH : fmtPct(w.overallErrorPct)) },
];

/** Week-by-week (WC dd Mon) performance for the selected analyst. */
function AnalystWeeklyTable({ analyst, tlName, amName, range }: { analyst: string; tlName: string | null; amName: string | null; range: DateRange }) {
  const weekly = useQuery({
    queryKey: ["onfido-process", "analyst-weekly", analyst, tlName, amName, range],
    queryFn: () => {
      let url = `/api/onfido-process/analyst-report/weekly?analyst=${encodeURIComponent(analyst)}&from=${range.from}&to=${range.to}`;
      if (tlName) url += `&tlName=${encodeURIComponent(tlName)}`;
      if (amName) url += `&amName=${encodeURIComponent(amName)}`;
      return hrmsApi.get<{ data: { weeks: WeekRow[] } }>(url);
    },
  });
  const weeks = weekly.data?.data.weeks ?? [];
  return (
    <div>
      <div className="oc-kv-label">Week-wise performance</div>
      {weekly.isLoading && <EmptyNote>Loading weeks...</EmptyNote>}
      {weekly.error instanceof Error && <EmptyNote>Could not load weeks: {weekly.error.message}</EmptyNote>}
      {weeks.length > 0 && (
        <OcDataTable
          rows={weeks}
          columns={WEEK_COLUMNS}
          rowKey={(w) => w.weekStart}
          rowTitle={(w) => `${w.weekStart} to ${w.weekEnd}`}
          csvName={`analyst-weekly-${analyst.replace(/[^A-Za-z0-9]+/g, "-")}`}
        />
      )}
    </div>
  );
}

function QualityTable({ title, cols, cells }: { title: string; cols: { key: Stage; label: string }[]; cells: Partial<Record<Stage, RateCell>> }) {
  return (
    <div>
      <div className="oc-kv-label">{title}</div>
      <table className="oc-table">
        <thead><tr><th>Stage</th><th className="oc-right">Errors</th><th className="oc-right">Audits</th><th className="oc-right">Error %</th></tr></thead>
        <tbody>
          {cols.map((c) => {
            const cell = cells[c.key];
            return <tr key={c.key}><td>{c.label}</td><td className="oc-right">{fmtInt(cell?.errors ?? 0)}</td><td className="oc-right">{fmtInt(cell?.audits ?? 0)}</td><td className="oc-right">{cell ? cellPct(cell) : DASH}</td></tr>;
          })}
          {cells.overall && (
            <tr><td><strong>Overall</strong></td><td className="oc-right">{fmtInt(cells.overall.errors)}</td><td className="oc-right">{fmtInt(cells.overall.audits)}</td><td className="oc-right">{cellPct(cells.overall)}</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
