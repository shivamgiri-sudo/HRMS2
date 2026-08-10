# HRMS2 Frontend Route → API → DB Connectivity Matrix
Date: 2026-06-24 | Source: App.tsx (447 lines) + backend/src/app.ts

Focus: missing APIs, wrong payloads, missing pageCodes, role mismatches.

---

## Connectivity Matrix

| Frontend Route | Component | pageCode | Primary Backend API | Route File | Service | DB Tables | Scope | Status | Issues | Fix Required |
|---|---|---|---|---|---|---|---|---|---|---|
| /auth, /login | AuthClean | — | POST /api/auth/login | auth.routes.ts | auth.service.ts | users | Public | OK | — | — |
| /two-factor | TwoFactor | — | POST /api/auth/2fa/verify | auth.routes.ts | twoFactor.service.ts | users | ProtectedRoute | OK | — | — |
| /reset-password | ResetPassword | — | POST /api/auth/password-reset | password-reset.routes.ts | — | users | Public | OK | — | — |
| /change-password | ChangePassword | — | PUT /api/auth/change-password | auth.routes.ts | auth.service.ts | users | ProtectedRoute | OK | — | — |
| /dashboard | Index | — | GET /api/dashboards/:code/summary | dashboard.routes.ts | dashboardScope.ts | dashboard_metric_catalog, work_item | ProtectedRoute | Partial | dashboard_metric_catalog table requires 290 migration; drilldown endpoint returns stub | Execute 290 migration; implement drilldowns |
| /employees | Employees | EMPLOYEE_MANAGEMENT | GET /api/employees | employee.routes.ts | employee.service.ts | employees | Gate | OK | — | Validate branch/process row-scope for non-admin roles |
| /employees/:id | NativeEmployeeStatCard | EMPLOYEE_MANAGEMENT | GET /api/employees/:id | employee.routes.ts | employee.service.ts | employees | Gate | OK | — | — |
| /employees/:id/360 | NativeEmployee360 | EMPLOYEE_MANAGEMENT | GET /api/employees/:id/360 | peopleos.routes.ts (employee360Router) | employee.service.ts | employees, attendance_log | Gate | OK | — | — |
| /profile | Profile | — | GET /api/employees/me (or /api/auth/me) | employee.secure.routes.ts | employee.service.ts | employees | ProtectedRoute | Partial | Route assumes /api/employees/me exists; verify endpoint path | Confirm /api/employees/me endpoint exists |
| /onboard | CandidateOnboardingPage | — | GET/POST /api/ats/onboarding/* | ats.onboarding.routes.ts | ats.onboarding.service.ts | ats_candidate, ats_onboarding_request | Public | Partial | Legacy flow; token validation path unclear | Confirm token-based access guard |
| /onboard-full | CandidateOnboardingV2 | — | GET/POST /api/ats/onboarding-full/* | onboarding-full.routes.ts | onboarding-full.service.ts | candidate_onboarding_profile, candidate_onboarding_bank_detail | Public (token) | Partial | Migration 289 adds new columns; if unexecuted, saves will fail silently | Execute migration 289 before enabling |
| /onboard-full-legacy | CandidateOnboardingFullPage | — | same as /onboard-full | onboarding-full.routes.ts | onboarding-full.service.ts | candidate_onboarding_profile | Public (token) | Partial | Legacy page mapped to same backend; step components (onboarding-full/) exist | Deprecate after V2 validated |
| /interview-registration | NativeATSCandidateRegistration | — | POST /api/ats/candidates/register-enhanced | registration.enhanced.routes.ts | ats.enhanced.service.ts | ats_candidate, ats_interview | Public | OK | — | — |
| /ats/dashboard | NativeATSDashboardReplica | ATS_DASHBOARD | GET /api/ats/stats | ats.routes.ts | ats.service.ts | ats_candidate | Gate | OK | — | — |
| /ats/registration-enhanced | NativeATSRegistrationEnhanced | — | POST /api/ats/candidates/register-enhanced | registration.enhanced.routes.ts | ats.enhanced.service.ts | ats_candidate | ProtectedRoute | OK | — | — |
| /ats/onboarding-bridge | NativeATSOnboardingBridge | ATS_ONBOARDING_BRIDGE | GET /api/ats/onboarding-requests | ats.onboarding.routes.ts | ats.onboarding.service.ts | ats_onboarding_request | Gate | Partial | Convert-to-employee path requires employee.service.ts create; end-to-end not confirmed | Test full conversion flow |
| /ats/waiting-queue | NativeATSWaitingQueue | ATS_WAITING_QUEUE | GET /api/ats/queue/* | queue.routes.ts | ats.queue.service.ts | ats_candidate | Gate | OK | — | — |
| /ats/candidate-master | NativeATSCandidateMaster | ATS_CANDIDATE_MASTER | GET /api/ats/candidates | ats.routes.ts | ats.service.ts | ats_candidate | Gate | OK | — | — |
| /ats/recruiter/my-candidates, /ats/recruiter/workspace | NativeATSRecruiterWorkspace | ATS_RECRUITER_QUEUE / ATS_RECRUITER_WORKSPACE | GET /api/ats/candidates?recruiter=me | ats.routes.ts | ats.service.ts | ats_candidate | Gate | Partial | Two pageCodes for same component; recruiter scoping by auth user not confirmed | Confirm recruiter_id filter in backend |
| /ats/bgv | NativeBGVVerificationCenter | ATS_BGV | GET/POST /api/ats/bgv/* | bgv-verification.routes.ts | bgv-verification.service.ts | bgv_verification_result | Gate | Partial | Real eKYC provider not wired; mock-digilocker routes active | Replace mock with real provider |
| /ats/bgv-enhanced | NativeBGVEnhanced | — (roles only: admin, hr) | GET/POST /api/ats/bgv/enhanced/* | bgv.enhanced.routes.ts | bgv.enhanced.service.ts | bgv_verification_result | roles gate | Partial | No pageCode gate — role-only; inconsistent with rest of ATS gating | Add pageCode ATS_BGV to gate |
| /ats/bgv-report | NativeBGVReport | ATS_BGV_REPORT | GET /api/ats/bgv/report/* | bgv.enhanced.routes.ts | bgv.enhanced.service.ts | bgv_verification_result | Gate | OK | — | — |
| /ats/payroll-hr, /ats/payroll-hr-validation | NativePayrollHRValidation | ATS_PAYROLL_HR | GET/POST /api/ats/payroll-hr/* | payroll-hr.routes.ts | payroll-hr.service.ts | ats_candidate | Gate + roles | Partial | Two routes share same component; salary data link to payroll_run not verified | Validate salary→payroll_run linkage |
| /ats/offer-approvals | NativeBranchHeadApproval | ATS_OFFER_APPROVALS | GET/PATCH /api/ats/branch-head-approval/* | branch-head-approval.routes.ts | branch-head-approval.service.ts | ats_candidate | Gate | OK | — | — |
| /ats/branch-head-approval | BranchHeadApproval | ATS_BRANCH_HEAD_APPROVAL | GET/PATCH /api/ats/branch-head-approval/* | branch-head-approval.routes.ts | branch-head-approval.service.ts | ats_candidate | Gate | Partial | Two separate components (NativeBranchHeadApproval + BranchHeadApproval) for similar purpose | Consolidate to one component |
| /ats/walkin-queue | NativeWalkinQueue | ATS_WALKIN_QUEUE | GET /api/ats/queue/walkin | queue.routes.ts | ats.queue.service.ts | ats_candidate | Gate | OK | — | — |
| /offer-letter | NativeOfferLetterGeneration | ATS_OFFER | POST /api/letters/generate | letters.routes.ts | lettersService | generated_letter, letter_template | Gate | Partial | No e-sign step in UI despite 292 migration adding esign table | Add esign step to offer letter flow |
| /letters | NativeLetters | LETTERS | GET /api/letters/employee/:id | letters.routes.ts | lettersService | generated_letter | Gate | OK | — | — |
| /payroll | Payroll | PAYROLL | GET /api/payroll/* | payroll.routes.ts | payrollRouter | payroll_run, payroll_line | Gate | Partial | TDS and LWP blocked until statutory_config seeded | Seed statutory_config before production payroll |
| /payroll/readiness | NativePayrollReadiness | PAYROLL | GET /api/payroll/readiness/* | peopleos.routes.ts (payrollReadinessRouter) | peopleos.service.ts | payroll_readiness_snapshot | Gate | Partial | No month-end lock/approval step | Implement lock step |
| /payroll/payslips | NativePayslipCenter | PAYROLL_PAYSLIPS | GET /api/payroll/payslips/* | payroll-extended.routes.ts | payrollExtendedRouter | payroll_slip | Gate | OK | — | — |
| /payroll/tax-declaration | NativeTaxDeclaration | TAX_DECLARATION | GET/POST /api/payroll/tax-declaration/* | payroll.routes.ts | payrollRouter | tax_declaration | Gate | Partial | Effective-dated slab config required; blocked per charter | Ensure statutory_config has slab rows |
| /payroll/full-final | NativeFullFinal | FULL_FINAL | GET/POST /api/exit/ff/* | exit.routes.ts | ffService | ff_settlement, exit_request | Gate | OK | ff_provisional guard active | — |
| /payroll/statutory-config | NativeStatutoryConfig | STATUTORY_CONFIG | GET/PUT /api/payroll/statutory-config/* | payroll-statutory-config.compat.routes.ts | — | statutory_config | Gate | Partial | Compat router exists; full config management UI and seeding not confirmed | Seed initial statutory_config rows |
| /payroll/masters | NativePayrollMasters | PAYROLL_MASTERS | GET /api/payroll-masters/* | payrollMasters.routes.ts | payrollMastersRouter | salary_component_master | Gate | OK | — | — |
| /payroll/salary-packages | NativeSalaryPackages | SALARY_PACKAGES | GET /api/payroll/salary-packages | payroll-more.routes.ts | payrollMoreRouter | salary_grade, salary_package | Gate | OK | — | — |
| /payroll/incentives | NativeIncentives | PAYROLL_INCENTIVES | GET/POST /api/incentives/* | incentives.routes.ts | incentives.service.ts | incentive_upload_batch, incentive_approval_step | Gate | OK | Confirm 291 migration applied | — |
| /payroll/overtime | PayrollOvertimeManagement | — (roles: admin, wfm) | GET/POST /api/payroll/overtime | payroll.routes.ts | payrollRouter | payroll_overtime | roles only | Partial | No pageCode gate; role-only gating inconsistent | Add pageCode gate |
| /attendance | Attendance | — | GET /api/wfm/attendance/* | attendance-daily-scoped.routes.ts | attendanceDailyScopedRouter | attendance_log | ProtectedRoute | OK | — | — |
| /attendance-regularization | AttendanceRegularization | ATTENDANCE_REGULARIZATION | POST /api/wfm/regularization | wfm.regularization.secure.routes.ts | wfmRegularizationSecureRouter | attendance_regularization | Gate | OK | — | — |
| /wfm/roster | NativeWFMRoster | WFM_ROSTER | GET/POST /api/wfm/roster/* | roster.routes.ts, rosterActualSecureRouter | rosterGovRouter | roster_slot, roster_actual | Gate | OK | — | — |
| /wfm/auto-roster | NativeWFMAutoRoster | WFM_AUTO_ROSTER | GET/POST /api/wfm/auto-roster/* | auto-roster-synced.routes.ts | autoRosterSyncedRouter | roster_slot | Gate | OK | — | — |
| /wfm/live-tracker, /wfm/adherence-command-center, /wfm/agent-attendance-view | NativeBiometricCommandCenter | WFM_LIVE_TRACKER | GET /api/wfm/biometric-summary/* | biometric-summary.routes.ts | biometricSummaryRouter | biometric_punch | Gate | Partial | Three routes share one component; COSEC real-time push not confirmed | Confirm biometric push endpoint |
| /wfm/cosec-monitoring | NativeCosecSyncMonitoring | WFM_LIVE_TRACKER | GET /api/integrations/cosec/* | cosec-sync.routes.ts | cosecSyncRouter | cosec_sync_log | Gate | Partial | External COSEC connection status not verified | Confirm COSEC API credentials and test sync |
| /wfm/attendance-exceptions | NativeAttendanceExceptionEngine | WFM_LIVE_TRACKER | GET /api/attendance/exception-engine/* | peopleos.routes.ts (attendanceExceptionRouter) | peopleos.service.ts | attendance_exception | Gate | OK | — | — |
| /rta-board | NativeRTABoard | RTA_BOARD | GET /api/rta/* | rta.routes.ts | rtaRouter | rta_board | Gate | OK | — | — |
| /quality/dashboard | NativeQualityDashboard | QUALITY_DASHBOARD | GET /api/quality-dashboard/* | quality-dashboard.routes.ts | qualityDashboardRouter | quality_audit_log | Gate | Partial | Call Master data feed not confirmed active | Confirm quality data source |
| /operations/dashboard | NativeOperationsDashboard | OPERATIONS_DASHBOARD | No confirmed /api/operations-dashboard route in app.ts | — | — | operations_kpi | Gate | Broken | No matching backend route found in app.ts for this pageCode's data | Create /api/operations-dashboard route or map to existing API |
| /agent-performance | NativeAgentPerformanceDashboard | — (no pageCode) | GET /api/performance-dashboard/* | performance-dashboard.routes.ts | performanceDashboardRouter | kpi_score | ProtectedRoute only | Partial | No pageCode gate — any authenticated user can access | Add pageCode AGENT_PERFORMANCE to gate |
| /management/dashboard | NativeManagementDashboard | MANAGEMENT_DASHBOARD | GET /api/management/* | management.routes.ts | managementRouter | management_dashboard_snapshot | Gate | OK | — | — |
| /management/ceo-command-center | Navigate → /dashboard | — | — | — | — | — | — | Broken | CEO command center redirects to generic dashboard — no CEO-specific data | Restore NativeCEOCommandCenter at /management/ceo-command-center |
| /lms/my-learning | NativeLMSMyLearning | LMS_MY_LEARNING | GET /api/lms/learner/me | lms.routes.ts | lmsRouter | lms_learner_mapping, lms_progress_sync | Gate | Partial | LMS API base URL not confirmed; response may be stale sync data | Confirm LMS API and test sync |
| /lms/admin | LMSIntegrationAdmin | LMS_ADMIN | GET /api/lms/admin/* | lms.routes.ts | lmsRouter | lms_learner_mapping | Gate | Partial | Same concern as above | — |
| /lms/integration | NativeLMSIntegration | LMS_INTEGRATION | GET /api/lms/integration/* | lms.routes.ts | lmsRouter | lms_sync_log | Gate | OK | — | — |
| /exit-management | NativeExitManagement | EXIT_COMMAND_CENTER | GET /api/exit/* | exit.routes.ts | exitController | exit_request | Gate | OK | — | — |
| /exit/command-center | NativeExitCommandCenter | EXIT_COMMAND_CENTER | GET /api/exit/command-center | exit.routes.ts | getExitCommandCenter() | exit_request, exit_clearance_task | Gate | OK | — | — |
| /compliance/dpdp | NativeDPDPCompliance | DPDP_COMPLIANCE | GET/POST /api/privacy/consent/* | privacy.routes.ts | privacyService | dpdp_consent | Gate | Partial | Candidate consent at onboarding requires unauthenticated POST; route requires requireAuth | Allow token-based consent recording |
| /compliance/statutory, /compliance/labour | NativeStatutoryCompliance, NativeLabourCompliance | STATUTORY_COMPLIANCE / LABOUR_COMPLIANCE | GET /api/compliance/* | compliance.routes.ts | complianceRouter | compliance_filing_log | Gate | OK | — | — |
| /work-inbox | NativeWorkInbox | WORK_INBOX | GET /api/work-inbox/* | work-inbox.routes.ts | work-inbox.service.ts | work_item | Gate | OK | Confirm work_item migration applied | — |
| /governance/tat (no frontend route) | — | — | GET /api/governance/tat/* | tat.routes.ts | (inline) | tat_matrix_master, task_tat_instance | — | Partial | Backend fully built; no frontend page in App.tsx | Add TAT dashboard page to App.tsx |
| /audit-log (not in App.tsx) | NativeAuditLog.tsx exists in /src/pages/ | — | GET /api/audit/* | audit.log.routes.ts | auditLogRouter | audit_log | NOT ROUTED | Broken | NativeAuditLog.tsx exists but is NEVER imported or routed in App.tsx | Add /audit-log route with SUPER_ADMIN gate |
| /integration-hub | NativeIntegrationHub | INTEGRATION_HUB | GET /api/integration-hub/* | integration.routes.ts | integrationRouter | integration_connector | Gate | OK | — | — |
| /settings/access-control | UnifiedAccessControl | ACCESS_CONTROL | GET/POST /api/access/* | access.routes.ts | accessRouter | user_page_access | Gate | OK | — | — |
| /super-admin/page-access | SuperAdminAccessControl | — (roles: admin) | GET/POST /api/access/* | access.routes.ts | accessRouter | user_page_access | roles only | Partial | No pageCode — role-only gating; should require SUPER_ADMIN pageCode | Add pageCode gate |
| /super-admin/dashboard | SuperAdminDashboardV2 | — (roles: admin) | GET /api/employees/stats + /api/audit/* | employee.routes.ts | employeeRouter | employees | roles only | OK | — | — |
| /portal/login | PortalLogin | — | POST /api/portal/auth/login | portal.routes.ts (clientRouter) | portalRouter | client_portal_user | Public | OK | — | — |
| /portal | PortalOverview | — | GET /api/portal/overview | portal.routes.ts | portalRouter | client_portal_data | PortalRoute | OK | — | — |
| /portal/processes/:id | PortalProcessDashboard | — | GET /api/portal/processes/:id | portal.routes.ts | portalRouter | client_portal_data | PortalRoute | OK | — | Confirm no PII/payroll data leaks into portal response |
| /expenses | MyExpenses | — | GET /api/expenses/my | expense.routes.ts | expenseRouter | expense_claim | ProtectedRoute | OK | — | — |
| /expenses/approvals | ExpenseApprovals | — | GET /api/expenses/approvals | expense.routes.ts | expenseRouter | expense_claim | ProtectedRoute | OK | — | — |
| /expenses/finance | FinanceQueue | — | GET /api/expenses/finance-queue | expense.routes.ts | expenseRouter | expense_claim | ProtectedRoute | OK | — | — |
| /org-masters | NativeOrgMasters | ORG_MASTERS | GET /api/org/* | org.routes.ts | orgRouter | org_master | Gate | OK | — | — |
| /workflow-admin | NativeWorkflowAdmin | WORKFLOW_ADMIN | GET /api/workflow/* | workflow.routes.ts | workflowRouter | workflow_definition | Gate | OK | — | — |
| /kpi-config | NativeKPIConfiguration | KPI_CONFIG | GET/POST /api/kpi/* | kpi.routes.ts | kpiRouter | kpi_metric | Gate | OK | — | — |
| /my-kpi | MyKpiDashboard | MY_KPI | GET /api/kpi/my-scores | kpi.routes.ts | kpiRouter | kpi_score | Gate | OK | — | — |
| /reports/enterprise | NativeEnterpriseReports | ADVANCED_REPORTS | GET /api/reports/enterprise/* | peopleos.routes.ts (enterpriseReportsRouter) | reportingRouter | employees, attendance_log | Gate + rate-limit | OK | — | — |
| /advanced-reports | NativeAdvancedReports | ADVANCED_REPORTS | GET /api/reports/* | reporting.routes.ts | reportingRouter | employees | Gate + rate-limit | OK | — | — |
| /provisioning/* | NativeITProvisioningTracker | PROVISIONING_IT / PROVISIONING_ADMIN | GET /api/it-provisioning/* | it-provisioning.routes.ts | itProvisioningRouter | it_provisioning_item | Gate + roles | Partial | Backend does not scope by provisioning type; one route serves all variants | Scope backend by type param |
| /notification-preferences | NotificationPreferences | — | GET /api/communication/preferences | communication.routes.ts | communicationRouter | notification_preference | ProtectedRoute | OK | — | — |
| /notifications | Notifications | — | GET /api/communication/notifications | communication.routes.ts | communicationRouter | notification_log | ProtectedRoute | Partial | No unread count API; no real-time push | Add unread count endpoint |
| /security-center | NativeSecurityCenter | — (roles: admin, ceo, hr) | GET /api/security-center/* | security-center.routes.ts | securityCenterRouter | security_audit_log | roles only | Partial | No pageCode gate | Add pageCode gate |
| /candidate-portal/login | CandidatePortalLogin | — | POST /api/ats/candidate-portal/login | candidate-portal.routes.ts | candidatePortalService | ats_candidate | Public | OK | — | — |
| /candidate-portal/dashboard | CandidatePortalDashboard | — | GET /api/ats/candidate-portal/status | candidate-portal.routes.ts | candidatePortalService | ats_candidate | token-based | OK | — | — |

---

## Critical Issues Summary

| # | Issue | Route(s) | Impact | Fix |
|---|---|---|---|---|
| 1 | NativeAuditLog.tsx exists but is NEVER routed in App.tsx | /audit-log (missing) | Audit trail inaccessible to admin | Add route with admin Gate |
| 2 | /operations/dashboard — no backend route found in app.ts | /operations/dashboard | NativeOperationsDashboard renders with no data | Create /api/operations-dashboard or map to existing endpoint |
| 3 | /management/ceo-command-center is Navigate redirect to /dashboard | /management/ceo-command-center | CEO has no dedicated command center | Restore NativeCEOCommandCenter route |
| 4 | DPDP consent POST /api/privacy/consent requires requireAuth | /compliance/dpdp (onboarding consent) | Candidates cannot record consent during token-based onboarding | Allow token-based or unauthenticated consent path |
| 5 | Mock DigiLocker active at /api/mock-digilocker | /ats/bgv, /ats/bgv-enhanced | BGV returns fake data in production path | Gate mock behind NODE_ENV != production |
| 6 | /ats/bgv-enhanced and /agent-performance lack pageCode gates | both routes | Any authenticated user bypasses access control | Add pageCode gates |
| 7 | Onboarding V2 depends on migration 289 which may be unexecuted | /onboard-full | Save operations silently fail on missing columns | Execute migration 289 |
| 8 | Work inbox, TAT, and dashboard_metric_catalog tables require recent migrations (290–295) | /work-inbox, /dashboard | Features appear to work but DB write/read fails | Verify and execute migrations 290–295 |
