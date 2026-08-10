import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function EmptyState({
  title,
  description,
  action,
  icon,
}: {
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="rounded-[var(--r-lg)] border border-dashed border-[var(--border-default)] bg-[var(--surface-1)] px-4 py-12 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] text-[var(--text-muted)]">
        {icon || <Inbox className="h-6 w-6" />}
      </div>
      <h3 className="mt-4 text-base font-semibold text-[var(--text-primary)]">{title}</h3>
      {description && <p className="mx-auto mt-2 max-w-md text-sm leading-6 text-[var(--text-muted)]">{description}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
