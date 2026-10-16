import type { FinanceData } from "./panelTypes";
import { formatCount, formatInr } from "./format";
import { Stat, Stats, SubHead, Table, Td } from "./ui";

/** GRN pipeline, tie-out and payroll readiness, shown as the report computes them. */
export function FinanceGrn({ d }: { d: FinanceData }) {
  const g = d.grn;
  const t = d.tieOut;
  const p = d.payrollReadiness;
  return (
    <>
      {g ? (
        <>
          <SubHead>GRN pipeline</SubHead>
          <Stats label="GRN summary">
            <Stat label="Raised this month" value={formatCount(g.raised)} hint={formatInr(g.totalRaisedAmount)} />
            <Stat label="Approved" value={formatCount(g.approved)} />
            <Stat label="Pending" value={formatCount(g.pending)} hint={`Oldest ${g.oldestPendingDays} days, ${g.pendingOver3Days} over 3 days`} />
            <Stat label="Unbudgeted" value={formatCount(g.unbudgeted.count)} hint={formatInr(g.unbudgeted.amountExGst)} />
          </Stats>
          <SubHead>Pending by stage</SubHead>
          <Table caption="Open GRNs by approval stage" cols={[{ label: "Waiting on" }, { label: "Count", right: true }, { label: "Amount incl. GST", right: true }, { label: "Oldest (days)", right: true }]} minWidth={400}>
            {g.pendingByStage.map((s) => <tr key={s.status}><Td strong>{s.stage}</Td><Td right>{s.count}</Td><Td right>{formatInr(s.amountInclGst)}</Td><Td right>{s.oldestDays}</Td></tr>)}
          </Table>
          <SubHead>By GRN type</SubHead>
          <Table caption="GRNs by type" cols={[{ label: "Type" }, { label: "Raised", right: true }, { label: "Raised ex-GST", right: true }, { label: "Approved", right: true }, { label: "Pending", right: true }, { label: "Pending incl. GST", right: true }]} minWidth={560}>
            {g.byType.map((x) => <tr key={x.type}><Td strong>{x.label}</Td><Td right>{x.raised}</Td><Td right>{formatInr(x.raisedExGst)}</Td><Td right>{x.approved}</Td><Td right>{x.pending}</Td><Td right>{formatInr(x.pendingInclGst)}</Td></tr>)}
          </Table>
        </>
      ) : null}
      {t ? (
        <>
          <SubHead>Tie-out between budget and P&amp;L</SubHead>
          <dl className="space-y-1 text-[13px] text-slate-800">
            {([
              ["Budget consumed", t.budgetConsumed], ["Budget reserved", t.budgetReserved], ["Booked in P&L without a budget line", t.hrmsNoBudgetLine],
              ["Ordinary GRNs without allocation", t.hrmsOrdinary], ["Imprest reserved with no cost centre", t.imprestReservedNoCostCentre],
            ] as Array<[string, number]>).map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt>{l}</dt><dd className="font-semibold tabular-nums">{formatInr(v)}</dd></div>)}
          </dl>
        </>
      ) : null}
      {p ? (
        <>
          <SubHead>Payroll readiness ({p.cycleMonth})</SubHead>
          <Stats label="Payroll readiness">
            <Stat label="Pending regularization" value={formatCount(p.pendingRegularization)} />
            <Stat label="Pending leave" value={formatCount(p.pendingLeave)} />
            <Stat label="Pending increments" value={formatCount(p.pendingIncrements)} hint={p.oldestIncrementDays == null ? undefined : `Oldest ${p.oldestIncrementDays} days`} />
          </Stats>
        </>
      ) : null}
    </>
  );
}
