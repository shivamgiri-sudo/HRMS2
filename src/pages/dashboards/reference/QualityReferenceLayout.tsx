import type { ReactNode } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ClipboardList,
  Star,
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
  ReferenceDonut,
  ReferenceLineChart,
  ReferenceQuickLink,
} from "../ReferenceDashboardUI";
import { deduplicateQualityRows } from "../dashboard-data-contracts";
import type { ReferenceDashboardData } from "../reference-dashboard-model";
import {
  arrayAt,
  asNumber,
  formatValue,
  metricDetail,
  metricUnavailableReason,
  metricValue,
} from "../reference-dashboard-model";
import {
  AttendanceBreakdownPanel,
} from "./ReferenceSharedPanels";
import { TodayCelebrationsWidget } from "@/components/dashboard/TodayCelebrationsWidget";

export function QualityReferenceLayout({ data, filters }: { data: ReferenceDashboardData; filters?: ReactNode }) {
  const m = data.metrics;
  const drill = data.drilldownFor ?? (() => ({}));
  const quality = data.quality;

  // Set when the upstream audit database is unreachable. Rendering dashes without this
  // is indistinguishable from a genuinely quiet audit period.
  const qualityUnavailable = quality.unavailable_reason ? String(quality.unavailable_reason) : null;
  const sourceLatest = quality.source_latest_record ? String(quality.source_latest_record) : null;

  const auditScore = asNumber(quality.avg_score ?? quality.average_score ?? metricValue(m, "quality"));
  const auditsDone = asNumber(quality.total_audits ?? quality.audits_done);
  const failRate = asNumber(quality.fail_rate ?? quality.failure_rate);
  const pendingAudits = asNumber(quality.pending_audits ?? quality.queue_size);

  const defectRows = deduplicateQualityRows(
    arrayAt(quality, "defects").concat(arrayAt(quality, "defect_categories")),
  );
  const trendRows = arrayAt(quality, "score_trend").map((row) => ({
    label: String(row.period ?? row.label ?? ""),
    value: Number(row.avg_score ?? row.score ?? row.value ?? 0),
  }));

  const agentRows = deduplicateQualityRows(
    arrayAt(quality, "bottom_agents").concat(arrayAt(quality, "low_performers")),
  ).slice(0, 5);

  // ReferenceDonut expects { name, value } and a required centerLabel; the previous
  // { label, value, color } shape rendered an unlabelled chart with an undefined centre.
  const donutData = [
    { name: "Pass", value: asNumber(quality.passed_audits ?? quality.passed_count) },
    { name: "Fail", value: asNumber(quality.failed_audits ?? quality.failed_count) },
  ];

  return (
    <div className="reference-dashboard-page">
      <ReferenceHeader
        title="Quality Dashboard"
        subtitle="Audit performance, defect analysis and agent quality scores"
        badge="QA View"
        right={filters}
      />
      <TodayCelebrationsWidget />

      {qualityUnavailable ? (
        <div className="rounded-lg border border-[#fee3c5] bg-[#fff9f2] px-4 py-3 text-sm text-[#b45309]">
          {qualityUnavailable}
        </div>
      ) : sourceLatest ? (
        <p className="text-xs text-[#71809a]">
          Quality data as of {sourceLatest} · source db_audit.call_quality_assessment
        </p>
      ) : null}

      <ReferenceMetricGrid
        columns={4}
        loading={data.loading}
        metrics={[
          {
            label: "Avg Audit Score",
            value: auditScore !== null ? `${auditScore.toFixed(1)}%` : null,
            helper: "current period average",
            icon: Star,
            tone: auditScore === null ? "slate" : auditScore >= 85 ? "green" : auditScore >= 70 ? "amber" : "red",
          },
          {
            label: "Audits Completed",
            value: auditsDone,
            helper: "total audits this period",
            icon: ClipboardList,
            tone: "blue",
          },
          {
            label: "Fail Rate",
            value: failRate !== null ? `${failRate.toFixed(1)}%` : null,
            helper: "% of audits failed",
            icon: TrendingDown,
            tone: failRate === null ? "slate" : failRate <= 10 ? "green" : failRate <= 20 ? "amber" : "red",
          },
          {
            label: "Pending Queue",
            value: pendingAudits,
            helper: "audits awaiting review",
            icon: AlertTriangle,
            tone: pendingAudits === null ? "slate" : pendingAudits > 20 ? "red" : "amber",
          },
        ]}
      />

      {/* Workforce context for the audited population. The QUALITY bundle gained hc/att
          in the metric-bundle fix; without these tiles the data was fetched and dropped. */}
      <ReferenceMetricGrid
        columns={2}
        loading={data.loading}
        metrics={[
          {
            label: "Agents In Scope",
            value: metricDetail(m, "hc", "active") ?? metricValue(m, "hc"),
            helper: "active headcount for this scope",
            icon: Users,
            tone: "blue",
            href: "/employees",
            unavailableReason: metricUnavailableReason(m, "hc"),
            ...drill("hc"),
          },
          {
            label: "Attendance Rate",
            value: metricDetail(m, "att", "attendanceRate") ?? metricValue(m, "att"),
            valueSuffix: "%",
            helper: "latest processed attendance day",
            icon: CheckCircle2,
            tone: "green",
            unavailableReason: metricUnavailableReason(m, "att"),
            ...drill("att"),
          },
        ]}
      />

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ReferencePanel title="Score Trend" bodyClassName="p-4">
          {trendRows.length > 0 ? (
            <ReferenceLineChart
              data={trendRows}
              height={160}
            />
          ) : (
            <p className="py-8 text-center text-sm text-[#a0aec0]">No trend data available</p>
          )}
        </ReferencePanel>

        <ReferencePanel title="Pass vs Fail Split" bodyClassName="p-4">
          {donutData.every((item) => item.value === null)
            ? <p className="py-8 text-center text-sm text-[#a0aec0]">Direct pass/fail counts unavailable</p>
            : <ReferenceDonut
                data={donutData.map((item) => ({ ...item, value: item.value ?? 0 }))}
                centerLabel="Audits"
              />}
        </ReferencePanel>
      </div>

      <div className="grid gap-4 xl:grid-cols-[1fr_1fr]">
        <ReferencePanel
          title="Top Defect Categories"
          action={<span className="text-xs text-[#61708a]">{formatValue(defectRows.length)} categories</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {defectRows.length > 0 ? defectRows.slice(0, 6).map((row, i) => {
              const severity = String(row.severity ?? "").toLowerCase();
              return (
                <ReferenceListRow
                  key={i}
                  title={String(row.category ?? row.defect_type ?? row.label ?? "Defect")}
                  value={String(row.count ?? row.occurrences ?? row.value ?? "")}
                  subtitle={row.severity ? String(row.severity) : undefined}
                  tone={severity === "critical" ? "red" : severity === "high" ? "amber" : "blue"}
                />
              );
            }) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No defect data available</p>
            )}
          </div>
        </ReferencePanel>

        <ReferencePanel
          title="Agents Needing Coaching"
          action={<span className="text-xs text-[#61708a]">{formatValue(agentRows.length)} agents</span>}
          bodyClassName="p-0"
        >
          <div className="divide-y divide-[#edf1f6]">
            {agentRows.length > 0 ? agentRows.slice(0, 5).map((row, i) => (
              <ReferenceListRow
                key={i}
                title={String(row.agent_name ?? row.name ?? row.employee_name ?? "Agent")}
                value={String(row.score ?? row.avg_score ?? "")}
                subtitle={[
                  String(row.process ?? row.team ?? ""),
                  row.fail_count ? `${row.fail_count} fails` : "",
                ].filter(Boolean).join(" · ")}
                tone="red"
              />
            )) : (
              <p className="px-4 py-8 text-center text-sm text-[#a0aec0]">No coaching flags today</p>
            )}
          </div>
        </ReferencePanel>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <ReferenceQuickLink href="/quality/dashboard" title="Audit Queue" icon={ClipboardList} />
        <ReferenceQuickLink href="/quality/team" title="Team Scorecards" icon={Star} />
        <ReferenceQuickLink href="/quality/executive" title="Executive Quality" icon={Target} />
        <ReferenceQuickLink href="/quality/my-dashboard" title="My Quality" icon={Users} />
      </div>

      <div className="grid gap-4 xl:grid-cols-2">
        <AttendanceBreakdownPanel data={data} />
      </div>
    </div>
  );
}
