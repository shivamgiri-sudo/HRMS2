import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle, AlertCircle, Circle, Info } from "lucide-react";

// Status types supported across all HRMS modules.
export type StatusType =
  | "approved" | "success" | "completed" | "active" | "present"
  | "pending" | "in_progress" | "warning" | "attention" | "on_hold"
  | "rejected" | "failed" | "error" | "absent" | "danger" | "cancelled"
  | "info" | "in_review"
  | "draft" | "neutral" | "not_started";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

// Colors from MAS Design Guidelines §3.3 semantic state construction.
// Foreground/background pairs meet WCAG 2.2 AA (≥4.5:1 normal text).
const statusConfig: Record<StatusType, {
  className: string;
  icon: React.ReactNode;
  defaultLabel: string;
}> = {
  // ── Success / Green (#166534 on #F0FDF4) ───────────────────────────────────
  approved:  { className: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]", icon: <CheckCircle2 className="h-3 w-3" />, defaultLabel: "Approved" },
  success:   { className: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]", icon: <CheckCircle2 className="h-3 w-3" />, defaultLabel: "Success" },
  completed: { className: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]", icon: <CheckCircle2 className="h-3 w-3" />, defaultLabel: "Completed" },
  active:    { className: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]", icon: <CheckCircle2 className="h-3 w-3" />, defaultLabel: "Active" },
  present:   { className: "bg-[#F0FDF4] text-[#166534] border-[#BBF7D0]", icon: <CheckCircle2 className="h-3 w-3" />, defaultLabel: "Present" },

  // ── Warning / Amber (#92400E on #FFFBEB) ───────────────────────────────────
  pending:    { className: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]", icon: <Clock className="h-3 w-3" />,        defaultLabel: "Pending" },
  in_progress:{ className: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]", icon: <Clock className="h-3 w-3" />,        defaultLabel: "In Progress" },
  warning:    { className: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]", icon: <AlertCircle className="h-3 w-3" />,  defaultLabel: "Warning" },
  attention:  { className: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]", icon: <AlertCircle className="h-3 w-3" />,  defaultLabel: "Attention" },
  on_hold:    { className: "bg-[#FFFBEB] text-[#92400E] border-[#FDE68A]", icon: <Clock className="h-3 w-3" />,        defaultLabel: "On Hold" },

  // ── Error / Red (#B91C1C on #FEF2F2) ──────────────────────────────────────
  rejected:  { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Rejected" },
  failed:    { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Failed" },
  error:     { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Error" },
  absent:    { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Absent" },
  danger:    { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Danger" },
  cancelled: { className: "bg-[#FEF2F2] text-[#B91C1C] border-[#FECACA]", icon: <XCircle className="h-3 w-3" />,     defaultLabel: "Cancelled" },

  // ── Info / Blue (#1D4ED8 on #EFF6FF) ──────────────────────────────────────
  info:      { className: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]", icon: <Info className="h-3 w-3" />,        defaultLabel: "Info" },
  in_review: { className: "bg-[#EFF6FF] text-[#1D4ED8] border-[#BFDBFE]", icon: <Clock className="h-3 w-3" />,       defaultLabel: "In Review" },

  // ── Neutral / Gray (#475569 on #F8FAFC) ────────────────────────────────────
  draft:       { className: "bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]", icon: <Circle className="h-3 w-3" />,  defaultLabel: "Draft" },
  neutral:     { className: "bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]", icon: <Circle className="h-3 w-3" />,  defaultLabel: "Neutral" },
  not_started: { className: "bg-[#F8FAFC] text-[#475569] border-[#CBD5E1]", icon: <Circle className="h-3 w-3" />,  defaultLabel: "Not Started" },
};

export function StatusBadge({ status, label, showIcon = true, className }: StatusBadgeProps) {
  const config = statusConfig[status] ?? statusConfig.neutral;
  return (
    <Badge
      variant="outline"
      className={cn(
        "inline-flex items-center gap-1.5 border font-semibold",
        config.className,
        className
      )}
    >
      {showIcon && config.icon}
      {label ?? config.defaultLabel}
    </Badge>
  );
}

// Maps a free-form status string to a canonical StatusType.
export function normalizeStatus(status: string): StatusType {
  const s = status.toLowerCase().replace(/[_\s-]/g, "_");
  if (s in statusConfig) return s as StatusType;
  const map: Record<string, StatusType> = {
    approve: "approved", reject: "rejected", pend: "pending",
    progress: "in_progress", inprogress: "in_progress", complete: "completed",
    fail: "failed", cancel: "cancelled", hold: "on_hold",
    onhold: "on_hold", notstarted: "not_started", review: "in_review",
  };
  for (const [k, v] of Object.entries(map)) {
    if (s.includes(k)) return v;
  }
  return "neutral";
}
