/** Templates by process and copy-from-requisition (S16). Both show what they would change first (server dry run), then apply. */
import { useEffect, useId, useState } from "react";
import { FIELD, SMALL_BTN } from "./RuleRow";
import { skippedText } from "./criteriaEditorModel";
import { selectionApi } from "./selectionApi";
import type { BulkRow, RequisitionItem } from "./selectionTypes";

const errText = (e: unknown) => (e as { message?: string })?.message ?? "Something went wrong";
const fieldWord = (f: string) => f.replace(/_/g, " ");

export default function EditorTools({ requisitionId, reason, approved, onApplied }: { requisitionId: string; reason: string; approved: boolean; onApplied: (text: string) => void | Promise<void> }) {
  const id = useId();
  const [templates, setTemplates] = useState<Array<{ id: string; label: string }>>([]);
  const [others, setOthers] = useState<RequisitionItem[]>([]);
  const [tpl, setTpl] = useState("");
  const [from, setFrom] = useState("");
  const [note, setNote] = useState<string | null>(null);
  const [copyDiff, setCopyDiff] = useState<BulkRow | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    selectionApi.templates().then(setTemplates).catch(() => setTemplates([]));
    selectionApi.list().then((r) => setOthers(r.items.filter((i) => i.id !== requisitionId))).catch(() => setOthers([]));
  }, [requisitionId]);
  const needReason = approved && !reason.trim();
  const run = async (fn: () => Promise<void>) => { setBusy(true); setNote(null); try { await fn(); } catch (e) { setNote(errText(e)); } finally { setBusy(false); } };

  return (
    <section aria-label="Templates and copy" className="grid gap-3 rounded-lg border border-slate-200 p-3 dark:border-slate-700 sm:grid-cols-2">
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-tpl`} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Start from a template (fills empty fields only)</label>
        <select id={`${id}-tpl`} value={tpl} onChange={(e) => { setTpl(e.target.value); setNote(null); }} className={FIELD}>
          <option value="">Choose a template</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={SMALL_BTN} disabled={!tpl || busy} onClick={() => run(async () => {
            const r = await selectionApi.applyTemplate(requisitionId, tpl, false, reason || null, true);
            setNote(`${r.changed.length ? `Would change: ${r.changed.map(fieldWord).join(", ")}.` : "Nothing would change."} ${skippedText(r.skipped)}`.trim());
          })}>See what it changes</button>
          <button type="button" className={SMALL_BTN} disabled={!tpl || busy || needReason} title={needReason ? "Write a reason first" : undefined} onClick={() => run(async () => {
            const r = await selectionApi.applyTemplate(requisitionId, tpl, false, reason || null, false);
            await onApplied(r.versionNo ? `Template applied: version ${r.versionNo}` : "The template changed nothing");
          })}>Apply template</button>
        </div>
      </div>
      <div className="min-w-0 space-y-1">
        <label htmlFor={`${id}-from`} className="block text-xs font-semibold text-slate-700 dark:text-slate-200">Copy every rule from another requisition</label>
        <select id={`${id}-from`} value={from} onChange={(e) => { setFrom(e.target.value); setCopyDiff(null); }} className={FIELD}>
          <option value="">Choose a requisition</option>
          {others.map((o) => <option key={o.id} value={o.id}>{o.code} · {o.branch}{o.process ? ` · ${o.process}` : ""}</option>)}
        </select>
        <div className="flex flex-wrap gap-1">
          <button type="button" className={SMALL_BTN} disabled={!from || busy} onClick={() => run(async () => setCopyDiff((await selectionApi.copy(from, [requisitionId], "all", true, reason || null, true))[0] ?? null))}>See what it changes</button>
          <button type="button" className={SMALL_BTN} disabled={!from || busy || needReason} onClick={() => run(async () => {
            const r = (await selectionApi.copy(from, [requisitionId], "all", true, reason || null, false))[0];
            if (r?.issues.some((i) => i.level === "error")) { setCopyDiff(r); return; }
            await onApplied(r?.versionId ? "Copied" : "Nothing to copy");
          })}>Copy</button>
        </div>
        {copyDiff && (
          <ul className="text-xs text-slate-700 dark:text-slate-200">
            {copyDiff.diff.length ? copyDiff.diff.map((d) => <li key={d.field}>{fieldWord(d.field)}: {JSON.stringify(d.from)} to {JSON.stringify(d.to)}</li>) : <li>Nothing would change.</li>}
            {copyDiff.issues.map((i, k) => <li key={k} className="font-semibold">{i.level === "error" ? "Error" : "Warning"}: {i.text}</li>)}
          </ul>
        )}
      </div>
      {note && <p role="status" className="text-xs text-slate-700 dark:text-slate-200 sm:col-span-2">{note}</p>}
      {needReason && <p className="text-xs text-slate-600 dark:text-slate-300 sm:col-span-2">This requisition is approved: write the reason below before applying.</p>}
    </section>
  );
}
