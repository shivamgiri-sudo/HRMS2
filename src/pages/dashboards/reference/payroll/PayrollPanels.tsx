import { Link } from "react-router-dom";
import { cn } from "@/lib/utils";
import { Panel, RankedBars, DonutChart } from "../../kit";
import { formatCurrency, formatValue } from "../../reference-dashboard-model";
import { formatPayDate, pctChange, type Filing, type Headcount, type RunData, type RunTotals } from "./payrollModel";

const money = (v: number | null | undefined) => (v === null || v === undefined ? "—" : formatCurrency(v));
const sign = (v: number) => (v > 0 ? "+" : v < 0 ? "-" : "");

/** Current vs previous run, one row per total, with the signed change. */
export function RunComparePanel({ run }: { run: RunData }) {
  const cur = run.totals, prev = run.previous;
  const rows: Array<{ label: string; cur: number; prev: number | null; fmt: (v: number) => string; goodUp: boolean; href: string }> = [
    { label: "Net pay", cur: cur.net, prev: prev?.net ?? null, fmt: formatCurrency, goodUp: true, href: "/payroll/variance-analysis" },
    { label: "Employee deductions", cur: cur.deductions, prev: prev?.deductions ?? null, fmt: formatCurrency, goodUp: true, href: "/payroll/variance-analysis" },
    { label: "Employer PF + ESI", cur: cur.employer, prev: prev?.employer ?? null, fmt: formatCurrency, goodUp: false, href: "/payroll/statutory" },
    { label: "Total payroll cost", cur: cur.payrollCost, prev: prev?.payrollCost ?? null, fmt: formatCurrency, goodUp: false, href: "/payroll/variance-analysis" },
    { label: "Employees paid", cur: cur.employees, prev: prev?.employees ?? null, fmt: (v) => v.toLocaleString("en-IN"), goodUp: true, href: "/payroll" },
    { label: "LOP days", cur: cur.lopDays, prev: prev?.lopDays ?? null, fmt: (v) => v.toLocaleString("en-IN", { maximumFractionDigits: 1 }), goodUp: false, href: "/payroll/attendance-control-tower" },
  ];
  const maxDriver = Math.max(1, ...run.drivers.map((d) => Math.abs(d.amount)));
  return (
    <Panel title="This run vs previous run" subtitle={run.previousRun ? `Compared with ${run.previousRun.month}, same scope` : "No earlier run to compare with"} href="/payroll/variance-analysis" hrefLabel="Variance analysis">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[420px] text-left text-[12px]">
          <thead className="text-slate-500"><tr><th className="py-1.5 font-semibold">Total</th><th className="py-1.5 text-right font-semibold">This run</th><th className="py-1.5 text-right font-semibold">Previous</th><th className="py-1.5 text-right font-semibold">Change</th></tr></thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((r) => {
              const change = pctChange(r.cur, r.prev);
              const good = change === null || change === 0 ? null : (change > 0) === r.goodUp;
              return (
                <tr key={r.label} className="hover:bg-slate-50">
                  <td className="py-2 font-medium text-slate-800"><Link to={r.href} className="hover:text-blue-700">{r.label}</Link></td>
                  <td className="kit-num py-2 text-right font-bold text-slate-900">{r.fmt(r.cur)}</td>
                  <td className="kit-num py-2 text-right text-slate-500">{r.prev === null ? "—" : r.fmt(r.prev)}</td>
                  <td className={cn("kit-num py-2 text-right font-semibold", good === null ? "text-slate-500" : good ? "text-emerald-700" : "text-rose-700")}>{change === null ? "—" : `${sign(change)}${Math.abs(change)}%`}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {run.drivers.length ? (
        <div className="mt-4 border-t border-slate-100 pt-3">
          <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">What moved net pay</p>
          <ul className="mt-2 space-y-2">
            {run.drivers.map((d) => (
              <li key={d.key} title={d.hint}>
                <div className="flex items-baseline justify-between gap-3 text-[12px]">
                  <span className="truncate font-medium text-slate-700">{d.label}</span>
                  <span className={cn("kit-num shrink-0 font-bold", d.amount === 0 ? "text-slate-500" : d.amount > 0 ? "text-emerald-700" : "text-rose-700")}>{d.amount === 0 ? d.hint : `${sign(d.amount)}${formatCurrency(Math.abs(d.amount))}`}</span>
                </div>
                {d.amount !== 0 ? <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className={cn("h-full rounded-full", d.amount > 0 ? "bg-emerald-500" : "bg-rose-500")} style={{ width: `${Math.max(3, (Math.abs(d.amount) / maxDriver) * 100)}%` }} /></div> : null}
                {d.amount !== 0 ? <p className="mt-0.5 text-[11px] text-slate-400">{d.hint}</p> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </Panel>
  );
}

/** Active headcount vs what is in the run, with the reason each active employee is missing. */
export function HeadcountPanel({ h, totalEmployees }: { h: Headcount; totalEmployees: number | null }) {
  const segs = [
    { key: "in", label: "Active & in this run", value: h.activeInRun, cls: "bg-emerald-500", href: "/payroll" },
    { key: "notdue", label: "Joined after the run month (not due)", value: h.missingNotDue, cls: "bg-slate-300", href: "/employees" },
    { key: "nostruct", label: "No salary structure", value: h.missingNoStructure, cls: "bg-rose-500", href: "/payroll/package-admin" },
    { key: "other", label: "Excluded for another reason", value: h.missingOther, cls: "bg-amber-500", href: "/payroll/salary-verification" },
  ];
  const total = Math.max(1, h.activeInScope);
  return (
    <Panel title="Headcount: active vs in this run" subtitle={`${formatValue(h.activeInScope)} active employees in scope`} href="/employees" hrefLabel="Employees">
      <div className="flex h-4 w-full overflow-hidden rounded-full bg-slate-100" role="img" aria-label="Active employees by run status">
        {segs.map((s) => s.value > 0 ? <div key={s.key} className={s.cls} style={{ width: `${(s.value / total) * 100}%` }} /> : null)}
      </div>
      <ul className="mt-3 space-y-1.5">
        {segs.map((s) => (
          <li key={s.key}>
            <Link to={s.href} className="flex items-center justify-between gap-3 rounded-md px-1 py-1 text-[12px] hover:bg-slate-50">
              <span className="flex min-w-0 items-center gap-2"><span className={cn("h-2.5 w-2.5 shrink-0 rounded-full", s.cls)} /><span className="truncate text-slate-700">{s.label}</span></span>
              <span className="kit-num font-bold text-slate-900">{s.value.toLocaleString("en-IN")}</span>
            </Link>
          </li>
        ))}
      </ul>
      <p className="mt-3 rounded-lg bg-slate-50 p-2.5 text-[11px] leading-snug text-slate-500">
        The run holds {h.inRun.toLocaleString("en-IN")} lines: {h.activeInRun.toLocaleString("en-IN")} active plus {h.paidInactive.toLocaleString("en-IN")} paid leavers
        who are no longer active. {totalEmployees !== null && totalEmployees !== h.inRun ? `The run header says ${totalEmployees.toLocaleString("en-IN")}, which is stale; the line count is used.` : null}
      </p>
    </Panel>
  );
}

const STATUS_CLS = { filed: "bg-emerald-50 text-emerald-700 ring-emerald-200", pending: "bg-blue-50 text-blue-700 ring-blue-200", overdue: "bg-rose-50 text-rose-700 ring-rose-200" } as const;

/** PF / ESI / TDS / LWF filings for the run month, with due dates, status and the liability derived from run lines. */
export function StatutoryPanel({ filings, totals, month }: { filings: Filing[]; totals: RunTotals; month: string }) {
  const liability = (type: string) => (type === "EPF" ? totals.pfLiability : type === "ESIC" ? totals.esiLiability : type.startsWith("TDS") ? totals.tds : null);
  return (
    <Panel title={`Statutory filings (${month})`} subtitle="PF, ESI, TDS, LWF - Professional Tax is retired" href="/payroll/statutory?tab=filing" hrefLabel="Filing centre">
      <div className="grid grid-cols-3 gap-2">
        {([["PF liability", totals.pfLiability], ["ESI liability", totals.esiLiability], ["TDS withheld", totals.tds]] as const).map(([label, v]) => (
          <Link key={label} to="/payroll/statutory" className="rounded-xl border border-slate-200 p-3 text-center transition hover:border-blue-300">
            <p className="text-[11px] text-slate-500">{label}</p><p className="kit-num mt-1 text-[15px] font-extrabold text-slate-900">{money(v)}</p>
          </Link>
        ))}
      </div>
      {filings.length ? (
        <ul className="mt-3 divide-y divide-slate-100">
          {filings.map((f) => (
            <li key={`${f.type}-${f.dueDate}`}>
              <Link to="/payroll/statutory?tab=filing" className="flex items-center justify-between gap-3 py-2 text-[12px] hover:bg-slate-50">
                <span className="min-w-0"><span className="font-semibold text-slate-800">{f.label}</span><span className="ml-2 text-slate-500">due {formatPayDate(f.dueDate)}{f.daysToDue !== null ? ` (${f.daysToDue < 0 ? `${-f.daysToDue}d late` : `in ${f.daysToDue}d`})` : ""}</span></span>
                <span className="flex shrink-0 items-center gap-2">
                  {liability(f.type) !== null ? <span className="kit-num text-slate-600">{money(liability(f.type))}</span> : null}
                  <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-bold capitalize ring-1", STATUS_CLS[f.status])}>{f.status}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : <p className="mt-3 text-[12px] text-amber-700">No filing records exist for {month}, so due dates and status cannot be shown.</p>}
    </Panel>
  );
}

/** What was actually disbursed (NEFT record) and how many payslips exist for this run's lines. */
export function DisbursalPanel({ run, status }: { run: RunData; status: string }) {
  const d = run.disbursement, p = run.payslips;
  const pct = p && p.expected > 0 ? Math.round((p.generated / p.expected) * 1000) / 10 : null;
  return (
    <Panel title="Disbursal & payslips" subtitle={`Run status: ${status}`} href="/payroll/payment-center" hrefLabel="Payment centre">
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Bank disbursal</p>
          {d ? (
            <dl className="mt-2 space-y-1.5 text-[12px]">
              {([["Status", d.status ?? "—"], ["Amount disbursed", money(d.amount)], ["Employees paid", formatValue(d.employees)], ["Bank reference", d.bankRef ?? "—"], ["Disbursed on", formatPayDate(d.at)]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="kit-num truncate font-semibold text-slate-900">{v}</dd></div>
              ))}
            </dl>
          ) : <p className="mt-2 text-[12px] text-amber-700">No disbursement is recorded for this run.</p>}
        </div>
        <div>
          <p className="text-[12px] font-bold uppercase tracking-wide text-slate-500">Payslips</p>
          {p && pct !== null ? (
            <>
              <DonutChart size={120} centerLabel={`${pct}%`} points={[{ label: "Generated", value: p.generated }, { label: "Pending", value: Math.max(0, p.expected - p.generated) }]} />
              <p className="mt-1 text-[11px] text-slate-500">{p.generated.toLocaleString("en-IN")} of {p.expected.toLocaleString("en-IN")} lines | {p.acknowledged.toLocaleString("en-IN")} acknowledged | {p.emailed.toLocaleString("en-IN")} emailed</p>
            </>
          ) : <p className="mt-2 text-[12px] text-slate-500">No payroll lines in this run to generate payslips for.</p>}
        </div>
      </div>
    </Panel>
  );
}

export function BranchCostPanel({ run }: { run: RunData }) {
  return (
    <Panel title="Payroll cost by branch" subtitle="Net + deductions + employer PF/ESI, top 12 branches" href="/payroll/readiness/cost-centres" hrefLabel="Cost centres">
      <RankedBars unit="inr" limit={12} points={run.branchCost.map((b) => ({ label: `${b.branch} (${b.employees})`, value: b.cost, href: "/payroll/readiness/cost-centres" }))} />
    </Panel>
  );
}

/** Employees whose pay needs a second look: zero / negative net, and large swings vs the previous run. */
export function AbnormalPanel({ run }: { run: RunData }) {
  return (
    <Panel title="Needs a second look" subtitle="Zero or negative net for active staff, and swings of 25%+ vs the previous run" href="/payroll/variance-analysis" hrefLabel="Variance analysis" bodyClassName="p-0">
      {!run.abnormal.length ? <p className="p-4 text-[12px] text-emerald-700">No abnormal lines found for this run.</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[420px] text-left text-[12px]">
            <thead className="bg-slate-50 text-slate-500"><tr><th className="px-4 py-2 font-semibold">Employee</th><th className="px-4 py-2 text-right font-semibold">Net pay</th><th className="px-4 py-2 font-semibold">Why</th></tr></thead>
            <tbody className="divide-y divide-slate-100">
              {run.abnormal.map((a) => (
                <tr key={`${a.code}-${a.reason}`} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5"><Link to="/payroll/variance-analysis" className="font-medium text-blue-700 hover:underline">{a.code}</Link><span className="ml-2 text-slate-500">{a.name}</span></td>
                  <td className="kit-num px-4 py-2.5 text-right font-semibold text-slate-900">{money(a.net)}</td>
                  <td className="px-4 py-2.5 text-slate-600">{a.reason}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}
