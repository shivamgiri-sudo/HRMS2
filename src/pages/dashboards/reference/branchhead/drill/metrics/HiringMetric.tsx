import type { HiringData } from "../../panelTypes";
import { BarList, ChartFrame, DataTable, StackedBar } from "../../viz";
import { batchProcessIndex, buildHiring } from "../../sections/HiringVisual";
import { selectByName } from "../../sections/shared";
import { EmptyLine, SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

/** Hiring and open positions: batches (process rows open the process), offer windows and ATS outcomes. */
export function HiringMetric(props: MetricProps) {
  return (
    <SectionGate<HiringData> name="Hiring" section={props.overview.hiring} empty="No hiring data for this date">
      {(d) => {
        const b = buildHiring(d);
        const pick = selectByName(asVisual(props), "hiring");
        const processOf = batchProcessIndex(b.batches.items, d.batches);
        return (
          <div className="space-y-4">
            <ChartFrame title="Open batches" subtitle="Open positions per batch; marker = in pipeline" table={b.batchesTable} height={96}>
              {b.batches.items.length ? <BarList {...b.batches} onSelect={(id) => pick(processOf.get(id) ?? "")} /> : <EmptyLine>No open batches.</EmptyLine>}
            </ChartFrame>
            <DataTable table={b.batchesTable} />
            {b.offers.length ? <DataTable table={b.offersTable} /> : <EmptyLine>No offer data.</EmptyLine>}
            {d.ats ? (
              <ChartFrame title="Interview pipeline (ATS)" subtitle="Tokens by outcome" table={b.atsTable} height={72}><StackedBar {...b.ats} /></ChartFrame>
            ) : <EmptyLine>No interview pipeline data.</EmptyLine>}
          </div>
        );
      }}
    </SectionGate>
  );
}
