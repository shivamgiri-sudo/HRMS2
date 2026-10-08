import { AlertTriangle, CheckCircle2, ClipboardList, Star, TrendingDown, Users } from "lucide-react";
import { PulseGrid, PulseTile } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { asNumber, metricAsOf, metricDetail, metricUnavailableReason, metricValue } from "../../reference-dashboard-model";

/**
 * The tiles the quality dashboard has always shown, as clickable pulse tiles, from the summary queries (paint first).
 * Their window is the audit page's default - month to date - which is why the labels say so; the insight tiles below
 * use a rolling 30 days. `Pending` here is assessed-but-unscored rows, not calls never audited (see the insight tiles).
 */
export function QualitySummaryTiles({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const q = data.quality;
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const score = asNumber(q.avg_score ?? q.average_score ?? metricValue(m, "quality"));
  const audits = asNumber(q.total_audits ?? q.audits_done);
  const fail = asNumber(q.fail_rate ?? q.failure_rate);
  const pending = asNumber(q.pending_audits ?? q.queue_size);
  const hc = drill("hc");
  const att = drill("att");
  const asOf = metricAsOf(m, "att");
  const reason = q.unavailable_reason ? String(q.unavailable_reason) : null;

  return (
    <PulseGrid cols={3}>
      <PulseTile label="Avg audit score (MTD)" value={score} unit="percent" icon={Star} tone={score === null ? "slate" : score >= 85 ? "green" : score >= 70 ? "amber" : "red"} helper="month-to-date average of scored calls" unavailable={reason} loading={data.loading} href="/quality-dashboard" />
      <PulseTile label="Audits completed (MTD)" value={audits} icon={ClipboardList} tone="blue" helper="scored calls this month" unavailable={reason} loading={data.loading} href="/quality-dashboard" />
      <PulseTile label="Fail rate (MTD)" value={fail} unit="percent" icon={TrendingDown} higherIsBetter={false} tone={fail === null ? "slate" : fail <= 10 ? "green" : fail <= 20 ? "amber" : "red"} helper="scored calls below 50%" unavailable={reason} loading={data.loading} href="/quality-dashboard" />
      <PulseTile label="Assessed, not scored (MTD)" value={pending} icon={AlertTriangle} higherIsBetter={false} tone={pending === null ? "slate" : pending > 20 ? "red" : "amber"} helper="assessment rows with no quality score" unavailable={reason} loading={data.loading} href="/quality-dashboard" />
      <PulseTile label="Agents in scope" value={metricDetail(m, "hc", "active") ?? metricValue(m, "hc")} icon={Users} tone="blue" helper="active headcount for this scope" unavailable={metricUnavailableReason(m, "hc")} loading={data.loading} {...(hc.onDrilldown ? { onDrill: hc.onDrilldown } : { href: "/employees" })} />
      <PulseTile label="Attendance rate" value={metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att")} unit="percent" icon={CheckCircle2} tone="green" helper={asOf ? `processed day ${asOf}` : "latest processed attendance day"} unavailable={metricUnavailableReason(m, "att")} loading={data.loading} {...(att.onDrilldown ? { onDrill: att.onDrilldown } : { href: "/attendance" })} />
    </PulseGrid>
  );
}
