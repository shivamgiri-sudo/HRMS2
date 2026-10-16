import type { TrendPoint } from "@/hooks/useBranchTrends";
import type { AttendanceData } from "../../panelTypes";
import { BarList, ChartFrame, DataTable, LineArea, StackedBar, lineAreaTable, type LineAreaProps, type TableSpec } from "../../viz";
import { formatCount, formatPct } from "../../format";
import { buildAttendance } from "../../sections/AttendanceVisual";
import { byLabel, selectByName } from "../../sections/shared";
import { EmptyLine, SectionGate } from "../parts";
import { asVisual, type MetricProps } from "./common";

const MIN_TREND = 3;

/** "MM-DD" for a YYYY-MM-DD date; anything else unchanged. */
export function mmdd(date: string): string {
  const d = String(date ?? "");
  return d.length >= 10 && d[4] === "-" && d[7] === "-" ? d.slice(5, 10) : d;
}

/** Trend props from dated snapshots (oldest first), x labelled MM-DD; null below 3 finite points. */
export function trendProps(label: string, points: TrendPoint[] | undefined, format: (n: number) => string): LineAreaProps | null {
  const pts = points ?? [];
  if (pts.filter((p) => typeof p.value === "number" && Number.isFinite(p.value)).length < MIN_TREND) return null;
  return { label, format, series: [{ key: "v", label, points: pts.map((p) => ({ x: mmdd(p.date), y: p.value })) }] };
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
