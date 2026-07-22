/**
 * Report Definitions — Backend Source of Truth
 *
 * Every report must define:
 * - Column schema with labels, formats, order
 * - Row grain (unique key)
 * - RBAC roles for view/export
 * - Source tables
 * - Calculation notes
 */

export type ColumnFormat =
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "datetime"
  | "time"
  | "duration"
  | "minutes"
  | "boolean"
  | "status"
  | "masked";

export interface ColumnDef {
  key: string;
  label: string;
  format: ColumnFormat;
  align?: "left" | "center" | "right";
  width?: number;
  sensitive?: boolean;
}

export interface ReportDefinition {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  rowGrain: string;
  primaryKey: string[];
  columns: ColumnDef[];
  viewRoles: string[];
  exportRoles: string[];
  sourceTables: string[];
  calculationNotes?: string;
  branchScoped?: boolean;
  processScoped?: boolean;
}

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
      { key: "productive_minutes", label: "Productive Minutes", format: "minutes", width: 100 },
      { key: "attendance_status", label: "Status", format: "status", width: 100 },
      { key: "late_by_minutes", label: "Late (mins)", format: "number", width: 80, align: "right" },
      { key: "attendance_source", label: "Source", format: "text", width: 80 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager", "branch_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    sourceTables: ["attendance_daily_record", "wfm_attendance_session", "wfm_roster_assignment", "wfm_shift_master", "employees"],
    calculationNotes: "Punch times from wfm_attendance_session. Status from attendance_daily_record after regularization.",
    branchScoped: true,
    processScoped: true,
  },

  "daily-hc-shift": {
    code: "daily-hc-shift",
    name: "Daily Headcount by Shift",
    category: "Attendance",
    subcategory: "Daily",
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
    sourceTables: ["attendance_daily_record", "wfm_roster_assignment", "wfm_shift_master", "employees"],
    branchScoped: true,
    processScoped: true,
  },

  "shift-adherence-detail": {
    code: "shift-adherence-detail",
    name: "Shift Adherence Detail",
    category: "Attendance",
    subcategory: "Daily",
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
    sourceTables: ["attendance_daily_record", "wfm_attendance_session", "wfm_roster_assignment", "wfm_shift_master"],
    calculationNotes: "Adherence % = (Actual minutes worked within shift / Scheduled minutes) * 100",
    branchScoped: true,
    processScoped: true,
  },

  "late-arrival-summary": {
    code: "late-arrival-summary",
    name: "Late Arrival Summary",
    category: "Attendance",
    subcategory: "Monthly",
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
    sourceTables: ["attendance_daily_record", "wfm_attendance_session", "wfm_roster_assignment", "wfm_shift_master", "attendance_rule_config"],
    branchScoped: true,
    processScoped: true,
  },

  "overtime-summary": {
    code: "overtime-summary",
    name: "Overtime Summary",
    category: "Attendance",
    subcategory: "Monthly",
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
    sourceTables: ["attendance_daily_record", "attendance_rule_config", "wfm_roster_assignment", "wfm_shift_master", "salary_prep_line"],
    calculationNotes: "Overtime = Total worked hours - Scheduled shift hours. Only employees with positive overtime included.",
    branchScoped: true,
    processScoped: true,
  },

  "biometric-reconciliation": {
    code: "biometric-reconciliation",
    name: "Biometric Reconciliation",
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
    sourceTables: ["attendance_daily_record", "integration_biometric_daily", "employees"],
    calculationNotes: "Compares processed attendance with raw biometric imports to identify discrepancies.",
    branchScoped: true,
    processScoped: true,
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
      { key: "approval_status", label: "Approval Status", format: "status", width: 120 },
      { key: "submitted_at", label: "Submitted At", format: "datetime", width: 140 },
      { key: "reviewer_name", label: "Reviewed By", format: "text", width: 140 },
      { key: "approved_at", label: "Approved At", format: "datetime", width: 140 },
      { key: "reviewer_note", label: "Reviewer Note", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    sourceTables: ["attendance_regularization", "attendance_reason_master", "employees"],
    branchScoped: true,
    processScoped: true,
  },

  "attendance-dispute-summary": {
    code: "attendance-dispute-summary",
    name: "Attendance Dispute Summary",
    category: "Attendance",
    subcategory: "Exceptions",
    rowGrain: "One row per dispute request",
    primaryKey: ["employee_code", "dispute_date", "submitted_at"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "dispute_date", label: "Dispute Date", format: "date", width: 100 },
      { key: "dispute_type", label: "Dispute Type", format: "status", width: 140 },
      { key: "description", label: "Description", format: "text", width: 200 },
      { key: "old_status", label: "Original Status", format: "status", width: 120 },
      { key: "requested_status", label: "Requested Status", format: "status", width: 120 },
      { key: "original_punch_in", label: "Original Punch In", format: "time", width: 100 },
      { key: "original_punch_out", label: "Original Punch Out", format: "time", width: 100 },
      { key: "requested_punch_in", label: "Requested Punch In", format: "time", width: 100 },
      { key: "requested_punch_out", label: "Requested Punch Out", format: "time", width: 100 },
      { key: "payroll_impact", label: "Payroll Impact", format: "boolean", width: 100 },
      { key: "approval_status", label: "Approval Status", format: "status", width: 120 },
      { key: "submitted_at", label: "Submitted At", format: "datetime", width: 140 },
      { key: "reviewer_name", label: "Reviewed By", format: "text", width: 140 },
      { key: "reviewed_at", label: "Reviewed At", format: "datetime", width: 140 },
      { key: "resolution", label: "Resolution", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_regularization", "attendance_reason_master", "employees"],
    calculationNotes: "Disputes are regularizations where dispute_type IS NOT NULL",
    branchScoped: true,
    processScoped: true,
  },

  "habitual-absentee-list": {
    code: "habitual-absentee-list",
    name: "Habitual Absentee / Late List",
    category: "Attendance",
    subcategory: "Exceptions",
    rowGrain: "One row per employee meeting threshold",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "designation_name", label: "Designation", format: "text", width: 140 },
      { key: "absent_days", label: "Absent Days", format: "number", width: 100, align: "right" },
      { key: "late_days", label: "Late Days", format: "number", width: 100, align: "right" },
      { key: "lwp_days", label: "LWP Days", format: "number", width: 100, align: "right" },
      { key: "total_working_days", label: "Working Days", format: "number", width: 100, align: "right" },
      { key: "absent_pct", label: "Absent %", format: "percentage", width: 100, align: "right" },
      { key: "absent_dates", label: "Absent Dates (Day)", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_daily_record", "employees"],
    branchScoped: true,
    processScoped: true,
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
      { key: "unplanned_shrinkage_hc", label: "Unplanned Shrinkage", format: "number", width: 140, align: "right" },
      { key: "total_shrinkage_pct", label: "Total Shrinkage %", format: "percentage", width: 120, align: "right" },
      { key: "unplanned_shrinkage_pct", label: "Unplanned Shrinkage %", format: "percentage", width: 140, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_daily_record", "employees"],
    calculationNotes: "Total Shrinkage = (Scheduled - Present) / Scheduled. Unplanned = Absent only (excludes leave, WO, holiday).",
    branchScoped: true,
    processScoped: true,
  },

  "monthly-shrinkage-trend": {
    code: "monthly-shrinkage-trend",
    name: "Monthly Shrinkage Trend",
    category: "Attendance",
    subcategory: "BPO Metrics",
    rowGrain: "One row per month per branch per process",
    primaryKey: ["month", "branch_name", "process_name"],
    columns: [
      { key: "month", label: "Month", format: "text", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "working_days", label: "Working Days", format: "number", width: 100, align: "right" },
      { key: "total_employee_days", label: "Employee-Days", format: "number", width: 120, align: "right" },
      { key: "present_days", label: "Present Days", format: "number", width: 100, align: "right" },
      { key: "absent_days", label: "Absent Days", format: "number", width: 100, align: "right" },
      { key: "leave_days", label: "Leave Days", format: "number", width: 100, align: "right" },
      { key: "total_shrinkage_pct", label: "Total Shrinkage %", format: "percentage", width: 120, align: "right" },
      { key: "unplanned_shrinkage_pct", label: "Unplanned Shrinkage %", format: "percentage", width: 140, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "wfm", "manager", "process_manager", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "wfm"],
    sourceTables: ["attendance_daily_record", "employees"],
    branchScoped: true,
    processScoped: true,
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
    branchScoped: true,
    processScoped: true,
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
    sourceTables: ["salary_prep_line", "salary_prep_run", "salary_prep_line_component", "employees"],
    calculationNotes: "Uses finalized payroll run. Components aggregated to employee level.",
    branchScoped: true,
    processScoped: true,
  },

  "payroll-variance": {
    code: "payroll-variance",
    name: "Payroll Variance Report",
    category: "Payroll",
    subcategory: "Monthly Processing",
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
      { key: "gross_variance_pct", label: "Gross Var %", format: "percentage", width: 100, align: "right" },
      { key: "net_variance", label: "Net Variance", format: "currency", width: 120, align: "right" },
      { key: "net_variance_pct", label: "Net Var %", format: "percentage", width: 100, align: "right" },
      { key: "variance_reason", label: "Variance Reason", format: "text", width: 200 },
    ],
    viewRoles: ["super_admin", "admin", "finance", "payroll", "hr_head"],
    exportRoles: ["super_admin", "admin", "finance", "payroll"],
    sourceTables: ["salary_prep_line", "salary_prep_run", "employees"],
    calculationNotes: "Compares current month payroll with previous month. Variance = Current - Previous.",
    branchScoped: true,
    processScoped: true,
  },

  "employee-master": {
    code: "employee-master",
    name: "Employee Master Export",
    category: "HR & Workforce",
    subcategory: "Headcount & Org",
    rowGrain: "One row per employee",
    primaryKey: ["employee_code"],
    columns: [
      { key: "employee_code", label: "Emp Code", format: "text", width: 100 },
      { key: "employee_name", label: "Employee Name", format: "text", width: 180 },
      { key: "official_email", label: "Official Email", format: "text", width: 200 },
      { key: "mobile", label: "Mobile", format: "text", width: 120 },
      { key: "employment_status", label: "Status", format: "status", width: 100 },
      { key: "date_of_joining", label: "DOJ", format: "date", width: 100 },
      { key: "date_of_exit", label: "DOL", format: "date", width: 100 },
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "cost_centre_name", label: "Cost Centre", format: "text", width: 140 },
      { key: "reporting_manager", label: "Reporting Manager", format: "text", width: 180 },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
    sourceTables: ["employees", "branch_master", "department_master", "process_master", "cost_centre_master"],
    branchScoped: true,
    processScoped: true,
  },

  "headcount": {
    code: "headcount",
    name: "Active Headcount Summary",
    category: "HR & Workforce",
    subcategory: "Headcount & Org",
    rowGrain: "One row per branch/department/process combination",
    primaryKey: ["branch_name", "department_name", "process_name"],
    columns: [
      { key: "branch_name", label: "Branch", format: "text", width: 120 },
      { key: "department_name", label: "Department", format: "text", width: 120 },
      { key: "process_name", label: "Process", format: "text", width: 140 },
      { key: "active_headcount", label: "Active Headcount", format: "number", width: 120, align: "right" },
    ],
    viewRoles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager", "branch_head", "ceo"],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
    sourceTables: ["employees", "branch_master", "department_master", "process_master"],
    branchScoped: true,
    processScoped: true,
  },
};

export function getReportDefinition(code: string): ReportDefinition | null {
  return REPORT_DEFINITIONS[code] ?? null;
}

export function canViewReport(code: string, userRoles: string[]): boolean {
  const def = REPORT_DEFINITIONS[code];
  if (!def) return true;
  return def.viewRoles.some(r => userRoles.includes(r));
}

export function canExportReport(code: string, userRoles: string[]): boolean {
  const def = REPORT_DEFINITIONS[code];
  if (!def) return true;
  return def.exportRoles.some(r => userRoles.includes(r));
}
