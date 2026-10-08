/** Bulk criteria edit across a campaign's requisitions (S17): pick requisitions, set values, see the server's dry-run diff, confirm. */
import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRIMARY } from "./CriteriaEditorBody";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { bulkPatch, canConfirm, diffView, emptyChoice, type BulkChoice } from "./bulkCriteriaModel";
import { EDUCATION_LADDER } from "./ruleInfo";
import { selectionApi } from "./selectionApi";
import type { BulkRow, RequisitionItem } from "./selectionTypes";

export interface BulkBodyProps {
  items: RequisitionItem[]; picked: ReadonlySet<string>; onPick: (id: string, on: boolean) => void; choice: BulkChoice; onChoice: (c: BulkChoice) => void;
  diff: BulkRow[] | null; excluded: ReadonlySet<string>; onExclude: (id: string, on: boolean) => void; reason: string; onReason: (s: string) => void;
  busy: boolean; result: string | null; error: string | null; onShow: () => void; onConfirm: () => void;
}

export function BulkCriteriaBody(p: BulkBodyProps) {
  const id = useId();
  const codes = Object.fromEntries(p.items.map((i) => [i.id, i.code]));
  const view = p.diff ? diffView(p.diff, codes) : null;
  const anyApproved = p.items.some((i) => p.picked.has(i.id) && !p.excluded.has(i.id) && i.approvalStatus === "approved");
  const verdict = p.diff ? canConfirm(p.diff, p.excluded, { reason: p.reason, anyApproved, codes }) : { ok: false, why: "See the changes first" };
  const set = (k: keyof BulkChoice) => (v: string | boolean) => p.onChoice({ ...p.choice, [k]: v });
  return (
    <div className="space-y-4 text-sm text-slate-900 dark:text-slate-100">
      <fieldset className="space-y-1">
        <legend className="text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">1. Requisitions</legend>
        {p.items.length === 0 && <p className="text-slate-600 dark:text-slate-300">This campaign has no requisitions you can edit.</p>}
        {p.items.map((i) => (
          <label key={i.id} className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9">
            <input type="checkbox" checked={p.picked.has(i.id)} disabled={i.approvalStatus === "closed"} onChange={(e) => p.onPick(i.id, e.target.checked)} className="h-5 w-5 cursor-pointer rounded" />
            <span className="min-w-0 break-words">{i.code} · {i.branch}{i.process ? ` · ${i.process}` : ""} · {i.approvalStatus ?? ""}{i.approvalStatus === "closed" ? " (read-only)" : ""}</span>
          </label>
        ))}
      </fieldset>
      <fieldset className="grid gap-2 sm:grid-cols-2">
        <legend className="col-span-full text-xs font-bold uppercase tracking-wide text-slate-600 dark:text-slate-300">2. Values to set (empty = leave as is)</legend>
        <label className="block text-xs font-semibold">Minimum qualification
          <select value={p.choice.educationRequirement} onChange={(e) => set("educationRequirement")(e.target.value)} className={FIELD}>
            <option value="">Leave as is</option>{EDUCATION_LADDER.map((l) => <option key={l} value={l}>{l} or above</option>)}
          </select></label>
        <label className="block text-xs font-semibold">Night shift
          <select value={p.choice.nightShift} onChange={(e) => set("nightShift")(e.target.value)} className={FIELD}>
            <option value="">Leave as is</option><option value="yes">Required</option><option value="no">Not required</option>
          </select></label>
        <label className="block text-xs font-semibold">Age from<input type="number" inputMode="numeric" value={p.choice.ageMin} onChange={(e) => set("ageMin")(e.target.value)} className={FIELD} /></label>
        <label className="block text-xs font-semibold">Age up to<input type="number" inputMode="numeric" value={p.choice.ageMax} onChange={(e) => set("ageMax")(e.target.value)} className={FIELD} /></label>
        <label className="block text-xs font-semibold sm:col-span-2">Cities (comma separated)<input value={p.choice.cities} onChange={(e) => set("cities")(e.target.value)} className={FIELD} /></label>
        <label className="block text-xs font-semibold">Enrolment
          <select value={p.choice.enrolment} onChange={(e) => set("enrolment")(e.target.value)} className={FIELD}>
            <option value="">Leave as is</option><option value="hr_approves">HR approves shortlists</option><option value="off">Off</option>
          </select></label>
        <label className="flex min-h-11 cursor-pointer items-center gap-2 text-xs font-semibold sm:min-h-9">
          <input type="checkbox" checked={p.choice.replaceFilled} onChange={(e) => set("replaceFilled")(e.target.checked)} className="h-5 w-5 cursor-pointer rounded" />Also replace values that are already filled</label>
        <div className="col-span-full"><button type="button" className={SMALL_BTN} disabled={p.busy || !p.picked.size || !Object.keys(bulkPatch(p.choice)).length} onClick={p.onShow}>3. See the changes</button></div>
      </fieldset>
      {view && (
        <section aria-label="Changes per requisition" className="space-y-2">
          <p className="text-xs text-slate-700 dark:text-slate-200">{view.counts.changing} requisitions change, {view.counts.kept} values kept because they are already filled, {view.counts.withErrors} with errors.</p>
          <div className="relative overflow-x-auto">
            <table className="w-full min-w-max text-left text-xs">
              <caption className="sr-only">Changes the bulk edit would make, per requisition</caption>
              <thead><tr className="border-b border-slate-200 dark:border-slate-700"><th scope="col" className="px-2 py-1">Requisition</th><th scope="col" className="px-2 py-1">Changes</th><th scope="col" className="px-2 py-1">Kept, already filled</th><th scope="col" className="px-2 py-1">Problems</th><th scope="col" className="px-2 py-1">Leave out</th></tr></thead>
              <tbody>{view.items.map((i) => (
                <tr key={i.id} className="border-b border-slate-100 align-top dark:border-slate-800">
                  <th scope="row" className="px-2 py-1 font-medium">{i.code}</th>
                  <td className="px-2 py-1">{i.nothing ? "Nothing" : i.changes.map((c) => <div key={c.field}>{c.field}: {c.from} to {c.to}</div>)}</td>
                  <td className="px-2 py-1">{i.kept.map((c) => <div key={c.field}>{c.field}: stays {c.from}</div>)}</td>
                  <td className="px-2 py-1">{i.errors.map((e, k) => <div key={k} className="font-semibold text-rose-800 dark:text-rose-200">Error: {e}</div>)}{i.warnings.map((w, k) => <div key={`w${k}`}>Warning: {w}</div>)}</td>
                  <td className="px-2 py-1"><input type="checkbox" aria-label={`Leave out ${i.code}`} checked={p.excluded.has(i.id)} onChange={(e) => p.onExclude(i.id, e.target.checked)} className="h-5 w-5 cursor-pointer rounded" /></td>
                </tr>))}</tbody>
            </table>
          </div>
          <label htmlFor={`${id}-reason`} className="block text-xs font-semibold">Reason{anyApproved ? " (required: approved requisitions are included)" : ""}</label>
          <textarea id={`${id}-reason`} value={p.reason} maxLength={300} rows={2} onChange={(e) => p.onReason(e.target.value)} className={`${FIELD} py-2`} />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={PRIMARY} disabled={!verdict.ok || p.busy} onClick={p.onConfirm}>4. Save on every requisition</button>
            {!verdict.ok && verdict.why && <span className="text-xs">{verdict.why}</span>}
          </div>
        </section>
      )}
      {p.error && <p role="alert" className="text-sm font-semibold text-rose-800 dark:text-rose-200">{p.error}</p>}
      {p.result && <p role="status" className="text-sm font-semibold text-emerald-800 dark:text-emerald-200">{p.result}</p>}
    </div>
  );
}

export default function BulkCriteriaDialog({ open, onOpenChange, items, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; items: RequisitionItem[]; onDone?: () => void }) {
  const [picked, setPicked] = useState<Set<string>>(() => new Set(items.filter((i) => i.approvalStatus !== "closed").map((i) => i.id)));
  const [choice, setChoice] = useState<BulkChoice>(emptyChoice());
  const [diff, setDiff] = useState<BulkRow[] | null>(null);
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toggle = (set: Set<string>, id: string, on: boolean) => { const n = new Set(set); if (on) n.add(id); else n.delete(id); return n; };
  const ids = () => [...picked].filter((x) => !excluded.has(x));
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-3xl overflow-y-auto overflow-x-hidden">
        <DialogHeader><DialogTitle>Edit criteria on several requisitions</DialogTitle>
          <DialogDescription>Each requisition gets its own version and audit entry. Filled values are kept unless you choose to replace them.</DialogDescription></DialogHeader>
        <BulkCriteriaBody items={items} picked={picked} onPick={(id, on) => { setPicked(toggle(picked, id, on)); setDiff(null); }} choice={choice} onChoice={(c) => { setChoice(c); setDiff(null); }}
          diff={diff} excluded={excluded} onExclude={(id, on) => setExcluded(toggle(excluded, id, on))} reason={reason} onReason={setReason} busy={busy} result={result} error={error}
          onShow={async () => { setBusy(true); setError(null); setResult(null); try { setDiff(await selectionApi.bulk([...picked], bulkPatch(choice), choice.replaceFilled, reason || null, true)); } catch (e) { setError((e as Error).message); } finally { setBusy(false); } }}
          onConfirm={async () => {
            setBusy(true); setError(null);
            try {
              const out = await selectionApi.bulk(ids(), bulkPatch(choice), choice.replaceFilled, reason || null, false);
              setResult(`Saved: ${out.filter((r) => r.versionId).length} requisitions got a new version, ${out.filter((r) => !r.versionId).length} unchanged.`);
              setDiff(null); onDone?.();
            } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
          }} />
      </DialogContent>
    </Dialog>
  );
}
