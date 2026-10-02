import type { ReactNode } from "react";
import { Users } from "lucide-react";
import { DashHero, type HeroStat, type RoleInsights } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { metricAsOf, metricDetail, metricValue } from "../../reference-dashboard-model";
import { decisionQueues, kpiOf } from "./managerModel";

/** Hero: the one number a manager needs first - decisions waiting - plus live chips and the team health ring. */
export function ManagerHeroBlock({ data, managerName, insights, filters }: { data: ReferenceDashboardData; managerName: string; insights?: RoleInsights; filters?: ReactNode }) {
  const m = data.metrics;
  const { open, overdue, queues } = decisionQueues(insights?.actions);
  const team = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const rate = kpiOf(insights, "att_rate");
  const risk = kpiOf(insights, "risk_high");
  const asOf = metricAsOf(m, "att");
  const loading = data.insightsLoading && !insights;
  const dash = (v: number | null | undefined, suffix = "") => (v === null || v === undefined ? "—" : `${v}${suffix}`);

  const stats: HeroStat[] = [
    { label: "Team size", value: dash(team), href: "/my-team" },
    { label: `Attendance${asOf ? ` · ${asOf.slice(5)}` : ""}`, value: dash(rate?.value, "%"), tone: rate?.value == null ? "neutral" : rate.value >= 90 ? "good" : rate.value >= 80 ? "warn" : "bad", onClick: data.openDrill ? () => data.openDrill?.("ATTENDANCE", "Team attendance") : undefined },
    { label: "Overdue approvals", value: loading ? "…" : dash(overdue), tone: (overdue ?? 0) > 0 ? "bad" : "good", href: "/work-inbox" },
    { label: "High retention risk", value: loading ? "…" : dash(risk?.value), tone: (risk?.value ?? 0) > 0 ? "warn" : "good", href: "/my-team" },
    { label: "Logged in now", value: loading ? "…" : dash(kpiOf(insights, "live_in")?.value), href: "/wfm/team-attendance" },
    { label: "Out today", value: loading ? "…" : dash(kpiOf(insights, "on_leave_today")?.value), href: "/leaves" },
  ];

  return (
    <DashHero
      accent="emerald"
      icon={Users}
      eyebrow="Manager · my team today"
      title={`Good day, ${managerName.split(" ")[0] || "Manager"}`}
      subtitle="Approvals, attendance, performance and people risk for your reporting line"
      headline={{ label: "Decisions waiting on you", value: loading ? "…" : open === null ? "—" : open.toLocaleString("en-IN"), caption: open === null ? "Queues could not be loaded." : open === 0 ? "Nothing is waiting — your queues are clear." : `${queues} queue${queues === 1 ? "" : "s"} open${(overdue ?? 0) > 0 ? `, ${overdue} past their response window` : ""}.` }}
      health={insights?.healthScore != null ? { value: insights.healthScore, label: "Team health", basis: insights.healthBasis } : null}
      stats={stats}
      right={filters}
    />
  );
}
