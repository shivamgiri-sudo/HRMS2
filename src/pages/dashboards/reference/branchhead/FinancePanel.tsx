import type { SectionResult } from "../../../../../backend/src/modules/branch-head-health/types";
import type { FinanceData, HeadRow } from "./panelTypes";
import { FinanceGrn } from "./FinanceGrn";
import { formatInr, formatPct } from "./format";
import { Note, SectionShell, Stat, Stats, SubHead, Table, Td } from "./ui";

const heads = (caption: string, rows: HeadRow[]) => (
  <Table caption={caption} cols={[{ label: "Head" }, { label: "Budget", right: true }, { label: "Charged", right: true }, { label: "Used" }]} minWidth={360}>
    {rows.map((r) => <tr key={r.head}><Td strong>{r.head}</Td><Td right>{formatInr(r.budget)}</Td><Td right>{formatInr(r.charged)}</Td><Td>{formatPct(r.pct)}{r.pct > 100 ? " - Over budget" : ""}</Td></tr>)}
  </Table>
);

export function FinancePanel({ section }: { section?: SectionResult<unknown> }) {
  return (
    <SectionShell<FinanceData> title="Running P&L - month to date (as in the emailed report)" section={section} emptyText="No finance data for this date" errorName="Finance">
      {(d) => {
        const p = d.pnl;
        const b = d.budget;
        return (
          <>
            <Note>Period {p.periodCode}, day {p.daysElapsed} of {p.daysInMonth} ({p.mode}). Cost centres: {p.costCentres}, estimated: {p.estimatedCostCentres}.</Note>
            <Stats label="Running P&L">
              <Stat label="Revenue" value={formatInr(p.revenueRunning)} />
              <Stat label="Total cost" value={formatInr(p.totalCostRunning)} />
              <Stat label="Operating profit" value={formatInr(p.operatingProfit)} />
              <Stat label="OP %" value={formatPct(p.opPct)} />
            </Stats>
            <SubHead>Revenue and cost breakdown</SubHead>
            <Table caption="Running revenue and cost components" cols={[{ label: "Component" }, { label: "Amount", right: true }]} minWidth={280}>
              <tr><Td>Invoice</Td><Td right>{formatInr(p.revenueInvoice)}</Td></tr>
              <tr><Td>Accrual</Td><Td right>{formatInr(p.revenueAccrual)}</Td></tr>
              <tr><Td>Estimated (seat rate)</Td><Td right>{formatInr(p.revenueEstimated)}</Td></tr>
              <tr><Td>Credit notes</Td><Td right>{formatInr(-Math.abs(p.creditNote))}</Td></tr>
              <tr><Td>Salary ({p.staffPaid} staff paid)</Td><Td right>{formatInr(p.salaryRunning)}</Td></tr>
              <tr><Td>GRN consumed</Td><Td right>{formatInr(p.grnConsumed)}</Td></tr>
              <tr><Td>GRN reserved</Td><Td right>{formatInr(p.grnReserved)}</Td></tr>
            </Table>
            <SubHead>Projection for the full month</SubHead>
            {p.dataAvailable && d.projection ? (
              <>
                <Stats label="Projection">
                  <Stat label="Revenue" value={formatInr(d.projection.revenue)} />
                  <Stat label="Cost" value={formatInr(d.projection.cost)} />
                  <Stat label="Operating profit" value={formatInr(d.projection.operatingProfit)} />
                  <Stat label="OP %" value={formatPct(d.projection.opPct)} />
                </Stats>
                <Note>Projection basis: {d.projection.basis}</Note>
              </>
            ) : <p className="text-[13px] text-slate-700">No P&amp;L data yet for this month</p>}
            <SubHead>Budget</SubHead>
            {b.headerMissing ? <Note>No budget has been created for this month.</Note> : null}
            <Stats label="Budget">
              <Stat label="Total budget" value={formatInr(b.totalBudget)} />
              <Stat label="Consumed" value={formatInr(b.consumed)} />
              <Stat label="Reserved" value={formatInr(b.reserved)} />
              <Stat label="Available" value={formatInr(b.available)} hint={`Used ${formatPct(b.utilizationPct)}${b.headerStatus ? `, status ${b.headerStatus}` : ""}`} />
            </Stats>
            {d.byHead.top.length > 0 ? <><SubHead>Top heads by spend</SubHead>{heads("Top budget heads by spend", d.byHead.top.slice(0, 10))}</> : null}
            {d.byHead.overBudget.length > 0 ? <><SubHead>Heads over budget</SubHead>{heads("Budget heads over budget", d.byHead.overBudget.slice(0, 10))}</> : null}
            <FinanceGrn d={d} />
          </>
        );
      }}
    </SectionShell>
  );
}
