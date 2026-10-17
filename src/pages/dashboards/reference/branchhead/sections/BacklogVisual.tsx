import { AlarmClock, CalendarClock, ClipboardList, Siren } from "lucide-react";
import type { BacklogAggregate, BacklogsData } from "../../../../../../backend/src/modules/branch-head-health/types";
import { stackedBarTable, type StackedBarProps } from "../viz";
import { formatCount } from "../format";
import { AccentCard, BarsChart, ChartCard, GradientKpi, KpiCell, KpiGrid, NavyTable, PAL, SectionGate } from "../look";
import { extendTable, nn, type VisualProps } from "./shared";

/**
 * Age buckets from the aggregate counts: within 3 days, 3 to 7 days, over 7 days. Each is clamped to
 * what is left of `pending` (oldest first), so buckets are non-negative and always sum to `pending`.
 */
export function backlogBuckets(a: BacklogAggregate): { within3: number; d3to7: number; over7: number } {
  const pending = nn(a.pending);
  const over7 = Math.min(nn(a.over7Days), pending);
  const over3 = Math.min(Math.max(nn(a.over3Days), over7), pending);
  return { within3: pending - over3, d3to7: over3 - over7, over7 };
}

const SERIES = [{ key: "within3", label: "Within 3 days" }, { key: "d3to7", label: "3 to 7 days" }, { key: "over7", label: "Over 7 days" }];
const COLORS: Record<string, string> = { within3: PAL.s1, d3to7: PAL.s4, over7: PAL.s2 };

export function buildBacklog(d: BacklogsData) {
  const queues = [
    { id: "regularization", label: "Regularization", agg: d.regularization, other: `Escalated ${formatCount(d.regularization.escalated)}` },
    { id: "leave", label: "Leave", agg: d.leaveAging, other: `Stale ${formatCount(d.leaveAging.staleOlderThanWindow)}` },
  ];
  const bars: StackedBarProps = {
    label: "Pending requests by age",
    series: SERIES,
    rows: queues.map((q) => {
      const b = backlogBuckets(q.agg);
      return { id: q.id, label: q.label, segments: SERIES.map((s) => ({ key: s.key, value: b[s.key as keyof typeof b] })) };
    }),
  };
  const table = extendTable(stackedBarTable(bars), ["Oldest (days)", "Other"], (i) => [formatCount(queues[i].agg.oldestDays), queues[i].other]);
  return { bars, table, queues };
}

export function BacklogVisual({ overview, onSelect }: VisualProps) {
  return (
    <SectionGate<BacklogsData> title="Backlogs" section={overview.backlogs} emptyText="No backlog data for this branch" accent="orange">
      {(d) => {
        const b = buildBacklog(d);
        const r = d.regularization;
        const l = d.leaveAging;
        return (
          <div className="space-y-4">
            <KpiGrid label="Backlogs">
              <KpiCell><GradientKpi icon={ClipboardList} hue="navy" label="Regularizations pending" value={formatCount(r.pending)} sub={`Oldest ${formatCount(r.oldestDays)} days`}
                status={nn(r.over7Days) > 0 ? "warning" : null} onClick={() => onSelect({ kind: "metric", id: "backlog" })} /></KpiCell>
              <KpiCell><GradientKpi icon={CalendarClock} hue="violet" label="Leave requests pending" value={formatCount(l.pending)} sub={`Oldest ${formatCount(l.oldestDays)} days`}
                status={nn(l.over7Days) > 0 ? "warning" : null} onClick={() => onSelect({ kind: "metric", id: "backlog" })} /></KpiCell>
              <KpiCell><GradientKpi icon={AlarmClock} hue="orange" label="Over 7 days" value={formatCount(nn(r.over7Days) + nn(l.over7Days))} sub={`${formatCount(nn(r.over3Days) + nn(l.over3Days))} over 3 days`} /></KpiCell>
              <KpiCell><GradientKpi icon={Siren} hue="teal" label="Escalated / stale" value={`${formatCount(r.escalated)} / ${formatCount(l.staleOlderThanWindow)}`} sub="Regularization escalated · leave stale" /></KpiCell>
            </KpiGrid>
            <div className="bhl-grid bhl-grid-2">
              <ChartCard title="Pending requests by age" chip={`${formatCount(nn(r.pending) + nn(l.pending))} waiting`} accent="orange" table={b.table}>
                <BarsChart label={b.bars.label} xKey="queue" horizontal height={190}
                  data={b.bars.rows.map((row) => ({ queue: row.label, ...Object.fromEntries(row.segments.map((s) => [s.key, s.value])) }))}
                  series={SERIES.map((s) => ({ key: s.key, label: s.label, color: COLORS[s.key], stack: "a" }))} />
              </ChartCard>
              <AccentCard title="Queues" chip="Regularization and leave" accent="blue">
                <NavyTable caption="Backlog queues by age" rows={b.queues} limit={0} onRowClick={() => onSelect({ kind: "metric", id: "backlog" })} rowLabel={(q) => q.label}
                  columns={[
                    { key: "q", label: "Queue", render: (q) => <span className="font-semibold">{q.label}</span> },
                    { key: "p", label: "Pending", num: true, render: (q) => formatCount(q.agg.pending) },
                    { key: "3", label: "Over 3 d", num: true, render: (q) => formatCount(q.agg.over3Days) },
                    { key: "7", label: "Over 7 d", num: true, render: (q) => formatCount(q.agg.over7Days) },
                    { key: "o", label: "Oldest (days)", num: true, render: (q) => formatCount(q.agg.oldestDays) },
                    { key: "x", label: "Other", render: (q) => q.other },
                  ]} />
                <p className="bhl-note">Pending GRN stages: see <strong>Open GRNs by approval stage</strong> on the Finance tab (GRN summary).</p>
              </AccentCard>
            </div>
          </div>
        );
      }}
    </SectionGate>
  );
}
