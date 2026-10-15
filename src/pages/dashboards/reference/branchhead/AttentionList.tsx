import { AlertTriangle, AlertOctagon, ThumbsUp } from "lucide-react";
import type { BranchOverview } from "../../../../../backend/src/modules/branch-head-health/types";

export function AttentionList({ attention, positives }: Pick<BranchOverview, "attention" | "positives">) {
  if (attention.length === 0 && positives.length === 0) {
    return <p className="text-[13px] text-slate-700">Nothing needs attention right now.</p>;
  }
  return (
    <div className="grid gap-4 md:grid-cols-2">
      <ul className="space-y-2" aria-label="Needs attention">
        {attention.length === 0 ? <li className="text-[13px] text-slate-700">Nothing needs attention.</li> : null}
        {attention.map((a, i) => {
          const critical = a.severity === "critical";
          const Icon = critical ? AlertOctagon : AlertTriangle;
          return (
            <li key={`${a.label}-${i}`} className="flex min-h-[44px] items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
              <Icon className={`mt-0.5 h-4 w-4 shrink-0 ${critical ? "text-rose-700" : "text-amber-700"}`} aria-hidden="true" />
              <span className="text-[13px] text-slate-900">
                <strong>{critical ? "Critical: " : "Warning: "}{a.label}</strong>
                <span className="block text-slate-700">{a.detail}</span>
              </span>
            </li>
          );
        })}
      </ul>
      <ul className="space-y-2" aria-label="Going well">
        {positives.map((p, i) => (
          <li key={`${p.label}-${i}`} className="flex min-h-[44px] items-start gap-2 rounded-lg border border-slate-200 bg-white p-2.5">
            <ThumbsUp className="mt-0.5 h-4 w-4 shrink-0 text-emerald-700" aria-hidden="true" />
            <span className="text-[13px] text-slate-900"><strong>{p.label}</strong><span className="block text-slate-700">{p.detail}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}
