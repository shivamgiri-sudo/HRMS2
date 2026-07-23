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
  ReferenceHeader,
  ReferenceListRow,
  ReferenceMetricGrid,
  ReferencePanel,
  ReferenceLineChart,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricValue,
} from "../reference-dashboard-model";

export function OperationsReferenceLayout({ data }: { data: ReferenceDashboardData }) {
  const m = data.metrics;
  const opsPulse = data.opsPulse;

  // Field names from /api/bi/daily-operations-pulse: total_calls, avg_aht_seconds, agents_logged_in, login_adherence_pct
  const o = opsPulse as Record<string, unknown>;
  const totalVolume = asNumber(o.total_calls ?? o.total_volume ?? o.calls_handled ?? metricValue(m, "calls"));
  const loginAdherence = asNumber(o.login_adherence_pct);
  const loginAdherenceTarget = asNumber(o.login_adherence_target_pct ?? o.login_adherence_target);
  const avgHandleTime = asNumber(o.avg_aht_seconds ?? o.avg_handle_time ?? o.aht ?? metricValue(m, "aht"));
  const activeHeadcount = asNumber(o.agents_logged_in ?? o.agents_scheduled ?? metricDetail(m, "hc", "active") ?? metricValue(m, "hc"));

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
      <ReferenceHeader
        title="Operations Dashboard"
        subtitle="Live volume, login adherence, AHT and floor headcount"
        badge="Ops View"
      />

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          {
            label: "Calls Handled",
            value: totalVolume,
            helper: "total volume today",
            icon: Headphones,
            tone: "blue",
          },
          {
            label: "Login Adherence",
            value: loginAdherence !== null ? `${loginAdherence.toFixed(1)}%` : null,
            helper: loginAdherenceTarget === null ? "agents logged in vs scheduled" : `target ${loginAdherenceTarget}%`,
            icon: Target,
            tone: loginAdherence === null || loginAdherenceTarget === null
              ? "slate"
              : loginAdherence >= loginAdherenceTarget ? "green" : "red",
          },
          {
            label: "Avg Handle Time",
            value: avgHandleTime !== null ? `${avgHandleTime.toFixed(0)}s` : null,
            helper: "seconds per interaction",
            icon: Clock,
            tone: avgHandleTime !== null && avgHandleTime <= 300 ? "green" : "amber",
          },
          {
            label: "Active Headcount",
            value: activeHeadcount,
            helper: "agents on floor",
            icon: Users,
            tone: "violet",
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
        <ReferencePanel title={volumeTrend.length > 0 ? "Volume Trend" : "Shrinkage Breakdown"} bodyClassName="p-4">
          {volumeTrend.length > 0 ? (
            <ReferenceLineChart data={volumeTrend} color="#3b82f6" height={160} />
          ) : shrinkageRows.length > 0 ? (
            <div className="divide-y divide-[#edf1f6]">
              {shrinkageRows.map((row) => (
                <ReferenceListRow
                  key={row.label}
                  left={row.label}
                  right={formatValue(row.value, "%")}
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
            {interventionFlags.length > 0 ? interventionFlags.map((row, i) => (
              <ReferenceListRow
                key={i}
                left={String(row.flag_type ?? row.type ?? row.label ?? "Alert")}
                right={String(row.count ?? row.value ?? "")}
                sub={String(row.process ?? row.team ?? "")}
                badge={String(row.severity ?? row.priority ?? "").toUpperCase() || undefined}
                badgeTone={
                  String(row.severity ?? row.priority ?? "").toLowerCase() === "critical" ? "red" :
                  String(row.severity ?? row.priority ?? "").toLowerCase() === "high" ? "amber" : "blue"
                }
              />
            )) : (
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
                left={String(row.process_name ?? row.process ?? row.lob ?? "Process")}
                right={String(row.calls_handled ?? row.volume ?? row.headcount ?? "")}
                sub={row.sla_pct != null ? `SLA ${Number(row.sla_pct).toFixed(1)}%` : undefined}
                badge={row.status ? String(row.status) : undefined}
                badgeTone={String(row.status ?? "").toLowerCase() === "critical" ? "red" : "green"}
              />
            ))}
          </div>
        </ReferencePanel>
      )}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/operations/live-tracker" title="Live Tracker" icon={Activity} />
        <ReferenceQuickLink href="/operations/reports" title="Ops Reports" icon={TrendingUp} />
        <ReferenceQuickLink href="/quality/audits" title="QA Queue" icon={AlertOctagon} />
        <ReferenceQuickLink href="/wfm/roster" title="Roster" icon={Users} />
      </div>
    </div>
  );
}
