/** Approve-shortlist bar (S19): last run, counts and version; untick people; approve (disabled with the reason in words); a standing
 * approval for Live Meta with Revoke. Write controls only for roles that may approve (the server refuses the rest). */
import { useCallback, useEffect, useId, useState } from "react";
import { CheckCircle2, Play } from "lucide-react";
import { PRIMARY } from "./CriteriaEditorBody";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { approveView, type RunPerson } from "./approvalModel";
import { selectionApi } from "./selectionApi";
import type { ApprovalState, SourceKind } from "./selectionTypes";

const STATUS: Record<string, string> = { picked: "Shortlisted", review: "Review", unticked: "Unticked", approved: "Approved" };

export interface BarViewProps {
  state: ApprovalState; people: RunPerson[]; unticked: ReadonlySet<string>; reviewOk: ReadonlySet<string>; onUntick: (id: string, on: boolean) => void; onReviewOk: (id: string, on: boolean) => void;
  sourceKind: SourceKind; days: number; onDays: (n: number) => void; busy: boolean; message: string | null; error: string | null; now: Date;
  onRun: () => void; onApprove: () => void; onStanding: () => void; onRevoke: (id: string) => void;
}

export function ApproveBarView(p: BarViewProps) {
  const id = useId();
  const v = approveView(p.state, p.people, p.unticked, p.reviewOk, p.now);
  const can = p.state.permissions.approve;
  return (
    <section aria-labelledby={`${id}-t`} className="space-y-2 rounded-xl border border-slate-200 bg-white p-3 text-sm text-slate-900 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100">
      <h3 id={`${id}-t`} className="font-bold">Approve shortlist</h3>
      <p>{v.runText}</p>
      <p className="text-xs text-slate-600 dark:text-slate-300">{v.versionText}</p>
      {can && p.people.length > 0 && (
        <div className="relative max-h-72 overflow-auto rounded-lg border border-slate-200 dark:border-slate-700">
          <table className="w-full min-w-max text-left text-xs">
            <caption className="sr-only">People in the last run: untick to leave someone out; tick a review row to approve it</caption>
            <thead className="bg-slate-50 dark:bg-slate-800"><tr><th scope="col" className="px-2 py-1">Include</th><th scope="col" className="px-2 py-1">Mobile</th><th scope="col" className="px-2 py-1">Status</th><th scope="col" className="px-2 py-1">Score</th><th scope="col" className="px-2 py-1">Why review</th></tr></thead>
            <tbody>{p.people.map((x) => {
              const tick = x.status === "picked" ? !p.unticked.has(x.id) : x.status === "review" ? p.reviewOk.has(x.id) : x.status === "approved";
              const editable = x.status === "picked" || x.status === "review";
              return (
                <tr key={x.id} className="border-t border-slate-100 dark:border-slate-800">
                  <td className="px-2 py-1 text-slate-700 dark:text-slate-200"><input type="checkbox" aria-label={`Include ${x.maskedMobile}`} checked={tick} disabled={!editable}
                    onChange={(e) => (x.status === "picked" ? p.onUntick(x.id, !e.target.checked) : p.onReviewOk(x.id, e.target.checked))} className="h-5 w-5 cursor-pointer rounded" /></td>
                  <th scope="row" className="px-2 py-1 font-mono font-medium">{x.maskedMobile}</th>
                  <td className="px-2 py-1 text-slate-700 dark:text-slate-200">{STATUS[x.status] ?? x.status}</td>
                  <td className="px-2 py-1 tabular-nums text-slate-700 dark:text-slate-200">{x.score}</td>
                  <td className="px-2 py-1 text-slate-700 dark:text-slate-200">{x.reasons.join("; ")}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      )}
      {can && (
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className={SMALL_BTN} disabled={p.busy} onClick={p.onRun}><Play className="h-4 w-4" aria-hidden="true" />Run the shortlist</button>
          <button type="button" className={PRIMARY} disabled={!v.canApprove || p.busy} onClick={p.onApprove}><CheckCircle2 className="h-4 w-4" aria-hidden="true" />Approve {v.approveCount} people</button>
          {v.why && <span className="text-xs">{v.why}</span>}
        </div>
      )}
      {!can && <p className="text-xs text-slate-600 dark:text-slate-300">{v.why}</p>}
      {p.sourceKind === "meta_live" && (
        <div className="space-y-1 border-t border-slate-200 pt-2 dark:border-slate-700">
          {v.standing.map((s) => (
            <p key={s.id} className="flex flex-wrap items-center gap-2">{s.text}{can && <button type="button" className={SMALL_BTN} disabled={p.busy} onClick={() => p.onRevoke(s.id)}>Revoke</button>}</p>
          ))}
          {can && v.standing.length === 0 && (
            <div className="flex flex-wrap items-end gap-2">
              <div><label htmlFor={`${id}-d`} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Standing approval for new Live Meta leads (days, up to 7)</label>
                <input id={`${id}-d`} type="number" min={1} max={7} value={p.days} onChange={(e) => p.onDays(Math.max(1, Math.min(7, Number(e.target.value) || 1)))} className={`${FIELD} w-24`} /></div>
              <button type="button" className={SMALL_BTN} disabled={p.busy || !!p.state.blocker || !p.state.currentVersion} onClick={p.onStanding}>Approve new leads that pass</button>
            </div>
          )}
          <p className="text-xs text-slate-600 dark:text-slate-300">A standing approval enrols new leads who pass every MUST rule; review people still wait. Any criteria change ends it.</p>
        </div>
      )}
      <div aria-live="polite">
        {p.message && <p role="status" className="font-semibold text-emerald-800 dark:text-emerald-200">{p.message}</p>}
        {p.error && <p role="alert" className="font-semibold text-rose-800 dark:text-rose-200">{p.error}</p>}
      </div>
    </section>
  );
}

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";

export default function ApproveShortlistBar({ requisitionId, sourceKind }: { requisitionId: string; sourceKind: SourceKind }) {
  const [state, setState] = useState<ApprovalState | null>(null);
  const [people, setPeople] = useState<RunPerson[]>([]);
  const [unticked, setUnticked] = useState<Set<string>>(new Set());
  const [reviewOk, setReviewOk] = useState<Set<string>>(new Set());
  const [days, setDays] = useState(7);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const s = await selectionApi.approvalState(requisitionId, sourceKind);
      setState(s); setUnticked(new Set()); setReviewOk(new Set());
      setPeople(s.lastRun && s.permissions.approve ? (await selectionApi.runPeople(s.lastRun.runId)).items : []);
    } catch (e) { setError(errText(e)); }
  }, [requisitionId, sourceKind]);
  useEffect(() => { void load(); }, [load]);
  const act = async (f: () => Promise<string>) => { setBusy(true); setError(null); setMessage(null); try { setMessage(await f()); await load(); } catch (e) { setError(errText(e)); } finally { setBusy(false); } };
  const toggle = (s: Set<string>, id: string, on: boolean) => { const n = new Set(s); if (on) n.add(id); else n.delete(id); return n; };
  if (!state) return error ? <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">{error}</p> : <div aria-busy="true" aria-label="Loading approval" className="h-24 animate-pulse rounded-xl bg-slate-100 motion-reduce:animate-none dark:bg-slate-800" />;
  return <ApproveBarView state={state} people={people} unticked={unticked} reviewOk={reviewOk} onUntick={(id, on) => setUnticked(toggle(unticked, id, on))} onReviewOk={(id, on) => setReviewOk(toggle(reviewOk, id, on))}
    sourceKind={sourceKind} days={days} onDays={setDays} busy={busy} message={message} error={error} now={new Date()}
    onRun={() => act(async () => { await selectionApi.run(requisitionId, sourceKind); return "Shortlist run done"; })}
    onApprove={() => act(async () => { const r = await selectionApi.approve(requisitionId, sourceKind, state.lastRun!.runId, [...unticked], [...reviewOk], null); return `Approved ${r.approved} people`; })}
    onStanding={() => act(async () => { const r = await selectionApi.approveStanding(requisitionId, state.currentVersion!.id, days); return `Standing approval until ${r.validUntil}`; })}
    onRevoke={(sid) => act(async () => { await selectionApi.revokeStanding(sid); return "Standing approval revoked"; })} />;
}
