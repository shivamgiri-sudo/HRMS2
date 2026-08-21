import { useState } from "react";
import { CalendarClock, Check, Loader2, ShieldQuestion, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { usePendingLeaveConsents, useDecideLeaveConsent, type ManagerRaisedLeave } from "@/hooks/useLeaveOnBehalf";

/**
 * "Your manager raised leave for you — approve or decline." Sits at the top of the
 * employee's own Leave Requests page. Renders nothing when there's nothing pending, so
 * it costs the page one query for everyone who has never had this happen to them.
 */
export function LeaveConsentBanner() {
  const { data, isLoading } = usePendingLeaveConsents();
  const pending = (data ?? []).filter((r) => r.consent_status === "pending_employee_consent");

  if (isLoading || pending.length === 0) return null;

  return (
    <div className="space-y-2 rounded-2xl border border-indigo-200 bg-indigo-50 p-4">
      <div className="flex items-center gap-2">
        <ShieldQuestion className="h-4 w-4 text-indigo-700" />
        <h2 className="text-sm font-semibold text-indigo-900">
          {pending.length === 1 ? "Your manager raised a leave request for you" : `Your manager raised ${pending.length} leave requests for you`}
        </h2>
      </div>
      <p className="text-xs text-indigo-700">
        Nothing has been submitted yet. Review each one — it only goes to your approver if you say yes.
      </p>
      <div className="space-y-2">
        {pending.map((r) => <ConsentRow key={r.id} row={r} />)}
      </div>
    </div>
  );
}

function ConsentRow({ row }: { row: ManagerRaisedLeave }) {
  const { toast } = useToast();
  const decide = useDecideLeaveConsent();
  const [declining, setDeclining] = useState(false);
  const [reason, setReason] = useState("");

  async function act(decision: "approve" | "decline") {
    try {
      await decide.mutateAsync({ id: row.id, decision, reason: decision === "decline" ? reason.trim() || undefined : undefined });
      toast({
        title: decision === "approve" ? "Submitted for approval" : "Declined",
        description: decision === "approve"
          ? "It's now in the normal leave approval queue, same as if you'd applied yourself."
          : "Your manager has been told you declined.",
      });
      setDeclining(false);
    } catch (e) {
      toast({
        title: "Could not record your decision",
        description: e instanceof Error ? e.message : "Try again.",
        variant: "destructive",
      });
    }
  }

  return (
    <div className="rounded-xl border border-indigo-100 bg-white p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm text-slate-700">
          <CalendarClock className="h-3.5 w-3.5 text-slate-400" />
          <span className="font-medium">{row.leave_name ?? "Leave"}</span>
          <span className="text-slate-400">·</span>
          <span>{row.payload.fromDate} – {row.payload.toDate}</span>
          <span className="text-slate-400">({row.payload.totalDays} day{row.payload.totalDays !== 1 ? "s" : ""})</span>
        </div>
        {!declining && (
          <div className="flex items-center gap-2">
            <Button size="sm" variant="outline" className="h-7 text-xs" onClick={() => setDeclining(true)} disabled={decide.isPending}>
              <X className="mr-1 h-3 w-3" /> Decline
            </Button>
            <Button size="sm" className="h-7 text-xs bg-emerald-600 hover:bg-emerald-700" onClick={() => act("approve")} disabled={decide.isPending}>
              {decide.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Check className="mr-1 h-3 w-3" />}
              Approve & submit
            </Button>
          </div>
        )}
      </div>
      {row.payload.reason && (
        <p className="mt-1 text-xs text-slate-500">Raised by {row.raised_by_name ?? "your manager"} — "{row.payload.reason}"</p>
      )}
      {declining && (
        <div className="mt-2 space-y-2">
          <Textarea
            value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="Optional — let them know why" rows={2} className="text-xs"
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="ghost" className="h-7 text-xs" onClick={() => setDeclining(false)}>Cancel</Button>
            <Button size="sm" variant="destructive" className="h-7 text-xs" onClick={() => act("decline")} disabled={decide.isPending}>
              {decide.isPending ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : null}
              Confirm decline
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
