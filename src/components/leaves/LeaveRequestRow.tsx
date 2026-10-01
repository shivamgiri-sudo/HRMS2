import type { ReactNode } from "react";
import { CalendarDays, Clock, MessageSquareText, UserCheck } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { AuthedAvatarImage } from "@/components/ui/AuthedAvatarImage";
import { normalizeMediaUrl } from "@/lib/mediaUrl";
import { cn, formatDate, formatDateTime } from "@/lib/utils";
import type { LeaveRequest } from "@/hooks/useLeaves";
import { formatLeaveRange } from "./leaveData";
import { STATUS_PILL, normalizeLeaveStatus, statusLabel } from "./leaveStatus";
import { leaveTypeChartVar } from "./leaveTheme";

export function LeaveStatusPill({ status, className }: { status: string; className?: string }) {
  const key = normalizeLeaveStatus(status);
  return (
    <span className={cn("inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold", STATUS_PILL[key], className)}>
      {statusLabel(key)}
    </span>
  );
}

export function LeaveTypeChip({ type }: { type: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/50 px-2.5 py-0.5 text-xs font-medium text-foreground">
      <span className="h-2 w-2 rounded-full" style={{ backgroundColor: leaveTypeChartVar(type) }} aria-hidden="true" />
      {type}
    </span>
  );
}

interface Props {
  request: LeaveRequest;
  /** Show who the leave belongs to (team views). Off for the employee's own list. */
  showEmployee?: boolean;
  /** Buttons / extra content on the right. */
  actions?: ReactNode;
  /** Content under the details (timeline). */
  footer?: ReactNode;
}

/** One leave request, in the same layout everywhere on the page. */
export function LeaveRequestRow({ request, showEmployee = true, actions, footer }: Props) {
  const initials = request.employee.name.split(" ").filter(Boolean).slice(0, 2).map((n) => n[0]).join("").toUpperCase();
  return (
    <article
      className="relative overflow-hidden rounded-2xl border border-border bg-card p-4 pl-5 shadow-sm transition-shadow hover:shadow-md sm:p-5 sm:pl-6"
      aria-label={`${request.type} leave, ${formatLeaveRange(request.startDate, request.endDate)}`}
    >
      <span className="absolute inset-y-0 left-0 w-1.5" style={{ backgroundColor: leaveTypeChartVar(request.type) }} aria-hidden="true" />
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          {showEmployee && (
            <Avatar className="h-10 w-10 shrink-0 rounded-lg">
              <AuthedAvatarImage src={normalizeMediaUrl(request.employee.avatar)} className="rounded-lg" />
              <AvatarFallback className="rounded-lg bg-muted text-xs font-bold text-foreground">{initials}</AvatarFallback>
            </Avatar>
          )}
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              {showEmployee && <h3 className="truncate text-sm font-semibold text-foreground">{request.employee.name}</h3>}
              <LeaveTypeChip type={request.type} />
              <LeaveStatusPill status={request.status} />
            </div>
            {showEmployee && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {[request.employee.department, request.branch, request.process].filter((v) => v && v !== "Unassigned").join(" · ")}
              </p>
            )}
            <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-foreground">
              <CalendarDays className="h-4 w-4 text-primary" aria-hidden="true" />
              <span>{formatLeaveRange(request.startDate, request.endDate)}</span>
              <span className="font-semibold">({request.days} {Number(request.days) === 1 ? "day" : "days"})</span>
            </p>
            {request.submittedAt && (
              <p className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Clock className="h-3 w-3" aria-hidden="true" />
                Applied {formatDateTime(request.submittedAt)}
              </p>
            )}
            {request.reason && <p className="mt-2 text-sm text-muted-foreground">{request.reason}</p>}
            {request.reviewedBy && request.reviewedAt && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <UserCheck className="h-3 w-3" aria-hidden="true" />
                {statusLabel(normalizeLeaveStatus(request.status))} by <span className="font-medium text-foreground">{request.reviewedBy.name}</span> on {formatDate(request.reviewedAt)}
              </p>
            )}
            {request.reviewNotes && (
              <p className="mt-1 flex items-start gap-1.5 text-xs italic text-muted-foreground">
                <MessageSquareText className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
                {request.reviewNotes}
              </p>
            )}
          </div>
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </div>
      {footer && <div className="mt-4 border-t border-border pt-4">{footer}</div>}
    </article>
  );
}
