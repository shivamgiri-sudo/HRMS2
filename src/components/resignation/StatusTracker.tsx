import { useState } from "react";
import { CheckCircle2, ClipboardCheck, DoorOpen, Hourglass, Info, PhoneCall, Send, Undo2, UserCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hrmsApi } from "@/lib/hrmsApi";
import { WithdrawDialog } from "./WithdrawDialog";
import {
  canSelfWithdraw,
  errorMessage,
  formatDate,
  formatDateTime,
  normalizeStatus,
  reasonLabel,
  statusLabel,
  stepIndexFor,
  type AuditEntry,
  type ExitRequest,
} from "./resignation-types";

const STEPS = [
  { label: "Submitted", icon: Send, stages: ["submitted"] },
  { label: "Manager review", icon: UserCheck, stages: ["manager_review", "hr_review", "admin_review"] },
  { label: "Accepted", icon: CheckCircle2, stages: ["accepted"] },
  { label: "Notice", icon: Hourglass, stages: ["notice_serving", "notice_active"] },
  { label: "Clearance", icon: ClipboardCheck, stages: ["clearance_pending", "fnf_pending"] },
  { label: "Exited", icon: DoorOpen, stages: ["exited", "exit_confirmed", "closed"] },
] as const;

/** Date each step was reached: from the audit trail first, then the request's own timestamps. */
function stepDates(request: ExitRequest, audit: AuditEntry[]): (string | null)[] {
  const firstAt = (stages: readonly string[]) =>
    audit.find((a) => stages.includes(normalizeStatus(a.stage ?? a.action)))?.performed_at ?? null;
  return STEPS.map((step, i) => {
    const fromAudit = firstAt(step.stages);
    if (fromAudit) return fromAudit;
    if (i === 0) return request.submitted_at ?? request.created_at;
    if (i === 1) return request.manager_actioned_at ?? null;
    if (i === 3) return request.notice_start_date ?? null;
    if (i === 5) return request.exit_confirmed_at ?? null;
    return null;
  });
}

export function StatusTracker({
  request,
  audit,
  onWithdrawn,
}: {
  request: ExitRequest;
  audit: AuditEntry[];
  onWithdrawn: () => void;
}) {
  const current = stepIndexFor(request.status);
  const done = current === STEPS.length - 1;
  const dates = stepDates(request, audit);
  const lwd = request.effective_lwd ?? request.last_working_day_confirmed ?? request.last_working_day_proposed ?? null;
  const withdrawable = canSelfWithdraw(request);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      await hrmsApi.post(`/api/exit/resignation/${request.id}/withdraw`);
      setDialogOpen(false);
      onWithdrawn();
    } catch (err) {
      setError(errorMessage(err, "Could not withdraw your resignation. Please try again."));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section aria-labelledby="tracker-title" className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 id="tracker-title" className="text-xl font-bold text-slate-900">
            Your resignation
          </h2>
          <p className="mt-0.5 text-base text-slate-600">
            Status: <span className="font-semibold text-slate-900">{statusLabel(request.status)}</span>
          </p>
        </div>
        <span className="rounded-full border border-teal-200 bg-teal-50 px-3 py-1 text-sm font-semibold text-teal-800">
          Last working day: {formatDate(lwd)}
        </span>
      </div>

      {/* Vertical on phones, horizontal from sm. */}
      <ol className="mt-6 grid grid-cols-1 gap-0 sm:grid-cols-6 sm:gap-2" aria-label="Resignation progress">
        {STEPS.map((step, i) => {
          const Icon = step.icon;
          const reached = i <= current;
          const isCurrent = i === current && !done;
          const state = i < current || (done && i === current) ? "complete" : isCurrent ? "current" : "upcoming";
          const circle =
            state === "complete"
              ? "bg-emerald-600 text-white"
              : state === "current"
                ? "bg-white text-teal-800 ring-4 ring-teal-200 border-2 border-teal-600"
                : "bg-slate-100 text-slate-500 border border-slate-200";
          return (
            <li
              key={step.label}
              className="relative flex gap-3 pb-5 last:pb-0 sm:flex-col sm:items-center sm:gap-2 sm:pb-0 sm:text-center"
              aria-current={isCurrent ? "step" : undefined}
            >
              {i < STEPS.length - 1 && (
                <span
                  aria-hidden
                  className={`absolute left-5 top-10 h-[calc(100%-2.5rem)] w-0.5 sm:left-[calc(50%+1.5rem)] sm:top-5 sm:h-0.5 sm:w-[calc(100%-3rem+0.5rem)] ${
                    i < current ? "bg-emerald-500" : "bg-slate-200"
                  }`}
                />
              )}
              <span className={`relative z-10 flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${circle}`}>
                <Icon className="h-5 w-5" aria-hidden />
              </span>
              <div className="min-w-0 pt-1 sm:pt-0">
                <p className={`text-base font-semibold sm:text-sm ${state === "upcoming" ? "text-slate-600" : "text-slate-900"}`}>
                  {step.label}
                  <span className="sr-only"> — {state}</span>
                </p>
                <p className="text-sm text-slate-600">{reached && dates[i] ? formatDate(dates[i]) : state === "current" ? "In progress" : ""}</p>
              </div>
            </li>
          );
        })}
      </ol>

      <dl className="mt-6 grid grid-cols-1 gap-3 rounded-2xl bg-slate-50 p-4 sm:grid-cols-2">
        <Fact label="Submitted on" value={formatDateTime(request.submitted_at ?? request.created_at)} />
        <Fact label="Notice period" value={request.notice_period_days ? `${request.notice_period_days} days` : "—"} />
        <Fact label="Reason" value={reasonLabel(request.exit_reason_category) ?? "—"} />
        <Fact label="Your remarks" value={request.resignation_reason?.trim() || "—"} />
      </dl>

      <div className="mt-5 border-t border-slate-100 pt-5">
        {withdrawable ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-base leading-relaxed text-slate-700">
              Changed your mind? You can withdraw it yourself until your exit is processed.
            </p>
            <Button
              type="button"
              onClick={() => {
                setError(null);
                setDialogOpen(true);
              }}
              className="w-full shrink-0 cursor-pointer bg-emerald-700 text-white transition-colors duration-200 ease-out hover:bg-emerald-800 sm:w-auto"
            >
              <Undo2 aria-hidden /> Withdraw my resignation
            </Button>
          </div>
        ) : (
          <p className="flex gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-base leading-relaxed text-slate-700">
            {done ? <Info className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" aria-hidden /> : <PhoneCall className="mt-0.5 h-5 w-5 shrink-0 text-slate-600" aria-hidden />}
            {done
              ? "Your exit is complete. For letters or settlement questions, please contact HR."
              : "Contact HR to withdraw — your exit has moved past the stage where you can withdraw it yourself."}
          </p>
        )}
      </div>

      <WithdrawDialog open={dialogOpen} busy={busy} error={error} onOpenChange={setDialogOpen} onConfirm={withdraw} />
    </section>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-sm font-semibold text-slate-600">{label}</dt>
      <dd className="whitespace-pre-wrap break-words text-base text-slate-900">{value}</dd>
    </div>
  );
}
