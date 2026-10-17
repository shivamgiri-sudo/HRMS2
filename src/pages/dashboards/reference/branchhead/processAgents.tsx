import { useState } from "react";
import { CheckCircle2, CircleDashed, PhoneIncoming, PhoneOutgoing, TrendingUp } from "lucide-react";
import { useProcessDrilldown } from "@/hooks/useBranchHeadHealth";
import type { BranchProcess, CoverageTier, DrillRow } from "../../../../../backend/src/modules/branch-head-health/processes";

const TIER = {
  full: { label: "Full", Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-900 border-emerald-300" },
  inbound_quality: { label: "Inbound + quality", Icon: PhoneIncoming, cls: "bg-blue-50 text-blue-900 border-blue-300" },
  outbound_sale: { label: "Outbound sale", Icon: PhoneOutgoing, cls: "bg-blue-50 text-blue-900 border-blue-300" },
  baseline: { label: "Baseline only", Icon: TrendingUp, cls: "bg-amber-50 text-amber-900 border-amber-300" },
  not_wired: { label: "Not wired", Icon: CircleDashed, cls: "bg-slate-100 text-slate-800 border-slate-300" },
} as const;

/** Plain-text tier label (for table twins). */
export function coverageLabel(tier: CoverageTier): string {
  return (TIER[tier] ?? TIER.not_wired).label;
}

export function CoverageBadge({ tier }: { tier: CoverageTier }) {
  const { label, Icon, cls } = TIER[tier] ?? TIER.not_wired;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </span>
  );
}

/** Drill-down metric per coverage tier; null means no agent-level metric exists for the tier. */
export function drillMetricFor(tier: CoverageTier): { key: string; label: string } | null {
  if (tier === "full" || tier === "inbound_quality") return { key: "QA_QUALITY_PCT", label: "QA quality %" };
  if (tier === "outbound_sale") return { key: "FUNNEL_SALE_PCT", label: "Sale conversion %" };
  return null;
}

export function DrilldownTable({ rows, valueLabel }: { rows: DrillRow[]; valueLabel?: string | null }) {
  if (rows.length === 0) return <p className="text-[13px] text-slate-700">No agent-level values for this process yet.</p>;
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">Agent values for the selected process</caption>
      <thead><tr className="text-slate-700"><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Name</th>{valueLabel ? <th className="py-1 text-right">{valueLabel}</th> : null}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employeeCode} className="border-t border-slate-100">
            <td className="py-1.5 pr-2">{r.employeeCode}</td><td className="py-1.5 pr-2">{r.name}</td>
            {valueLabel ? <td className="py-1.5 text-right font-semibold">{r.value == null ? "—" : r.value}</td> : null}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Drill({ branchId, processId, tier }: { branchId: string; processId: string; tier: CoverageTier }) {
  const metric = drillMetricFor(tier);
  // Baseline / not-wired processes have no agent-level metric; the request still lists names (value column hidden).
  const q = useProcessDrilldown(branchId, processId, metric?.key ?? "QA_QUALITY_PCT", true);
  if (q.isLoading) return <div className="kit-shimmer h-24 rounded-lg" aria-busy="true" aria-label="Loading agent values" />;
  if (q.isError) return <p role="alert" className="text-[13px] text-rose-900">Agent values could not be loaded.</p>;
  return (
    <>
      {metric ? null : <p className="pb-2 text-[12px] text-slate-700">No agent-level metric for this process type</p>}
      <DrilldownTable rows={q.data ?? []} valueLabel={metric?.label ?? null} />
    </>
  );
}

/** Default drill branch: the globally selected branch if the process is reachable there, else its first branch. */
export function defaultDrillBranch(p: BranchProcess, selectedBranchId: string): string {
  return p.branchIds.includes(selectedBranchId) ? selectedBranchId : p.branchIds[0] ?? "";
}

/**
 * The agent list for one process (the only place person names appear): branch picker when the process
 * spans several branches, then the lazy drill-down. Mount it only on demand; it fetches when mounted.
 */
export function ProcessAgents({ p, selectedBranchId, branchNames }: { p: BranchProcess; selectedBranchId: string; branchNames: Record<string, string> }) {
  const [picked, setPicked] = useState("");
  const drillBranch = p.branchIds.includes(picked) ? picked : defaultDrillBranch(p, selectedBranchId);
  if (p.branchIds.length === 0) {
    return <p className="text-[13px] text-slate-700">Agent names are not available: this process has no cost centre or headcount in your selected branches.</p>;
  }
  return (
    <>
      {p.branchIds.length > 1 ? (
        <label className="mb-2 block text-[12px] font-semibold text-slate-800">
          Branch for agent values
          <select value={drillBranch} onChange={(e) => setPicked(e.target.value)}
            className="mt-1 block min-h-[44px] rounded-lg border border-slate-300 bg-white px-3 text-[14px] text-slate-900">
            {p.branchIds.map((b) => <option key={b} value={b}>{branchNames[b] ?? b}</option>)}
          </select>
        </label>
      ) : null}
      <Drill branchId={drillBranch} processId={p.processId} tier={p.tier} />
    </>
  );
}
