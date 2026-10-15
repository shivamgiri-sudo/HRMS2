import { useState } from "react";
import { CheckCircle2, ChevronDown, CircleDashed, Info, ShieldAlert, TrendingUp, PhoneIncoming, PhoneOutgoing } from "lucide-react";
import { Panel } from "../../kit";
import { useProcessDrilldown } from "@/hooks/useBranchHeadHealth";
import type { BranchProcess, CoverageTier, DrillRow } from "../../../../../backend/src/modules/branch-head-health/processes";

const TIER = {
  full: { label: "Full", Icon: CheckCircle2, cls: "bg-emerald-50 text-emerald-900 border-emerald-300" },
  inbound_quality: { label: "Inbound + quality", Icon: PhoneIncoming, cls: "bg-blue-50 text-blue-900 border-blue-300" },
  outbound_sale: { label: "Outbound sale", Icon: PhoneOutgoing, cls: "bg-blue-50 text-blue-900 border-blue-300" },
  baseline: { label: "Baseline only", Icon: TrendingUp, cls: "bg-amber-50 text-amber-900 border-amber-300" },
  not_wired: { label: "Not wired", Icon: CircleDashed, cls: "bg-slate-100 text-slate-800 border-slate-300" },
} as const;

export function CoverageBadge({ tier }: { tier: CoverageTier }) {
  const { label, Icon, cls } = TIER[tier] ?? TIER.not_wired;
  return (
    <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[12px] font-semibold ${cls}`}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />{label}
    </span>
  );
}

export function DrilldownTable({ rows }: { rows: DrillRow[] }) {
  if (rows.length === 0) return <p className="text-[13px] text-slate-700">No agent-level values for this process yet.</p>;
  return (
    <table className="w-full text-left text-[13px]">
      <caption className="sr-only">Agent values for the selected process</caption>
      <thead><tr className="text-slate-700"><th className="py-1 pr-2">Code</th><th className="py-1 pr-2">Name</th><th className="py-1 text-right">{rows[0].metric}</th></tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.employeeCode} className="border-t border-slate-100">
            <td className="py-1.5 pr-2">{r.employeeCode}</td><td className="py-1.5 pr-2">{r.name}</td>
            <td className="py-1.5 text-right font-semibold">{r.value == null ? "—" : r.value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function Drill({ branchId, processId }: { branchId: string; processId: string }) {
  const q = useProcessDrilldown(branchId, processId, "QA_QUALITY_PCT", true);
  if (q.isLoading) return <div className="kit-shimmer h-24 rounded-lg" aria-busy="true" aria-label="Loading agent values" />;
  if (q.isError) return <p role="alert" className="text-[13px] text-rose-900">Agent values could not be loaded.</p>;
  return <DrilldownTable rows={q.data ?? []} />;
}

function ProcessRow({ p, branchId }: { p: BranchProcess; branchId: string }) {
  const [open, setOpen] = useState(false);
  const over = p.mandatedSeats != null && p.headcount > p.mandatedSeats;
  return (
    <li className="border-t border-slate-100 first:border-t-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open}
        className="flex min-h-[44px] w-full flex-wrap items-center gap-x-3 gap-y-1 px-1 py-2 text-left">
        <ChevronDown className={`h-4 w-4 shrink-0 ${open ? "" : "-rotate-90"}`} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[14px] font-semibold text-slate-900">{p.processName}</span>
        <CoverageBadge tier={p.tier} />
        <span className="text-[12px] text-slate-700">
          {p.headcount} of {p.mandatedSeats ?? "—"} seats
          {over ? <span className="ml-1 inline-flex items-center gap-1 font-bold text-rose-900"><ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />Over mandate</span> : null}
        </span>
      </button>
      {open ? <div className="px-2 pb-3"><Drill branchId={branchId} processId={p.processId} /></div> : null}
    </li>
  );
}

function Group({ id, title, note, rows, branchId }: { id: string; title: string; note?: string; rows: BranchProcess[]; branchId: string }) {
  if (rows.length === 0) return null;
  return (
    <details data-group={id} className="mt-3 rounded-lg border border-slate-200">
      <summary className="flex min-h-[44px] cursor-pointer items-center gap-2 px-3 text-[13px] font-bold text-slate-900">
        {title} ({rows.length})
      </summary>
      <div className="px-3 pb-2">
        {note ? <p className="flex items-start gap-1.5 pb-2 text-[12px] text-slate-700"><Info className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />{note}</p> : null}
        <ul>{rows.map((p) => <ProcessRow key={p.processId} p={p} branchId={branchId} />)}</ul>
      </div>
    </details>
  );
}

export function ProcessCoveragePanel({ active, unmapped, branchId, error }: {
  active: BranchProcess[]; unmapped: BranchProcess[]; branchId: string; error?: boolean;
}) {
  const normal = active.filter((p) => !p.billingMirror);
  const mirrors = active.filter((p) => p.billingMirror);
  return (
    <Panel title="Process coverage" subtitle="Which processes report quality and sales data. Agent names appear only when you open a process.">
      {error ? <p role="alert" className="mb-2 flex items-center gap-2 rounded-lg border border-amber-300 bg-amber-50 p-2.5 text-[13px] text-amber-900"><Info className="h-4 w-4" aria-hidden="true" />Process coverage could not be loaded. Other sections are unaffected.</p> : null}
      {normal.length === 0 && !error ? <p className="text-[13px] text-slate-700">No active processes for this branch.</p> : null}
      <ul>{normal.map((p) => <ProcessRow key={p.processId} p={p} branchId={branchId} />)}</ul>
      <Group id="mirrors" title="Billing mirrors (BSS_*)" rows={mirrors} branchId={branchId} />
      <Group id="unmapped" title="Not mapped to a cost centre" note="Most of these are idle billing mirrors with no cost centre; they are listed for completeness." rows={unmapped} branchId={branchId} />
    </Panel>
  );
}
