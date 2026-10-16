import { Wallet } from "lucide-react";
import { BarList, ChartFrame, DataTable, Meter, StatTile, Waterfall, barListTable, meterTable, waterfallTable, type BarListProps, type MeterProps, type TableSpec, type WaterfallProps } from "../viz";
import type { FinanceData, HeadRow } from "../panelTypes";
import { formatInr, formatPct } from "../format";
import { KPI_TONES, toneFor } from "../kpiModel";
import { SectionShell } from "../ui";
import { FinanceGrn, Reconciliation, grnStages } from "./financeParts";
import { Fold, Foot, Grid, nn, TileItem, Tiles, type VisualProps } from "./shared";

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

function componentsTable(p: FinanceData["pnl"]): TableSpec {
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

export function FinanceVisual({ overview }: VisualProps) {
  return (
    <SectionShell<FinanceData> icon={Wallet} tone="emerald" title="Running P&L - month to date (as in the emailed report)" section={overview.finance} emptyText="No finance data for this date" errorName="Finance">
      {(d) => {
        const p = d.pnl;
        const b = buildFinance(d);
        const bud = d.budget;
        const pr = d.projection;
        return (
          <div className="space-y-3">
            <ChartFrame title="Revenue to operating profit" table={b.waterfallTable} height={200}
              subtitle={`Period ${p.periodCode}, day ${p.daysElapsed} of ${p.daysInMonth} (${modeLabel(p.mode)}) · OP ${formatPct(p.opPct)}`}>
              <Waterfall {...b.waterfall} />
              <div className="mt-3">
                <Fold title="Revenue and cost components">
                  <DataTable table={componentsTable(p)} />
                  <Foot>Cost centres: {p.costCentres}, estimated: {p.estimatedCostCentres}.</Foot>
                </Fold>
              </div>
            </ChartFrame>
            <div>
              <h3 className="mb-1 text-[13px] font-bold text-slate-900">Projection for the full month</h3>
              {p.dataAvailable && pr ? (
                <>
                  <Tiles label="Projection">
                    <TileItem><StatTile label="Projected revenue" value={formatInr(pr.revenue)} /></TileItem>
                    <TileItem><StatTile label="Projected cost" value={formatInr(pr.cost)} /></TileItem>
                    <TileItem><StatTile label="Projected operating profit" value={formatInr(pr.operatingProfit)} hint={`OP ${formatPct(pr.opPct)}`} /></TileItem>
                  </Tiles>
                  <Foot>Projection basis: {pr.basis}</Foot>
                </>
              ) : <p className="text-[13px] text-slate-700">No P&amp;L data yet for this month</p>}
            </div>
            <Grid>
              <ChartFrame title="Budget used" table={b.meterTable} height={72}
                subtitle={`Available ${formatInr(bud.available)} · consumed ${formatInr(bud.consumed)} · reserved ${formatInr(bud.reserved)}${bud.headerStatus ? ` · status ${bud.headerStatus}` : ""}`}>
                {bud.headerMissing ? <p className="mb-2 text-[12px] text-slate-700">No budget has been created for this month.</p> : null}
                <Meter {...b.meter} />
              </ChartFrame>
              <ChartFrame title="Budget by head" subtitle="Charged, with the budget as a marker" table={b.headsTable} height={96}>
                <BarList {...b.heads} />
              </ChartFrame>
            </Grid>
            <FinanceGrn d={d} stages={b.stages} />
            <Reconciliation d={d} />
          </div>
        );
      }}
    </SectionShell>
  );
}
