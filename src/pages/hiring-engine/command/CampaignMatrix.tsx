/**
 * Campaign x requisition x drive map (WS3 C4), in the Drives Summary. One row per campaign x requisition (or requisition only), columns
 * Live Meta / Old Meta data / Hiring Engine. A cell is icon + word + reason; Map it opens Open-a-stream prefilled, Open stream the existing
 * change dialog, Relink the K7BK flow. A row expands to the funnel of its three cells (from the drive analytics of the page's date range).
 * The table scrolls inside its own container at 375 px. CampaignMatrixView is presentational (static-markup tested).
 */
import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, CircleDot, Map as MapIcon, Minus, PauseCircle, PlayCircle, Unlink } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { describeError } from "./commandData";
import { BTN, FIELD, LABEL } from "./StreamActions";
import { TYPE_LABEL } from "./driveCommandModel";
import type { SourceType } from "./driveCommandTypes";
import { liveWindowNote } from "./charts/summaryView";
import { cellView, filterRows, funnelFor, matrixPath, matrixSummary, rowHeader, type CampaignMatrixData, type CellAction, type CellView, type FunnelSource, type MatrixFilters, type MatrixRowData } from "./campaignMatrixModel";

const KINDS: readonly SourceType[] = ["meta_live", "meta_old", "he"];
const SMALL = "inline-flex min-h-11 cursor-pointer items-center rounded-md border border-blue-600 bg-white px-2 text-xs font-semibold text-blue-800 transition-colors duration-150 hover:bg-blue-50 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-blue-400 dark:bg-slate-900 dark:text-blue-200 dark:hover:bg-slate-800 sm:min-h-7";
const TD = "border-b border-slate-100 px-2 py-2 align-top text-slate-800 dark:border-slate-800 dark:text-slate-100";
const ICONS: Record<CellView["icon"], typeof PlayCircle> = { running: PlayCircle, idle: PauseCircle, not_mapped: Unlink, na: Minus };
const ICON_TONE: Record<CellView["icon"], string> = {
  running: "text-emerald-700 dark:text-emerald-300", idle: "text-amber-700 dark:text-amber-300", not_mapped: "text-slate-600 dark:text-slate-300", na: "text-slate-500 dark:text-slate-400",
};

export interface CampaignMatrixViewProps {
  data: CampaignMatrixData | null; loading: boolean; error: string | null; canWrite: boolean; filters: MatrixFilters; branches: string[]; expanded: string | null;
  analytics: FunnelSource | null; onFilters: (f: MatrixFilters) => void; onExpand: (key: string | null) => void; onRetry: () => void;
  onAction: (a: CellAction, row: MatrixRowData, kind: SourceType) => void;
}

function Cell({ row, kind, canWrite, onAction }: { row: MatrixRowData; kind: SourceType; canWrite: boolean; onAction: CampaignMatrixViewProps["onAction"] }) {
  const v = cellView(row.cells[kind], { canWrite });
  const Icon = ICONS[v.icon];
  const code = row.requisition.code;
  return (
    <td className={TD}>
      <div className="flex min-w-44 flex-col gap-1">
        <span className="inline-flex items-center gap-1.5 font-semibold"><Icon className={`h-4 w-4 shrink-0 ${ICON_TONE[v.icon]}`} aria-hidden />{v.word}</span>
        {v.text && <span className="text-xs text-slate-700 dark:text-slate-200">{v.text}</span>}
        {v.people && <span className="text-xs tabular-nums text-slate-600 dark:text-slate-300">{v.people}</span>}
        {v.action && (
          <button type="button" className={SMALL} aria-label={`${v.action.label}: ${TYPE_LABEL[kind]} for ${code}`} onClick={() => onAction(v.action!, row, kind)}>{v.action.label}</button>
        )}
      </div>
    </td>
  );
}

function Funnel({ row, analytics }: { row: MatrixRowData; analytics: FunnelSource | null }) {
  if (!analytics) return <p className="text-xs text-slate-600 dark:text-slate-300">The funnel loads with the drive analytics of the date range above.</p>;
  return (
    <div className="grid gap-3 md:grid-cols-3">
      {KINDS.map((k) => {
        const f = funnelFor(row, k, analytics);
        return (
          <div key={k} className="min-w-0 space-y-1">
            <h5 className="text-xs font-bold text-slate-900 dark:text-slate-100">{TYPE_LABEL[k]}</h5>
            {!f || f.length === 0 ? <p className="text-xs text-slate-600 dark:text-slate-300">{row.campaign || k === "he" ? "No people for this campaign and requisition in the date range" : "No campaign on this row"}</p> : (
              <table className="w-full text-xs">
                <caption className="sr-only">{TYPE_LABEL[k]} funnel for {row.requisition.code}</caption>
                <tbody>{f.map((s) => <tr key={s.key}><th scope="row" className="py-0.5 pr-2 text-left font-medium text-slate-700 dark:text-slate-200">{s.label}</th><td className="py-0.5 text-right tabular-nums text-slate-900 dark:text-slate-100">{s.n}</td></tr>)}</tbody>
              </table>
            )}
          </div>
        );
      })}
    </div>
  );
}

export function CampaignMatrixView({ data, loading, error, canWrite, filters, branches, expanded, analytics, onFilters, onExpand, onRetry, onAction }: CampaignMatrixViewProps) {
  const rows = data ? filterRows(data.rows, filters) : [];
  const sum = data ? matrixSummary(data.rows) : null;
  return (
    <section aria-labelledby="campaign-map-heading" aria-busy={loading} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-4 text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h3 id="campaign-map-heading" className="flex items-center gap-1.5 text-sm font-bold"><MapIcon className="h-4 w-4" aria-hidden /> Campaign map: which drive works on which requisition</h3>
      <p className="text-xs text-slate-600 dark:text-slate-300">Running means people were contacted in the last 48 hours. Idle says why nothing moves. Not mapped: no stream works on it yet.</p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="space-y-1">
          <label htmlFor="cm-branch" className={LABEL}>Branch</label>
          <select id="cm-branch" className={FIELD} value={filters.branch} onChange={(e) => onFilters({ ...filters, branch: e.target.value })}>
            <option value="">All branches</option>
            {branches.map((b) => <option key={b} value={b}>{b}</option>)}
          </select>
        </div>
        <div className="space-y-1">
          <label htmlFor="cm-state" className={LABEL}>State</label>
          <select id="cm-state" className={FIELD} value={filters.state} onChange={(e) => onFilters({ ...filters, state: e.target.value as MatrixFilters["state"] })}>
            <option value="all">All</option><option value="running">Running</option><option value="idle">Idle</option><option value="not_mapped">Not mapped</option>
          </select>
        </div>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-sm text-slate-800 dark:text-slate-100 sm:min-h-9">
          <input type="checkbox" className="h-4 w-4 cursor-pointer accent-blue-700" checked={filters.onlyProblems} onChange={(e) => onFilters({ ...filters, onlyProblems: e.target.checked })} /> Only problems
        </label>
        {sum && <p className="text-xs text-slate-700 dark:text-slate-200">{sum.rows} rows: {sum.running} running, {sum.idle} idle, {sum.notMapped} not mapped</p>}
      </div>
      {loading && !data && <div aria-busy="true" aria-label="Loading the campaign map" className="h-40 animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />}
      {error && !data && (
        <p role="alert" className="flex flex-wrap items-center gap-2 text-sm text-rose-800 dark:text-rose-200"><AlertTriangle className="h-4 w-4" aria-hidden /> Could not load the campaign map: {error}
          <button type="button" className={BTN} onClick={onRetry}>Retry</button></p>
      )}
      {data && liveWindowNote(data) && <p className="text-xs text-slate-700 dark:text-slate-200">{liveWindowNote(data)}</p>}
      {data && data.partial.length > 0 && <p className="text-xs text-amber-900 dark:text-amber-200">Some facts could not be read ({data.partial.join(", ")}); their reasons may be missing.</p>}
      {data && data.rows.length === 0 && <p className="text-sm text-slate-700 dark:text-slate-200">No campaign or open requisition in your scope.</p>}
      {data && data.rows.length > 0 && (
        <div className="relative overflow-x-auto">
          <table className="w-full min-w-max border-collapse text-left text-sm">
            <caption className="sr-only">Campaigns and requisitions with the state of each drive type</caption>
            <thead><tr className="border-b border-slate-200 text-xs dark:border-slate-700">
              <th scope="col" className="px-2 py-1 font-semibold">Campaign / requisition</th>
              {KINDS.map((k) => <th key={k} scope="col" className="px-2 py-1 font-semibold">{TYPE_LABEL[k]}</th>)}
            </tr></thead>
            <tbody>
              {rows.map((r) => {
                const hd = rowHeader(r);
                const open = expanded === r.key;
                const panel = `cm-funnel-${r.key.split("|").join("-")}`;
                return [
                  <tr key={r.key}>
                    <th scope="row" className={`${TD} max-w-xs text-left font-normal`}>
                      <button type="button" className="inline-flex min-h-11 cursor-pointer items-start gap-1 rounded text-left font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-0"
                        aria-expanded={open} aria-controls={panel} onClick={() => onExpand(open ? null : r.key)}>
                        {open ? <ChevronDown className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> : <ChevronRight className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />}
                        <span className="break-words">{hd.title}</span>
                      </button>
                      <div className="mt-1 space-y-0.5 text-xs text-slate-700 dark:text-slate-200">
                        <p>{hd.code} · {hd.branch}</p>
                        <p className="flex flex-wrap items-center gap-1">
                          <span className={`inline-flex items-center gap-1 rounded-full border px-1.5 ${hd.endDate.ended ? "border-rose-400 text-rose-800 dark:border-rose-600 dark:text-rose-200" : "border-slate-300 dark:border-slate-600"}`}>
                            {hd.endDate.ended && <CircleDot className="h-3 w-3" aria-hidden />}{hd.endDate.text}</span>
                          <span>{hd.seats}</span>
                        </p>
                        <p>{hd.criteria}</p>
                        {hd.closed && <p className="font-semibold text-rose-800 dark:text-rose-200">Requisition {hd.closed.replace("requisition ", "")}</p>}
                      </div>
                    </th>
                    {KINDS.map((k) => <Cell key={k} row={r} kind={k} canWrite={canWrite} onAction={onAction} />)}
                  </tr>,
                  open ? <tr key={`${r.key}-f`} id={panel}><td colSpan={4} className={`${TD} bg-slate-50 dark:bg-slate-950`}><Funnel row={r} analytics={analytics} /></td></tr> : null,
                ];
              })}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

export interface CampaignMatrixProps {
  branch: string | null; requisitionId: string | null; canWrite: boolean; analytics: FunnelSource | null; reloadSignal?: number;
  onAction: (a: CellAction, row: MatrixRowData, kind: SourceType) => void;
}

export default function CampaignMatrix({ branch, requisitionId, canWrite, analytics, reloadSignal = 0, onAction }: CampaignMatrixProps) {
  const [data, setData] = useState<CampaignMatrixData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tick, setTick] = useState(0);
  const [filters, setFilters] = useState<MatrixFilters>({ branch: "", state: "all", onlyProblems: false });
  const [expanded, setExpanded] = useState<string | null>(null);
  useEffect(() => {
    const c = new AbortController();
    setLoading(true); setError(null);
    hrmsApi.get<{ data?: CampaignMatrixData }>(matrixPath({ branch, requisitionId }), undefined, c.signal)
      .then((r) => { if (!c.signal.aborted) setData(r?.data ?? null); })
      .catch((e: unknown) => { if (!c.signal.aborted) setError(describeError(e)); })
      .finally(() => { if (!c.signal.aborted) setLoading(false); });
    return () => c.abort();
  }, [branch, requisitionId, tick, reloadSignal]);
  const retry = useCallback(() => setTick((n) => n + 1), []);
  const branches = data ? [...new Set(data.rows.map((r) => r.requisition.branch).filter(Boolean))].sort() : [];
  return <CampaignMatrixView data={data} loading={loading} error={error} canWrite={canWrite} filters={filters} branches={branches} expanded={expanded} analytics={analytics}
    onFilters={setFilters} onExpand={setExpanded} onRetry={retry} onAction={onAction} />;
}
