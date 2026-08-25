export interface ScorecardColumn {
  key: string;
  label: string;
  metricCode: string;
  format: (row: ScorecardRow) => string;
  /**
   * False when a metric's underlying data source has its own scoping or
   * population gap and cannot reliably return a value yet — not necessarily
   * "never computed at all" (see performance-scorecard-snapshot.service.ts).
   * For example, Shrinkage is marked unavailable because
   * `shrinkage_daily_snapshot` rows are never written with a process/branch
   * scope, so the manager-scoped lookup always returns zero rows. Such
   * columns render as a "Not yet available" placeholder instead of a
   * clickable drilldown, so the feature doesn't look broken/empty when the
   * data simply isn't populated correctly yet. Defaults to true when
   * omitted.
   */
  available?: boolean;
}

export interface ScorecardRow {
  employeeId: string;
  employeeName: string;
  employeeCode: string;
  snapshotDate: string;
  attendanceStatus: string | null;
  lateByMinutes: number;
  unplannedLeaveFlag: boolean;
  pipStatus: "active" | "at_risk" | "off_track" | "none";
  designationId?: string | null;
  qualityScore: number | null;
  templateMetrics?: Record<string, unknown> | null;
  teamAttritionPct: number | null;
  teamShrinkagePct: number | null;
  teamRevenue: number | null;
}

export const BASELINE_COLUMNS: ScorecardColumn[] = [
  { key: "attendanceStatus", label: "Attendance", metricCode: "ATTENDANCE_STATUS", format: (r) => r.attendanceStatus ?? "—" },
  { key: "lateByMinutes", label: "Latecoming", metricCode: "LATECOMING", format: (r) => `${r.lateByMinutes} min` },
  { key: "unplannedLeaveFlag", label: "Unplanned Leave", metricCode: "UNPLANNED_LEAVE", format: (r) => (r.unplannedLeaveFlag ? "Yes" : "No") },
  { key: "pipStatus", label: "PIP", metricCode: "PIP_STATUS", format: (r) => r.pipStatus },
];

export const TEMPLATE_COLUMNS: ScorecardColumn[] = [
  { key: "qualityScore", label: "Quality", metricCode: "QUALITY_BASELINE", format: (r) => (r.qualityScore === null ? "—" : r.qualityScore.toFixed(1)), available: true },
  { key: "teamAttritionPct", label: "Attrition", metricCode: "ATTRITION", format: (r) => (r.teamAttritionPct === null ? "N/A" : `${r.teamAttritionPct.toFixed(1)}%`) },
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "N/A" : `${r.teamShrinkagePct.toFixed(1)}%`), available: false },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "N/A" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
];
