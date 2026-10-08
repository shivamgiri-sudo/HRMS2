/**
 * Relink a campaign to an open requisition (the K7BK case). Pick the requisition, Preview (who moves, who stays, warnings), give a reason,
 * Confirm: nothing is written before Confirm, and the server refuses when the leads changed since the preview.
 */
import { useId, useState } from "react";
import { AlertTriangle, Loader2 } from "lucide-react";
import { hrmsApi } from "@/lib/hrmsApi";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { describeError } from "./commandData";
import { BTN, FIELD, LABEL, PRIMARY } from "./StreamActions";
import { previewLines, reasonError, relinkBody, relinkPath, relinkPreviewPath, type RelinkPreview } from "./relinkModel";

export interface RelinkFormProps {
  campaignName: string; fromCode: string; options: Array<{ id: string; label: string }>; to: string; preview: RelinkPreview | null; reason: string; busy: boolean; error: string | null;
  onTo: (id: string) => void; onPreview: () => void; onReason: (r: string) => void; onConfirm: () => void; onCancel: () => void; idPrefix: string;
}

export function RelinkForm({ campaignName, fromCode, options, to, preview, reason, busy, error, onTo, onPreview, onReason, onConfirm, onCancel, idPrefix }: RelinkFormProps) {
  const id = (k: string) => `${idPrefix}-${k}`;
  const reasonBad = reasonError(reason);
  return (
    <div className="space-y-3 text-slate-900 dark:text-slate-100">
      <p className="text-sm">Campaign <span className="font-semibold">{campaignName}</span> is linked to <span className="font-semibold">{fromCode}</span>, which cannot take people.</p>
      <div className="space-y-1">
        <label htmlFor={id("to")} className={LABEL}>Open requisition to link</label>
        <select id={id("to")} className={FIELD} value={to} disabled={busy} onChange={(e) => onTo(e.target.value)}>
          <option value="">Pick an open requisition</option>
          {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <button type="button" className={BTN} disabled={busy || !to} onClick={onPreview}>Preview the move</button>
      {preview && (
        <section aria-label="Preview" className="space-y-1 rounded-lg border border-slate-200 p-3 text-sm dark:border-slate-700">
          <ul className="list-disc space-y-0.5 pl-4">{previewLines(preview).map((l) => <li key={l}>{l}</li>)}</ul>
          {preview.warnings.map((w) => (
            <p key={w} className="flex items-start gap-1.5 text-amber-900 dark:text-amber-200"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> Warning: {w}</p>
          ))}
        </section>
      )}
      {preview && (
        <div className="space-y-1">
          <label htmlFor={id("reason")} className={LABEL}>Reason (required, kept in the audit)</label>
          <textarea id={id("reason")} rows={2} maxLength={300} className={`${FIELD} py-2`} value={reason} disabled={busy} aria-invalid={!!reasonBad && reason !== ""} onChange={(e) => onReason(e.target.value)} />
        </div>
      )}
      {error && <p role="alert" className="text-sm text-rose-800 dark:text-rose-200">{error}</p>}
      <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
        <button type="button" className={BTN} disabled={busy} onClick={onCancel}>Cancel</button>
        <button type="button" className={PRIMARY} disabled={busy || !preview || !!reasonBad} onClick={onConfirm}>
          {busy ? <><Loader2 className="h-4 w-4 animate-spin motion-reduce:animate-none" aria-hidden /> Working…</> : "Confirm relink"}
        </button>
      </div>
    </div>
  );
}

export interface RelinkDialogProps {
  open: boolean; onOpenChange: (o: boolean) => void; campaign: { id: string; name: string } | null; fromCode: string;
  options: Array<{ id: string; label: string }>; onDone: (text: string) => void;
}

function RelinkPanel({ campaign, fromCode, options, onDone, onCancel }: Omit<RelinkDialogProps, "open" | "onOpenChange"> & { onCancel: () => void }) {
  const idPrefix = `rl-${useId().split(":").join("")}`;
  const [to, setTo] = useState("");
  const [preview, setPreview] = useState<RelinkPreview | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!campaign) return null;
  const run = async (fn: () => Promise<void>) => { setBusy(true); setError(null); try { await fn(); } catch (e) { setError(describeError(e)); } finally { setBusy(false); } };
  return (
    <RelinkForm campaignName={campaign.name} fromCode={fromCode} options={options} to={to} preview={preview} reason={reason} busy={busy} error={error} idPrefix={idPrefix}
      onTo={(v) => { setTo(v); setPreview(null); }} onReason={setReason} onCancel={onCancel}
      onPreview={() => void run(async () => { const r = await hrmsApi.get<{ data?: RelinkPreview }>(relinkPreviewPath(campaign.id, to)); setPreview(r?.data ?? null); })}
      onConfirm={() => void run(async () => {
        if (!preview) return;
        const r = await hrmsApi.post<{ data?: { moved: number; kept: number } }>(relinkPath(campaign.id), relinkBody(preview, reason));
        onDone(`Relinked to ${preview.toCode}: ${r?.data?.moved ?? 0} moved, ${r?.data?.kept ?? 0} stayed`);
      })} />
  );
}

export default function RelinkDialog({ open, onOpenChange, ...rest }: RelinkDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-screen max-w-xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Relink to an open requisition</DialogTitle>
          <DialogDescription className="text-slate-700 dark:text-slate-200">Preview first. Nothing changes until you confirm; people already contacted are never moved.</DialogDescription>
        </DialogHeader>
        {open && <RelinkPanel {...rest} onCancel={() => onOpenChange(false)} />}
      </DialogContent>
    </Dialog>
  );
}
