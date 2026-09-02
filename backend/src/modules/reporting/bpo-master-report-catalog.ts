export type BpoMasterFormat =
  | "text"
  | "number"
  | "currency"
  | "percentage"
  | "date"
  | "month"
  | "time"
  | "duration"
  | "status"
  | "boolean"
  | "email"
  | "phone"
  | "masked";

export interface BpoMasterColumn {
  key: string;
  label: string;
  format: BpoMasterFormat;
  sensitive?: boolean;
  description?: string;
}

export interface BpoMasterReportDefinition {
  code: string;
  name: string;
  domain: string;
  description: string;
  rowGrain: string;
  primaryKey: string[];
  viewRoles: string[];
  exportRoles: string[];
  dateStandard: "DD-MMM-YYYY";
  employeeCodePolicy: "MANDATORY";
  aggregateEmployeeCode?: "AGGREGATE";
  columns: BpoMasterColumn[];
  sourceDomains: string[];
  controlNotes: string[];
}

const c = (
  key: string,
  format: BpoMasterFormat = "text",
  options: Omit<BpoMasterColumn, "key" | "label" | "format"> = {}
): BpoMasterColumn => ({
  key,
  label: key,
  format,
  ...options,
});

const IDENTITY = [
  c("EMPLOYEE_CODE", "text", { description: "Mandatory HRMS employee code; aggregate reports use AGGREGATE." }),
  c("REPORT_DATE", "date", { description: "Standard display format DD-MMM-YYYY." }),
  c("EMPLOYEE_NAME"),
  c("EMPLOYMENT_STATUS", "status"),
  c("DATE_OF_JOINING", "date"),
  c("DATE_OF_EXIT", "date"),
  c("TENURE_DAYS", "number"),
  c("BRANCH"),
  c("LOCATION"),
  c("DEPARTMENT"),
  c("DESIGNATION"),
  c("PROCESS"),
  c("CLIENT"),
  c("LOB"),
  c("COST_CENTRE"),
  c("REPORTING_MANAGER_CODE"),
  c("REPORTING_MANAGER_NAME"),
  c("TEAM_LEADER_CODE"),
  c("TEAM_LEADER_NAME"),
  c("EMPLOYMENT_TYPE"),
  c("SHIFT_ROTATION_TYPE"),
];

const MANAGEMENT = ["super_admin", "admin", "ceo", "coo", "branch_head", "manager", "process_manager"];
const OPERATIONS = ["super_admin", "admin", "ceo", "coo", "branch_head", "operations", "operations_manager", "manager", "process_manager", "team_leader", "tl", "quality", "qa", "wfm"];
const HR = ["super_admin", "admin", "hr", "hr_head", "hr_admin", "ho_hr", "process_hr", "branch_hr", "hr_branch", "branch_head", "manager"];
const PAYROLL = ["super_admin", "admin", "payroll", "payroll_head", "payroll_branch", "payroll_hr", "finance", "finance_head", "hr_head"];
const FINANCE = ["super_admin", "admin", "ceo", "coo", "finance", "finance_head", "accounts_head", "branch_head"];
const QUALITY = ["super_admin", "admin", "ceo", "coo", "quality", "qa", "quality_analyst", "operations", "operations_manager", "manager", "process_manager", "branch_head"];
const RECRUITMENT = ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head", "recruitment_hr", "trainer", "training", "branch_head"];
const ADMIN = ["super_admin", "admin", "it", "it_manager", "security", "security_head", "facility_manager", "visitor_security", "visitor_reception", "hr", "hr_head", "branch_head"];

export const BPO_MASTER_REPORTS: BpoMasterReportDefinition[] = [
  {
    code: "bpo-operations-productivity-master",
    name: "BPO OPERATIONS & PRODUCTIVITY MASTER REPORT",
    domain: "OPERATIONS",
    description: "One employee-day report combining staffing, roster, login, production, productivity, AHT, SLA, quality, shrinkage and action status.",
    rowGrain: "ONE ROW PER EMPLOYEE PER WORK DATE PER PROCESS/LOB",
    primaryKey: ["EMPLOYEE_CODE", "REPORT_DATE", "PROCESS", "LOB"],
    viewRoles: OPERATIONS,
    exportRoles: ["super_admin", "admin", "operations", "operations_manager", "manager", "process_manager", "branch_head", "ceo", "coo"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("ROSTER_SHIFT"), c("SHIFT_START_TIME", "time"), c("SHIFT_END_TIME", "time"),
      c("SCHEDULED_MINUTES", "number"), c("LOGIN_TIME", "time"), c("LOGOUT_TIME", "time"),
      c("LOGIN_MINUTES", "number"), c("PRODUCTIVE_MINUTES", "number"), c("IDLE_MINUTES", "number"),
      c("BREAK_MINUTES", "number"), c("SYSTEM_DOWNTIME_MINUTES", "number"), c("TRAINING_MINUTES", "number"),
      c("MEETING_MINUTES", "number"), c("COACHING_MINUTES", "number"), c("TOTAL_SHRINKAGE_MINUTES", "number"),
      c("SHRINKAGE_PERCENTAGE", "percentage"), c("ROSTER_ADHERENCE_PERCENTAGE", "percentage"),
      c("SCHEDULE_ADHERENCE_PERCENTAGE", "percentage"), c("ATTENDANCE_STATUS", "status"),
      c("LATE_BY_MINUTES", "number"), c("EARLY_LOGOUT_MINUTES", "number"), c("OVERTIME_MINUTES", "number"),
      c("QUEUE"), c("WORK_TYPE"), c("TASKS_RECEIVED", "number"), c("TASKS_ASSIGNED", "number"),
      c("TASKS_COMPLETED", "number"), c("TASKS_PENDING", "number"), c("TASKS_REJECTED", "number"),
      c("PRODUCTIVITY_TARGET", "number"), c("PRODUCTIVITY_ACHIEVED", "number"), c("PRODUCTIVITY_PERCENTAGE", "percentage"),
      c("AHT_TARGET_SECONDS", "number"), c("AHT_ACHIEVED_SECONDS", "number"), c("AHT_VARIANCE_SECONDS", "number"),
      c("SLA_TARGET_PERCENTAGE", "percentage"), c("SLA_ACHIEVED_PERCENTAGE", "percentage"),
      c("TAT_TARGET_MINUTES", "number"), c("TAT_ACHIEVED_MINUTES", "number"),
      c("FIRST_PASS_YIELD_PERCENTAGE", "percentage"), c("REWORK_COUNT", "number"),
      c("QUALITY_SCORE_PERCENTAGE", "percentage"), c("AUDIT_COUNT", "number"), c("ERROR_COUNT", "number"),
      c("FATAL_ERROR_COUNT", "number"), c("CSAT_PERCENTAGE", "percentage"), c("NPS_SCORE", "number"),
      c("UTILISATION_PERCENTAGE", "percentage"), c("OCCUPANCY_PERCENTAGE", "percentage"),
      c("PERFORMANCE_RAG", "status"), c("ROOT_CAUSE"), c("RECOVERY_ACTION"), c("ACTION_OWNER"),
      c("ACTION_DUE_DATE", "date"), c("ACTION_STATUS", "status"), c("DATA_SOURCE"), c("DATA_REFRESHED_AT", "date"),
    ],
    sourceDomains: ["EMPLOYEE MASTER", "ROSTER", "ATTENDANCE", "BIOMETRIC", "DIALER/APR", "PRODUCTION", "QUALITY", "BUSINESS ACTIONS"],
    controlNotes: ["Employee code is mandatory.", "Daily grain prevents month-level duplication.", "Target and achieved metrics must be shown together.", "Unavailable metrics must remain blank/unavailable, never artificial zero."],
  },
  {
    code: "bpo-employee-performance-360-master",
    name: "BPO EMPLOYEE PERFORMANCE 360 MASTER REPORT",
    domain: "EMPLOYEE PERFORMANCE",
    description: "One employee-month report covering organisation, productivity, quality, attendance, behaviour, training, feedback, PIP, incentives and trend.",
    rowGrain: "ONE ROW PER EMPLOYEE PER REPORT MONTH",
    primaryKey: ["EMPLOYEE_CODE", "REPORT_MONTH"],
    viewRoles: [...new Set([...OPERATIONS, ...HR, ...QUALITY])],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "operations_manager", "manager", "process_manager", "branch_head", "quality"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("REPORT_MONTH", "month"), c("WORKING_DAYS", "number"), c("ROSTERED_DAYS", "number"),
      c("PRESENT_DAYS", "number"), c("ABSENT_DAYS", "number"), c("LEAVE_DAYS", "number"),
      c("LWP_DAYS", "number"), c("WEEK_OFF_DAYS", "number"), c("HOLIDAY_DAYS", "number"),
      c("LATE_MARK_COUNT", "number"), c("ATTENDANCE_PERCENTAGE", "percentage"),
      c("PRODUCTIVITY_TARGET", "number"), c("PRODUCTIVITY_ACHIEVED", "number"), c("PRODUCTIVITY_PERCENTAGE", "percentage"),
      c("AHT_TARGET_SECONDS", "number"), c("AHT_ACHIEVED_SECONDS", "number"),
      c("QUALITY_TARGET_PERCENTAGE", "percentage"), c("QUALITY_SCORE_PERCENTAGE", "percentage"),
      c("AUDIT_COUNT", "number"), c("ERROR_COUNT", "number"), c("FATAL_ERROR_COUNT", "number"),
      c("CSAT_PERCENTAGE", "percentage"), c("NPS_SCORE", "number"), c("SLA_ACHIEVEMENT_PERCENTAGE", "percentage"),
      c("ADHERENCE_PERCENTAGE", "percentage"), c("UTILISATION_PERCENTAGE", "percentage"), c("OCCUPANCY_PERCENTAGE", "percentage"),
      c("COMPOSITE_PERFORMANCE_SCORE", "percentage"), c("PERFORMANCE_RATING"), c("PERFORMANCE_RAG", "status"),
      c("PREVIOUS_MONTH_SCORE", "percentage"), c("SCORE_MOVEMENT", "number"), c("THREE_MONTH_AVERAGE", "percentage"),
      c("RANK_IN_TEAM", "number"), c("RANK_IN_PROCESS", "number"), c("BOTTOM_PERFORMER_FLAG", "boolean"),
      c("TOP_PERFORMER_FLAG", "boolean"), c("PIP_STATUS", "status"), c("PIP_START_DATE", "date"),
      c("PIP_END_DATE", "date"), c("PIP_OUTCOME", "status"), c("COACHING_COUNT", "number"),
      c("FEEDBACK_COUNT", "number"), c("LAST_FEEDBACK_DATE", "date"), c("TRAINING_ASSIGNED_COUNT", "number"),
      c("TRAINING_COMPLETED_COUNT", "number"), c("ASSESSMENT_SCORE_PERCENTAGE", "percentage"),
      c("CERTIFICATION_STATUS", "status"), c("INCENTIVE_ELIGIBLE_FLAG", "boolean"),
      c("INCENTIVE_AMOUNT", "currency", { sensitive: true }), c("DISCIPLINARY_CASE_COUNT", "number", { sensitive: true }),
      c("GRIEVANCE_CASE_COUNT", "number", { sensitive: true }), c("MANAGER_REMARKS", "text", { sensitive: true }),
      c("DATA_COMPLETENESS_PERCENTAGE", "percentage"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["EMPLOYEE", "ATTENDANCE", "OPERATIONS KPI", "QUALITY", "TRAINING", "FEEDBACK", "PIP", "INCENTIVES"],
    controlNotes: ["Employee code and report month form the unique key.", "Composite score must publish its component weights.", "Disciplinary/grievance fields require restricted export permission."],
  },
  {
    code: "bpo-client-sla-delivery-master",
    name: "BPO CLIENT SLA, DELIVERY & COMMERCIAL MASTER REPORT",
    domain: "CLIENT PERFORMANCE",
    description: "One client-process-LOB-day report combining forecast, demand, staffing, delivery, SLA/TAT, quality, billing, penalties and client governance.",
    rowGrain: "ONE ROW PER CLIENT PER PROCESS/LOB PER REPORT DATE",
    primaryKey: ["CLIENT", "PROCESS", "LOB", "REPORT_DATE"],
    viewRoles: [...new Set([...OPERATIONS, ...FINANCE, ...MANAGEMENT, ...QUALITY, "sales"])],
    exportRoles: ["super_admin", "admin", "ceo", "coo", "operations_manager", "process_manager", "finance", "finance_head", "branch_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    aggregateEmployeeCode: "AGGREGATE",
    columns: [
      c("EMPLOYEE_CODE"), c("REPORT_DATE", "date"), c("CLIENT"), c("CLIENT_CODE"), c("CONTRACT_STATUS", "status"),
      c("BRANCH"), c("PROCESS"), c("PROCESS_CODE"), c("LOB"), c("LOB_CODE"), c("QUEUE"), c("COUNTRY"),
      c("TIME_ZONE"), c("SERVICE_TYPE"), c("BILLING_MODEL"), c("RATE_CARD_VALUE", "currency", { sensitive: true }),
      c("FORECAST_VOLUME", "number"), c("ACTUAL_VOLUME_RECEIVED", "number"), c("VOLUME_VARIANCE", "number"),
      c("VOLUME_VARIANCE_PERCENTAGE", "percentage"), c("OPENING_BACKLOG", "number"), c("CLOSING_BACKLOG", "number"),
      c("TASKS_COMPLETED", "number"), c("TASKS_REJECTED", "number"), c("REWORK_VOLUME", "number"),
      c("PLANNED_HEADCOUNT", "number"), c("ROSTERED_HEADCOUNT", "number"), c("PRESENT_HEADCOUNT", "number"),
      c("PRODUCTIVE_FTE", "number"), c("CAPACITY_UTILISATION_PERCENTAGE", "percentage"), c("SHRINKAGE_PERCENTAGE", "percentage"),
      c("ATTRITION_PERCENTAGE", "percentage"), c("SLA_TARGET_PERCENTAGE", "percentage"), c("SLA_ACHIEVED_PERCENTAGE", "percentage"),
      c("TAT_TARGET_MINUTES", "number"), c("TAT_ACHIEVED_MINUTES", "number"), c("AHT_TARGET_SECONDS", "number"),
      c("AHT_ACHIEVED_SECONDS", "number"), c("QUALITY_TARGET_PERCENTAGE", "percentage"),
      c("QUALITY_SCORE_PERCENTAGE", "percentage"), c("FATAL_ERROR_COUNT", "number"), c("CSAT_PERCENTAGE", "percentage"),
      c("NPS_SCORE", "number"), c("FIRST_RESPONSE_TIME_SECONDS", "number"), c("ABANDONMENT_PERCENTAGE", "percentage"),
      c("REVENUE_RECOGNISED", "currency", { sensitive: true }), c("SERVICE_CREDIT_OR_PENALTY", "currency", { sensitive: true }),
      c("DIRECT_COST", "currency", { sensitive: true }), c("GROSS_MARGIN", "currency", { sensitive: true }),
      c("GROSS_MARGIN_PERCENTAGE", "percentage", { sensitive: true }), c("INVOICE_STATUS", "status"),
      c("COLLECTION_STATUS", "status"), c("CLIENT_ESCALATION_COUNT", "number"), c("OPEN_ACTION_COUNT", "number"),
      c("RED_FLAG_COUNT", "number"), c("GOVERNANCE_STATUS", "status"), c("LAST_CLIENT_REVIEW_DATE", "date"),
      c("NEXT_CLIENT_REVIEW_DATE", "date"), c("ACTION_OWNER"), c("CLIENT_REMARKS"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["CLIENT MASTER", "FORECAST", "ROSTER", "DELIVERY", "QUALITY", "SLA", "FINANCE P&L", "CLIENT ACTIONS"],
    controlNotes: ["EMPLOYEE_CODE is AGGREGATE because the row is client/process/LOB level.", "Commercial fields require Finance/Management export permission.", "Forecast and actual volumes must never be mixed."],
  },
  {
    code: "bpo-wfm-attendance-shrinkage-master",
    name: "BPO WFM, ATTENDANCE & SHRINKAGE MASTER REPORT",
    domain: "WFM / ATTENDANCE",
    description: "One employee-day report covering roster, biometric, attendance, leave, breaks, adherence, overtime, shrinkage and regularisation.",
    rowGrain: "ONE ROW PER EMPLOYEE PER ATTENDANCE DATE",
    primaryKey: ["EMPLOYEE_CODE", "REPORT_DATE"],
    viewRoles: [...new Set([...OPERATIONS, "hr", "hr_head", "payroll", "payroll_head"])],
    exportRoles: ["super_admin", "admin", "wfm", "hr", "hr_head", "payroll", "operations_manager", "branch_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("ROSTER_STATUS", "status"), c("ROSTER_VERSION"), c("ROSTER_SHIFT"), c("SHIFT_START_TIME", "time"),
      c("SHIFT_END_TIME", "time"), c("SCHEDULED_MINUTES", "number"), c("WEEK_OFF_FLAG", "boolean"),
      c("HOLIDAY_FLAG", "boolean"), c("LEAVE_TYPE"), c("LEAVE_STATUS", "status"), c("LEAVE_DAYS", "number"),
      c("BIOMETRIC_FIRST_PUNCH", "time"), c("BIOMETRIC_LAST_PUNCH", "time"), c("BIOMETRIC_MINUTES", "number"),
      c("SYSTEM_LOGIN_TIME", "time"), c("SYSTEM_LOGOUT_TIME", "time"), c("SYSTEM_LOGIN_MINUTES", "number"),
      c("ATTENDANCE_SOURCE"), c("ATTENDANCE_STATUS", "status"), c("PAYABLE_DAY_VALUE", "number"),
      c("LWP_DAY_VALUE", "number"), c("HALF_DAY_FLAG", "boolean"), c("LATE_MARK_FLAG", "boolean"),
      c("LATE_BY_MINUTES", "number"), c("EARLY_LOGOUT_MINUTES", "number"), c("SHORT_ATTENDANCE_MINUTES", "number"),
      c("OVERTIME_MINUTES", "number"), c("REGULARISATION_ID"), c("REGULARISATION_STATUS", "status"),
      c("REGULARISATION_REASON"), c("REGULARISATION_APPROVER"), c("REGULARISATION_APPROVED_AT", "date"),
      c("MINI_BREAK_COUNT", "number"), c("MINI_BREAK_MINUTES", "number"), c("LONG_BREAK_COUNT", "number"),
      c("LONG_BREAK_MINUTES", "number"), c("TOTAL_BREAK_MINUTES", "number"), c("BREAK_EXCEPTION_FLAG", "boolean"),
      c("ROSTER_ADHERENCE_PERCENTAGE", "percentage"), c("SCHEDULE_ADHERENCE_PERCENTAGE", "percentage"),
      c("PLANNED_SHRINKAGE_MINUTES", "number"), c("UNPLANNED_SHRINKAGE_MINUTES", "number"),
      c("TOTAL_SHRINKAGE_MINUTES", "number"), c("SHRINKAGE_PERCENTAGE", "percentage"),
      c("ROSTER_DATE", "date"), c("PAYROLL_ATTENDANCE_INPUT"),
      c("MISMATCH_TYPE"), c("MISMATCH_STATUS", "status"), c("LOCK_STATUS", "status"), c("PAYROLL_IMPACT_FLAG", "boolean"),
      c("DATA_SOURCE"), c("DATA_REFRESHED_AT", "date"),
    ],
    sourceDomains: ["ROSTER", "SHIFT", "BIOMETRIC", "ATTENDANCE", "LEAVE", "BREAK", "REGULARISATION", "PAYROLL INPUT"],
    controlNotes: ["Attendance date is the reporting date.", "Raw biometric, processed attendance and payroll impact are separate fields.", "Regularisation approval evidence must be retained."],
  },
  {
    code: "bpo-hr-workforce-lifecycle-master",
    name: "BPO HR WORKFORCE & EMPLOYEE LIFECYCLE MASTER REPORT",
    domain: "HR",
    description: "One employee record covering personal/work identity, organisation, joining, employment lifecycle, documents, BGV, confirmation, promotion, movement and exit readiness.",
    rowGrain: "ONE ROW PER EMPLOYEE AS OF REPORT DATE",
    primaryKey: ["EMPLOYEE_CODE", "REPORT_DATE"],
    viewRoles: HR,
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("GENDER"), c("DATE_OF_BIRTH", "date", { sensitive: true }), c("AGE_YEARS", "number", { sensitive: true }),
      c("OFFICIAL_EMAIL", "email"), c("PERSONAL_EMAIL", "email", { sensitive: true }), c("MOBILE_NUMBER", "phone", { sensitive: true }),
      c("CURRENT_ADDRESS", "text", { sensitive: true }), c("PERMANENT_ADDRESS", "text", { sensitive: true }),
      c("EMERGENCY_CONTACT_NAME", "text", { sensitive: true }), c("EMERGENCY_CONTACT_NUMBER", "phone", { sensitive: true }),
      c("EMPLOYEE_CATEGORY"), c("GRADE"), c("LEVEL"), c("BAND"), c("PROBATION_STATUS", "status"),
      c("PROBATION_END_DATE", "date"), c("CONFIRMATION_DUE_DATE", "date"), c("CONFIRMATION_STATUS", "status"),
      c("CONTRACT_START_DATE", "date"), c("CONTRACT_END_DATE", "date"), c("NOTICE_PERIOD_DAYS", "number"),
      c("LAST_PROMOTION_DATE", "date"), c("LAST_INCREMENT_DATE", "date"), c("LAST_TRANSFER_DATE", "date"),
      c("PREVIOUS_BRANCH"), c("PREVIOUS_PROCESS"), c("PREVIOUS_DESIGNATION"), c("LIFECYCLE_EVENT_COUNT", "number"),
      c("AADHAAR_STATUS", "status", { sensitive: true }), c("PAN_STATUS", "status", { sensitive: true }),
      c("UAN_STATUS", "status", { sensitive: true }), c("ESIC_STATUS", "status", { sensitive: true }),
      c("BANK_VERIFICATION_STATUS", "status", { sensitive: true }), c("MANDATORY_DOCUMENT_COUNT", "number"),
      c("VERIFIED_DOCUMENT_COUNT", "number"), c("MISSING_DOCUMENT_COUNT", "number"), c("EXPIRING_DOCUMENT_COUNT", "number"),
      c("BGV_STATUS", "status", { sensitive: true }), c("BGV_RISK_LEVEL", "status", { sensitive: true }),
      c("BGV_COMPLETED_DATE", "date", { sensitive: true }), c("ONBOARDING_COMPLETION_PERCENTAGE", "percentage"),
      c("EMPLOYEE_CODE_CREATED_DATE", "date"), c("ASSET_ISSUED_FLAG", "boolean"), c("SYSTEM_ACCESS_READY_FLAG", "boolean"),
      c("RESIGNATION_DATE", "date"), c("LAST_WORKING_DATE", "date"), c("EXIT_REASON"), c("ATTRITION_TYPE"),
      c("EARLY_ATTRITION_FLAG", "boolean"), c("CLEARANCE_STATUS", "status"), c("FNF_STATUS", "status"),
      c("REHIRE_ELIGIBILITY", "status", { sensitive: true }), c("HR_DATA_COMPLETENESS_PERCENTAGE", "percentage"),
      c("DATA_QUALITY_EXCEPTION_COUNT", "number"), c("DATA_SOURCE"), c("LAST_UPDATED_AT", "date"),
    ],
    sourceDomains: ["EMPLOYEE", "ORGANISATION", "ONBOARDING", "DOCUMENTS", "BGV", "JOB HISTORY", "EXIT", "CLEARANCE"],
    controlNotes: ["PII fields require HR export rights.", "Lifecycle dates must be effective-dated.", "Employee code may never be replaced by name as the key."],
  },
  {
    code: "bpo-payroll-statutory-master",
    name: "BPO PAYROLL, COMPENSATION & STATUTORY MASTER REPORT",
    domain: "PAYROLL",
    description: "One employee-month report combining attendance input, earnings, deductions, incentives, arrears, statutory contributions, tax, net pay, payslip and disbursal.",
    rowGrain: "ONE ROW PER EMPLOYEE PER PAYROLL MONTH PER PAYROLL RUN",
    primaryKey: ["EMPLOYEE_CODE", "PAYROLL_MONTH", "PAYROLL_RUN_ID"],
    viewRoles: PAYROLL,
    exportRoles: ["super_admin", "admin", "payroll", "payroll_head", "finance", "finance_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("PAYROLL_MONTH", "month"), c("PAYROLL_RUN_ID"), c("PAYROLL_RUN_STATUS", "status"), c("PAYROLL_LOCK_STATUS", "status"),
      c("CALENDAR_DAYS", "number"), c("WORKING_DAYS", "number"), c("PRESENT_DAYS", "number"), c("PAID_LEAVE_DAYS", "number"),
      c("WEEK_OFF_DAYS", "number"), c("HOLIDAY_DAYS", "number"), c("LWP_DAYS", "number"), c("PAYABLE_DAYS", "number"),
      c("OVERTIME_HOURS", "number"), c("BASIC_PAY", "currency", { sensitive: true }), c("HRA", "currency", { sensitive: true }),
      c("SPECIAL_ALLOWANCE", "currency", { sensitive: true }), c("CONVEYANCE_ALLOWANCE", "currency", { sensitive: true }),
      c("OTHER_ALLOWANCE", "currency", { sensitive: true }), c("VARIABLE_PAY", "currency", { sensitive: true }),
      c("INCENTIVE_AMOUNT", "currency", { sensitive: true }), c("OVERTIME_AMOUNT", "currency", { sensitive: true }),
      c("ARREAR_AMOUNT", "currency", { sensitive: true }), c("REIMBURSEMENT_AMOUNT", "currency", { sensitive: true }),
      c("GROSS_EARNINGS", "currency", { sensitive: true }), c("LWP_DEDUCTION", "currency", { sensitive: true }),
      c("PF_EMPLOYEE", "currency", { sensitive: true }), c("PF_EMPLOYER", "currency", { sensitive: true }),
      c("ESIC_EMPLOYEE", "currency", { sensitive: true }), c("ESIC_EMPLOYER", "currency", { sensitive: true }),
      c("PROFESSIONAL_TAX", "currency", { sensitive: true }), c("TDS", "currency", { sensitive: true }),
      c("LOAN_DEDUCTION", "currency", { sensitive: true }), c("ADVANCE_DEDUCTION", "currency", { sensitive: true }),
      c("OTHER_DEDUCTION", "currency", { sensitive: true }), c("TOTAL_DEDUCTIONS", "currency", { sensitive: true }),
      c("NET_PAY", "currency", { sensitive: true }), c("CTC_MONTHLY", "currency", { sensitive: true }),
      c("UAN_NUMBER", "masked", { sensitive: true }), c("ESIC_NUMBER", "masked", { sensitive: true }),
      c("PAN_NUMBER", "masked", { sensitive: true }), c("BANK_ACCOUNT_NUMBER", "masked", { sensitive: true }),
      c("IFSC_CODE", "masked", { sensitive: true }), c("BANK_VERIFICATION_STATUS", "status", { sensitive: true }),
      c("STATUTORY_ELIGIBILITY_STATUS", "status"), c("PF_ECR_STATUS", "status"), c("ESIC_FILING_STATUS", "status"),
      c("TDS_FILING_STATUS", "status"), c("PAYSLIP_STATUS", "status"), c("PAYSLIP_RELEASE_DATE", "date"),
      c("DISBURSAL_STATUS", "status"), c("DISBURSAL_DATE", "date"), c("UTR_REFERENCE", "text", { sensitive: true }),
      c("PAYROLL_VARIANCE_AMOUNT", "currency", { sensitive: true }), c("PAYROLL_VARIANCE_PERCENTAGE", "percentage"),
      c("PAYROLL_EXCEPTION_COUNT", "number"), c("MAKER"), c("CHECKER"), c("FINAL_APPROVER"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["ATTENDANCE", "LEAVE", "PAYROLL RUN", "SALARY COMPONENTS", "STATUTORY", "TAX", "PAYSLIP", "DISBURSAL"],
    controlNotes: ["Payroll run ID is part of the key.", "Salary and banking values require restricted export.", "Calculated, disbursed and payslip totals must reconcile."],
  },
  {
    code: "bpo-finance-pnl-profitability-master",
    name: "BPO FINANCE, P&L & PROFITABILITY MASTER REPORT",
    domain: "FINANCE",
    description: "One process/LOB-month report combining commercial plan, delivery, revenue recognition, payroll cost, overhead allocation, GRN, payable, cash and margin.",
    rowGrain: "ONE ROW PER BRANCH PER CLIENT PER PROCESS/LOB PER FINANCE MONTH",
    primaryKey: ["BRANCH", "CLIENT", "PROCESS", "LOB", "FINANCE_MONTH"],
    viewRoles: FINANCE,
    exportRoles: ["super_admin", "admin", "ceo", "coo", "finance", "finance_head", "accounts_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    aggregateEmployeeCode: "AGGREGATE",
    columns: [
      c("EMPLOYEE_CODE"), c("REPORT_DATE", "date"), c("FINANCE_MONTH", "month"), c("FINANCE_PERIOD_STATUS", "status"),
      c("BRANCH"), c("CLIENT"), c("CLIENT_CODE"), c("PROCESS"), c("PROCESS_CODE"), c("LOB"), c("LOB_CODE"),
      c("COST_CENTRE"), c("BILLING_MODEL"), c("CURRENCY"), c("RATE_CARD_VALUE", "currency", { sensitive: true }),
      c("PLANNED_BILLING_UNITS", "number"), c("ACTUAL_BILLING_UNITS", "number"), c("BILLING_UNIT_VARIANCE", "number"),
      c("PLANNED_REVENUE", "currency", { sensitive: true }), c("EARNED_REVENUE", "currency", { sensitive: true }), c("REVENUE_RECOGNISED", "currency", { sensitive: true }),
      c("UNBILLED_REVENUE", "currency", { sensitive: true }), c("DEFERRED_REVENUE", "currency", { sensitive: true }),
      c("INVOICE_AMOUNT", "currency", { sensitive: true }), c("INVOICE_STATUS", "status"),
      c("COLLECTION_AMOUNT", "currency", { sensitive: true }), c("OUTSTANDING_RECEIVABLE", "currency", { sensitive: true }),
      c("COLLECTION_DSO_DAYS", "number"), c("PRODUCTIVE_HEADCOUNT", "number"), c("BILLED_FTE", "number"),
      c("SEAT_UTILISATION_PERCENTAGE", "percentage"), c("PAYROLL_COST", "currency", { sensitive: true }),
      c("INCENTIVE_COST", "currency", { sensitive: true }), c("OVERTIME_COST", "currency", { sensitive: true }),
      c("TRAINING_COST", "currency", { sensitive: true }), c("RECRUITMENT_COST", "currency", { sensitive: true }),
      c("FACILITY_COST", "currency", { sensitive: true }), c("TECHNOLOGY_COST", "currency", { sensitive: true }),
      c("VENDOR_COST", "currency", { sensitive: true }), c("OTHER_DIRECT_COST", "currency", { sensitive: true }),
      c("DIRECT_COST_TOTAL", "currency", { sensitive: true }), c("OVERHEAD_ALLOCATION", "currency", { sensitive: true }),
      c("TOTAL_COST", "currency", { sensitive: true }), c("GROSS_PROFIT", "currency", { sensitive: true }),
      c("GROSS_MARGIN_PERCENTAGE", "percentage", { sensitive: true }), c("EBITDA", "currency", { sensitive: true }),
      c("EBITDA_CONTRIBUTION", "currency", { sensitive: true }),
      c("EBITDA_MARGIN_PERCENTAGE", "percentage", { sensitive: true }), c("BUDGET_AMOUNT", "currency", { sensitive: true }),
      c("BUDGET_VARIANCE", "currency", { sensitive: true }), c("BUDGET_VARIANCE_PERCENTAGE", "percentage"),
      c("GRN_GROSS_AMOUNT", "currency", { sensitive: true }), c("PNL_RECOGNISED_COST", "currency", { sensitive: true }),
      c("VENDOR_PAYABLE", "currency", { sensitive: true }), c("CASH_PAID", "currency", { sensitive: true }),
      c("OUTSTANDING_PAYABLE", "currency", { sensitive: true }), c("SERVICE_CREDIT_OR_PENALTY", "currency", { sensitive: true }),
      c("PROFITABILITY_RAG", "status"), c("VARIANCE_REASON"), c("ACTION_OWNER"), c("ACTION_DUE_DATE", "date"),
      c("PERIOD_CLOSE_BLOCKER_COUNT", "number"), c("PERIOD_CLOSE_APPROVER"), c("SNAPSHOT_ID"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["COMMERCIAL RULE", "DELIVERY", "PAYROLL COST", "BUDGET", "GRN", "VENDOR PAYMENT", "REVENUE", "P&L CLOSE"],
    controlNotes: ["EMPLOYEE_CODE is AGGREGATE because the row is Process/LOB level.", "Budget, GRN, payable, cash and recognised P&L cost remain separate.", "Closed-period snapshots must be immutable."],
  },
  {
    code: "bpo-quality-risk-compliance-master",
    name: "BPO QUALITY, RISK & COMPLIANCE MASTER REPORT",
    domain: "QUALITY / COMPLIANCE",
    description: "One employee-audit report covering audit sampling, scores, error taxonomy, fatal risk, calibration, RCA, corrective action and closure.",
    rowGrain: "ONE ROW PER EMPLOYEE PER QUALITY AUDIT / CASE",
    primaryKey: ["EMPLOYEE_CODE", "AUDIT_ID"],
    viewRoles: QUALITY,
    exportRoles: ["super_admin", "admin", "quality", "qa", "quality_analyst", "operations_manager", "process_manager", "branch_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("AUDIT_ID"), c("AUDIT_DATE", "date"), c("TRANSACTION_ID"), c("CASE_ID"), c("QUEUE"), c("WORK_TYPE"),
      c("AUDIT_TYPE"), c("AUDIT_SAMPLE_TYPE"), c("AUDITOR_CODE"), c("AUDITOR_NAME"), c("AUDIT_FORM_VERSION"),
      c("TOTAL_CHECKPOINTS", "number"), c("PASSED_CHECKPOINTS", "number"), c("FAILED_CHECKPOINTS", "number"),
      c("QUALITY_SCORE_PERCENTAGE", "percentage"), c("QUALITY_TARGET_PERCENTAGE", "percentage"),
      c("QUALITY_VARIANCE_PERCENTAGE", "percentage"), c("ERROR_CATEGORY"), c("ERROR_SUBCATEGORY"), c("ERROR_FIELD"),
      c("ERROR_DESCRIPTION"), c("ERROR_SEVERITY", "status"), c("FATAL_ERROR_FLAG", "boolean"), c("FATAL_ERROR_TYPE"),
      c("CUSTOMER_IMPACT_FLAG", "boolean"), c("COMPLIANCE_BREACH_FLAG", "boolean"), c("DATA_PRIVACY_BREACH_FLAG", "boolean"),
      c("FINANCIAL_IMPACT_AMOUNT", "currency", { sensitive: true }), c("REWORK_REQUIRED_FLAG", "boolean"),
      c("REWORK_COMPLETED_DATE", "date"), c("DISPUTE_STATUS", "status"), c("DISPUTE_OUTCOME", "status"),
      c("CALIBRATION_REQUIRED_FLAG", "boolean"), c("CALIBRATION_SESSION_DATE", "date"),
      c("CALIBRATION_VARIANCE_PERCENTAGE", "percentage"), c("ROOT_CAUSE_CATEGORY"), c("ROOT_CAUSE_DETAIL"),
      c("CORRECTIVE_ACTION"), c("PREVENTIVE_ACTION"), c("ACTION_OWNER"), c("ACTION_DUE_DATE", "date"),
      c("ACTION_STATUS", "status"), c("VERIFICATION_DATE", "date"), c("VERIFIED_BY"), c("RECURRENCE_FLAG", "boolean"),
      c("REPEAT_ERROR_COUNT_30_DAYS", "number"), c("PIP_TRIGGER_FLAG", "boolean"), c("CLIENT_ESCALATION_FLAG", "boolean"),
      c("SOP_VERSION"), c("SOP_ACKNOWLEDGED_FLAG", "boolean"), c("AUDIT_EVIDENCE_STATUS", "status"),
      c("QUALITY_RAG", "status"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["QUALITY AUDIT", "ERROR TAXONOMY", "FATAL ERROR", "CALIBRATION", "DISPUTE", "CORRECTIVE ACTION", "SOP"],
    controlNotes: ["Audit ID is mandatory with employee code.", "Fatal and privacy breaches require restricted visibility.", "Corrective action must have owner, due date and verification."],
  },
  {
    code: "bpo-recruitment-training-readiness-master",
    name: "BPO RECRUITMENT, ONBOARDING & TRAINING READINESS MASTER REPORT",
    domain: "RECRUITMENT / TRAINING",
    description: "One candidate/employee report covering demand, source, pipeline, offer, joining, documents, BGV, training, assessment, certification and production readiness.",
    rowGrain: "ONE ROW PER CANDIDATE / JOINED EMPLOYEE PER REQUISITION",
    primaryKey: ["CANDIDATE_ID", "REQUISITION_ID"],
    viewRoles: RECRUITMENT,
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "recruitment_head", "trainer", "training"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      c("EMPLOYEE_CODE"), c("REPORT_DATE", "date"), c("CANDIDATE_ID"), c("CANDIDATE_NAME"),
      c("MOBILE_NUMBER", "phone", { sensitive: true }), c("EMAIL_ADDRESS", "email", { sensitive: true }),
      c("BRANCH"), c("CLIENT"), c("PROCESS"), c("LOB"), c("DEPARTMENT"), c("DESIGNATION"),
      c("REQUISITION_ID"), c("REQUISITION_DATE", "date"), c("REQUISITION_OWNER"), c("APPROVED_OPENINGS", "number"),
      c("SOURCE_CHANNEL"), c("SOURCE_PARTNER"), c("REFERRER_EMPLOYEE_CODE"), c("RECRUITER_CODE"), c("RECRUITER_NAME"),
      c("APPLICATION_DATE", "date"), c("CURRENT_STAGE"), c("STAGE_ENTRY_DATE", "date"), c("STAGE_AGEING_DAYS", "number"),
      c("SCREENING_STATUS", "status"), c("HR_ROUND_STATUS", "status"), c("SKILL_TEST_STATUS", "status"),
      c("OPS_ROUND_STATUS", "status"), c("CLIENT_ROUND_STATUS", "status"), c("FINAL_SELECTION_STATUS", "status"),
      c("OFFER_STATUS", "status"), c("OFFER_DATE", "date"), c("OFFERED_CTC", "currency", { sensitive: true }),
      c("EXPECTED_JOINING_DATE", "date"), c("ACTUAL_JOINING_DATE", "date"), c("NO_SHOW_FLAG", "boolean"),
      c("TIME_TO_HIRE_DAYS", "number"), c("TIME_TO_JOIN_DAYS", "number"), c("MANDATORY_DOCUMENT_COUNT", "number"),
      c("DOCUMENT_COMPLETION_PERCENTAGE", "percentage"), c("BGV_STATUS", "status", { sensitive: true }),
      c("EMPLOYEE_CODE_CREATED_FLAG", "boolean"), c("ONBOARDING_COMPLETION_PERCENTAGE", "percentage"),
      c("TRAINING_BATCH_CODE"), c("TRAINER_CODE"), c("TRAINER_NAME"), c("TRAINING_START_DATE", "date"),
      c("TRAINING_END_DATE", "date"), c("TRAINING_ATTENDANCE_PERCENTAGE", "percentage"),
      c("ASSESSMENT_SCORE_PERCENTAGE", "percentage"), c("CERTIFICATION_STATUS", "status"), c("OJT_STATUS", "status"),
      c("OJT_PRODUCTIVITY_PERCENTAGE", "percentage"), c("OJT_QUALITY_PERCENTAGE", "percentage"),
      c("PRODUCTION_RELEASE_DATE", "date"), c("TIME_TO_PRODUCTIVITY_DAYS", "number"), c("READINESS_STATUS", "status"),
      c("EARLY_ATTRITION_FLAG", "boolean"), c("SOURCE_EFFECTIVENESS_SCORE", "percentage"), c("RECRUITER_PRODUCTIVITY_SCORE", "percentage"),
      c("TRAINER_EFFECTIVENESS_SCORE", "percentage"), c("BLOCKER_REASON"), c("BLOCKER_OWNER"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["REQUISITION", "ATS", "INTERVIEWS", "OFFER", "ONBOARDING", "DOCUMENTS", "BGV", "TRAINING", "OJT"],
    controlNotes: ["Employee code is mandatory once generated; pre-join rows show PENDING EMPLOYEE CODE.", "Candidate PII and offered CTC require restricted export.", "Time-to-productivity must link recruitment to training and operations."],
  },
  {
    code: "bpo-admin-asset-facility-master",
    name: "BPO ADMIN, ASSET, IT & FACILITY MASTER REPORT",
    domain: "ADMIN / IT / FACILITY",
    description: "One employee-asset/access report covering asset custody, IT provisioning, access, helpdesk, facility, visitor/security and exit recovery.",
    rowGrain: "ONE ROW PER EMPLOYEE PER ASSET / ACCESS ITEM AS OF REPORT DATE",
    primaryKey: ["EMPLOYEE_CODE", "ITEM_TYPE", "ITEM_ID", "REPORT_DATE"],
    viewRoles: ADMIN,
    exportRoles: ["super_admin", "admin", "it", "it_manager", "security_head", "facility_manager", "hr_head"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    columns: [
      ...IDENTITY,
      c("ITEM_TYPE"), c("ITEM_ID"), c("ASSET_CATEGORY"), c("ASSET_TAG"), c("SERIAL_NUMBER", "masked", { sensitive: true }),
      c("MAKE_MODEL"), c("ASSET_STATUS", "status"), c("ASSET_CONDITION", "status"), c("ASSIGNMENT_DATE", "date"),
      c("EXPECTED_RETURN_DATE", "date"), c("ACTUAL_RETURN_DATE", "date"), c("CUSTODY_STATUS", "status"),
      c("RETURN_CONDITION", "status"), c("DAMAGE_OR_LOSS_FLAG", "boolean"), c("RECOVERY_AMOUNT", "currency", { sensitive: true }),
      c("SYSTEM_USER_ID", "masked", { sensitive: true }), c("OFFICIAL_EMAIL_CREATED_FLAG", "boolean"),
      c("VPN_ACCESS_STATUS", "status"), c("APPLICATION_ACCESS_STATUS", "status"), c("ACCESS_ROLE"),
      c("ACCESS_APPROVER"), c("ACCESS_GRANTED_DATE", "date"), c("ACCESS_REVIEW_DUE_DATE", "date"),
      c("ACCESS_DEPROVISIONED_DATE", "date"), c("IT_PROVISIONING_STATUS", "status"),
      c("HELPDESK_OPEN_TICKET_COUNT", "number"), c("HELPDESK_OVERDUE_TICKET_COUNT", "number"),
      c("LAST_HELPDESK_TICKET_DATE", "date"), c("DESK_OR_SEAT_ID"), c("FLOOR"), c("FACILITY_ZONE"),
      c("SEAT_ALLOCATION_STATUS", "status"), c("ACCESS_CARD_NUMBER", "masked", { sensitive: true }),
      c("ACCESS_CARD_STATUS", "status"), c("PARKING_ALLOCATION_STATUS", "status"), c("LOCKER_ID"),
      c("VISITOR_HOST_COUNT", "number"), c("SECURITY_EXCEPTION_COUNT", "number"), c("ASSET_SERVICE_DUE_DATE", "date"),
      c("WARRANTY_EXPIRY_DATE", "date"), c("AMC_STATUS", "status"), c("VENDOR_NAME"),
      c("EXIT_CLEARANCE_STATUS", "status"), c("PENDING_RECOVERY_ITEM_COUNT", "number"),
      c("ADMIN_EXCEPTION_COUNT", "number"), c("ACTION_OWNER"), c("ACTION_DUE_DATE", "date"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["ASSET", "IT PROVISIONING", "ACCESS CONTROL", "HELPDESK", "FACILITY", "SECURITY", "VISITOR", "EXIT CLEARANCE"],
    controlNotes: ["Employee code must link every custody/access item.", "Access identifiers and serial numbers are sensitive.", "Exit clearance must reconcile asset and access recovery."],
  },
  {
    code: "bpo-management-executive-master",
    name: "BPO EXECUTIVE MANAGEMENT MASTER REPORT",
    domain: "HIGHER MANAGEMENT",
    description: "One branch-client-process-month executive report combining workforce, delivery, quality, attendance, attrition, payroll, revenue, cost, margin, risk and actions.",
    rowGrain: "ONE ROW PER BRANCH PER CLIENT PER PROCESS/LOB PER REPORT MONTH",
    primaryKey: ["BRANCH", "CLIENT", "PROCESS", "LOB", "REPORT_MONTH"],
    viewRoles: MANAGEMENT,
    exportRoles: ["super_admin", "admin", "ceo", "coo", "branch_head", "finance_head", "hr_head", "operations_manager"],
    dateStandard: "DD-MMM-YYYY",
    employeeCodePolicy: "MANDATORY",
    aggregateEmployeeCode: "AGGREGATE",
    columns: [
      c("EMPLOYEE_CODE"), c("REPORT_DATE", "date"), c("REPORT_MONTH", "month"), c("BRANCH"), c("CLIENT"), c("PROCESS"), c("LOB"),
      c("ACTIVE_HEADCOUNT", "number"), c("BUDGETED_HEADCOUNT", "number"), c("VACANCY_COUNT", "number"),
      c("JOINER_COUNT", "number"), c("EXIT_COUNT", "number"), c("ATTRITION_PERCENTAGE", "percentage"),
      c("EARLY_ATTRITION_PERCENTAGE", "percentage"), c("ABSENTEEISM_PERCENTAGE", "percentage"),
      c("SHRINKAGE_PERCENTAGE", "percentage"), c("ROSTER_ADHERENCE_PERCENTAGE", "percentage"),
      c("PRODUCTIVITY_TARGET", "number"), c("PRODUCTIVITY_ACHIEVED", "number"), c("PRODUCTIVITY_PERCENTAGE", "percentage"),
      c("AHT_TARGET_SECONDS", "number"), c("AHT_ACHIEVED_SECONDS", "number"),
      c("SLA_TARGET_PERCENTAGE", "percentage"), c("SLA_ACHIEVED_PERCENTAGE", "percentage"),
      c("QUALITY_TARGET_PERCENTAGE", "percentage"), c("QUALITY_SCORE_PERCENTAGE", "percentage"),
      c("FATAL_ERROR_COUNT", "number"), c("CSAT_PERCENTAGE", "percentage"), c("NPS_SCORE", "number"),
      c("CLIENT_ESCALATION_COUNT", "number"), c("OPEN_RISK_COUNT", "number"), c("CRITICAL_RISK_COUNT", "number"),
      c("OPEN_ACTION_COUNT", "number"), c("OVERDUE_ACTION_COUNT", "number"), c("TRAINING_COMPLETION_PERCENTAGE", "percentage"),
      c("PIP_EMPLOYEE_COUNT", "number"), c("PAYROLL_COST", "currency", { sensitive: true }),
      c("REVENUE_RECOGNISED", "currency", { sensitive: true }), c("TOTAL_COST", "currency", { sensitive: true }),
      c("GROSS_PROFIT", "currency", { sensitive: true }), c("GROSS_MARGIN_PERCENTAGE", "percentage", { sensitive: true }),
      c("EBITDA_CONTRIBUTION", "currency", { sensitive: true }), c("BUDGET_VARIANCE", "currency", { sensitive: true }),
      c("RECEIVABLE_OUTSTANDING", "currency", { sensitive: true }), c("PAYABLE_OUTSTANDING", "currency", { sensitive: true }),
      c("COMPLIANCE_EXCEPTION_COUNT", "number"), c("STATUTORY_FILING_STATUS", "status"),
      c("EMPLOYEE_DOCUMENT_COMPLIANCE_PERCENTAGE", "percentage"), c("ASSET_RECOVERY_EXCEPTION_COUNT", "number"),
      c("OVERALL_BUSINESS_HEALTH_SCORE", "percentage"), c("OVERALL_RAG", "status"), c("PRIMARY_RISK"),
      c("MANAGEMENT_DECISION_REQUIRED"), c("DECISION_OWNER"), c("DECISION_DUE_DATE", "date"),
      c("LAST_GOVERNANCE_REVIEW_DATE", "date"), c("NEXT_GOVERNANCE_REVIEW_DATE", "date"), c("DATA_SOURCE"),
    ],
    sourceDomains: ["WORKFORCE", "OPERATIONS", "QUALITY", "WFM", "HR", "PAYROLL", "FINANCE", "COMPLIANCE", "ACTIONS"],
    controlNotes: ["EMPLOYEE_CODE is AGGREGATE because the row is management level.", "All component KPIs must be traceable to detailed employee or transaction reports.", "Financial values require executive/finance export permission."],
  },
];

export function getBpoMasterReport(code: string) {
  return BPO_MASTER_REPORTS.find((report) => report.code === code);
}

export function assertBpoMasterReportCatalog() {
  const codes = new Set<string>();
  for (const report of BPO_MASTER_REPORTS) {
    if (codes.has(report.code)) throw new Error(`Duplicate BPO master report code: ${report.code}`);
    codes.add(report.code);
    if (!report.columns.some((column) => column.key === "EMPLOYEE_CODE")) {
      throw new Error(`${report.code} is missing mandatory EMPLOYEE_CODE`);
    }
    if (!report.columns.some((column) => column.key === "REPORT_DATE")) {
      throw new Error(`${report.code} is missing mandatory REPORT_DATE`);
    }
    for (const column of report.columns) {
      if (column.key !== column.key.toUpperCase() || column.label !== column.label.toUpperCase()) {
        throw new Error(`${report.code} contains non-uppercase header ${column.key}`);
      }
    }
  }
}
