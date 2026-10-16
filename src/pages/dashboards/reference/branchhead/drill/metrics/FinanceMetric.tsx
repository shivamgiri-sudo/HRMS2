import type { ReactNode } from "react";
import type { FinanceData } from "../../panelTypes";
import { BarList, ChartFrame, DataTable, Meter, Waterfall } from "../../viz";
import { formatInr, formatPct } from "../../format";
import { buildFinance, modeLabel } from "../../sections/FinanceVisual";
import { byTypeTable } from "../../sections/financeParts";
import { EmptyLine, SectionGate } from "../parts";
import type { MetricProps } from "./common";

type FinanceKind = "profit" | "finance" | "budget" | "grn";
const ORDER: Record<FinanceKind, Array<"pnl" | "budget" | "grn">> = {
  profit: ["pnl", "budget", "grn"], finance: ["pnl", "budget", "grn"], budget: ["budget", "grn", "pnl"], grn: ["grn", "budget", "pnl"],
};

/** Running P&L breakdown, budget (meter + heads) and GRN stages, led by the block the tile was about. */
export function FinanceMetric(props: MetricProps & { kind: FinanceKind }) {
  return (
    <SectionGate<FinanceData> name="Finance" section={props.overview.finance} empty="No finance data for this date">
      {(d) => {
        const b = buildFinance(d);
        const p = d.pnl;
        const blocks: Record<"pnl" | "budget" | "grn", ReactNode> = {
          pnl: (
            <ChartFrame key="pnl" title="Revenue to operating profit" table={b.waterfallTable} height={180}
              subtitle={`Period ${p.periodCode}, day ${p.daysElapsed} of ${p.daysInMonth} (${modeLabel(p.mode)}) · OP ${formatPct(p.opPct)}`}>
              <Waterfall {...b.waterfall} />
            </ChartFrame>
          ),
          budget: (
            <div key="budget" className="space-y-4">
              <ChartFrame title="Budget used" subtitle={`Available ${formatInr(d.budget.available)}`} table={b.meterTable} height={72}>
                {d.budget.headerMissing ? <EmptyLine>No budget has been created for this month.</EmptyLine> : null}
                <Meter {...b.meter} />
              </ChartFrame>
              <ChartFrame title="Budget by head" subtitle="Charged, with the budget as a marker" table={b.headsTable} height={96}>
                {b.heads.items.length ? <BarList {...b.heads} /> : <EmptyLine>No budget heads charged this month</EmptyLine>}
              </ChartFrame>
            </div>
          ),
          grn: b.stages && b.stagesTable && d.grn ? (
            <div key="grn" className="space-y-4">
              <ChartFrame title="Open GRNs by approval stage" subtitle={`${d.grn.pending} pending, oldest ${d.grn.oldestPendingDays} days`} table={b.stagesTable} height={96}>
                {b.stages.items.length ? <BarList {...b.stages} /> : <EmptyLine>No GRNs waiting for approval</EmptyLine>}
              </ChartFrame>
              <DataTable table={byTypeTable(d.grn)} />
            </div>
          ) : <EmptyLine key="grn">No GRN data for this month</EmptyLine>,
        };
        return <div className="space-y-4">{ORDER[props.kind].map((k) => blocks[k])}</div>;
      }}
    </SectionGate>
  );
}
