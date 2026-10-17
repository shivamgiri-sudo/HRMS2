import { CalendarX2, DoorOpen, LogIn, LogOut, TrendingDown, TrendingUp, UserX, Users } from "lucide-react";
import { barListTable, stackedBarTable, type BarListProps, type StackedBarProps } from "../viz";
import type { HiringData, PeopleData } from "../panelTypes";
import { formatCount, formatPct } from "../format";
import { mandateTone } from "../kpiModel";
import { BarsChart, ChartCard, DonutChart, EmptyLine, GradientKpi, KpiCell, KpiGrid, PAL, SectionGate } from "../look";
import { HeadcountTable, PeopleFollowUps } from "./peopleParts";
import { extendTable, nn, selectByName, type VisualProps } from "./shared";

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
  const lob: StackedBarProps = {
    label: "Active headcount by line of business",
    series: lobs.map((l) => ({ key: l.lob, label: l.lob })),
    rows: lobs.length ? [{ id: "active", label: "Active", segments: lobs.map((l) => ({ key: l.lob, value: nn(l.active) })) }] : [],
  };
  return { bars, table, lob, lobTable: stackedBarTable(lob), lobs };
}

const LOB_COLORS = [PAL.s1, PAL.s2, PAL.s3, PAL.s4];

/** Top three lines of business keep their colour; the rest fold into "Other" (four validated slots). */
export function lobSlices(lobs: PeopleData["byLob"]) {
  const top = lobs.slice(0, 3).map((l, i) => ({ key: l.lob, label: l.lob, value: nn(l.active), color: LOB_COLORS[i] }));
  const rest = lobs.slice(3).reduce((a, l) => a + nn(l.active), 0);
  return rest > 0 ? [...top, { key: "other", label: lobs.length === 4 ? lobs[3].lob : "Other", value: rest, color: lobs.length === 4 ? PAL.s4 : PAL.other }] : top;
}

/** People tab: email sections 6 (headcount by process, pending actions) and 7 (offer-to-join, consecutive absence). */
export function PeopleVisual(props: VisualProps) {
  const { overview } = props;
  const hiring = overview.hiring?.status === "ok" ? (overview.hiring.data as HiringData | null) : null;
  return (
    <SectionGate<PeopleData> title="Headcount" section={overview.people} emptyText="No headcount data for this date" accent="blue">
      {(d) => {
        const b = buildPeople(d);
        const seats = d.mandateSeatsTotal;
        const mt = mandateTone(d.totalActive, seats);
        const rows = d.byProcess ?? [];
        return (
          <div className="space-y-4">
            <KpiGrid label="Headcount movement">
              <KpiCell><GradientKpi icon={Users} hue="navy" label="Active headcount" value={formatCount(d.totalActive)}
                sub={seats != null && seats > 0 ? `${mandateNote(d.totalActive, seats)} of ${formatCount(seats)} mandate seats` : "No mandate set"}
                status={mt === "warning" ? "warning" : mt === "critical" ? "critical" : null} /></KpiCell>
              <KpiCell><GradientKpi icon={LogIn} hue="emerald" label="Joined MTD" value={formatCount(d.joinedMtd)} sub={`Today: ${formatCount(d.joinedToday)}`} /></KpiCell>
              <KpiCell><GradientKpi icon={LogOut} hue="orange" label="Left MTD" value={formatCount(d.leftMtd)} sub={`Today: ${formatCount(d.leftToday)}`} /></KpiCell>
              <KpiCell><GradientKpi icon={d.netMtd < 0 ? TrendingDown : TrendingUp} hue="cyan" label="Net MTD" value={`${d.netMtd > 0 ? "+" : ""}${formatCount(d.netMtd)}`} sub="Joined minus left this month" /></KpiCell>
              <KpiCell><GradientKpi icon={TrendingDown} hue="violet" label="Attrition MTD" value={formatPct(d.attritionMtdPct)} sub="Left / average headcount" /></KpiCell>
              <KpiCell><GradientKpi icon={DoorOpen} hue="teal" label="Upcoming exits (30 days)" value={formatCount(d.upcomingExits)} sub="Resignations with a last day ahead" /></KpiCell>
              <KpiCell><GradientKpi icon={CalendarX2} hue="indigo" label="Exits not closed" value={formatCount(d.exitsNotClosed)} sub="Clearance still open" /></KpiCell>
              <KpiCell><GradientKpi icon={UserX} hue="amber" label="Consecutive absence" value={d.absence ? formatCount(d.absence.total) : "—"}
                sub={d.absence ? `${d.absence.days}+ rostered days, no punch` : "Source unavailable"} status={d.absence && d.absence.total > 0 ? "warning" : null} /></KpiCell>
            </KpiGrid>
            <div className="bhl-grid bhl-grid-3">
              <ChartCard title="Headcount vs mandate" chip={`${rows.length} processes`} accent="blue" table={b.table} className="bhl-span-2">
                {rows.length ? (
                  <BarsChart label={`${b.bars.label}: ${b.bars.items.map((i) => `${i.label} ${formatCount(i.value)}${i.marker != null ? ` of ${formatCount(i.marker)}` : ""}`).join(", ")}`}
                    xKey="process" height={290} data={rows.map((r) => ({ process: r.process, active: r.active, mandate: r.mandateSeats ?? null, joined: r.joinedMtd, left: r.leftMtd }))}
                    series={[{ key: "active", label: "Active", color: PAL.s1 }, { key: "mandate", label: "Mandate seats", color: PAL.other },
                      { key: "joined", label: "Joined MTD", color: PAL.s3, kind: "line", axis: "right" }, { key: "left", label: "Left MTD", color: PAL.s2, kind: "line", axis: "right" }]} />
                ) : <EmptyLine text="No processes with headcount" />}
              </ChartCard>
              <ChartCard title="Line of business" chip={`${b.lobs.length} lines`} accent="violet" table={{ caption: "Active headcount by line of business", columns: ["Line of business", "Active"], rows: b.lobs.map((l) => [l.lob, formatCount(l.active)]) }}>
                {b.lobs.length ? <DonutChart label="Active headcount by line of business" center={formatCount(d.totalActive)} centerLabel="Active" height={270} slices={lobSlices(b.lobs)} />
                  : <EmptyLine text="No line of business mapped" />}
              </ChartCard>
            </div>
            <HeadcountTable d={d} onProcess={selectByName(props, "headcount")} />
            <PeopleFollowUps d={d} hiring={hiring} />
          </div>
        );
      }}
    </SectionGate>
  );
}
