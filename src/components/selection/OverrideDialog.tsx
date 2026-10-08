/** Include / leave out one person for a requisition (S19): the reason is mandatory; a system exclusion cannot be overridden and the
 * server's warning is shown as text. */
import { useId, useState } from "react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PRIMARY } from "./CriteriaEditorBody";
import { FIELD } from "./RuleRow";
import { overrideCheck } from "./approvalModel";
import { selectionApi } from "./selectionApi";

export interface OverrideBodyProps { maskedMobile: string; code: string; kind: "include" | "exclude"; onKind: (k: "include" | "exclude") => void; reason: string; onReason: (s: string) => void;
  busy: boolean; warning: string | null; error: string | null; done: boolean; onSave: () => void }

export function OverrideBody(p: OverrideBodyProps) {
  const id = useId();
  const v = overrideCheck(p.reason);
  return (
    <div className="space-y-3 text-sm text-slate-900 dark:text-slate-100">
      <p>{p.maskedMobile} for {p.code}</p>
      <fieldset className="space-y-1">
        <legend className="text-xs font-semibold">Decision</legend>
        {(["include", "exclude"] as const).map((k) => (
          <label key={k} className="flex min-h-11 cursor-pointer items-center gap-2 sm:min-h-9">
            <input type="radio" name={`${id}-kind`} checked={p.kind === k} onChange={() => p.onKind(k)} className="h-5 w-5 cursor-pointer" />
            {k === "include" ? "Include: shortlist even if a rule fails" : "Leave out: never shortlist for this requisition"}
          </label>
        ))}
      </fieldset>
      <label htmlFor={`${id}-r`} className="block text-xs font-semibold">Reason (required)</label>
      <textarea id={`${id}-r`} value={p.reason} maxLength={300} rows={3} onChange={(e) => p.onReason(e.target.value)} className={`${FIELD} py-2`} aria-describedby={`${id}-h`} />
      <p id={`${id}-h`} className="text-xs text-slate-600 dark:text-slate-300">Kept in the person's history with your name. System rules (employees, opted out, cooling-off and so on) still apply.</p>
      {p.warning && <p role="alert" className="rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100">Saved, but this person is still not contacted: {p.warning}</p>}
      {p.error && <p role="alert" className="font-semibold text-rose-800 dark:text-rose-200">{p.error}</p>}
      {p.done && !p.warning && <p role="status" className="font-semibold text-emerald-800 dark:text-emerald-200">Saved</p>}
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={PRIMARY} disabled={!v.ok || p.busy} onClick={p.onSave}>Save decision</button>
        {!v.ok && <span className="text-xs">{v.why}</span>}
      </div>
    </div>
  );
}

export default function OverrideDialog({ open, onOpenChange, mobile, maskedMobile, requisitionId, code, onDone }:
  { open: boolean; onOpenChange: (o: boolean) => void; mobile: string; maskedMobile: string; requisitionId: string; code: string; onDone?: () => void }) {
  const [kind, setKind] = useState<"include" | "exclude">("include");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const save = async () => {
    setBusy(true); setError(null); setWarning(null);
    try { const r = await selectionApi.setOverride(mobile, requisitionId, kind, reason.trim()); setWarning(r.warning); setDone(true); onDone?.(); }
    catch (e) { setError((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90vh] w-[calc(100vw-2rem)] max-w-lg overflow-y-auto">
        <DialogHeader><DialogTitle>Override for one person</DialogTitle><DialogDescription>Include or leave out this person for this requisition only.</DialogDescription></DialogHeader>
        <OverrideBody maskedMobile={maskedMobile} code={code} kind={kind} onKind={setKind} reason={reason} onReason={setReason} busy={busy} warning={warning} error={error} done={done} onSave={save} />
      </DialogContent>
    </Dialog>
  );
}
