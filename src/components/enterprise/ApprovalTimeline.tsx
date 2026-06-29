import type { ReactNode } from "react";
import { StatusBadgeV2 } from "./StatusBadgeV2";

export function ApprovalTimeline({
  items,
}: {
  items: Array<{ id: string; label: ReactNode; status: string; description?: ReactNode }>;
}) {
  return (
    <ol className="space-y-3">
      {items.map((item) => (
        <li key={item.id} className="flex gap-3">
          <span className="mt-1 h-2.5 w-2.5 rounded-full bg-[var(--brand-500)]" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="text-sm font-semibold text-[var(--text-primary)]">{item.label}</p>
              <StatusBadgeV2 status={item.status} />
            </div>
            {item.description && <p className="mt-1 text-xs text-[var(--text-muted)]">{item.description}</p>}
          </div>
        </li>
      ))}
    </ol>
  );
}
