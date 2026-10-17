import { CheckCircle2 } from "lucide-react";
import type { BranchHeadHealthPayload } from "../../../../../../backend/src/modules/branch-head-health/types";
import { formatCount } from "../format";
import { isStillCalculating } from "../pending";
import { SectionCalculating } from "../SectionPanels";
import { AccentCard, BarsChart, ChartCard, EmptyLine, PAL } from "../look";

export const OVER_MANDATE_ID = "bh-over-mandate";

/** Cost centres over mandate (across the selected branches) as bars with seats beside headcount, plus the table twin. */
export function DataHealthChips({ section }: { section: BranchHeadHealthPayload["dataHealth"] }) {
  if (section?.status === "error" && isStillCalculating(section.message)) {
    return <AccentCard title="Data health" accent="rose"><SectionCalculating name="Data health" /></AccentCard>;
  }
  if (!section || section.status === "error") {
    return <AccentCard title="Data health" accent="rose"><EmptyLine text="Data health could not be loaded." /></AccentCard>;
  }
  const d = section.data;
  if (section.status === "empty" || !d) {
    return <AccentCard title="Data health" accent="rose"><EmptyLine text="No data health information for these branches." /></AccentCard>;
  }
  const rows = [...d.overMandate].sort((a, b) => (b.headcount - b.seats) - (a.headcount - a.seats));
  const table = {
    caption: "Cost centres over mandate across the selected branches",
    columns: ["Cost centre", "Headcount", "Mandated seats", "Over by"],
    rows: rows.map((r) => [r.costCentre, formatCount(r.headcount), formatCount(r.seats), `Over by ${formatCount(r.headcount - r.seats)}`]),
  };
  return (
    <div id={OVER_MANDATE_ID} className="scroll-mt-4">
      {rows.length ? (
        <ChartCard title="Cost centres over mandate" accent="rose" table={table} chip={`${formatCount(rows.length)} over · across the selected branches`}>
          <BarsChart label={`Cost centres over mandate: ${rows.map((r) => `${r.costCentre} ${formatCount(r.headcount)} of ${formatCount(r.seats)} seats, Over by ${formatCount(r.headcount - r.seats)}`).join("; ")}`}
            xKey="cc" horizontal height={Math.max(150, rows.length * 44 + 60)} format={formatCount}
            data={rows.map((r) => ({ cc: r.costCentre, headcount: r.headcount, seats: r.seats }))}
            series={[{ key: "headcount", label: "Headcount", color: PAL.s2 }, { key: "seats", label: "Mandated seats", color: PAL.other }]} />
        </ChartCard>
      ) : (
        <AccentCard title="Cost centres over mandate" accent="rose" chip="0 over">
          <EmptyLine icon={CheckCircle2} text="No cost centre is over its mandated seats." />
        </AccentCard>
      )}
    </div>
  );
}
