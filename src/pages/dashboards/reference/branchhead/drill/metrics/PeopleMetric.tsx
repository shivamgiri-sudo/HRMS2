import type { PeopleData } from "../../panelTypes";
import { BarList, ChartFrame, DataTable, StatTile } from "../../viz";
import { formatCount } from "../../format";
import { buildPeople } from "../../sections/PeopleVisual";
import { byLabel, selectByName, TileItem, Tiles } from "../../sections/shared";
import { SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

/** Headcount: per-process vs mandate (bars + full table) and the movement tiles. */
export function PeopleMetric(props: MetricProps) {
  return (
    <SectionGate<PeopleData> name="Headcount" section={props.overview.people} empty="No headcount data for this date">
      {(d) => {
        const b = buildPeople(d);
        return (
          <div className="space-y-4">
            <Tiles label="Headcount movement">
              <TileItem><StatTile label="Joined MTD" value={formatCount(d.joinedMtd)} hint={`Today: ${formatCount(d.joinedToday)}`} /></TileItem>
              <TileItem><StatTile label="Left MTD" value={formatCount(d.leftMtd)} hint={`Today: ${formatCount(d.leftToday)}`} /></TileItem>
              <TileItem><StatTile label="Upcoming exits (30 days)" value={formatCount(d.upcomingExits)} /></TileItem>
              <TileItem><StatTile label="Exits not closed" value={formatCount(d.exitsNotClosed)} /></TileItem>
            </Tiles>
            <ChartFrame title="Headcount vs mandate" subtitle="Marker = mandate seats" table={b.table} height={96}>
              <BarList {...b.bars} onSelect={byLabel(b.bars.items, selectByName(asVisual(props), "headcount"))} />
            </ChartFrame>
            <DataTable table={b.table} />
          </div>
        );
      }}
    </SectionGate>
  );
}
