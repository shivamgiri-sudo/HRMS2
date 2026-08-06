/**
 * Central report executor dispatcher.
 *
 * executeReport() is the canonical entry point for ALL suite report codes.
 * It throws ReportExecutorNotFoundError for any unregistered code — callers
 * must handle this explicitly (never silently return a placeholder row).
 *
 * dispatchReport() routes across all three report families (suite, BPO master,
 * identity builder). Use this in the worker and any cross-family call sites.
 */
import type { ExecFilters, ExecScope, ExecOptions, ExecResult, ExecutorFn } from "./types.js";
import { ReportExecutorNotFoundError } from "./types.js";

// ─── Employee / HR & Workforce ──────────────────────────────────────────────
import {
  headcount,
  employeeMaster,
  managerMapping,
  orgStructureSnapshot,
  costCentreHeadcount,
  employeeMovement,
  confirmationDueList,
  contractExpiryList,
  lifecycleEvents,
  incrementPromotionHistory,
  birthdayList,
  anniversaryList,
} from "./employee.executor.js";

// ─── Attendance ──────────────────────────────────────────────────────────────
import {
  attendanceDaily,
  dailyHcShift,
  shiftAdherenceDetail,
  attendanceSummary,
  lateArrivalSummary,
  overtimeSummary,
  regularizationSummary,
  attendanceDisputeSummary,
  habitualAbsenteeList,
  dailyShrinkageReport,
  monthlyShrinkageTrend,
  biometricReconciliation,
  punchRawExport,
  attendanceRegisterGrid,
  breakDailySummary,
  breakSessionLog,
} from "./attendance.executor.js";

// ─── Leave ───────────────────────────────────────────────────────────────────
import {
  leaveBalance,
  leaveAllocationRegister,
  leaveUtilization,
  leaveTrendMonthly,
  leaveLwpReconciliation,
  maternityPaternityRegister,
  leaveEncashmentRegister,
  leaveLapseSummary,
  holidayMasterList,
} from "./leave.executor.js";

// ─── Payroll ─────────────────────────────────────────────────────────────────
import {
  payrollRegister,
  payrollVariance,
  salarySheetOnfido,
  bankAdvice,
  payrollReconciliation,
  arrearPaymentRegister,
  payrollCostSummary,
} from "./payroll.executor.js";

// ─── Statutory ───────────────────────────────────────────────────────────────
import {
  pfContributionRegister,
  pfEcrFormat,
  esicContributionRegister,
  ptRegister,
  tdsComputationRegister,
  form16Status,
  investmentDeclarationStatus,
  gratuityLiabilityRegister,
} from "./statutory.executor.js";

// ─── Exit & Attrition ────────────────────────────────────────────────────────
import {
  resignationRegister,
  fnfPendingRegister,
  fnfSettlementRegister,
  clearanceStatusRegister,
  monthlyAttritionSummary,
  exitReasonAnalysis,
  tenureDistribution,
  earlyAttritionReport,
} from "./exit.executor.js";

// ─── Recruitment ─────────────────────────────────────────────────────────────
import {
  recruitmentPipeline,
  candidateTracker,
  sourceEffectiveness,
  recruiterProductivity,
  offerTracker,
  joiningPending,
} from "./recruitment.executor.js";

// ─── Operations & Quality ────────────────────────────────────────────────────
import {
  agentPerformanceSummary,
  teamPerformanceSummary,
  qualityAuditLog,
  fatalErrorRegister,
} from "./operations.executor.js";

// ─── WFM & Roster ────────────────────────────────────────────────────────────
import {
  rosterPublished,
  rosterVariance,
  shiftSwapRegister,
  weekOffCalendar,
} from "./wfm.executor.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
import {
  assetInventory,
  assetAllocationRegister,
  assetMovementLog,
  documentExpiryTracker,
} from "./assets.executor.js";

// ─── LMS / Training ──────────────────────────────────────────────────────────
import {
  trainingCompletionStatus,
} from "./lms.executor.js";

// ─── Identity ────────────────────────────────────────────────────────────────
import {
  uanStatusReport,
  esicStatusReport,
  panVerificationStatus,
  bankAccountVerification,
  identitySourceSnapshot,
} from "./identity.executor.js";

// ─── Governance (placeholders) ───────────────────────────────────────────────
import {
  complianceAuditSummary,
  helpDeskSummary,
  grievanceRegister,
  auditObservationRegister,
} from "./governance.executor.js";

// ---------------------------------------------------------------------------
// EXECUTOR_MAP — maps every report code to its canonical executor function
// ---------------------------------------------------------------------------
export const EXECUTOR_MAP: Record<string, ExecutorFn> = {
  // HR & Workforce
  "headcount":                 headcount,
  "employee-master":           employeeMaster,
  "manager-mapping":           managerMapping,
  "org-structure-snapshot":    orgStructureSnapshot,
  "cost-centre-headcount":     costCentreHeadcount,
  "employee-movement":         employeeMovement,
  "confirmation-due-list":     confirmationDueList,
  "contract-expiry-list":      contractExpiryList,
  "lifecycle-events":          lifecycleEvents,
  "increment-promotion-history": incrementPromotionHistory,
  "birthday-list":             birthdayList,
  "anniversary-list":          anniversaryList,

  // Attendance
  "attendance-daily":          attendanceDaily,
  "daily-hc-shift":            dailyHcShift,
  "shift-adherence-detail":    shiftAdherenceDetail,
  "attendance-summary":        attendanceSummary,
  "attendance-register-grid":  attendanceRegisterGrid,
  "late-arrival-summary":      lateArrivalSummary,
  "overtime-summary":          overtimeSummary,
  "biometric-reconciliation":  biometricReconciliation,
  "regularization-summary":    regularizationSummary,
  "attendance-dispute-summary": attendanceDisputeSummary,
  "habitual-absentee-list":    habitualAbsenteeList,
  "daily-shrinkage-report":    dailyShrinkageReport,
  "monthly-shrinkage-trend":   monthlyShrinkageTrend,
  "punch-raw-export":          punchRawExport,
  "break-daily-summary":       breakDailySummary,
  "break-session-log":         breakSessionLog,

  // Leave
  "leave-balance":             leaveBalance,
  // Backward-compatible alias: the old wide-pivot "leave-balance-export" report was
  // consolidated into the canonical "leave-balance" report. Existing saved requests,
  // favourites and deep-links that still carry the old code keep working and resolve
  // to the same implementation. It is no longer listed separately in the catalog.
  "leave-balance-export":      leaveBalance,
  "leave-allocation-register": leaveAllocationRegister,
  "leave-utilization":         leaveUtilization,
  "leave-trend-monthly":       leaveTrendMonthly,
  "leave-lwp-reconciliation":  leaveLwpReconciliation,
  "maternity-paternity-register": maternityPaternityRegister,
  "leave-encashment-register": leaveEncashmentRegister,
  "leave-lapse-summary":       leaveLapseSummary,
  "holiday-master-list":       holidayMasterList,

  // Payroll
  "payroll-register":          payrollRegister,
  "payroll-variance":          payrollVariance,
  "salary-sheet-onfido":       salarySheetOnfido,
  "bank-advice":               bankAdvice,
  "payroll-reconciliation":    payrollReconciliation,
  "arrear-payment-register":   arrearPaymentRegister,
  "payroll-cost-summary":      payrollCostSummary,

  // Statutory
  "pf-contribution-register":  pfContributionRegister,
  "pf-ecr-format":             pfEcrFormat,
  "esic-contribution-register": esicContributionRegister,
  "pt-register":               ptRegister,
  "tds-computation-register":  tdsComputationRegister,
  "form-16-status":            form16Status,
  "investment-declaration-status": investmentDeclarationStatus,
  "gratuity-liability-register": gratuityLiabilityRegister,

  // Exit & Attrition
  "resignation-register":      resignationRegister,
  "fnf-pending-register":      fnfPendingRegister,
  "fnf-settlement-register":   fnfSettlementRegister,
  "clearance-status-register": clearanceStatusRegister,
  "monthly-attrition-summary": monthlyAttritionSummary,
  "exit-reason-analysis":      exitReasonAnalysis,
  "tenure-distribution":       tenureDistribution,
  "early-attrition-report":    earlyAttritionReport,

  // Recruitment
  "recruitment-pipeline":      recruitmentPipeline,
  "candidate-tracker":         candidateTracker,
  "source-effectiveness":      sourceEffectiveness,
  "recruiter-productivity":    recruiterProductivity,
  "offer-tracker":             offerTracker,
  "joining-pending":           joiningPending,

  // Operations & Quality
  "agent-performance-summary": agentPerformanceSummary,
  "team-performance-summary":  teamPerformanceSummary,
  "quality-audit-log":         qualityAuditLog,
  "fatal-error-register":      fatalErrorRegister,

  // WFM & Roster
  "roster-published":          rosterPublished,
  "roster-variance":           rosterVariance,
  "shift-swap-register":       shiftSwapRegister,
  "week-off-calendar":         weekOffCalendar,

  // Assets & Documents
  "asset-inventory":           assetInventory,
  "asset-allocation-register": assetAllocationRegister,
  "asset-movement-log":        assetMovementLog,
  "document-expiry-tracker":   documentExpiryTracker,

  // LMS / Training
  "training-completion-status": trainingCompletionStatus,

  // Identity
  "uan-status-report":         uanStatusReport,
  "esic-status-report":        esicStatusReport,
  "pan-verification-status":   panVerificationStatus,
  "bank-account-verification": bankAccountVerification,
  "identity-source-snapshot":  identitySourceSnapshot,

  // Governance (placeholders — availabilityStatus: 'draft')
  "compliance-audit-summary":  complianceAuditSummary,
  "helpdesk-summary":          helpDeskSummary,
  "grievance-register":        grievanceRegister,
  "audit-observation-register": auditObservationRegister,
};

// ---------------------------------------------------------------------------
// executeReport — canonical dispatcher for suite report codes
// ---------------------------------------------------------------------------
export async function executeReport(
  code: string,
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const executor = EXECUTOR_MAP[code];
  if (!executor) {
    throw new ReportExecutorNotFoundError(code);
  }
  return executor(filters, scope, options);
}

// Re-export types needed by callers
export {
  ReportExecutorNotFoundError,
  type ExecFilters,
  type ExecScope,
  type ExecOptions,
  type ExecResult,
  type ExecutorFn,
} from "./types.js";
