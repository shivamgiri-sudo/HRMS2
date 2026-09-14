# Route Inventory Report

Generated: 2026-09-11T20:54:16.435Z

**Total route declarations:** 141
**Unique component names:** 41
**Redirects (Navigate):** 83
**Components with multiple paths (duplicates):** 6

## Duplicates — Components Registered Under Multiple Paths

| Component | Paths | Files |
|-----------|-------|-------|
| AttendanceIntegrityRedirect | `/attendance/billing-config`, `/wfm/mismatch-queue`, `/wfm/attendance-exceptions`, `/wfm/cosec-monitoring` | src\config\routes\workforce.routes.tsx |
| Auth | `/auth`, `/login` | src\config\routes\public.routes.tsx |
| DashboardRouteGate | `/ceo/dashboard`, `/payroll-hr/dashboard`, `/wfm/dashboard`, `/hr/dashboard`, `/manager/dashboard`, `/my-dashboard`, `/quality-dashboard`, `/operations-dashboard`, `/recruiter-dashboard`, `/wfm-attendance`, `/it/dashboard` | src\config\routes\dashboards.routes.tsx |
| PortalRoute | `/portal`, `/portal/processes/:id` | src\config\routes\portal.routes.tsx |
| ReadinessScopeRedirect | `/payroll/branch-readiness`, `/payroll/process-readiness` | src\config\routes\payroll.routes.tsx |
| VisitorStatusPage | `/visitor-status/:token`, `/visitor-status` | src\config\routes\public.routes.tsx |

## Redirects

| From | To | File |
|------|-----|------|
| `/expenses` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/new` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/new/:claimId` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/approvals` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/finance` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/reports` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/expenses/:claimId` | → /payroll/reimbursements | src\config\routes\finance.routes.tsx |
| `/master-reports` | → /reports | src\config\routes\finance.routes.tsx |
| `/advanced-reports` | → /reports | src\config\routes\finance.routes.tsx |
| `/reports/enterprise` | → /reports | src\config\routes\finance.routes.tsx |
| `/payroll/statutory-config` | → /payroll/statutory?tab=config | src\config\routes\payroll.routes.tsx |
| `/payroll/salary-packages` | → /payroll/package-admin | src\config\routes\payroll.routes.tsx |
| `/payroll/salary-package-manager` | → /payroll/salary-packages | src\config\routes\payroll.routes.tsx |
| `/payroll/disbursal` | → /payroll/payment-center?tab=disbursal | src\config\routes\payroll.routes.tsx |
| `/payroll/bank-readiness` | → /payroll/payment-center?tab=bank | src\config\routes\payroll.routes.tsx |
| `/payroll/holiday-work-requests` | → /payroll/holiday-work | src\config\routes\payroll.routes.tsx |
| `/payroll/holiday-work-approvals` | → /payroll/holiday-work?tab=approvals | src\config\routes\payroll.routes.tsx |
| `/payroll/cost-summary` | → /reports?view=library&report=payroll-cost-summary | src\config\routes\payroll.routes.tsx |
| `/payroll/statutory-filing` | → /payroll/statutory?tab=filing | src\config\routes\payroll.routes.tsx |
| `/payroll/variance` | → /reports?view=library&report=payroll-variance | src\config\routes\payroll.routes.tsx |
| `/payroll/cheque-validation` | → /payroll/ho-queues | src\config\routes\payroll.routes.tsx |
| `/payroll/pf-creation-queue` | → /payroll/pf-management | src\config\routes\payroll.routes.tsx |
| `/payroll/pf-batches` | → /payroll/pf-management?tab=batches | src\config\routes\payroll.routes.tsx |
| `/payroll/salary-disputes/queue` | → /payroll/salary-disputes?tab=queue | src\config\routes\payroll.routes.tsx |
| `/payroll/salary-disputes/team` | → /payroll/salary-disputes?tab=team | src\config\routes\payroll.routes.tsx |
| `/employee-lifecycle-v2` | → /employee-lifecycle | src\config\routes\people.routes.tsx |
| `/exit-management` | → /exit/command-center | src\config\routes\people.routes.tsx |
| `/engagement/command-center` | → /people-experience/command-center | src\config\routes\people.routes.tsx |
| `/reviews-management` | → /performance-feedback/assignments | src\config\routes\performance.routes.tsx |
| `/goals` | → /performance | src\config\routes\performance.routes.tsx |
| `/kpi/dashboard` | → /operations-kpi | src\config\routes\performance.routes.tsx |
| `/workforce/command-center` | → /performance/command-center | src\config\routes\performance.routes.tsx |
| `/operations-kpi` | → /operations-dashboard | src\config\routes\performance.routes.tsx |
| `/quality/dashboard` | → /quality-dashboard | src\config\routes\performance.routes.tsx |
| `/quality/audit` | → /quality-dashboard | src\config\routes\performance.routes.tsx |
| `/quality/team` | → /quality-dashboard | src\config\routes\performance.routes.tsx |
| `/quality/my-dashboard` | → /quality-dashboard | src\config\routes\performance.routes.tsx |
| `/operations/dashboard` | → /operations-dashboard | src\config\routes\performance.routes.tsx |
| `/lms` | → /lms/my-learning | src\config\routes\performance.routes.tsx |
| `/lms/management-dashboard` | → /lms/admin | src\config\routes\performance.routes.tsx |
| `/profile-enhanced` | → /profile | src\config\routes\platform.routes.tsx |
| `/profile-v2` | → /profile | src\config\routes\platform.routes.tsx |
| `/profile-v3` | → /profile | src\config\routes\platform.routes.tsx |
| `/notification-preferences` | → /communication/preferences | src\config\routes\platform.routes.tsx |
| `/onboarding-requests` | → /onboarding?tab=requests | src\config\routes\platform.routes.tsx |
| `/management/ceo-command-center` | → /ceo/dashboard | src\config\routes\platform.routes.tsx |
| `/reports/library` | → /reports?view=library | src\config\routes\platform.routes.tsx |
| `/reports/control-room` | → /reports?view=control-room | src\config\routes\platform.routes.tsx |
| `/reports/source-validation` | → /reports?view=validation | src\config\routes\platform.routes.tsx |
| `/my-report-requests` | → /reports?view=requests | src\config\routes\platform.routes.tsx |
| `/admin/report-audit` | → /reports?view=audit | src\config\routes\platform.routes.tsx |
| `/break-reports` | → /reports?view=library&report=break-daily-summary | src\config\routes\platform.routes.tsx |
| `/break-session-log` | → /reports?view=library&report=break-session-log | src\config\routes\platform.routes.tsx |
| `/payroll/variance` | → /reports?view=library&report=payroll-variance | src\config\routes\platform.routes.tsx |
| `/payroll/cost-summary` | → /reports?view=library&report=payroll-cost-summary | src\config\routes\platform.routes.tsx |
| `/reports-legacy/*` | → /reports | src\config\routes\platform.routes.tsx |
| `/` | → /auth | src\config\routes\public.routes.tsx |
| `/candidate-registration` | → /interview-registration | src\config\routes\public.routes.tsx |
| `/walkin-registration` | → /interview-registration | src\config\routes\public.routes.tsx |
| `/onboard-full-v2` | → /onboard-full | src\config\routes\public.routes.tsx |
| `/candidate-onboarding-full` | → /onboard-full | src\config\routes\public.routes.tsx |
| `/onboard-v1` | → /onboard-full | src\config\routes\public.routes.tsx |
| `/ats/dashboard` | → /ats/command-center | src\config\routes\recruitment.routes.tsx |
| `/ats/candidate-registration` | → /interview-registration | src\config\routes\recruitment.routes.tsx |
| `/ats/recruiter/calling-entry` | → /ats/recruiter/hiring-entry | src\config\routes\recruitment.routes.tsx |
| `/ats/recruiter/calling-dashboard` | → /ats/recruiter/hiring-dashboard | src\config\routes\recruitment.routes.tsx |
| `/hr-onboarding-requests` | → /ats/onboarding-requests | src\config\routes\recruitment.routes.tsx |
| `/ats/payroll-hr-validation` | → /ats/onboarding-requests | src\config\routes\recruitment.routes.tsx |
| `/ats/payroll-hr` | → /ats/onboarding-requests | src\config\routes\recruitment.routes.tsx |
| `/ats/bgv-enhanced` | → /ats/bgv | src\config\routes\recruitment.routes.tsx |
| `/ats/bgv-report` | → /ats/bgv | src\config\routes\recruitment.routes.tsx |
| `/attendance/regularizations` | → /attendance-regularization | src\config\routes\workforce.routes.tsx |
| `/leave-approvals` | → /leaves | src\config\routes\workforce.routes.tsx |
| `/leave/requests` | → /leaves | src\config\routes\workforce.routes.tsx |
| `/wfm-roster` | → /wfm/roster | src\config\routes\workforce.routes.tsx |
| `/wfm/roster-pipeline` | → /wfm/roster-import | src\config\routes\workforce.routes.tsx |
| `/wfm/auto-roster` | → /wfm/roster-builder | src\config\routes\workforce.routes.tsx |
| `/roster-master-builder` | → /wfm/roster-builder | src\config\routes\workforce.routes.tsx |
| `/wfm/adherence-command-center` | → /wfm/live-tracker | src\config\routes\workforce.routes.tsx |
| `/wfm/agent-attendance-view` | → /wfm/live-tracker | src\config\routes\workforce.routes.tsx |
| `/break-management/devices` | → /wfm/break-desk-devices | src\config\routes\workforce.routes.tsx |
| `/break-reports` | → /reports?view=library&report=break-daily-summary | src\config\routes\workforce.routes.tsx |
| `/break-session-log` | → /reports?view=library&report=break-session-log | src\config\routes\workforce.routes.tsx |

## All Canonical Routes

| Component | Path | File |
|-----------|------|------|
| AttendanceIntegrityRedirect ⚠️ | `/attendance/billing-config` | src\config\routes\workforce.routes.tsx |
| AttendanceIntegrityRedirect ⚠️ | `/wfm/mismatch-queue` | src\config\routes\workforce.routes.tsx |
| AttendanceIntegrityRedirect ⚠️ | `/wfm/attendance-exceptions` | src\config\routes\workforce.routes.tsx |
| AttendanceIntegrityRedirect ⚠️ | `/wfm/cosec-monitoring` | src\config\routes\workforce.routes.tsx |
| Auth ⚠️ | `/auth` | src\config\routes\public.routes.tsx |
| Auth ⚠️ | `/login` | src\config\routes\public.routes.tsx |
| BreakDeskErrorBoundary | `/break-desk` | src\config\routes\public.routes.tsx |
| CandidateOnboardingFullPage | `/onboard-full` | src\config\routes\public.routes.tsx |
| CandidateOnboardingPage | `/onboard` | src\config\routes\public.routes.tsx |
| CandidateOnboardingV2 | `/onboard-full-legacy` | src\config\routes\public.routes.tsx |
| CandidatePortalDashboard | `/candidate-portal/dashboard` | src\config\routes\public.routes.tsx |
| CandidatePortalLogin | `/candidate-portal/login` | src\config\routes\public.routes.tsx |
| DashboardRouteGate ⚠️ | `/ceo/dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/payroll-hr/dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/wfm/dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/hr/dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/manager/dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/my-dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/quality-dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/operations-dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/recruiter-dashboard` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/wfm-attendance` | src\config\routes\dashboards.routes.tsx |
| DashboardRouteGate ⚠️ | `/it/dashboard` | src\config\routes\dashboards.routes.tsx |
| EmployeeDocumentEsignReviewPage | `/employee/joining-documents/esign/:token` | src\config\routes\public.routes.tsx |
| EmployeeEpfComplianceReviewPage | `/employee/epf-compliance/review/:token` | src\config\routes\public.routes.tsx |
| EmployeeJoiningKitEsignPage | `/employee/joining-kit/esign/:token` | src\config\routes\public.routes.tsx |
| Features | `/features` | src\config\routes\public.routes.tsx |
| HowItWorks | `/how-it-works` | src\config\routes\public.routes.tsx |
| NativeATSCandidateRegistration | `/interview-registration` | src\config\routes\public.routes.tsx |
| No | `/wfm/team-attendance` | src\config\routes\workforce.routes.tsx |
| OnboardingFullDemo | `/onboarding-demo` | src\config\routes\public.routes.tsx |
| OpsBoard | `/display/ops-board` | src\config\routes\public.routes.tsx |
| PortalLogin | `/portal/login` | src\config\routes\public.routes.tsx |
| PortalRoute ⚠️ | `/portal` | src\config\routes\portal.routes.tsx |
| PortalRoute ⚠️ | `/portal/processes/:id` | src\config\routes\portal.routes.tsx |
| Pricing | `/pricing` | src\config\routes\public.routes.tsx |
| PrivacyPolicy | `/privacy-policy` | src\config\routes\public.routes.tsx |
| ProfileCompare | `/profile-compare` | src\config\routes\public.routes.tsx |
| ProfileV3Demo | `/profile-v3-demo` | src\config\routes\public.routes.tsx |
| PublicAppointmentLetterVerify | `/verify/appointment/:token` | src\config\routes\public.routes.tsx |
| PublicEmployeeVerify | `/verify/emp/:employeeCode` | src\config\routes\public.routes.tsx |
| PublicGatePassVerify | `/verify/gp` | src\config\routes\public.routes.tsx |
| PublicKpiCapture | `/kpi-capture` | src\config\routes\public.routes.tsx |
| PublicKpiCaptureResults | `/kpi-capture/results/:token` | src\config\routes\public.routes.tsx |
| PublicPayslipVerify | `/verify/payslip/:employeeCode/:monthYear` | src\config\routes\public.routes.tsx |
| ReadinessScopeRedirect ⚠️ | `/payroll/branch-readiness` | src\config\routes\payroll.routes.tsx |
| ReadinessScopeRedirect ⚠️ | `/payroll/process-readiness` | src\config\routes\payroll.routes.tsx |
| ResetPassword | `/reset-password` | src\config\routes\public.routes.tsx |
| Security | `/security` | src\config\routes\public.routes.tsx |
| Step10Demo | `/onboarding-step10-demo` | src\config\routes\public.routes.tsx |
| TermsOfService | `/terms-of-service` | src\config\routes\public.routes.tsx |
| UXSkillDemo | `/ux-skill-demo` | src\config\routes\public.routes.tsx |
| UXSkillDemoCompare | `/ux-skill-compare` | src\config\routes\public.routes.tsx |
| VisitorGatePage | `/visitor-gate` | src\config\routes\public.routes.tsx |
| VisitorSelfRegister | `/visitor-register` | src\config\routes\public.routes.tsx |
| VisitorStatusPage ⚠️ | `/visitor-status/:token` | src\config\routes\public.routes.tsx |
| VisitorStatusPage ⚠️ | `/visitor-status` | src\config\routes\public.routes.tsx |
| WaitingRoomDisplay | `/display/waiting-room` | src\config\routes\public.routes.tsx |
