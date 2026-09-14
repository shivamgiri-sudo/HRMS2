import type { ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { StatusBadgeV2 } from "./StatusBadgeV2";

export function ExceptionPanel({
  title = "Needs Attention",
  items,
  severity = "warning",
  action,
}: {
  title?: string;
  items: Array<{ id: string; title: ReactNode; description?: ReactNode; meta?: ReactNode }>;
  severity?: "warning" | "danger" | "info";
  action?: ReactNode;
}) {
  if (items.length === 0) return null;

  return (
    <section className="rounded-[var(--r-lg)] border border-[var(--border-hairline)] bg-[var(--surface-0)] p-4 shadow-[var(--shadow-xs)]">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <AlertTriangle className="h-4 w-4 text-[var(--status-halfday)]" />
          <h2 className="text-sm font-semibold text-[var(--text-primary)]">{title}</h2>
          <StatusBadgeV2 status={severity === "danger" ? "blocked" : severity} label={`${items.length}`} showIcon={false} />
        </div>
        {action}
      </div>
      <div className="grid gap-2 md:grid-cols-3">
        {items.map((item) => (
          <div key={item.id} className="rounded-[var(--r-md)] border border-[var(--border-hairline)] bg-[var(--surface-1)] p-3">
            <p className="text-sm font-semibold text-[var(--text-primary)]">{item.title}</p>
            {item.description && <p className="mt-1 text-xs leading-5 text-[var(--text-muted)]">{item.description}</p>}
            {item.meta && <div className="mt-2 text-xs font-medium text-[var(--text-secondary)]">{item.meta}</div>}
          </div>
        ))}
      </div>
    </section>
  );
}
