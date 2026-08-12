import { REPORT_CATALOG, type ReportDefinition } from "./report-catalog.js";

export type DeepReportPerspectiveType =
  | "overview"
  | "trend"
  | "register"
  | "exceptions"
  | "reconciliation"
  | "compliance";

export interface DeepReportPerspective {
  type: DeepReportPerspectiveType;
  title: string;
  description: string;
  reportCodes: string[];
}

export interface DeepReportSourceGroup {
  key: string;
  label: string;
  description: string;
  candidateTables: string[];
  required?: boolean;
}

export interface DeepReportPack {
  code: string;
  name: string;
  shortName: string;
  description: string;
  businessOwner: string;
  viewRoles: string[];
  exportRoles: string[];
  relatedRoutes: Array<{ label: string; path: string }>;
  decisionQuestions: string[];
  complianceControls: string[];
  sensitiveDomains: string[];
  perspectives: DeepReportPerspective[];
  sourceGroups: DeepReportSourceGroup[];
}

export interface ResolvedDeepReportPerspective extends DeepReportPerspective {
  reports: ReportDefinition[];
  missingReportCodes: string[];
}

export interface ResolvedDeepReportPack extends Omit<DeepReportPack, "perspectives"> {
  perspectives: ResolvedDeepReportPerspective[];
  reportCount: number;
  missingReportCount: number;
}

const HR = ["super_admin", "admin", "hr", "hr_head"];
const MANAGEMENT = ["super_admin", "admin", "ceo", "coo", "branch_head", "manager", "process_manager"];
const WFM = ["super_admin", "admin", "hr", "hr_head", "wfm", "manager", "process_manager", "branch_head"];
const PAYROLL = ["super_admin", "admin", "payroll", "payroll_head", "payroll_branch", "finance", "hr_head"];
const FINANCE = ["super_admin", "admin", "finance", "finance_head", "accounts_head", "ceo", "coo", "branch_head"];
const RECRUITMENT = ["super_admin", "admin", "hr", "hr_head", "recruiter", "recruitment_head", "recruitment_hr", "branch_head"];
const OPERATIONS = ["super_admin", "admin", "operations", "operations_manager", "quality", "manager", "process_manager", "team_leader", "tl", "branch_head", "ceo", "coo"];
const QUALITY = ["super_admin", "admin", "quality", "qa", "operations", "operations_manager", "manager", "process_manager", "branch_head", "ceo", "coo"];
const TRAINING = ["super_admin", "admin", "hr", "hr_head", "trainer", "training", "manager", "process_manager", "branch_head"];
const IT = ["super_admin", "admin", "it", "it_manager", "hr", "hr_head", "branch_head"];
const SECURITY = ["super_admin", "admin", "security", "security_head", "ceo", "coo", "hr_head"];

const p = (
  type: DeepReportPerspectiveType,
  title: string,
  description: string,
  reportCodes: string[] = []
): DeepReportPerspective => ({ type, title, description, reportCodes });

const s = (
  key: string,
  label: string,
  description: string,
  candidateTables: string[],
  required = true
): DeepReportSourceGroup => ({ key, label, description, candidateTables, required });

export const DEEP_REPORT_PACKS: DeepReportPack[] = [
  {
    code: "people-workforce",
    name: "People, Organisation & Workforce",
    shortName: "People & Org",
    description: "A complete workforce view covering active strength, organisation mapping, employee lifecycle, joiners, exits and master-data exceptions.",
    businessOwner: "HR",
    viewRoles: [...new Set([...HR, ...MANAGEMENT, "wfm", "finance", "payroll"])],
    exportRoles: HR,
    relatedRoutes: [
      { label: "Employees", path: "/employees" },
      { label: "Organisation Chart", path: "/org-chart" },
      { label: "Employee Lifecycle", path: "/employee-lifecycle" },
    ],
    decisionQuestions: [
      "What is the current active workforce by branch, department, process and cost centre?",
      "Which employees have missing or conflicting organisation mappings?",
      "What movements, confirmations, promotions and contract expiries require action?",
    ],
    complianceControls: ["Approved employee master", "Effective-dated job history", "Manager and cost-centre ownership", "Controlled PII export"],
    sensitiveDomains: ["personal contact", "salary", "identity", "banking"],
    perspectives: [
      p("overview", "Workforce control summary", "Active strength, joins, exits and organisation coverage.", ["headcount", "org-structure-snapshot", "cost-centre-headcount"]),
      p("trend", "Workforce movement", "Joiner, exit and tenure movement over time.", ["employee-movement", "monthly-attrition-summary", "tenure-distribution"]),
      p("register", "Employee and reporting register", "Detailed employee master and reporting hierarchy.", ["employee-master", "manager-mapping", "new-join-export", "left-employee-export"]),
      p("exceptions", "Lifecycle exceptions", "Confirmation, contract and mapping issues requiring ownership.", ["confirmation-due-list", "contract-expiry-list", "lifecycle-events"]),
      p("reconciliation", "Organisation reconciliation", "Cost-centre, manager and employee movement consistency.", ["manager-mapping", "cost-centre-headcount"]),
      p("compliance", "HR evidence", "Promotion, increment and employee calendar evidence.", ["increment-promotion-history", "birthday-list", "anniversary-list"]),
    ],
    sourceGroups: [
      s("employee-master", "Employee master", "Canonical employee identity and employment state.", ["employees"]),
      s("organisation", "Organisation masters", "Branch, department, designation, process and cost-centre structures.", ["branch_master", "department_master", "designation_master", "process_master", "cost_centre_master"]),
      s("job-history", "Employee job history", "Effective-dated employee movements and promotions.", ["employee_job_history", "employee_lifecycle_event"], false),
    ],
  },
  {
    code: "recruitment-onboarding",
    name: "Recruitment, ATS, Onboarding & BGV",
    shortName: "Recruitment & ATS",
    description: "Hiring demand through joining, including requisitions, sourcing, pipeline, offers, onboarding documents, BGV and joining readiness.",
    businessOwner: "Recruitment / HR",
    viewRoles: RECRUITMENT,
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "recruitment_head"],
    relatedRoutes: [
      { label: "Job Requisitions", path: "/recruitment/job-requisition" },
      { label: "ATS Command Center", path: "/ats/command-center" },
      { label: "Joining Control Room", path: "/ats/joining-control-room" },
      { label: "BGV Verification", path: "/ats/bgv" },
    ],
    decisionQuestions: [
      "Is approved hiring demand converting into qualified joins on time?",
      "Which recruiter, source, stage or approval is creating delay or leakage?",
      "Which candidates are blocked by offer, document, BGV or employee-code readiness?",
    ],
    complianceControls: ["Approved requisition", "Candidate consent", "Offer approval", "Document and BGV evidence", "Joining audit trail"],
    sensitiveDomains: ["candidate PII", "compensation offer", "identity documents", "BGV results"],
    perspectives: [
      p("overview", "Hiring control summary", "Demand, candidates, offers and joining pipeline.", ["recruitment-pipeline", "ats-pipeline-summary"]),
      p("trend", "Source and recruiter effectiveness", "Conversion, ageing and productivity trends.", ["source-effectiveness", "recruiter-productivity"]),
      p("register", "Candidate and offer registers", "Candidate-level pipeline and offer records.", ["candidate-tracker", "offer-tracker", "offer-to-joining-tracker"]),
      p("exceptions", "Joining blockers", "Pending joins, stalled stages and missing approvals.", ["joining-pending", "missing-documents-report"]),
      p("reconciliation", "ATS-to-employee reconciliation", "Candidate, offer, joining and employee creation consistency.", ["offer-to-joining-tracker", "identity-source-snapshot"]),
      p("compliance", "BGV and joining evidence", "Verification and document compliance status.", ["document-verification-status", "employee-document-compliance"]),
    ],
    sourceGroups: [
      s("requisition", "Hiring demand", "Job requisitions and approved hiring requirements.", ["job_requisition", "job_requisition_master", "ats_job_requisition"]),
      s("candidate", "Candidate pipeline", "Candidate, interview and stage history.", ["ats_candidate", "ats_candidates", "candidate_master", "ats_candidate_master"]),
      s("offer", "Offer and joining", "Offer approval and onboarding conversion.", ["ats_offer", "ats_offer_letter", "ats_onboarding_request", "candidate_onboarding"]),
      s("bgv", "Background verification", "Consent, checks, results and exceptions.", ["bgv_case", "bgv_verification", "candidate_bgv", "bgv_request"], false),
    ],
  },
  {
    code: "attendance-biometric",
    name: "Attendance, Biometric & Regularisation",
    shortName: "Attendance",
    description: "Daily and monthly attendance, biometric evidence, roster adherence, exceptions, disputes, regularisation and shrinkage.",
    businessOwner: "WFM / HR",
    viewRoles: WFM,
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "wfm"],
    relatedRoutes: [
      { label: "Attendance", path: "/attendance" },
      { label: "Biometric Logs", path: "/attendance/biometric-logs" },
      { label: "Regularisation", path: "/attendance-regularization" },
      { label: "Mismatch Queue", path: "/wfm/mismatch-queue" },
    ],
    decisionQuestions: [
      "Who was scheduled, present, absent, late or short-attendance?",
      "Where do biometric, roster and final attendance disagree?",
      "Which disputes, overrides and regularisations affect payroll?",
    ],
    complianceControls: ["Biometric source evidence", "Roster-based shift determination", "Regularisation approval", "Locked attendance audit"],
    sensitiveDomains: ["employee attendance", "location and punch data", "payroll impact"],
    perspectives: [
      p("overview", "Attendance control summary", "Daily and monthly attendance status.", ["attendance-daily", "attendance-summary", "daily-hc-shift"]),
      p("trend", "Attendance and shrinkage trend", "Monthly attendance, absence, late and shrinkage movement.", ["monthly-shrinkage-trend", "late-arrival-summary", "habitual-absentee-list"]),
      p("register", "Attendance registers", "Employee-level daily and monthly evidence.", ["attendance-register-grid", "attendance-register-monthly", "punch-raw-export"]),
      p("exceptions", "Mismatch and exception register", "Biometric mismatch, disputes and regularisation cases.", ["biometric-reconciliation", "regularization-summary", "attendance-dispute-summary"]),
      p("reconciliation", "Roster-to-attendance reconciliation", "Scheduled versus actual time and adherence.", ["shift-adherence-detail", "roster-adherence", "roster-variance"]),
      p("compliance", "Attendance governance", "Overtime and controlled exception evidence.", ["overtime-summary", "attendance-dispute-summary"]),
    ],
    sourceGroups: [
      s("attendance", "Final attendance", "Canonical daily attendance used by payroll.", ["attendance_daily_record"]),
      s("biometric", "Biometric evidence", "Raw and processed punch evidence.", ["biometric_attendance_log", "integration_biometric_daily", "wfm_attendance_session"]),
      s("regularisation", "Regularisation and disputes", "Requests, approvals and manual overrides.", ["attendance_regularization", "attendance_dispute", "attendance_manual_override"]),
    ],
  },
  {
    code: "leave-absence",
    name: "Leave, Holiday & Absence",
    shortName: "Leave",
    description: "Leave entitlement, balances, utilisation, special leave, encashment, holidays and LWP reconciliation.",
    businessOwner: "HR / Payroll",
    viewRoles: [...new Set([...HR, ...WFM, "payroll", "finance"])],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "payroll"],
    relatedRoutes: [
      { label: "Leave Requests", path: "/leaves" },
      { label: "Leave Types", path: "/leave-types" },
      { label: "Maternity Leave", path: "/maternity-leave" },
      { label: "Holiday Master", path: "/payroll/holiday-master" },
    ],
    decisionQuestions: [
      "Are leave balances accurate and policy-compliant?",
      "Which approved leave, LWP and payroll-day values do not reconcile?",
      "Which special leave, lapse or encashment cases require action?",
    ],
    complianceControls: ["Policy-year entitlement", "Approval evidence", "LWP/payroll reconciliation", "Special leave documentation"],
    sensitiveDomains: ["medical and family leave", "payroll impact"],
    perspectives: [
      p("overview", "Leave control summary", "Entitlement, usage and available balance.", ["leave-balance"]),
      p("trend", "Leave utilisation trend", "Leave consumption and absence patterns.", ["leave-utilization"]),
      p("register", "Leave and holiday registers", "Request and holiday evidence.", ["leave-utilization", "holiday-master-list"]),
      p("exceptions", "Leave exceptions", "Negative balances and lapse cases.", ["leave-lapse-summary"]),
      p("reconciliation", "Leave-to-payroll reconciliation", "Approved leave, LWP and payable-day consistency.", ["payroll-reconciliation", "lwp-deduction-register"]),
      p("compliance", "Leave policy evidence", "Leave register and holiday policy compliance.", ["leave-utilization", "holiday-master-list"]),
    ],
    sourceGroups: [
      s("balance", "Leave balances", "Annual entitlement and balance ledger.", ["leave_balance_ledger"]),
      s("requests", "Leave requests", "Request dates, types, approval and usage.", ["leave_request"]),
      s("policy", "Leave policy", "Leave types, accrual and holiday policy.", ["leave_type_master", "leave_policy", "holiday_master"]),
    ],
  },
  {
    code: "wfm-roster-breaks",
    name: "WFM, Roster, Capacity & Breaks",
    shortName: "WFM & Roster",
    description: "Forecast demand, roster publication, shift coverage, capacity, preferences, swaps, week-offs, real-time adherence and break behaviour.",
    businessOwner: "WFM / Operations",
    viewRoles: [...new Set([...WFM, ...OPERATIONS])],
    exportRoles: ["super_admin", "admin", "wfm", "operations_manager"],
    relatedRoutes: [
      { label: "Roster", path: "/wfm/roster" },
      { label: "Workforce Planning", path: "/workforce-planning" },
      { label: "RTA Board", path: "/rta-board" },
      { label: "Break Reports", path: "/break-reports" },
    ],
    decisionQuestions: [
      "Does published staffing meet process and interval demand?",
      "Where do roster, attendance, capacity and actual staffing differ?",
      "Which week-off, swap, preference or break patterns need intervention?",
    ],
    complianceControls: ["Approved roster version", "Capacity controls", "Week-off fairness", "Break and adherence audit"],
    sensitiveDomains: ["employee schedule", "attendance", "break behaviour"],
    perspectives: [
      p("overview", "Roster coverage summary", "Published staffing, shift and capacity coverage.", ["roster-published", "daily-hc-shift"]),
      p("trend", "Coverage and adherence trend", "Roster adherence and variance movement.", ["roster-adherence", "monthly-shrinkage-trend"]),
      p("register", "Roster and week-off registers", "Employee-level roster and week-off details.", ["roster-published", "week-off-calendar"]),
      p("exceptions", "Roster exceptions", "Swaps, preference and variance exceptions.", ["shift-swap-register", "roster-variance"]),
      p("reconciliation", "Plan-to-actual reconciliation", "Demand, roster and attendance alignment.", ["roster-variance", "shift-adherence-detail"]),
      p("compliance", "WFM governance", "Publication, swap and week-off evidence.", ["shift-swap-register", "week-off-calendar"]),
    ],
    sourceGroups: [
      s("roster", "Roster assignments", "Published employee/date shift assignment.", ["wfm_roster_assignment"]),
      s("shifts", "Shift masters", "Shift timings and rotation configuration.", ["wfm_shift_master", "wfm_shift_template"]),
      s("planning", "Planning and capacity", "Forecast, slot and weekly roster lifecycle.", ["weekly_roster_cycle", "wfm_slot_requirement", "process_weekoff_capacity"], false),
      s("breaks", "Break management", "Break sessions, devices and exceptions.", ["break_session", "break_management_session", "employee_break_log"], false),
    ],
  },
  {
    code: "payroll-compensation",
    name: "Payroll, Compensation & Disbursal",
    shortName: "Payroll",
    description: "Payroll readiness, calculation, salary components, variances, deductions, payslips, disbursal, loans, reimbursements and sign-off.",
    businessOwner: "Payroll / Finance",
    viewRoles: PAYROLL,
    exportRoles: ["super_admin", "admin", "payroll", "payroll_head", "finance"],
    relatedRoutes: [
      { label: "Payroll", path: "/payroll" },
      { label: "Validation", path: "/payroll/validation" },
      { label: "Disbursal", path: "/payroll/disbursal" },
      { label: "Sign-off", path: "/payroll/sign-off" },
    ],
    decisionQuestions: [
      "Is every branch and process ready for payroll calculation?",
      "Which employees have material month-on-month or attendance-to-payroll variances?",
      "Do calculated, disbursed and payslip totals reconcile?",
    ],
    complianceControls: ["Maker-checker payroll run", "Attendance/payable-day reconciliation", "Bank validation", "Final sign-off and immutable audit"],
    sensitiveDomains: ["salary", "bank account", "tax", "loans and deductions"],
    perspectives: [
      p("overview", "Payroll control summary", "Run, readiness, gross, deductions and net pay.", ["payroll-register", "payroll-readiness-status"]),
      p("trend", "Payroll cost and variance", "Month-on-month cost and variance.", ["payroll-variance", "ytd-salary-summary", "cost-centre-salary-summary"]),
      p("register", "Salary and disbursal registers", "Employee-level salary, bank and transfer outputs.", ["salary-sheet-export", "bank-advice", "neft-transfer-file"]),
      p("exceptions", "Payroll exceptions", "Missing bank, high variance, LWP and recalculation issues.", ["bank-missing", "payroll-variance", "lwp-deduction-register", "payslip-status"]),
      p("reconciliation", "Payroll reconciliation", "Attendance, run, disbursal and payslip consistency.", ["payroll-reconciliation", "payslip-status"]),
      p("compliance", "Compensation audit", "Arrears, increments, advances and approvals.", ["arrear-payment-register", "increment-requests", "salary-advance-register"]),
    ],
    sourceGroups: [
      s("run", "Payroll runs", "Payroll month, status and sign-off lifecycle.", ["salary_prep_run"]),
      s("lines", "Payroll lines", "Employee salary calculation and payable days.", ["salary_prep_line"]),
      s("components", "Salary components", "Earnings and deduction breakdown.", ["salary_prep_line_component", "salary_component_assignment"]),
      s("disbursal", "Disbursal and payslips", "Bank transfer, payment and payslip evidence.", ["payroll_disbursal", "salary_payslip", "payroll_payment_transaction"], false),
    ],
  },
  {
    code: "statutory-tax",
    name: "Statutory, Tax & Labour Compliance",
    shortName: "Statutory",
    description: "PF, ESIC, PT, TDS, declarations, Form 16, gratuity, filings, opt-outs and statutory identity readiness.",
    businessOwner: "Payroll / Finance / HR",
    viewRoles: PAYROLL,
    exportRoles: ["super_admin", "admin", "payroll", "payroll_head", "finance"],
    relatedRoutes: [
      { label: "Statutory Configuration", path: "/payroll/statutory-config" },
      { label: "Statutory Filing", path: "/payroll/statutory-filing" },
      { label: "EPF Compliance", path: "/payroll/epf-compliance" },
      { label: "Tax Declaration", path: "/payroll/tax-declaration" },
    ],
    decisionQuestions: [
      "Are all eligible employees correctly registered and contributed?",
      "Do payroll deductions reconcile with statutory registers and filing totals?",
      "Which identity, declaration, opt-out or filing exception remains unresolved?",
    ],
    complianceControls: ["Eligibility rules", "Contribution basis", "Filing due dates", "Identity verification", "Approval and payment evidence"],
    sensitiveDomains: ["UAN", "ESIC", "PAN", "tax declaration", "salary"],
    perspectives: [
      p("overview", "Statutory readiness", "PF, ESIC, PT and tax readiness.", ["pf-monthly-summary", "esic-monthly-summary", "pt-monthly-register"]),
      p("trend", "Contribution trend", "Contribution and liability movement.", ["pf-contribution-register", "esic-contribution-register", "gratuity-liability-register"]),
      p("register", "Statutory registers", "Employee-level statutory computation.", ["pf-esic-salary-register", "pf-contribution-register", "esic-contribution-register", "pt-register"]),
      p("exceptions", "Statutory exceptions", "Missing identity, opt-out and declaration issues.", ["pf-esi-optout-register", "uan-status-report", "esic-status-report", "pan-verification-status"]),
      p("reconciliation", "Payroll-to-filing reconciliation", "Payroll deductions against statutory outputs.", ["pf-ecr-format", "tds-computation-register"]),
      p("compliance", "Tax and filing evidence", "Declarations, Form 16 and filing status.", ["investment-declaration-status", "form-16-status", "pf-ecr-format"]),
    ],
    sourceGroups: [
      s("statutory", "Employee statutory profile", "PF, ESIC, PAN and eligibility identity.", ["employee_statutory", "employee_epf_compliance", "employee_identity"]),
      s("contribution", "Contribution ledger", "Payroll statutory calculations.", ["payroll_statutory_contribution", "salary_prep_line"]),
      s("filing", "Filing and payment", "Return, challan and filing evidence.", ["statutory_filing_tracker", "pf_creation_batch", "pf_batch"]),
      s("tax", "Tax declarations", "Investment declaration and tax computation.", ["tax_declaration", "investment_declaration", "form16_record"], false),
    ],
  },
  {
    code: "exit-attrition",
    name: "Exit, Separation & Attrition",
    shortName: "Exit & Attrition",
    description: "Resignation through final settlement, including clearance, notice period, exit reason, early attrition and F&F readiness.",
    businessOwner: "HR / Payroll / Finance",
    viewRoles: [...new Set([...HR, ...MANAGEMENT, "payroll", "finance"])],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "payroll", "finance"],
    relatedRoutes: [
      { label: "Exit Command Center", path: "/exit/command-center" },
      { label: "Full & Final", path: "/payroll/full-final" },
      { label: "NOC", path: "/payroll/noc" },
    ],
    decisionQuestions: [
      "Which resignations, notice periods, clearances or settlements are overdue?",
      "What are the leading reasons and tenure bands for attrition?",
      "Do HR exit dates, asset clearance and F&F values reconcile?",
    ],
    complianceControls: ["Resignation approval", "Notice-period rules", "Department clearance", "F&F maker-checker", "Exit document retention"],
    sensitiveDomains: ["exit reason", "settlement", "disciplinary and grievance information"],
    perspectives: [
      p("overview", "Exit control summary", "Open resignations, pending clearances and settlements.", ["resignation-register", "fnf-pending-register"]),
      p("trend", "Attrition trend", "Monthly, reason and tenure attrition.", ["monthly-attrition-summary", "exit-reason-analysis", "tenure-distribution"]),
      p("register", "Exit and settlement registers", "Employee-level exit and F&F evidence.", ["exit-movement-report", "fnf-settlement-register", "ff-settlement-register"]),
      p("exceptions", "Exit blockers", "Early attrition, pending clearance and settlement cases.", ["early-attrition-report", "clearance-status-register", "fnf-pending-register"]),
      p("reconciliation", "Exit reconciliation", "Employee status, clearance and settlement consistency.", ["clearance-status-register", "fnf-settlement-register"]),
      p("compliance", "Separation evidence", "Approved resignation, clearance and F&F records.", ["resignation-register", "ff-settlement-register"]),
    ],
    sourceGroups: [
      s("resignation", "Resignation cases", "Request, approval and notice period.", ["resignation_request", "employee_resignation"]),
      s("exit", "Exit lifecycle", "Exit case, dates and reasons.", ["exit_case", "employee_exit", "exit_movement"]),
      s("clearance", "Clearance", "Department and asset clearance.", ["exit_clearance", "clearance_task", "employee_clearance"]),
      s("fnf", "Full and final", "Settlement calculation and approval.", ["fnf_settlement", "full_final_settlement"]),
    ],
  },
  {
    code: "finance-profitability",
    name: "Finance, Vendor, GRN & Profitability",
    shortName: "Finance & P&L",
    description: "Vendor master, budget, GRN, payment, accrual, cash, Process/LOB profitability, allocation and period-close governance.",
    businessOwner: "Finance / Accounts",
    viewRoles: FINANCE,
    exportRoles: ["super_admin", "admin", "finance", "finance_head", "accounts_head"],
    relatedRoutes: [
      { label: "Vendors", path: "/vendors" },
      { label: "GRN", path: "/finance/grn" },
      { label: "Vendor Payments", path: "/finance/vendor-payment-tracking" },
      { label: "Process P&L", path: "/finance/process-pnl" },
      { label: "LOB Profitability", path: "/finance/process-pnl/lobs" },
      { label: "Period Close", path: "/finance/process-pnl/period-close" },
    ],
    decisionQuestions: [
      "Do budget, GRN, payable, cash and P&L amounts reconcile?",
      "Which Process or LOB is profitable, loss-making or missing commercial evidence?",
      "Which period-close blockers, allocations or vendor obligations require action?",
    ],
    complianceControls: ["Vendor due diligence", "Budget approval", "GRN maker-checker", "Recognition period", "Payment evidence", "Immutable close snapshot"],
    sensitiveDomains: ["vendor tax and bank", "commercial rate", "profitability", "payment reference"],
    perspectives: [
      p("overview", "Finance control summary", "Vendor spend, payable, cash and profitability coverage.", ["cost-centre-salary-summary", "process-lob-salary-cost"]),
      p("trend", "Cost and profitability trend", "Payroll cost and Process/LOB profitability movement.", ["ytd-salary-summary", "process-lob-salary-cost"]),
      p("register", "Vendor and payment registers", "Vendor, GRN and payment transaction evidence.", []),
      p("exceptions", "Finance exceptions", "Unallocated GRNs, overdue payments and P&L blockers.", []),
      p("reconciliation", "Budget-to-cash-to-P&L reconciliation", "Budget, GRN, payable, cash and recognised cost alignment.", ["payroll-reconciliation"]),
      p("compliance", "Period-close evidence", "Sign-off, snapshot and audit evidence.", []),
    ],
    sourceGroups: [
      s("vendor", "Vendor master", "Vendor identity, status, tax and payment terms.", ["vendor_master"]),
      s("budget", "Finance budget", "Budget headers and lines.", ["finance_budget", "finance_budget_line"]),
      s("grn", "GRN and allocation", "Invoice/GRN workflow and P&L allocations.", ["grn_request", "grn_cost_allocation"]),
      s("payment", "Vendor payment", "Payable, installments and payment proof.", ["vendor_payment_tracking", "vendor_payment_transaction"]),
      s("pnl", "Process and LOB P&L", "Commercial rules, delivery, costs and close snapshots.", ["process_lob_master", "process_lob_monthly_plan", "process_revenue_rule", "process_delivery_actual", "finance_period", "pnl_period_snapshot"]),
    ],
  },
  {
    code: "operations-productivity",
    name: "Operations, Productivity & Business Actions",
    shortName: "Operations",
    description: "Process delivery, employee and team productivity, SLA, action ownership and operational performance.",
    businessOwner: "Operations",
    viewRoles: OPERATIONS,
    exportRoles: ["super_admin", "admin", "operations", "operations_manager", "manager", "process_manager"],
    relatedRoutes: [
      { label: "Business Command Center", path: "/business-command-center" },
      { label: "Business Actions", path: "/business-actions" },
      { label: "Performance Dashboard", path: "/performance-dashboard" },
    ],
    decisionQuestions: [
      "Which process, team or agent is missing productivity, SLA or staffing expectations?",
      "What is driving performance movement?",
      "Which action is overdue and who owns recovery?",
    ],
    complianceControls: ["Approved KPI definition", "Source-system lineage", "Role-based performance visibility", "Action ownership and closure evidence"],
    sensitiveDomains: ["employee performance", "client SLA", "commercial output"],
    perspectives: [
      p("overview", "Operational scorecard", "Process, team and agent performance.", ["agent-performance-summary", "team-performance-summary"]),
      p("trend", "Productivity trend", "Employee and team productivity movement.", ["productivity-individual-scorecard", "team-performance-summary"]),
      p("register", "Performance register", "Detailed agent and team measures.", ["agent-performance-summary", "productivity-individual-scorecard"]),
      p("exceptions", "Underperformance and action queue", "Threshold misses and recovery ownership.", ["fatal-error-register"]),
      p("reconciliation", "Source-to-KPI reconciliation", "KPI facts against source-system activity.", ["productivity-individual-scorecard"]),
      p("compliance", "Operations governance", "KPI definition and action closure evidence.", ["team-performance-summary"]),
    ],
    sourceGroups: [
      s("kpi", "KPI facts", "Configured KPIs and actual performance.", ["kpi_master", "kpi_actual", "performance_daily_fact"]),
      s("delivery", "Operational delivery", "Process output and source-system facts.", ["process_delivery_actual", "apr_daily_fact", "dialer_daily_fact"]),
      s("actions", "Business actions", "Risk, owner, due date and closure.", ["business_action", "business_actions", "business_action_item"]),
    ],
  },
  {
    code: "quality-risk",
    name: "Quality, Audit & Process Risk",
    shortName: "Quality",
    description: "Quality audits, defect and fatal-error patterns, analyst/team performance, calibration and corrective action.",
    businessOwner: "Quality",
    viewRoles: QUALITY,
    exportRoles: ["super_admin", "admin", "quality", "qa", "operations_manager"],
    relatedRoutes: [
      { label: "Quality Dashboard", path: "/quality-dashboard" },
      { label: "Performance Dashboard", path: "/performance-dashboard" },
    ],
    decisionQuestions: [
      "Where are quality, fatal and repeat-error risks concentrated?",
      "Which agent, team, process, tenure or error type is driving failure?",
      "Are calibrations and corrective actions reducing recurrence?",
    ],
    complianceControls: ["Audit sample lineage", "Approved quality form", "Fatal-error governance", "Calibration and corrective-action evidence"],
    sensitiveDomains: ["employee performance", "client data", "audit evidence"],
    perspectives: [
      p("overview", "Quality scorecard", "Quality and fatal-error summary.", ["quality-audit-log", "fatal-error-register"]),
      p("trend", "Quality trend", "Quality score and defect movement.", ["agent-performance-summary", "team-performance-summary"]),
      p("register", "Audit register", "Audit-level evidence and findings.", ["quality-audit-log"]),
      p("exceptions", "Fatal and repeat errors", "Critical failures requiring action.", ["fatal-error-register"]),
      p("reconciliation", "Audit coverage", "Production activity against audit sample coverage.", ["quality-audit-log"]),
      p("compliance", "Quality governance", "Audit, calibration and action evidence.", ["quality-audit-log", "fatal-error-register"]),
    ],
    sourceGroups: [
      s("audit", "Quality audits", "Audit score, error and evaluator evidence.", ["quality_audit", "quality_audit_log", "qa_audit"]),
      s("fatal", "Fatal errors", "Fatal and critical error register.", ["fatal_error", "quality_fatal_error"]),
      s("summary", "Quality facts", "Agent, team and process quality aggregates.", ["quality_daily_summary", "quality_performance_fact"]),
      s("calibration", "Calibration", "Calibration participation and variance.", ["quality_calibration", "calibration_session"], false),
    ],
  },
  {
    code: "performance-career",
    name: "Performance, KPI, Feedback & Career",
    shortName: "Performance",
    description: "Goals, KPI scorecards, feedback, review cycles, PIP, capability and career progression.",
    businessOwner: "HR / Operations",
    viewRoles: [...new Set([...HR, ...OPERATIONS])],
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "manager", "process_manager"],
    relatedRoutes: [
      { label: "Performance Dashboard", path: "/performance-dashboard" },
      { label: "Career Planning", path: "/career-planning" },
      { label: "PIP Management", path: "/pip-management" },
    ],
    decisionQuestions: [
      "Are goals and KPIs complete, approved and evidence-backed?",
      "Which employees or teams are improving, declining or missing reviews?",
      "Which PIP, feedback or career action is overdue?",
    ],
    complianceControls: ["Approved KPI and goal", "Evidence-backed rating", "Review sign-off", "Fair PIP governance", "Restricted employee visibility"],
    sensitiveDomains: ["performance rating", "feedback", "PIP", "career plans"],
    perspectives: [
      p("overview", "Performance control summary", "Goal, KPI and review completion.", ["agent-performance-summary", "team-performance-summary"]),
      p("trend", "Performance trend", "Score movement by employee and team.", ["productivity-individual-scorecard"]),
      p("register", "Performance register", "Employee-level KPI and scorecard detail.", ["productivity-individual-scorecard", "agent-performance-summary"]),
      p("exceptions", "Review and PIP exceptions", "Missing reviews, declining scores and overdue actions.", []),
      p("reconciliation", "KPI evidence reconciliation", "Ratings against KPI and source evidence.", ["productivity-individual-scorecard"]),
      p("compliance", "Performance governance", "Review, feedback and PIP approvals.", []),
    ],
    sourceGroups: [
      s("goals", "Goals", "Employee and team goals.", ["performance_goal", "employee_goal", "goals"]),
      s("feedback", "Feedback and reviews", "Review cycle, feedback and rating.", ["performance_feedback", "performance_review", "feedback_cycle"]),
      s("kpi", "KPI performance", "KPI definitions and actuals.", ["kpi_master", "kpi_actual", "performance_daily_fact"]),
      s("pip", "Performance improvement", "PIP case, milestones and outcomes.", ["pip_case", "performance_improvement_plan"], false),
      s("career", "Career planning", "Career aspiration and succession readiness.", ["career_plan", "career_path", "succession_plan"], false),
    ],
  },
  {
    code: "training-lms",
    name: "Training, LMS & Certification",
    shortName: "Training & LMS",
    description: "Training demand, batches, enrolment, completion, assessment, certification, trainer and learning effectiveness.",
    businessOwner: "Training / HR",
    viewRoles: TRAINING,
    exportRoles: ["super_admin", "admin", "hr", "hr_head", "trainer", "training"],
    relatedRoutes: [
      { label: "Training", path: "/training" },
      { label: "LMS", path: "/lms" },
    ],
    decisionQuestions: [
      "Who is enrolled, completed, certified or overdue?",
      "Which batch, module, trainer or assessment is underperforming?",
      "Does training completion translate into operational readiness?",
    ],
    complianceControls: ["Assigned curriculum", "Attendance and completion evidence", "Assessment integrity", "Certification expiry", "Trainer ownership"],
    sensitiveDomains: ["learner assessment", "performance"],
    perspectives: [
      p("overview", "Learning control summary", "Enrolment, completion and certification status.", ["training-completion-status", "certification-status"]),
      p("trend", "Learning effectiveness", "Completion, score and certification movement.", ["training-batch-summary"]),
      p("register", "Training registers", "Learner, batch and certification details.", ["training-completion-status", "training-batch-summary", "certification-status"]),
      p("exceptions", "Learning exceptions", "Overdue, failed and expiring certification cases.", ["certification-status"]),
      p("reconciliation", "Training-to-readiness reconciliation", "Training completion against employee/process assignment.", ["training-completion-status"]),
      p("compliance", "Training evidence", "Attendance, assessment and certificate evidence.", ["certification-status", "training-batch-summary"]),
    ],
    sourceGroups: [
      s("course", "Courses and curriculum", "Course, module and assigned curriculum.", ["lms_course", "training_course", "learning_module"]),
      s("enrolment", "Enrolment and progress", "Learner assignment, attendance and completion.", ["lms_enrollment", "training_enrollment", "learner_progress"]),
      s("batch", "Training batches", "Batch, trainer and schedule.", ["training_batch", "lms_batch"]),
      s("certification", "Certification", "Certificate status and expiry.", ["employee_certification", "lms_certification", "certification_record"], false),
    ],
  },
  {
    code: "assets-it",
    name: "Assets, IT Provisioning & Service",
    shortName: "Assets & IT",
    description: "Asset inventory, assignment, return, movement, repair, provisioning, official access and IT service readiness.",
    businessOwner: "IT / Administration",
    viewRoles: IT,
    exportRoles: ["super_admin", "admin", "it", "it_manager"],
    relatedRoutes: [
      { label: "Asset Manager", path: "/assets-manager" },
      { label: "IT Dashboard", path: "/it-dashboard" },
      { label: "Helpdesk", path: "/helpdesk" },
    ],
    decisionQuestions: [
      "Where is every asset and who is accountable for it?",
      "Which joiner, transfer or exit has incomplete IT provisioning or recovery?",
      "Which asset is overdue, damaged, lost, in repair or unsupported?",
    ],
    complianceControls: ["Asset custody", "Provisioning approval", "Return condition evidence", "Service and movement history", "Access deprovisioning"],
    sensitiveDomains: ["asset identifiers", "system accounts", "employee assignment"],
    perspectives: [
      p("overview", "Asset and IT control summary", "Inventory, allocation and provisioning status.", ["asset-inventory", "asset-inventory-report"]),
      p("trend", "Asset movement and service trend", "Assignments, returns and service movement.", ["asset-movement-log"]),
      p("register", "Asset registers", "Inventory, allocation and movement records.", ["asset-inventory-report", "asset-allocation-register", "asset-movement-log"]),
      p("exceptions", "Asset and provisioning exceptions", "Unassigned, overdue, damaged, lost and incomplete provisioning.", ["asset-inventory"]),
      p("reconciliation", "Employee-to-asset reconciliation", "Active employee, assignment and return consistency.", ["asset-allocation-register"]),
      p("compliance", "IT custody evidence", "Assignment, movement and return audit.", ["asset-movement-log"]),
    ],
    sourceGroups: [
      s("assets", "Asset inventory", "Asset master and current state.", ["asset_master", "assets"]),
      s("assignment", "Asset custody", "Assignment, return and movement.", ["asset_assignment", "asset_movement", "asset_allocation"]),
      s("provisioning", "IT provisioning", "Joiner and lifecycle IT tasks.", ["it_provisioning_task", "employee_it_provisioning"]),
      s("service", "Asset service", "Repair, maintenance and service history.", ["asset_service_log", "asset_repair_log"], false),
    ],
  },
  {
    code: "support-grievance",
    name: "Helpdesk, Grievance & Support",
    shortName: "Support",
    description: "Helpdesk, employee grievance, support request, SLA, ageing, ownership, escalation and resolution quality.",
    businessOwner: "IT / HR / Support",
    viewRoles: [...new Set([...IT, ...HR, ...MANAGEMENT])],
    exportRoles: ["super_admin", "admin", "it_manager", "hr", "hr_head"],
    relatedRoutes: [
      { label: "Helpdesk", path: "/helpdesk" },
      { label: "Support Command Center", path: "/support/command-center" },
      { label: "Grievance Command Center", path: "/support/grievance-command-center" },
      { label: "Work Inbox", path: "/work-inbox" },
    ],
    decisionQuestions: [
      "Which request, ticket or grievance is overdue or unowned?",
      "Where are volume, SLA breaches and repeat issues concentrated?",
      "Are escalations, investigation and closure evidence complete?",
    ],
    complianceControls: ["Case ownership", "SLA clock", "Escalation evidence", "Confidential grievance access", "Resolution audit"],
    sensitiveDomains: ["grievance", "employee complaint", "support conversation"],
    perspectives: [
      p("overview", "Support control summary", "Open, overdue, SLA and ownership status.", []),
      p("trend", "Demand and SLA trend", "Ticket and grievance volume, ageing and SLA movement.", []),
      p("register", "Case registers", "Ticket, grievance and support request details.", []),
      p("exceptions", "Escalations and breaches", "Overdue, unassigned and reopened cases.", []),
      p("reconciliation", "Case-to-action reconciliation", "Cases against assigned tasks and closure evidence.", []),
      p("compliance", "Support governance", "Confidential access, investigation and closure audit.", []),
    ],
    sourceGroups: [
      s("helpdesk", "Helpdesk tickets", "IT/helpdesk ticket lifecycle.", ["helpdesk_ticket", "it_helpdesk_ticket"]),
      s("grievance", "Employee grievances", "Grievance, investigation and resolution.", ["grievance_case", "employee_grievance"]),
      s("support", "Support requests", "Cross-functional support request and dispatch.", ["support_request", "support_case"]),
      s("work", "Work inbox", "Assigned actions and closure.", ["work_inbox_item", "task"]),
    ],
  },
  {
    code: "documents-identity-privacy",
    name: "Documents, Identity, BGV & Privacy",
    shortName: "Documents & Privacy",
    description: "Employee and candidate documents, identity mapping, expiry, verification, consent, retention, legal hold and DPDP requests.",
    businessOwner: "HR / Compliance / Payroll",
    viewRoles: [...new Set([...HR, ...PAYROLL, "compliance", "privacy_officer"])],
    exportRoles: ["super_admin", "admin", "hr_head", "payroll_head", "compliance", "privacy_officer"],
    relatedRoutes: [
      { label: "Document Verification", path: "/document-verification" },
      { label: "Joining Documents", path: "/ats/joining-documents-tracker" },
      { label: "Employee BGV", path: "/employees/bgv-status" },
    ],
    decisionQuestions: [
      "Which required document or identity record is missing, unverified or expiring?",
      "Do ATS, onboarding, employee, payroll and statutory identities reconcile?",
      "Are consent, retention, legal hold and privacy requests being honoured?",
    ],
    complianceControls: ["Purpose and consent", "Document access control", "Verification evidence", "Retention schedule", "Legal hold", "Privacy request SLA"],
    sensitiveDomains: ["Aadhaar", "PAN", "bank", "passport", "BGV", "candidate and employee documents"],
    perspectives: [
      p("overview", "Document and identity readiness", "Missing, verified, expiring and mapped identity status.", ["employee-document-compliance", "identity-source-snapshot"]),
      p("trend", "Compliance trend", "Verification and expiry movement.", ["document-expiry-tracker"]),
      p("register", "Document and identity registers", "Document, UAN, ESIC, PAN and bank status.", ["document-verification-status", "uan-master-register", "bank-account-verification"]),
      p("exceptions", "Identity and document exceptions", "Missing, expiring, inconsistent and unverified items.", ["missing-documents-report", "document-expiry-tracker", "pan-verification-status"]),
      p("reconciliation", "Cross-system identity reconciliation", "ATS, HRMS, payroll and source identity consistency.", ["identity-source-snapshot", "uan-status-report", "esic-status-report"]),
      p("compliance", "Privacy and retention evidence", "Consent, retention, access and legal-hold evidence.", ["employee-document-compliance"]),
    ],
    sourceGroups: [
      s("documents", "Document inventory", "Employee/candidate document metadata and verification.", ["employee_document", "employee_documents", "document_vault", "joining_document"]),
      s("identity", "Identity sources", "PAN, UAN, ESIC, bank and cross-system identity.", ["employee_identity", "identity_source_snapshot", "employee_statutory"]),
      s("privacy", "Privacy governance", "Consent, withdrawal, retention and data-subject requests.", ["dpdp_consent", "privacy_request", "dpdp_withdrawal", "document_retention"]),
      s("bgv", "BGV evidence", "Verification case and result.", ["bgv_case", "bgv_verification", "employee_bgv"]),
    ],
  },
  {
    code: "engagement-experience",
    name: "Engagement, Communication & People Experience",
    shortName: "Engagement",
    description: "Kudos, badges, surveys, company feed, employee experience cases, communication reach and engagement participation.",
    businessOwner: "HR / People Experience",
    viewRoles: [...new Set([...HR, ...MANAGEMENT])],
    exportRoles: ["super_admin", "admin", "hr", "hr_head"],
    relatedRoutes: [
      { label: "People Experience", path: "/people-experience/command-center" },
      { label: "Company Feed", path: "/engagement/company-feed" },
      { label: "Kudos", path: "/engagement/kudos" },
      { label: "Surveys", path: "/engagement/surveys" },
    ],
    decisionQuestions: [
      "Which branches, processes or teams have low participation or sentiment?",
      "What themes are emerging from surveys and experience cases?",
      "Are communication approvals, reach and acknowledgements complete?",
    ],
    complianceControls: ["Survey confidentiality", "Content approval", "Communication consent/preferences", "Experience-case access"],
    sensitiveDomains: ["survey response", "employee sentiment", "experience case"],
    perspectives: [
      p("overview", "Engagement summary", "Participation, recognition and communication reach.", []),
      p("trend", "Engagement and sentiment trend", "Kudos, survey and experience movement.", []),
      p("register", "Engagement registers", "Kudos, badges, survey and communication detail.", []),
      p("exceptions", "Experience exceptions", "Low participation, unresolved cases and failed communication.", []),
      p("reconciliation", "Audience reconciliation", "Target audience against delivery and acknowledgement.", []),
      p("compliance", "Engagement governance", "Approval, privacy and communication evidence.", []),
    ],
    sourceGroups: [
      s("recognition", "Recognition", "Kudos, badges and leaderboard events.", ["engagement_kudos", "kudos", "badge_award", "employee_badge"]),
      s("survey", "Surveys", "Survey, response and participation.", ["engagement_survey", "survey", "survey_response"]),
      s("feed", "Company feed", "Approved posts, reactions and comments.", ["company_posts", "company_post_likes", "company_post_comments"]),
      s("experience", "People experience", "Employee experience cases and actions.", ["people_experience_case", "employee_experience_case"], false),
      s("communication", "Communication", "Dispatch, delivery and acknowledgement.", ["communication_dispatch", "notification_log", "email_dispatch_history"], false),
    ],
  },
  {
    code: "security-access-audit",
    name: "Security, Access, Audit & Policy",
    shortName: "Security & Audit",
    description: "Authentication, roles, page access, privileged changes, sensitive actions, policy exceptions and security events.",
    businessOwner: "Security / Super Administration",
    viewRoles: SECURITY,
    exportRoles: ["super_admin", "security_head"],
    relatedRoutes: [
      { label: "Security Center", path: "/security-center" },
      { label: "Access Control", path: "/settings/access-control" },
      { label: "Audit Log", path: "/audit-log" },
      { label: "Policy Engine", path: "/super-admin/policy-engine" },
    ],
    decisionQuestions: [
      "Who has privileged or sensitive access and why?",
      "Which access, authentication or policy events are anomalous or overdue?",
      "Can every sensitive change be traced to an actor, reason and approval?",
    ],
    complianceControls: ["Least privilege", "Segregation of duties", "Session and authentication security", "Immutable audit", "Periodic access review"],
    sensitiveDomains: ["authentication", "role assignment", "audit evidence", "security incidents"],
    perspectives: [
      p("overview", "Security control summary", "Active access, sessions and security event status.", []),
      p("trend", "Security event trend", "Authentication, access and policy movement.", []),
      p("register", "Access and audit registers", "Roles, access and sensitive actions.", []),
      p("exceptions", "Security exceptions", "Excess access, failed authentication and policy violations.", []),
      p("reconciliation", "Access reconciliation", "Employee status against users, roles and page access.", ["identity-source-snapshot"]),
      p("compliance", "Access review evidence", "Privileged access and audit completeness.", []),
    ],
    sourceGroups: [
      s("users", "Users and sessions", "User, session and authentication state.", ["auth_user", "users", "auth_session", "refresh_token"]),
      s("roles", "Roles and page access", "Role assignment and page/module permissions.", ["user_role_assignment", "user_roles", "role_page_access", "page_access"]),
      s("audit", "Audit log", "Sensitive and administrative actions.", ["audit_log", "sensitive_action_log"]),
      s("security", "Security events", "Authentication and security alerts.", ["security_event", "auth_security_event"]),
      s("policy", "Policy decisions", "Policy configuration and exception history.", ["policy_rule", "policy_decision_log"], false),
    ],
  },
  {
    code: "integration-data-quality",
    name: "Integration, Migration & Data Quality",
    shortName: "Integration & Data",
    description: "Integration runs, sync health, external-system identity, migration status, schema drift, mapping exceptions and data-quality controls.",
    businessOwner: "IT / Data Governance",
    viewRoles: ["super_admin", "admin", "it", "it_manager", "hr_head", "payroll_head", "wfm"],
    exportRoles: ["super_admin", "admin", "it_manager"],
    relatedRoutes: [
      { label: "Integration Hub", path: "/integration-hub" },
      { label: "Migration Console", path: "/migration-console" },
      { label: "COSEC Monitoring", path: "/wfm/cosec-monitoring" },
      { label: "ATS Reconciliation", path: "/ats/reconciliation" },
    ],
    decisionQuestions: [
      "Which integration, mapping or migration is failed, delayed or incomplete?",
      "Where do external source identities and HRMS masters disagree?",
      "Which schema or data-quality issue can make a report misleading?",
    ],
    complianceControls: ["Source lineage", "Reconciliation evidence", "Retry and failure ownership", "Migration ledger", "Schema and checksum governance"],
    sensitiveDomains: ["integration credentials metadata", "identity mapping", "migration and error logs"],
    perspectives: [
      p("overview", "Integration control summary", "Run, success, failure and freshness status.", ["identity-source-snapshot"]),
      p("trend", "Integration reliability trend", "Failure, latency and freshness movement.", []),
      p("register", "Integration and migration registers", "Run and migration details.", []),
      p("exceptions", "Mapping and data-quality exceptions", "Unmapped and conflicting identities.", ["identity-source-snapshot", "uan-status-report"]),
      p("reconciliation", "Cross-system reconciliation", "Source against HRMS master consistency.", ["identity-source-snapshot"]),
      p("compliance", "Data governance evidence", "Migration, checksum and error-resolution evidence.", []),
    ],
    sourceGroups: [
      s("integration", "Integration runs", "Run status, duration, records and errors.", ["integration_run", "integration_job_run", "sync_run"]),
      s("errors", "Integration errors", "Failure and retry evidence.", ["integration_error", "sync_error", "integration_dead_letter"]),
      s("identity", "Identity mapping", "External-source identity snapshot and mapping.", ["identity_source_snapshot", "identity_mapping"]),
      s("migration", "Migration ledger", "Applied migration, checksum and executor.", ["schema_migrations", "migration_log"]),
      s("cosec", "COSEC sync", "Biometric sync and unmapped users.", ["cosec_sync_log", "cosec_punch_sync", "biometric_attendance_log"], false),
    ],
  },
  {
    code: "visitor-workplace",
    name: "Visitor, Workplace & Facilities",
    shortName: "Visitor & Workplace",
    description: "Visitor registration, approvals, check-in/out, host response, security desk, branch configuration and workplace exceptions.",
    businessOwner: "Administration / Security",
    viewRoles: ["super_admin", "admin", "security", "security_head", "branch_head", "hr", "facility_manager"],
    exportRoles: ["super_admin", "admin", "security_head", "facility_manager"],
    relatedRoutes: [
      { label: "Visitor Management", path: "/visitor-management" },
      { label: "Break Devices", path: "/wfm/break-desk-devices" },
    ],
    decisionQuestions: [
      "Who is currently on site and who approved the visit?",
      "Which visitor, host, badge or checkout exception remains open?",
      "Are branch, department and employee host mappings valid?",
    ],
    complianceControls: ["Visitor purpose and consent", "Host approval", "Identity evidence", "Badge custody", "Checkout and retention"],
    sensitiveDomains: ["visitor identity", "phone", "host and visit purpose"],
    perspectives: [
      p("overview", "Visitor control summary", "Expected, checked-in, overdue and completed visits.", []),
      p("trend", "Visitor and workplace trend", "Volume, duration and purpose movement.", []),
      p("register", "Visitor register", "Visitor, host, branch and check-in/out evidence.", []),
      p("exceptions", "Visitor exceptions", "Overdue checkout, missing host and invalid badge cases.", []),
      p("reconciliation", "Host and branch reconciliation", "Visitor host mapping against active employees and branches.", []),
      p("compliance", "Visitor security evidence", "Consent, approval, identity and retention evidence.", []),
    ],
    sourceGroups: [
      s("visitor", "Visitor records", "Visitor identity, purpose and status.", ["visitor_record", "visitor", "visitor_registration"]),
      s("visit", "Visit lifecycle", "Invitation, approval, check-in and checkout.", ["visitor_invitation", "visitor_visit", "visitor_checkin"]),
      s("config", "Visitor configuration", "Branch, host and desk configuration.", ["visitor_configuration", "visitor_branch_config"]),
      s("badge", "Badge custody", "Badge issue and return.", ["visitor_badge", "visitor_badge_assignment"], false),
    ],
  },
];

const reportByCode = new Map(REPORT_CATALOG.map((report) => [report.code, report]));

export function resolveDeepReportPack(pack: DeepReportPack): ResolvedDeepReportPack {
  const perspectives = pack.perspectives.map((perspective) => {
    const reports = perspective.reportCodes
      .map((code) => reportByCode.get(code))
      .filter((report): report is ReportDefinition => Boolean(report));
    const available = new Set(reports.map((report) => report.code));
    return {
      ...perspective,
      reports,
      missingReportCodes: perspective.reportCodes.filter((code) => !available.has(code)),
    };
  });
  return {
    ...pack,
    perspectives,
    reportCount: new Set(perspectives.flatMap((perspective) => perspective.reports.map((report) => report.code))).size,
    missingReportCount: new Set(perspectives.flatMap((perspective) => perspective.missingReportCodes)).size,
  };
}

export function resolveAllDeepReportPacks(): ResolvedDeepReportPack[] {
  return DEEP_REPORT_PACKS.map(resolveDeepReportPack);
}

export function getDeepReportPack(code: string): DeepReportPack | undefined {
  return DEEP_REPORT_PACKS.find((pack) => pack.code === code);
}

export function canViewDeepReportPack(pack: DeepReportPack, roles: string[]): boolean {
  if (roles.includes("super_admin")) return true;
  return pack.viewRoles.some((role) => roles.includes(role));
}
