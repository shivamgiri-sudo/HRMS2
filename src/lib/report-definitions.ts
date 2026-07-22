/**
 * Report Definitions — Source-of-Truth Configuration
 *
 * Every report must define:
 * - Column schema with display labels, order, format, and masking
 * - Row grain (what constitutes one unique row)
 * - RBAC roles that can view/export
 * - Source tables and calculation notes
 */

// ─── Column Format Types ───────────────────────────────────────────────────────

export type ColumnFormat =
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "datetime"
  | "time"
  | "duration"     // HH:mm:ss
  | "minutes"      // converts to HH:mm
  | "boolean"
  | "status"
  | "masked";      // sensitive data

export interface ColumnDef {
  key: string;              // Database column name
  label: string;            // Display label
  format: ColumnFormat;
  width?: number;           // Suggested width in px
  align?: "left" | "center" | "right";
  maskRoles?: string[];     // Roles that see masked value (e.g., PAN shows as XXXX1234)
  hideInExport?: boolean;   // Exclude from XLSX
  aggregate?: "sum" | "avg" | "count" | "max" | "min";
  description?: string;     // Tooltip/help text
}

export interface ReportDefinition {
  code: string;
  name: string;
  category: string;
  subcategory: string;

  // Row grain definition
  rowGrain: string;         // e.g., "One row per employee per date"
  primaryKey: string[];     // Columns that form unique key, e.g., ["employee_code", "record_date"]

  // Column schema
  columns: ColumnDef[];

  // RBAC
  viewRoles: string[];      // Roles that can view this report
  exportRoles: string[];    // Roles that can export (subset of viewRoles)
  sensitiveFields?: string[]; // Fields that require extra authorization

  // Data source documentation
  sourceTables: string[];
  calculationNotes?: string;

  // Behavior
  maxExportRows?: number;   // Default unlimited
  requiresDateRange?: boolean;
  requiresMonth?: boolean;
}

// ─── Format Helpers ────────────────────────────────────────────────────────────

export function formatValue(value: unknown, format: ColumnFormat): string {
  if (value == null || value === "") return "—";

  switch (format) {
    case "currency":
      return `₹${Number(value).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

    case "percentage":
      return `${Number(value).toFixed(2)}%`;

    case "number":
      return Number(value).toLocaleString("en-IN");

    case "date":
      if (typeof value === "string" && value.includes("T")) {
        return new Date(value).toLocaleDateString("en-IN");
      }
      return String(value);

    case "datetime":
      return new Date(String(value)).toLocaleString("en-IN");

    case "time":
      // Handles HH:mm:ss or ISO datetime
      if (typeof value === "string") {
        if (value.includes("T")) {
          return new Date(value).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" });
        }
        return value;
      }
      return String(value);

    case "duration":
      // Already in HH:mm:ss format
      return String(value);

    case "minutes":
      // Convert minutes to HH:mm
      const mins = Number(value);
      if (isNaN(mins)) return String(value);
      const h = Math.floor(mins / 60);
      const m = mins % 60;
      return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}`;

    case "boolean":
      return value === true || value === 1 || value === "1" || value === "true" ? "Yes" : "No";

    case "status":
      // Capitalize and replace underscores
      return String(value).replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());

    case "masked":
      // Show last 4 characters
      const str = String(value);
      if (str.length <= 4) return "****";
      return "****" + str.slice(-4);

    default:
      return String(value);
  }
}

// ─── Report Definitions ────────────────────────────────────────────────────────

export const REPORT_DEFINITIONS: Record<string, ReportDefinition> = {
  "attendance-daily": {
    code: "attendance-daily",
    name: "Daily Attendance Report",
    category: "Attendance",
    subcategory: "Daily",
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
      { key: "productive_minutes", label: "Productive Minutes", format: "minutes", width: 100, description: "Approved work time after deductions" },
      { key: "attendance_status", label: "Status", format: "status", width: 100 },
      { key: "late_by_minutes", label: "Late (mins)", format: "number", width: 80, align: "right" },
      { key: "attendance_source", label: "Source", format: "text", width: 80 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager", "branch_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    sourceTables: ["attendance_daily_record", "wfm_attendance_session", "wfm_roster_assignment", "wfm_shift_master", "employees"],
    calculationNotes: "Punch times from wfm_attendance_session. Status from attendance_daily_record after regularization.",
    requiresDateRange: true,
  },

  "payroll-register": {
    code: "payroll-register",
    name: "Salary Register",
    category: "Payroll",
    subcategory: "Monthly Processing",
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
      { key: "basic_pay", label: "Basic", format: "currency", width: 100, align: "right" },
      { key: "hra", label: "HRA", format: "currency", width: 100, align: "right" },
      { key: "conveyance", label: "Conveyance", format: "currency", width: 100, align: "right" },
      { key: "special_allowance", label: "Special Allowance", format: "currency", width: 120, align: "right" },
      { key: "gross_salary", label: "Gross Salary", format: "currency", width: 120, align: "right" },
      { key: "pf_employee", label: "PF (Employee)", format: "currency", width: 100, align: "right" },
      { key: "esic_employee", label: "ESIC (Employee)", format: "currency", width: 100, align: "right" },
      { key: "professional_tax", label: "PT", format: "currency", width: 80, align: "right" },
      { key: "tds", label: "TDS", format: "currency", width: 100, align: "right" },
      { key: "lwp_deduction", label: "LWP Deduction", format: "currency", width: 100, align: "right" },
      { key: "total_deductions", label: "Total Deductions", format: "currency", width: 120, align: "right" },
      { key: "net_pay", label: "Net Pay", format: "currency", width: 120, align: "right" },
      { key: "payable_days", label: "Payable Days", format: "number", width: 80, align: "right" },
      { key: "lwp_days", label: "LWP Days", format: "number", width: 80, align: "right" },
      { key: "bank_account", label: "Bank A/C", format: "masked", width: 120, maskRoles: ["employee", "manager"] },
      { key: "pan_number", label: "PAN", format: "masked", width: 100, maskRoles: ["employee", "manager", "hr"] },
    ],
    viewRoles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
    sensitiveFields: ["bank_account", "pan_number", "net_pay", "gross_salary"],
    sourceTables: ["salary_prep_line", "salary_prep_run", "salary_prep_line_component", "employees"],
    calculationNotes: "Uses finalized payroll run. Components aggregated to employee level before display.",
    requiresMonth: true,
  },

  "biometric-reconciliation": {
    code: "biometric-reconciliation",
    name: "Biometric Reconciliation Report",
    category: "Attendance",
    subcategory: "Exceptions",
    rowGrain: "One row per employee per date",
    primaryKey: ["employee_code", "record_date"],
    columns: [
      { key: "record_date", label: "Date", format: "date", width: 100 },
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "attendance_status", label: "Attendance Status", format: "status", width: 120 },
      { key: "processed_biometric_minutes", label: "Processed Biometric (mins)", format: "number", width: 120, align: "right" },
      { key: "processed_biometric_duration", label: "Processed Biometric", format: "duration", width: 100 },
      { key: "biometric_punch_in", label: "Biometric Punch In", format: "time", width: 100 },
      { key: "biometric_punch_out", label: "Biometric Punch Out", format: "time", width: 100 },
      { key: "raw_biometric_minutes", label: "Raw Biometric (mins)", format: "number", width: 100, align: "right" },
      { key: "raw_biometric_duration", label: "Raw Biometric", format: "duration", width: 100 },
      { key: "reconciliation_status", label: "Reconciliation Status", format: "status", width: 140 },
      { key: "reconciliation_description", label: "Description", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_daily_record", "integration_biometric_daily", "employees"],
    calculationNotes: "Compares processed attendance with raw biometric imports to identify discrepancies.",
    requiresDateRange: true,
  },

  "regularization-summary": {
    code: "regularization-summary",
    name: "Regularization Summary",
    category: "Attendance",
    subcategory: "Exceptions",
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
      { key: "approval_status", label: "Approval Status", format: "status", width: 100 },
      { key: "submitted_at", label: "Submitted At", format: "datetime", width: 140 },
      { key: "reviewer_name", label: "Reviewed By", format: "text", width: 140 },
      { key: "approved_at", label: "Approved At", format: "datetime", width: 140 },
      { key: "reviewer_note", label: "Reviewer Note", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    sourceTables: ["attendance_regularization", "attendance_reason_master", "employees"],
    requiresMonth: true,
  },

  "daily-shrinkage-report": {
    code: "daily-shrinkage-report",
    name: "Daily Shrinkage Report",
    category: "Attendance",
    subcategory: "BPO Metrics",
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
      { key: "unplanned_shrinkage_hc", label: "Unplanned Shrinkage", format: "number", width: 120, align: "right" },
      { key: "total_shrinkage_pct", label: "Total Shrinkage %", format: "percentage", width: 120, align: "right" },
      { key: "unplanned_shrinkage_pct", label: "Unplanned Shrinkage %", format: "percentage", width: 140, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_daily_record", "employees"],
    calculationNotes: "Total Shrinkage = (Scheduled - Present) / Scheduled. Unplanned = Absent only (excludes approved leave, WO, holiday).",
    requiresDateRange: true,
  },

  "overtime-summary": {
    code: "overtime-summary",
    name: "Overtime Summary",
    category: "Attendance",
    subcategory: "Monthly",
    rowGrain: "One row per employee per month",
    primaryKey: ["employee_code", "month"],
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
    sourceTables: ["attendance_daily_record", "attendance_rule_config", "wfm_roster_assignment", "wfm_shift_master", "salary_prep_line"],
    calculationNotes: "Overtime = Worked hours - Scheduled shift hours. Only includes days with positive overtime.",
    requiresMonth: true,
  },

  "punch-raw-export": {
    code: "punch-raw-export",
    name: "Punch Raw Data Export",
    category: "Attendance",
    subcategory: "BPO Metrics",
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
    sourceTables: ["integration_biometric_daily", "employees"],
    requiresDateRange: true,
  },
};

// ─── Get Definition ────────────────────────────────────────────────────────────

export function getReportDefinition(code: string): ReportDefinition | null {
  return REPORT_DEFINITIONS[code] ?? null;
}

// ─── Check Role Access ─────────────────────────────────────────────────────────

export function canViewReport(code: string, userRoles: string[]): boolean {
  const def = REPORT_DEFINITIONS[code];
  if (!def) return true; // Allow unknown reports (legacy)
  return def.viewRoles.some(r => userRoles.includes(r));
}

export function canExportReport(code: string, userRoles: string[]): boolean {
  const def = REPORT_DEFINITIONS[code];
  if (!def) return true;
  return def.exportRoles.some(r => userRoles.includes(r));
}
