import type { ReactNode } from "react";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";

export type KpiTone =
  | "default"
  | "brand"
  | "success"
  | "warning"
  | "danger"
  | "info"
  | "payroll"
  | "attendance"
  | "people"
  | "ops"
  | "admin";

const toneMap: Record<KpiTone, string> = {
  default: "bg-[var(--surface-1)] text-[var(--text-secondary)] border-[var(--border-hairline)]",
  brand: "bg-[var(--brand-50)] text-[var(--brand-700)] border-[var(--brand-200)]",
  success: "bg-[var(--status-present-bg)] text-[var(--status-present)] border-[var(--status-present-border)]",
  warning: "bg-[var(--status-halfday-bg)] text-[var(--status-halfday)] border-[var(--status-halfday-border)]",
  danger: "bg-[var(--status-absent-bg)] text-[var(--status-absent)] border-[var(--status-absent-border)]",
  info: "bg-[var(--status-info-bg)] text-[var(--status-info)] border-[var(--status-info-border)]",
  payroll: "bg-[var(--tint-payroll)] text-[var(--tint-payroll-text)] border-[var(--status-pending-border)]",
  attendance: "bg-[var(--tint-attend)] text-[var(--tint-attend-text)] border-[var(--status-present-border)]",
  people: "bg-[var(--tint-hr)] text-[var(--tint-hr-text)] border-[var(--status-halfday-border)]",
  ops: "bg-[var(--tint-ops)] text-[var(--tint-ops-text)] border-[var(--status-info-border)]",
  admin: "bg-[var(--tint-admin)] text-[var(--tint-admin-text)] border-[var(--border-hairline)]",
};

export function KpiCard({
  title,
  value,
  description,
  icon,
  tone = "default",
  trend,
  onClick,
  loading,
  className,
}: {
  title: string;
  value: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  tone?: KpiTone;
  trend?: ReactNode;
  onClick?: () => void;
  loading?: boolean;
  className?: string;
}) {
  const Comp = onClick ? "button" : "div";

  return (
    <Comp
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={cn(
        "w-full rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 text-left shadow-[var(--shadow-xs)] transition",
        onClick && "hover:-translate-y-0.5 hover:shadow-[var(--shadow-md)] focus:outline-none focus:ring-2 focus:ring-[var(--border-focus)]/30",
        className,
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[var(--tracking-wider)] text-[var(--text-muted)]">
            {title}
          </p>
          <div className="mt-2 truncate text-2xl font-semibold tracking-normal text-[var(--text-primary)] tabular-nums">
            {loading ? <Loader2 className="h-5 w-5 animate-spin text-[var(--text-muted)]" /> : value}
          </div>
        </div>
        {icon && (
          <div className={cn("flex h-10 w-10 shrink-0 items-center justify-center rounded-[var(--r-md)] border", toneMap[tone])}>
            {icon}
          </div>
        )}
      </div>
      {(description || trend) && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs leading-5 text-[var(--text-muted)]">
          {description && <p>{description}</p>}
          {trend && <span className="font-semibold">{trend}</span>}
        </div>
      )}
    </Comp>
  );
}
