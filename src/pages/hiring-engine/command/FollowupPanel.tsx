/**
 * Follow-up pipeline panel (end of Summary). Collapsed by default; nothing is fetched until the first expansion.
 * FollowupPanelView is presentational (static-markup tested); the default export wires the lazy load, retry and mark-called.
 * All server text is rendered as React text (never as HTML) after scrubText.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ChevronRight, Info, Inbox, Loader2, MinusCircle, PhoneCall, RotateCcw } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { createRequestSequencer, describeError } from "./commandData";
import { isUuidShape } from "./driveCommandModel";
import type { AttentionChannel, AttentionGroup, FollowupMode, FollowupStatus, RequisitionSources } from "./driveCommandTypes";
import { BTN, PRIMARY } from "./StreamActions";
import {
  ATTENTION_PATH, OFF_SENTENCE, SOURCE_COLUMNS, SUMMARY_PATH, attentionTotal, attentionView, callFileRows, isFollowupOff, markCalledErrorText, markCalledPath,
  markCalledText, modeText, reportText, retryErrorText, retryOkText, retryPath, rowName, scrubText, sourceFunnelRows, sourcesPath, type SummaryRow,
} from "./followupPanelModel";
import { createInFlightGuard } from "./inFlight";
import { Note } from "./charts/ChartFrame";
import { CREDIT_NOTE } from "./charts/summaryView";
import HeldOffers from "./HeldOffers";
import { HELD_PATH, type HeldOffers as HeldData } from "./heldOffersModel";
import { FOLLOWUP_STATUS_PATH } from "./driveCommandModel";

export const FOLLOWUP_PANEL_ID = "followup-panel-body";
const PULSE = "animate-pulse rounded-lg bg-slate-100 motion-reduce:animate-none dark:bg-slate-800";
const TH = "px-2 py-1.5 text-left text-xs font-semibold text-slate-700 dark:text-slate-200";
const TD = "px-2 py-1.5 text-sm text-slate-800 dark:text-slate-100";

export interface PanelData {
  status: FollowupStatus | null;
  summary: { mode: FollowupMode | null; data: SummaryRow[] } | null;
  attention: AttentionGroup[] | null;
  sources: RequisitionSources | null;
  /** Held offers (null: could not be loaded; undefined: not requested). */
  held?: HeldData | null;
  /** Names of the sections that failed to load. */
  failed: string[];
}
export interface RowResult { id: string; ok: boolean; text: string }
/** Which action is running on which row (its buttons show a busy word; every row's buttons are disabled meanwhile). */
export interface RowBusy { id: string; kind: "retry" | "mark" }

export interface FollowupPanelViewProps {
  expanded: boolean;
  onToggle: () => void;
  loading: boolean;
  /** Set when nothing could be loaded at all. */
  error: string | null;
  data: PanelData | null;
  qualifiedTracked?: boolean | null;
  busy?: RowBusy | null;
  result?: RowResult | null;
  onReload: () => void;
  onRetry: (id: string, channel: AttentionChannel) => void;
  onMarkCalled: (id: string) => void;
}

function Skeleton() {
  return (
    <div role="status" aria-label="Loading the follow-up pipeline" className="space-y-2">
      {[0, 1, 2].map((i) => <div key={i} className={PULSE} style={{ height: 56 }} />)}
    </div>
  );
}

function Funnel({ data }: { data: PanelData }) {
  const rows = sourceFunnelRows(data.sources, data.summary?.data ?? []);
  if (rows.length === 0) return <p className="text-sm text-slate-700 dark:text-slate-200">No follow-up rows yet.</p>;
  const withSources = !!data.sources;
  return (
    <div className="space-y-1">
      <div className="overflow-x-auto">
        <table className="min-w-full">
          <caption className="pb-1 text-left text-xs text-slate-700 dark:text-slate-200">
            {withSources ? "Follow-up rows and the filtered requisition's sources, by source type" : "Follow-up rows by source type"}
          </caption>
          <thead><tr>
            <th scope="col" className={TH}>Source</th><th scope="col" className={TH}>Total</th><th scope="col" className={TH}>Open</th><th scope="col" className={TH}>Stopped</th>
            {withSources && SOURCE_COLUMNS.map((c) => <th key={c.key} scope="col" className={TH}>{c.label}</th>)}
          </tr></thead>
          <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
            {rows.map((r) => (
              <tr key={r.sourceType}>
                <th scope="row" className={`${TD} font-semibold`}>{r.label}</th>
                <td className={TD}>{r.cells.total}</td><td className={TD}>{r.cells.open}</td><td className={TD}>{r.cells.stopped}</td>
                {withSources && SOURCE_COLUMNS.map((c) => <td key={c.key} className={TD}>{r.cells[c.key]}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {withSources && <Note>{CREDIT_NOTE}</Note>}
    </div>
  );
}

function Attention({ data, busy, result, onRetry, onMarkCalled }: Pick<FollowupPanelViewProps, "busy" | "result" | "onRetry" | "onMarkCalled"> & { data: PanelData }) {
  if (!data.attention) return <p className="text-sm text-slate-700 dark:text-slate-200">The needs-attention list could not be loaded.</p>;
  const groups = attentionView(data.attention);
  if (groups.length === 0) {
    return (
      <p className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-200"><Inbox className="h-4 w-4 shrink-0" aria-hidden /> Nothing needs attention: no failed follow-up steps.</p>
    );
  }
  return (
    <div className="space-y-3">
      {groups.map((g) => (
        <section key={g.key} aria-label={`${g.channelLabel}: ${g.cause}`} className="rounded-lg border border-slate-200 dark:border-slate-700">
          <h5 className="px-2 pt-2 text-sm font-semibold text-slate-900 dark:text-slate-100">{g.channelLabel}: {g.cause} ({g.count})</h5>
          {g.shown < g.count && <p className="px-2 text-xs text-slate-700 dark:text-slate-200">Showing {g.shown} of {g.count}</p>}
          <ul className="divide-y divide-slate-200 dark:divide-slate-700">
            {g.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start gap-2 px-2 py-2">
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm text-slate-900 dark:text-slate-100"><span className="font-semibold">{r.name}</span> <span>{r.mobile}</span> <span className="text-slate-700 dark:text-slate-200">({r.source})</span></p>
                  <p className="break-words text-xs text-slate-700 dark:text-slate-200">Error: {r.error}. Attempts: {r.attempts}. Updated {r.updated}.</p>
                  {r.label && <p className="flex items-center gap-1 text-xs font-semibold text-amber-900 dark:text-amber-200"><AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {r.label}</p>}
                  {r.hint && <p className="flex items-center gap-1 text-xs text-slate-800 dark:text-slate-100"><MinusCircle className="h-3.5 w-3.5 shrink-0" aria-hidden /> {r.hint}</p>}
                  {result?.id === r.id && <p className={`text-xs font-semibold ${result.ok ? "text-emerald-800 dark:text-emerald-200" : "text-rose-800 dark:text-rose-200"}`}>{result.text}</p>}
                </div>
                <div className="flex flex-wrap gap-2">
                  {r.retry && (
                    <button type="button" className={BTN} disabled={!!busy} onClick={() => onRetry(r.id, g.channel)}>
                      {busy?.id === r.id && busy.kind === "retry" ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Retrying…</> : <><RotateCcw className="h-4 w-4" aria-hidden />Retry</>}
                    </button>
                  )}
                  {r.markCalled && (
                    <button type="button" className={BTN} disabled={!!busy} onClick={() => onMarkCalled(r.id)}>
                      {busy?.id === r.id && busy.kind === "mark" ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden />Marking…</> : <><PhoneCall className="h-4 w-4" aria-hidden />Mark called</>}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CallFiles({ status }: { status: FollowupStatus | null }) {
  if (!status) return <p className="text-sm text-slate-700 dark:text-slate-200">The call-file status could not be loaded.</p>;
  const files = callFileRows(status);
  return (
    <div className="space-y-2">
      {files.length === 0 ? <p className="text-sm text-slate-700 dark:text-slate-200">No calling files yet.</p> : (
        <div className="overflow-x-auto">
          <table className="min-w-full">
            <caption className="sr-only">Last calling-file batches</caption>
            <thead><tr><th scope="col" className={TH}>Time</th><th scope="col" className={TH}>Rows</th><th scope="col" className={TH}>Status</th><th scope="col" className={TH}>Error</th></tr></thead>
            <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
              {files.map((f) => <tr key={f.id}><td className={TD}>{f.when}</td><td className={TD}>{f.rows}</td><td className={TD}>{f.status}</td><td className={`${TD} break-words`}>{f.error}</td></tr>)}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-sm text-slate-800 dark:text-slate-100"><span className="font-semibold">Daily report:</span> {reportText(status.report)}</p>
    </div>
  );
}

export function FollowupPanelView(p: FollowupPanelViewProps) {
  const modes = [p.data?.status?.mode ?? null, p.data?.summary?.mode ?? null];
  const off = !!p.data && isFollowupOff(modes, p.qualifiedTracked);
  const mode = modes.find((m) => m === "off") ?? modes.find((m) => m != null) ?? null;
  const Chevron = p.expanded ? ChevronDown : ChevronRight;
  return (
    <section aria-labelledby="followup-heading" className="rounded-xl border border-slate-200 dark:border-slate-700">
      <h3 id="followup-heading" className="m-0">
        <button type="button" aria-expanded={p.expanded} aria-controls={p.expanded ? FOLLOWUP_PANEL_ID : undefined} onClick={p.onToggle}
          className="flex min-h-11 w-full cursor-pointer items-center gap-2 rounded-xl px-3 text-left text-base font-bold text-slate-900 transition-colors duration-150 hover:bg-slate-50 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:text-slate-100 dark:hover:bg-slate-800">
          <Chevron className="h-4 w-4 shrink-0" aria-hidden />Follow-up pipeline
        </button>
      </h3>
      {p.expanded && (
        <div id={FOLLOWUP_PANEL_ID} className="space-y-4 px-3 pb-3" aria-busy={p.loading}>
          {p.loading && !p.data && <Skeleton />}
          {p.error && !p.data && (
            <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-rose-300 bg-rose-50 px-3 py-2 text-sm text-rose-800 dark:border-rose-700 dark:bg-rose-950 dark:text-rose-200">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              <span className="min-w-0 flex-1">Could not load the follow-up pipeline: {scrubText(p.error)}</span>
              <button type="button" onClick={p.onReload} className={BTN}>Retry</button>
            </div>
          )}
          {p.data && off && (
            <p className="flex items-start gap-2 text-sm text-slate-800 dark:text-slate-100"><Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              <span>{OFF_SENTENCE}. Mode: {mode ?? "off"}.</span></p>
          )}
          {p.data && !off && (
            <>
              {p.data.failed.length > 0 && (
                <div role="alert" className="flex flex-wrap items-center gap-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-200">
                  <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
                  <span className="min-w-0 flex-1">Partial result: could not load {p.data.failed.join(", ")}.</span>
                  <button type="button" onClick={p.onReload} className={BTN}>Retry</button>
                </div>
              )}
              <p className="text-sm text-slate-800 dark:text-slate-100"><span className="font-semibold">Mode:</span> {mode ? modeText(mode) : "–"}</p>
              <section aria-labelledby="followup-funnel-h" className="space-y-1">
                <h4 id="followup-funnel-h" className="text-sm font-bold text-slate-900 dark:text-slate-100">Funnel by source type</h4>
                {p.data.summary ? <Funnel data={p.data} /> : <p className="text-sm text-slate-700 dark:text-slate-200">The funnel could not be loaded.</p>}
              </section>
              <section aria-labelledby="followup-attention-h" className="space-y-1">
                <h4 id="followup-attention-h" className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  Needs attention{p.data.attention ? ` (${attentionTotal(attentionView(p.data.attention))})` : ""}
                </h4>
                {/* Always mounted: a successful retry removes the row from the list, so the result must not live only beside it. */}
                <p role="status" className={`text-sm font-semibold empty:hidden ${p.result && !p.result.ok ? "text-rose-800 dark:text-rose-200" : "text-emerald-800 dark:text-emerald-200"}`}>{p.result?.text ?? ""}</p>
                <Attention data={p.data} busy={p.busy} result={p.result} onRetry={p.onRetry} onMarkCalled={p.onMarkCalled} />
              </section>
              <HeldOffers held={p.data.held} />
              <section aria-labelledby="followup-files-h" className="space-y-1">
                <h4 id="followup-files-h" className="text-sm font-bold text-slate-900 dark:text-slate-100">Calling files</h4>
                <CallFiles status={p.data.status} />
              </section>
            </>
          )}
        </div>
      )}
    </section>
  );
}

// ---- wiring --------------------------------------------------------------------------------------------------------------------------------
async function loadAll(requisitionId: string | null, signal: AbortSignal): Promise<{ data: PanelData; error: string | null }> {
  const get = <T,>(path: string) => hrmsApi.get<T>(path, undefined, signal);
  const [st, su, at, so, he] = await Promise.allSettled([
    get<{ data?: FollowupStatus }>(FOLLOWUP_STATUS_PATH),
    get<{ mode?: FollowupMode; data?: SummaryRow[] }>(SUMMARY_PATH),
    get<{ data?: AttentionGroup[] }>(ATTENTION_PATH),
    requisitionId && isUuidShape(requisitionId) ? get<{ data?: RequisitionSources }>(sourcesPath(requisitionId)) : Promise.resolve(null),
    get<{ data?: HeldData }>(HELD_PATH),
  ]);
  const ok = <T,>(r: PromiseSettledResult<T>): T | null => (r.status === "fulfilled" ? r.value : null);
  const status = ok(st)?.data ?? null;
  const sm = ok(su);
  const summary = sm && Array.isArray(sm.data) ? { mode: sm.mode ?? null, data: sm.data } : null;
  const attention = Array.isArray(ok(at)?.data) ? (ok(at)!.data as AttentionGroup[]) : null;
  const sources = ok(so)?.data ?? null;
  const held = ok(he)?.data ?? null;
  const failed: string[] = [];
  if (!status) failed.push("the call-file status");
  if (!summary) failed.push("the funnel");
  if (!attention) failed.push("the needs-attention list");
  if (requisitionId && isUuidShape(requisitionId) && so.status === "rejected") failed.push("the requisition sources");
  if (!held) failed.push("the held offers");
  const firstRejection = [st, su, at].find((r) => r.status === "rejected") as PromiseRejectedResult | undefined;
  return { data: { status, summary, attention, sources, held, failed }, error: !status && !summary && !attention ? describeError(firstRejection?.reason) : null };
}

/** `openSignal` changes (the insight action "Open follow-up issues") expand the panel. */
export default function FollowupPanel({ requisitionId = null, qualifiedTracked = null, openSignal = 0 }: { requisitionId?: string | null; qualifiedTracked?: boolean | null; openSignal?: number }) {
  const [expanded, setExpanded] = useState(false);
  const [started, setStarted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<PanelData | null>(null);
  const [busy, setBusy] = useState<RowBusy | null>(null);
  const guard = useRef(createInFlightGuard());
  const [result, setResult] = useState<RowResult | null>(null);
  const [confirm, setConfirm] = useState<{ id: string; channel: AttentionChannel } | null>(null);
  const seq = useRef(createRequestSequencer());

  const load = useCallback(async () => {
    const ticket = seq.current.begin();
    setLoading(true);
    try {
      const r = await loadAll(requisitionId, ticket.signal);
      if (!ticket.isCurrent()) return;
      setData(r.error ? null : r.data); setError(r.error);
    } catch (e: unknown) {
      if (ticket.isCurrent()) setError(describeError(e));
    } finally {
      if (ticket.isCurrent()) setLoading(false);
    }
  }, [requisitionId]);

  // Lazy: the first expansion starts the load; a changed requisition reloads only once the panel has been opened.
  useEffect(() => { if (started) void load(); }, [started, load]);
  useEffect(() => { const s = seq.current; return () => s.cancel(); }, []);

  useEffect(() => { if (openSignal > 0) { setExpanded(true); setStarted(true); } }, [openSignal]);

  const toggle = () => { setExpanded((e) => !e); setStarted(true); };

  const act = (id: string, kind: RowBusy["kind"], path: string, body: unknown, errorText: (e: unknown) => string, okText: (r: unknown) => string) => guard.current.run(async () => {
    setBusy({ id, kind }); setResult(null);
    try {
      const r = await hrmsApi.post(path, body);
      setResult({ id, ok: true, text: okText(r) });
      await load(); // never optimistic: the list is whatever the server says now
    } catch (e: unknown) {
      setResult({ id, ok: false, text: errorText(e) });
    } finally {
      setBusy(null);
    }
  });
  const nameOf = (id: string): string => rowName(data?.attention, id);

  return (
    <>
      <FollowupPanelView expanded={expanded} onToggle={toggle} loading={loading} error={error} data={data} qualifiedTracked={qualifiedTracked}
        busy={busy} result={result} onReload={() => void load()}
        onRetry={(id, channel) => setConfirm({ id, channel })}
        onMarkCalled={(id) => void act(id, "mark", markCalledPath(id), {}, markCalledErrorText, (r) => markCalledText(r, nameOf(id)))} />
      <AlertDialog open={confirm !== null} onOpenChange={(o) => { if (!o && busy === null) setConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Retry this follow-up step?</AlertDialogTitle>
            <AlertDialogDescription className="text-slate-700 dark:text-slate-200">
              The step is queued again and the worker sends it on its next pass. The server refuses the retry if the message may already have gone out.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel type="button" className="min-h-11 sm:min-h-9">Cancel</AlertDialogCancel>
            <button type="button" className={PRIMARY} onClick={() => {
              const c = confirm; setConfirm(null);
              if (c) void act(c.id, "retry", retryPath(c.id), { channel: c.channel }, retryErrorText, (r) => retryOkText(r, nameOf(c.id)));
            }}>Retry step</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}
