import { AlertCircle, CheckCircle2, Circle, Clock, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export type EnterpriseStatus =
  | "active"
  | "inactive"
  | "onboarding"
  | "offboarded"
  | "present"
  | "half_day"
  | "absent"
  | "leave"
  | "holiday"
  | "week_off"
  | "pending"
  | "approved"
  | "rejected"
  | "draft"
  | "locked"
  | "released"
  | "blocked"
  | "warning"
  | "success"
  | "failed"
  | "info"
  | "neutral";

const statusStyles: Record<EnterpriseStatus, { className: string; label: string; icon: JSX.Element }> = {
  active: { className: "bg-[var(--status-present-bg)] text-[var(--status-present)] border-[var(--status-present-border)]", label: "Active", icon: <CheckCircle2 className="h-3 w-3" /> },
  inactive: { className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-[var(--status-neutral-border)]", label: "Inactive", icon: <Circle className="h-3 w-3" /> },
  onboarding: { className: "bg-[var(--status-info-bg)] text-[var(--status-info)] border-[var(--status-info-border)]", label: "Onboarding", icon: <Clock className="h-3 w-3" /> },
  offboarded: { className: "bg-[var(--status-absent-bg)] text-[var(--status-absent)] border-[var(--status-absent-border)]", label: "Offboarded", icon: <XCircle className="h-3 w-3" /> },
  present: { className: "bg-[var(--status-present-bg)] text-[var(--status-present)] border-[var(--status-present-border)]", label: "Present", icon: <CheckCircle2 className="h-3 w-3" /> },
  half_day: { className: "bg-[var(--status-halfday-bg)] text-[var(--status-halfday)] border-[var(--status-halfday-border)]", label: "Half Day", icon: <Clock className="h-3 w-3" /> },
  absent: { className: "bg-[var(--status-absent-bg)] text-[var(--status-absent)] border-[var(--status-absent-border)]", label: "Absent", icon: <XCircle className="h-3 w-3" /> },
  leave: { className: "bg-[var(--status-info-bg)] text-[var(--status-info)] border-[var(--status-info-border)]", label: "Leave", icon: <Clock className="h-3 w-3" /> },
  holiday: { className: "bg-[var(--tint-leave)] text-[var(--tint-leave-text)] border-[var(--status-info-border)]", label: "Holiday", icon: <Circle className="h-3 w-3" /> },
  week_off: { className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-[var(--status-neutral-border)]", label: "Week Off", icon: <Circle className="h-3 w-3" /> },
  pending: { className: "bg-[var(--status-pending-bg)] text-[var(--status-pending)] border-[var(--status-pending-border)]", label: "Pending", icon: <Clock className="h-3 w-3" /> },
  approved: { className: "bg-[var(--status-approved-bg)] text-[var(--status-approved)] border-[var(--status-approved-border)]", label: "Approved", icon: <CheckCircle2 className="h-3 w-3" /> },
  rejected: { className: "bg-[var(--status-rejected-bg)] text-[var(--status-rejected)] border-[var(--status-rejected-border)]", label: "Rejected", icon: <XCircle className="h-3 w-3" /> },
  draft: { className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-[var(--status-neutral-border)]", label: "Draft", icon: <Circle className="h-3 w-3" /> },
  locked: { className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-[var(--status-neutral-border)]", label: "Locked", icon: <Circle className="h-3 w-3" /> },
  released: { className: "bg-[var(--status-approved-bg)] text-[var(--status-approved)] border-[var(--status-approved-border)]", label: "Released", icon: <CheckCircle2 className="h-3 w-3" /> },
  blocked: { className: "bg-[var(--status-absent-bg)] text-[var(--status-absent)] border-[var(--status-absent-border)]", label: "Blocked", icon: <XCircle className="h-3 w-3" /> },
  warning: { className: "bg-[var(--status-halfday-bg)] text-[var(--status-halfday)] border-[var(--status-halfday-border)]", label: "Warning", icon: <AlertCircle className="h-3 w-3" /> },
  success: { className: "bg-[var(--status-present-bg)] text-[var(--status-present)] border-[var(--status-present-border)]", label: "Success", icon: <CheckCircle2 className="h-3 w-3" /> },
  failed: { className: "bg-[var(--status-absent-bg)] text-[var(--status-absent)] border-[var(--status-absent-border)]", label: "Failed", icon: <XCircle className="h-3 w-3" /> },
  info: { className: "bg-[var(--status-info-bg)] text-[var(--status-info)] border-[var(--status-info-border)]", label: "Info", icon: <AlertCircle className="h-3 w-3" /> },
  neutral: { className: "bg-[var(--status-neutral-bg)] text-[var(--status-neutral)] border-[var(--status-neutral-border)]", label: "Neutral", icon: <Circle className="h-3 w-3" /> },
};

function normalizeEnterpriseStatus(value?: string | null): EnterpriseStatus {
  const normalized = String(value || "neutral").toLowerCase().replace(/[\s-]+/g, "_");
  if (normalized in statusStyles) return normalized as EnterpriseStatus;
  if (normalized.includes("process")) return "info";
  if (normalized.includes("paid") || normalized.includes("complete")) return "success";
  if (normalized.includes("pend")) return "pending";
  if (normalized.includes("reject")) return "rejected";
  if (normalized.includes("fail")) return "failed";
  return "neutral";
}

export function StatusBadgeV2({
  status,
  label,
  showIcon = true,
  className,
}: {
  status: EnterpriseStatus | string;
  label?: string;
  showIcon?: boolean;
  className?: string;
}) {
  const config = statusStyles[normalizeEnterpriseStatus(status)];

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold leading-none",
        config.className,
        className,
      )}
    >
      {showIcon && config.icon}
      {label || config.label}
    </span>
  );
}
