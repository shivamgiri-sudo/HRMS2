import type { OpsProcessRow, QualityRow } from "../../../../../../../backend/src/modules/branch-head-health/ops";
import { BarList, ChartFrame, barListTable } from "../../viz";
import { CallmasterBlock } from "../../sections/CallmasterBlock";
import { OpsHeatGrid, opsTable } from "../../sections/OpsHeatGrid";
import { qualityBars } from "../../sections/OpsQualityVisual";
import { selectByName } from "../../sections/shared";
import { Block, EmptyLine, SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

const rowsOf = <T,>(d: unknown): T[] => (Array.isArray(d) ? (d as T[]) : []);

/** Operations heat grid (stale rows flagged), lowest quality and the Callmaster tiles. */
export function OpsMetric(props: MetricProps) {
  const { operations, quality, callmaster } = props.overview;
  return (
    <div className="space-y-4">
      <SectionGate<unknown> name="Operations" section={operations} empty="No operational metrics for this branch">
        {(d) => {
          const rows = rowsOf<OpsProcessRow>(d);
          return rows.length ? (
            <ChartFrame title="Operations by process" subtitle="Shade = size within each column, not good or bad" table={opsTable(rows)} height={96}>
              <OpsHeatGrid rows={rows} onSelectProcess={selectByName(asVisual(props), "ops")} />
            </ChartFrame>
          ) : <EmptyLine>No operational metrics for this branch</EmptyLine>;
        }}
      </SectionGate>
      <SectionGate<unknown> name="Quality" section={quality} empty="No quality scores for this branch">
        {(d) => {
          const bars = qualityBars(rowsOf<QualityRow>(d));
          return bars.items.length ? (
            <ChartFrame title="Lowest quality processes" subtitle="QA quality %, lowest first" table={barListTable(bars)} height={96}><BarList {...bars} /></ChartFrame>
          ) : <EmptyLine>No quality scores for this branch</EmptyLine>;
        }}
      </SectionGate>
      <Block title="Callmaster">
        {callmaster ? <CallmasterBlock section={callmaster} /> : <EmptyLine>No Callmaster data for this branch</EmptyLine>}
      </Block>
    </div>
  );
}
