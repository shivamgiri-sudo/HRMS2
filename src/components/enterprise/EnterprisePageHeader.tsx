import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { StatusBadgeV2 } from "./StatusBadgeV2";

export function EnterprisePageHeader({
  eyebrow,
  title,
  description,
  status,
  primaryAction,
  secondaryActions,
  lastUpdated,
  rightSlot,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  status?: string;
  primaryAction?: ReactNode;
  secondaryActions?: ReactNode;
  lastUpdated?: ReactNode;
  rightSlot?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)] sm:p-5", className)}>
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            {eyebrow && (
              <p className="text-[11px] font-semibold uppercase tracking-[var(--tracking-wider)] text-[var(--brand-600)]">
                {eyebrow}
              </p>
            )}
            {status && <StatusBadgeV2 status={status} />}
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-[var(--text-primary)] sm:text-3xl">
            {title}
          </h1>
          {description && (
            <p className="mt-2 max-w-3xl text-sm leading-6 text-[var(--text-muted)]">
              {description}
            </p>
          )}
          {lastUpdated && (
            <p className="mt-3 text-xs font-medium text-[var(--text-muted)]">
              {lastUpdated}
            </p>
          )}
        </div>
        {(primaryAction || secondaryActions || rightSlot) && (
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-end">
            {secondaryActions}
            {primaryAction}
            {rightSlot}
          </div>
        )}
      </div>
    </section>
  );
}
