import type { AttendanceData } from "../../panelTypes";
import { BarList, ChartFrame, DataTable, LineArea, StackedBar, lineAreaTable, type LineAreaProps, type TableSpec } from "../../viz";
import { formatCount, formatPct } from "../../format";
import { buildAttendance } from "../../sections/AttendanceVisual";
import { byLabel, selectByName } from "../../sections/shared";
import { EmptyLine, SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

const MIN_TREND = 3;

/** Trend props from snapshot values (oldest first); null below 3 finite points. */
export function trendProps(label: string, values: Array<number | null> | undefined, format: (n: number) => string): LineAreaProps | null {
  const pts = values ?? [];
  if (pts.filter((v) => typeof v === "number" && Number.isFinite(v)).length < MIN_TREND) return null;
  return { label, format, series: [{ key: "v", label, points: pts.map((y, i) => ({ x: `#${i + 1}`, y })) }] };
}

export function slotTable(d: AttendanceData): TableSpec {
  return {
    caption: "Attendance by process and shift slot",
    columns: ["Process", "Shift", "Planned", "Present", "Absent", "Late"],
    rows: (d.bySlot ?? []).map((r) => [r.process, r.shift, formatCount(r.planned), formatCount(r.present), formatCount(r.absent), formatCount(r.late)]),
  };
}

/** Shrinkage, late and attendance: trend (when snapshots exist), by-process chart and the shift-slot table. */
export function AttendanceMetric(props: MetricProps & { kind: "shrinkage" | "late" | "attendance" }) {
  const late = props.kind === "late";
  const trend = late ? trendProps("Late arrivals per snapshot", props.trends.totalLate, formatCount)
    : trendProps("Shrinkage per snapshot", props.trends.shrinkagePct, formatPct);
  return (
    <div className="space-y-4">
      {trend ? (
        <ChartFrame title="Trend" subtitle="Daily snapshots, oldest first" table={lineAreaTable(trend)} height={160}><LineArea {...trend} /></ChartFrame>
      ) : <EmptyLine>Trend appears after a few days of history</EmptyLine>}
      <SectionGate<AttendanceData> name="Attendance" section={props.overview.attendance} empty="No attendance data for this date">
        {(d) => {
          const b = buildAttendance(d, []);
          const v = asVisual(props);
          return (
            <>
              {late ? (
                <ChartFrame title="Late arrivals by process" table={b.lateTable} height={96}>
                  <BarList {...b.late} onSelect={byLabel(b.late.items, selectByName(v, "late"))} />
                </ChartFrame>
              ) : (
                <ChartFrame title="Attendance by process" subtitle={`Shrinkage ${formatPct(d.shrinkagePct)}; shift slots summed, most absent first`} table={b.byProcessTable} height={96}>
                  <StackedBar {...b.byProcess} onSelect={byLabel(b.byProcess.rows, selectByName(v, props.kind))} />
                </ChartFrame>
              )}
              <DataTable table={slotTable(d)} />
            </>
          );
        }}
      </SectionGate>
    </div>
  );
}
