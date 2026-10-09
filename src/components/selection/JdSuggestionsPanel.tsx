/** "Suggested from the requisition text" (S-O8): each suggestion with its exact source phrase, the rule in words, MUST/PREFER and a
 * confidence; one-click Accept / Dismiss, Accept all with a confirmation showing the preview before and after. Accepting saves through
 * the audited criteria path (a version + audit); dismissals are remembered per text version. View-only roles see no write controls. */
import { useCallback, useEffect, useId, useState } from "react";
import { CheckCircle2, CircleHelp, Eye, Lightbulb, ShieldCheck, Undo2, X } from "lucide-react";
import { PRIMARY } from "./CriteriaEditorBody";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { SOURCE_TABS } from "./ruleFunnelModel";
import { jdSuggestionsApi } from "./jdSuggestionsApi";
import {
  acceptAllState, canWrite, emptyText, legacyNote, outcomeLine, reasonGate, rowsOf, valuesFor, type JdSuggestionsData, type Values,
} from "./jdSuggestionsModel";
import { selectionApi } from "./selectionApi";
import type { PreviewResult, SourceKind } from "./selectionTypes";

type Outcome = PreviewResult["outcome"];
export interface ConfirmState { ids: string[]; before: Outcome | null; after: Outcome | null; loading: boolean; leavesLegacy: boolean }
export interface ViewProps {
  data: JdSuggestionsData; values: Values; onValue: (id: string, v: string) => void; reason: string; onReason: (v: string) => void;
  busy: boolean; error: string | null; message: string | null;
  preview: { source: SourceKind; outcome: Outcome | null; loading: boolean }; onSource: (s: SourceKind) => void;
  confirm: ConfirmState | null; onAccept: (id: string) => void; onDismiss: (id: string) => void; onRestore: (id: string) => void;
  onAcceptAll: () => void; onConfirm: () => void; onCancel: () => void;
}

const CONF_ICON = { high: ShieldCheck, medium: CheckCircle2, low: CircleHelp } as const;
const MUTED = "text-xs text-slate-600 dark:text-slate-300";
const CHIP = "inline-flex items-center rounded border border-slate-400 px-1.5 text-xs font-bold text-slate-800 dark:border-slate-500 dark:text-slate-100";

export function JdSuggestionsView(p: ViewProps) {
  const id = useId();
  const d = p.data;
  const write = canWrite(d);
  const rows = rowsOf(d, p.values);
  const empty = emptyText(d);
  const all = acceptAllState(d, p.values, p.reason);
  const gate = reasonGate(d, p.reason);
  return (
    <section aria-labelledby={`${id}-t`} className="min-w-0 space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <div className="flex flex-wrap items-center gap-2">
        <Lightbulb className="h-4 w-4 text-amber-700 dark:text-amber-300" aria-hidden="true" />
        <h3 id={`${id}-t`} className="font-bold">Suggested from the requisition text</h3>
        <span className={MUTED}>Nothing applies until HR accepts it.</span>
      </div>
      {d.current.approvalStatus === "closed" && <p className={MUTED}>Closed requisition: read-only.</p>}
      {write && d.current.legacy && rows.length > 0 && <p className={MUTED}>{legacyNote}</p>}
      <div className="flex flex-wrap items-center gap-1" role="group" aria-label="Preview source">
        <span className={MUTED}>Preview:</span>
        {SOURCE_TABS.map((s) => (
          <button key={s.id} type="button" aria-pressed={p.preview.source === s.id} onClick={() => p.onSource(s.id)}
            className={`${SMALL_BTN} ${p.preview.source === s.id ? "border-blue-700 bg-blue-50 text-blue-900 dark:border-blue-400 dark:bg-blue-950 dark:text-blue-100" : ""}`}>{s.label}</button>
        ))}
        <span className="text-xs font-semibold" aria-live="polite">{p.preview.loading ? "Counting..." : p.preview.outcome ? `Now: ${outcomeLine(p.preview.outcome)}` : "Preview not available"}</span>
      </div>
      {p.error && <p role="alert" className="text-sm font-semibold text-rose-800 dark:text-rose-200">{p.error}</p>}
      {p.message && <p role="status" className="text-sm text-emerald-900 dark:text-emerald-200">{p.message}</p>}
      {empty ? (
        <p className="rounded-lg border border-dashed border-slate-300 px-3 py-2 text-xs text-slate-700 dark:border-slate-600 dark:text-slate-200">{empty}</p>
      ) : (
        <ul className="space-y-2">
          {rows.map((r) => {
            const Icon = CONF_ICON[r.confidenceLevel];
            return (
              <li key={r.id} className="min-w-0 space-y-1 rounded-lg border border-slate-200 p-2 dark:border-slate-700">
                <p className="break-words text-xs text-slate-700 dark:text-slate-200">{r.source}</p>
                <p className="flex flex-wrap items-center gap-2">
                  <span className="break-words font-semibold">{r.rule}</span>
                  <span className={CHIP}>{r.mode}</span>
                  <span className="inline-flex items-center gap-1 text-xs"><Icon className="h-3.5 w-3.5" aria-hidden="true" />{r.confidence}</span>
                </p>
                <p className={MUTED}>Why {r.mode}: {r.why}{r.note ? `. ${r.note}` : ""}</p>
                {write && (
                  <div className="flex flex-wrap items-end gap-2">
                    {r.needs && (
                      <label className="flex flex-col text-xs font-semibold text-slate-800 dark:text-slate-100">{r.needs.label}
                        <input type="number" inputMode="numeric" min={r.needs.min} max={r.needs.max} value={p.values[r.id] ?? ""} onChange={(e) => p.onValue(r.id, e.target.value)}
                          className={`${FIELD} w-32`} />
                      </label>
                    )}
                    <button type="button" className={SMALL_BTN} disabled={p.busy || !r.acceptable || !gate.ok} aria-label={`Accept: ${r.rule}`}
                      title={!r.acceptable ? "Type the number first" : gate.why ?? undefined} onClick={() => p.onAccept(r.id)}>
                      <CheckCircle2 className="h-4 w-4" aria-hidden="true" />Accept</button>
                    <button type="button" className={SMALL_BTN} disabled={p.busy} aria-label={`Dismiss: ${r.rule}`} onClick={() => p.onDismiss(r.id)}>
                      <X className="h-4 w-4" aria-hidden="true" />Dismiss</button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
      {write && rows.length > 0 && (
        <div className="space-y-2 border-t border-slate-200 pt-2 dark:border-slate-700">
          {d.current.approvalStatus === "approved" && (
            <label className="flex flex-col text-xs font-semibold text-slate-800 dark:text-slate-100">Reason (required for an approved requisition)
              <input type="text" maxLength={300} value={p.reason} onChange={(e) => p.onReason(e.target.value)} className={FIELD} />
            </label>
          )}
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY} disabled={p.busy || !all.ok || !!p.confirm} onClick={p.onAcceptAll}>Accept all ({rows.length})</button>
            {all.why && <span className="text-xs">{all.why}</span>}
          </div>
        </div>
      )}
      {p.confirm && (
        <div role="alertdialog" aria-modal="false" aria-labelledby={`${id}-c`} className="space-y-2 rounded-lg border border-amber-400 bg-amber-50 p-3 text-amber-950 dark:border-amber-600 dark:bg-amber-950 dark:text-amber-50">
          <p id={`${id}-c`} className="font-bold">Accept {p.confirm.ids.length} {p.confirm.ids.length === 1 ? "suggestion" : "suggestions"}?</p>
          <p className="text-xs">{p.confirm.before ? `Now: ${outcomeLine(p.confirm.before)}` : "Now: not available"}</p>
          <p className="text-xs font-semibold" aria-live="polite">{p.confirm.loading ? "Counting what changes..." : p.confirm.after ? `After: ${outcomeLine(p.confirm.after)}` : "After: not available"}</p>
          {p.confirm.leavesLegacy && <p className="text-xs">{legacyNote}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" autoFocus className={PRIMARY} disabled={p.busy} onClick={p.onConfirm}>Confirm</button>
            <button type="button" className={SMALL_BTN} disabled={p.busy} onClick={p.onCancel}>Cancel</button>
          </div>
        </div>
      )}
      {d.dismissed.length > 0 && (
        <details className="text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center gap-1 font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-8"><Eye className="h-3.5 w-3.5" aria-hidden="true" />Dismissed ({d.dismissed.length})</summary>
          <ul className="mt-1 space-y-1">{d.dismissed.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-2"><span className="break-words">{s.plain} (from “{s.matched}”)</span>
              {write && <button type="button" className={SMALL_BTN} disabled={p.busy} aria-label={`Show again: ${s.plain}`} onClick={() => p.onRestore(s.id)}><Undo2 className="h-4 w-4" aria-hidden="true" />Show again</button>}
            </li>))}</ul>
        </details>
      )}
      {(d.unparsed.length > 0 || d.skipped.length > 0) && (
        <details className="text-xs">
          <summary className="flex min-h-11 cursor-pointer items-center font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 sm:min-h-8">Not used from the text ({d.unparsed.length + d.skipped.length})</summary>
          <ul className="mt-1 space-y-1">
            {d.skipped.map((s, i) => <li key={`s${i}`} className="break-words">“{s.matched}”: {s.reason}</li>)}
            {d.unparsed.map((u, i) => <li key={`u${i}`} className="break-words">“{u.phrase}”: {u.reason}</li>)}
          </ul>
        </details>
      )}
    </section>
  );
}

const errText = (e: unknown) => (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message ?? (e as { message?: string })?.message ?? "Something went wrong";
const statusOf = (e: unknown) => (e as { status?: number; response?: { status?: number } })?.status ?? (e as { response?: { status?: number } })?.response?.status;

/** Loads, accepts and dismisses; tells the parent the suggestion count (for "criteria found in text") and when criteria changed. */
export default function JdSuggestionsPanel({ requisitionId, onChanged, onData }: { requisitionId: string; onChanged?: () => void; onData?: (d: JdSuggestionsData | null) => void }) {
  const [data, setData] = useState<JdSuggestionsData | null>(null);
  const [hidden, setHidden] = useState(false);
  const [values, setValues] = useState<Values>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [source, setSource] = useState<SourceKind>("he");
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [counting, setCounting] = useState(false);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);

  const load = useCallback(async () => {
    try { const d = await jdSuggestionsApi.get(requisitionId); setData(d); onData?.(d); } catch (e) {
      if (statusOf(e) === 403) { setHidden(true); onData?.(null); } else setError(errText(e));
    }
  }, [requisitionId, onData]);
  const count = useCallback(async () => {
    setCounting(true);
    try { setOutcome((await selectionApi.preview(requisitionId, source, "all")).outcome); } catch { setOutcome(null); } finally { setCounting(false); }
  }, [requisitionId, source]);
  useEffect(() => { setData(null); setHidden(false); setConfirm(null); setValues({}); void load(); }, [load]);
  useEffect(() => { void count(); }, [count]);

  const accept = async (ids: string[]) => {
    if (!data) return;
    setBusy(true); setError(null); setMessage(null);
    try {
      const r = await jdSuggestionsApi.accept(requisitionId, ids, valuesFor(ids, data, values), reason.trim() || null, false);
      setMessage(`Accepted ${ids.length} ${ids.length === 1 ? "suggestion" : "suggestions"}${r.versionNo ? `: criteria version ${r.versionNo}` : ""}`);
      setConfirm(null);
      await load(); await count(); onChanged?.();
    } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const dismiss = async (id: string, undo: boolean) => {
    setBusy(true); setError(null); setMessage(null);
    try { await jdSuggestionsApi.dismiss(requisitionId, [id], undo); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); }
  };
  const acceptAll = async () => {
    if (!data) return;
    const ids = data.suggestions.map((s) => s.id);
    setConfirm({ ids, before: outcome, after: null, loading: true, leavesLegacy: data.current.legacy });
    try {
      const dry = await jdSuggestionsApi.accept(requisitionId, ids, valuesFor(ids, data, values), reason.trim() || null, true);
      const after = (await selectionApi.preview(requisitionId, source, "all", dry.patch)).outcome;
      setConfirm((c) => (c ? { ...c, after, loading: false, leavesLegacy: dry.leavesLegacy } : c));
    } catch (e) { setError(errText(e)); setConfirm(null); }
  };

  if (hidden) return null;
  if (!data) return error ? <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">Could not load the text suggestions: {error}</p>
    : <div aria-busy="true" aria-label="Loading text suggestions" className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />;
  return (
    <JdSuggestionsView data={data} values={values} onValue={(i, v) => setValues((x) => ({ ...x, [i]: v }))} reason={reason} onReason={setReason}
      busy={busy} error={error} message={message} preview={{ source, outcome, loading: counting }} onSource={setSource} confirm={confirm}
      onAccept={(i) => void accept([i])} onDismiss={(i) => void dismiss(i, false)} onRestore={(i) => void dismiss(i, true)}
      onAcceptAll={() => void acceptAll()} onConfirm={() => confirm && void accept(confirm.ids)} onCancel={() => setConfirm(null)} />
  );
}
