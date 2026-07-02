import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CheckCircle2, Clock, XCircle, AlertCircle, Circle } from "lucide-react";

export type StatusType =
  | "approved" | "success" | "completed" | "active" | "present"
  | "pending" | "in_progress" | "warning" | "attention"
  | "rejected" | "failed" | "error" | "absent" | "danger"
  | "info" | "draft" | "neutral"
  | "cancelled" | "on_hold" | "not_started";

interface StatusBadgeProps {
  status: StatusType;
  label?: string;
  showIcon?: boolean;
  className?: string;
}

const statusConfig: Record<StatusType, {
  variant: "default" | "secondary" | "destructive" | "outline";
  className: string;
  icon: React.ReactNode;
  defaultLabel: string;
}> = {
  // Success variants (Green #10b981)
  approved: {
    variant: "default",
    className: "smarthr-badge success bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/10 border-[#10b981]/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    defaultLabel: "Approved",
  },
  success: {
    variant: "default",
    className: "smarthr-badge success bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/10 border-[#10b981]/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    defaultLabel: "Success",
  },
  completed: {
    variant: "default",
    className: "smarthr-badge success bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/10 border-[#10b981]/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    defaultLabel: "Completed",
  },
  active: {
    variant: "default",
    className: "smarthr-badge success bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/10 border-[#10b981]/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    defaultLabel: "Active",
  },
  present: {
    variant: "default",
    className: "smarthr-badge success bg-[#10b981]/10 text-[#10b981] hover:bg-[#10b981]/10 border-[#10b981]/20",
    icon: <CheckCircle2 className="h-3 w-3" />,
    defaultLabel: "Present",
  },

  // Warning variants (Orange #f59e0b)
  pending: {
    variant: "default",
    className: "smarthr-badge warning bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/10 border-[#f59e0b]/20",
    icon: <Clock className="h-3 w-3" />,
    defaultLabel: "Pending",
  },
  in_progress: {
    variant: "default",
    className: "smarthr-badge warning bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/10 border-[#f59e0b]/20",
    icon: <Clock className="h-3 w-3" />,
    defaultLabel: "In Progress",
  },
  warning: {
    variant: "default",
    className: "smarthr-badge warning bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/10 border-[#f59e0b]/20",
    icon: <AlertCircle className="h-3 w-3" />,
    defaultLabel: "Warning",
  },
  attention: {
    variant: "default",
    className: "smarthr-badge warning bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/10 border-[#f59e0b]/20",
    icon: <AlertCircle className="h-3 w-3" />,
    defaultLabel: "Attention",
  },
  on_hold: {
    variant: "default",
    className: "smarthr-badge warning bg-[#f59e0b]/10 text-[#f59e0b] hover:bg-[#f59e0b]/10 border-[#f59e0b]/20",
    icon: <Clock className="h-3 w-3" />,
    defaultLabel: "On Hold",
  },

  // Danger variants (Red #ef4444)
  rejected: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Rejected",
  },
  failed: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Failed",
  },
  error: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Error",
  },
  absent: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Absent",
  },
  danger: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Danger",
  },
  cancelled: {
    variant: "destructive",
    className: "smarthr-badge danger bg-[#ef4444]/10 text-[#ef4444] hover:bg-[#ef4444]/10 border-[#ef4444]/20",
    icon: <XCircle className="h-3 w-3" />,
    defaultLabel: "Cancelled",
  },

  // Info variants (Blue #4361ee)
  info: {
    variant: "default",
    className: "smarthr-badge info bg-[#4361ee]/10 text-[#4361ee] hover:bg-[#4361ee]/10 border-[#4361ee]/20",
    icon: <AlertCircle className="h-3 w-3" />,
    defaultLabel: "Info",
  },

  // Neutral variants (Gray)
  draft: {
    variant: "secondary",
    className: "smarthr-badge neutral bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200",
    icon: <Circle className="h-3 w-3" />,
    defaultLabel: "Draft",
  },
  neutral: {
    variant: "secondary",
    className: "smarthr-badge neutral bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200",
    icon: <Circle className="h-3 w-3" />,
    defaultLabel: "Neutral",
  },
  not_started: {
    variant: "secondary",
    className: "smarthr-badge neutral bg-slate-100 text-slate-700 hover:bg-slate-100 border-slate-200",
    icon: <Circle className="h-3 w-3" />,
    defaultLabel: "Not Started",
  },
};

export function StatusBadge({
  status,
  label,
  showIcon = true,
  className
}: StatusBadgeProps) {
  const config = statusConfig[status] || statusConfig.neutral;
  const displayLabel = label || config.defaultLabel;

  return (
    <Badge
      variant={config.variant}
      className={cn(
        config.className,
        "inline-flex items-center gap-1.5 font-semibold",
        className
      )}
    >
      {showIcon && config.icon}
      {displayLabel}
    </Badge>
  );
}

// Helper function to get status from string (case-insensitive)
export function normalizeStatus(status: string): StatusType {
  const normalized = status.toLowerCase().replace(/[_\s-]/g, "_");

  // Map common variations
  const statusMap: Record<string, StatusType> = {
    "approve": "approved",
    "reject": "rejected",
    "pend": "pending",
    "progress": "in_progress",
    "inprogress": "in_progress",
    "complete": "completed",
    "fail": "failed",
    "cancel": "cancelled",
    "hold": "on_hold",
    "onhold": "on_hold",
    "notstarted": "not_started",
  };

  // Check exact match first
  if (normalized in statusConfig) {
    return normalized as StatusType;
  }

  // Check mapped variations
  for (const [key, value] of Object.entries(statusMap)) {
    if (normalized.includes(key)) {
      return value;
    }
  }

  // Default to neutral
  return "neutral";
}
