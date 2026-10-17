import { CheckCircle2, FileStack, Hourglass, ShieldAlert } from "lucide-react";
import { type BarListProps, type TableSpec } from "../viz";
import type { FinanceData } from "../panelTypes";
import { formatCount, formatInr } from "../format";
import { AccentCard, BarsChart, ChartCard, Chip, EmptyLine, GradientKpi, KpiCell, KpiGrid, NavyTable, PAL } from "../look";
import { lakh } from "./financeBudget";
import { nn } from "./shared";

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

export function byTypeTable(g: NonNullable<FinanceData["grn"]>): TableSpec {
  return {
    caption: "GRNs by type",
    columns: ["Type", "Raised", "Raised ex-GST", "Approved", "Pending", "Pending incl. GST"],
    rows: g.byType.map((x) => [x.label, formatCount(x.raised), formatInr(x.raisedExGst), formatCount(x.approved), formatCount(x.pending), formatInr(x.pendingInclGst)]),
  };
}

/** The email's bridge from GRNs raised (ex-GST) to what was charged to this month's budget. */
export function bridgeRows(b: NonNullable<FinanceData["grn"]>["bridge"]): Array<[string, number, "total" | "less" | "plus"]> {
  return [
    ["GRNs raised this month, ex-GST", b.raisedExGst, "total"], ["awaiting approval, not reserved yet", b.awaitingApproval, "less"],
    ["charged to an earlier month's budget", b.earlierBudget, "less"], ["unbudgeted: raised without a budget line", b.noBudgetLine, "less"],
    ["charged to this month's budget", b.chargedThisMonth, "total"], ["raised in earlier months, charged to this month", b.fromEarlierMonths, "plus"],
    ["Consumed + Reserved (budget charge total)", b.budgetChargeTotal, "total"],
  ];
}

/** Email section 2: GRN counts, the pipeline by stage, types, the budget bridge and unbudgeted GRNs. */
export function FinanceGrn({ d, stages }: { d: FinanceData; stages: BarListProps | null }) {
  const g = d.grn;
  if (!g || !stages) return <AccentCard title="GRN summary" accent="cyan"><EmptyLine text="No GRN data for this month" /></AccentCard>;
  const stageTable: TableSpec = { caption: "Open GRNs by approval stage", columns: ["Stage", "Count", "Amount incl. GST", "Oldest (days)"],
    rows: g.pendingByStage.map((s) => [s.stage, formatCount(s.count), formatInr(s.amountInclGst), formatCount(s.oldestDays)]) };
  return (
    <div className="space-y-4">
      <KpiGrid label="GRN summary" cols={5}>
        <KpiCell><GradientKpi icon={FileStack} hue="navy" label="GRNs raised this month" value={formatCount(g.raised)} sub={formatInr(g.totalRaisedAmount)} /></KpiCell>
        <KpiCell><GradientKpi icon={CheckCircle2} hue="emerald" label="Approved" value={formatCount(g.approved)} sub={`${g.raised > 0 ? Math.round((g.approved / g.raised) * 100) : 0}% of raised`} /></KpiCell>
        <KpiCell><GradientKpi icon={Hourglass} hue="orange" label="Pending" value={formatCount(g.pending)} sub={`Oldest ${formatCount(g.oldestPendingDays)} days, ${formatCount(g.pendingOver3Days)} over 3 days`}
          status={g.pending >= 10 ? "critical" : g.pendingOver3Days > 0 ? "warning" : null} /></KpiCell>
        <KpiCell><GradientKpi icon={ShieldAlert} hue="violet" label="Unbudgeted" value={formatCount(g.unbudgeted.count)} sub={`${formatInr(g.unbudgeted.amountExGst)} ex-GST`} /></KpiCell>
        <KpiCell><GradientKpi icon={FileStack} hue="cyan" label="Budget charge total" value={formatInr(g.bridge.budgetChargeTotal)} sub="Charged to this month's budget" /></KpiCell>
      </KpiGrid>
      <div className="bhl-grid bhl-grid-2">
        <ChartCard title="Open GRNs by approval stage" chip={`${formatCount(g.pending)} pending`} accent="orange" table={stageTable}>
          {g.pendingByStage.length ? (
            <BarsChart label="Open GRNs by approval stage, count and amount" xKey="stage" height={240} format={formatCount} rightFormat={lakh}
              data={g.pendingByStage.map((s) => ({ stage: s.stage, count: s.count, amount: s.amountInclGst }))}
              series={[{ key: "count", label: "GRNs waiting", color: PAL.s1 }, { key: "amount", label: "Amount incl. GST (right axis)", color: PAL.s2, axis: "right" }]} />
          ) : <EmptyLine text="Nothing waiting for approval" />}
        </ChartCard>
        <ChartCard title="GRNs by type" chip={`${g.byType.length} types`} accent="blue" table={byTypeTable(g)}>
          {g.byType.length ? (
            <BarsChart label="GRNs by type, approved and pending" xKey="type" height={240} format={formatCount}
              data={g.byType.map((x) => ({ type: x.label, approved: x.approved, pending: x.pending }))}
              series={[{ key: "approved", label: "Approved", color: PAL.s3, stack: "t" }, { key: "pending", label: "Pending", color: PAL.s4, stack: "t" }]} />
          ) : <EmptyLine text="No GRNs by type" />}
        </ChartCard>
      </div>
      <AccentCard title="Bridge: GRNs raised to budget charged" chip="Tied to the budget" accent="violet">
        <NavyTable caption="Bridge from GRNs raised to the budget charge" rows={bridgeRows(g.bridge)} limit={0}
          columns={[
            { key: "l", label: "Step", render: (r) => <span className={r[2] === "total" ? "font-bold" : "pl-3"}>{r[2] === "less" ? "− " : r[2] === "plus" ? "+ " : ""}{r[0]}</span> },
            { key: "v", label: "Amount", num: true, render: (r) => <span className={r[2] === "total" ? "font-bold" : undefined}>{formatInr(r[1])}</span> },
          ]} />
      </AccentCard>
    </div>
  );
}

/** Tie-out between budget and P&L, and payroll readiness (email sections 2 and 9). */
export function Reconciliation({ d }: { d: FinanceData }) {
  const t = d.tieOut;
  const p = d.payrollReadiness;
  if (!t && !p) return null;
  return (
    <div className="bhl-grid bhl-grid-2">
      {t ? (
        <AccentCard title="Tie-out between budget and P&L" accent="cyan">
          <NavyTable caption="Tie-out between budget and P&L" limit={0} rows={[
            ["Budget consumed", t.budgetConsumed], ["Budget reserved", t.budgetReserved], ["Booked in P&L without a budget line", t.hrmsNoBudgetLine],
            ["Ordinary GRNs without allocation", t.hrmsOrdinary], ["Imprest reserved with no cost centre", t.imprestReservedNoCostCentre],
          ] as Array<[string, number]>} columns={[
            { key: "l", label: "Item", render: (r) => r[0] }, { key: "v", label: "Amount", num: true, render: (r) => formatInr(r[1]) },
          ]} />
        </AccentCard>
      ) : null}
      {p ? (
        <AccentCard title="Payroll readiness" chip={p.cycleMonth} accent="emerald">
          <NavyTable caption="Payroll readiness" limit={0} rows={[
            ["Pending regularization", p.pendingRegularization, null], ["Pending leave", p.pendingLeave, null],
            ["Pending increments", p.pendingIncrements, p.oldestIncrementDays == null ? null : `Oldest ${p.oldestIncrementDays} days`],
          ] as Array<[string, number | null, string | null]>} columns={[
            { key: "l", label: "Item", render: (r) => r[0] }, { key: "v", label: "Count", num: true, render: (r) => formatCount(r[1]) },
            { key: "a", label: "Age", render: (r) => (r[2] ? <Chip tone="warn">{r[2]}</Chip> : "—") },
          ]} />
        </AccentCard>
      ) : null}
    </div>
  );
}
