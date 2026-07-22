/**
 * Frontend Report Catalog — Column Definitions & Formatters
 *
 * This file provides frontend-specific column definitions and value formatters
 * for the Reports Center. It mirrors the backend catalog structure.
 *
 * Generated: 2026-07-22
 */

export type ColumnFormat =
  | "text" | "number" | "currency" | "percentage"
  | "date" | "datetime" | "time" | "duration" | "minutes"
  | "boolean" | "status" | "masked" | "email" | "phone";

export interface ColumnDef {
  key: string;
  label: string;
  format: ColumnFormat;
  align?: "left" | "center" | "right";
  width?: number;
  sensitive?: boolean;
}

export interface ReportMeta {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  description: string;
  rowGrain: string;
  primaryKey: string[];
  columns: ColumnDef[];
  viewRoles: string[];
  exportRoles: string[];
}

// ─── Value Formatters ──────────────────────────────────────────────────────────

export function formatValue(value: unknown, format: ColumnFormat): string {
  if (value == null || value === "") return "—";

  const str = String(value);

  switch (format) {
    case "currency":
      const num = Number(value);
      if (isNaN(num)) return str;
      return `₹${num.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    case "percentage":
      const pct = Number(value);
      if (isNaN(pct)) return str;
      return `${pct.toFixed(2)}%`;

    case "number":
      const n = Number(value);
      if (isNaN(n)) return str;
      return n.toLocaleString("en-IN");

    case "date":
      if (!str || str === "null") return "—";
      try {
        const d = new Date(str);
        if (isNaN(d.getTime())) return str;
        return d.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
      } catch {
        return str;
      }

    case "datetime":
      if (!str || str === "null") return "—";
      try {
        const dt = new Date(str);
        if (isNaN(dt.getTime())) return str;
        return dt.toLocaleString("en-IN", {
          day: "2-digit", month: "short", year: "numeric",
          hour: "2-digit", minute: "2-digit"
        });
      } catch {
        return str;
      }

    case "time":
      if (!str || str === "null") return "—";
      if (str.includes(":")) return str.substring(0, 5);
      return str;

    case "duration":
      // Expected format: HH:mm:ss or minutes as number
      if (typeof value === "number") {
        const hrs = Math.floor(value / 60);
        const mins = Math.round(value % 60);
        return `${hrs}:${String(mins).padStart(2, "0")}`;
      }
      return str;

    case "minutes":
      const mins = Number(value);
      if (isNaN(mins)) return str;
      const h = Math.floor(mins / 60);
      const m = Math.round(mins % 60);
      return h > 0 ? `${h}h ${m}m` : `${m}m`;

    case "boolean":
      const bool = value === true || value === 1 || str.toLowerCase() === "true" || str === "1";
      return bool ? "Yes" : "No";

    case "status":
      // Capitalize first letter, replace underscores with spaces
      return str.charAt(0).toUpperCase() + str.slice(1).replace(/_/g, " ");

    case "masked":
      if (str.length <= 4) return "****";
      return "****" + str.slice(-4);

    case "email":
      return str.toLowerCase();

    case "phone":
      // Format Indian phone numbers
      if (str.length === 10) {
        return `${str.slice(0, 5)} ${str.slice(5)}`;
      }
      return str;

    case "text":
    default:
      return str;
  }
}

// ─── Report Categories ─────────────────────────────────────────────────────────

export const REPORT_CATEGORIES = [
  { key: "hr-workforce", label: "HR & Workforce", icon: "Users" },
  { key: "attendance", label: "Attendance", icon: "Clock" },
  { key: "leave", label: "Leave", icon: "Calendar" },
  { key: "payroll", label: "Payroll", icon: "DollarSign" },
  { key: "statutory", label: "Statutory", icon: "FileText" },
  { key: "exit", label: "Exit & Separation", icon: "LogOut" },
  { key: "attrition", label: "Attrition & Trends", icon: "TrendingDown" },
  { key: "recruitment", label: "Recruitment", icon: "UserPlus" },
  { key: "operations", label: "Operations & Quality", icon: "Activity" },
  { key: "wfm", label: "WFM & Roster", icon: "Grid" },
  { key: "assets", label: "Assets", icon: "Package" },
  { key: "training", label: "Training", icon: "BookOpen" },
  { key: "documents", label: "Documents", icon: "File" },
  { key: "identity", label: "Identity", icon: "Shield" },
];

// ─── Complete Report Catalog ───────────────────────────────────────────────────

export const REPORT_CATALOG: ReportMeta[] = [
  // ═══════════════════════════════════════════════════════════════════════════════
  // HR & WORKFORCE
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "headcount",
    name: "Active Headcount Summary",
    category: "HR & Workforce",
    subcategory: "Headcount & Org",
    description: "Summary of active employees grouped by branch, department, and process",
    rowGrain: "One row per branch/department/process combination",
    primaryKey: ["branch_name", "department_name", "process_name"],
    columns: [
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "active_headcount", label: "Active Headcount", format: "number", width: 120, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },
  {
    code: "employee-master",
    name: "Employee Master Export",
    category: "HR & Workforce",
    subcategory: "Headcount & Org",
    description: "Complete employee directory with all master data fields",
    rowGrain: "One row per employee",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "official_email", label: "Official Email", format: "email", width: 200 },
      { key: "mobile", label: "Mobile", format: "phone", width: 120, sensitive: true },
      { key: "employment_status", label: "Status", format: "status", width: 100 },
      { key: "date_of_joining", label: "DOJ", format: "date", width: 100 },
      { key: "date_of_exit", label: "DOL", format: "date", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "cost_centre_name", label: "Cost Centre", format: "text", width: 140 },
      { key: "reporting_manager", label: "Reporting Manager", format: "text", width: 180 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ATTENDANCE
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "attendance-daily",
    name: "Daily Attendance Report",
    category: "Attendance",
    subcategory: "Daily",
    description: "Day-wise attendance with punch times, productive minutes, and status",
    rowGrain: "One row per employee per attendance date",
    primaryKey: ["employee_code", "record_date"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "shift_name", label: "Roster Shift", format: "text", width: 120 },
      { key: "shift_start", label: "Shift Start", format: "time", width: 80 },
      { key: "shift_end", label: "Shift End", format: "time", width: 80 },
      { key: "punch_in", label: "Punch In", format: "time", width: 80 },
      { key: "punch_out", label: "Punch Out", format: "time", width: 80 },
      { key: "total_login_duration", label: "Total Login Hours", format: "duration", width: 100 },
      { key: "productive_minutes", label: "Productive Minutes", format: "minutes", width: 120 },
      { key: "attendance_status", label: "Status", format: "status", width: 100 },
      { key: "late_by_minutes", label: "Late (mins)", format: "number", width: 80, align: "right" },
      { key: "attendance_source", label: "Source", format: "text", width: 80 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
  },
  {
    code: "daily-hc-shift",
    name: "Daily Headcount by Shift",
    category: "Attendance",
    subcategory: "Daily",
    description: "Scheduled vs actual headcount per shift per day",
    rowGrain: "One row per date per branch per process per shift",
    primaryKey: ["record_date", "branch_name", "process_name", "shift_name"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "shift_name", label: "Shift", format: "text", width: 120 },
      { key: "shift_start", label: "Shift Start", format: "time", width: 80 },
      { key: "shift_end", label: "Shift End", format: "time", width: 80 },
      { key: "scheduled_hc", label: "Scheduled HC", format: "number", width: 100, align: "right" },
      { key: "present_hc", label: "Present HC", format: "number", width: 100, align: "right" },
      { key: "absent_hc", label: "Absent HC", format: "number", width: 100, align: "right" },
      { key: "leave_hc", label: "Leave HC", format: "number", width: 100, align: "right" },
      { key: "attendance_pct", label: "Attendance %", format: "percentage", width: 100, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "shift-adherence-detail",
    name: "Shift Adherence Detail",
    category: "Attendance",
    subcategory: "Daily",
    description: "Detailed shift adherence with scheduled vs actual times",
    rowGrain: "One row per employee per date",
    primaryKey: ["employee_code", "record_date"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "shift_name", label: "Roster Shift", format: "text", width: 120 },
      { key: "scheduled_start", label: "Scheduled Start", format: "time", width: 100 },
      { key: "scheduled_end", label: "Scheduled End", format: "time", width: 100 },
      { key: "punch_in", label: "Punch In", format: "time", width: 80 },
      { key: "punch_out", label: "Punch Out", format: "time", width: 80 },
      { key: "total_login_duration", label: "Total Login", format: "duration", width: 100 },
      { key: "scheduled_minutes", label: "Scheduled (mins)", format: "number", width: 100, align: "right" },
      { key: "actual_minutes", label: "Actual (mins)", format: "number", width: 100, align: "right" },
      { key: "late_minutes", label: "Late (mins)", format: "number", width: 80, align: "right" },
      { key: "early_logout_minutes", label: "Early Logout (mins)", format: "number", width: 100, align: "right" },
      { key: "adherence_pct", label: "Adherence %", format: "percentage", width: 100, align: "right" },
      { key: "adherence_status", label: "Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "attendance-summary",
    name: "Monthly Attendance Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Monthly attendance summary per employee",
    rowGrain: "One row per employee per month",
    primaryKey: ["employee_code", "month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "total_days", label: "Total Days", format: "number", width: 80, align: "right" },
      { key: "present_days", label: "Present", format: "number", width: 80, align: "right" },
      { key: "absent_days", label: "Absent", format: "number", width: 80, align: "right" },
      { key: "half_days", label: "Half Day", format: "number", width: 80, align: "right" },
      { key: "leave_days", label: "Leave", format: "number", width: 80, align: "right" },
      { key: "week_off_days", label: "Week Off", format: "number", width: 80, align: "right" },
      { key: "holiday_days", label: "Holiday", format: "number", width: 80, align: "right" },
      { key: "lwp_days", label: "LWP", format: "number", width: 80, align: "right" },
      { key: "payable_days", label: "Payable Days", format: "number", width: 100, align: "right" },
      { key: "total_productive_hours", label: "Productive Hours", format: "duration", width: 120 },
      { key: "attendance_pct", label: "Attendance %", format: "percentage", width: 100, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
  },
  {
    code: "late-arrival-summary",
    name: "Late Arrival Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Employees who arrived late with details of late minutes",
    rowGrain: "One row per employee per date with late arrival",
    primaryKey: ["employee_code", "record_date"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "shift_name", label: "Shift", format: "text", width: 120 },
      { key: "shift_start", label: "Shift Start", format: "time", width: 80 },
      { key: "punch_in", label: "Punch In", format: "time", width: 80 },
      { key: "grace_minutes", label: "Grace (mins)", format: "number", width: 80, align: "right" },
      { key: "late_by_minutes", label: "Late By (mins)", format: "number", width: 100, align: "right" },
      { key: "attendance_status", label: "Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "overtime-summary",
    name: "Overtime Summary",
    category: "Attendance",
    subcategory: "Monthly",
    description: "Monthly overtime hours and pay per employee",
    rowGrain: "One row per employee with overtime in the month",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "days_attended", label: "Days Attended", format: "number", width: 100, align: "right" },
      { key: "total_worked_hours", label: "Total Worked (hrs)", format: "number", width: 120, align: "right" },
      { key: "total_scheduled_hours", label: "Scheduled (hrs)", format: "number", width: 120, align: "right" },
      { key: "overtime_hours", label: "Overtime (hrs)", format: "number", width: 100, align: "right" },
      { key: "overtime_duration", label: "Overtime", format: "duration", width: 100 },
      { key: "overtime_pay", label: "Overtime Pay", format: "currency", width: 120, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "payroll", "finance"],
    exportRoles: ["super_admin", "admin", "hr", "wfm", "payroll"],
  },
  {
    code: "regularization-summary",
    name: "Regularization Summary",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Attendance regularization requests and their approval status",
    rowGrain: "One row per regularization request",
    primaryKey: ["employee_code", "attendance_date", "submitted_at"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "attendance_date", label: "Attendance Date", format: "date", width: 100 },
      { key: "requested_status", label: "Requested Status", format: "status", width: 120 },
      { key: "reason", label: "Reason", format: "text", width: 200 },
      { key: "reason_code", label: "Reason Code", format: "text", width: 100 },
      { key: "reason_label", label: "Reason Type", format: "text", width: 160 },
      { key: "requested_by_type", label: "Requested By", format: "status", width: 100 },
      { key: "approval_status", label: "Approval Status", format: "status", width: 120 },
      { key: "submitted_at", label: "Submitted At", format: "datetime", width: 140 },
      { key: "reviewer_name", label: "Reviewed By", format: "text", width: 140 },
      { key: "approved_at", label: "Approved At", format: "datetime", width: 140 },
      { key: "reviewer_note", label: "Reviewer Note", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
  },
  {
    code: "biometric-reconciliation",
    name: "Biometric Reconciliation",
    category: "Attendance",
    subcategory: "Exceptions",
    description: "Comparison of processed attendance vs raw biometric data",
    rowGrain: "One row per employee per date",
    primaryKey: ["employee_code", "record_date"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "attendance_status", label: "Attendance Status", format: "status", width: 120 },
      { key: "processed_biometric_minutes", label: "Processed (mins)", format: "number", width: 100, align: "right" },
      { key: "processed_biometric_duration", label: "Processed Duration", format: "duration", width: 120 },
      { key: "biometric_punch_in", label: "Biometric Punch In", format: "time", width: 120 },
      { key: "biometric_punch_out", label: "Biometric Punch Out", format: "time", width: 120 },
      { key: "raw_biometric_minutes", label: "Raw Biometric (mins)", format: "number", width: 120, align: "right" },
      { key: "raw_biometric_duration", label: "Raw Duration", format: "duration", width: 100 },
      { key: "reconciliation_status", label: "Reconciliation", format: "status", width: 140 },
      { key: "reconciliation_description", label: "Description", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "daily-shrinkage-report",
    name: "Daily Shrinkage Report",
    category: "Attendance",
    subcategory: "BPO Metrics",
    description: "Daily shrinkage analysis by branch and process",
    rowGrain: "One row per date per branch per process",
    primaryKey: ["record_date", "branch_name", "process_name"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "total_scheduled", label: "Scheduled HC", format: "number", width: 100, align: "right" },
      { key: "present_hc", label: "Present HC", format: "number", width: 100, align: "right" },
      { key: "absent_hc", label: "Absent HC", format: "number", width: 100, align: "right" },
      { key: "leave_hc", label: "Leave HC", format: "number", width: 100, align: "right" },
      { key: "week_off_hc", label: "Week Off HC", format: "number", width: 100, align: "right" },
      { key: "holiday_hc", label: "Holiday HC", format: "number", width: 100, align: "right" },
      { key: "unplanned_shrinkage_hc", label: "Unplanned Shrinkage", format: "number", width: 140, align: "right" },
      { key: "total_shrinkage_pct", label: "Total Shrinkage %", format: "percentage", width: 120, align: "right" },
      { key: "unplanned_shrinkage_pct", label: "Unplanned Shrinkage %", format: "percentage", width: 150, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },
  {
    code: "punch-raw-export",
    name: "Punch Raw Data Export",
    category: "Attendance",
    subcategory: "BPO Metrics",
    description: "Raw biometric punch data with all punch details",
    rowGrain: "One row per employee per date",
    primaryKey: ["employee_code", "activity_date"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "biometric_code", label: "Biometric Code", format: "text", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "activity_date", label: "Date", format: "date", width: 100 },
      { key: "first_punch", label: "First Punch", format: "time", width: 100 },
      { key: "last_punch", label: "Last Punch", format: "time", width: 100 },
      { key: "biometric_minutes", label: "Duration (mins)", format: "number", width: 100, align: "right" },
      { key: "total_duration", label: "Total Duration", format: "duration", width: 100 },
      { key: "total_punches", label: "Punch Count", format: "number", width: 80, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // LEAVE
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "leave-balance",
    name: "Leave Balance Report",
    category: "Leave",
    subcategory: "Balance & Allocation",
    description: "Current leave balances by employee and leave type",
    rowGrain: "One row per employee per leave type",
    primaryKey: ["employee_code", "leave_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "leave_code", label: "Leave Code", format: "text", width: 80 },
      { key: "leave_name", label: "Leave Type", format: "text", width: 140 },
      { key: "allocated_days", label: "Allocated", format: "number", width: 80, align: "right" },
      { key: "used_days", label: "Used", format: "number", width: 80, align: "right" },
      { key: "adjusted_days", label: "Adjusted", format: "number", width: 80, align: "right" },
      { key: "remaining_days", label: "Remaining", format: "number", width: 80, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager", "branch_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },
  {
    code: "leave-utilization",
    name: "Leave Utilization Report",
    category: "Leave",
    subcategory: "Utilization & Trends",
    description: "Leave requests and their status",
    rowGrain: "One row per leave request",
    primaryKey: ["employee_code", "from_date", "leave_code"],
    columns: [
      { key: "from_date", label: "From Date", format: "date", width: 100 },
      { key: "to_date", label: "To Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "leave_code", label: "Leave Code", format: "text", width: 80 },
      { key: "leave_name", label: "Leave Type", format: "text", width: 140 },
      { key: "total_days", label: "Days", format: "number", width: 60, align: "right" },
      { key: "status", label: "Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager", "branch_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // PAYROLL
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "payroll-register",
    name: "Salary Register",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Complete salary register with all components and deductions",
    rowGrain: "One row per employee per payroll month",
    primaryKey: ["employee_code", "payroll_month"],
    columns: [
      { key: "payroll_month", label: "Payroll Month", format: "text", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "date_of_joining", label: "DOJ", format: "date", width: 100 },
      { key: "basic_pay", label: "Basic", format: "currency", width: 100, align: "right" },
      { key: "hra", label: "HRA", format: "currency", width: 100, align: "right" },
      { key: "conveyance", label: "Conveyance", format: "currency", width: 100, align: "right" },
      { key: "special_allowance", label: "Special Allowance", format: "currency", width: 120, align: "right" },
      { key: "other_allowance", label: "Other Allowance", format: "currency", width: 120, align: "right" },
      { key: "gross_salary", label: "Gross Salary", format: "currency", width: 120, align: "right" },
      { key: "pf_employee", label: "PF (Employee)", format: "currency", width: 100, align: "right" },
      { key: "pf_employer", label: "PF (Employer)", format: "currency", width: 100, align: "right" },
      { key: "esic_employee", label: "ESIC (Employee)", format: "currency", width: 100, align: "right" },
      { key: "esic_employer", label: "ESIC (Employer)", format: "currency", width: 100, align: "right" },
      { key: "professional_tax", label: "PT", format: "currency", width: 80, align: "right" },
      { key: "tds", label: "TDS", format: "currency", width: 100, align: "right" },
      { key: "lwp_deduction", label: "LWP Deduction", format: "currency", width: 120, align: "right" },
      { key: "other_deduction", label: "Other Deduction", format: "currency", width: 120, align: "right" },
      { key: "total_deductions", label: "Total Deductions", format: "currency", width: 120, align: "right" },
      { key: "net_pay", label: "Net Pay", format: "currency", width: 120, align: "right" },
      { key: "payable_days", label: "Payable Days", format: "number", width: 80, align: "right" },
      { key: "lwp_days", label: "LWP Days", format: "number", width: 80, align: "right" },
      { key: "bank_name", label: "Bank Name", format: "text", width: 140 },
      { key: "bank_account", label: "Bank A/C", format: "masked", width: 140, sensitive: true },
      { key: "ifsc_code", label: "IFSC", format: "text", width: 100 },
      { key: "pan_number", label: "PAN", format: "masked", width: 100, sensitive: true },
      { key: "uan", label: "UAN", format: "text", width: 120 },
    ],
    viewRoles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
  {
    code: "payroll-variance",
    name: "Payroll Variance Report",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Month-over-month payroll variance analysis",
    rowGrain: "One row per employee comparing current vs previous month",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "current_month", label: "Current Month", format: "text", width: 100 },
      { key: "current_gross", label: "Current Gross", format: "currency", width: 120, align: "right" },
      { key: "current_net", label: "Current Net", format: "currency", width: 120, align: "right" },
      { key: "current_days", label: "Current Days", format: "number", width: 80, align: "right" },
      { key: "prev_month", label: "Previous Month", format: "text", width: 100 },
      { key: "prev_gross", label: "Previous Gross", format: "currency", width: 120, align: "right" },
      { key: "prev_net", label: "Previous Net", format: "currency", width: 120, align: "right" },
      { key: "prev_days", label: "Previous Days", format: "number", width: 80, align: "right" },
      { key: "gross_variance", label: "Gross Variance", format: "currency", width: 120, align: "right" },
      { key: "net_variance", label: "Net Variance", format: "currency", width: 120, align: "right" },
      { key: "variance_pct", label: "Variance %", format: "percentage", width: 100, align: "right" },
      { key: "variance_reason", label: "Variance Reason", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
  {
    code: "bank-advice",
    name: "Bank Advice / Transfer Sheet",
    category: "Payroll",
    subcategory: "Monthly Processing",
    description: "Bank transfer file for salary disbursement",
    rowGrain: "One row per employee per payroll month",
    primaryKey: ["employee_code", "payroll_month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "bank_name", label: "Bank Name", format: "text", width: 140 },
      { key: "branch_name", label: "Bank Branch", format: "text", width: 140 },
      { key: "account_number", label: "Account Number", format: "masked", width: 160, sensitive: true },
      { key: "ifsc_code", label: "IFSC Code", format: "text", width: 100 },
      { key: "net_pay", label: "Net Amount", format: "currency", width: 120, align: "right" },
      { key: "payment_mode", label: "Payment Mode", format: "text", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // STATUTORY
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "pf-contribution-register",
    name: "PF Contribution Register",
    category: "Statutory",
    subcategory: "PF/EPF",
    description: "Monthly PF contributions (employee + employer)",
    rowGrain: "One row per employee per payroll month",
    primaryKey: ["employee_code", "payroll_month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "uan", label: "UAN", format: "text", width: 120 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "pf_basic", label: "PF Basic", format: "currency", width: 100, align: "right" },
      { key: "pf_employee", label: "Employee PF", format: "currency", width: 100, align: "right" },
      { key: "pf_employer", label: "Employer PF", format: "currency", width: 100, align: "right" },
      { key: "eps_contribution", label: "EPS", format: "currency", width: 100, align: "right" },
      { key: "edli", label: "EDLI", format: "currency", width: 80, align: "right" },
      { key: "admin_charges", label: "Admin Charges", format: "currency", width: 100, align: "right" },
      { key: "total_contribution", label: "Total", format: "currency", width: 100, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
  {
    code: "esic-contribution-register",
    name: "ESIC Contribution Register",
    category: "Statutory",
    subcategory: "ESIC",
    description: "Monthly ESIC contributions",
    rowGrain: "One row per employee per payroll month",
    primaryKey: ["employee_code", "payroll_month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "esic_number", label: "ESIC Number", format: "text", width: 140 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "gross_wages", label: "Gross Wages", format: "currency", width: 100, align: "right" },
      { key: "esic_employee", label: "Employee ESIC", format: "currency", width: 100, align: "right" },
      { key: "esic_employer", label: "Employer ESIC", format: "currency", width: 100, align: "right" },
      { key: "total_esic", label: "Total ESIC", format: "currency", width: 100, align: "right" },
      { key: "ip_days", label: "IP Days", format: "number", width: 80, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
  {
    code: "pt-register",
    name: "Professional Tax Register",
    category: "Statutory",
    subcategory: "Professional Tax",
    description: "Monthly professional tax deductions by state",
    rowGrain: "One row per employee per payroll month",
    primaryKey: ["employee_code", "payroll_month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "state", label: "State", format: "text", width: 120 },
      { key: "gross_salary", label: "Gross Salary", format: "currency", width: 100, align: "right" },
      { key: "pt_amount", label: "PT Amount", format: "currency", width: 100, align: "right" },
      { key: "pt_slab", label: "PT Slab", format: "text", width: 120 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // EXIT & SEPARATION
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "resignation-register",
    name: "Resignation Register",
    category: "Exit & Separation",
    subcategory: "Resignation",
    description: "Active resignation requests and their status",
    rowGrain: "One row per resignation request",
    primaryKey: ["employee_code", "resignation_date"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "date_of_joining", label: "DOJ", format: "date", width: 100 },
      { key: "resignation_date", label: "Resignation Date", format: "date", width: 100 },
      { key: "last_working_date", label: "LWD", format: "date", width: 100 },
      { key: "notice_period_days", label: "Notice Period", format: "number", width: 100, align: "right" },
      { key: "notice_served_days", label: "Notice Served", format: "number", width: 100, align: "right" },
      { key: "shortfall_days", label: "Shortfall Days", format: "number", width: 100, align: "right" },
      { key: "resignation_reason", label: "Reason", format: "text", width: 160 },
      { key: "status", label: "Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },
  {
    code: "fnf-settlement-register",
    name: "F&F Settlement Register",
    category: "Exit & Separation",
    subcategory: "Full & Final",
    description: "Completed F&F settlements with payment details",
    rowGrain: "One row per F&F settlement",
    primaryKey: ["employee_code", "settlement_date"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "last_working_date", label: "LWD", format: "date", width: 100 },
      { key: "settlement_date", label: "Settlement Date", format: "date", width: 100 },
      { key: "pending_salary", label: "Pending Salary", format: "currency", width: 120, align: "right" },
      { key: "leave_encashment", label: "Leave Encashment", format: "currency", width: 120, align: "right" },
      { key: "gratuity", label: "Gratuity", format: "currency", width: 100, align: "right" },
      { key: "total_earnings", label: "Total Earnings", format: "currency", width: 120, align: "right" },
      { key: "notice_recovery", label: "Notice Recovery", format: "currency", width: 120, align: "right" },
      { key: "total_deductions", label: "Total Deductions", format: "currency", width: 120, align: "right" },
      { key: "net_payable", label: "Net Payable", format: "currency", width: 120, align: "right" },
      { key: "payment_status", label: "Payment Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr_head", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "hr_head", "finance", "payroll"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ATTRITION & TRENDS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "monthly-attrition-summary",
    name: "Monthly Attrition Summary",
    category: "Attrition & Trends",
    subcategory: "Attrition",
    description: "Monthly attrition metrics by branch and process",
    rowGrain: "One row per month per branch per process",
    primaryKey: ["month", "branch_name", "process_name"],
    columns: [
      { key: "month", label: "Month", format: "text", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "opening_hc", label: "Opening HC", format: "number", width: 100, align: "right" },
      { key: "joiners", label: "Joiners", format: "number", width: 80, align: "right" },
      { key: "exits", label: "Exits", format: "number", width: 80, align: "right" },
      { key: "closing_hc", label: "Closing HC", format: "number", width: 100, align: "right" },
      { key: "attrition_pct", label: "Attrition %", format: "percentage", width: 100, align: "right" },
      { key: "avg_hc", label: "Avg HC", format: "number", width: 80, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll", "wfm", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // RECRUITMENT
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "recruitment-pipeline",
    name: "Recruitment Pipeline Report",
    category: "Recruitment",
    subcategory: "Pipeline",
    description: "Current candidates by stage in recruitment funnel",
    rowGrain: "One row per stage per job requisition",
    primaryKey: ["job_id", "stage"],
    columns: [
      { key: "job_title", label: "Job Title", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "stage", label: "Stage", format: "status", width: 140 },
      { key: "candidate_count", label: "Candidates", format: "number", width: 100, align: "right" },
      { key: "avg_days_in_stage", label: "Avg Days in Stage", format: "number", width: 120, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head"],
  },
  {
    code: "candidate-tracker",
    name: "Candidate Tracker",
    category: "Recruitment",
    subcategory: "Pipeline",
    description: "Detailed candidate tracking with interview history",
    rowGrain: "One row per candidate",
    primaryKey: ["candidate_id"],
    columns: [
      { key: "candidate_id", label: "Candidate ID", format: "text", width: 100 },
      { key: "candidate_name", label: "Candidate Name", format: "text", width: 180 },
      { key: "mobile", label: "Mobile", format: "phone", width: 120 },
      { key: "email", label: "Email", format: "email", width: 180 },
      { key: "job_title", label: "Applied For", format: "text", width: 160 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "current_stage", label: "Current Stage", format: "status", width: 140 },
      { key: "source", label: "Source", format: "text", width: 120 },
      { key: "applied_date", label: "Applied Date", format: "date", width: 100 },
      { key: "last_activity", label: "Last Activity", format: "datetime", width: 140 },
      { key: "recruiter", label: "Recruiter", format: "text", width: 140 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // OPERATIONS & QUALITY
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "agent-performance-summary",
    name: "Agent Performance Summary",
    category: "Operations & Quality",
    subcategory: "Performance",
    description: "Individual agent KPI performance",
    rowGrain: "One row per agent per month",
    primaryKey: ["employee_code", "month"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Agent Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "team_leader", label: "Team Leader", format: "text", width: 140 },
      { key: "calls_handled", label: "Calls Handled", format: "number", width: 100, align: "right" },
      { key: "aht_seconds", label: "AHT (sec)", format: "number", width: 80, align: "right" },
      { key: "aht_formatted", label: "AHT", format: "duration", width: 80 },
      { key: "quality_score", label: "Quality %", format: "percentage", width: 80, align: "right" },
      { key: "csat_score", label: "CSAT %", format: "percentage", width: 80, align: "right" },
      { key: "fcr_rate", label: "FCR %", format: "percentage", width: 80, align: "right" },
      { key: "adherence_pct", label: "Adherence %", format: "percentage", width: 100, align: "right" },
      { key: "attendance_pct", label: "Attendance %", format: "percentage", width: 100, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "operations", "quality", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "operations", "quality"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // WFM & ROSTER
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "roster-published",
    name: "Published Roster Report",
    category: "WFM & Roster",
    subcategory: "Roster",
    description: "Published roster assignments for the week/month",
    rowGrain: "One row per employee per date",
    primaryKey: ["employee_code", "roster_date"],
    columns: [
      { key: "roster_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "shift_name", label: "Shift", format: "text", width: 120 },
      { key: "shift_start", label: "Shift Start", format: "time", width: 80 },
      { key: "shift_end", label: "Shift End", format: "time", width: 80 },
      { key: "week_off", label: "Week Off", format: "boolean", width: 80 },
      { key: "roster_status", label: "Roster Status", format: "status", width: 100 },
      { key: "acknowledgement_status", label: "Acknowledged", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // ASSETS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "asset-inventory",
    name: "Asset Inventory Report",
    category: "Assets",
    subcategory: "Inventory",
    description: "Complete asset inventory with status",
    rowGrain: "One row per asset",
    primaryKey: ["asset_code"],
    columns: [
      { key: "asset_code", label: "Asset Code", format: "text", width: 120 },
      { key: "asset_name", label: "Asset Name", format: "text", width: 180 },
      { key: "asset_category", label: "Category", format: "text", width: 120 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "purchase_date", label: "Purchase Date", format: "date", width: 100 },
      { key: "purchase_value", label: "Purchase Value", format: "currency", width: 120, align: "right" },
      { key: "current_value", label: "Current Value", format: "currency", width: 120, align: "right" },
      { key: "asset_status", label: "Status", format: "status", width: 100 },
      { key: "assigned_to", label: "Assigned To", format: "text", width: 180 },
      { key: "location", label: "Location", format: "text", width: 140 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "it", "admin_ops"],
    exportRoles: ["super_admin", "admin", "hr"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // TRAINING
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "training-completion-status",
    name: "Training Completion Status",
    category: "Training",
    subcategory: "Completion",
    description: "Training/course completion status by employee",
    rowGrain: "One row per employee per course",
    primaryKey: ["employee_code", "course_id"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "course_name", label: "Course Name", format: "text", width: 200 },
      { key: "course_type", label: "Course Type", format: "text", width: 120 },
      { key: "assigned_date", label: "Assigned Date", format: "date", width: 100 },
      { key: "due_date", label: "Due Date", format: "date", width: 100 },
      { key: "completion_date", label: "Completed Date", format: "date", width: 100 },
      { key: "completion_status", label: "Status", format: "status", width: 100 },
      { key: "score", label: "Score", format: "percentage", width: 80, align: "right" },
      { key: "attempts", label: "Attempts", format: "number", width: 80, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager", "branch_head", "trainer"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // DOCUMENTS
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "document-expiry-tracker",
    name: "Document Expiry Tracker",
    category: "Documents",
    subcategory: "Compliance",
    description: "Employee documents with upcoming expiry",
    rowGrain: "One row per employee per document type",
    primaryKey: ["employee_code", "document_type"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "document_type", label: "Document Type", format: "text", width: 140 },
      { key: "document_number", label: "Document Number", format: "masked", width: 140, sensitive: true },
      { key: "issue_date", label: "Issue Date", format: "date", width: 100 },
      { key: "expiry_date", label: "Expiry Date", format: "date", width: 100 },
      { key: "days_to_expiry", label: "Days to Expiry", format: "number", width: 100, align: "right" },
      { key: "status", label: "Status", format: "status", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
  },

  // ═══════════════════════════════════════════════════════════════════════════════
  // IDENTITY
  // ═══════════════════════════════════════════════════════════════════════════════
  {
    code: "uan-status-report",
    name: "UAN Status Report",
    category: "Identity",
    subcategory: "PF/UAN",
    description: "UAN registration and linking status",
    rowGrain: "One row per employee",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "uan", label: "UAN", format: "text", width: 120 },
      { key: "uan_status", label: "UAN Status", format: "status", width: 100 },
      { key: "pf_number", label: "PF Number", format: "text", width: 140 },
      { key: "kyc_status", label: "KYC Status", format: "status", width: 100 },
      { key: "bank_linked", label: "Bank Linked", format: "boolean", width: 100 },
      { key: "aadhaar_linked", label: "Aadhaar Linked", format: "boolean", width: 100 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "finance", "payroll"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
  },
];

// ─── Helper Functions ──────────────────────────────────────────────────────────

export function getReportMeta(code: string): ReportMeta | undefined {
  return REPORT_CATALOG.find(r => r.code === code);
}

export function getReportsByCategory(category: string): ReportMeta[] {
  return REPORT_CATALOG.filter(r => r.category === category);
}

export function getReportCategories(): string[] {
  return [...new Set(REPORT_CATALOG.map(r => r.category))];
}

export function getCatalogForRole(roles: string[]): ReportMeta[] {
  return REPORT_CATALOG.filter(r =>
    r.viewRoles.some(vr => roles.includes(vr))
  );
}

export function canExportReport(code: string, roles: string[]): boolean {
  const report = getReportMeta(code);
  if (!report) return false;
  return report.exportRoles.some(er => roles.includes(er));
}

export function detectDuplicates(
  rows: Record<string, unknown>[],
  primaryKey: string[]
): { hasDuplicates: boolean; duplicateCount: number; duplicateKeys: string[] } {
  const seen = new Set<string>();
  const duplicateKeys: string[] = [];

  for (const row of rows) {
    const keyValue = primaryKey.map(k => String(row[k] ?? "")).join("|");
    if (seen.has(keyValue)) {
      duplicateKeys.push(keyValue);
    } else {
      seen.add(keyValue);
    }
  }

  return {
    hasDuplicates: duplicateKeys.length > 0,
    duplicateCount: duplicateKeys.length,
    duplicateKeys: duplicateKeys.slice(0, 10),
  };
}
