import type { BacklogAggregate, BacklogsData } from "../../../../../../backend/src/modules/branch-head-health/types";
import { ChartFrame, StackedBar, stackedBarTable, type StackedBarProps } from "../viz";
import { formatCount } from "../format";
import { SectionShell } from "../ui";
import { extendTable, Foot, nn, type VisualProps } from "./shared";

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
  return { bars, table };
}

export function BacklogVisual({ overview, onSelect }: VisualProps) {
  return (
    <SectionShell<BacklogsData> title="Backlogs" section={overview.backlogs} emptyText="No backlog data for this branch">
      {(d) => {
        const b = buildBacklog(d);
        return (
          <div className="space-y-2">
            <ChartFrame title="Pending requests by age" subtitle="Regularization and leave approvals waiting" table={b.table} height={96}>
              <StackedBar {...b.bars} onSelect={() => onSelect({ kind: "metric", id: "backlog" })} />
            </ChartFrame>
            <Foot>
              Pending GRN stages: see <a href="#bh-finance" className="font-semibold text-blue-800 underline underline-offset-2">Open GRNs by approval stage in Finance</a>.
            </Foot>
          </div>
        );
      }}
    </SectionShell>
  );
}
