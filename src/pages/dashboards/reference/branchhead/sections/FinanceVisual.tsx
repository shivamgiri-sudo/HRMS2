import { useState } from "react";
import { Banknote, Receipt, TrendingUp, Wallet } from "lucide-react";
import { barListTable, meterTable, waterfallTable, type BarListProps, type MeterProps, type TableSpec, type WaterfallProps } from "../viz";
import type { FinanceData, HeadRow } from "../panelTypes";
import { formatInr, formatPct } from "../format";
import { KPI_TONES, toneFor } from "../kpiModel";
import { AccentCard, ChartCard, GradientKpi, KpiCell, KpiGrid, SectionGate, SpecTable, SubTabs, WaterfallChart } from "../look";
import { FinanceGrn, Reconciliation, grnStages } from "./financeParts";
import { FinanceBudget } from "./financeBudget";
import { FinanceRecent } from "./financeRecent";
import { nn, type VisualProps } from "./shared";

export function modeLabel(m: string): string {
  if (m === "LIVE_MTD") return "Live, month to date";
  if (m === "FINAL") return "Final, month closed";
  return String(m ?? "").split("_").join(" ").toLowerCase();
}

/** A cost is subtracted whatever its sign (a reversal adds back), so the steps reconcile to the OP total. */
const cost = (v: number) => (typeof v === "number" && Number.isFinite(v) && v !== 0 ? -v : 0);

/** Top heads and over-budget heads, once each, in payload order (top first). */
function heads(d: FinanceData): HeadRow[] {
  const seen = new Set<string>();
  return [...(d.byHead?.top ?? []).slice(0, 10), ...(d.byHead?.overBudget ?? []).slice(0, 10)].filter((h) => (seen.has(h.head) ? false : (seen.add(h.head), true)));
}

/** Chart props and table twins for the running P&L, budget and GRN stages. */
export function buildFinance(d: FinanceData) {
  const p = d.pnl;
  const waterfall: WaterfallProps = {
    label: "Running P&L, revenue to operating profit",
    format: formatInr,
    steps: [
      { id: "revenue", label: "Revenue", value: p.revenueRunning, kind: "total" },
      { id: "salary", label: "Salary", value: cost(p.salaryRunning), kind: "delta" },
      { id: "grnConsumed", label: "GRN consumed", value: cost(p.grnConsumed), kind: "delta" },
      { id: "grnReserved", label: "GRN reserved", value: cost(p.grnReserved), kind: "delta" },
      { id: "op", label: "Operating profit", value: p.operatingProfit, kind: "total" },
    ],
  };
  const tone = toneFor(d.budget.utilizationPct, KPI_TONES.budgetPct);
  const meter: MeterProps = {
    label: "Budget used", format: formatInr, value: nn(d.budget.consumed) + nn(d.budget.reserved), limit: d.budget.totalBudget,
    tone: tone === "warning" || tone === "critical" ? tone : undefined,
  };
  const headsProps: BarListProps = {
    label: "Budget heads: charged against budget",
    markerLabel: "Budget",
    format: formatInr,
    items: heads(d).map((h) => ({
      id: h.head, label: h.head, value: nn(h.charged), marker: typeof h.budget === "number" && Number.isFinite(h.budget) ? h.budget : null,
      note: h.pct > 100 ? `Over budget, ${formatPct(h.pct)} used` : `${formatPct(h.pct)} used`,
    })),
  };
  const stages = grnStages(d);
  return {
    waterfall, waterfallTable: waterfallTable(waterfall),
    meter, meterTable: meterTable(meter),
    heads: headsProps, headsTable: barListTable(headsProps),
    stages, stagesTable: stages ? barListTable(stages) : null,
  };
}

export function componentsTable(p: FinanceData["pnl"]): TableSpec {
  return {
    caption: "Running revenue and cost components",
    columns: ["Component", "Amount"],
    rows: [
      ["Invoice", formatInr(p.revenueInvoice)], ["Accrual", formatInr(p.revenueAccrual)], ["Estimated (seat rate)", formatInr(p.revenueEstimated)],
      ["Credit notes", formatInr(-Math.abs(p.creditNote))], [`Salary (${p.staffPaid} staff paid)`, formatInr(p.salaryRunning)],
      ["GRN consumed", formatInr(p.grnConsumed)], ["GRN reserved", formatInr(p.grnReserved)], ["Total cost", formatInr(p.totalCostRunning)],
    ],
  };
}

export const FINANCE_SUBS = [
  { id: "budget", label: "Budget vs consumption" }, { id: "grn", label: "GRN summary" }, { id: "recent", label: "Recent GRNs" }, { id: "pnl", label: "Running P&L" },
];

/** Email section 9: running P&L waterfall, components, projection and the tie-out. */
function FinancePnl({ d }: { d: FinanceData }) {
  const p = d.pnl;
  const b = buildFinance(d);
  const pr = d.projection;
  const opTone = toneFor(p.opPct, KPI_TONES.opPct);
  return (
    <div className="space-y-4">
      <KpiGrid label="Running P&L">
        <KpiCell><GradientKpi icon={Banknote} hue="navy" label="Revenue (running)" value={formatInr(p.revenueRunning)} sub={`Day ${p.daysElapsed} of ${p.daysInMonth} · ${modeLabel(p.mode)}`} /></KpiCell>
        <KpiCell><GradientKpi icon={Receipt} hue="orange" label="Total cost" value={formatInr(p.totalCostRunning)} sub={`Salary ${formatInr(p.salaryRunning)} · GRN ${formatInr(nn(p.grnConsumed) + nn(p.grnReserved))}`} /></KpiCell>
        <KpiCell><GradientKpi icon={Wallet} hue="emerald" label="Operating profit" value={formatInr(p.operatingProfit)} sub={`OP ${formatPct(p.opPct)}`}
          status={opTone === "warning" ? "warning" : opTone === "critical" ? "critical" : null} /></KpiCell>
        <KpiCell><GradientKpi icon={TrendingUp} hue="violet" label="Projected OP (month)" value={p.dataAvailable && pr ? formatInr(pr.operatingProfit) : "—"}
          sub={p.dataAvailable && pr ? `OP ${formatPct(pr.opPct)} · revenue ${formatInr(pr.revenue)}` : "No projection yet"} /></KpiCell>
      </KpiGrid>
      <div className="bhl-grid bhl-grid-2">
        <ChartCard title="Revenue to operating profit" chip={`Period ${p.periodCode} · OP ${formatPct(p.opPct)}`} accent="emerald" table={b.waterfallTable}>
          <p className="mb-2 text-[12px] text-slate-700">Period {p.periodCode}, day {p.daysElapsed} of {p.daysInMonth} ({modeLabel(p.mode)})</p>
          <WaterfallChart label={b.waterfall.label} format={formatInr} steps={b.waterfall.steps} />
        </ChartCard>
        <AccentCard title="Revenue and cost components" chip={`${p.costCentres} cost centres · ${p.estimatedCostCentres} estimated`} accent="blue">
          <SpecTable table={componentsTable(p)} />
        </AccentCard>
      </div>
      <AccentCard title="Projection for the full month" accent="violet" chip={p.dataAvailable && pr ? pr.basis : undefined}>
        {p.dataAvailable && pr ? (
          <>
            <SpecTable table={{ caption: "Projection for the full month", columns: ["Measure", "Month to date", "Projected full month"], rows: [
              ["Revenue", formatInr(p.revenueRunning), formatInr(pr.revenue)], ["Cost", formatInr(p.totalCostRunning), formatInr(pr.cost)],
              ["Operating profit", formatInr(p.operatingProfit), formatInr(pr.operatingProfit)], ["OP %", formatPct(p.opPct), formatPct(pr.opPct)],
            ] }} />
            <p className="bhl-note">Projection basis: {pr.basis}</p>
          </>
        ) : <p className="text-[13px] text-slate-700">No P&amp;L data yet for this month</p>}
      </AccentCard>
      <Reconciliation d={d} />
    </div>
  );
}

/** Finance tab: the four finance sections of the email (1, 2, 3, 9) as sub-tabs. */
export function FinanceVisual({ overview, sub, onSubChange }: VisualProps) {
  const [own, setOwn] = useState("budget");
  const active = FINANCE_SUBS.some((s) => s.id === sub) ? (sub as string) : own;
  const change = (id: string) => (onSubChange ? onSubChange(id) : setOwn(id));
  return (
    <SectionGate<FinanceData> title="Finance" section={overview.finance} emptyText="No finance data for this date" errorName="Finance" accent="emerald">
      {(d) => (
        <div className="space-y-4">
          <SubTabs label="Finance sections" items={FINANCE_SUBS} value={active} onChange={change} />
          {active === "budget" ? <FinanceBudget d={d} /> : null}
          {active === "grn" ? <FinanceGrn d={d} stages={grnStages(d)} /> : null}
          {active === "recent" ? <FinanceRecent d={d} /> : null}
          {active === "pnl" ? <FinancePnl d={d} /> : null}
        </div>
      )}
    </SectionGate>
  );
}
