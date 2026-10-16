import type { BacklogsData } from "../../../../../../../backend/src/modules/branch-head-health/types";
import { ChartFrame, DataTable, StackedBar, StatTile } from "../../viz";
import { formatCount } from "../../format";
import { buildBacklog } from "../../sections/BacklogVisual";
import { TileItem, Tiles } from "../../sections/shared";
import { SectionGate } from "../parts";
import type { MetricProps } from "./common";

/** Both approval queues by age, with the oldest request in each. */
export function BacklogMetric(props: MetricProps) {
  return (
    <SectionGate<BacklogsData> name="Backlogs" section={props.overview.backlogs} empty="No backlog data for this branch">
      {(d) => {
        const b = buildBacklog(d);
        return (
          <div className="space-y-4">
            <Tiles label="Oldest pending">
              <TileItem><StatTile label="Regularization pending" value={formatCount(d.regularization.pending)} hint={`Oldest ${formatCount(d.regularization.oldestDays)} days`} /></TileItem>
              <TileItem><StatTile label="Leave pending" value={formatCount(d.leaveAging.pending)} hint={`Oldest ${formatCount(d.leaveAging.oldestDays)} days`} /></TileItem>
            </Tiles>
            <ChartFrame title="Pending requests by age" table={b.table} height={96}><StackedBar {...b.bars} /></ChartFrame>
            <DataTable table={b.table} />
          </div>
        );
      }}
    </SectionGate>
  );
}
