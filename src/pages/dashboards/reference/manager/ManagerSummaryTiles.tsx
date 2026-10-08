import { BriefcaseBusiness, CalendarDays, UserCheck, UserMinus, UserPlus, Users } from "lucide-react";
import { PulseGrid, PulseTile, type RoleInsights } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import {
  asNumber, countEmployeesOnLeaveOnDate, metricAsOf, metricDetail, metricUnavailableReason, metricValue, numberAt,
} from "../../reference-dashboard-model";
import { kpiOf } from "./managerModel";

/**
 * The seven headline tiles the manager dashboard has always shown, rebuilt as clickable pulse tiles.
 * They read the summary query only, so they paint before role insights arrive.
 */
export function ManagerSummaryTiles({ data, insights }: { data: ReferenceDashboardData; insights?: RoleInsights }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const team = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const present = metricDetail(m, "att", "present");
  const absent = metricDetail(m, "att", "absent");
  const rate = metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att");
  const asOf = metricAsOf(m, "att");
  const day = asOf ? `processed ${asOf}` : "latest processed day";
  const shortage = metricDetail(m, "hiringAlert", "shortage") ?? metricValue(m, "hiringAlert");
  const processesShort = metricDetail(m, "hiringAlert", "processesShort");
  const joiners = numberAt(data.workforce, "summary", "new_joiners_30d") ?? metricDetail(m, "onb", "pending") ?? metricValue(m, "onb");
  const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata" }).format(new Date());
  // Prefer the insights count (distinct people on approved leave today); fall back to the loaded request list.
  const leaveToday = kpiOf(insights, "on_leave_today")?.value ?? (data.managerLeavesError ? null : countEmployeesOnLeaveOnDate(data.managerLeaves, today));
  const pct = (v: number | null) => (v !== null && team ? `${Math.round((v / Math.max(team, 1)) * 1000) / 10}% of team` : undefined);

  return (
    <PulseGrid cols={4}>
      <PulseTile label="Team members" value={team} icon={Users} tone="blue" helper="Active in your scope" unavailable={metricUnavailableReason(m, "hc")} loading={data.loading} {...drillProps(drill("hc"))} />
      <PulseTile label="Present" value={present} icon={UserCheck} tone="green" helper={`${rate === null ? "—" : `${rate}%`} attendance · ${day}`} unavailable={metricUnavailableReason(m, "att")} loading={data.loading} {...drillProps(drill("att"))} />
      <PulseTile label="On leave today" value={leaveToday} icon={CalendarDays} tone="violet" helper={pct(leaveToday) ?? "Approved leave covering today"} href="/leaves" loading={data.loading && leaveToday === null} />
      <PulseTile label="Absent" value={absent} icon={UserMinus} tone="red" higherIsBetter={false} helper={`${pct(absent) ?? "of team"} · ${day}`} unavailable={metricUnavailableReason(m, "att")} loading={data.loading} {...drillProps(drill("att"))} />
      <PulseTile label="New joiners (30d)" value={joiners} icon={UserPlus} tone="violet" helper="Joined in the last 30 days" unavailable={metricUnavailableReason(m, "onb")} loading={data.loading} {...drillProps(drill("onb"))} />
      <PulseTile label="Hiring shortage" value={shortage} icon={UserPlus} tone="red" higherIsBetter={false}
        helper={processesShort ? `${processesShort} process${processesShort === 1 ? "" : "es"} short` : "Against mandate + buffer"}
        unavailable={metricUnavailableReason(m, "hiringAlert")} loading={data.loading} {...drillProps(drill("hiringAlert"))} />
      <PulseTile label="Open positions" value={asNumber(data.ats.open_positions ?? data.ats.openPositions)} icon={BriefcaseBusiness} tone="blue" helper="View jobs" href="/ats/dashboard" loading={data.loading} />
    </PulseGrid>
  );
}

/** drilldownFor() yields { onDrilldown } only when the metric has a usable drilldown; map it onto PulseTile's onDrill. */
function drillProps(d: { onDrilldown?: () => void }): { onDrill?: () => void } {
  return d.onDrilldown ? { onDrill: d.onDrilldown } : {};
}
