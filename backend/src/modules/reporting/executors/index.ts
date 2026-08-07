/**
 * Central report executor dispatcher.
 *
 * executeReport() is the canonical entry point for ALL suite report codes.
 * It throws ReportExecutorNotFoundError for any unregistered code â€” callers
 * must handle this explicitly (never silently return a placeholder row).
 *
 * dispatchReport() routes across all three report families (suite, BPO master,
 * identity builder). Use this in the worker and any cross-family call sites.
 */
import type { ExecFilters, ExecScope, ExecOptions, ExecResult, ExecutorFn } from "./types.js";
import { ReportExecutorNotFoundError } from "./types.js";

// â”€â”€â”€ Employee / HR & Workforce â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
  orgMappingGaps,
  employeeStatusConflicts,
} from "./employee.executor.js";

// ─── Organisation masters ────────────────────────────────────────────────────
import {
  costCentreMasterReport,
  processMasterReport,
  headcountByCostCentreAndProcess,
} from "./org-master.executor.js";

// â”€â”€â”€ Attendance â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Leave â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Payroll â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  payrollRegister,
  payrollVariance,
  salarySheetOnfido,
  bankAdvice,
  payrollReconciliation,
  arrearPaymentRegister,
  payrollCostSummary,
  ytdSalarySummary,
} from "./payroll.executor.js";

// â”€â”€â”€ Statutory â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Exit & Attrition â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

// â”€â”€â”€ Recruitment â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  recruitmentPipeline,
  candidateTracker,
  sourceEffectiveness,
  recruiterProductivity,
  offerTracker,
  joiningPending,
} from "./recruitment.executor.js";

// â”€â”€â”€ Operations & Quality â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  agentPerformanceSummary,
  teamPerformanceSummary,
  qualityAuditLog,
  fatalErrorRegister,
} from "./operations.executor.js";

// â”€â”€â”€ WFM & Roster â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  rosterPublished,
  rosterVariance,
  shiftSwapRegister,
  weekOffCalendar,
} from "./wfm.executor.js";

// â”€â”€â”€ Assets â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  assetInventory,
  assetAllocationRegister,
  assetMovementLog,
  documentExpiryTracker,
  documentVerificationStatus,
  certificationStatus,
} from "./assets.executor.js";

// â”€â”€â”€ LMS / Training â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  trainingCompletionStatus,
} from "./lms.executor.js";

// â”€â”€â”€ Identity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  uanStatusReport,
  esicStatusReport,
  panVerificationStatus,
  bankAccountVerification,
  identitySourceSnapshot,
} from "./identity.executor.js";

// â”€â”€â”€ Governance (placeholders) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
import {
  complianceAuditSummary,
  helpDeskSummary,
  grievanceRegister,
  auditObservationRegister,
} from "./governance.executor.js";

// ---------------------------------------------------------------------------
// EXECUTOR_MAP â€” maps every report code to its canonical executor function
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
  // Exception reports backing the UNASSIGNED convention and the active_status ruling.
  "org-mapping-gaps":          orgMappingGaps,
  "employee-status-conflicts": employeeStatusConflicts,

  // Organisation masters — cost centre and process were unreported until 2026-08-07.
  "cost-centre-master-report":            costCentreMasterReport,
  "process-master-report":                processMasterReport,
  "headcount-by-cost-centre-and-process": headcountByCostCentreAndProcess,

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
  "ytd-salary-summary":       ytdSalarySummary,

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
  "document-verification-status": documentVerificationStatus,
  "certification-status":        certificationStatus,

  // LMS / Training
  "training-completion-status": trainingCompletionStatus,

  // Identity
  "uan-status-report":         uanStatusReport,
  "esic-status-report":        esicStatusReport,
  "pan-verification-status":   panVerificationStatus,
  "bank-account-verification": bankAccountVerification,
  "identity-source-snapshot":  identitySourceSnapshot,

  // Governance (placeholders â€” availabilityStatus: 'draft')
  "compliance-audit-summary":  complianceAuditSummary,
  "helpdesk-summary":          helpDeskSummary,
  "grievance-register":        grievanceRegister,
  "audit-observation-register": auditObservationRegister,
};

// ---------------------------------------------------------------------------
// executeReport â€” canonical dispatcher for suite report codes
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
