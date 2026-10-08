import type { ReactNode } from "react";
import { UsersRound } from "lucide-react";
import { DashHero, type HeroStat } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { metricAsOf } from "../../reference-dashboard-model";
import { kpiOf, queueTotals, summaryFigures } from "./hrModel";

const dash = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v.toLocaleString("en-IN")}${suffix}`);

/** The one number HR needs first (open actions) plus live people-ops chips and the composite health ring. */
export function HrHero({ data, filters, onHeadcountDrill }: { data: ReferenceDashboardData; filters?: ReactNode; onHeadcountDrill?: () => void }) {
  const ins = data.insights;
  const loading = data.insightsLoading === true && !ins;
  const f = summaryFigures(data);
  const { open, overdue, queues, critical } = queueTotals(ins?.actions);
  const attrition = kpiOf(ins, "attrition30");
  const net = kpiOf(ins, "net30");
  const att = kpiOf(ins, "att-rate");
  const gap = kpiOf(ins, "hiring-gap") ?? undefined;
  const attAsOf = /as of (\d{4}-\d{2}-\d{2})/.exec(att?.deltaLabel ?? "")?.[1] ?? metricAsOf(data.metrics, "att");
  const attValue = att?.value ?? f.attendanceRate;
  const pending = (v: number | null | undefined, suffix = "") => (loading ? "…" : dash(v, suffix));

  const stats: HeroStat[] = [
    { label: "Headcount", value: dash(f.headcount), ...(onHeadcountDrill ? { onClick: onHeadcountDrill } : { href: "/employees" }) },
    { label: "Attrition 30d", value: pending(attrition?.value, "%"), tone: attrition?.value == null ? "neutral" : attrition.value > 10 ? "bad" : attrition.value > 5 ? "warn" : "good", href: "/exit/command-center" },
    { label: "Net joins − exits", value: pending(net?.value), tone: net?.value == null ? "neutral" : net.value < 0 ? "bad" : "good", href: "/employees" },
    { label: "Overdue items", value: pending(overdue), tone: (overdue ?? 0) > 0 ? "bad" : "good" },
    { label: "Seats to hire", value: f.shortage !== null ? dash(f.shortage) : pending(gap?.value), tone: (f.shortage ?? gap?.value ?? 0) > 0 ? "warn" : "good", href: "/recruitment/job-requisition" },
    { label: `Attendance${attAsOf ? ` · ${attAsOf.slice(5)}` : ""}`, value: pending(attValue, "%"), tone: attValue === null ? "neutral" : attValue >= 90 ? "good" : attValue >= 75 ? "warn" : "bad", href: "/wfm-attendance" },
  ];

  const caption = loading
    ? "Reading the queues…"
    : open === null
      ? "Queues could not be loaded; the summary tiles below still work."
      : open === 0
        ? "Every queue is clear."
        : `${queues} queues waiting${critical ? `, ${critical} critical` : ""}${(overdue ?? 0) > 0 ? `, ${overdue!.toLocaleString("en-IN")} past SLA` : ""}.`;

  return (
    <DashHero
      accent="indigo"
      icon={UsersRound}
      eyebrow="HR · people operations"
      title="HR command centre"
      subtitle="Approvals to action, headcount movement, attrition, hiring gap, onboarding, attendance discipline and compliance"
      headline={{ label: "Open HR actions", value: loading ? "…" : open === null ? "—" : open.toLocaleString("en-IN"), caption }}
      health={ins?.healthScore != null ? { value: ins.healthScore, label: "People-ops health", basis: ins.healthBasis } : null}
      stats={stats}
      right={filters}
    />
  );
}
