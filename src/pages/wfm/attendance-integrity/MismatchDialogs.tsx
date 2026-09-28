import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { hrmsApi } from "@/lib/hrmsApi";
import {
  FINAL_STATUSES, LWP_BY_STATUS, fmtDate, fmtMinutes, sourceChoices, statusLabel,
  type MismatchRecord,
} from "./mismatchTypes";

type DialogProps = {
  record: MismatchRecord | null;
  onClose: () => void;
  onDone: () => void;
};

function errorText(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

function RecordHeader({ record }: { record: MismatchRecord }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-semibold text-slate-900">{record.employee_name}</span> ({record.employee_code})
      {" · "}{fmtDate(record.record_date)}
    </p>
  );
}

/** One-click resolve: pick which source is right (or another status), give a reason, save. */
export function ResolveDialog({ record, onClose, onDone }: DialogProps) {
  const { toast } = useToast();
  const [finalStatus, setFinalStatus] = useState("");
  const [lwp, setLwp] = useState(0);
  const [reason, setReason] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!record) return;
    const rec = record.escalation?.status === "recommended" ? record.escalation.recommended_status : null;
    const initial = rec ?? "";
    setFinalStatus(initial);
    setLwp(LWP_BY_STATUS[initial] ?? 0);
    setReason(rec ? `Manager (${record.escalation?.escalated_to_name ?? "reporting manager"}) recommended ${statusLabel(rec)}: ${record.escalation?.recommendation_note ?? ""}` : "");
  }, [record]);

  if (!record) return null;
  const choices = sourceChoices(record);

  function pick(status: string) {
    setFinalStatus(status);
    setLwp(LWP_BY_STATUS[status] ?? 0);
  }

  async function save() {
    if (!record || !finalStatus || !reason.trim()) return;
    setSaving(true);
    try {
      const res = await hrmsApi.patch<{ success: boolean; message?: string }>(
        `/api/wfm/mismatches/${record.id}/resolve`,
        { final_status: finalStatus, lwp_value: lwp, reason: reason.trim() },
      );
      if (!res.success) throw new Error(res.message ?? "Failed to resolve");
      toast({ title: "Resolved", description: `${record.employee_name} marked ${statusLabel(finalStatus)}` });
      onDone();
    } catch (err) {
      toast({ title: errorText(err, "Failed to resolve"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Resolve attendance</DialogTitle>
          <DialogDescription asChild><div><RecordHeader record={record} /></div></DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-1">
          {choices.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => pick(c.status)}
                  className={`rounded-lg border p-3 text-left transition-colors ${
                    finalStatus === c.status ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 hover:bg-slate-50"
                  }`}
                >
                  <p className="text-xs text-slate-500">{c.label}</p>
                  <p className="text-sm font-bold text-slate-900">{statusLabel(c.status)}</p>
                  <p className="text-xs text-slate-500">{fmtMinutes(c.minutes)}</p>
                </button>
              ))}
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Final status</Label>
              <Select value={finalStatus} onValueChange={pick}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {FINAL_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Loss of pay</Label>
              <Select value={String(lwp)} onValueChange={(v) => setLwp(Number(v))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="0">0 — full day paid</SelectItem>
                  <SelectItem value="0.5">0.5 — half day LWP</SelectItem>
                  <SelectItem value="1">1 — full day LWP</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="space-y-1.5">
            <Label>Reason <span className="text-red-500">*</span></Label>
            <Textarea rows={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why this status was chosen…" />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} disabled={saving || !finalStatus || !reason.trim()}>{saving ? "Saving…" : "Save"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** WFM/HR asks the employee's reporting manager for a recommendation (or pushes it up a level). */
export function EscalateDialog({ record, onClose, onDone }: DialogProps) {
  const { toast } = useToast();
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setNote(""); }, [record]);
  if (!record) return null;
  const isFollowUp = Boolean(record.escalation?.is_overdue);

  async function send() {
    if (!record) return;
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; message?: string; data?: { escalated_to_name?: string } }>(
        `/api/wfm/mismatches/${record.id}/escalate`,
        { note: note.trim() || undefined },
      );
      if (!res.success) throw new Error(res.message ?? "Failed to escalate");
      toast({ title: "Escalated", description: `Sent to ${res.data?.escalated_to_name ?? "the reporting manager"}` });
      onDone();
    } catch (err) {
      toast({ title: errorText(err, "Failed to escalate"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isFollowUp ? "Escalate to skip-level manager" : "Escalate to reporting manager"}</DialogTitle>
          <DialogDescription asChild><div><RecordHeader record={record} /></div></DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5 py-1">
          <p className="text-sm text-slate-600">
            {isFollowUp
              ? "The reporting manager has not responded in time. This sends the same request to their manager."
              : "The reporting manager gets an inbox alert and recommends a status. You still make the final decision."}
          </p>
          <Label>Note for the manager (optional)</Label>
          <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Anything the manager should know…" />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={saving}>{saving ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** The escalated manager records what they think the day should be. */
export function RespondDialog({ record, onClose, onDone }: DialogProps) {
  const { toast } = useToast();
  const [status, setStatus] = useState("");
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => { setStatus(""); setNote(""); }, [record]);
  if (!record) return null;
  const choices = sourceChoices(record);

  async function send() {
    if (!record || !status || !note.trim()) return;
    setSaving(true);
    try {
      const res = await hrmsApi.post<{ success: boolean; message?: string }>(
        `/api/wfm/mismatches/${record.id}/manager-response`,
        { recommended_status: status, note: note.trim() },
      );
      if (!res.success) throw new Error(res.message ?? "Failed to send response");
      toast({ title: "Recommendation sent to WFM" });
      onDone();
    } catch (err) {
      toast({ title: errorText(err, "Failed to send response"), variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Your recommendation</DialogTitle>
          <DialogDescription asChild><div><RecordHeader record={record} /></div></DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          {choices.length > 0 && (
            <div className="grid grid-cols-2 gap-3">
              {choices.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setStatus(c.status)}
                  className={`rounded-lg border p-3 text-left ${status === c.status ? "border-blue-500 bg-blue-50 ring-1 ring-blue-500" : "border-slate-200 hover:bg-slate-50"}`}
                >
                  <p className="text-xs text-slate-500">{c.label}</p>
                  <p className="text-sm font-bold text-slate-900">{statusLabel(c.status)}</p>
                  <p className="text-xs text-slate-500">{fmtMinutes(c.minutes)}</p>
                </button>
              ))}
            </div>
          )}
          <div className="space-y-1.5">
            <Label>Recommended status</Label>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
              <SelectContent>
                {FINAL_STATUSES.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label>Why <span className="text-red-500">*</span></Label>
            <Textarea rows={3} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What do you know about this day?" />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={send} disabled={saving || !status || !note.trim()}>{saving ? "Sending…" : "Send"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
