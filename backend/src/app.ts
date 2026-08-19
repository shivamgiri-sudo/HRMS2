import compression from "compression";
import { runWithRequestContext } from "./shared/requestContext.js";
import cors from "cors";
import express from "express";
import fs from "fs";
import helmet from "helmet";
import morgan from "morgan";
import path from "path";

import { env } from "./config/env.js";
import { errorHandler, notFoundHandler } from "./middleware/errorHandler.js";
import { globalLimiter, listEndpointLimiter, payrollRunLimiter, reportLimiter, publicRegistrationLimiter } from "./middleware/rateLimiter.js";
import { healthRouter } from "./routes/health.routes.js";
import { processRouter } from "./modules/process/process.routes.js";
import { integrationRouter } from "./modules/integration-hub/integration.routes.js";
import { wfmRouter } from "./modules/wfm/wfm.routes.js";
import { wfmRegularizationSecureRouter } from "./modules/wfm/wfm.regularization.secure.routes.js";
import { rosterActualSecureRouter } from "./modules/wfm/roster.actual.secure.routes.js";
import { rosterRouter } from "./modules/wfm/roster.routes.js";
import { leaveRouter } from "./modules/leave/leave.routes.js";
import { leaveSecureRouter } from "./modules/leave/leave.secure.routes.js";
import { payrollRouter } from "./modules/payroll/payroll.routes.js";
import { payrollSecureRouter } from "./modules/payroll/payroll.secure.routes.js";
import { payrollPublicRouter } from "./modules/payroll/payroll.public.routes.js";
import { payrollStatutoryConfigCompatRouter } from "./modules/payroll/payroll-statutory-config.compat.routes.js";
import { payrollLinesCompatRouter } from "./modules/payroll/payroll-lines.compat.routes.js";
import { payrollExtendedRouter } from "./modules/payroll/payroll-extended.routes.js";
import { payrollMoreRouter } from "./modules/payroll/payroll-more.routes.js";
import { payrollBranchReadinessRouter } from "./modules/payroll/payroll-branch-readiness.routes.js";
import { bankPaymentReadinessRouter } from "./modules/payroll/bank-payment-readiness.routes.js";
import { payrollProcessReadinessRouter } from "./modules/payroll/payroll-process-readiness.routes.js";
import { payrollReadinessCategoriesRouter } from "./modules/payroll/payroll-readiness-categories.routes.js";
import { salaryVerificationRouter } from "./modules/payroll/salary-verification.routes.js";
import { payrollCalendarRouter } from "./modules/payroll/payroll-calendar.routes.js";
import { payrollCostSummaryRouter } from "./modules/payroll/payroll-cost-summary.routes.js";
import { payrollStatutoryFilingRouter } from "./modules/payroll/payroll-statutory-filing.routes.js";
import { tdsCertificatePartARouter } from "./modules/payroll/tds-certificate-part-a.routes.js";
import { payrollVarianceRouter } from "./modules/payroll/payroll-variance.routes.js";
import { payrollAuditTrailRouter } from "./modules/payroll/payroll-audit-trail.routes.js";
import { loansRouter } from "./modules/payroll/loans.routes.js";
import { deductionEntryRouter } from "./modules/payroll/deduction-entry.routes.js";
import { payrollSignoffRouter } from "./modules/payroll/payroll-signoff.routes.js";
import { payrollCertificatesRouter } from "./modules/payroll/payroll-certificates.routes.js";
import { reimbursementsRouter } from "./modules/payroll/reimbursements.routes.js";
import { payrollStatutoryOverrideRouter } from "./modules/payroll/payroll-statutory-override.routes.js";
import { chequeValidationRouter } from "./modules/payroll/cheque-validation.routes.js";
import { disbursalRouter } from "./modules/payroll/disbursal.routes.js";
import { payrollWindowCronRouter } from "./modules/payroll/payroll-window.routes.js";
import { nocRouter } from "./modules/payroll/noc.routes.js";
import { runningSalaryRouter } from "./modules/payroll/running-salary.routes.js";
import salaryPackageRouter from "./modules/payroll/payroll-masters.routes.js";
import { employeeRouter } from "./modules/employees/employee.routes.js";
import { employeeReportMasterRouter } from "./modules/employees/employee.report-master.routes.js";
import { employeeSecureRouter } from "./modules/employees/employee.secure.routes.js";
import { employeeGovernanceRouter } from "./modules/employees/employee-governance.routes.js";
import { employeePhotoCompatRouter } from "./modules/employees/employee.photo.compat.routes.js";
import { rmChangeRouter } from "./modules/employees/rm-change.routes.js";
import { statutoryApprovalRouter } from "./modules/employees/statutory-approval.routes.js";
import { employeeJoiningDocumentsRouter, hrDocumentTemplatesRouter, payrollEpfComplianceRouter, publicEmployeeDocumentRouter } from "./modules/employees/employee.compliance.routes.js";
import companySealRouter from "./modules/employees/companySeal.routes.js";
import branchPayrollHrSignatoryRouter from "./modules/employees/branchPayrollHrSignatory.routes.js";
import { employeeBgvRouter } from "./modules/employees/employee-bgv.routes.js";
import { kpiRouter } from "./modules/kpi/kpi.routes.js";
import { kpiProcessRoleRouter } from "./modules/kpi/kpi.process-role.routes.js";
import { portalRouter } from "./modules/portal/portal.routes.js";
import { atsRouter, atsPublicRouter } from "./modules/ats/ats.routes.js";
import { atsFormConfigRouter } from "./modules/ats/ats-form-config.routes.js";
import { registrationEnhancedRouter } from "./modules/ats/registration.enhanced.routes.js";
import mockDigilockerRouter from "./modules/ats/mock-digilocker.routes.js";
import { queueRouter, queuePublicRouter } from "./modules/ats/queue.routes.js";
import { exitRouter } from "./modules/exit/exit.routes.js";
import { exitSecureRouter } from "./modules/exit/exit.secure.routes.js";
import { ffApprovalGuardCompatRouter } from "./modules/exit/ff-approval-guard.compat.routes.js";
import { migrationRouter } from "./modules/migration/migration.routes.js";
import { accessRouter } from "./modules/access/access.routes.js";
import { orgRouter } from "./modules/org/org.routes.js";
import { eventsRouter } from "./modules/org/events.routes.js";
import { orgSettingsRouter } from "./modules/org/org_settings.routes.js";
import { bulkUploadRouter } from "./modules/bulk-upload/bulk-upload.routes.js";
import { workflowRouter } from "./modules/workflow/workflow.routes.js";
import { lifecycleRouter } from "./modules/lifecycle/lifecycle.routes.js";
import { assetsRouter } from "./modules/assets/assets.routes.js";
import { filesRouter } from "./modules/files/files.routes.js";
import { employeeDocsRouter } from "./modules/employees/employee.documents.routes.js";
import { helpdeskRouter } from "./modules/helpdesk/helpdesk.routes.js";
import { uatPipelineRouter } from "./modules/uat-pipeline/uat-pipeline.routes.js";
import { uatInternalRouter } from "./modules/uat-pipeline/uat-internal.routes.js";
import { lettersRouter } from "./modules/letters/letters.routes.js";
import { publicJoiningKitRouter, joiningKitRouter } from "./modules/employees/joiningKit.routes.js";
import { appointmentEsignRouter } from "./modules/letters/appointment-esign.routes.js";
import { dscConfigRouter } from "./modules/letters/dscConfig.routes.js";
import { notificationRecipientsRouter } from "./modules/it-provisioning/notification-recipients.routes.js";
import { appointmentLetterRouter } from "./modules/letters/appointmentLetter.routes.js";
import { atsExtRouter } from "./modules/ats-extensions/ats-ext.routes.js";
import { wfmExtRouter } from "./modules/wfm-extensions/wfm-ext.routes.js";
import { managementRouter } from "./modules/management/management.routes.js";
import { dailyBriefRouter } from "./modules/management/daily-brief/daily-brief.routes.js";
import { rosterGovRouter } from "./modules/roster/roster.governance.routes.js";
import { weekoffPreferenceRouter } from "./modules/roster/weekoff-preference.routes.js";
import { rosterSelfSecureRouter } from "./modules/roster/roster.self.secure.routes.js";
import { rtaRouter } from "./modules/rta/rta.routes.js";
import { accountControlRouter } from "./modules/account-control/account.control.routes.js";
import { workforceMandateRouter } from "./modules/workforce-mandate/workforce.mandate.routes.js";
import { lmsRouter } from "./modules/lms/lms.routes.js";
import { lmsIntegrationRouter } from "./modules/lms-integration/lms-integration.routes.js";
import { benefitsRouter } from "./modules/benefits/benefits.routes.js";
import { careerRouter } from "./modules/career/career.routes.js";
import ijpRouter from "./modules/ijp/ijp.routes.js";
import { erpRouter } from "./modules/erp/erp.routes.js";
import { clientBillingRouter } from "./modules/client-billing/client-billing.routes.js";
import { inboxRouter } from "./modules/inbox/inbox.routes.js";
import { itProvisioningRouter } from "./modules/it-provisioning/it-provisioning.routes.js";
import { mobilityRouter } from "./modules/mobility/mobility.routes.js";
import { goalsRouter } from "./modules/goals/goals.routes.js";
import { jobsRouter } from "./modules/jobs/jobs.routes.js";
import { complianceRouter } from "./modules/compliance/compliance.routes.js";
import { privacyRouter } from "./modules/privacy/privacy.routes.js";
import { privacyPublicRouter } from "./modules/privacy/privacy.public.routes.js";
import { dpdpWithdrawalRouter } from "./modules/privacy/dpdp-withdrawal.routes.js";
import { performanceFeedbackRouter } from "./modules/performance-feedback/performance-feedback.routes.js";
import { engagementRouter } from "./modules/engagement/engagement.routes.js";
import { peopleExperienceRouter } from "./modules/people-experience/people-experience.routes.js";
import { communicationRouter } from "./modules/communication/communication.routes.js";
import { notificationAdminRouter } from "./modules/communication/notification-admin.routes.js";
import { emailTemplatesRouter } from "./modules/email-templates/email-templates.routes.js";
import { securityCenterRouter } from "./modules/security/security-center.routes.js";
import { attendanceEngineRouter } from "./modules/wfm/attendance-engine.routes.js";
import { attendanceDailyScopedRouter } from "./modules/wfm/attendance-daily-scoped.routes.js";
import { teamAttendanceMonthRouter } from "./modules/wfm/team-attendance-month.routes.js";
import { attendanceAprBulkRouter } from "./modules/wfm/attendance-apr-bulk.routes.js";
import { attendanceManualMarkRouter } from "./modules/wfm/attendance-manual-mark.routes.js";
import { biometricPunchRouter } from "./modules/wfm/biometric-punch.routes.js";
import { biometricLogsRouter } from "./modules/wfm/biometric-logs.routes.js";
import { cosecSyncRouter } from "./modules/wfm/cosec-sync.routes.js";
import { biometricSummaryRouter } from "./modules/wfm/biometric-summary.routes.js";
import { rosterImportRouter } from "./modules/wfm/roster-import.routes.js";
import shiftAliasRouter from "./modules/wfm/shift-alias.routes.js";
import headerMappingProfileRouter from "./modules/wfm/header-mapping-profile.routes.js";
import { planningModeRouter } from "./modules/wfm/planning-mode.routes.js";
import { rtaExceptionRouter } from "./modules/wfm/rta-exception.routes.js";
import { attendanceDisputeRouter } from "./modules/attendance/attendance.dispute.routes.js";
import { attendanceManualOverrideRouter } from "./modules/attendance/attendance.manual-override.routes.js";
import { discardRouter } from "./modules/discard/discard.routes.js";
import { mismatchReviewRouter } from "./modules/wfm/mismatch-review.routes.js";
import { attendanceExceptionsRouter } from "./modules/wfm/attendance-exceptions.routes.js";
import { billingConfigRouter } from "./modules/attendance/billing-config.routes.js";
import customizationRouter from "./modules/customization/customization.routes.js";
import { rosterMasterRouter } from "./modules/roster/roster-master.routes.js";
import rosterCapacityRouter from "./modules/roster/roster-capacity.routes.js";
import { reportingRouter } from "./modules/reporting/reporting.routes.js";
import { reportingLeaveBalanceRouter } from "./modules/reporting/reporting.leave-balance.routes.js";
import { reportAdminAuditRouter } from "./modules/reporting/report-admin-audit.routes.js";
import { authRouter } from "./modules/auth/auth.routes.js";
import { authLaunchRouter } from "./modules/auth/auth-launch.routes.js";
import passwordResetRouter from "./modules/auth/password-reset.routes.js";
import { roleAssignmentRouter } from "./modules/admin/role-assignment.routes.js";
import { clientRouter } from "./modules/portal/client.routes.js";
import { autoRosterSyncedRouter } from "./modules/wfm/auto-roster-synced.routes.js";
import { controlTowerRouter } from "./modules/control-tower/control-tower.routes.js";
import { payrollComplianceRouter } from "./modules/payroll-compliance/payrollCompliance.routes.js";
import { pfCreationRouter } from "./modules/payroll/pf-creation.routes.js";
import { atsFullParityRouter } from "./modules/ats-full-parity/atsFullParity.routes.js";
import { engagementIntelligenceRouter } from "./modules/engagement/engagement-intelligence.routes.js";
import legacyRouter from "./modules/legacy/legacy.routes.js";
import dialerRouter from "./modules/dialer/dialer.routes.js";
import { externalDbRouter } from "./modules/external-db/external-db.routes.js";
import { aprRouter } from "./modules/apr/apr.routes.js";
import { qualityDashboardRouter } from "./modules/quality-dashboard/quality-dashboard.routes.js";
import { clientDrillRouter } from "./modules/quality-dashboard/client-drill.routes.js";
import { qualityExecutiveRouter } from "./modules/quality-dashboard/quality-executive.routes.js";
import { qualityManagerRouter } from "./modules/quality-dashboard/quality-manager.routes.js";
import { qualityQARouter } from "./modules/quality-dashboard/quality-qa.routes.js";
import { qaAuditRouter } from "./modules/quality-dashboard/qa-audit.routes.js";
import { qualityGovernanceRouter } from "./modules/quality-dashboard/quality-governance.routes.js";
import { processMetricDefinitionRouter } from "./modules/kpi/process-metric-definition.routes.js";
import { qualityAggregationRouter } from "./modules/quality-dashboard/quality-aggregation.routes.js";
import { callMasterRouter } from "./modules/call-master/call-master.routes.js";
import { inboundRouter } from "./modules/call-master/inbound.routes.js";
import { salesUploadRouter } from "./modules/sales-upload/sales-upload.routes.js";
import { inboundQualityRouter } from "./modules/quality-dashboard/inbound-quality.routes.js";
import { magicalScriptRouter } from "./modules/quality-dashboard/magical-script.routes.js";
import { performanceDashboardRouter } from "./modules/performance-dashboard/performance-dashboard.routes.js";
import { performanceIntelligenceRouter } from "./modules/performance-intelligence/performance-intelligence.routes.js";
import { kpiMasterRouter } from "./modules/kpi/kpi-master.routes.js";
import { jobRequisitionRouter } from "./modules/job-requisition/job-requisition.routes.js";
import taskRouter from "./modules/tasks/task.routes.js";
import { payrollMastersRouter } from "./modules/payroll-masters/payrollMasters.routes.js";
import {
  assistantContextRouter,
  attendanceExceptionRouter,
  cosecMonitoringRouter,
  employee360Router,
  enterpriseReportsRouter,
  managementCommandCenterRouter,
  payrollReadinessRouter,
  workforcePlanningRouter,
} from "./modules/peopleos/peopleos.routes.js";
import { incentivesRouter } from "./modules/incentives/incentives.routes.js";
import { expenseRouter } from "./modules/expenses/expense.routes.js";
import { businessCommandRouter } from "./modules/business-command/business-command.routes.js";
import { businessActionsRouter } from "./modules/business-actions/business-actions.routes.js";
import { auditLogRouter } from "./modules/audit/audit.log.routes.js";
import { workInboxRouter } from "./modules/work-inbox/work-inbox.routes.js";
import { dashboardRouter } from "./modules/dashboards/dashboard.routes.js";
import dashboardTargetRouter from "./modules/dashboards/dashboard-target.routes.js";
import { tatRouter } from "./modules/governance/tat.routes.js";
import { nameConsistencyRouter } from "./modules/ats/name-consistency.routes.js";
import { jclrRouter } from "./modules/ats/jclr.routes.js";
import { joiningControlRoomRouter } from "./modules/ats/joining-control-room.routes.js";
import { secureDocumentsRouter } from "./modules/ats/secure-documents.routes.js";
import { salaryComponentAssignmentRouter } from "./modules/ats/salary-component-assignment.routes.js";
import { employeeCodeGateRouter } from "./modules/ats/employee-code-gate.routes.js";
import { payrollHRRouter } from "./modules/ats/payroll-hr.routes.js";
import { branchHeadApprovalRouter } from "./modules/ats/branch-head-approval.routes.js";
import { commandCentreRouter } from "./modules/ats/command-centre.routes.js";
import { bmiBenchmarkRouter } from "./modules/ats/bmi-benchmark.routes.js";
import { interviewRouter } from "./modules/ats/interview.routes.js";
// bgvEnhancedRouter removed — duplicate UI, name-match functions migrated to bgv-verification.service.ts
import bgvVerificationRouter from "./modules/ats/bgv-verification.routes.js";
import { candidatePortalRouter } from "./modules/ats/candidate-portal.routes.js";
import { superAdminRouter } from "./modules/ats/super-admin.routes.js";
import { vendorPaymentRouter } from "./modules/finance/vendor-payment.routes.js";
import { grnRouter } from "./modules/finance/grn.routes.js";
import { imprestRouter } from "./modules/finance/imprest.routes.js";
import { salaryVoucherRouter } from "./modules/finance/salary-voucher.routes.js";
import { costCentreManagementRouter } from "./modules/finance/cost-centre-management.routes.js";
import { processPnlRouter } from "./modules/process-pnl/process-pnl.routes.js";
import billabilityRouter from "./modules/process-pnl/billability.routes.js";
import { onboardingDataRouter } from "./modules/onboarding/onboarding-data.routes.js";
import { pennyDropRouter } from "./modules/onboarding/penny-drop.routes.js";
import { nameValidationRouter } from "./modules/onboarding/name-validation.routes.js";
import { digiLockerRouter } from "./modules/onboarding/digilocker.routes.js";
import { employeeReactivationRouter } from "./modules/employees/employee-reactivation.routes.js";
import { employeeVerifyRouter } from "./modules/employees/employee.verify.routes.js";
import { salaryIncrementRouter } from "./modules/salary-increment/salaryIncrement.routes.js";
import { breakDeskRouter } from "./modules/break-management/break-desk.routes.js";
import { breakManagementRouter } from "./modules/break-management/break-management.routes.js";
import { candidateOnboardingRouter } from "./modules/candidate-onboarding/candidate-onboarding.routes.js";
import { orgChartRouter } from "./modules/org-chart/org-chart.routes.js";
import { visitorRouter } from "./modules/visitor/visitor.routes.js";
import { visitorPublicRouter } from "./modules/visitor/visitor-public.routes.js";
import { loginInfoRouter } from "./modules/public/login-info.routes.js";
import { visitorSecurityRouter } from "./modules/visitor/visitor-security.routes.js";
import { pushRouter } from "./modules/push/push.routes.js";
import { locationRouter } from "./modules/location/location.routes.js";
import { socialFeedRouter } from "./modules/social-feed/social-feed.routes.js";
import { mcnmeetRouter } from "./modules/mcnmeet/mcnmeet.routes.js";

export const app = express();

app.set("trust proxy", 1);

// Compute once at startup — never rebuild on every request
const ALLOWED_ORIGINS: ReadonlySet<string> = new Set([
  env.FRONTEND_URL,
  ...String(process.env.CORS_ALLOWED_ORIGINS || "")
    .split(",")
    .map((o) => o.trim())
    .filter(Boolean),
]);

function isAllowedOrigin(origin: string): boolean {
  if (env.NODE_ENV !== "production" && (origin.startsWith("http://localhost:") || origin.startsWith("http://127.0.0.1:"))) return true;
  return ALLOWED_ORIGINS.has(origin);
}

app.use(compression({
  level: 6,
  threshold: 1024,
  filter: (req, res) => {
    if (req.path.includes("/stream") || req.path.includes("/biometric-punch")) return false;
    return compression.filter(req, res);
  },
}));
// Bind a per-request memoisation store before anything else runs, so
// authorization lookups (hasRole / getEmployeeForUser) are resolved once per
// request instead of re-querying on every call. The store is discarded when the
// request ends, so permission changes take effect on the very next request.
app.use((_req, _res, next) => runWithRequestContext(next));

app.use(helmet({ crossOriginResourcePolicy: { policy: "cross-origin" } }));
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || isAllowedOrigin(origin)) callback(null, true);
    else callback(new Error("Not allowed by CORS"));
  },
  credentials: true
}));
app.use(express.json({
  limit: "5mb",
  verify: (req: express.Request & { rawBody?: Buffer }, _res, buf) => { req.rawBody = buf; }
}));
app.use(express.urlencoded({ extended: true }));
app.use(morgan(env.NODE_ENV === "production" ? "combined" : "dev"));
app.use(globalLimiter);

const uploadsPath = path.resolve(process.cwd(), "uploads");

// Public: employee avatar photos served via /api/ so nginx proxy covers all devices.
// Filename is always {employeeId}.ext — basename-sanitised, no traversal risk.
const employeePhotosDir = path.join(uploadsPath, "employee-photos");
fs.mkdirSync(employeePhotosDir, { recursive: true });

app.get("/api/files/employee-photos/:filename", (req, res) => {
  const filename = path.basename(String(req.params.filename ?? ""));
  const ext = path.extname(filename).toLowerCase();
  if (![".jpg", ".jpeg", ".png", ".webp"].includes(ext)) {
    return res.status(400).json({ success: false, error: "Invalid file type" });
  }
  const filePath = path.join(employeePhotosDir, filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ success: false, error: "Not found" });
  }
  res.setHeader("Cache-Control", "public, max-age=604800, immutable");
  return res.sendFile(filePath);
});

// Legacy /uploads/employee-photos/* — keep working for old URLs already in browser cache
const UPLOADS_PUBLIC_ALLOWLIST = new Set(["/employee-photos/"]);
app.use("/uploads", (req, res, _next) => {
  const isAllowed = [...UPLOADS_PUBLIC_ALLOWLIST].some(prefix => req.path.startsWith(prefix));
  if (!isAllowed) {
    return res.status(403).json({
      success: false,
      message: "Direct access blocked. Use the secure document endpoint.",
    });
  }
  return express.static(uploadsPath)(req, res, _next);
});

app.get("/", (_req, res) => res.json({ success: true, service: "MCN HRMS Backend API", version: "1.0.0" }));

app.use("/api/auth", authRouter);
app.use("/api/auth", passwordResetRouter);
app.use("/api/break-desk", breakDeskRouter);
app.use("/api/break-management", breakManagementRouter);
if (process.env.NODE_ENV !== "production") {
  app.use("/api/mock-digilocker", mockDigilockerRouter);
}
app.use("/api/auth/launch", authLaunchRouter);
app.use("/api/candidate/onboarding", candidateOnboardingRouter);
app.use("/api/health", healthRouter);
app.use("/api/admin", roleAssignmentRouter);
app.use("/api/processes", processRouter);
app.use("/api/integration-hub", integrationRouter);
app.use("/api/wfm/auto-roster", autoRosterSyncedRouter);
app.use("/api/wfm", wfmRegularizationSecureRouter);
app.use("/api/wfm", wfmRouter);
app.use("/api/wfm/roster", rosterActualSecureRouter);
app.use("/api/wfm/roster", rosterRouter);
app.use("/api/leave", leaveSecureRouter);
app.use("/api/leave", leaveRouter);
// PUBLIC payslip QR verification — must precede every other /api/payroll router,
// since those apply requireAuth at router level and would 401 the scan first.
app.use("/api/payroll", payrollPublicRouter);
// PUBLIC DPDP grievance officer — the site footer requests this on every page, including
// the landing page and the privacy policy, where there is no token to send. It must precede
// clientRouter, which is mounted on the bare "/api" prefix and applies requireAuth at router
// level, so anything after it is unreachable anonymously.
app.use("/api/privacy", privacyPublicRouter);
app.use("/api/payroll", payrollStatutoryConfigCompatRouter);
app.use("/api/payroll", payrollLinesCompatRouter);
app.use("/api/payroll/readiness", payrollReadinessRouter);
app.use("/api/payroll/tds-certificate/part-a", tdsCertificatePartARouter);
app.use("/api/payroll", listEndpointLimiter, payrollSecureRouter);
app.use("/api/payroll", listEndpointLimiter, payrollRouter);
app.use("/api/payroll", listEndpointLimiter, payrollExtendedRouter);
app.use("/api/payroll", listEndpointLimiter, payrollMoreRouter);
app.use("/api/payroll/branch-readiness", listEndpointLimiter, payrollBranchReadinessRouter);
app.use("/api/payroll/bank-readiness", listEndpointLimiter, bankPaymentReadinessRouter);
app.use("/api/payroll/process-readiness", listEndpointLimiter, payrollProcessReadinessRouter);
app.use("/api/payroll/readiness-categories", listEndpointLimiter, payrollReadinessCategoriesRouter);
app.use("/api/payroll/salary-verification", listEndpointLimiter, salaryVerificationRouter);
app.use("/api/payroll/calendar", listEndpointLimiter, payrollCalendarRouter);
app.use("/api/payroll/cost-summary", listEndpointLimiter, payrollCostSummaryRouter);
app.use("/api/payroll/statutory-filing", listEndpointLimiter, payrollStatutoryFilingRouter);
app.use("/api/payroll/variance", listEndpointLimiter, payrollVarianceRouter);
app.use("/api/payroll/audit-trail", listEndpointLimiter, payrollAuditTrailRouter);
app.use("/api/payroll/loans", listEndpointLimiter, loansRouter);
app.use("/api/payroll", listEndpointLimiter, deductionEntryRouter);
app.use("/api/payroll/signoff", listEndpointLimiter, payrollSignoffRouter);
app.use("/api/payroll/salary-certificates", listEndpointLimiter, payrollCertificatesRouter);
app.use("/api/payroll/reimbursements", listEndpointLimiter, reimbursementsRouter);
app.use("/api/payroll/statutory-overrides", payrollStatutoryOverrideRouter);
app.use("/api/payroll/cheque-validation", chequeValidationRouter);
app.use("/api/payroll", disbursalRouter);
app.use("/api/payroll", payrollWindowCronRouter);
app.use("/api/payroll/noc", nocRouter);
app.use("/api/payroll", runningSalaryRouter);
app.use("/api/payroll-masters", salaryPackageRouter);
app.use("/api/payroll-compliance", payrollComplianceRouter);
app.use("/api/payroll/pf", pfCreationRouter);
app.use("/api/employees", listEndpointLimiter, employeeReportMasterRouter);
app.use("/api/employees", listEndpointLimiter, employeeSecureRouter);
app.use("/api/employees", listEndpointLimiter, employeeGovernanceRouter);
app.use("/api/employees", employeePhotoCompatRouter);
app.use("/api/employees", listEndpointLimiter, employee360Router);
app.use("/api/employees", listEndpointLimiter, employeeRouter);
app.use("/api/employees", listEndpointLimiter, employeeJoiningDocumentsRouter);
// HR-facing kit controls. Without these the dispatcher was only reachable by
// running a script on the server.
app.use("/api/employees", joiningKitRouter);
app.use("/api/employees", employeeReactivationRouter);
app.use("/api/bgv/employee", employeeBgvRouter);
app.use("/api/rm-change", rmChangeRouter);
app.use("/api/statutory-change-requests", statutoryApprovalRouter);
app.use("/api/kpi/process-role", kpiProcessRoleRouter);
app.use("/api/kpi-master", kpiMasterRouter);
app.use("/api/kpi", kpiRouter);
app.use("/api/portal", portalRouter);
app.use("/api/job-requisition", jobRequisitionRouter);
app.use("/api/ats", atsFormConfigRouter);
// Unauthenticated by design so a walk-in can self-register; rate limited
// because that also makes it reachable by anyone.
app.use("/api/ats/registration", publicRegistrationLimiter, registrationEnhancedRouter);
app.use("/api/ats/queue", queuePublicRouter); // public display endpoints (no auth)
app.use("/api/public/verify", employeeVerifyRouter); // public QR code verification (no auth)
app.use("/api/public/login-info", loginInfoRouter);  // public login page stats (no auth, aggregate only)
app.use("/api/ats/bgv", bgvVerificationRouter); // BGV token-driven routes (consent, verify, digilocker) — mount BEFORE requireAuth
app.use("/api/ats", atsPublicRouter); // PUBLIC: candidate file uploads (no auth, 1-hour window)
app.use("/api/visitor/public", visitorPublicRouter); // PUBLIC: token-scoped visitor registration and status only
app.use("/api/ats", atsRouter);
app.use("/api/ats/queue", queueRouter);
app.use("/api/business-command", businessCommandRouter);
app.use("/api/business-actions", businessActionsRouter);
app.use("/api/onboarding/digilocker", digiLockerRouter);
app.use("/api/ats-full-parity", atsFullParityRouter);
app.use("/api/exit", exitSecureRouter);
// exitCompatRouter and exitStatusGuardCompatRouter used to be mounted here. Both were
// entirely shadowed dead code — every route either defined was already registered by
// exitSecureRouter above, and Express dispatches to the first matching handler. Their
// intended protections (FSM-transition validity, clearance/F&F blockers on "exited") are
// consolidated into exitSecureRouter's handler instead. The two files are kept, unmounted,
// with a header comment — see exit.secure.routes.ts's handleExitStatusUpdate.
app.use("/api/exit", ffApprovalGuardCompatRouter);
app.use("/api/exit", exitRouter);
app.use("/api/migration", migrationRouter);
app.use("/api/access", accessRouter);
app.use("/api/audit", auditLogRouter);
app.use("/api/visitor", visitorSecurityRouter);
app.use("/api/visitor", visitorRouter);
app.use("/api/org/settings", orgSettingsRouter);
app.use("/api/org/events", eventsRouter);
app.use("/api/org", orgRouter);
app.use("/api/org-chart", orgChartRouter);
app.use("/api/ats-ext", atsExtRouter);
app.use("/api/files", filesRouter); // must be before clientRouter (which applies requireAuth to /api/*)
// Public joining-document e-sign links carry their own single-use token and must NOT
// require a session. This has to stay ABOVE the "/api" clientRouter mount below, which
// applies requireAuth to every /api/* path â€” when it sat underneath, every signing link
// a candidate clicked answered "missing authorization token".
app.use("/api/public/employee-documents", publicEmployeeDocumentRouter);
// The joining-kit signing link is emailed to the employee and carries its own
// token, so it must sit above the catch-all too. Mounted below it, every
// "Review & Sign All" button in every kit email would answer 401.
app.use("/api/public/joining-kit", publicJoiningKitRouter);
app.use("/api", clientRouter);
app.use("/api/onboarding/data", onboardingDataRouter);
app.use("/api/onboarding/penny-drop", pennyDropRouter);
app.use("/api/onboarding/name-validation", nameValidationRouter);
app.use("/api/bulk-upload", bulkUploadRouter);
app.use("/api/admin/email-templates", emailTemplatesRouter);
app.use("/api/workflow", workflowRouter);
app.use("/api/lifecycle", lifecycleRouter);
app.use("/api/assets-mgmt", assetsRouter);
app.use("/api/employee-docs", employeeDocsRouter);
app.use("/api/hr", hrDocumentTemplatesRouter);
app.use("/api/company-seal", companySealRouter);
// Per-branch Payroll HR signatory: the name printed on joining documents and
// the signature applied to the employer block. Mounted beside the company seal
// because it is the same concern scoped to a branch.
app.use("/api/branch-payroll-hr", branchPayrollHrSignatoryRouter);
app.use("/api/payroll", payrollEpfComplianceRouter);
app.use("/api/helpdesk", helpdeskRouter);
// UAT governance. Additive mount on a new path — no existing route changes behaviour.
app.use("/api/uat", uatPipelineRouter);
// Mounted BEFORE requireAuth on purpose: a GitHub-hosted runner has no HRMS session, so its
// only credential is an OIDC token. The router applies its own gate + OIDC middleware to
// every route it owns, and refuses entirely (503) while automated builds are held — which
// they are, until all eight gates in uat_gate_status are attested. See uat-internal.routes.ts.
app.use("/api/uat-internal", uatInternalRouter);
app.use("/api/letters", lettersRouter);
app.use("/api/letters", appointmentEsignRouter);
// Company signing certificate — super_admin only, handles private key material.
app.use("/api/signing", dscConfigRouter);
// Who receives each branch's provisioning notifications. Super-admin only —
// it decides who is told about every new joiner, company-wide.
app.use("/api/notification-recipients", notificationRecipientsRouter);
// Payroll HR issuance. Separate from appointment-esign.routes.ts, which is
// admin/hr only and sits on a table with two competing schemas.
app.use("/api/letters", appointmentLetterRouter);
app.use("/api/wfm-ext", wfmExtRouter);
app.use("/api/management", managementRouter);
app.use("/api/management", managementCommandCenterRouter);
// Phase B (MVP) D-1 Daily Manager Intelligence Briefing Engine — preview-only, dry-run,
// no scheduler/cron wiring yet. See modules/management/daily-brief/.
app.use("/api/management/daily-brief", dailyBriefRouter);
app.use("/api/roster-gov", rosterSelfSecureRouter);
app.use("/api/roster-gov", weekoffPreferenceRouter);
app.use("/api/roster-gov", rosterGovRouter);
app.use("/api/rta", rtaRouter);
app.use("/api/account-control", accountControlRouter);
app.use("/api/workforce-mandate", workforceMandateRouter);
app.use("/api/lms", lmsIntegrationRouter);
app.use("/api/lms", lmsRouter);
app.use("/api/benefits", benefitsRouter);
app.use("/api/career", careerRouter);
app.use("/api/ijp", ijpRouter);
app.use("/api/erp", erpRouter);
app.use("/api/client-billing", clientBillingRouter);
app.use("/api/finance", vendorPaymentRouter);
app.use("/api/finance", grnRouter);
// Mounted at its own /imprest prefix rather than bare /api/finance, so no imprest path can
// ever be shadowed by grnRouter's "/grns/:id"-shaped routes above it.
app.use("/api/finance/imprest", imprestRouter);
// Its own prefix, like imprest: a salary voucher exposes a whole branch payroll, and it must
// not be reachable through a path that a broader finance router also serves.
app.use("/api/finance/payroll", salaryVoucherRouter);
app.use("/api/finance/cost-centres", costCentreManagementRouter);
app.use("/api/finance", processPnlRouter);
// Mounted on its own base after processPnlRouter. Owning /api/finance/billability/* outright
// protects it from a wildcard ROUTE on the shared /api/finance base — but not from a path-less
// router.use() MIDDLEWARE on a router mounted earlier, which runs for every unmatched
// /api/finance/* request regardless of prefix. processPnlRouter had exactly that, and because
// requireRole answers 403 rather than calling next(), it denied this whole router to any role
// outside PNL_READ_ROLES. That gate is now scoped to "/pnl" (process-pnl.routes.ts). Any new
// path-less middleware added to a router on the shared base would reintroduce the same problem.
app.use("/api/finance/billability", billabilityRouter);
app.use("/api/inbox", inboxRouter);
app.use("/api/it-provisioning", itProvisioningRouter);
app.use("/api/onboarding-provisioning", itProvisioningRouter);
app.use("/api/mobility", mobilityRouter);
app.use("/api/salary-increment", salaryIncrementRouter);
app.use("/api/goals", goalsRouter);
app.use("/api/jobs", jobsRouter);
app.use("/api/compliance", complianceRouter);
// NOTE: dpdpWithdrawalRouter is mounted ONLY here. privacyRouter handles all other
// /api/privacy routes. Having both routers on the same prefix is correct — Express
// falls through to privacyRouter for paths not matched by dpdpWithdrawalRouter.
// The previous duplicate mount of dpdpWithdrawalRouter has been removed.
app.use("/api/privacy", dpdpWithdrawalRouter);
app.use("/api/privacy", privacyRouter);
app.use("/api/performance-feedback", performanceFeedbackRouter);
app.use("/api/engagement", engagementRouter);
app.use("/api/engagement-intelligence", engagementIntelligenceRouter);
app.use("/api/people-experience", peopleExperienceRouter);
app.use("/api/communication", communicationRouter);
app.use("/api/notification-admin", notificationAdminRouter);
app.use("/api/security-center", securityCenterRouter);
app.use("/api/external-db", externalDbRouter);
app.use("/api/apr", aprRouter);
app.use("/api/payroll-masters", payrollMastersRouter);
app.use("/api/incentives", incentivesRouter);
// Mounted ahead of the three routers below because they all share this prefix and the
// first registration of a path wins — /api/wfm/attendance/daily is already claimed
// three times over, and only wfm.routes.ts's copy is ever reached. /team-month is
// unique today; mounting it first keeps it that way.
app.use('/api/wfm/attendance', teamAttendanceMonthRouter);
app.use('/api/wfm/attendance', attendanceDailyScopedRouter);
app.use('/api/wfm/attendance', attendanceEngineRouter);
app.use('/api/wfm/attendance', attendanceAprBulkRouter);
app.use('/api/wfm/attendance/manual-mark', attendanceManualMarkRouter);
// Distinct path segment, not a child of /api/wfm/attendance — the three routers above
// cannot shadow it. Read-only worklist over attendance_reconciliation_issue.
app.use('/api/wfm/attendance-exceptions', attendanceExceptionsRouter);
app.use("/api/dialer", dialerRouter);
app.use("/api/tasks", taskRouter);
app.use('/api/wfm/biometric-punch', biometricPunchRouter);
app.use('/api/wfm/biometric-logs', biometricLogsRouter);
app.use('/api/wfm/cosec-sync', cosecSyncRouter);
app.use('/api/wfm/biometric-summary', biometricSummaryRouter);
app.use("/api/attendance/exception-engine", attendanceExceptionRouter);
app.use("/api/attendance", attendanceDisputeRouter);
app.use("/api/attendance", attendanceManualOverrideRouter);
// Discard of approved leave / regularization / dispute — super_admin + wfm only.
app.use("/api/discard", discardRouter);
app.use("/api/wfm/mismatches", mismatchReviewRouter);
app.use("/api/wfm/roster-imports", rosterImportRouter);
app.use("/api/wfm/shift-aliases", shiftAliasRouter);
app.use("/api/wfm/header-mapping-profiles", headerMappingProfileRouter);
app.use("/api/wfm/processes", planningModeRouter);
app.use("/api/wfm/rta/exceptions", rtaExceptionRouter);
app.use("/api/attendance/billing-config", billingConfigRouter);
app.use("/api/integrations/cosec", cosecMonitoringRouter);
app.use("/api/workforce-planning", workforcePlanningRouter);
app.use("/api/customization", customizationRouter);
app.use("/api/roster-master", rosterMasterRouter);
app.use("/api/roster-capacity", rosterCapacityRouter);
app.use('/api/reports', reportLimiter, reportingLeaveBalanceRouter);
app.use('/api/reports', reportLimiter, enterpriseReportsRouter);
app.use('/api/reports', reportLimiter, reportingRouter);
app.use('/api/admin/report-requests', reportAdminAuditRouter);
app.use("/api/assistant/context", assistantContextRouter);
app.use('/api/control-tower', controlTowerRouter);
app.use("/api/quality-dashboard/client-drill", clientDrillRouter);
app.use("/api/quality-dashboard", qualityDashboardRouter);
app.use("/api/executive", qualityExecutiveRouter);
app.use("/api/manager", qualityManagerRouter);
app.use("/api/qa", qualityQARouter);
app.use("/api/qa", qaAuditRouter);   // manual QA audit capture — the routes QA_EVALUATION/QA_CALIBRATION were granted for in June
app.use("/api/quality-governance", qualityGovernanceRouter);   // per-process quality targets, impact simulation, and the pipeline health view
app.use("/api/kpi/process-metrics", processMetricDefinitionRouter);   // per-process metric definitions — 1047 had readers and no writer
app.use("/api/agent", qualityAggregationRouter);
app.use("/api/call-master", callMasterRouter);
app.use("/api/inbound", inboundRouter);
app.use("/api/sales-upload", salesUploadRouter);
app.use("/api/inbound-quality", inboundQualityRouter);
app.use("/api/quality-dashboard/magical-script", magicalScriptRouter);
app.use("/api/performance-hub", performanceIntelligenceRouter);
app.use("/api/performance-dashboard", performanceDashboardRouter);
app.use("/api/legacy", legacyRouter);
app.use("/api/expenses", expenseRouter);
app.use("/api/work-inbox", workInboxRouter);
app.use("/api/dashboards/targets", dashboardTargetRouter);
app.use("/api/dashboards", dashboardRouter);
app.use("/api/governance/tat", tatRouter);
app.use("/api/ats/name-consistency", nameConsistencyRouter);
app.use("/api/ats/jclr", jclrRouter);
app.use("/api/ats/joining-control-room", joiningControlRoomRouter);
// Secure candidate document viewer (JCLR "Documents" tab). Mounted here, after
// clientRouter has applied requireAuth, because verify/reject read req.authUser.
// The router shipped in 03ee489e but was never mounted — every endpoint 404'd.
app.use("/api/ats", secureDocumentsRouter);
app.use("/api/ats/salary-components", salaryComponentAssignmentRouter);
app.use("/api/ats/employee-code", employeeCodeGateRouter);
app.use("/api/ats/payroll-hr", payrollHRRouter);
app.use("/api/ats/branch-head-approval", branchHeadApprovalRouter);
app.use("/api/ats/command-centre", commandCentreRouter);
app.use("/api/ats/bmi-benchmark", bmiBenchmarkRouter);
app.use("/api/ats/interview", interviewRouter);
// bgv-enhanced route removed — duplicate UI, functions migrated to canonical bgv-verification service
app.use("/api/ats/candidate-portal", candidatePortalRouter);
app.use("/api/ats/super-admin", superAdminRouter);

// Reconciliation — data anomaly detection for BGV, salary, lifecycle, provisioning
import { reconciliationRouter } from "./modules/ats/reconciliation.routes.js";
app.use("/api/ats/reconciliation", reconciliationRouter);

// ── AI Insights (Gemini-powered, role-aware, sanitized) ────────────────────
import { aiInsightsRouter } from "./modules/ai/ai-insights.routes.js";
app.use("/api/ai", aiInsightsRouter);

// ── Voice transcription (OpenAI Whisper fallback for Safari/iOS) ──────────
import { aiVoiceRouter } from "./modules/ai/ai-voice.routes.js";
app.use("/api/ai/voice", aiVoiceRouter);

// ── Business Intelligence — cross-DB ops pulse, attrition, revenue, quality ─
import { biRouter } from "./modules/business-intelligence/bi.routes.js";
app.use("/api/bi", biRouter);

// ── Operations live — live status, roster vs actual, attrition risk ───────────
import operationsLiveRouter from "./modules/operations/operations-live.routes.js";
app.use("/api/operations", operationsLiveRouter);

// ── Unified role-based drill-down dashboards (branch → process → team → analyst) ──
// Replaces the parallel quality/operations dashboard surfaces above with one scoped,
// name-resolved API per domain. See docs/superpowers/specs/2026-08-04-unified-quality-operations-dashboards-design.md
import qualityDashboardV2Router from "./modules/quality-dashboard/quality-dashboard-v2.routes.js";
import operationsDashboardV2Router from "./modules/operations/operations-dashboard-v2.routes.js";
app.use("/api/quality-dashboard-v2", qualityDashboardV2Router);
app.use("/api/operations-dashboard-v2", operationsDashboardV2Router);

import { policyEngineRouter } from "./modules/policy-engine/policy-engine.routes.js";
app.use("/api/policy-engine", policyEngineRouter);

app.use("/api/push", pushRouter);
app.use("/api/location", locationRouter);
app.use("/api/social-feed", socialFeedRouter);
app.use("/api/mcnmeet", mcnmeetRouter);

// social-feed and mcnmeet crons used to start HERE, at module scope, so they ran
// on any import of app.ts — including tests and scripts — in the API process
// only, registered in no worker registry and stoppable only by a deploy. mcnmeet
// mails meeting reminders every 5 minutes with an initial run 30s after boot,
// which is the same start-on-boot shape that turned esign-compliance into a
// 1,428-message storm; it is safe today only because MCNMEET_ENABLED defaults to
// false. Both are now registered in workers/all-workers.ts and started from
// server.ts behind the WORKERS_EXTERNAL guard like every other scheduler.

app.use(notFoundHandler);
app.use(errorHandler);
