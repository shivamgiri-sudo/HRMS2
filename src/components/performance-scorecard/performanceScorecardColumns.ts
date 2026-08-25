export interface ScorecardColumn {
  key: string;
  label: string;
  metricCode: string;
  format: (row: ScorecardRow) => string;
  /**
   * False when the backend never populates this metric yet (see
   * performance-scorecard-snapshot.service.ts — hardcoded null). Such columns
   * render as a "Not yet available" placeholder instead of a clickable
   * drilldown, so the feature doesn't look broken/empty when it simply
   * hasn't been built. Defaults to true when omitted.
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
  { key: "teamShrinkagePct", label: "Shrinkage", metricCode: "SHRINKAGE", format: (r) => (r.teamShrinkagePct === null ? "N/A" : `${r.teamShrinkagePct.toFixed(1)}%`) },
  { key: "teamRevenue", label: "Revenue", metricCode: "REVENUE", format: (r) => (r.teamRevenue === null ? "N/A" : `₹${r.teamRevenue.toLocaleString("en-IN")}`) },
];
