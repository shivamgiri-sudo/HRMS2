import { Link } from "react-router-dom";
import type { ReactNode } from "react";
import { AlertTriangle, ArrowUpRight, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { Panel } from "../../kit";
import { formatCurrency, formatValue } from "../../reference-dashboard-model";

export interface BlockerValues {
  readyCount: number | null; readinessTotal: number | null; blockerCount: number | null;
  missingBank: number | null; missingNeftBank: number | null; missingPan: number | null; invalidPan: number | null; missingUan: number | null;
  noStructure: number | null; unfrozenUnits: { units: number; frozen: number } | null; zeroNet: number | null;
  unavailable: string | null;
}

function Row({ label, hint, value, tone, href, onClick }: { label: string; hint: string; value: number | null; tone: "red" | "amber" | "slate"; href?: string; onClick?: () => void }) {
  const chip = value === null ? "bg-slate-100 text-slate-500" : value === 0 ? "bg-emerald-50 text-emerald-700" : tone === "red" ? "bg-rose-50 text-rose-700" : tone === "amber" ? "bg-amber-50 text-amber-800" : "bg-slate-100 text-slate-700";
  const body = (
    <>
      <span className="min-w-0"><span className="block truncate text-[13px] font-semibold text-slate-800">{label}</span><span className="block truncate text-[11px] text-slate-500">{hint}</span></span>
      <span className="flex shrink-0 items-center gap-2"><span className={cn("kit-num rounded-lg px-2.5 py-1 text-[14px] font-extrabold", chip)}>{value === null ? "—" : value.toLocaleString("en-IN")}</span><ArrowUpRight className="h-3.5 w-3.5 text-slate-300" aria-hidden /></span>
    </>
  );
  const cls = "flex w-full items-center justify-between gap-3 px-4 py-2.5 text-left transition hover:bg-slate-50 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-500";
  if (onClick) return <li><button type="button" onClick={onClick} className={cls}>{body}</button></li>;
  return <li>{href ? <Link to={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>}</li>;
}

/** Blockers by reason. Counts only - no individual bank / PAN / UAN values are exposed. */
export function BlockersPanel({ v, onDrill }: { v: BlockerValues; onDrill?: () => void }) {
  const pct = v.readinessTotal && v.readyCount !== null && v.readinessTotal > 0 ? Math.round((v.readyCount / v.readinessTotal) * 100) : null;
  return (
    <Panel
      title="Payroll blockers by reason"
      subtitle={v.readyCount !== null && v.readinessTotal !== null ? `${v.readyCount.toLocaleString("en-IN")} of ${v.readinessTotal.toLocaleString("en-IN")} active employees ready (bank + PAN)` : "Readiness source unavailable"}
      action={pct !== null ? <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold ring-1", pct >= 95 ? "bg-emerald-50 text-emerald-700 ring-emerald-200" : pct >= 80 ? "bg-amber-50 text-amber-800 ring-amber-200" : "bg-rose-50 text-rose-700 ring-rose-200")}>{pct}% ready</span> : null}
      bodyClassName="p-0"
    >
      {v.unavailable ? <p className="p-4 text-[12px] text-amber-700">{v.unavailable}</p> : (
        <ul className="divide-y divide-slate-100">
          <Row label="Missing bank account" hint="Cannot be paid by NEFT (30-day joining grace)" value={v.missingBank} tone="red" href="/payroll/payment-center?tab=bank" />
          <Row label="No NEFT-ready bank row" hint="Payable only via the legacy column, invisible to the NEFT file" value={v.missingNeftBank} tone="amber" href="/payroll/payment-center?tab=bank" />
          <Row label="Missing PAN" hint="Blocks TDS computation" value={v.missingPan} tone="red" href="/employees" />
          <Row label="Invalid PAN format" hint="Stored but rejected by the payroll engine" value={v.invalidPan} tone="red" href="/employees" />
          <Row label="Missing UAN" hint="Blocks PF filing (60-day grace)" value={v.missingUan} tone="amber" href="/payroll/pf-management" />
          <Row label="No salary structure" hint="Active employees with no active package assignment" value={v.noStructure} tone="red" href="/payroll/package-admin" />
          <Row label="Attendance not frozen" hint={v.unfrozenUnits ? `of ${v.unfrozenUnits.units} branch-process units for this month` : "No readiness rows for this month"} value={v.unfrozenUnits ? v.unfrozenUnits.units - v.unfrozenUnits.frozen : null} tone="red" href="/payroll/readiness" />
          <Row label="Zero / negative net lines" hint="In the selected run" value={v.zeroNet} tone="amber" href="/payroll/attendance-control-tower" />
          <Row label="Total not payroll-ready" hint="Fails the bank + PAN gate - click for the branch split" value={v.blockerCount} tone="red" onClick={onDrill} href={onDrill ? undefined : "/payroll/readiness"} />
        </ul>
      )}
      <p className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-500">Salary holds: HRMS has no salary-hold register (only F&amp;F settlements carry a hold amount), so none can be counted here.</p>
    </Panel>
  );
}

export function IncentivePanel({ pending, pendingAmount, approvedAmount, rejected, unavailable }: {
  pending: number | null; pendingAmount: number | null; approvedAmount: number | null; rejected: number | null; unavailable: string | null;
}) {
  const rows: Array<[string, ReactNode, string]> = [
    ["Pending approval", formatValue(pending), "text-amber-700"], ["Pending amount", formatCurrency(pendingAmount), "text-amber-700"],
    ["Approved amount", formatCurrency(approvedAmount), "text-emerald-700"], ["Rejected batches", formatValue(rejected), "text-rose-700"],
  ];
  return (
    <Panel title="Incentive batches" subtitle="Awaiting approval, approved and rejected" href="/payroll/incentives" hrefLabel="Approve">
      {unavailable ? <p className="text-[12px] text-amber-700">{unavailable}</p> : (
        <dl className="grid grid-cols-2 gap-3">
          {rows.map(([k, v, c]) => <Link key={k} to="/payroll/incentives" className="rounded-xl border border-slate-200 p-3 transition hover:border-blue-300"><dt className="text-[11px] text-slate-500">{k}</dt><dd className={cn("kit-num mt-1 text-[18px] font-extrabold", c)}>{v}</dd></Link>)}
        </dl>
      )}
    </Panel>
  );
}

/** Data-integrity messages and sources that could not be computed. Truthful gaps, never silent zeros. */
export function NoticeBar({ integrity, unavailable }: { integrity: string[]; unavailable: Record<string, unknown> }) {
  const sources = Object.entries(unavailable);
  if (!integrity.length && !sources.length) return null;
  return (
    <div className="space-y-2" role="status">
      {integrity.length ? (
        <div className="flex gap-3 rounded-2xl border border-rose-200 bg-rose-50 px-4 py-3 text-[13px] text-rose-800">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /><div className="space-y-1">{integrity.map((m, i) => <p key={i}>{m}</p>)}</div>
        </div>
      ) : null}
      {sources.length ? (
        <details className="rounded-2xl border border-slate-200 bg-slate-50 px-4 py-2.5 text-[12px] text-slate-600">
          <summary className="flex cursor-pointer items-center gap-2 font-semibold text-slate-700"><Info className="h-4 w-4" aria-hidden />{sources.length} data source{sources.length > 1 ? "s" : ""} unavailable for this run</summary>
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">{sources.map(([k, why]) => <li key={k} className="rounded-lg border border-slate-200 bg-white p-2.5"><p className="font-semibold capitalize text-slate-800">{k}</p><p className="mt-0.5">{String(why)}</p></li>)}</ul>
        </details>
      ) : null}
    </div>
  );
}
