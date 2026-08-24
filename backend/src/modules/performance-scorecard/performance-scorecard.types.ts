export interface EmployeePerformanceSnapshotRow {
  employeeId: string;
  snapshotDate: string; // YYYY-MM-DD
  attendanceStatus: string | null;
  lateByMinutes: number;
  unplannedLeaveFlag: boolean;
  pipStatus: "active" | "at_risk" | "off_track" | "none";
  designationId: string | null;
  qualityScore: number | null;
  templateMetrics: Record<string, number> | null;
  teamAttritionPct: number | null;
  teamShrinkagePct: number | null;
  teamRevenue: number | null;
}
