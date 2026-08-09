import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function MobileRecordCard({
  title,
  subtitle,
  meta,
  status,
  actions,
  children,
  className,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  meta?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <article className={cn("rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-2xs)]", className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-sm font-semibold text-[var(--text-primary)]">{title}</h3>
          {subtitle && <p className="mt-1 text-xs text-[var(--text-muted)]">{subtitle}</p>}
          {meta && <div className="mt-2 text-xs text-[var(--text-secondary)]">{meta}</div>}
        </div>
        {status}
      </div>
      {children && <div className="mt-4 grid gap-2 text-sm">{children}</div>}
      {actions && <div className="mt-4 flex justify-end gap-2">{actions}</div>}
    </article>
  );
}
