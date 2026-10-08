// Analytics strip for the Ops Control Tower: joiner-journey funnel (bottleneck highlighted) and
// the branches carrying the most open work. Everything is derived from the summary already fetched.
import { useMemo } from "react";
import { bottleneck, buildFunnel, rankBranches } from "./opsControlTowerAnalytics";
import type { BranchRef, DetailBlockKey, OpsControlTowerSummary } from "./opsControlTowerTypes";

const jump = (id: string) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth" });

export function OpsAnalyticsPanel({ data, onOpen }: { data: OpsControlTowerSummary; onOpen: (b: BranchRef, block: DetailBlockKey, title: string) => void }) {
  const steps = useMemo(() => buildFunnel(data), [data]);
  const worst = useMemo(() => bottleneck(steps), [steps]);
  const ranks = useMemo(() => rankBranches(data), [data]);
  const max = Math.max(1, ...steps.map((s) => s.total));
  const rankMax = Math.max(1, ...ranks.map((r) => r.total));

  return (
    <div className="grid gap-3 lg:grid-cols-2">
      <section className="rounded-xl border bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">New-joiner funnel — where people are stuck</h2>
        <p className="mb-2 mt-0.5 text-xs text-slate-500">
          {worst ? `Biggest bottleneck: ${worst.label} (${worst.total} pending).` : "No joiner is pending on any step."}
        </p>
        <ul className="space-y-1.5">
          {steps.map((s) => (
            <li key={s.key}>
              <button type="button" onClick={() => jump(s.sectionId)} className="flex w-full items-center gap-2 text-left text-xs">
                <span className="w-32 shrink-0 text-slate-600">{s.label}</span>
                <span className="h-3 flex-1 rounded bg-slate-100">
                  <span className={`block h-3 rounded ${worst?.key === s.key ? "bg-red-500" : "bg-slate-500"}`} style={{ width: `${(s.total / max) * 100}%` }} />
                </span>
                <span className="w-8 text-right font-mono font-semibold text-slate-800">{s.total}</span>
              </button>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-xl border bg-white p-4">
        <h2 className="text-sm font-bold text-slate-900">Branches with the most open work</h2>
        <p className="mb-2 mt-0.5 text-xs text-slate-500">All pending items summed per branch. Click to open the worst item.</p>
        <ul className="space-y-1.5">
          {ranks.map((r) => (
            <li key={r.branchId}>
              <button type="button" onClick={() => onOpen({ branchId: r.branchId, branchName: r.branchName } as BranchRef, r.worstBlock, r.worstLabel)}
                className="flex w-full items-center gap-2 text-left text-xs">
                <span className="w-32 shrink-0 truncate font-medium text-slate-800">{r.branchName}</span>
                <span className="h-3 flex-1 rounded bg-slate-100"><span className="block h-3 rounded bg-orange-500" style={{ width: `${(r.total / rankMax) * 100}%` }} /></span>
                <span className="w-8 text-right font-mono font-semibold text-slate-800">{r.total}</span>
                <span className="hidden w-28 shrink-0 truncate text-slate-400 sm:block">{r.worstLabel} {r.worstCount}</span>
              </button>
            </li>
          ))}
          {ranks.length === 0 && <p className="text-xs text-slate-400">Nothing open.</p>}
        </ul>
      </section>
    </div>
  );
}
