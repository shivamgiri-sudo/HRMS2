import { BarList, ChartFrame, DataTable, StatTile, barListTable, type BarListProps, type TableSpec } from "../viz";
import type { FinanceData } from "../panelTypes";
import { formatCount, formatInr } from "../format";
import { Fold, nn, TileItem, Tiles } from "./shared";

/** Open GRNs by approval stage (count, with age and amount as the note); null without GRN data. */
export function grnStages(d: FinanceData): BarListProps | null {
  if (!d.grn) return null;
  return {
    label: "Open GRNs by approval stage",
    format: formatCount,
    items: d.grn.pendingByStage.map((s) => ({
      id: s.status, label: s.stage, value: nn(s.count), note: `oldest ${formatCount(s.oldestDays)} days, ${formatInr(s.amountInclGst)}`,
    })),
  };
}

function byTypeTable(g: NonNullable<FinanceData["grn"]>): TableSpec {
  return {
    caption: "GRNs by type",
    columns: ["Type", "Raised", "Raised ex-GST", "Approved", "Pending", "Pending incl. GST"],
    rows: g.byType.map((x) => [x.label, formatCount(x.raised), formatInr(x.raisedExGst), formatCount(x.approved), formatCount(x.pending), formatInr(x.pendingInclGst)]),
  };
}

/** GRN pipeline: four tiles, the stage bars (the Backlogs section links here) and types in a fold. */
export function FinanceGrn({ d, stages }: { d: FinanceData; stages: BarListProps | null }) {
  const g = d.grn;
  if (!g || !stages) return null;
  return (
    <div className="space-y-3">
      <Tiles label="GRN summary">
        <TileItem><StatTile label="GRNs raised this month" value={formatCount(g.raised)} hint={formatInr(g.totalRaisedAmount)} /></TileItem>
        <TileItem><StatTile label="Approved" value={formatCount(g.approved)} /></TileItem>
        <TileItem><StatTile label="Pending" value={formatCount(g.pending)} hint={`Oldest ${formatCount(g.oldestPendingDays)} days, ${formatCount(g.pendingOver3Days)} over 3 days`} /></TileItem>
        <TileItem><StatTile label="Unbudgeted" value={formatCount(g.unbudgeted.count)} hint={formatInr(g.unbudgeted.amountExGst)} /></TileItem>
      </Tiles>
      <ChartFrame title="Open GRNs by approval stage" subtitle="Count waiting at each stage" table={barListTable(stages)} height={96}>
        <BarList {...stages} />
        {g.byType.length ? <div className="mt-3"><Fold title="GRNs by type"><DataTable table={byTypeTable(g)} /></Fold></div> : null}
      </ChartFrame>
    </div>
  );
}

/** Tie-out between budget and P&L, and payroll readiness, collapsed by default. */
export function Reconciliation({ d }: { d: FinanceData }) {
  const t = d.tieOut;
  const p = d.payrollReadiness;
  if (!t && !p) return null;
  return (
    <Fold title="Reconciliation and payroll readiness" group="reconciliation">
      {t ? (
        <>
          <h4 className="text-[13px] font-bold text-slate-900">Tie-out between budget and P&amp;L</h4>
          <dl className="mt-1 space-y-1 text-[13px] text-slate-800">
            {([
              ["Budget consumed", t.budgetConsumed], ["Budget reserved", t.budgetReserved], ["Booked in P&L without a budget line", t.hrmsNoBudgetLine],
              ["Ordinary GRNs without allocation", t.hrmsOrdinary], ["Imprest reserved with no cost centre", t.imprestReservedNoCostCentre],
            ] as Array<[string, number]>).map(([l, v]) => <div key={l} className="flex justify-between gap-3"><dt>{l}</dt><dd className="font-semibold tabular-nums">{formatInr(v)}</dd></div>)}
          </dl>
        </>
      ) : null}
      {p ? (
        <>
          <h4 className="mt-3 text-[13px] font-bold text-slate-900">Payroll readiness ({p.cycleMonth})</h4>
          <Tiles label="Payroll readiness">
            <TileItem><StatTile label="Pending regularization" value={formatCount(p.pendingRegularization)} /></TileItem>
            <TileItem><StatTile label="Pending leave" value={formatCount(p.pendingLeave)} /></TileItem>
            <TileItem><StatTile label="Pending increments" value={formatCount(p.pendingIncrements)} hint={p.oldestIncrementDays == null ? undefined : `Oldest ${p.oldestIncrementDays} days`} /></TileItem>
          </Tiles>
        </>
      ) : null}
    </Fold>
  );
}
