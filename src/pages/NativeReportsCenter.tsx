import { useState, useMemo, useCallback, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Star, Clock, Download, Play, Loader2, ChevronRight, ChevronDown,
  BarChart3, Users, CalendarDays, CreditCard, FileCheck, UserPlus, TrendingDown,
  Award, Layers, Package, Link2, HelpCircle, Globe, X,
} from "lucide-react";
import { hrmsApi } from "../lib/hrmsApi";

// ─── Types ─────────────────────────────────────────────────────────────────────

interface FilterDef {
  key: string;
  label: string;
  type: "date" | "month" | "year" | "text" | "select" | "number";
  options?: { value: string; label: string }[];
  placeholder?: string;
}

interface ReportDef {
  code: string;
  name: string;
  category: string;
  subcategory: string;
  filters: FilterDef[];
  requiresRunSelector?: boolean;
  roles?: string[];
}

// ─── Report Catalog ────────────────────────────────────────────────────────────

const BRANCH_FILTER: FilterDef = { key: "branchId", label: "Branch", type: "text", placeholder: "Branch ID" };
const PROCESS_FILTER: FilterDef = { key: "processId", label: "Process", type: "text", placeholder: "Process ID" };
const DEPT_FILTER: FilterDef = { key: "departmentId", label: "Department", type: "text", placeholder: "Dept ID" };
const MONTH_FILTER: FilterDef = { key: "month", label: "Month", type: "month" };
const YEAR_FILTER: FilterDef = { key: "year", label: "Year", type: "year", placeholder: String(new Date().getFullYear()) };
const DATE_FROM: FilterDef = { key: "from", label: "From Date", type: "date" };
const DATE_TO: FilterDef = { key: "to", label: "To Date", type: "date" };
const STATUS_FILTER: FilterDef = {
  key: "status", label: "Status", type: "select",
  options: [
    { value: "active", label: "Active" }, { value: "inactive", label: "Inactive" },
    { value: "resigned", label: "Resigned" }, { value: "terminated", label: "Terminated" },
    { value: "pending", label: "Pending" }, { value: "approved", label: "Approved" },
    { value: "rejected", label: "Rejected" },
  ],
};

const CATALOG: ReportDef[] = [
  // ── CAT 1: HR & WORKFORCE ──────────────────────────────────────────────────
  { code: "headcount", name: "Active Headcount Summary", category: "HR & Workforce", subcategory: "Headcount & Org", filters: [BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER, STATUS_FILTER] },
  { code: "employee-master", name: "Employee Master Export", category: "HR & Workforce", subcategory: "Headcount & Org", filters: [BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO] },
  { code: "manager-mapping", name: "Manager Mapping Report", category: "HR & Workforce", subcategory: "Headcount & Org", filters: [BRANCH_FILTER, PROCESS_FILTER] },
  { code: "org-structure-snapshot", name: "Org Structure Snapshot", category: "HR & Workforce", subcategory: "Headcount & Org", filters: [BRANCH_FILTER] },
  { code: "cost-centre-headcount", name: "Cost Centre Headcount", category: "HR & Workforce", subcategory: "Headcount & Org", filters: [{ key: "costCentreId", label: "Cost Centre", type: "text" }, BRANCH_FILTER] },
  { code: "employee-movement", name: "New Joiners & Exits", category: "HR & Workforce", subcategory: "Employee Lifecycle", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "confirmation-due-list", name: "Confirmation Due List", category: "HR & Workforce", subcategory: "Employee Lifecycle", filters: [BRANCH_FILTER, PROCESS_FILTER, { key: "daysAhead", label: "Due in Next (days)", type: "number", placeholder: "30" }] },
  { code: "contract-expiry-list", name: "Contract Expiry List", category: "HR & Workforce", subcategory: "Employee Lifecycle", filters: [BRANCH_FILTER, { key: "daysAhead", label: "Due in Next (days)", type: "number", placeholder: "30" }] },
  { code: "lifecycle-events", name: "Employee Lifecycle Events", category: "HR & Workforce", subcategory: "Employee Lifecycle", filters: [BRANCH_FILTER, { key: "eventType", label: "Event Type", type: "text" }, DATE_FROM, DATE_TO] },
  { code: "increment-promotion-history", name: "Increment / Promotion History", category: "HR & Workforce", subcategory: "Employee Lifecycle", filters: [BRANCH_FILTER, DATE_FROM, DATE_TO] },
  { code: "birthday-list", name: "Birthday List", category: "HR & Workforce", subcategory: "HR Calendar", filters: [BRANCH_FILTER, MONTH_FILTER] },
  { code: "anniversary-list", name: "Work Anniversary List", category: "HR & Workforce", subcategory: "HR Calendar", filters: [BRANCH_FILTER, MONTH_FILTER, { key: "yearsMin", label: "Min Years", type: "number", placeholder: "1" }] },

  // ── CAT 2: ATTENDANCE ──────────────────────────────────────────────────────
  { code: "attendance-daily", name: "Daily Attendance Report", category: "Attendance", subcategory: "Daily", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, STATUS_FILTER] },
  { code: "daily-hc-shift", name: "Daily Headcount by Shift", category: "Attendance", subcategory: "Daily", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "shift-adherence-detail", name: "Shift Adherence Detail", category: "Attendance", subcategory: "Daily", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "attendance-summary", name: "Monthly Attendance Summary", category: "Attendance", subcategory: "Monthly", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER] },
  { code: "attendance-register-grid", name: "Monthly Attendance Register Grid", category: "Attendance", subcategory: "Monthly", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "late-arrival-summary", name: "Late Arrival Summary", category: "Attendance", subcategory: "Monthly", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "overtime-summary", name: "Overtime Summary", category: "Attendance", subcategory: "Monthly", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "biometric-reconciliation", name: "Biometric Reconciliation", category: "Attendance", subcategory: "Exceptions", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "regularization-summary", name: "Regularization Summary", category: "Attendance", subcategory: "Exceptions", filters: [MONTH_FILTER, BRANCH_FILTER, STATUS_FILTER] },
  { code: "attendance-dispute-summary", name: "Attendance Dispute Summary", category: "Attendance", subcategory: "Exceptions", filters: [MONTH_FILTER, BRANCH_FILTER, STATUS_FILTER] },
  { code: "habitual-absentee-list", name: "Habitual Absentee / Late List", category: "Attendance", subcategory: "Exceptions", filters: [MONTH_FILTER, BRANCH_FILTER, { key: "thresholdPct", label: "Absent Threshold %", type: "number", placeholder: "25" }] },
  { code: "daily-shrinkage-report", name: "Daily Shrinkage Report", category: "Attendance", subcategory: "BPO Metrics", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "monthly-shrinkage-trend", name: "Monthly Shrinkage Trend", category: "Attendance", subcategory: "BPO Metrics", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "punch-raw-export", name: "Punch Raw Data Export", category: "Attendance", subcategory: "BPO Metrics", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },

  // ── CAT 3: LEAVE ───────────────────────────────────────────────────────────
  { code: "leave-balance", name: "Leave Balance Report", category: "Leave", subcategory: "Balance & Allocation", filters: [YEAR_FILTER, BRANCH_FILTER, PROCESS_FILTER, { key: "leaveType", label: "Leave Type", type: "text" }] },
  { code: "leave-allocation-register", name: "Leave Allocation Register", category: "Leave", subcategory: "Balance & Allocation", filters: [YEAR_FILTER, BRANCH_FILTER, { key: "leaveType", label: "Leave Type", type: "text" }] },
  { code: "leave-utilization", name: "Leave Utilization Report", category: "Leave", subcategory: "Utilization & Trends", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, { key: "leaveType", label: "Leave Type", type: "text" }] },
  { code: "leave-trend-monthly", name: "Leave Trend (Monthly)", category: "Leave", subcategory: "Utilization & Trends", filters: [YEAR_FILTER, BRANCH_FILTER, { key: "leaveType", label: "Leave Type", type: "text" }] },
  { code: "leave-lwp-reconciliation", name: "Leave vs LWP Reconciliation", category: "Leave", subcategory: "Utilization & Trends", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "maternity-paternity-register", name: "Maternity / Paternity Leave Register", category: "Leave", subcategory: "Special Categories", filters: [YEAR_FILTER, BRANCH_FILTER] },
  { code: "leave-encashment-register", name: "Leave Encashment Register", category: "Leave", subcategory: "Special Categories", filters: [YEAR_FILTER, BRANCH_FILTER] },
  { code: "leave-lapse-summary", name: "Leave Lapse Summary", category: "Leave", subcategory: "Special Categories", filters: [YEAR_FILTER, BRANCH_FILTER] },
  { code: "holiday-master-list", name: "Holiday Master List", category: "Leave", subcategory: "Special Categories", filters: [YEAR_FILTER, BRANCH_FILTER] },

  // ── CAT 4: PAYROLL ─────────────────────────────────────────────────────────
  { code: "payroll-register", name: "Salary Register", category: "Payroll", subcategory: "Monthly Processing", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER], requiresRunSelector: true },
  { code: "payroll-variance", name: "Payroll Variance Report", category: "Payroll", subcategory: "Monthly Processing", filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true },
  { code: "payslip-status", name: "Payslip Release Status", category: "Payroll", subcategory: "Monthly Processing", filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true },
  { code: "ytd-salary-summary", name: "YTD Salary Summary", category: "Payroll", subcategory: "Salary Analysis", filters: [{ key: "financialYear", label: "Financial Year", type: "text", placeholder: "2025-26" }, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "cost-centre-salary-summary", name: "Cost Centre Salary Summary", category: "Payroll", subcategory: "Salary Analysis", filters: [MONTH_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  { code: "process-lob-salary-cost", name: "Process / LOB Salary Cost", category: "Payroll", subcategory: "Salary Analysis", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "grade-salary-distribution", name: "Grade-wise Salary Distribution", category: "Payroll", subcategory: "Salary Analysis", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "salary-advance-register", name: "Salary Advance Register", category: "Payroll", subcategory: "Advances & Recoveries", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, STATUS_FILTER] },
  { code: "lwp-deduction-register", name: "LWP Deduction Register", category: "Payroll", subcategory: "Advances & Recoveries", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "neft-transfer-file", name: "NEFT Transfer File", category: "Payroll", subcategory: "Bank & Disbursement", filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true },
  { code: "bank-missing", name: "Missing / Unverified Bank Details", category: "Payroll", subcategory: "Bank & Disbursement", filters: [BRANCH_FILTER, STATUS_FILTER] },
  { code: "bank-change-requests", name: "Bank Account Change Requests", category: "Payroll", subcategory: "Bank & Disbursement", filters: [DATE_FROM, DATE_TO, STATUS_FILTER] },
  { code: "increment-requests", name: "Salary Increment Requests", category: "Payroll", subcategory: "Governance", filters: [DATE_FROM, DATE_TO, STATUS_FILTER, BRANCH_FILTER] },
  { code: "payroll-readiness-status", name: "Payroll Readiness Status", category: "Payroll", subcategory: "Governance", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "payroll-audit-trail", name: "Payroll Audit Trail", category: "Payroll", subcategory: "Governance", filters: [MONTH_FILTER, BRANCH_FILTER, { key: "actionType", label: "Action Type", type: "text" }] },
  { code: "pf-esi-optout-register", name: "PF / ESI Opt-Out Register", category: "Payroll", subcategory: "Governance", filters: [BRANCH_FILTER, STATUS_FILTER] },

  // ── CAT 5: STATUTORY & COMPLIANCE ─────────────────────────────────────────
  { code: "pf-ecr-export", name: "PF ECR Export", category: "Statutory & Compliance", subcategory: "PF / EPF", filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true },
  { code: "pf-monthly-summary", name: "PF Monthly Summary", category: "Statutory & Compliance", subcategory: "PF / EPF", filters: [MONTH_FILTER] },
  { code: "uan-master-register", name: "UAN Master Register", category: "Statutory & Compliance", subcategory: "PF / EPF", filters: [BRANCH_FILTER] },
  { code: "statutory-missing", name: "Missing Statutory Details", category: "Statutory & Compliance", subcategory: "PF / EPF", filters: [BRANCH_FILTER] },
  { code: "esic-challan-data", name: "ESIC Challan Data", category: "Statutory & Compliance", subcategory: "ESIC", filters: [MONTH_FILTER], requiresRunSelector: true },
  { code: "esic-monthly-summary", name: "ESIC Monthly Summary", category: "Statutory & Compliance", subcategory: "ESIC", filters: [MONTH_FILTER] },
  { code: "pt-monthly-register", name: "PT Monthly Register", category: "Statutory & Compliance", subcategory: "Professional Tax", filters: [MONTH_FILTER, { key: "state", label: "State", type: "text" }, BRANCH_FILTER] },
  { code: "pt-slab-master", name: "PT Slab Master", category: "Statutory & Compliance", subcategory: "Professional Tax", filters: [{ key: "state", label: "State", type: "text" }] },
  { code: "tds-working-sheet", name: "TDS Working Sheet", category: "Statutory & Compliance", subcategory: "TDS & Income Tax", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "form16-data", name: "Form 16 Data (Part B)", category: "Statutory & Compliance", subcategory: "TDS & Income Tax", filters: [{ key: "financialYear", label: "Financial Year", type: "text", placeholder: "2025-26" }, BRANCH_FILTER] },
  { code: "gratuity-liability-register", name: "Gratuity Liability Register", category: "Statutory & Compliance", subcategory: "Gratuity", filters: [BRANCH_FILTER, { key: "minYears", label: "Min Service Years", type: "number", placeholder: "5" }] },
  { code: "gratuity-monthly-accrual", name: "Gratuity Monthly Accrual", category: "Statutory & Compliance", subcategory: "Gratuity", filters: [MONTH_FILTER, BRANCH_FILTER] },
  { code: "statutory-compliance-calendar", name: "Statutory Compliance Calendar", category: "Statutory & Compliance", subcategory: "Compliance Register", filters: [MONTH_FILTER, { key: "state", label: "State", type: "text" }, STATUS_FILTER] },
  { code: "posh-compliance-register", name: "POSH Compliance Register", category: "Statutory & Compliance", subcategory: "Compliance Register", filters: [YEAR_FILTER, BRANCH_FILTER] },
  { code: "labour-compliance-register", name: "Labour Compliance Register", category: "Statutory & Compliance", subcategory: "Compliance Register", filters: [YEAR_FILTER, BRANCH_FILTER] },

  // ── CAT 6: RECRUITMENT & ATS ───────────────────────────────────────────────
  { code: "ats-pipeline-summary", name: "ATS Pipeline Summary", category: "Recruitment & ATS", subcategory: "Pipeline", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "stage", label: "Stage", type: "text" }] },
  { code: "candidate-source-analysis", name: "Candidate Source Analysis", category: "Recruitment & ATS", subcategory: "Pipeline", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "offer-to-joining-tracker", name: "Offer-to-Joining Tracker", category: "Recruitment & ATS", subcategory: "Pipeline", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "bgv-status-report", name: "BGV Status Report", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [BRANCH_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO] },
  { code: "bgv-vendor-dispatch-log", name: "BGV Vendor Dispatch Log", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [DATE_FROM, DATE_TO] },
  { code: "onboarding-request-status", name: "Onboarding Request Status", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [BRANCH_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO] },
  { code: "offer-letter-tat-report", name: "Offer Letter TAT Report", category: "Recruitment & ATS", subcategory: "TAT & Quality", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "recruiter-performance-report", name: "Recruiter Performance Report", category: "Recruitment & ATS", subcategory: "TAT & Quality", filters: [DATE_FROM, DATE_TO, { key: "recruiterId", label: "Recruiter", type: "text" }] },
  { code: "interview-slot-utilization", name: "Interview Slot Utilization", category: "Recruitment & ATS", subcategory: "TAT & Quality", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "cheque-name-mismatch-report", name: "Cheque Name Mismatch Queue", category: "Recruitment & ATS", subcategory: "TAT & Quality", filters: [STATUS_FILTER, BRANCH_FILTER] },
  { code: "onboarding-doc-checklist", name: "Onboarding Document Checklist", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [BRANCH_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO] },
  { code: "bgv-completion-rate", name: "BGV Completion Rate by Branch / Process", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [BRANCH_FILTER, PROCESS_FILTER, DATE_FROM, DATE_TO] },
  { code: "esign-digilocker-status", name: "eSign / DigiLocker Appointment Letter Status", category: "Recruitment & ATS", subcategory: "BGV & Onboarding", filters: [BRANCH_FILTER, STATUS_FILTER, DATE_FROM, DATE_TO] },

  // ── CAT 7: EXIT & ATTRITION ────────────────────────────────────────────────
  { code: "exit-movement-report", name: "Exit / Movement Report", category: "Exit & Attrition", subcategory: "Exit Analysis", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, { key: "exitType", label: "Exit Type", type: "text" }] },
  { code: "notice-period-adherence", name: "Notice Period Adherence", category: "Exit & Attrition", subcategory: "Exit Analysis", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "exit-interview-summary", name: "Exit Interview Summary", category: "Exit & Attrition", subcategory: "Exit Analysis", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "rehire-eligibility-register", name: "Rehire Eligibility Register", category: "Exit & Attrition", subcategory: "Exit Analysis", filters: [BRANCH_FILTER] },
  { code: "monthly-attrition-summary", name: "Monthly Attrition Summary", category: "Exit & Attrition", subcategory: "Attrition Analytics", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "attrition-by-exit-reason", name: "Attrition by Exit Reason", category: "Exit & Attrition", subcategory: "Attrition Analytics", filters: [YEAR_FILTER, BRANCH_FILTER] },
  { code: "ff-settlement-register", name: "F&F Settlement Register", category: "Exit & Attrition", subcategory: "Attrition Analytics", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, STATUS_FILTER] },
  { code: "clearance-status-register", name: "Clearance Status Register", category: "Exit & Attrition", subcategory: "Attrition Analytics", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },

  // ── CAT 8: PERFORMANCE & KPI ───────────────────────────────────────────────
  { code: "kpi-score-summary", name: "KPI Score Summary", category: "Performance & KPI", subcategory: "KPI Scores", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "kpi-leaderboard", name: "KPI Leaderboard", category: "Performance & KPI", subcategory: "KPI Scores", filters: [MONTH_FILTER, BRANCH_FILTER, { key: "templateId", label: "Template", type: "text" }] },
  { code: "below-target-kpi", name: "Below-Target KPI Report", category: "Performance & KPI", subcategory: "KPI Scores", filters: [MONTH_FILTER, BRANCH_FILTER, { key: "thresholdPct", label: "Below Threshold %", type: "number", placeholder: "70" }] },
  { code: "appraisal-rating-summary", name: "Appraisal Rating Summary", category: "Performance & KPI", subcategory: "Appraisal & Feedback", filters: [{ key: "cycle", label: "Appraisal Cycle", type: "text" }, BRANCH_FILTER] },
  { code: "feedback-360-summary", name: "360 Feedback Summary", category: "Performance & KPI", subcategory: "Appraisal & Feedback", filters: [{ key: "cycle", label: "Feedback Cycle", type: "text" }, BRANCH_FILTER] },
  { code: "pip-register", name: "PIP Register", category: "Performance & KPI", subcategory: "Appraisal & Feedback", filters: [STATUS_FILTER, BRANCH_FILTER] },
  { code: "goal-completion-summary", name: "Goal Completion Summary", category: "Performance & KPI", subcategory: "Goals & Development", filters: [{ key: "period", label: "Period", type: "text" }, BRANCH_FILTER] },
  { code: "training-needs-summary", name: "Training Needs Summary", category: "Performance & KPI", subcategory: "Goals & Development", filters: [BRANCH_FILTER, { key: "priority", label: "Priority", type: "select", options: [{ value: "high", label: "High" }, { value: "medium", label: "Medium" }, { value: "low", label: "Low" }] }] },

  // ── CAT 9: WFM / ROSTER / OPERATIONS ──────────────────────────────────────
  { code: "roster-adherence", name: "Roster vs Actual Adherence", category: "WFM & Roster", subcategory: "Roster & Coverage", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "workforce-mandate-vs-actual", name: "Workforce Mandate vs Actual", category: "WFM & Roster", subcategory: "Roster & Coverage", filters: [MONTH_FILTER, PROCESS_FILTER, BRANCH_FILTER] },
  { code: "roster-change-audit", name: "Roster Change Audit", category: "WFM & Roster", subcategory: "Roster & Coverage", filters: [DATE_FROM, DATE_TO, PROCESS_FILTER] },
  { code: "dialer-hours-report", name: "Dialer Hours Report", category: "WFM & Roster", subcategory: "Operations", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },
  { code: "coverage-gap-actions", name: "Coverage Gap Actions", category: "WFM & Roster", subcategory: "Operations", filters: [DATE_FROM, DATE_TO, PROCESS_FILTER, STATUS_FILTER] },
  { code: "process-hc-vs-mandate", name: "Process HC vs Client Mandate", category: "WFM & Roster", subcategory: "Operations", filters: [MONTH_FILTER, PROCESS_FILTER] },
  { code: "roster-cycle-status", name: "Roster Cycle Status Report", category: "WFM & Roster", subcategory: "WFM Compliance", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER] },

  // ── CAT 10: ASSETS & DOCUMENTS ─────────────────────────────────────────────
  { code: "asset-inventory-report", name: "Asset Inventory Report", category: "Assets & Documents", subcategory: "Assets", filters: [BRANCH_FILTER, { key: "category", label: "Category", type: "text" }, STATUS_FILTER] },
  { code: "asset-assignment-register", name: "Asset Assignment Register", category: "Assets & Documents", subcategory: "Assets", filters: [BRANCH_FILTER, DATE_FROM, DATE_TO] },
  { code: "asset-service-log", name: "Asset Service / Maintenance Log", category: "Assets & Documents", subcategory: "Assets", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "employee-document-compliance", name: "Employee Document Compliance", category: "Assets & Documents", subcategory: "Documents", filters: [BRANCH_FILTER, { key: "docType", label: "Doc Type", type: "text" }] },

  // ── CAT 11: INTEGRATION & AUDIT ────────────────────────────────────────────
  { code: "cosec-unmapped", name: "COSEC Unmapped Users", category: "Integration & Audit", subcategory: "Integration", filters: [BRANCH_FILTER] },
  { code: "integration-run-history", name: "Integration Run History", category: "Integration & Audit", subcategory: "Integration", filters: [{ key: "integrationKey", label: "Integration Key", type: "text" }, DATE_FROM, DATE_TO, STATUS_FILTER] },
  { code: "tat-escalation-breach", name: "TAT / Escalation Breach Report", category: "Integration & Audit", subcategory: "Audit", filters: [DATE_FROM, DATE_TO, { key: "taskType", label: "Task Type", type: "text" }, BRANCH_FILTER] },
  { code: "sensitive-action-audit", name: "Sensitive Action Audit", category: "Integration & Audit", subcategory: "Audit", filters: [DATE_FROM, DATE_TO, { key: "module", label: "Module", type: "text" }, { key: "actionType", label: "Action Type", type: "text" }] },
  { code: "communication-dispatch-log", name: "Communication Dispatch Log", category: "Integration & Audit", subcategory: "Audit", filters: [DATE_FROM, DATE_TO, { key: "channel", label: "Channel", type: "text" }, STATUS_FILTER] },

  // ── CAT 12: HELPDESK & GRIEVANCE ──────────────────────────────────────────
  { code: "helpdesk-ticket-summary", name: "Helpdesk Ticket Summary", category: "Helpdesk & Grievance", subcategory: "Helpdesk", filters: [DATE_FROM, DATE_TO, { key: "ticketCategory", label: "Category", type: "text" }, STATUS_FILTER, BRANCH_FILTER] },
  { code: "grievance-register", name: "Grievance Register", category: "Helpdesk & Grievance", subcategory: "Grievance", filters: [DATE_FROM, DATE_TO, STATUS_FILTER] },
  { code: "grievance-tat-report", name: "Grievance TAT Report", category: "Helpdesk & Grievance", subcategory: "Grievance", filters: [DATE_FROM, DATE_TO, STATUS_FILTER] },
  { code: "grievance-category-analysis", name: "Grievance Category Analysis", category: "Helpdesk & Grievance", subcategory: "Grievance", filters: [DATE_FROM, DATE_TO] },
  { code: "dpdp-consent-status", name: "Employee Consent / DPDP Status", category: "Helpdesk & Grievance", subcategory: "DPDP", filters: [BRANCH_FILTER] },

  // ── CAT 13: CLIENT PORTAL GOVERNANCE ─────────────────────────────────────
  { code: "portal-kpi-commitment-vs-actual", name: "Process KPI Commitment vs Actual", category: "Client Portal", subcategory: "KPI Governance", filters: [MONTH_FILTER, PROCESS_FILTER] },
  { code: "action-plan-status", name: "Action Plan Status", category: "Client Portal", subcategory: "KPI Governance", filters: [MONTH_FILTER, PROCESS_FILTER, STATUS_FILTER] },
  { code: "governance-checklist-completion", name: "Governance Checklist Completion", category: "Client Portal", subcategory: "Operations", filters: [MONTH_FILTER, PROCESS_FILTER] },
  { code: "portal-access-log", name: "Client Portal Access Log", category: "Client Portal", subcategory: "Operations", filters: [DATE_FROM, DATE_TO, { key: "clientId", label: "Client", type: "text" }] },

  // ── CAT 14: PRODUCTIVITY ANALYTICS (CEO / All Levels) ─────────────────────
  // Individual Level
  { code: "productivity-individual-scorecard", name: "Individual Productivity Scorecard", category: "Productivity", subcategory: "Individual", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }, { key: "employeeId", label: "Employee", type: "text" }, { key: "shiftCode", label: "Shift", type: "text" }] },
  { code: "productivity-daily-heatmap", name: "Daily Productivity Heatmap", category: "Productivity", subcategory: "Individual", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }, { key: "managerId", label: "Reporting Manager", type: "text" }] },
  { code: "productivity-top-bottom-performers", name: "Top / Bottom Performer List", category: "Productivity", subcategory: "Individual", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }, { key: "topN", label: "Top / Bottom N", type: "number", placeholder: "10" }] },
  // Team Level
  { code: "productivity-team-rollup", name: "Team Productivity Roll-Up", category: "Productivity", subcategory: "Team", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "managerId", label: "Reporting Manager", type: "text" }, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  // Process / LOB Level
  { code: "productivity-process-summary", name: "Process / LOB Productivity Summary", category: "Productivity", subcategory: "Process & LOB", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  { code: "productivity-aht-trend", name: "AHT Trend by Process", category: "Productivity", subcategory: "Process & LOB", filters: [DATE_FROM, DATE_TO, PROCESS_FILTER, BRANCH_FILTER] },
  // Branch Level
  { code: "productivity-branch-summary", name: "Branch Productivity Summary", category: "Productivity", subcategory: "Branch", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  // Cost Centre Level
  { code: "productivity-cost-centre-summary", name: "Cost Centre Productivity Summary", category: "Productivity", subcategory: "Cost Centre", filters: [DATE_FROM, DATE_TO, { key: "costCentreId", label: "Cost Centre", type: "text" }, BRANCH_FILTER, PROCESS_FILTER] },
  // Org Level (CEO View)
  { code: "productivity-org-summary", name: "Org-Wide Productivity Overview", category: "Productivity", subcategory: "Organisation", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER] },
  { code: "productivity-occupancy-utilization", name: "Occupancy & Utilization Report", category: "Productivity", subcategory: "Organisation", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  { code: "productivity-adherence-vs-kpi", name: "Schedule Adherence vs KPI Correlation", category: "Productivity", subcategory: "Organisation", filters: [MONTH_FILTER, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
  { code: "productivity-shrinkage-impact", name: "Shrinkage Impact on Productivity", category: "Productivity", subcategory: "Organisation", filters: [DATE_FROM, DATE_TO, BRANCH_FILTER, PROCESS_FILTER, { key: "costCentreId", label: "Cost Centre", type: "text" }] },
];

// ─── Category metadata ──────────────────────────────────────────────────────

const CATEGORY_META: Record<string, { icon: React.ReactNode; color: string; bg: string }> = {
  "HR & Workforce":        { icon: <Users size={14} />,        color: "text-blue-700",   bg: "bg-blue-50" },
  "Attendance":            { icon: <CalendarDays size={14} />, color: "text-violet-700", bg: "bg-violet-50" },
  "Leave":                 { icon: <Clock size={14} />,        color: "text-green-700",  bg: "bg-green-50" },
  "Payroll":               { icon: <CreditCard size={14} />,   color: "text-amber-700",  bg: "bg-amber-50" },
  "Statutory & Compliance":{ icon: <FileCheck size={14} />,    color: "text-red-700",    bg: "bg-red-50" },
  "Recruitment & ATS":     { icon: <UserPlus size={14} />,     color: "text-cyan-700",   bg: "bg-cyan-50" },
  "Exit & Attrition":      { icon: <TrendingDown size={14} />, color: "text-orange-700", bg: "bg-orange-50" },
  "Performance & KPI":     { icon: <Award size={14} />,        color: "text-pink-700",   bg: "bg-pink-50" },
  "WFM & Roster":          { icon: <Layers size={14} />,       color: "text-teal-700",   bg: "bg-teal-50" },
  "Assets & Documents":    { icon: <Package size={14} />,      color: "text-lime-700",   bg: "bg-lime-50" },
  "Integration & Audit":   { icon: <Link2 size={14} />,        color: "text-slate-700",  bg: "bg-slate-50" },
  "Helpdesk & Grievance":  { icon: <HelpCircle size={14} />,   color: "text-rose-700",   bg: "bg-rose-50" },
  "Client Portal":         { icon: <Globe size={14} />,        color: "text-indigo-700", bg: "bg-indigo-50" },
  "Productivity":          { icon: <BarChart3 size={14} />,     color: "text-emerald-700",bg: "bg-emerald-50" },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_META);

// ─── Helpers ────────────────────────────────────────────────────────────────

const LS_RECENT = "rpt_recent_v1";
const LS_FAVS   = "rpt_favs_v1";

function loadList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function saveList(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch {}
}

function downloadCsv(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const cols = Object.keys(rows[0]);
  const header = cols.join(",");
  const body = rows.map(r => cols.map(c => JSON.stringify(r[c] ?? "")).join(",")).join("\n");
  const blob = new Blob([header + "\n" + body], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename; a.click();
  URL.revokeObjectURL(url);
}

// ─── Filter Input ───────────────────────────────────────────────────────────

function FilterInput({ def, value, onChange }: {
  def: FilterDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const base = "h-8 text-sm border border-gray-200 rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full";

  if (def.type === "select" && def.options) {
    return (
      <select className={base} value={value} onChange={e => onChange(e.target.value)}>
        <option value="">All</option>
        {def.options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    );
  }
  if (def.type === "date") return <input className={base} type="date" value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "month") return <input className={base} type="month" value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "year") return <input className={base} type="number" min="2020" max="2035" placeholder={def.placeholder ?? String(new Date().getFullYear())} value={value} onChange={e => onChange(e.target.value)} />;
  if (def.type === "number") return <input className={base} type="number" placeholder={def.placeholder ?? ""} value={value} onChange={e => onChange(e.target.value)} />;
  return <input className={base} type="text" placeholder={def.placeholder ?? def.label} value={value} onChange={e => onChange(e.target.value)} />;
}

// ─── Sidebar section ────────────────────────────────────────────────────────

function SidebarCategory({
  category, reports, selectedCode, onSelect, isOpen, onToggle, searchQ, favCodes,
}: {
  category: string;
  reports: ReportDef[];
  selectedCode: string;
  onSelect: (r: ReportDef) => void;
  isOpen: boolean;
  onToggle: () => void;
  searchQ: string;
  favCodes: Set<string>;
}) {
  const meta = CATEGORY_META[category] ?? { icon: <BarChart3 size={14} />, color: "text-gray-700", bg: "bg-gray-50" };
  const visible = searchQ
    ? reports.filter(r => r.name.toLowerCase().includes(searchQ.toLowerCase()))
    : reports;
  if (searchQ && visible.length === 0) return null;

  const subcats = Array.from(new Set(visible.map(r => r.subcategory)));

  return (
    <div className="border-b border-gray-100 last:border-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between px-3 py-2.5 text-left hover:bg-gray-50 transition-colors"
      >
        <span className="flex items-center gap-2">
          <span className={`flex items-center justify-center w-5 h-5 rounded ${meta.bg} ${meta.color}`}>{meta.icon}</span>
          <span className="text-xs font-semibold text-gray-700 leading-tight">{category}</span>
          <span className="text-xs text-gray-400">({visible.length})</span>
        </span>
        {isOpen ? <ChevronDown size={12} className="text-gray-400 flex-shrink-0" /> : <ChevronRight size={12} className="text-gray-400 flex-shrink-0" />}
      </button>

      {isOpen && (
        <div className="pb-1">
          {subcats.map(sub => {
            const subReports = visible.filter(r => r.subcategory === sub);
            return (
              <div key={sub}>
                <p className="px-3 py-1 text-[10px] font-semibold text-gray-400 uppercase tracking-wider">{sub}</p>
                {subReports.map(r => (
                  <button
                    key={r.code}
                    type="button"
                    onClick={() => onSelect(r)}
                    className={`w-full px-4 py-1.5 text-left text-xs transition-colors flex items-center gap-1.5 ${
                      selectedCode === r.code ? "bg-blue-600 text-white font-semibold" : "text-gray-700 hover:bg-gray-100"
                    }`}
                  >
                    {favCodes.has(r.code) && <Star size={10} className={selectedCode === r.code ? "text-yellow-200" : "text-yellow-400"} fill="currentColor" />}
                    <span className="leading-snug">{r.name}</span>
                  </button>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function NativeReportsCenter() {
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [openCats, setOpenCats] = useState<Set<string>>(new Set([CATEGORY_ORDER[0]]));
  const [recentCodes, setRecentCodes] = useState<string[]>(() => loadList(LS_RECENT));
  const [favCodes, setFavCodes] = useState<Set<string>>(() => new Set(loadList(LS_FAVS)));

  // load branches + processes for filter dropdowns
  const { data: branchData } = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const { data: processData } = useQuery({
    queryKey: ["processes-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>("/api/process"),
    staleTime: 10 * 60_000,
  });

  const branches = branchData?.data ?? [];
  const processes = processData?.data ?? [];

  // Group catalog by category
  const grouped = useMemo(() => {
    const map: Record<string, ReportDef[]> = {};
    CATALOG.forEach(r => {
      if (!map[r.category]) map[r.category] = [];
      map[r.category].push(r);
    });
    return map;
  }, []);

  const recentReports = useMemo(
    () => recentCodes.map(c => CATALOG.find(r => r.code === c)).filter(Boolean) as ReportDef[],
    [recentCodes]
  );

  const toggleCat = useCallback((cat: string) => {
    setOpenCats(prev => {
      const next = new Set(prev);
      next.has(cat) ? next.delete(cat) : next.add(cat);
      return next;
    });
  }, []);

  function selectReport(r: ReportDef) {
    setSelectedReport(r);
    setRows([]);
    setRunError("");
    setFilterValues({});
    // Open the category
    setOpenCats(prev => new Set([...prev, r.category]));
    // Track recent
    const next = [r.code, ...recentCodes.filter(c => c !== r.code)].slice(0, 8);
    setRecentCodes(next);
    saveList(LS_RECENT, next);
  }

  function toggleFav(code: string) {
    setFavCodes(prev => {
      const next = new Set(prev);
      next.has(code) ? next.delete(code) : next.add(code);
      saveList(LS_FAVS, Array.from(next));
      return next;
    });
  }

  async function runReport() {
    if (!selectedReport) return;
    setRunning(true);
    setRunError("");
    setRows([]);
    try {
      const active: Record<string, string> = {};
      Object.entries(filterValues).forEach(([k, v]) => { if (v) active[k] = v; });
      // Build query string for suite endpoint
      const params = new URLSearchParams();
      Object.entries(active).forEach(([k, v]) => params.set(k, v));
      const url = `/api/reports/suite/${selectedReport.code}?${params.toString()}&limit=2000`;
      const res = await hrmsApi.get<{ data: Record<string, unknown>[] }>(url);
      setRows(res.data ?? []);
    } catch (e: unknown) {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })?.response?.data?.message
        ?? (e as { message?: string })?.message
        ?? "Report failed";
      setRunError(msg);
    } finally {
      setRunning(false);
    }
  }

  const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

  function setFilter(key: string, val: string) {
    setFilterValues(prev => ({ ...prev, [key]: val }));
  }

  // Expand category when searching
  useEffect(() => {
    if (!searchQ) return;
    const matchedCats = new Set(CATALOG.filter(r => r.name.toLowerCase().includes(searchQ.toLowerCase())).map(r => r.category));
    setOpenCats(prev => new Set([...prev, ...matchedCats]));
  }, [searchQ]);

  // Override branch/process filter if known IDs
  function getBranchOptions() {
    return branches.map(b => ({ value: b.id, label: b.branch_name }));
  }
  function getProcessOptions() {
    return processes.map(p => ({ value: p.id, label: (p as { process_name: string }).process_name }));
  }

  function resolveFilterDef(def: FilterDef): FilterDef {
    if (def.key === "branchId" && branches.length > 0) return { ...def, type: "select", options: getBranchOptions() };
    if (def.key === "processId" && processes.length > 0) return { ...def, type: "select", options: getProcessOptions() };
    return def;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col">
      {/* Top bar */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-20">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-blue-600 flex items-center justify-center">
              <BarChart3 size={16} className="text-white" />
            </div>
            <div>
              <h1 className="text-sm font-bold text-gray-900 leading-tight">Reports Center</h1>
              <p className="text-xs text-gray-400">{CATALOG.length} reports across 13 categories</p>
            </div>
          </div>

          {/* Search */}
          <div className="relative flex-1 max-w-xs ml-4">
            <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              className="w-full h-8 pl-8 pr-8 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              placeholder="Search reports…"
              value={searchQ}
              onChange={e => setSearchQ(e.target.value)}
            />
            {searchQ && (
              <button type="button" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setSearchQ("")}>
                <X size={12} />
              </button>
            )}
          </div>

          {/* Recent chips */}
          {recentReports.length > 0 && (
            <div className="hidden lg:flex items-center gap-1 overflow-x-auto flex-1">
              <span className="text-xs text-gray-400 mr-1 flex-shrink-0 flex items-center gap-1"><Clock size={11} /> Recent:</span>
              {recentReports.slice(0, 5).map(r => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => selectReport(r)}
                  className={`flex-shrink-0 text-xs px-2 py-1 rounded-full border transition-colors ${
                    selectedReport?.code === r.code ? "bg-blue-600 text-white border-blue-600" : "bg-white text-gray-600 border-gray-200 hover:bg-gray-50"
                  }`}
                >
                  {r.name.length > 22 ? r.name.slice(0, 22) + "…" : r.name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex flex-1 max-w-[1600px] mx-auto w-full px-4 py-4 gap-4">
        {/* ── Sidebar ───────────────────────────────────────────────────────── */}
        <aside className="w-64 flex-shrink-0 bg-white rounded-xl border border-gray-200 overflow-y-auto sticky top-16 self-start max-h-[calc(100vh-80px)]">
          <div className="px-3 py-2.5 border-b border-gray-100">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">All Reports ({CATALOG.length})</p>
          </div>
          {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => (
            <SidebarCategory
              key={cat}
              category={cat}
              reports={grouped[cat]}
              selectedCode={selectedReport?.code ?? ""}
              onSelect={selectReport}
              isOpen={openCats.has(cat)}
              onToggle={() => toggleCat(cat)}
              searchQ={searchQ}
              favCodes={favCodes}
            />
          ))}
        </aside>

        {/* ── Main panel ────────────────────────────────────────────────────── */}
        <main className="flex-1 min-w-0 space-y-4">
          {/* Empty state */}
          {!selectedReport && (
            <div className="bg-white rounded-xl border border-gray-200">
              <div className="flex flex-col items-center justify-center py-20 text-center px-6">
                <div className="w-14 h-14 rounded-2xl bg-blue-50 flex items-center justify-center mb-4">
                  <BarChart3 size={28} className="text-blue-400" />
                </div>
                <h3 className="text-base font-semibold text-gray-800 mb-1">Select a Report</h3>
                <p className="text-sm text-gray-400 max-w-xs">Choose from 112 reports across 13 categories using the sidebar. Data is branch-scoped based on your access.</p>
              </div>

              {/* Favourites */}
              {favCodes.size > 0 && (
                <div className="border-t border-gray-100 px-6 pb-6">
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mt-4 mb-3 flex items-center gap-1">
                    <Star size={11} className="text-yellow-400" fill="currentColor" /> Favourites
                  </p>
                  <div className="flex flex-wrap gap-2">
                    {Array.from(favCodes).map(code => {
                      const r = CATALOG.find(x => x.code === code);
                      return r ? (
                        <button key={code} type="button" onClick={() => selectReport(r)}
                          className="text-xs px-3 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg hover:bg-yellow-100 transition-colors">
                          {r.name}
                        </button>
                      ) : null;
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {selectedReport && (
            <>
              {/* Report header card */}
              <div className="bg-white rounded-xl border border-gray-200">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-start gap-3">
                      {(() => {
                        const meta = CATEGORY_META[selectedReport.category];
                        return (
                          <span className={`flex items-center justify-center w-8 h-8 rounded-lg flex-shrink-0 mt-0.5 ${meta?.bg ?? "bg-gray-50"} ${meta?.color ?? "text-gray-600"}`}>
                            {meta?.icon ?? <BarChart3 size={16} />}
                          </span>
                        );
                      })()}
                      <div>
                        <h2 className="text-base font-semibold text-gray-900">{selectedReport.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{selectedReport.category} · {selectedReport.subcategory}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleFav(selectedReport.code)}
                        className={`p-1.5 rounded-lg border transition-colors ${
                          favCodes.has(selectedReport.code) ? "bg-yellow-50 border-yellow-200 text-yellow-500" : "bg-white border-gray-200 text-gray-400 hover:text-yellow-400"
                        }`}
                        title={favCodes.has(selectedReport.code) ? "Remove from favourites" : "Add to favourites"}
                      >
                        <Star size={14} fill={favCodes.has(selectedReport.code) ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        disabled={running}
                        onClick={runReport}
                        className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 transition-colors"
                      >
                        {running ? <><Loader2 size={14} className="animate-spin" /> Running…</> : <><Play size={14} /> Run Report</>}
                      </button>
                      {rows.length > 0 && (
                        <button
                          type="button"
                          onClick={() => downloadCsv(rows, `${selectedReport.code}_${new Date().toISOString().slice(0, 10)}.csv`)}
                          className="flex items-center gap-1.5 px-3 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors"
                        >
                          <Download size={14} /> Export CSV
                        </button>
                      )}
                    </div>
                  </div>

                  {/* Note for "requires run selector" reports */}
                  {selectedReport.requiresRunSelector && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                      <span className="font-semibold">Tip:</span> This report uses payroll run data — set the Month filter to the run month you want.
                    </div>
                  )}
                </div>

                {/* Filters */}
                <div className="px-5 py-4">
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-3">
                    {selectedReport.filters.map(def => {
                      const resolved = resolveFilterDef(def);
                      return (
                        <div key={def.key} className="space-y-1">
                          <label className="block text-xs font-medium text-gray-500">{def.label}</label>
                          <FilterInput
                            def={resolved}
                            value={filterValues[def.key] ?? ""}
                            onChange={v => setFilter(def.key, v)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              </div>

              {/* Error */}
              {runError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2">
                  <X size={15} className="flex-shrink-0" />
                  <span>{runError} — This report may not be implemented yet on the backend. It will be available in a future phase.</span>
                </div>
              )}

              {/* Results */}
              {rows.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between">
                    <p className="text-sm font-semibold text-gray-700">
                      {rows.length.toLocaleString()} rows{rows.length === 2000 && <span className="text-amber-600 ml-1">(showing first 2,000 — export CSV for full data)</span>}
                    </p>
                    <p className="text-xs text-gray-400">{columns.length} columns</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50">
                          {columns.map(col => (
                            <th key={col} className="px-3 py-2 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.slice(0, 500).map((row, i) => (
                          <tr key={i} className="hover:bg-gray-50 transition-colors">
                            {columns.map(col => (
                              <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[200px] truncate" title={String(row[col] ?? "")}>
                                {row[col] == null ? <span className="text-gray-300">—</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && (
                      <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                        Showing 500 of {rows.length.toLocaleString()} rows in the table. Export CSV to see all rows.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* No results */}
              {!running && !runError && rows.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-200 py-12 text-center">
                  <BarChart3 size={32} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400">Set filters above and click Run Report</p>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
