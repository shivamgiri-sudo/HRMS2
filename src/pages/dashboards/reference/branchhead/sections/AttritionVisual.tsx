import { AlertOctagon, CalendarClock, LogOut, Percent, UserMinus, UserX } from "lucide-react";
import type { AttritionData, AttritionRiskPerson } from "../../../../../../backend/src/modules/branch-head-health/types";
import { barListTable, lineAreaTable, stackedBarTable, type BarListProps, type LineAreaProps, type LineSeries, type StackedBarProps } from "../viz";
import { formatCount, formatPct } from "../format";
import { AccentCard, BarCell, BarsChart, ChartCard, Chip, EmptyLine, GradientKpi, KpiCell, KpiGrid, NavyTable, PAL, SectionGate, type ChipTone } from "../look";
import { nn, selectByName, type VisualProps } from "./shared";

/** Ordinal warm ramp tokens (viz.css, light and dark): darker = more severe; legend and table carry the words. */
export const RISK_TIER_COLORS = { low: "var(--bh-risk-1)", medium: "var(--bh-risk-2)", high: "var(--bh-risk-3)", critical: "var(--bh-risk-4)" } as const;
const RISK_HEX = { low: "#eb9572", medium: "#d2603d", high: "#b03a2c", critical: "#7a1d18" } as const;
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

export function tierTone(tier: string): ChipTone {
  const t = String(tier ?? "").toUpperCase();
  return t === "CRITICAL" ? "crit" : t === "HIGH" ? "warn" : t === "MEDIUM" ? "info" : "mute";
}
const title = (s: string) => (s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s);

/** Attrition tab: email section 10 - six KPIs, monthly exits, tiers, by process and the top-risk people. */
export function AttritionVisual(props: VisualProps) {
  const { overview } = props;
  return (
    <SectionGate<AttritionData> title="Attrition and retention" section={overview.attrition} emptyText="Attrition analysis is not available for this branch right now" accent="violet">
      {(d) => {
        const b = buildAttrition(d, overview.date);
        const pick = selectByName(props, "attrition");
        const risk = nn(d.critical) + nn(d.high);
        const trend = b.exits.series[0].points.map((p, i) => ({ month: p.x, exits: p.y, expected: b.exits.series[1]?.points[i]?.y ?? null }));
        const procs = d.byProcess ?? [];
        const maxRisk = Math.max(1, ...procs.map((p) => nn(p.highRisk)));
        return (
          <div className="space-y-4">
            <h2 className="sr-only">Attrition and retention</h2>
            <KpiGrid label="Attrition summary" cols={6}>
              <KpiCell><GradientKpi icon={AlertOctagon} hue="violet" label="High + critical risk" value={formatCount(risk)} sub={`${formatCount(d.critical)} critical, ${formatCount(d.high)} high`}
                status={risk >= 10 ? "critical" : risk >= 1 ? "warning" : null} /></KpiCell>
              <KpiCell><GradientKpi icon={CalendarClock} hue="navy" label="Expected exits (30 days)" value={formatCount(d.expectedExits30)} sub="Model estimate" /></KpiCell>
              <KpiCell><GradientKpi icon={LogOut} hue="orange" label="Exits, last 30 days" value={formatCount(d.exits30)} sub={`Previous 30 days: ${formatCount(d.exitsPrev30)}`} /></KpiCell>
              <KpiCell><GradientKpi icon={UserMinus} hue="cyan" label="Exits, last 90 days" value={formatCount(d.exits90)} sub="Rolling quarter" /></KpiCell>
              <KpiCell><GradientKpi icon={Percent} hue="emerald" label="Early exit share" value={formatPct(d.earlyExitSharePct)} sub="Left within 90 days of joining" /></KpiCell>
              <KpiCell><GradientKpi icon={UserX} hue="teal" label="Absent streak" value={formatCount(d.absentStreak)} sub={`New joiner risk: ${formatCount(d.newJoinerRisk)}`} /></KpiCell>
            </KpiGrid>
            <div className="bhl-grid bhl-grid-3">
              <ChartCard title="Monthly exits" chip={`${trend.length} months`} accent="violet" table={b.exitsTable} className="bhl-span-2">
                {trend.length ? (
                  <BarsChart label="Exits per month with the expected exits for the next 30 days" xKey="month" height={260} data={trend}
                    series={[{ key: "exits", label: "Exits", color: PAL.s1 }, { key: "expected", label: "Expected, next 30 days", color: PAL.s2 }]} />
                ) : <EmptyLine text="No exits recorded in the window" />}
              </ChartCard>
              <ChartCard title="Risk tiers" chip={`${formatCount(nn(d.low) + nn(d.medium) + risk)} scored`} accent="rose" table={b.tiersTable}>
                <BarsChart label="Employees by attrition risk tier" xKey="tier" height={260}
                  data={TIERS.map(([k, l]) => ({ tier: l, [k]: nn(d[k]) }))}
                  series={TIERS.map(([k, l]) => ({ key: k, label: l, color: RISK_HEX[k], stack: "t" }))} />
              </ChartCard>
            </div>
              <AccentCard title="Top risk people" chip={`${formatCount(d.topRisk?.length ?? 0)} of ${formatCount(d.topRiskCount)} flagged`} accent="rose">
                <NavyTable<AttritionRiskPerson> caption="Highest attrition risk people" rows={d.topRisk ?? []} limit={8} empty="Nobody is flagged as top risk"
                  columns={[
                    { key: "n", label: "Name", render: (r) => <span className="font-semibold">{r.name}</span> },
                    { key: "c", label: "Code", render: (r) => <span className="tabular-nums">{r.code}</span> },
                    { key: "p", label: "Process", render: (r) => r.process ?? "—" },
                    { key: "d", label: "Days in", num: true, render: (r) => formatCount(r.aonDays) },
                    { key: "s", label: "Score", num: true, render: (r) => <strong>{formatCount(r.score)}</strong> },
                    { key: "t", label: "Tier", render: (r) => <Chip tone={tierTone(r.tier)}>{title(r.tier)}</Chip> },
                    { key: "w", label: "Reasons", wrap: true, render: (r) => ((r.reasons ?? []).length ? <span className="flex flex-wrap gap-1">{(r.reasons ?? []).map((x) => <Chip key={x} tone="mute">{x}</Chip>)}</span> : "—") },
                    { key: "a", label: "Absent streak", num: true, render: (r) => formatCount(r.absentStreak) },
                  ]} />
                <p className="bhl-note">{d.calibrationNote ?? "Risk scores are a prompt for a conversation, not a prediction."}</p>
              </AccentCard>
              <AccentCard title="Risk by process" chip={`${procs.length} processes`} accent="orange">
                <NavyTable caption="High attrition risk by process" rows={procs} limit={10} empty="No process breakdown"
                  onRowClick={(p) => pick(p.process)} rowLabel={(p) => p.process}
                  columns={[
                    { key: "p", label: "Process", render: (p) => <span className="font-semibold">{p.process}</span> },
                    { key: "h", label: "Headcount", num: true, render: (p) => formatCount(p.headcount) },
                    { key: "r", label: "High risk", num: true, render: (p) => <BarCell pct={(nn(p.highRisk) / maxRisk) * 100} text={formatCount(p.highRisk)} color={RISK_HEX.high} /> },
                    { key: "a", label: "Absent streak", num: true, render: (p) => formatCount(p.absentStreak) },
                  ]} />
              </AccentCard>
          </div>
        );
      }}
    </SectionGate>
  );
}
