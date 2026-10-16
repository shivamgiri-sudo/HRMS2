import type { AttritionData } from "../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, LineArea, StackedBar, StatTile, barListTable, lineAreaTable, stackedBarTable, type BarListProps, type LineAreaProps, type LineSeries, type StackedBarProps } from "../viz";
import { formatCount, formatPct } from "../format";
import { SectionShell } from "../ui";
import { byLabel, Foot, Grid, nn, selectByName, TileItem, Tiles, type VisualProps } from "./shared";

/** Ordinal warm ramp tokens (viz.css, light and dark): darker = more severe; legend and table carry the words. */
export const RISK_TIER_COLORS = { low: "var(--bh-risk-1)", medium: "var(--bh-risk-2)", high: "var(--bh-risk-3)", critical: "var(--bh-risk-4)" } as const;
const TIERS = [["low", "Low"], ["medium", "Medium"], ["high", "High"], ["critical", "Critical"]] as const;

/** Chart props and table twins; `date` (YYYY-MM-DD) places the 30-day expected exits on the current month. */
export function buildAttrition(d: AttritionData, date: string) {
  const tiers: StackedBarProps = {
    label: "Employees by attrition risk tier",
    series: TIERS.map(([key, label]) => ({ key, label, color: RISK_TIER_COLORS[key] })),
    rows: [{ id: "tiers", label: "Risk tiers", segments: TIERS.map(([key]) => ({ key, value: nn(d[key]) })) }],
  };
  const current = String(date ?? "").slice(0, 7);
  const months = (d.monthlyExits ?? []).map((m) => m.month);
  const hasExpected = typeof d.expectedExits30 === "number" && Number.isFinite(d.expectedExits30) && current.length === 7;
  const xs = hasExpected && !months.includes(current) ? [...months, current] : months;
  const exitsBy = new Map((d.monthlyExits ?? []).map((m) => [m.month, nn(m.exits)]));
  const series: LineSeries[] = [{ key: "exits", label: "Exits", points: xs.map((x) => ({ x, y: exitsBy.has(x) ? (exitsBy.get(x) as number) : null })) }];
  if (hasExpected) {
    series.push({ key: "expected", label: "Expected exits, next 30 days", dashed: true, points: xs.map((x) => ({ x, y: x === current ? (d.expectedExits30 as number) : null })) });
  }
  const exits: LineAreaProps = { label: "Exits per month", format: formatCount, series };
  const byProcess: BarListProps = {
    label: "High attrition risk by process",
    format: formatCount,
    items: (d.byProcess ?? []).map((p, i) => ({
      id: `r${i}`, label: p.process, value: nn(p.highRisk),
      note: `${formatCount(p.headcount)} headcount, ${formatCount(p.absentStreak)} absent streak`,
    })),
  };
  return {
    tiers, tiersTable: stackedBarTable(tiers),
    exits, exitsTable: lineAreaTable(exits),
    byProcess, byProcessTable: barListTable(byProcess),
  };
}

/** Counts and charts only: no person is named at branch level. */
export function AttritionVisual(props: VisualProps) {
  const { overview } = props;
  return (
    <SectionShell<AttritionData> title="Attrition and retention" section={overview.attrition} emptyText="Attrition analysis is not available for this branch right now">
      {(d) => {
        const b = buildAttrition(d, overview.date);
        return (
          <div className="space-y-3">
            <Tiles label="Attrition summary">
              <TileItem><StatTile label="Expected exits (30 days)" value={formatCount(d.expectedExits30)} /></TileItem>
              <TileItem><StatTile label="Exits, last 30 days" value={formatCount(d.exits30)} hint={`Previous 30 days: ${formatCount(d.exitsPrev30)}; last 90 days: ${formatCount(d.exits90)}`} /></TileItem>
              <TileItem><StatTile label="Absent streak" value={formatCount(d.absentStreak)} hint={`New joiner risk: ${formatCount(d.newJoinerRisk)}`} /></TileItem>
              <TileItem><StatTile label="Early exit share" value={formatPct(d.earlyExitSharePct)} /></TileItem>
            </Tiles>
            <ChartFrame title="Risk tiers" subtitle={`${formatCount(d.topRiskCount)} people are flagged as top risk. Names are available in the process drill-down.`} table={b.tiersTable} height={72}>
              <StackedBar {...b.tiers} />
            </ChartFrame>
            <Grid>
              <ChartFrame title="Monthly exits" subtitle="Dashed point: expected exits in the next 30 days" table={b.exitsTable} height={180}>
                <LineArea {...b.exits} />
              </ChartFrame>
              <ChartFrame title="High risk by process" table={b.byProcessTable} height={96}>
                <BarList {...b.byProcess} onSelect={byLabel(b.byProcess.items, selectByName(props, "attrition"))} />
              </ChartFrame>
            </Grid>
            {d.calibrationNote ? <Foot>{d.calibrationNote}</Foot> : null}
          </div>
        );
      }}
    </SectionShell>
  );
}
