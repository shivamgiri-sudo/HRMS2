import type { MetricDrillId } from "../drill";
import { DrillLinks } from "./parts";
import type { MetricProps } from "./metrics/common";
import { AttendanceMetric } from "./metrics/AttendanceMetric";
import { PeopleMetric } from "./metrics/PeopleMetric";
import { AttritionMetric } from "./metrics/AttritionMetric";
import { FinanceMetric } from "./metrics/FinanceMetric";
import { PnlMetric } from "./metrics/PnlMetric";
import { HiringMetric } from "./metrics/HiringMetric";
import { BacklogMetric } from "./metrics/BacklogMetric";
import { OpsMetric } from "./metrics/OpsMetric";

export const METRIC_TITLES: Record<MetricDrillId, string> = {
  shrinkage: "Shrinkage", late: "Late arrivals", attendance: "Attendance today", headcount: "Headcount vs mandate",
  attrition: "Attrition risk", profit: "Operating profit", finance: "Running P&L", budget: "Budget used", grn: "GRN pending",
  pnl: "Process P&L", openings: "Open positions", hiring: "Hiring", backlog: "Backlogs", ops: "Operations and quality",
};

function Body(p: MetricProps & { id: MetricDrillId }) {
  switch (p.id) {
    case "shrinkage": case "late": case "attendance": return <AttendanceMetric {...p} kind={p.id} />;
    case "headcount": return <PeopleMetric {...p} />;
    case "attrition": return <AttritionMetric {...p} />;
    case "profit": case "finance": case "budget": case "grn": return <FinanceMetric {...p} kind={p.id} />;
    case "pnl": return <PnlMetric {...p} />;
    case "openings": case "hiring": return <HiringMetric {...p} />;
    case "backlog": return <BacklogMetric {...p} />;
    case "ops": return <OpsMetric {...p} />;
    default: return null;
  }
}

/** One metric's focused view, built with the same builders as the page sections, then its related pages. */
export function MetricDrawer(props: MetricProps & { id: MetricDrillId }) {
  return (
    <div className="space-y-5">
      <Body {...props} />
      <DrillLinks target={{ kind: "metric", id: props.id }} />
    </div>
  );
}
