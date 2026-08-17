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
  newJoinExport,
  leftEmployeeExport,
  incrementRequests,
  bankMissing,
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
import {
  payrollPopulationReconciliation,
  leaveLedgerVsRequestsReconciliation,
  costCentreVsBillingReconciliation,
  attendanceEnrollmentGap,
} from "./reconciliation.executor.js";

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
  productivityIndividualScorecard,
  attendanceRegisterMonthly,
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
    bankAdvice,
  payrollReconciliation,
  arrearPaymentRegister,
  payrollCostSummary,
  ytdSalarySummary,
  lwpDeductionRegister,
  neftTransferFile,
  payslipStatus,
  salarySheetExport,
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
  ptMonthlyRegister,
  pfEsicSalaryRegister,
  pfEsiOptOutRegister,
  uanMasterRegister,
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
  ffSettlementRegister,
} from "./exit.executor.js";

// ─── AON (Age on Network) & Attrition Analytics ──────────────────────────────
import {
  aonBucketHeadcount,
  aonBucketAttrition,
  aonBucketShrinkage,
  aonCohortSurvival,
  attritionDeepDive,
} from "./aon.executor.js";

// ─── Attrition risk ranking & leave reconciliation ───────────────────────────
import {
  attritionRiskScore,
  leaveAttendanceReconciliation,
} from "./attrition-risk.executor.js";

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
  rosterAdherence,
} from "./wfm.executor.js";

// ─── Assets ──────────────────────────────────────────────────────────────────
import {
  assetInventory,
  assetAllocationRegister,
  assetMovementLog,
  documentExpiryTracker,
  documentVerificationStatus,
  certificationStatus,
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
  employeeDocumentCompliance,
  missingDocumentsReport,
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
  "new-join-export":            newJoinExport,
  "left-employee-export":       leftEmployeeExport,
  "increment-requests":        incrementRequests,
  "uan-master-register":       uanMasterRegister,
  "ff-settlement-register":    ffSettlementRegister,
  "employee-document-compliance": employeeDocumentCompliance,
  "missing-documents-report":     missingDocumentsReport,
  "attendance-register-monthly": attendanceRegisterMonthly,
  "bank-missing":              bankMissing,
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

  // Reconciliations. Each exposes a discrepancy the audit could only find by hand-writing
  // SQL: three headcounts for one month, a leave ledger 40x its own request history, a
  // billing name that disagrees with the operational one, and missing attendance that is
  // actually an unenrolled biometric. All quantify; none recompute.
  "payroll-population-reconciliation":       payrollPopulationReconciliation,
  "leave-ledger-vs-requests-reconciliation": leaveLedgerVsRequestsReconciliation,
  "cost-centre-vs-billing-reconciliation":   costCentreVsBillingReconciliation,
  "attendance-enrollment-gap":               attendanceEnrollmentGap,

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
  "bank-advice":               bankAdvice,
  "payroll-reconciliation":    payrollReconciliation,
  "arrear-payment-register":   arrearPaymentRegister,
  "payroll-cost-summary":      payrollCostSummary,
  "ytd-salary-summary":       ytdSalarySummary,
  "lwp-deduction-register":   lwpDeductionRegister,
  "neft-transfer-file":       neftTransferFile,
  "payslip-status":           payslipStatus,
  "salary-sheet-export":      salarySheetExport,
  "pt-monthly-register":      ptMonthlyRegister,
  "pf-esic-salary-register":  pfEsicSalaryRegister,
  "pf-esi-optout-register":   pfEsiOptOutRegister,
  "roster-adherence":         rosterAdherence,
  "productivity-individual-scorecard": productivityIndividualScorecard,

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

  // AON (Age on Network) & Attrition Analytics — tenure buckets 0-30/31-60/61-90/90+
  // derived from date_of_joining at read time. No inline block claims these codes, so the
  // executor is what serves both the screen and the download.
  "aon-bucket-headcount":      aonBucketHeadcount,
  "aon-bucket-attrition":      aonBucketAttrition,
  "aon-bucket-shrinkage":      aonBucketShrinkage,
  "aon-cohort-survival":       aonCohortSurvival,
  "attrition-deep-dive":       attritionDeepDive,
  "attrition-risk-score":      attritionRiskScore,
  "leave-attendance-reconciliation": leaveAttendanceReconciliation,

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
