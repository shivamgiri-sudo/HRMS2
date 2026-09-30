import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail, Send } from "lucide-react";
import { ErrorBox, Skeleton, btn } from "../ui";
import { alertsKey, fetchDigests, saveDigest, sendDigestNow, testDigest, type Digest, type DigestInput, type SendSummary } from "./api";
import { errMsg, field, primaryBtn, when } from "./alertUi";
import { RecipientPicker } from "./RecipientPicker";

type Freq = "daily" | "weekly";
const EMPTY = (frequency: Freq): DigestInput => ({ frequency, sendTime: "08:00", recipients: { roles: [], tls: [], employeeIds: [] }, enabled: false });

function DigestCard({ processId, frequency, saved, tlOptions, canManage }: { processId: string; frequency: Freq; saved?: Digest; tlOptions: string[]; canManage: boolean }) {
  const qc = useQueryClient();
  const [f, setF] = useState<DigestInput>(() => (saved ? { frequency, sendTime: saved.sendTime, recipients: saved.recipients, enabled: saved.enabled } : EMPTY(frequency)));
  const [preview, setPreview] = useState<SendSummary | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const inv = () => void qc.invalidateQueries({ queryKey: alertsKey(processId, "digests") });
  const save = useMutation({ mutationFn: () => saveDigest(processId, f), onSuccess: () => { setMsg("Saved."); inv(); } });
  const test = useMutation({ mutationFn: () => testDigest(processId, frequency), onSuccess: (r) => { setPreview(r); setMsg(`Test digest sent to you only (${r.email} e-mail${r.emailSkippedNoAddress ? ", you have no official e-mail on file" : ""}).`); } });
  const now = useMutation({ mutationFn: () => sendDigestNow(processId, frequency), onSuccess: (r) => { setMsg(`Sent to ${r.email} recipient${r.email === 1 ? "" : "s"}${r.dropped ? `, ${r.dropped} skipped (no access)` : ""}.`); inv(); } });
  const hasRecipients = f.recipients.roles.length + f.recipients.tls.length + f.recipients.employeeIds.length > 0;
  const title = frequency === "daily" ? "Daily digest" : "Weekly digest (Mondays)";
  const err = save.error ?? test.error ?? now.error;
  return (
    <section aria-label={title} className="space-y-3 rounded-2xl border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-sm font-bold text-slate-900"><Mail className="h-4 w-4" aria-hidden="true" />{title}</h3>
        <label className="inline-flex min-h-[36px] cursor-pointer items-center gap-2 text-xs font-semibold text-slate-900"><input type="checkbox" role="switch" checked={f.enabled} disabled={!canManage} onChange={(e) => setF({ ...f, enabled: e.target.checked })} className="h-4 w-4" />Enabled<span className="sr-only"> {title}</span></label>
      </div>
      <p className="text-xs text-slate-700">Key KPIs with change versus the previous period, anomalies, top and bottom performers, and a link to the dashboard.{saved?.lastSentAt ? ` Last sent ${when(saved.lastSentAt)}.` : ""}</p>
      <div className="max-w-[200px]"><label htmlFor={`dg-${frequency}-t`} className="mb-1 block text-xs font-bold text-slate-800">Send at (server time)</label>
        <input id={`dg-${frequency}-t`} type="time" className={field} value={f.sendTime} disabled={!canManage} onChange={(e) => e.target.value && setF({ ...f, sendTime: e.target.value })} /></div>
      {canManage ? <RecipientPicker processId={processId} value={f.recipients} onChange={(recipients) => setF({ ...f, recipients })} tlOptions={tlOptions} />
        : <p className="text-xs text-slate-700">{hasRecipients ? "Recipients are set by a process admin." : "No recipients set."}</p>}
      {err && <ErrorBox message={errMsg(err)} />}
      <div role="status" aria-live="polite" className="text-xs font-semibold text-emerald-800">{msg}</div>
      {canManage && (
        <div className="flex flex-wrap gap-2">
          <button type="button" className={primaryBtn} disabled={save.isPending || (f.enabled && !hasRecipients)} onClick={() => { setMsg(null); save.mutate(); }}>{save.isPending ? "Saving…" : "Save digest"}</button>
          <button type="button" className={btn} disabled={test.isPending} onClick={() => { setMsg(null); test.mutate(); }}><Send className="h-3.5 w-3.5" aria-hidden="true" />{test.isPending ? "Building…" : "Send test to me"}</button>
          <button type="button" className={btn} disabled={now.isPending || !saved || !hasRecipients} onClick={() => { setMsg(null); now.mutate(); }}>Send now to recipients</button>
        </div>
      )}
      {preview?.html && (
        <div><p className="mb-1 text-xs font-bold text-slate-800">Preview: {preview.subject}</p>
          <iframe title={`${title} preview`} sandbox="" srcDoc={preview.html} className="h-[480px] w-full rounded-lg border border-slate-200 bg-white" /></div>
      )}
    </section>
  );
}

export function DigestPanel({ processId, tlOptions, canManage }: { processId: string; tlOptions: string[]; canManage: boolean }) {
  const q = useQuery({ queryKey: alertsKey(processId, "digests"), queryFn: () => fetchDigests(processId) });
  if (q.isLoading) return <div className="space-y-3"><Skeleton className="h-40" /><Skeleton className="h-40" /></div>;
  if (q.isError) return <ErrorBox message={errMsg(q.error, "Could not load digests.")} onRetry={() => void q.refetch()} />;
  const by = (f: Freq) => q.data?.find((d) => d.frequency === f);
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      {(["daily", "weekly"] as Freq[]).map((f) => <DigestCard key={f} processId={processId} frequency={f} saved={by(f)} tlOptions={tlOptions} canManage={canManage} />)}
    </div>
  );
}
