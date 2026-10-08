/**
 * "Mark confirmed" after an off-system call or at the desk: requisition (prefilled when known), the answer, how it was given and a short
 * note. It records an HR response and runs the same booking path as the candidate's own tap. Shown to write roles only (the server
 * refuses others too). ManualConfirmForm is presentational; the dialog owns the request.
 */
import { useEffect, useId, useState } from "react";
import { Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { BTN } from "../command/charts/ChartFrame";
import { MANUAL_ANSWERS, MANUAL_PATH, MANUAL_VIA, doneText, formErrors, initialForm, manualBody, slotLine, type ManualForm, type ManualTarget, type RequisitionChoice } from "./manualConfirmModel";
import { actionError } from "./responsesModel";

const PRIMARY = "inline-flex min-h-11 cursor-pointer items-center gap-1.5 rounded-lg bg-blue-700 px-4 text-sm font-semibold text-white transition-colors duration-150 hover:bg-blue-800 disabled:cursor-not-allowed disabled:opacity-60 motion-reduce:transition-none focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2 sm:min-h-9";
const FIELD = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 dark:border-slate-600 dark:bg-slate-900 dark:text-slate-100 sm:min-h-9";

export interface ManualConfirmFormProps {
  target: ManualTarget; choices: RequisitionChoice[]; form: ManualForm; errors: string[]; showErrors: boolean; busy: boolean; serverError: string | null;
  onChange: (f: ManualForm) => void; onSubmit: () => void; onCancel: () => void;
}

export function ManualConfirmForm({ target, choices, form, errors, showErrors, busy, serverError, onChange, onSubmit, onCancel }: ManualConfirmFormProps) {
  const id = `mc-${useId().replaceAll(":", "")}`;
  const locked = !!target.requisitionId;
  return (
    <form noValidate aria-busy={busy} onSubmit={(e) => { e.preventDefault(); onSubmit(); }} className="space-y-4">
      {locked ? (
        <p className="text-sm text-slate-800 dark:text-slate-100"><span className="font-semibold">Requisition: </span>{choices.find((c) => c.id === form.requisitionId)?.label ?? "the drive's requisition"}</p>
      ) : (
        <div className="space-y-1">
          <label htmlFor={`${id}-req`} className="text-sm font-semibold text-slate-900 dark:text-slate-100">Requisition</label>
          <select id={`${id}-req`} className={FIELD} value={form.requisitionId} onChange={(e) => onChange({ ...form, requisitionId: e.target.value })}>
            <option value="">Pick a requisition</option>
            {choices.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </div>
      )}
      <fieldset className="space-y-1">
        <legend className="text-sm font-semibold text-slate-900 dark:text-slate-100">What did the candidate say?</legend>
        <div className="flex flex-wrap gap-2">
          {MANUAL_ANSWERS.map((a) => (
            <label key={a.id} className="inline-flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border border-slate-300 px-3 text-sm text-slate-900 focus-within:ring-2 focus-within:ring-blue-500 dark:border-slate-600 dark:text-slate-100 sm:min-h-9">
              <input type="radio" name={`${id}-answer`} value={a.id} checked={form.answer === a.id} onChange={() => onChange({ ...form, answer: a.id })} /> {a.label}
            </label>
          ))}
        </div>
      </fieldset>
      <div className="space-y-1">
        <label htmlFor={`${id}-via`} className="text-sm font-semibold text-slate-900 dark:text-slate-100">How</label>
        <select id={`${id}-via`} className={FIELD} value={form.via} onChange={(e) => onChange({ ...form, via: e.target.value as ManualForm["via"] })}>
          {MANUAL_VIA.map((v) => <option key={v.id} value={v.id}>{v.label}</option>)}
        </select>
      </div>
      <div className="space-y-1">
        <label htmlFor={`${id}-note`} className="text-sm font-semibold text-slate-900 dark:text-slate-100">Note (required)</label>
        <textarea id={`${id}-note`} rows={3} maxLength={300} className={`${FIELD} py-2`} value={form.note} onChange={(e) => onChange({ ...form, note: e.target.value })}
          aria-describedby={`${id}-count`} />
        <p id={`${id}-count`} className="text-xs text-slate-600 dark:text-slate-300">{form.note.trim().length} of 300 characters</p>
      </div>
      <p className="rounded-lg bg-slate-50 px-3 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100" data-slot-line>{slotLine(target, form)}</p>
      {showErrors && errors.length > 0 && (
        <ul role="alert" className="list-disc space-y-0.5 pl-5 text-sm text-rose-800 dark:text-rose-200">{errors.map((e) => <li key={e}>{e}</li>)}</ul>
      )}
      {serverError && <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">{serverError}</p>}
      <div className="flex flex-wrap justify-end gap-2">
        <button type="button" className={BTN} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="submit" className={PRIMARY} disabled={busy}>{busy ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Saving…</> : "Save answer"}</button>
      </div>
    </form>
  );
}

export interface ManualConfirmDialogProps { target: ManualTarget | null; choices?: RequisitionChoice[]; onClose: () => void; onDone?: (text: string) => void }

export default function ManualConfirmDialog({ target, choices = [], onClose, onDone }: ManualConfirmDialogProps) {
  const [form, setForm] = useState<ManualForm>(() => initialForm(target ?? { name: "" }, choices));
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  useEffect(() => { if (target) { setForm(initialForm(target, choices)); setTried(false); setServerError(null); } }, [target]); // eslint-disable-line react-hooks/exhaustive-deps
  const errors = formErrors(form);
  const submit = async () => {
    setTried(true);
    if (errors.length || !target || busy) return;
    setBusy(true); setServerError(null);
    try {
      const r = await hrmsApi.post<{ data?: { state?: string } }>(MANUAL_PATH, manualBody(target, form));
      onDone?.(doneText(String(r?.data?.state ?? "")));
      onClose();
    } catch (e: unknown) { setServerError(actionError(e)); } finally { setBusy(false); }
  };
  return (
    <Dialog open={target != null} onOpenChange={(o) => { if (!o && !busy) onClose(); }}>
      <DialogContent className="max-h-screen max-w-lg overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Record an answer for {target?.name ?? "the candidate"}</DialogTitle>
          <DialogDescription className="text-slate-700 dark:text-slate-200">For answers given on a phone call or at the desk. The booking changes the same way as when the candidate taps a button.</DialogDescription>
        </DialogHeader>
        {target && <ManualConfirmForm target={target} choices={choices} form={form} errors={errors} showErrors={tried} busy={busy} serverError={serverError}
          onChange={setForm} onSubmit={() => void submit()} onCancel={onClose} />}
      </DialogContent>
    </Dialog>
  );
}
