import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Search, Star, Clock, Download, Play, Loader2, ChevronDown,
  BarChart3, Users, CalendarDays, CreditCard, FileCheck, UserPlus, TrendingDown,
  Award, Layers, Package, Link2, HelpCircle, Globe, X, Filter, CheckCircle2,
} from "lucide-react";
import { hrmsApi } from "../lib/hrmsApi";
import { HrmsBentoTile, HrmsModernShell } from "@/components/ui/hrms-modern";

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
  directDownload?: boolean;
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
const IDENTITY_SOURCE_FILTER: FilterDef = {
  key: "sourceSystem", label: "Source System", type: "select",
  options: [
    { value: "MASBIOMETRIC_EMPLOYEE", label: "Masbiometric Employees" },
    { value: "SHIVAMGIRI_EMPLOYEE", label: "Mydashboard Employees" },
    { value: "SHIVAMGIRI_AGENT", label: "Mydashboard Agents" },
    { value: "MASMIS_AGENT", label: "MIS Agents" },
  ],
};
const IDENTITY_MATCH_FILTER: FilterDef = {
  key: "matchStatus", label: "Match Status", type: "select",
  options: [
    { value: "unmatched", label: "Unmatched" },
    { value: "matched", label: "Matched" },
    { value: "ambiguous", label: "Ambiguous" },
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
  { code: "salary-sheet-export", name: "Salary Sheet (Onfido Format)", category: "Payroll", subcategory: "Monthly Processing", filters: [MONTH_FILTER, BRANCH_FILTER], requiresRunSelector: true, directDownload: true, roles: ["admin", "finance", "payroll", "hr"] },
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
  { code: "identity-mapping-exceptions", name: "Cross-System Identity Mapping Exceptions", category: "Integration & Audit", subcategory: "Integration", filters: [BRANCH_FILTER, PROCESS_FILTER, DEPT_FILTER] },
  { code: "identity-source-snapshot", name: "Identity Source Snapshot", category: "Integration & Audit", subcategory: "Integration", filters: [IDENTITY_SOURCE_FILTER, IDENTITY_MATCH_FILTER] },
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

// ─── Category Gradients ────────────────────────────────────────────────────────

const CATEGORY_GRADIENTS: Record<string, { from: string; to: string; icon: typeof Users }> = {
  "HR & Workforce": { from: "from-blue-500", to: "to-indigo-600", icon: Users },
  "Attendance": { from: "from-violet-500", to: "to-purple-600", icon: CalendarDays },
  "Leave": { from: "from-emerald-500", to: "to-teal-600", icon: Clock },
  "Payroll": { from: "from-amber-500", to: "to-orange-600", icon: CreditCard },
  "Statutory & Compliance": { from: "from-red-500", to: "to-rose-600", icon: FileCheck },
  "Recruitment & ATS": { from: "from-cyan-500", to: "to-sky-600", icon: UserPlus },
  "Exit & Attrition": { from: "from-slate-500", to: "to-gray-600", icon: TrendingDown },
  "Performance & KPI": { from: "from-pink-500", to: "to-rose-600", icon: Award },
  "WFM & Roster": { from: "from-teal-500", to: "to-cyan-600", icon: Layers },
  "Assets & Documents": { from: "from-lime-500", to: "to-green-600", icon: Package },
  "Integration & Audit": { from: "from-indigo-500", to: "to-blue-600", icon: Link2 },
  "Helpdesk & Grievance": { from: "from-fuchsia-500", to: "to-pink-600", icon: HelpCircle },
  "Client Portal": { from: "from-sky-500", to: "to-indigo-600", icon: Globe },
  "Productivity": { from: "from-orange-500", to: "to-red-600", icon: BarChart3 },
};

const CATEGORY_ORDER = Object.keys(CATEGORY_GRADIENTS);

// ─── Helpers ────────────────────────────────────────────────────────────────────

const LS_RECENT = "rpt_recent_v1";
const LS_FAVS = "rpt_favs_v1";

function loadList(key: string): string[] {
  try { return JSON.parse(localStorage.getItem(key) ?? "[]"); } catch { return []; }
}
function saveList(key: string, val: string[]) {
  try { localStorage.setItem(key, JSON.stringify(val)); } catch { /* noop */ }
}

// ─── Count-Up Hook ──────────────────────────────────────────────────────────────

function useCountUp(target: number, duration = 1200) {
  const [value, setValue] = useState(0);
  const prevTarget = useRef(0);
  useEffect(() => {
    if (target === prevTarget.current) return;
    prevTarget.current = target;
    let start = 0;
    const step = (ts: number) => {
      if (!start) start = ts;
      const progress = Math.min((ts - start) / duration, 1);
      setValue(Math.floor(progress * target));
      if (progress < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, [target, duration]);
  return value;
}

// ─── XLSX Export ─────────────────────────────────────────────────────────────────

async function downloadXlsx(rows: Record<string, unknown>[], filename: string) {
  if (!rows.length) return;
  const XLSX = await import("xlsx");
  const ws = XLSX.utils.json_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Report");
  XLSX.writeFile(wb, filename.endsWith(".xlsx") ? filename : `${filename}.xlsx`);
}

// ─── Filter Input ───────────────────────────────────────────────────────────────

function FilterInput({ def, value, onChange }: {
  def: FilterDef;
  value: string;
  onChange: (v: string) => void;
}) {
  const base = "h-9 text-sm border border-gray-200 rounded-lg px-2.5 focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white w-full";

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

// ─── Main Page ──────────────────────────────────────────────────────────────────

export default function NativeReportsCenter() {
  const [selectedReport, setSelectedReport] = useState<ReportDef | null>(null);
  const [filterValues, setFilterValues] = useState<Record<string, string>>({});
  const [rows, setRows] = useState<Record<string, unknown>[]>([]);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState("");
  const [searchQ, setSearchQ] = useState("");
  const [selectedCat, setSelectedCat] = useState<string | null>(null);
  const [recentCodes, setRecentCodes] = useState<string[]>(() => loadList(LS_RECENT));
  const [favCodes, setFavCodes] = useState<Set<string>>(() => new Set(loadList(LS_FAVS)));
  const [filtersOpen, setFiltersOpen] = useState(true);

  const runnerRef = useRef<HTMLDivElement>(null);

  // Data fetching for filter dropdowns
  const { data: branchData } = useQuery({
    queryKey: ["branches-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; branch_name: string }[] }>("/api/org/branches"),
    staleTime: 10 * 60_000,
  });
  const { data: processData } = useQuery({
    queryKey: ["processes-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>("/api/processes"),
    staleTime: 10 * 60_000,
  });
  const { data: deptData } = useQuery({
    queryKey: ["departments-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; dept_name: string }[] }>("/api/org/departments"),
    staleTime: 10 * 60_000,
  });
  const { data: ccData } = useQuery({
    queryKey: ["cost-centres-all"],
    queryFn: () => hrmsApi.get<{ data: { id: string; cost_centre_name: string }[] }>("/api/org/cost-centres"),
    staleTime: 10 * 60_000,
  });

  const branches = branchData?.data ?? [];
  const processes = processData?.data ?? [];
  const departments = deptData?.data ?? [];
  const costCentres = ccData?.data ?? [];

  // Group catalog by category
  const grouped = useMemo(() => {
    const map: Record<string, ReportDef[]> = {};
    CATALOG.forEach(r => {
      if (!map[r.category]) map[r.category] = [];
      map[r.category].push(r);
    });
    return map;
  }, []);

  // Stats
  const totalReports = CATALOG.length;
  const categoryCount = CATEGORY_ORDER.length;
  const favCount = favCodes.size;
  const animatedTotal = useCountUp(totalReports);
  const animatedCats = useCountUp(categoryCount);
  const animatedFavs = useCountUp(favCount);

  const recentReports = useMemo(
    () => recentCodes.map(c => CATALOG.find(r => r.code === c)).filter(Boolean) as ReportDef[],
    [recentCodes]
  );

  // Filtered reports by search
  const searchResults = useMemo(() => {
    if (!searchQ.trim()) return null;
    return CATALOG.filter(r => r.name.toLowerCase().includes(searchQ.toLowerCase()));
  }, [searchQ]);

  function selectReport(r: ReportDef) {
    setSelectedReport(r);
    setSelectedCat(r.category);
    setRows([]);
    setRunError("");
    setFilterValues({});
    const next = [r.code, ...recentCodes.filter(c => c !== r.code)].slice(0, 8);
    setRecentCodes(next);
    saveList(LS_RECENT, next);
    setTimeout(() => runnerRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 100);
  }

  function toggleFav(code: string) {
    setFavCodes(prev => {
      const next = new Set(prev);
      if (next.has(code)) { next.delete(code); } else { next.add(code); }
      saveList(LS_FAVS, Array.from(next));
      return next;
    });
  }

  const toggleCategory = useCallback((cat: string) => {
    setSelectedCat(prev => prev === cat ? null : cat);
  }, []);

  async function runReport() {
    if (!selectedReport) return;
    setRunning(true);
    setRunError("");
    setRows([]);
    try {
      // Direct file download reports (e.g. salary sheet XLSX)
      if (selectedReport.directDownload && selectedReport.code === "salary-sheet-export") {
        const month = filterValues["month"]?.trim();
        const branchId = filterValues["branchId"]?.trim();
        if (!month) { setRunError("Please select a Month to download the salary sheet."); setRunning(false); return; }
        const params = new URLSearchParams({ month });
        if (branchId) params.set("branchId", branchId);
        const a = document.createElement("a");
        a.href = `/api/payroll/salary-sheet-export?${params.toString()}`;
        a.download = `Salary Sheet ${month}.xlsx`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setRunning(false);
        return;
      }

      const active: Record<string, string> = {};
      Object.entries(filterValues).forEach(([k, v]) => { if (v) active[k] = v; });
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
  const activeFilterCount = Object.values(filterValues).filter(Boolean).length;

  function setFilter(key: string, val: string) {
    setFilterValues(prev => ({ ...prev, [key]: val }));
  }

  function resolveFilterDef(def: FilterDef): FilterDef {
    if (def.key === "branchId" && branches.length > 0) return { ...def, type: "select", options: branches.map(b => ({ value: b.id, label: b.branch_name })) };
    if (def.key === "processId" && processes.length > 0) return { ...def, type: "select", options: processes.map(p => ({ value: p.id, label: (p as { process_name: string }).process_name })) };
    if (def.key === "departmentId" && departments.length > 0) return { ...def, type: "select", options: departments.map(d => ({ value: d.id, label: d.dept_name })) };
    if (def.key === "costCentreId" && costCentres.length > 0) return { ...def, type: "select", options: costCentres.map(c => ({ value: c.id, label: c.cost_centre_name })) };
    return def;
  }

  // ─── Left Panel ───────────────────────────────────────────────────────────────
  const leftPanel = (
    <aside className="w-60 shrink-0 bg-white border-r border-slate-200 sticky top-0 h-[calc(100vh-120px)] overflow-y-auto flex flex-col">
      <div className="px-3 py-3 border-b border-slate-100">
        <p className="text-[10px] font-bold uppercase tracking-widest text-slate-400">Report Categories</p>
      </div>
      <nav className="flex-1 overflow-y-auto py-1">
        {/* Search results mode: flat filtered list */}
        {searchResults ? (
          <div className="px-2 py-1 space-y-0.5">
            {CATEGORY_ORDER.filter(cat => searchResults.some(r => r.category === cat)).map(cat => {
              const grad = CATEGORY_GRADIENTS[cat];
              const Icon = grad?.icon ?? BarChart3;
              const catResults = searchResults.filter(r => r.category === cat);
              return (
                <div key={cat}>
                  <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2 pt-2 pb-1">{cat}</p>
                  {catResults.map(r => (
                    <button
                      key={r.code}
                      type="button"
                      onClick={() => { selectReport(r); }}
                      className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                        selectedReport?.code === r.code
                          ? "bg-blue-100 text-blue-700 font-medium"
                          : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                      }`}
                    >
                      {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                      {r.name}
                    </button>
                  ))}
                </div>
              );
            })}
            {searchResults.length === 0 && (
              <p className="text-xs text-slate-400 px-3 py-4">No results</p>
            )}
          </div>
        ) : (
          /* Normal mode: category accordion */
          <div className="px-2 py-1 space-y-0.5">
            {CATEGORY_ORDER.filter(cat => grouped[cat]).map(cat => {
              const grad = CATEGORY_GRADIENTS[cat];
              const Icon = grad?.icon ?? BarChart3;
              const isOpen = selectedCat === cat;
              const subcats = Array.from(new Set(grouped[cat].map(r => r.subcategory)));

              return (
                <div key={cat}>
                  {/* Category row */}
                  <button
                    type="button"
                    onClick={() => toggleCategory(cat)}
                    className={`w-full flex items-center gap-2.5 px-2 py-2 rounded-lg text-left transition-colors ${
                      isOpen
                        ? "bg-blue-50 text-blue-700 border-l-2 border-blue-500"
                        : "text-slate-700 hover:bg-slate-50 border-l-2 border-transparent"
                    }`}
                  >
                    <div className={`w-5 h-5 rounded-md bg-gradient-to-br ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"} flex items-center justify-center flex-shrink-0`}>
                      <Icon size={11} className="text-white" />
                    </div>
                    <span className="flex-1 text-xs font-semibold truncate">{cat}</span>
                    <ChevronDown
                      size={13}
                      className={`flex-shrink-0 text-slate-400 transition-transform duration-200 ${isOpen ? "rotate-180" : ""}`}
                    />
                  </button>

                  {/* Expanded: subcategory + report rows */}
                  {isOpen && (
                    <div className="ml-4 border-l border-slate-200 mt-0.5 mb-1">
                      {subcats.map(sub => {
                        const subReports = grouped[cat].filter(r => r.subcategory === sub);
                        return (
                          <div key={sub}>
                            <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-3 pt-2 pb-0.5">{sub}</p>
                            {subReports.map(r => (
                              <button
                                key={r.code}
                                type="button"
                                onClick={() => selectReport(r)}
                                className={`w-full text-left text-xs px-3 py-1.5 rounded-lg transition-colors ${
                                  selectedReport?.code === r.code
                                    ? "bg-blue-100 text-blue-700 font-medium"
                                    : "text-slate-600 hover:bg-blue-50 hover:text-blue-600"
                                }`}
                              >
                                {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                                {r.name}
                              </button>
                            ))}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </nav>
    </aside>
  );

  return (
    <HrmsModernShell
      eyebrow="Reports"
      title="Reports Center"
      description="Run workforce, attendance, payroll, compliance, ATS, and productivity reports from one consistent MAS Callnet workspace."
      icon={<BarChart3 size={22} />}
      actions={
        <div className="relative w-full sm:w-[320px] xl:w-[420px]">
          <Search size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            className="w-full h-10 pl-10 pr-10 text-sm rounded-lg bg-white border border-slate-200 shadow-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            placeholder="Search reports..."
            value={searchQ}
            onChange={e => setSearchQ(e.target.value)}
          />
          {searchQ && (
            <button type="button" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600" onClick={() => setSearchQ("")}>
              <X size={14} />
            </button>
          )}
        </div>
      }
    >
      <style>{`
        @keyframes slideUp {
          from { transform: translateY(20px); opacity: 0; }
          to { transform: translateY(0); opacity: 1; }
        }
        @keyframes fadeInRow {
          from { opacity: 0; transform: translateY(4px); }
          to { opacity: 1; transform: translateY(0); }
        }
        .animate-slide-up { animation: slideUp 0.3s ease-out forwards; }
        .animate-fade-row { animation: fadeInRow 0.3s ease-out forwards; }
      `}</style>

      {/* ── Two-column layout ─────────────────────────────────────────── */}
      <div className="flex min-h-0 bg-slate-50 rounded-xl border border-slate-200 overflow-hidden shadow-sm">

        {/* Left panel */}
        {leftPanel}

        {/* Right content */}
        <div className="flex-1 min-w-0 overflow-y-auto p-4 space-y-4">

          {/* Stats tiles */}
          <div className="grid gap-4 md:grid-cols-3">
            <HrmsBentoTile
              title="Reports"
              value={animatedTotal}
              detail="Across HR, payroll, ATS, WFM, and compliance"
              icon={<BarChart3 className="h-5 w-5 text-blue-600" />}
              accentClassName="from-blue-600 to-cyan-500"
            />
            <HrmsBentoTile
              title="Categories"
              value={animatedCats}
              detail="Grouped as tiles for faster scanning"
              icon={<Layers className="h-5 w-5 text-violet-600" />}
              accentClassName="from-violet-500 to-purple-600"
            />
            <HrmsBentoTile
              title="Favourites"
              value={animatedFavs}
              detail={favCount > 0 ? "Saved for quick launch" : "Star reports to pin them here"}
              icon={<Star className="h-5 w-5 text-amber-500" fill={favCount > 0 ? "currentColor" : "none"} />}
              accentClassName="from-amber-500 to-orange-500"
            />
          </div>

          {/* Recent bar */}
          {recentReports.length > 0 && (
            <div className="flex items-center gap-2 overflow-x-auto rounded-xl border border-slate-200 bg-white p-3 shadow-sm">
              <Clock size={13} className="text-slate-400 flex-shrink-0" />
              {recentReports.slice(0, 8).map(r => (
                <button
                  key={r.code}
                  type="button"
                  onClick={() => selectReport(r)}
                  className="flex-shrink-0 text-xs px-3 py-1.5 rounded-full bg-slate-50 text-slate-700 border border-slate-200 hover:bg-blue-50 hover:text-blue-700 transition-colors"
                >
                  {r.name.length > 28 ? r.name.slice(0, 28) + "..." : r.name}
                </button>
              ))}
            </div>
          )}

          {/* No category selected — prompt */}
          {!selectedCat && !selectedReport && !searchResults && (
            <div className="bg-white rounded-xl border border-dashed border-slate-300 py-16 text-center shadow-sm">
              <BarChart3 size={36} className="mx-auto text-slate-200 mb-3" />
              <p className="text-sm text-slate-400 font-medium">← Select a category from the left panel to browse reports</p>
            </div>
          )}

          {/* Favourites (no report selected, has favs, no search) */}
          {!selectedReport && favCodes.size > 0 && !searchResults && (
            <div className="bg-white rounded-xl border border-slate-200 p-5 shadow-sm">
              <p className="text-xs font-bold text-gray-500 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                <Star size={12} className="text-yellow-400" fill="currentColor" /> Favourites
              </p>
              <div className="flex flex-wrap gap-2">
                {Array.from(favCodes).map(code => {
                  const r = CATALOG.find(x => x.code === code);
                  return r ? (
                    <button key={code} type="button" onClick={() => selectReport(r)}
                      className="text-xs px-3 py-1.5 bg-yellow-50 border border-yellow-200 text-yellow-800 rounded-lg hover:bg-yellow-100 font-medium transition-colors">
                      {r.name}
                    </button>
                  ) : null;
                })}
              </div>
            </div>
          )}

          {/* Category report list (when category selected, no specific report running) */}
          {selectedCat && !searchResults && grouped[selectedCat] && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden animate-slide-up">
              {(() => {
                const grad = CATEGORY_GRADIENTS[selectedCat];
                return (
                  <div className={`h-1.5 bg-gradient-to-r ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"}`} />
                );
              })()}
              <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3">
                {(() => {
                  const grad = CATEGORY_GRADIENTS[selectedCat];
                  const Icon = grad?.icon ?? BarChart3;
                  return (
                    <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${grad?.from ?? "from-slate-400"} ${grad?.to ?? "to-slate-500"} flex items-center justify-center shadow-sm`}>
                      <Icon size={15} className="text-white" />
                    </div>
                  );
                })()}
                <div className="flex-1">
                  <h2 className="text-sm font-bold text-slate-800">{selectedCat}</h2>
                  <p className="text-xs text-slate-400">{grouped[selectedCat].length} reports</p>
                </div>
              </div>
              <div className="p-5 space-y-4">
                {Array.from(new Set(grouped[selectedCat].map(r => r.subcategory))).map(sub => {
                  const subReports = grouped[selectedCat].filter(r => r.subcategory === sub);
                  return (
                    <div key={sub}>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider mb-2">{sub}</p>
                      <div className="flex flex-wrap gap-2">
                        {subReports.map(r => (
                          <button
                            key={r.code}
                            type="button"
                            onClick={() => selectReport(r)}
                            className={`text-xs px-3 py-1.5 rounded-lg font-medium transition-all ${
                              selectedReport?.code === r.code
                                ? "bg-blue-600 text-white shadow-md ring-2 ring-blue-300"
                                : "bg-gray-50 text-gray-700 hover:bg-blue-50 hover:text-blue-700 border border-gray-100"
                            }`}
                          >
                            {favCodes.has(r.code) && <Star size={9} className="inline mr-1 text-yellow-400" fill="currentColor" />}
                            {r.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Search results list (when search active) */}
          {searchResults && (
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 animate-slide-up">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-sm font-bold text-gray-800">Search Results ({searchResults.length})</h3>
                <button type="button" onClick={() => setSearchQ("")} className="text-xs text-gray-400 hover:text-gray-600 flex items-center gap-1">
                  <X size={12} /> Clear
                </button>
              </div>
              {searchResults.length === 0 ? (
                <p className="text-sm text-gray-400">No reports matching "{searchQ}"</p>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
                  {searchResults.slice(0, 30).map(r => {
                    const grad = CATEGORY_GRADIENTS[r.category];
                    return (
                      <button
                        key={r.code}
                        type="button"
                        onClick={() => { selectReport(r); setSearchQ(""); }}
                        className={`text-left px-3 py-2.5 rounded-lg border transition-all hover:shadow-md ${
                          selectedReport?.code === r.code ? "border-blue-500 bg-blue-50 ring-2 ring-blue-200" : "border-gray-100 hover:border-gray-200 bg-white"
                        }`}
                      >
                        <p className="text-xs font-semibold text-gray-800 leading-snug">{r.name}</p>
                        <p className={`text-[10px] mt-1 font-medium bg-gradient-to-r ${grad?.from ?? "from-gray-500"} ${grad?.to ?? "to-gray-600"} bg-clip-text text-transparent`}>
                          {r.category}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* ── Runner Panel ─────────────────────────────────────────────── */}
          {selectedReport && (
            <div ref={runnerRef} className="animate-slide-up space-y-4">
              {/* Report Header */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
                <div className="px-5 py-4 border-b border-gray-100">
                  <div className="flex items-start justify-between gap-4 flex-wrap">
                    <div className="flex items-center gap-3">
                      {(() => {
                        const grad = CATEGORY_GRADIENTS[selectedReport.category];
                        const Icon = grad?.icon ?? BarChart3;
                        return (
                          <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${grad?.from ?? "from-gray-500"} ${grad?.to ?? "to-gray-600"} flex items-center justify-center shadow-sm`}>
                            <Icon size={16} className="text-white" />
                          </div>
                        );
                      })()}
                      <div>
                        <h2 className="text-base font-bold text-gray-900">{selectedReport.name}</h2>
                        <p className="text-xs text-gray-400 mt-0.5">{selectedReport.category} / {selectedReport.subcategory}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleFav(selectedReport.code)}
                        className={`p-2 rounded-lg border transition-colors ${
                          favCodes.has(selectedReport.code) ? "bg-yellow-50 border-yellow-200 text-yellow-500" : "bg-white border-gray-200 text-gray-400 hover:text-yellow-400"
                        }`}
                        title={favCodes.has(selectedReport.code) ? "Remove from favourites" : "Add to favourites"}
                      >
                        <Star size={14} fill={favCodes.has(selectedReport.code) ? "currentColor" : "none"} />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setSelectedReport(null); setRows([]); setRunError(""); }}
                        className="p-2 rounded-lg border border-gray-200 text-gray-400 hover:text-gray-600 transition-colors"
                        title="Close report"
                      >
                        <X size={14} />
                      </button>
                    </div>
                  </div>

                  {selectedReport.requiresRunSelector && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-amber-700 bg-amber-50 px-3 py-2 rounded-lg">
                      <CheckCircle2 size={13} />
                      {selectedReport.directDownload
                        ? <span><span className="font-semibold">Tip:</span> Select the Month and optionally a Branch, then click Run to download the XLSX directly.</span>
                        : <span><span className="font-semibold">Tip:</span> This report uses payroll run data. Set the Month filter to the run month you want.</span>
                      }
                    </div>
                  )}
                </div>

                {/* Filter Row */}
                <div className="px-5 py-4">
                  <button
                    type="button"
                    onClick={() => setFiltersOpen(!filtersOpen)}
                    className="md:hidden flex items-center gap-2 text-sm font-medium text-gray-700 mb-3"
                  >
                    <Filter size={14} />
                    Filters {activeFilterCount > 0 && `(${activeFilterCount} active)`}
                    <ChevronDown size={14} className={`transition-transform ${filtersOpen ? "rotate-180" : ""}`} />
                  </button>

                  <div className={`${filtersOpen ? "" : "hidden md:block"}`}>
                    <div className="flex flex-wrap items-end gap-3">
                      {selectedReport.filters.map(def => {
                        const resolved = resolveFilterDef(def);
                        return (
                          <div key={def.key} className="space-y-1 w-full sm:w-auto sm:min-w-[140px] sm:max-w-[200px]">
                            <label className="block text-xs font-medium text-gray-500">{def.label}</label>
                            <FilterInput
                              def={resolved}
                              value={filterValues[def.key] ?? ""}
                              onChange={v => setFilter(def.key, v)}
                            />
                          </div>
                        );
                      })}
                      <button
                        type="button"
                        disabled={running}
                        onClick={runReport}
                        className="flex items-center gap-2 px-5 h-9 bg-blue-600 hover:bg-blue-700 text-white text-sm font-semibold rounded-lg disabled:opacity-60 transition-colors shadow-sm"
                      >
                        {running ? <><Loader2 size={14} className="animate-spin" /> Running...</> : <><Play size={14} /> Run</>}
                      </button>
                    </div>
                  </div>
                </div>
              </div>

              {/* Error */}
              {runError && (
                <div className="bg-red-50 border border-red-200 rounded-xl px-4 py-3 text-sm text-red-700 flex items-center gap-2 animate-slide-up">
                  <X size={15} className="flex-shrink-0" />
                  <span>{runError} -- This report may not be implemented yet on the backend. It will be available in a future phase.</span>
                </div>
              )}

              {/* Results Table */}
              {rows.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm animate-slide-up">
                  <div className="px-5 py-3 border-b border-gray-100 flex items-center justify-between flex-wrap gap-2">
                    <div className="flex items-center gap-3">
                      <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 bg-blue-50 text-blue-700 rounded-full">
                        {rows.length.toLocaleString()} rows
                      </span>
                      <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 bg-gray-50 text-gray-600 rounded-full">
                        {columns.length} columns
                      </span>
                      {rows.length === 2000 && (
                        <span className="text-xs text-amber-600 font-medium">(limit reached -- export for full data)</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => downloadXlsx(rows, `${selectedReport.code}_${new Date().toISOString().slice(0, 10)}.xlsx`)}
                      className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-semibold rounded-lg transition-colors shadow-sm"
                    >
                      <Download size={14} /> Export XLSX
                    </button>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-gray-100 bg-gray-50 sticky top-0">
                          {columns.map(col => (
                            <th key={col} className="px-3 py-2.5 text-left font-semibold text-gray-500 uppercase tracking-wider whitespace-nowrap">
                              {col.replace(/_/g, " ")}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {rows.slice(0, 500).map((row, i) => (
                          <tr
                            key={i}
                            className={`hover:bg-blue-50/50 transition-colors animate-fade-row ${i % 2 === 0 ? "" : "bg-gray-50/50"}`}
                            style={{ animationDelay: `${Math.min(i * 20, 400)}ms`, opacity: 0 }}
                          >
                            {columns.map(col => (
                              <td key={col} className="px-3 py-2 text-gray-700 whitespace-nowrap max-w-[220px] truncate" title={String(row[col] ?? "")}>
                                {row[col] == null ? <span className="text-gray-300">--</span> : String(row[col])}
                              </td>
                            ))}
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    {rows.length > 500 && (
                      <p className="px-5 py-3 text-xs text-gray-400 border-t border-gray-100">
                        Showing 500 of {rows.length.toLocaleString()} rows in the table. Export XLSX to see all rows.
                      </p>
                    )}
                  </div>
                </div>
              )}

              {/* No results yet */}
              {!running && !runError && rows.length === 0 && (
                <div className="bg-white rounded-xl border border-slate-200 py-14 text-center shadow-sm">
                  <BarChart3 size={36} className="mx-auto text-gray-200 mb-3" />
                  <p className="text-sm text-gray-400 font-medium">Set filters above and click Run to generate the report</p>
                </div>
              )}
            </div>
          )}

        </div>{/* end right content */}
      </div>{/* end two-column flex */}
    </HrmsModernShell>
  );
}
