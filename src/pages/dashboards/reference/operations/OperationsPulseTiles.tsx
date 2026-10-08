import { Clock, Headphones, Target, Users } from "lucide-react";
import { PulseGrid, PulseTile } from "../../kit";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import { asNumber, metricDetail, metricUnavailableReason, metricValue } from "../../reference-dashboard-model";

/**
 * The four live-floor tiles operations has always had (calls, login adherence, AHT, headcount), as clickable pulse tiles.
 * They read the summary + pulse queries, so they paint before insights. A measure the dialler feed did not report is
 * "—" with the reason, never a zero.
 */
export function OperationsPulseTiles({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const drill: NonNullable<ReferenceDashboardData["drilldownFor"]> = data.drilldownFor ?? (() => ({}));
  const o = data.opsPulse as Record<string, unknown>;
  const agentsLoggedIn = asNumber(o.agents_logged_in);
  const rawCalls = asNumber(o.total_calls ?? o.total_volume ?? o.calls_handled ?? metricValue(m, "calls"));
  // The pulse answers with zeros (not nulls) when the dialler feed has nothing for today. Nobody logged in AND no calls is
  // that case - on a staffed day it is not a measurement - so the dialler-fed tiles show "-" with the reason instead of 0.
  const feedEmpty = !((agentsLoggedIn ?? 0) > 0) && !((rawCalls ?? 0) > 0);
  const noFeed = feedEmpty ? "No dialler data for today" : null;
  const calls = feedEmpty ? null : rawCalls;
  const adherence = feedEmpty ? null : asNumber(o.login_adherence_pct);
  const adherenceTarget = asNumber(o.login_adherence_target_pct ?? o.login_adherence_target);
  const aht = feedEmpty ? null : asNumber(o.avg_aht_seconds ?? o.avg_handle_time ?? o.aht ?? metricValue(m, "aht"));
  // Headcount comes from the employee master first; a pulse zero must not shadow it (?? keeps 0).
  const masterHeadcount = metricDetail(m, "hc", "active") ?? metricValue(m, "hc");
  const headcount = masterHeadcount ?? (agentsLoggedIn && agentsLoggedIn > 0 ? agentsLoggedIn : null);
  // Agents present but the measure absent means the dialler feed is not reporting it - not that no work happened.
  const feedSilent = (v: number | null) => noFeed ?? ((agentsLoggedIn ?? 0) > 0 && (v === null || v === 0) ? "Not reported by the dialler feed" : null);
  const hc = drill("hc");

  return (
    <PulseGrid cols={4}>
      <PulseTile label="Calls handled" value={feedSilent(calls) ? null : calls} icon={Headphones} tone="blue" helper="total volume today" unavailable={feedSilent(calls)} loading={data.loading} href="/operations-dashboard?tab=live" />
      <PulseTile label="Login adherence" value={adherence} unit="percent" icon={Target} tone={adherence === null || adherenceTarget === null ? "slate" : adherence >= adherenceTarget ? "green" : "red"}
        helper={adherenceTarget === null ? "agents logged in vs scheduled" : `target ${adherenceTarget}%`} unavailable={noFeed} loading={data.loading} href="/operations-dashboard?tab=live" />
      <PulseTile label="Avg handle time" value={feedSilent(aht) ? null : aht} suffix=" s" icon={Clock} tone={aht !== null && aht <= 300 ? "green" : "amber"} higherIsBetter={false} helper="seconds per interaction" unavailable={feedSilent(aht)} loading={data.loading} href="/operations-dashboard?tab=performance&by=process" />
      <PulseTile label="Active headcount" value={headcount} icon={Users} tone="violet" helper="agents on floor" unavailable={metricUnavailableReason(m, "hc")} loading={data.loading} {...(hc.onDrilldown ? { onDrill: hc.onDrilldown } : { href: "/operations-dashboard" })} />
    </PulseGrid>
  );
}
