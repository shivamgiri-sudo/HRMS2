import { Link } from "react-router-dom";
import { CircleSlash } from "lucide-react";
import type { InsightAction } from "../../kit";

/**
 * Queues the system cannot count yet (no workflow, empty source, failed read). The ActionCenter lists open queues only,
 * so without this an unmeasurable queue would silently vanish and read as "nothing pending".
 */
export function GapNotes({ actions }: { actions: InsightAction[] | undefined }) {
  const gaps = (actions ?? []).filter((a) => a.count === null && a.unavailable);
  if (!gaps.length) return null;
  return (
    <aside aria-label="Queues that cannot be measured yet" className="rounded-2xl border border-dashed border-amber-300 bg-amber-50/60 px-4 py-3">
      <p className="flex items-center gap-1.5 text-[11px] font-extrabold uppercase tracking-wider text-amber-800"><CircleSlash className="h-3.5 w-3.5" aria-hidden />Not measurable yet - a data gap, not an empty queue</p>
      <ul className="mt-1.5 space-y-1">
        {gaps.map((g) => (
          <li key={g.id} className="text-[12px] text-amber-900"><Link to={g.href} className="font-semibold hover:underline">{g.label}</Link> - {g.unavailable}</li>
        ))}
      </ul>
    </aside>
  );
}
