# HRMS2 Frontend → Backend → DB Connectivity Matrix

Generated: 2026-06-25 | Source: App.tsx, backend/src/app.ts, src/lib/hrmsApi.ts

API base: `VITE_HRMS_API_URL` (default `http://localhost:5055`). JWT stored as `hrms_access_token`.

---

## Connectivity Matrix

| Frontend Route | Component | pageCode | Roles | Primary API | Backend Mount | Route Handler File | DB Tables | Status | Issues |
|---|---|---|---|---|---|---|---|---|---|
| `/auth`, `/login` | Auth (AuthClean) | — | public | `POST /api/auth/login` | `/api/auth` | auth.routes.ts | employees, sessions | OK | — |
| `/reset-password` | ResetPassword | — | public | `POST /api/auth/password-reset/request` | `/api/auth` | password-reset.routes.ts | password_resets | OK | — |
| `/change-password` | ChangePassword | — | authenticated | `POST /api/auth/change-password` | `/api/auth` | auth.routes.ts | employees | OK | — |
| `/two-factor` | TwoFactor | — | authenticated | `POST /api/auth/2fa/verify` | `/api/auth` | auth.routes.ts | org_settings | OK | — |
| `/dashboard` | Index | — | authenticated | `GET /api/dashboards/*` | `/api/dashboards` | dashboard.routes.ts | employees, attendance | OK | — |
| `/employees` | Employees | EMPLOYEE_MANAGEMENT | any | `GET /api/employees` | `/api/employees` | employee.routes.ts | employees | OK | — |
| `/employees/:id` | NativeEmployeeStatCard | EMPLOYEE_MANAGEMENT | any | `GET /api/employees/:id` | `/api/employees` | employee.routes.ts | employees, documents | OK | — |
| `/employees/:id/360` | NativeEmployee360 | EMPLOYEE_MANAGEMENT | any | `GET /api/employees/:id/360` | `/api/employees` | peopleos.routes.ts (employee360Router) | employees, kpi | OK | — |
| `/onboarding` | Onboarding | ATS_ONBOARDING_BRIDGE | any | `GET /api/ats/onboarding-bridge` | `/api/ats` | ats.routes.ts | candidates, onboarding_requests | OK | — |
| `/leaves` | Leaves | — | authenticated | `GET /api/leave` | `/api/leave` | leave.routes.ts | leave_requests, leave_balances | WARN | Missing pageCode gate |
| `/assets` | Assets | — | authenticated | `GET /api/assets-mgmt` | `/api/assets-mgmt` | assets.routes.ts | asset_assignments | WARN | Missing pageCode gate |
| `/payroll` | Payroll | PAYROLL | any | `GET /api/payroll` | `/api/payroll` | payroll.routes.ts | payroll_runs, payroll_lines | OK | — |
| `/reports` | Reports | — | authenticated | `GET /api/reports` | `/api/reports` | reporting.routes.ts | multiple | WARN | Missing pageCode gate |
| `/settings` | Settings | — | authenticated | `GET /api/org/settings` | `/api/org/settings` | org_settings.routes.ts | org_settings | WARN | Missing pageCode gate |
| `/profile` | Profile | — | authenticated | `GET /api/employees/me` | `/api/employees` | employee.routes.ts | employees | WARN | Missing pageCode gate |
| `/attendance` | Attendance | — | authenticated | `GET /api/wfm/attendance` | `/api/wfm/attendance` | attendance-daily-scoped.routes.ts | attendance_daily | WARN | Missing pageCode gate |
| `/attendance-regularization` | AttendanceRegularization | ATTENDANCE_REGULARIZATION | any | `POST /api/wfm/regularization` | `/api/wfm` | wfm.regularization.secure.routes.ts | attendance_regularization | OK | — |
| `/bulk-upload` | BulkUploadHub | EMPLOYEE_MANAGEMENT | any | `POST /api/bulk-upload` | `/api/bulk-upload` | bulk-upload.routes.ts | employees | OK | — |
| `/departments` | Departments | ORG_MASTERS | any | `GET /api/org` | `/api/org` | org.routes.ts | departments | OK | — |
| `/calendar` | CompanyCalendar | — | authenticated | `GET /api/org/events` | `/api/org/events` | events.routes.ts | org_events | WARN | Missing pageCode gate |
| `/ats/dashboard` | NativeATSDashboardReplica | ATS_DASHBOARD | any | `GET /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/ats/registration-enhanced` | NativeATSRegistrationEnhanced | — | authenticated | `POST /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | WARN | Missing pageCode gate |
| `/ats/candidate-registration` | NativeATSCandidateRegistration | — | authenticated | `POST /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | WARN | Missing pageCode gate |
| `/interview-registration` | NativeATSCandidateRegistration | — | public | `POST /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | Public form, no auth needed |
| `/ats/recruiter/my-candidates` | NativeATSRecruiterWorkspace | ATS_RECRUITER_QUEUE | any | `GET /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/ats/recruiter/workspace` | NativeATSRecruiterWorkspace | ATS_RECRUITER_WORKSPACE | any | `GET /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | Duplicate component for two pageCodes |
| `/ats/waiting-queue` | NativeATSWaitingQueue | ATS_WAITING_QUEUE | any | `GET /api/ats/queue` | `/api/ats/queue` | queue.routes.ts | candidates | OK | — |
| `/ats/candidate-master` | NativeATSCandidateMaster | ATS_CANDIDATE_MASTER | any | `GET /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/ats/onboarding-bridge` | NativeATSOnboardingBridge | ATS_ONBOARDING_BRIDGE | any | `GET /api/ats/onboarding-bridge` | `/api/ats` | ats.routes.ts | onboarding_requests | OK | — |
| `/ats/onboarding-requests` | NativeHROnboardingRequests | ATS_ONBOARDING_BRIDGE | any | `GET /api/ats/onboarding-bridge` | `/api/ats` | ats.routes.ts | onboarding_requests | OK | — |
| `/ats/offer-approvals` | NativeBranchHeadApproval | ATS_OFFER_APPROVALS | any | `GET /api/ats/offer-letters` | `/api/ats` | ats.routes.ts | offer_letters | OK | — |
| `/ats/payroll-hr`, `/ats/payroll-hr-validation` | NativePayrollHRValidation | ATS_PAYROLL_HR | hr/payroll_hr | `GET /api/ats/payroll-hr` | `/api/ats` | ats.routes.ts | candidates | OK | Duplicate routes for same component |
| `/ats/bgv` | NativeBGVVerificationCenter | ATS_BGV | any | `GET /api/ats/bgv` | `/api/ats` | ats.routes.ts | bgv_checks | OK | — |
| `/ats/bgv-enhanced` | NativeBGVEnhanced | — | admin/hr | `GET /api/ats/bgv` | `/api/ats` | ats.routes.ts | bgv_checks | WARN | Missing pageCode gate |
| `/ats/bgv-report` | NativeBGVReport | ATS_BGV_REPORT | any | `GET /api/ats/bgv` | `/api/ats` | ats.routes.ts | bgv_checks | OK | — |
| `/ats/walkin-queue` | NativeWalkinQueue | ATS_WALKIN_QUEUE | any | `GET /api/ats/walkin-queue` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/ats/command-center` | NativeATSFullParityCommandCenter | ATS_DASHBOARD | any | `GET /api/ats-full-parity/*` | `/api/ats-full-parity` | atsFullParity.routes.ts | candidates | OK | — |
| `/ats/command-centre` | ATSCommandCentre | — | admin/manager/hr | `GET /api/ats/*` | `/api/ats` | ats.routes.ts | candidates | WARN | Duplicate of /ats/command-center; missing pageCode |
| `/ats/extensions` | NativeATSExtensions | ATS_EXTENSIONS | any | `GET /api/ats-ext` | `/api/ats-ext` | ats-ext.routes.ts | ats_extensions | OK | — |
| `/ats/form-config` | NativeATSFormConfig | — | admin/hr | `GET /api/ats/form-config` | `/api/ats` | ats-form-config.routes.ts | ats_form_config | WARN | Missing pageCode gate |
| `/ats/sourcing-analysis` | NativeATSSourcingAnalysis | ATS_DASHBOARD | any | `GET /api/ats/sourcing` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/ats/recruiter-portal` | NativeRecruiterPortal | ATS_RECRUITER_PORTAL | any | `GET /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/onboard` | CandidateOnboardingPage | — | public | `POST /api/ats/candidates` | `/api/ats` | ats.routes.ts | candidates | OK | — |
| `/onboard-full` | CandidateOnboardingV2 | — | public | `POST /api/ats/onboarding-full` | `/api/ats` | onboarding-full.routes.ts | candidates, onboarding_full | OK | — |
| `/candidate-portal/login` | CandidatePortalLogin | — | public | `POST /api/auth/candidate-login` | `/api/auth` | auth.routes.ts | candidates | WARN | Separate candidate auth unclear |
| `/candidate-portal/dashboard` | CandidatePortalDashboard | — | public | `GET /api/ats/candidate-portal` | `/api/ats` | ats.routes.ts | candidates | WARN | No dedicated /api/candidate-portal mount |
| `/provisioning/wfm-alignment` | NativeITProvisioningTracker | PROVISIONING_WFM_ALIGNMENT | wfm/admin | `GET /api/it-provisioning` | `/api/it-provisioning`, `/api/onboarding-provisioning` | it-provisioning.routes.ts | it_provisioning | OK | — |
| `/provisioning/it` | NativeITProvisioningTracker | PROVISIONING_IT | it/admin | `GET /api/it-provisioning` | `/api/it-provisioning` | it-provisioning.routes.ts | it_provisioning | OK | — |
| `/lms/my-learning` | NativeLMSMyLearning | LMS_MY_LEARNING | any | `GET /api/lms/my-learning` | `/api/lms` | lms.routes.ts | lms_learner_sync | OK | — |
| `/lms/coordinator` | NativeLMSCoordinator | LMS_COORDINATOR | any | `GET /api/lms/coordinator` | `/api/lms` | lms.routes.ts | lms_batch_sync | OK | — |
| `/lms/admin` | LMSIntegrationAdmin | LMS_ADMIN | any | `GET /api/lms/admin` | `/api/lms` | lms.routes.ts | lms_sync_log | OK | — |
| `/lms/integration` | NativeLMSIntegration | LMS_INTEGRATION | any | `GET /api/lms` | `/api/lms` | lms.routes.ts | lms_learner_sync | OK | — |
| `/wfm/roster` | NativeWFMRoster | WFM_ROSTER | any | `GET /api/wfm/roster` | `/api/wfm/roster` | roster.routes.ts | roster_shifts | OK | — |
| `/wfm/live-tracker` | NativeBiometricCommandCenter | WFM_LIVE_TRACKER | any | `GET /api/wfm/biometric-summary` | `/api/wfm/biometric-summary` | biometric-summary.routes.ts | biometric_punches | OK | — |
| `/wfm/attendance-exceptions` | NativeAttendanceExceptionEngine | WFM_LIVE_TRACKER | any | `GET /api/attendance/exception-engine` | `/api/attendance/exception-engine` | peopleos.routes.ts | attendance_exceptions | OK | — |
| `/wfm/cosec-monitoring` | NativeCosecSyncMonitoring | WFM_LIVE_TRACKER | any | `GET /api/integrations/cosec` | `/api/integrations/cosec` | peopleos.routes.ts | cosec_sync_log | OK | — |
| `/wfm/extensions` | NativeWFMExtensions | WFM_EXTENSIONS | any | `GET /api/wfm-ext` | `/api/wfm-ext` | wfm-ext.routes.ts | wfm_extensions | OK | — |
| `/wfm/auto-roster` | NativeWFMAutoRoster | WFM_AUTO_ROSTER | any | `GET /api/wfm/auto-roster` | `/api/wfm/auto-roster` | auto-roster-synced.routes.ts | roster_shifts | OK | — |
| `/workforce-planning` | NativeWorkforcePlanning | WFM_AUTO_ROSTER | any | `GET /api/workforce-planning` | `/api/workforce-planning` | peopleos.routes.ts | workforce_mandate | OK | — |
| `/rta-board` | NativeRTABoard | RTA_BOARD | any | `GET /api/rta` | `/api/rta` | rta.routes.ts | rta_data | OK | — |
| `/quality/dashboard` | NativeQualityDashboard | QUALITY_DASHBOARD | any | `GET /api/quality-dashboard` | `/api/quality-dashboard` | quality-dashboard.routes.ts | quality_scores | OK | — |
| `/agent-performance` | NativeAgentPerformanceDashboard | — | authenticated | `GET /api/performance-dashboard` | `/api/performance-dashboard` | performance-dashboard.routes.ts | kpi_scores | WARN | Missing pageCode gate |
| `/operations/dashboard` | NativeOperationsDashboard | OPERATIONS_DASHBOARD | any | `GET /api/apr` | `/api/apr` | apr.routes.ts | operations_kpi | OK | — |
| `/performance/command-center` | UnifiedPerformanceCommandCenter | WORKFORCE_COMMAND_CENTER | any | `GET /api/performance-dashboard` | `/api/performance-dashboard` | performance-dashboard.routes.ts | kpi_scores | OK | — |
| `/performance-feedback/my-reports` | NativePerformanceFeedbackMyReports | — | authenticated | `GET /api/performance-feedback` | `/api/performance-feedback` | performance-feedback.routes.ts | performance_feedback | WARN | Missing pageCode gate |
| `/performance-feedback/assignments` | NativePerformanceFeedbackAssignments | — | authenticated | `GET /api/performance-feedback/assignments` | `/api/performance-feedback` | performance-feedback.routes.ts | performance_feedback | WARN | Missing pageCode gate |
| `/engagement` | NativeEngagement | — | authenticated | `GET /api/engagement` | `/api/engagement` | engagement.routes.ts | engagement_events | WARN | Missing pageCode gate |
| `/engagement/badges` | NativeBadges | — | authenticated | `GET /api/engagement/badges` | `/api/engagement` | engagement.routes.ts | badges | WARN | Missing pageCode gate |
| `/engagement/kudos` | NativeKudos | — | authenticated | `GET /api/engagement/kudos` | `/api/engagement` | engagement.routes.ts | kudos | WARN | Missing pageCode gate |
| `/engagement/surveys` | NativeSurveys | — | authenticated | `GET /api/engagement/surveys` | `/api/engagement` | engagement.routes.ts | surveys | WARN | Missing pageCode gate |
| `/engagement/leaderboard` | NativeLeaderboard | — | authenticated | `GET /api/engagement/leaderboard` | `/api/engagement` | engagement.routes.ts | gamification | WARN | Missing pageCode gate |
| `/people-experience/command-center` | NativePeopleExperienceCommandCenter | — | roles-listed | `GET /api/people-experience` | `/api/people-experience` | people-experience.routes.ts | engagement_events | WARN | Missing pageCode gate; roles in prop not Gate |
| `/settings/access-control` | UnifiedAccessControl | ACCESS_CONTROL | any | `GET /api/access` | `/api/access` | access.routes.ts | role_assignments | OK | — |
| `/security-center` | NativeSecurityCenter | — | admin/ceo/hr | `GET /api/security-center` | `/api/security-center` | security-center.routes.ts | audit_logs | WARN | Missing pageCode gate |
| `/super-admin/module-access` | SuperAdminModuleAccess | — | admin | `GET /api/access` | `/api/access` | access.routes.ts | role_assignments | WARN | Missing pageCode gate |
| `/super-admin/dashboard` | SuperAdminDashboardV2 | — | admin | `GET /api/management` | `/api/management` | management.routes.ts | employees | WARN | Missing pageCode gate |
| `/super-admin/page-access` | SuperAdminAccessControl | — | admin | `GET /api/access` | `/api/access` | access.routes.ts | page_access | WARN | Missing pageCode gate |
| `/management/dashboard` | NativeManagementDashboard | MANAGEMENT_DASHBOARD | any | `GET /api/management` | `/api/management` | management.routes.ts | employees | OK | — |
| `/ceo/dashboard` | CeoDashboard | CEO_DASHBOARD | any | `GET /api/management/command-center` | `/api/management` | peopleos.routes.ts | multiple | OK | — |
| `/payroll/payslips` | NativePayslipCenter | PAYROLL_PAYSLIPS | any | `GET /api/payroll/payslips` | `/api/payroll` | payroll.routes.ts | payroll_lines | OK | — |
| `/payroll/readiness` | NativePayrollReadiness | PAYROLL | any | `GET /api/payroll/readiness` | `/api/payroll/readiness` | peopleos.routes.ts | payroll_runs | OK | — |
| `/payroll/tax-declaration` | NativeTaxDeclaration | TAX_DECLARATION | any | `GET /api/payroll/tax-declarations` | `/api/payroll` | payroll-extended.routes.ts | tax_declarations | OK | — |
| `/payroll/full-final` | NativeFullFinal | FULL_FINAL | any | `GET /api/exit/ff` | `/api/exit` | exit.routes.ts | exit_requests | OK | — |
| `/payroll/statutory-config` | NativeStatutoryConfig | STATUTORY_CONFIG | any | `GET /api/payroll/statutory-config` | `/api/payroll` | payroll-statutory-config.compat.routes.ts | statutory_config | OK | — |
| `/payroll/masters` | NativePayrollMasters | PAYROLL_MASTERS | any | `GET /api/payroll-masters` | `/api/payroll-masters` | payrollMasters.routes.ts | payroll_components | OK | — |
| `/payroll/salary-packages` | NativeSalaryPackages | SALARY_PACKAGES | any | `GET /api/payroll/salary-packages` | `/api/payroll` | payroll.routes.ts | salary_packages | OK | — |
| `/payroll/incentives` | NativeIncentives | PAYROLL_INCENTIVES | any | `GET /api/incentives` | `/api/incentives` | incentives.routes.ts | incentives | OK | — |
| `/payroll/overtime` | PayrollOvertimeManagement | — | admin/wfm | `PATCH /api/payroll/lines/:id/overtime` | `/api/payroll` | payroll.routes.ts | payroll_lines | WARN | Missing pageCode gate |
| `/compliance/statutory` | NativeStatutoryCompliance | STATUTORY_COMPLIANCE | any | `GET /api/compliance/statutory` | `/api/compliance` | compliance.routes.ts | statutory_config | OK | — |
| `/compliance/labour` | NativeLabourCompliance | LABOUR_COMPLIANCE | any | `GET /api/compliance/labour` | `/api/compliance` | compliance.routes.ts | labour_compliance | OK | — |
| `/compliance/dpdp` | NativeDPDPCompliance | DPDP_COMPLIANCE | any | `GET /api/privacy/dpdp` | `/api/privacy` | privacy.routes.ts | dpdp_consents | OK | — |
| `/privacy/dpdp-withdrawal` | NativeDPDPWithdrawal | DPDP_WITHDRAWAL | any | `POST /api/privacy/dpdp/withdraw` | `/api/privacy` | dpdp-withdrawal.routes.ts | dpdp_withdrawal | OK | — |
| `/compliance/dpdp-withdrawal-admin` | NativeDPDPWithdrawalAdmin | DPDP_WITHDRAWAL_ADMIN | any | `GET /api/privacy/dpdp/withdrawals` | `/api/privacy` | dpdp-withdrawal.routes.ts | dpdp_withdrawal | OK | — |
| `/integration-hub` | NativeIntegrationHub | INTEGRATION_HUB | any | `GET /api/integration-hub` | `/api/integration-hub` | integration.routes.ts | integration_logs | OK | — |
| `/exit-management` | NativeExitManagement | EXIT_COMMAND_CENTER | any | `GET /api/exit` | `/api/exit` | exit.routes.ts | exit_requests | OK | — |
| `/exit/command-center` | NativeExitCommandCenter | EXIT_COMMAND_CENTER | any | `GET /api/exit` | `/api/exit` | exit.routes.ts | exit_requests | OK | Duplicate routes for same pageCode |
| `/kpi-config` | NativeKPIConfiguration | KPI_CONFIG | any | `GET /api/kpi` | `/api/kpi` | kpi.routes.ts | kpi_definitions | OK | — |
| `/operations-kpi` | NativeOperationsKPI | OPERATIONS_KPI | any | `GET /api/kpi/process-role` | `/api/kpi/process-role` | kpi.process-role.routes.ts | kpi_scores | OK | — |
| `/kpi-master` | KpiMasterConfig | KPI_MASTER | any | `GET /api/kpi-master` | `/api/kpi-master` | kpi-master.routes.ts | kpi_master | OK | — |
| `/my-kpi` | MyKpiDashboard | MY_KPI | any | `GET /api/kpi` | `/api/kpi` | kpi.routes.ts | kpi_scores | OK | — |
| `/client-master` | EnhancedClientMaster | CLIENT_MASTER | any | `GET /api/clients` | `/api` (clientRouter) | client.routes.ts | clients | WARN | clientRouter mounted at `/api` not `/api/clients`; legacy double-data alias active |
| `/portal/login` | PortalLogin | — | public | `POST /api/portal/login` | `/api/portal` | portal.routes.ts | portal_users | OK | — |
| `/portal` | PortalOverview | — | portal-auth | `GET /api/portal` | `/api/portal` | portal.routes.ts | portal_users | OK | — |
| `/portal/processes/:id` | PortalProcessDashboard | — | portal-auth | `GET /api/portal/processes/:id` | `/api/portal` | portal.routes.ts | process_masters | OK | — |
| `/portal-data-manager` | NativePortalDataManager | PORTAL_DATA_MANAGER | any | `GET /api/portal` | `/api/portal` | portal.routes.ts | portal_users | OK | — |
| `/org-masters` | NativeOrgMasters | ORG_MASTERS | any | `GET /api/org` | `/api/org` | org.routes.ts | branches, designations | OK | — |
| `/org-masters/locations-policies` | NativeLocationPolicyMasters | ORG_MASTERS | any | `GET /api/org` | `/api/org` | org.routes.ts | locations | OK | — |
| `/workflow-admin` | NativeWorkflowAdmin | WORKFLOW_ADMIN | any | `GET /api/workflow` | `/api/workflow` | workflow.routes.ts | workflow_definitions | OK | — |
| `/work-inbox` | NativeWorkInbox | WORK_INBOX | any | `GET /api/work-inbox` | `/api/work-inbox` | work-inbox.routes.ts | workflow_tasks | OK | — |
| `/offer-letter` | NativeOfferLetterGeneration | ATS_OFFER | any | `GET /api/letters/offer` | `/api/letters` | letters.routes.ts | offer_letters | OK | — |
| `/letters` | NativeLetters | LETTERS | any | `GET /api/letters` | `/api/letters` | letters.routes.ts | letters | OK | — |
| `/letters/appointment-esign` | NativePlaceholderPage | APPOINTMENT_ESIGN | any | `GET /api/letters/appointment-esign` | `/api/letters` | appointment-esign.routes.ts | letters | STUB | Placeholder component |
| `/helpdesk` | NativeHelpdesk | HELPDESK | any | `GET /api/helpdesk` | `/api/helpdesk` | helpdesk.routes.ts | helpdesk_tickets | OK | — |
| `/support/command-center` | NativeSupportCommandCenter | SUPPORT_COMMAND_CENTER | any | `GET /api/helpdesk` | `/api/helpdesk` | helpdesk.routes.ts | helpdesk_tickets | OK | — |
| `/support/grievance-command-center` | NativeGrievanceCommandCenter | GRIEVANCE_COMMAND_CENTER | any | `GET /api/helpdesk/grievances` | `/api/helpdesk` | helpdesk.routes.ts | grievances | OK | — |
| `/assets-manager` | NativeAssetsManager | ASSETS_MANAGER | any | `GET /api/assets-mgmt` | `/api/assets-mgmt` | assets.routes.ts | asset_assignments | OK | — |
| `/document-verification` | NativeDocumentVerification | EMPLOYEE_MANAGEMENT | any | `GET /api/employee-docs` | `/api/employee-docs` | employee.documents.routes.ts | employee_documents | OK | — |
| `/employee-lifecycle` | NativeLifecycle | EMPLOYEE_LIFECYCLE | any | `GET /api/lifecycle` | `/api/lifecycle` | lifecycle.routes.ts | employee_lifecycle | OK | — |
| `/employee-lifecycle-v2` | NativeEmployeeLifecycle | EMPLOYEE_LIFECYCLE | any | `GET /api/lifecycle` | `/api/lifecycle` | lifecycle.routes.ts | employee_lifecycle | OK | Duplicate routes for same pageCode |
| `/employee-journey` | EmployeeJourney | — | authenticated | `GET /api/lifecycle` | `/api/lifecycle` | lifecycle.routes.ts | employee_lifecycle | WARN | Missing pageCode gate |
| `/benefits` | NativeBenefitsClaims | BENEFITS | any | `GET /api/benefits` | `/api/benefits` | benefits.routes.ts | benefit_enrollments | OK | — |
| `/career-planning` | NativeCareerPlanning | CAREER_PLANNING | any | `GET /api/career` | `/api/career` | career.routes.ts | career_plans | OK | — |
| `/erp` | NativeERP | ERP | any | `GET /api/erp` | `/api/erp` | erp.routes.ts | vendor_master, contracts | OK | — |
| `/mobility` | NativeMobilityManagement | MOBILITY | any | `GET /api/mobility` | `/api/mobility` | mobility.routes.ts | mobility_requests | OK | — |
| `/advanced-reports` | NativeAdvancedReports | ADVANCED_REPORTS | any | `GET /api/reports` | `/api/reports` | reporting.routes.ts | multiple | OK | — |
| `/reports/enterprise` | NativeEnterpriseReports | ADVANCED_REPORTS | any | `GET /api/reports/enterprise` | `/api/reports` | peopleos.routes.ts | multiple | OK | — |
| `/master-reports` | NativeMasterReports | ADVANCED_REPORTS | any | `GET /api/employees/report-master` | `/api/employees` | employee.report-master.routes.ts | employees | OK | — |
| `/my-roster` | NativeMyRoster | — | authenticated | `GET /api/roster-gov/self` | `/api/roster-gov` | roster.self.secure.routes.ts | roster_shifts | WARN | Missing pageCode gate |
| `/roster-master-builder` | NativeRosterMasterBuilder | ROSTER_MASTER | any | `GET /api/roster-master` | `/api/roster-master` | roster-master.routes.ts | roster_templates | OK | — |
| `/roster-capacity-config` | NativeRosterCapacityConfig | ROSTER_MASTER | any | `GET /api/roster-capacity` | `/api/roster-capacity` | roster-capacity.routes.ts | roster_capacity | OK | — |
| `/week-off-preferences` | NativeWeekOffPreferences | — | authenticated | `GET /api/roster-gov/weekoff-preference` | `/api/roster-gov` | weekoff-preference.routes.ts | weekoff_preferences | WARN | Missing pageCode gate |
| `/roster-preference` | NativeRosterPreference | WFM_ROSTER | any | `GET /api/roster-gov` | `/api/roster-gov` | roster.governance.routes.ts | roster_shifts | OK | — |
| `/kpi-config` | NativeKPIConfiguration | KPI_CONFIG | any | `GET /api/kpi` | `/api/kpi` | kpi.routes.ts | kpi_definitions | OK | — |
| `/process-config` | NativeProcessConfig | PROCESS_CONFIG | any | `GET /api/processes` | `/api/processes` | process.routes.ts | process_masters | OK | — |
| `/leave-types` | NativeLeaveTypeConfig | LEAVE_TYPES | any | `GET /api/leave/types` | `/api/leave` | leave.routes.ts | leave_types | OK | — |
| `/maternity-leave` | NativeMaternityLeave | — | admin/hr | `GET /api/leave/maternity` | `/api/leave` | leave.routes.ts | leave_requests | WARN | Missing pageCode gate |
| `/communication/templates` | NativeTemplateManager | — | admin/hr | `GET /api/communication/templates` | `/api/communication` | communication.routes.ts | comm_templates | WARN | Missing pageCode gate |
| `/communication/dispatch` | NativeDispatchCenter | — | admin/hr | `POST /api/communication/dispatch` | `/api/communication` | communication.routes.ts | dispatch_log | WARN | Missing pageCode gate |
| `/communication/history` | NativeDispatchHistory | — | admin/hr | `GET /api/communication/history` | `/api/communication` | communication.routes.ts | dispatch_log | WARN | Missing pageCode gate |
| `/communication/preferences` | NativeNotificationPreferences | — | authenticated | `GET /api/communication/preferences` | `/api/communication` | communication.routes.ts | notification_preferences | WARN | Missing pageCode gate |
| `/settings/communication-config` | NativeCommunicationConfig | — | admin | `GET /api/communication` | `/api/communication` | communication.routes.ts | comm_config | WARN | Missing pageCode gate; no /api/call-centre mount found |
| `/settings/call-centre-config` | NativeCallCentreConfig | — | admin | unknown — no /api/call-centre mount | MISSING | — | — | GAP | No backend mount for call-centre-config |
| `/migration-console` | NativeMigrationConsole | — | admin | `GET /api/migration` | `/api/migration` | migration.routes.ts | migration_log | WARN | Missing pageCode gate |
| `/customization` | NativeCustomizationManager | CUSTOMIZATION_MANAGER | any | `GET /api/customization` | `/api/customization` | customization.routes.ts | customization_rules | OK | — |
| `/customization/new`, `/customization/:id/edit` | NativeCustomizationRuleEditor | CUSTOMIZATION_MANAGER | any | `POST/PUT /api/customization` | `/api/customization` | customization.routes.ts | customization_rules | OK | — |
| `/it-provisioning` | NativeITProvisioningTracker | IT_PROVISIONING_TRACKER | any | `GET /api/it-provisioning` | `/api/it-provisioning` | it-provisioning.routes.ts | it_provisioning | OK | — |
| `/attendance-rules-master` | NativeAttendanceRulesMaster | — | admin/hr | `GET /api/wfm/attendance` | `/api/wfm/attendance` | attendance-engine.routes.ts | attendance_rules | WARN | Missing pageCode gate |
| `/expenses` | MyExpenses | — | authenticated | `GET /api/expenses` | `/api/expenses` | expense.routes.ts | expense_claims | WARN | Missing pageCode gate |
| `/expenses/new` | NewExpenseClaim | — | authenticated | `POST /api/expenses` | `/api/expenses` | expense.routes.ts | expense_claims | WARN | Missing pageCode gate |
| `/expenses/approvals` | ExpenseApprovals | — | authenticated | `GET /api/expenses/approvals` | `/api/expenses` | expense.routes.ts | expense_claims | WARN | Missing pageCode gate |
| `/expenses/finance` | FinanceQueue | — | authenticated | `GET /api/expenses/finance` | `/api/expenses` | expense.routes.ts | expense_claims | WARN | Missing pageCode gate; no role restriction |
| `/expenses/reports` | ExpenseReports | — | authenticated | `GET /api/expenses/reports` | `/api/expenses` | expense.routes.ts | expense_claims | WARN | Missing pageCode gate |
| `/payroll-hr/dashboard` | PayrollHrDashboard | PAYROLL_HR_DASHBOARD | any | `GET /api/payroll` | `/api/payroll` | payroll.routes.ts | payroll_runs | OK | — |
| `/wfm/dashboard` | WfmDashboard | WFM_DASHBOARD | any | `GET /api/wfm` | `/api/wfm` | wfm.routes.ts | roster_shifts | OK | — |
| `/hr/dashboard` | HrDashboard | HR_DASHBOARD | any | `GET /api/employees` | `/api/employees` | employee.routes.ts | employees | OK | — |
| `/my-dashboard` | EmployeeSelfDashboard | EMPLOYEE_SELF_DASHBOARD | any | `GET /api/employees/me` | `/api/employees` | employee.routes.ts | employees | OK | — |
| `/governance/tat-matrix` | NativePlaceholderPage | TAT_MATRIX | any | `GET /api/governance/tat` | `/api/governance/tat` | tat.routes.ts | tat_sla | STUB | Placeholder component |
| `/governance/tat-dashboard` | NativePlaceholderPage | TAT_DASHBOARD | any | `GET /api/governance/tat` | `/api/governance/tat` | tat.routes.ts | tat_sla | STUB | Placeholder component |
| `/ats/name-consistency` | NativePlaceholderPage | NAME_CONSISTENCY_MATRIX | any | `GET /api/ats/name-consistency` | `/api/ats/name-consistency` | name-consistency.routes.ts | candidates | STUB | Placeholder component |
| `/exit/resignation` | NativePlaceholderPage | RESIGNATION_MY_REQUEST | any | `GET /api/exit/resignation` | `/api/exit` | exit.routes.ts | exit_requests | STUB | Placeholder component |
| `/exit/resignation-command-center` | NativePlaceholderPage | RESIGNATION_COMMAND_CENTER | any | `GET /api/exit/resignation` | `/api/exit` | exit.routes.ts | exit_requests | STUB | Placeholder component |

---

## Backend Mounts With No Matching Frontend Route

| Backend Mount | Router File | Notes |
|---|---|---|
| `/api/mock-digilocker` | mock-digilocker.routes.ts | Dev-only DigiLocker stub; no frontend page |
| `/api/business-command` | business-command.routes.ts | Internal command bus; no direct UI route |
| `/api/business-actions` | business-actions.routes.ts | Internal action bus; no direct UI route |
| `/api/rm-change` | rm-change.routes.ts | RM change API; consumed by employee forms inline |
| `/api/audit` | audit.log.routes.ts | Audit log fetch; consumed by admin pages inline |
| `/api/external-db` | external-db.routes.ts | External DB connector; no dedicated page |
| `/api/dialer` | dialer.routes.ts | Call Master dialer bridge; no standalone frontend page |
| `/api/executive` | quality-executive.routes.ts | Quality executive summary; consumed by quality-dashboard inline |
| `/api/tasks` | task.routes.js | Internal task tracker; no standalone frontend route |
| `/api/assistant/context` | peopleos.routes.ts | AI assistant context feed; no standalone page |
| `/api/engagement-intelligence` | engagement-intelligence.routes.ts | Intelligence feed for engagement; consumed inline |
| `/api/account-control` | account.control.routes.ts | Account control; consumed by settings/admin inline |
| `/api/workforce-mandate` | workforce.mandate.routes.ts | Mandate builder; consumed by /workforce-planning inline |
| `/api/legacy` | legacy.routes.ts | Legacy compat; no direct UI route |
| `/api/wfm/cosec-sync` | cosec-sync.routes.ts | Cosec sync engine; no standalone page |
| `/api/wfm/biometric-punch` | biometric-punch.routes.ts | Biometric punch ingest; no UI page |
| `/api/wfm-manager-approvals` | — | Frontend route redirects to wfm-manager-approvals but backend is `/api/wfm` |

---

## Connectivity Gaps Found

### GAP-1: No Backend Mount for `/settings/call-centre-config`
- Frontend: `NativeCallCentreConfig`, roles: admin
- No `/api/call-centre` or `/api/communication/call-centre` mount exists in app.ts
- Risk: component will fail all data fetches silently

### GAP-2: `EnhancedClientMaster` — Wrong API Path Pattern
- Frontend route: `/client-master`, pageCode `CLIENT_MASTER`
- `clientRouter` is mounted at `/api` (not `/api/clients`), serving `GET /api/clients`
- `hrmsApi.ts` applies a `legacyDataAlias` for `/api/clients` because the old Axios-style page used `res.data.data`
- Risk: shape mismatch if EnhancedClientMaster calls `hrmsApi.get('/api/clients')` vs raw fetch

### GAP-3: Candidate Portal Has No Dedicated Backend Mount
- `/candidate-portal/dashboard` consumes candidate-facing endpoints through `GET /api/ats/*`
- No `/api/candidate-portal` mount exists; candidate token scoping is unclear
- Risk: candidate JWT may have access to recruiter-scoped ATS endpoints

### GAP-4: 22 Sensitive Routes Missing `pageCode` Gate
Routes protected only by `ProtectedRoute` (no `WorkforcePageGate`) — page-level access control is not enforced by the access control system for these paths:
`/leaves`, `/assets`, `/reports`, `/settings`, `/profile`, `/attendance`, `/calendar`, `/ats/candidate-registration`, `/ats/registration-enhanced`, `/ats/bgv-enhanced`, `/ats/command-centre`, `/ats/form-config`, `/agent-performance`, `/engagement` (and sub-routes), `/people-experience/command-center`, `/security-center`, `/super-admin/*` (3 routes), `/payroll/overtime`, `/maternity-leave`, `/communication/*` (4 routes), `/migration-console`, `/my-roster`, `/week-off-preferences`, `/expenses/*` (5 routes), `/attendance-rules-master`, `/employee-journey`, `/performance-feedback/*` (5 routes)

### GAP-5: Duplicate Routes Serving Same Component
- `/ats/command-center` (Gate: ATS_DASHBOARD) vs `/ats/command-centre` (roles only) — same component, split access control
- `/ats/payroll-hr` and `/ats/payroll-hr-validation` — identical Gate and component
- `/exit-management` and `/exit/command-center` — same Gate (EXIT_COMMAND_CENTER) and component
- `/employee-lifecycle` and `/employee-lifecycle-v2` — same Gate (EMPLOYEE_LIFECYCLE)
- `/ats/recruiter/my-candidates` and `/ats/recruiter/workspace` — same component `NativeATSRecruiterWorkspace`, different pageCodes

### GAP-6: `/control-tower` Frontend Redirects to `/dashboard`
- `NativeControlTower` component is imported but the route redirects to `/dashboard`
- Backend `/api/control-tower` mount exists (control-tower.routes.ts) with no consumer

### GAP-7: `NativeCEOCommandCenter` Imported But Route Redirects
- `/management/ceo-command-center` redirects to `/dashboard`
- Component imported but dead. `/ceo/dashboard` (CeoDashboard) serves this role instead

### GAP-8: `/payroll/overtime` Backend Shape Mismatch Risk
- Frontend page `PayrollOvertimeManagement` sends `PATCH /api/payroll/lines/:lineId/overtime`
- This endpoint is in the base `payroll.routes.ts` not `payroll-extended.routes.ts`
- No list/GET endpoint specifically named `overtime` — component likely fetches via generic payroll lines then patches

### GAP-9: STUB Routes (NativePlaceholderPage) With Real Backend Mounts
- `/governance/tat-matrix`, `/governance/tat-dashboard` — backend TAT routes exist at `/api/governance/tat`
- `/ats/name-consistency` — backend mount at `/api/ats/name-consistency` exists
- `/exit/resignation`, `/exit/resignation-command-center` — backend exit routes exist
- `/letters/appointment-esign` — backend route exists at `/api/letters` (appointmentEsignRouter)
- These are backend-ready but frontend still shows placeholder

### GAP-10: Goals, Jobs, PIP, Reviews Management Routes Redirected
- `/goals`, `/jobs`, `/pip-management`, `/reviews-management` all redirect to `/dashboard`
- Backend mounts `/api/goals` and `/api/jobs` exist with full service implementations
- Frontend is entirely disconnected from these backend modules
