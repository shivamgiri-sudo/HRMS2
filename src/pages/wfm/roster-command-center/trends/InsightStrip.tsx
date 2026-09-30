import { AlertOctagon, AlertTriangle, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Insight, Severity } from "./trendsCalc";

const STYLE: Record<Severity, { box: string; icon: typeof Info; word: string }> = {
  critical: { box: "border-red-200 bg-red-50 text-red-900 hover:bg-red-100", icon: AlertOctagon, word: "Critical" },
  warning: { box: "border-amber-200 bg-amber-50 text-amber-900 hover:bg-amber-100", icon: AlertTriangle, word: "Warning" },
  info: { box: "border-blue-200 bg-blue-50 text-blue-900 hover:bg-blue-100", icon: Info, word: "Info" },
};

/** Severity-ordered alert chips; clicking one jumps to the section that explains it. */
export function InsightStrip({ insights, onSelect }: { insights: Insight[]; onSelect: (i: Insight) => void }) {
  if (insights.length === 0) return null;
  const counts = insights.reduce<Record<Severity, number>>((a, i) => ({ ...a, [i.severity]: a[i.severity] + 1 }), { critical: 0, warning: 0, info: 0 });
  return (
    <section aria-label="Alerts and insights" className="space-y-2">
      <p className="text-xs text-slate-600">
        {counts.critical} critical · {counts.warning} warning · {counts.info} info
      </p>
      <ul className="flex flex-wrap gap-2">
        {insights.map((i) => {
          const s = STYLE[i.severity];
          const Icon = s.icon;
          return (
            <li key={i.id}>
              <button
                type="button"
                onClick={() => onSelect(i)}
                className={cn("inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border px-3 py-1.5 text-left text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none sm:min-h-[32px]", s.box)}
              >
                <Icon className="h-3.5 w-3.5 shrink-0" aria-hidden />
                <span className="sr-only">{s.word}: </span>
                {i.label}
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
