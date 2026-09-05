import { Card, CardContent } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Check, X, Calendar, Clock, UserCheck, RotateCcw } from "lucide-react";
import { StatusBadge, normalizeStatus } from "@/components/ui/status-badge";
import { formatDate, formatDateTime } from "@/lib/utils";
import { getLeaveColor } from "@/lib/leaveColors";

/*
 * One LeaveRequest, defined where the data comes from.
 *
 * This file used to declare its own near-identical copy, and Leaves.tsx imported THIS one while
 * receiving rows typed by the hook — two structurally different types with the same name. They
 * diverged on the only thing that mattered: the hook's status union carries
 * "pending_branch_head" and this copy did not, so every hook row was unassignable to the card and
 * the page could not compile. Re-exported rather than moved, so the existing import path keeps
 * working.
 */
export type { LeaveRequest } from "@/hooks/useLeaves";
import type { LeaveRequest } from "@/hooks/useLeaves";

interface LeaveRequestCardProps {
  request: LeaveRequest;
  onApprove?: (id: string) => void;
  onReject?: (id: string) => void;
  /** Reverses an already-approved leave and credits the balance back. */
  onDiscard?: (id: string) => void;
}

const statusStyles: Record<string, string> = {
  pending: "bg-amber-500/10 text-amber-600 border-amber-500/20",
  approved: "bg-emerald-500/10 text-emerald-600 border-emerald-500/20",
  rejected: "bg-destructive/10 text-destructive border-destructive/20",
  cancelled: "bg-muted text-muted-foreground border-muted",
  discarded: "bg-slate-500/10 text-slate-600 border-slate-500/20",
};

const leaveTypeStyles: Record<string, string> = {
  Annual: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  Sick: "bg-rose-500/10 text-rose-600 dark:text-rose-400",
  Casual: "bg-sky-500/10 text-sky-600 dark:text-sky-400",
  Unpaid: "bg-slate-500/10 text-slate-600 dark:text-slate-400",
  Maternity: "bg-pink-500/10 text-pink-600 dark:text-pink-400",
  Paternity: "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400",
  Bereavement: "bg-violet-500/10 text-violet-600 dark:text-violet-400",
  Compensatory: "bg-amber-500/10 text-amber-600 dark:text-amber-400",
  "Work From Home": "bg-cyan-500/10 text-cyan-600 dark:text-cyan-400",
  Marriage: "bg-fuchsia-500/10 text-fuchsia-600 dark:text-fuchsia-400",
};

// Fallback colors for leave types not in the map
const fallbackColors = [
  "bg-teal-500/10 text-teal-600 dark:text-teal-400",
  "bg-orange-500/10 text-orange-600 dark:text-orange-400",
  "bg-lime-500/10 text-lime-600 dark:text-lime-400",
  "bg-purple-500/10 text-purple-600 dark:text-purple-400",
];

const getLeaveTypeStyle = (type: string): string => {
  if (leaveTypeStyles[type]) return leaveTypeStyles[type];
  // Generate consistent color based on type name hash
  const hash = type.split("").reduce((acc, char) => acc + char.charCodeAt(0), 0);
  return fallbackColors[hash % fallbackColors.length];
};

// onDiscard was declared in the props interface but never destructured here, so the identifier
// below was undefined rather than optional. `request.status === "approved" && onDiscard` short-
// circuits for every other status, which is why this only surfaced on an approved leave — and
// then threw "onDiscard is not defined" instead of simply hiding the button.
export function LeaveRequestCard({ request, onApprove, onReject, onDiscard }: LeaveRequestCardProps) {
  return (
    <Card className="relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-0.5">
      {/* Left accent — same color the type badge and the balance/chart tiles use, via the shared leaveColors map */}
      <span className={`absolute inset-y-0 left-0 w-1.5 ${getLeaveColor(request.type)}`} aria-hidden="true" />
      <CardContent className="p-6 pl-7">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="flex items-start gap-4">
            <Avatar className="h-12 w-12">
              <AvatarImage src={request.employee.avatar} />
              <AvatarFallback>
                {request.employee.name.split(" ").map((n) => n[0]).join("")}
              </AvatarFallback>
            </Avatar>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-semibold text-foreground">{request.employee.name}</h3>
                <Badge
                  variant="secondary"
                  className={getLeaveTypeStyle(request.type)}
                >
                  {request.type}
                </Badge>
                {request.status === "pending_branch_head" && (
                  <Badge variant="secondary" className="bg-orange-500/10 text-orange-600 border-orange-500/20">
                    Escalated — Branch Head
                  </Badge>
                )}
              </div>
              <p className="text-sm text-muted-foreground">{request.employee.department}</p>
              <div className="mt-2 flex items-center gap-2 text-sm text-muted-foreground">
                <Calendar className="h-4 w-4" />
                <span>
                  {formatDate(request.startDate)} - {formatDate(request.endDate)}
                </span>
                <span className="text-foreground font-medium">({request.days} days)</span>
              </div>
              {request.submittedAt && (
                <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                  <Clock className="h-3 w-3" />
                  <span>Submitted: {formatDateTime(request.submittedAt)}</span>
                </div>
              )}
              {request.reason && <p className="mt-2 text-sm text-muted-foreground">{request.reason}</p>}
              {request.status !== "pending" && request.reviewedBy && (
                <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                  <UserCheck className="h-3 w-3" />
                  <span>
                    {request.status === "approved" ? "Approved" : request.status === "rejected" ? "Rejected" : "Reviewed"} by{" "}
                    <span className="font-medium text-foreground">{request.reviewedBy.name}</span>
                    {request.reviewedAt && <span> on {formatDate(request.reviewedAt)}</span>}
                  </span>
                </div>
              )}
              {request.reviewNotes && (
                <p className="mt-1 text-xs text-muted-foreground italic">
                  Note: {request.reviewNotes}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2">
            {(request.status === "pending" || request.status === "pending_branch_head") && (onApprove || onReject) ? (
              <>
                {onApprove && (
                  <Button
                    size="sm"
                    className="bg-emerald-600 text-white shadow-sm shadow-emerald-600/25 transition-colors hover:bg-emerald-700"
                    onClick={() => onApprove(request.id)}
                  >
                    <Check className="mr-1 h-4 w-4" />
                    Approve
                  </Button>
                )}
                {onReject && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/30 text-destructive hover:bg-destructive/10"
                    onClick={() => onReject(request.id)}
                  >
                    <X className="mr-1 h-4 w-4" />
                    Reject
                  </Button>
                )}
              </>
            ) : (
              <>
                <StatusBadge
                  status={normalizeStatus(request.status)}
                  label={request.status}
                />
                {/* An approved leave is the only thing worth discarding — the
                    balance has been deducted and attendance already rewritten. */}
                {request.status === "approved" && onDiscard && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="border-destructive/20 text-destructive hover:bg-destructive/10"
                    onClick={() => onDiscard(request.id)}
                  >
                    <RotateCcw className="mr-1 h-4 w-4" />
                    Discard
                  </Button>
                )}
              </>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
