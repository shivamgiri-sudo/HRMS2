import {
  Activity,
  AlertOctagon,
  Clock,
  Headphones,
  Target,
  TrendingDown,
  TrendingUp,
  Users,
} from "lucide-react";

import {
  ReferenceListRow,
  ReferencePanel,
  ReferenceLineChart,
  ReferenceQuickLink,
} from "../../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricUnavailableReason,
  metricValue,
} from "../../reference-dashboard-model";
import {
  AttendanceBreakdownPanel,
  LiveVsProcessedPanel,
} from "../ReferenceSharedPanels";

/** The pre-redesign panels, kept whole so every datapoint the old operations dashboard showed is still reachable. */
export function OperationsClassicPanels({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const opsPulse = data.opsPulse;

  // Field names from /api/bi/daily-operations-pulse: total_calls, avg_aht_seconds, agents_logged_in, login_adherence_pct
  const o = opsPulse as Record<string, unknown>;
  const totalVolume = asNumber(o.total_calls ?? o.total_volume ?? o.calls_handled ?? metricValue(m, "calls"));
  const loginAdherence = asNumber(o.login_adherence_pct);
  const loginAdherenceTarget = asNumber(o.login_adherence_target_pct ?? o.login_adherence_target);
  const avgHandleTime = asNumber(o.avg_aht_seconds ?? o.avg_handle_time ?? o.aht ?? metricValue(m, "aht"));
  const activeHeadcount = asNumber(o.agents_logged_in ?? o.agents_scheduled ?? metricDetail(m, "hc", "active") ?? metricValue(m, "hc"));

  /**
   * The dialler feed delivers agent rows without the columns that measure them.
   *
   * `apr` has been receiving 150–380 agent rows a day while Calls, AHT and every shrinkage
   * column (BIO / LUNCH / QA / TRAINING) arrive empty — 0 calls on most days for a fortnight
   * to 2026-08-28, against ~1,100 active staff. Rendered as a number, that reads as a floor
   * that took no calls; it is a feed that is not reporting them.
   *
   * The distinction is testable rather than assumed: agents present AND the measure absent
   * means the column is missing, not that the work did not happen. With no agents logged in
   * at all, a zero is a real zero and stays one.
   */
  const agentsLoggedIn = asNumber(o.agents_logged_in);
  const feedSilent = (measure: number | null) =>
    (agentsLoggedIn ?? 0) > 0 && (measure === null || measure === 0)
      ? "Not reported by the dialler feed"
      : null;

  const volumeTrend = arrayAt(opsPulse, "volume_trend").map((row) => ({
    label: String(row.period ?? row.hour ?? row.label ?? ""),
    value: Number(row.volume ?? row.calls ?? row.value ?? 0),
  }));

  // Shrinkage breakdown from pulse — shown when no volume trend array
  const shrinkage = o.shrinkage_breakdown as Record<string, number> | undefined;
  const shrinkageRows = shrinkage
    ? Object.entries(shrinkage).map(([label, value]) => ({ label, value: Number(value) }))
    : [];

  // Top process from pulse
  const topProcess = o.top_process as Record<string, unknown> | null | undefined;

  const interventionFlags = arrayAt(opsPulse, "intervention_flags").slice(0, 6);
  const processRows = arrayAt(data.workforce, "process_breakdown").concat(arrayAt(data.workforce, "processes")).slice(0, 6);

  return (
    <div className="reference-dashboard-page">
      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ReferencePanel title={volumeTrend.length > 0 ? "Volume Trend" : "Shrinkage Breakdown"} bodyClassName="p-4">
          {volumeTrend.length > 0 ? (
            <ReferenceLineChart data={volumeTrend} height={160} />
          ) : shrinkageRows.length > 0 ? (
            <div className="divide-y divide-[#edf1f6]">
              {shrinkageRows.map((row) => (
                <ReferenceListRow
                  key={row.label}
                  title={row.label}
                  value={formatValue(row.value, "%")}
                />
              ))}
            </div>
          ) : topProcess ? (
            <div className="flex flex-col gap-1 py-4 text-sm">
              <p className="font-semibold text-[#0b1f44]">Top Process: {String(topProcess.name ?? "")}</p>
              <p className="text-[#61708a]">{String(topProcess.calls ?? 0)} calls · {String(topProcess.agent_count ?? 0)} agents</p>
            </div>
          ) : (
            <p className="py-8 text-center text-sm text-[#a0aec0]">No trend data available</p>
          )}
        </ReferencePanel>

        <ReferencePanel
          title="Intervention Flags"
          action={
            interventionFlags.length > 0 ? (
              <span className="rounded-full bg-[#ef4444] px-2 py-0.5 text-xs font-bold text-white">
                {formatValue(interventionFlags.length)}
              </span>
            ) : null
          }
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {interventionFlags.length > 0 ? interventionFlags.map((row, i) => {
              const severity = String(row.severity ?? row.priority ?? "").toLowerCase();
              return (
                <ReferenceListRow
                  key={i}
                  title={String(row.flag_type ?? row.type ?? row.label ?? "Alert")}
                  value={String(row.count ?? row.value ?? "")}
                  subtitle={[String(row.process ?? row.team ?? ""), severity.toUpperCase()]
                    .filter(Boolean)
                    .join(" · ")}
                  tone={severity === "critical" ? "red" : severity === "high" ? "amber" : "blue"}
                />
              );
            }) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No active flags</p>
            )}
          </div>
        </ReferencePanel>
      </div>

      {processRows.length > 0 && (
        <ReferencePanel
          title="Process Breakdown"
          action={<span className="text-xs text-[#61708a]">{formatValue(processRows.length)} processes</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {processRows.map((row, i) => (
              <ReferenceListRow
                key={i}
                title={String(row.process_name ?? row.process ?? row.lob ?? "Process")}
                value={String(row.calls_handled ?? row.volume ?? row.headcount ?? "")}
                subtitle={[
                  row.sla_pct != null ? `SLA ${Number(row.sla_pct).toFixed(1)}%` : "",
                  row.status ? String(row.status) : "",
                ].filter(Boolean).join(" · ")}
                tone={String(row.status ?? "").toLowerCase() === "critical" ? "red" : "green"}
              />
            ))}
          </div>
        </ReferencePanel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/wfm/live-tracker" title="Live Tracker" icon={Activity} />
        <ReferenceQuickLink href="/operations-dashboard?tab=performance&by=process" title="Operations KPI" icon={TrendingUp} />
        <ReferenceQuickLink href="/quality-dashboard" title="QA Queue" icon={AlertOctagon} />
        <ReferenceQuickLink href="/wfm/roster" title="Roster" icon={Users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AttendanceBreakdownPanel data={data} />
        <LiveVsProcessedPanel data={data} />
      </div>
    </div>
  );
}
