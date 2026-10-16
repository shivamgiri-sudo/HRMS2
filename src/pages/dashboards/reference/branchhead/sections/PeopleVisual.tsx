import { Users } from "lucide-react";
import { BarList, ChartFrame, DataTable, StackedBar, StatTile, barListTable, stackedBarTable, type BarListProps, type StackedBarProps } from "../viz";
import type { PeopleData } from "../panelTypes";
import { formatCount } from "../format";
import { SectionShell } from "../ui";
import { byLabel, extendTable, Fold, Grid, nn, selectByName, TileItem, Tiles, type VisualProps } from "./shared";

/** A zero or missing mandate is "No mandate", never "over". */
export function mandateNote(active: number, seats: number | null): string {
  if (seats == null || !(seats > 0)) return "No mandate";
  return active > seats ? `Over by ${active - seats}` : `${formatCount(seats - active)} open`;
}

/** Chart props and their table twins, built once from the payload. */
export function buildPeople(d: PeopleData) {
  const rows = d.byProcess ?? [];
  const bars: BarListProps = {
    label: "Headcount versus mandate by process",
    markerLabel: "Mandate seats",
    format: formatCount,
    items: rows.map((r, i) => ({
      id: `r${i}`,
      label: r.process,
      value: nn(r.active),
      marker: r.mandateSeats != null && r.mandateSeats > 0 ? r.mandateSeats : null,
      note: mandateNote(nn(r.active), r.mandateSeats),
    })),
  };
  // If no row has a mandate the BarList table drops the marker column; keep the columns stable.
  const base = barListTable(bars);
  const withSeats = base.columns.includes("Mandate seats") ? base
    : { ...base, columns: ["Item", "Value", "Mandate seats", "Note"], rows: base.rows.map((r) => [r[0], r[1], null, r[2]]) };
  const table = extendTable(withSeats, ["Joined MTD", "Left MTD"], (i) => [formatCount(rows[i].joinedMtd), formatCount(rows[i].leftMtd)]);
  const lobs = [...(d.byLob ?? [])].sort((a, b) => nn(b.active) - nn(a.active));
  // The stack folds past three lines of business into "Other" (four validated colour slots).
  const lob: StackedBarProps = {
    label: "Active headcount by line of business",
    series: lobs.map((l) => ({ key: l.lob, label: l.lob })),
    rows: lobs.length ? [{ id: "active", label: "Active", segments: lobs.map((l) => ({ key: l.lob, value: nn(l.active) })) }] : [],
  };
  return { bars, table, lob, lobTable: stackedBarTable(lob), lobs };
}

export function PeopleVisual(props: VisualProps) {
  const { overview } = props;
  return (
    <SectionShell<PeopleData> icon={Users} tone="blue" title="Headcount" section={overview.people} emptyText="No headcount data for this date">
      {(d) => {
        const b = buildPeople(d);
        const seats = d.mandateSeatsTotal;
        return (
          <div className="space-y-3">
            <Tiles label="Headcount movement">
              <TileItem><StatTile label="Joined MTD" value={formatCount(d.joinedMtd)} hint={`Today: ${formatCount(d.joinedToday)}`} /></TileItem>
              <TileItem><StatTile label="Left MTD" value={formatCount(d.leftMtd)} hint={`Today: ${formatCount(d.leftToday)}`} /></TileItem>
              <TileItem><StatTile label="Upcoming exits (30 days)" value={formatCount(d.upcomingExits)} /></TileItem>
              <TileItem><StatTile label="Exits not closed" value={formatCount(d.exitsNotClosed)} /></TileItem>
            </Tiles>
            <Grid>
              <ChartFrame title="Headcount vs mandate" table={b.table} height={120}
                subtitle={`${formatCount(d.totalActive)} active${seats != null && seats > 0 ? ` of ${formatCount(seats)} mandate seats` : ", no mandate set"}`}>
                <BarList {...b.bars} onSelect={byLabel(b.bars.items, selectByName(props, "headcount"))} />
              </ChartFrame>
              <ChartFrame title="Line of business" subtitle="Active headcount, top three and Other" table={b.lobTable} height={96}>
                <StackedBar {...b.lob} />
                {b.lobs.length > 4 ? (
                  <div className="mt-3">
                    <Fold title="All lines of business">
                      <DataTable table={{ caption: "Active headcount by line of business", columns: ["Line of business", "Active"], rows: b.lobs.map((l) => [l.lob, formatCount(l.active)]) }} />
                    </Fold>
                  </div>
                ) : null}
              </ChartFrame>
            </Grid>
          </div>
        );
      }}
    </SectionShell>
  );
}
