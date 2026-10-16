import { CircleSlash, Clock3, Unlink } from "lucide-react";
import { Panel } from "../../../kit";
import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import { BarList, ChartFrame, barListTable, type BarListProps } from "../viz";
import { formatCount } from "../format";
import { isStillCalculating } from "../pending";
import { SectionCalculating } from "../SectionPanels";

const SUBTITLE = "Across the selected branches";

/** Data-quality counts across the selected branches as chips; cost centres over mandate as bars + table. */
export function DataHealthChips({ section }: { section: BranchHeadHealthPayload["dataHealth"] }) {
  if (section?.status === "error" && isStillCalculating(section.message)) {
    return <Panel title="Data health" subtitle={SUBTITLE}><SectionCalculating name="Data health" /></Panel>;
  }
  if (!section || section.status === "error") {
    return <Panel title="Data health" subtitle={SUBTITLE}><p className="text-[13px] text-slate-700">Data health could not be loaded.</p></Panel>;
  }
  const d = section.data;
  if (section.status === "empty" || !d) {
    return <Panel title="Data health" subtitle={SUBTITLE}><p className="text-[13px] text-slate-700">No data health information for these branches.</p></Panel>;
  }
  const chips = [
    { label: "Unmapped processes", n: d.unmappedProcesses, Icon: Unlink },
    { label: "Cost centres without a process", n: d.costCentresWithoutProcess, Icon: CircleSlash },
    { label: "Stale processes", n: d.staleProcesses, Icon: Clock3 },
  ];
  const over: BarListProps = {
    label: "Cost centres over mandate",
    markerLabel: "Seats",
    format: formatCount,
    items: d.overMandate.map((r) => ({ id: r.costCentre, label: r.costCentre, value: r.headcount, marker: r.seats, note: `Over by ${formatCount(r.headcount - r.seats)}` })),
  };
  return (
    <Panel title="Data health" subtitle={SUBTITLE}>
      <ul aria-label="Data health counts" className="flex list-none flex-wrap gap-2 p-0">
        {chips.map(({ label, n, Icon }) => (
          <li key={label} className="inline-flex min-h-[32px] items-center gap-1.5 rounded-full border border-slate-300 bg-slate-50 px-3 text-[12px] text-slate-900">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" /><span className="font-bold tabular-nums">{formatCount(n)}</span> {label}
          </li>
        ))}
      </ul>
      {over.items.length > 0 ? (
        <div className="mt-3">
          <ChartFrame title="Cost centres over mandate" subtitle="Headcount; marker = mandated seats" table={barListTable(over)} height={72}>
            <BarList {...over} />
          </ChartFrame>
        </div>
      ) : null}
    </Panel>
  );
}
