import { LobBadge } from "@/components/wfm/LobBadge";
import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, XCircle } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useSubmissionAction, useSubmissionDetail, type SubmissionAction, type SubmissionDetail } from "@/hooks/useTeamRoster";
import { AUDIT_ACTION_LABEL, LINE_STATUS_META, STATUS_META, formatDmy, formatDmyTime, unpackError } from "./teamRosterFormat";

const MIN_REMARKS = 8;

function SectionLabel({ children }: { children: React.ReactNode }) {
  return <p className="mb-2 text-xs font-bold uppercase tracking-wide text-slate-400">{children}</p>;
}
const None = () => <p className="text-sm text-slate-400">None</p>;

type StepState = "done" | "rejected" | "skipped" | "current" | "waiting";

/** The four-step approval path, derived from the submission's recorded decisions. */
export function approvalSteps(s: SubmissionDetail["submission"]): Array<{ label: string; state: StepState; note: string | null }> {
  const managerState: StepState = s.managerStepSkipped ? "skipped"
    : s.managerDecision?.decision === "approved" ? "done"
    : s.managerDecision?.decision === "rejected" ? "rejected"
    : s.status === "pending_manager" ? "current" : "waiting";
  const wfmState: StepState = s.wfmDecision?.decision === "approved" ? "done"
    : s.wfmDecision?.decision === "rejected" ? "rejected"
    : s.status === "pending_wfm" ? "current" : "waiting";
  const applied = s.status === "applied" || s.status === "partially_applied";
  return [
    { label: "Submitted", state: s.submittedAt ? "done" : "waiting", note: s.submittedAt ? formatDmyTime(s.submittedAt) : null },
    {
      label: s.managerApprover ? `Manager: ${s.managerApprover.name}` : "Manager",
      state: managerState,
      note: s.managerStepSkipped ? "No reporting manager, step skipped" : s.managerDecision ? `${formatDmyTime(s.managerDecision.at)}${s.managerDecision.remarks ? ` - ${s.managerDecision.remarks}` : ""}` : null,
    },
    { label: "WFM (final)", state: wfmState, note: s.wfmDecision ? `${formatDmyTime(s.wfmDecision.at)}${s.wfmDecision.remarks ? ` - ${s.wfmDecision.remarks}` : ""}` : null },
    { label: "Applied to roster", state: applied ? "done" : s.status === "rejected" || s.status === "cancelled" ? "skipped" : "waiting", note: s.appliedAt ? formatDmyTime(s.appliedAt) : null },
  ];
}

const STEP_ICON: Record<StepState, React.ReactNode> = {
  done: <CheckCircle2 className="h-4 w-4 text-emerald-600" aria-hidden />,
  rejected: <XCircle className="h-4 w-4 text-red-600" aria-hidden />,
  skipped: <MinusCircle className="h-4 w-4 text-slate-400" aria-hidden />,
  current: <Loader2 className="h-4 w-4 text-blue-600" aria-hidden />,
  waiting: <Circle className="h-4 w-4 text-slate-300" aria-hidden />,
};

export function DrawerBody({ detail, busy, onAction }: {
  detail: SubmissionDetail; busy: boolean; onAction: (action: SubmissionAction, remarks?: string) => void;
}) {
  const [remarks, setRemarks] = useState("");
  const { submission: s, permissions: p, lines, summary, timeline } = detail;
  const canDecide = p.canManagerDecide || p.canWfmDecide;
  const step = p.canManagerDecide ? "manager" : "wfm";
  const remarksOk = remarks.trim().length >= MIN_REMARKS;
  const warned = lines.filter((l) => l.warnings.length > 0);

  return (
    <div className="space-y-6">
      <section>
        <SectionLabel>Overview</SectionLabel>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
          <div><dt className="text-xs text-slate-400">Submitted by</dt><dd>{s.submitter.name}{s.submitter.code ? ` (${s.submitter.code})` : ""}</dd></div>
          <div><dt className="text-xs text-slate-400">Period</dt><dd>{formatDmy(s.from)} to {formatDmy(s.to)}</dd></div>
          <div><dt className="text-xs text-slate-400">Changes</dt><dd>{summary.total} ({summary.applied} applied, {summary.skipped} skipped, {summary.failed} failed)</dd></div>
          <div><dt className="text-xs text-slate-400">Note</dt><dd>{s.note || "None"}</dd></div>
        </dl>
      </section>

      <section>
        <SectionLabel>Approval progress</SectionLabel>
        <ol className="space-y-2">
          {approvalSteps(s).map((st) => (
            <li key={st.label} className="flex items-start gap-2 text-sm">
              <span className="mt-0.5">{STEP_ICON[st.state]}</span>
              <span><span className={st.state === "waiting" ? "text-slate-400" : "font-medium text-slate-800"}>{st.label}</span>{st.note && <span className="block text-xs text-slate-500">{st.note}</span>}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <SectionLabel>Warnings for approvers</SectionLabel>
        {warned.length === 0 ? <None /> : (
          <ul className="space-y-1 text-sm">
            {warned.map((l) => (
              <li key={l.id} className="flex items-start gap-2 rounded-md bg-amber-50 px-2 py-1.5 text-amber-900">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                <span><span className="font-medium">{l.employeeName} {formatDmy(l.date)}:</span> {l.warnings.join(" ")}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <SectionLabel>Changes ({lines.length})</SectionLabel>
        {lines.length === 0 ? <None /> : (
          <div className="overflow-x-auto rounded-lg border">
            <table className="w-full text-xs">
              <thead className="bg-slate-50 text-left text-slate-500"><tr><th className="px-2 py-1.5">Employee</th><th className="px-2 py-1.5">LOB</th><th className="px-2 py-1.5">Date</th><th className="px-2 py-1.5">Change</th><th className="px-2 py-1.5">Result</th></tr></thead>
              <tbody>
                {lines.map((l) => (
                  <tr key={l.id} className="border-t align-top">
                    <td className="px-2 py-1.5"><div className="font-medium">{l.employeeName}</div><div className="text-slate-400">{l.employeeCode}</div></td>
                    <td className="px-2 py-1.5"><LobBadge name={l.lobName} /></td>
                    <td className="px-2 py-1.5 whitespace-nowrap">{formatDmy(l.date)}</td>
                    <td className="px-2 py-1.5">
                      {l.kind === "CHANGE"
                        ? <span><span className="text-slate-400 line-through">{l.old?.label || l.old?.type || "Unassigned"}</span> <span aria-hidden>{"->"}</span> <span className="font-semibold">{l.new.label || l.new.type}</span></span>
                        : <span><span className="text-slate-400">Blank</span> <span aria-hidden>{"->"}</span> <span className="font-semibold">{l.new.label || l.new.type}</span></span>}
                      {l.reason && <div className="mt-0.5 text-slate-500">Reason: {l.reason}</div>}
                    </td>
                    <td className="px-2 py-1.5">
                      <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${LINE_STATUS_META[l.status]?.className ?? ""}`}>{LINE_STATUS_META[l.status]?.label ?? l.status}</span>
                      {l.skipReason && <div className="mt-0.5 text-slate-500">{l.skipReason}</div>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section>
        <SectionLabel>Timeline</SectionLabel>
        {timeline.length === 0 ? <None /> : (
          <ol className="space-y-2 border-l pl-3">
            {timeline.map((t, i) => (
              <li key={`${t.at}-${i}`} className="text-sm">
                <div className="font-medium">{AUDIT_ACTION_LABEL[t.action] ?? t.action}</div>
                <div className="text-xs text-slate-500">{[t.actorName, formatDmyTime(t.at)].filter(Boolean).join(" - ")}</div>
                {t.remarks && <div className="text-xs text-slate-600">{t.remarks}</div>}
              </li>
            ))}
          </ol>
        )}
      </section>

      {(canDecide || p.canCancel || p.canCopyToDraft) && (
        <section className="space-y-3 border-t pt-4">
          <SectionLabel>Actions</SectionLabel>
          {canDecide && (
            <div className="space-y-2">
              <Textarea aria-label="Remarks" rows={2} maxLength={1000} placeholder={`Remarks (required to reject, at least ${MIN_REMARKS} characters)`} value={remarks} onChange={(e) => setRemarks(e.target.value)} />
              {step === "wfm" && <p className="text-xs text-slate-500">Approving writes these changes to the live roster and asks each affected employee to acknowledge.</p>}
              <div className="flex gap-2">
                <Button disabled={busy} onClick={() => onAction(step === "manager" ? "manager-approve" : "wfm-approve", remarks.trim() || undefined)}>
                  {step === "manager" ? "Approve and send to WFM" : "Approve and apply"}
                </Button>
                <Button variant="outline" className="text-red-600" disabled={busy || !remarksOk} onClick={() => onAction(step === "manager" ? "manager-reject" : "wfm-reject", remarks.trim())}>Reject</Button>
              </div>
            </div>
          )}
          <div className="flex gap-2">
            {p.canCancel && <Button variant="outline" disabled={busy} onClick={() => onAction("cancel")}>Cancel submission</Button>}
            {p.canCopyToDraft && <Button variant="outline" disabled={busy} onClick={() => onAction("copy-to-draft")}>Copy back into a new draft</Button>}
          </div>
        </section>
      )}
    </div>
  );
}

interface Props { id: number | null; onClose: () => void; onCopiedToDraft?: () => void }

export default function SubmissionDrawer({ id, onClose, onCopiedToDraft }: Props) {
  const detail = useSubmissionDetail(id);
  const action = useSubmissionAction();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { action.reset(); }, [id]);
  const d = detail.data;

  const run = (a: SubmissionAction, remarks?: string) => {
    if (id === null) return;
    action.mutate({ id, action: a, remarks }, {
      onSuccess: () => {
        toast.success(a === "copy-to-draft" ? "Copied into your draft." : "Done.");
        if (a === "copy-to-draft") { onCopiedToDraft?.(); onClose(); }
      },
      onError: (e) => toast.error(unpackError(e).message),
    });
  };

  return (
    <Sheet open={id !== null} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="flex w-full max-w-2xl flex-col p-0 sm:max-w-2xl">
        <SheetHeader className="border-b px-5 pb-3 pt-5">
          <div className="flex items-center gap-2">
            <SheetTitle className="text-base">{d ? d.submission.submissionNo ?? `Submission ${d.submission.id}` : "Submission"}</SheetTitle>
            {d && <Badge className={STATUS_META[d.submission.status]?.className}>{STATUS_META[d.submission.status]?.label ?? d.submission.status}</Badge>}
          </div>
          <p className="text-xs text-slate-500">{d ? `Created ${formatDmyTime(d.submission.createdAt)}` : ""}</p>
        </SheetHeader>
        <div className="flex-1 overflow-y-auto px-5 py-4">
          {detail.isLoading && <div className="py-8 text-center"><Loader2 className="mx-auto h-5 w-5 animate-spin text-slate-400" aria-label="Loading" /></div>}
          {detail.isError && <p className="text-sm text-red-600">Could not load this submission.</p>}
          {d && <DrawerBody detail={d} busy={action.isPending} onAction={run} />}
        </div>
      </SheetContent>
    </Sheet>
  );
}
