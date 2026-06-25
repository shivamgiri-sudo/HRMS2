# HRMS2 Route / API / DB Master Mapping

Generated: 2026-06-25 | Source: `src/App.tsx` + `backend/src/app.ts`

---

## Legend

- **PageCode** — `WorkforcePageGate` code used for page-level access control
- **Status** — WORKING = route + API + DB all present; BROKEN = route exists but API or DB gap; UNKNOWN = no data found
- **Fix Required** — listed only when Status = BROKEN

---

## Auth

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/auth` `/login` | `AuthClean` | — | public | Login, Forgot Password | `POST /api/auth/login`, `POST /api/auth/logout` | `auth.routes.ts` | `auth_user`, `auth_refresh_token`, `org_settings` | WORKING |
| `/reset-password` | `ResetPassword` | — | public | Request Reset | `POST /api/auth/request-reset` | `password-reset.routes.ts` | `auth_user` | WORKING |
| `/change-password` | `ChangePassword` | — | authenticated | Save | `POST /api/auth/change-password` | `auth.routes.ts` | `auth_user` | WORKING |
| `/two-factor` | `TwoFactor` | — | authenticated | Verify | `POST /api/auth/2fa/verify` | `auth.routes.ts` | `org_settings` | WORKING |

---

## ATS

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/ats/recruiter/my-candidates` | `NativeATSRecruiterWorkspace` | `ATS_RECRUITER_QUEUE` | admin, hr, super_admin, recruiter | Submit, Schedule Interview | `GET /api/ats/recruiter/my-candidates`, `POST /api/ats-full-parity/recruiter-submission` | `ats.routes.ts`, `atsFullParity.routes.ts` | `candidates`, `ats_candidate_stage_log` | WORKING |
| `/ats/recruiter/workspace` | `NativeATSRecruiterWorkspace` | `ATS_RECRUITER_WORKSPACE` | admin, hr, super_admin, recruiter | (same as above) | `GET /api/ats/recruiter/my-candidates` | `ats.routes.ts` | `candidates` | WORKING |
| `/ats/onboarding-bridge` | `NativeATSOnboardingBridge` | `ATS_ONBOARDING_BRIDGE` | admin, hr | Create Bridge, Send Token | `GET /api/ats/onboarding-bridge`, `POST /api/ats/onboarding/send-token/:id` | `ats.routes.ts`, `ats.onboarding.routes.ts` | `candidates`, `ats_onboarding_bridge` | WORKING |
| `/ats/command-center` | `NativeATSFullParityCommandCenter` | `ATS_DASHBOARD` | admin, hr, recruiter, manager, branch_head, process_manager, ceo | Health Check, SLA Check, Repair | `GET /api/ats-full-parity/web-data`, `GET /api/ats-full-parity/health`, `POST /api/ats-full-parity/jobs/sla-check` | `atsFullParity.routes.ts` | `candidates`, `ats_full_parity_queue` | WORKING |
| `/ats/offer-approvals` | `NativeBranchHeadApproval` | `ATS_OFFER_APPROVALS` | admin, hr, manager, branch_head | Approve Offer, Reject | `GET /api/ats/onboarding/pending-approval`, `POST /api/ats/onboarding/offers/:id/:action` | `ats.onboarding.routes.ts` | `ats_offer_letter`, `ats_onboarding_bridge` | WORKING |
| `/ats/branch-head-approval` | `BranchHeadApproval` | `ATS_BRANCH_HEAD_APPROVAL` | admin, manager, branch_head | Approve, Reject | `GET /api/ats/branch-head-approval/pending`, `POST /api/ats/branch-head-approval/process` | `branch-head-approval.routes.ts` | `ats_branch_head_approval`, `ats_candidate` | **BROKEN** |
| `/ats/waiting-queue` | `NativeATSWaitingQueue` | `ATS_WAITING_QUEUE` | admin, hr, recruiter, manager | Assign Recruiter, Move Stage | `GET /api/ats/candidates?stage=Applied` | `ats.routes.ts` | `candidates` | WORKING |
| `/ats/candidate-master` | `NativeATSCandidateMaster` | `ATS_CANDIDATE_MASTER` | admin, hr, recruiter, manager | Search, Filter, Export | `GET /api/ats/candidates?limit=500` | `ats.routes.ts` | `candidates` | WORKING |

> **Fix Required — `/ats/branch-head-approval`**: `branchHeadApprovalRouter` is defined in `backend/src/modules/ats/branch-head-approval.routes.ts` but is **never imported or mounted** in `app.ts` or `ats.routes.ts`. All calls to `/api/ats/branch-head-approval/*` return 404. Add `import { branchHeadApprovalRouter } from "./modules/ats/branch-head-approval.routes.js"` and `app.use("/api/ats/branch-head-approval", branchHeadApprovalRouter)` in `app.ts`.

---

## Onboarding

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/onboard` | `CandidateOnboardingPage` | — | public | Submit Form | `POST /api/ats/candidates` | `ats.routes.ts` | `candidates` | WORKING |
| `/onboard-full` | `CandidateOnboardingV2` | — | public (token-gated) | Save Section, Submit | `GET /api/ats/onboarding-full/validate-token`, `POST /api/ats/onboarding-full/employee-details` etc. | `onboarding-full.routes.ts` | `ats_onboarding_full_submission`, `employee_documents` | WORKING |
| `/onboard-full-legacy` | `CandidateOnboardingFullPage` | — | public (token-gated) | (same as above) | same as `/onboard-full` | `onboarding-full.routes.ts` | same | WORKING |
| `/ats/onboarding-requests` | `NativeHROnboardingRequests` | `ATS_ONBOARDING_BRIDGE` | admin, hr, recruiter | Approve Request | `GET /api/ats/onboarding-full/requests` | `onboarding-full.routes.ts` | `ats_onboarding_full_submission` | WORKING |
| `/interview-registration` | `NativeATSCandidateRegistration` | — | public | Register | `POST /api/ats/candidates` | `ats.routes.ts` | `candidates` | WORKING |

---

## Payroll

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/payroll` | `Payroll` | `PAYROLL` | admin, hr, finance | Run Payroll, View | `GET/POST /api/payroll/*` | `payroll.routes.ts`, `payroll.secure.routes.ts` | `payroll_run`, `salary_prep_line` | WORKING |
| `/payroll/readiness` | `NativePayrollReadiness` | `PAYROLL` | admin, hr, finance | Scan, View Blocked | `GET /api/payroll/readiness/summary`, `GET /api/payroll/readiness/blocked-employees`, `POST /api/payroll/readiness/scan` | `peopleos.routes.ts` (payrollReadinessRouter) | `payroll_readiness_snapshot`, `employees` | WORKING |
| `/payroll/incentives` | `NativeIncentives` | `PAYROLL_INCENTIVES` | admin, hr, finance, wfm_spoc, payroll_hr | Upload, Submit Batch, Approve, Apply to Run | `GET /api/incentives/batches`, `POST /api/incentives/batches`, `POST /api/incentives/batches/:id/lines/import`, `POST /api/incentives/batches/:id/approve`, `POST /api/incentives/apply-to-run` | `incentives.routes.ts` | `incentive_master`, `incentive_upload_batch`, `incentive_upload_line`, `salary_prep_line` | WORKING |
| `/payroll/incentive-upload` | — | — | — | — | — | — | — | **BROKEN** |
| `/payroll/incentive-approvals` | — | — | — | — | — | — | — | **BROKEN** |
| `/payroll/incentive-register` | — | — | — | — | — | — | — | **BROKEN** |

> **Fix Required — incentive sub-routes**: `/payroll/incentive-upload`, `/payroll/incentive-approvals`, `/payroll/incentive-register` are **not defined** in `App.tsx`. All incentive functionality (upload, approval workflow, register) is consolidated inside `/payroll/incentives` via tab navigation in `NativeIncentives.tsx`. Either add the missing routes as aliases pointing to `NativeIncentives` with a `?tab=` param, or treat them as non-existent navigation entries that should be removed from any sidebar/menu references.

---

## Work Inbox

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/work-inbox` | `NativeWorkInbox` | `WORK_INBOX` | authenticated | Mark Read, Action, Escalate | `GET /api/inbox`, `GET /api/inbox/count`, `PATCH /api/inbox/:id/read`, `PATCH /api/inbox/:id/actioned`, `PATCH /api/inbox/mark-all-read` | `inbox.routes.ts` | `work_item`, `work_item_audit_log` | WORKING |

---

## Governance

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/governance/tat-dashboard` | `NativePlaceholderPage` | `TAT_DASHBOARD` | admin, hr | — | `GET /api/governance/tat/dashboard` | `tat.routes.ts` | `tat_matrix_master`, `task_tat_instance` | **BROKEN** |
| `/governance/tat-matrix` | `NativePlaceholderPage` | `TAT_MATRIX` | admin, hr | Save Matrix | `GET /api/governance/tat/matrix`, `POST /api/governance/tat/matrix` | `tat.routes.ts` | `tat_matrix_master` | **BROKEN** |

> **Fix Required — TAT Dashboard**: Both TAT routes render `NativePlaceholderPage` which has no TAT-specific UI or API integration. Backend `tat.routes.ts` and `tat.service.ts` exist with full CRUD. A dedicated `NativeTATDashboard` component needs to be built and wired to `/api/governance/tat/*`.

---

## Exit / Resignation

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/exit/resignation` | `NativePlaceholderPage` | `RESIGNATION_MY_REQUEST` | authenticated | — | `GET /api/exit/resignation/my`, `POST /api/exit/resignation` | `resignation.routes.ts` (mounted at `/api/exit/resignation`) | `resignation_discussion`, `exit_request` | **BROKEN** |
| `/exit/resignation-command-center` | `NativePlaceholderPage` | `RESIGNATION_COMMAND_CENTER` | admin, hr | Accept, Reject | `GET /api/exit/resignation`, `POST /api/exit/resignation/:id/accept` | `resignation.routes.ts` | `resignation_discussion` | **BROKEN** |
| `/exit/command-center` | `NativeExitCommandCenter` | `EXIT_COMMAND_CENTER` | admin, hr | Initiate Clearance, View Tasks | `GET /api/exit`, `POST /api/exit/:id/clearance-tasks` | `exit.routes.ts` | `exit_request`, `exit_clearance_task` | WORKING |
| `/exit-management` | `NativeExitManagement` | `EXIT_COMMAND_CENTER` | admin, hr | — | same as exit command center | `exit.routes.ts` | same | WORKING |

> **Fix Required — Resignation routes**: Both `/exit/resignation` and `/exit/resignation-command-center` render `NativePlaceholderPage`. The backend `resignation.routes.ts` is fully implemented (POST, GET, PATCH, accept, reject). A dedicated `NativeResignationMyRequest` and `NativeResignationCommandCenter` need to be built and registered in `App.tsx`.

---

## Compliance / DPDP

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/compliance/dpdp-withdrawal` | — | — | — | — | — | — | — | **BROKEN** |
| `/privacy/dpdp-withdrawal` | `NativeDPDPWithdrawal` | `DPDP_WITHDRAWAL` | authenticated | Request Withdrawal | `GET /api/privacy/dpdp-withdrawal/my-requests`, `POST /api/privacy/dpdp-withdrawal/request` | `dpdp-withdrawal.routes.ts` | `dpdp_consent_withdrawal`, `dpdp_withdrawal_audit_log` | WORKING |
| `/compliance/dpdp-withdrawal-admin` | `NativeDPDPWithdrawalAdmin` | `DPDP_WITHDRAWAL_ADMIN` | admin, hr | Approve, Reject | `GET /api/privacy/dpdp-withdrawal/*` | `dpdp-withdrawal.routes.ts` | `dpdp_consent_withdrawal`, `dpdp_processing_hold` | WORKING |
| `/compliance/dpdp` | `NativeDPDPCompliance` | `DPDP_COMPLIANCE` | admin, hr | — | `GET /api/compliance/dpdp` | `compliance.routes.ts` | `dpdp_consent_withdrawal` | WORKING |

> **Fix Required — `/compliance/dpdp-withdrawal`**: This path is **not in `App.tsx`**. The working route is `/privacy/dpdp-withdrawal`. Any menu/link pointing to `/compliance/dpdp-withdrawal` will hit the 404 page. Add a `<Route path="/compliance/dpdp-withdrawal" element={<Navigate to="/privacy/dpdp-withdrawal" replace />} />` alias.

---

## Role Dashboards

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/ceo/dashboard` | `CeoDashboard` | `CEO_DASHBOARD` | ceo, admin | Filter Branch/Process | `GET /api/dashboards/CEO_DASHBOARD/summary`, `GET /api/dashboards/CEO_DASHBOARD/good-bad-insights` | `dashboard.routes.ts` | `dashboard_metric_value`, `employees` | WORKING |
| `/hr/dashboard` | `HrDashboard` | `HR_DASHBOARD` | hr, admin | View HR Metrics | `GET /api/dashboards/HR_DASHBOARD/summary` | `dashboard.routes.ts` | `dashboard_metric_value` | WORKING |
| `/my-dashboard` | `EmployeeSelfDashboard` | `EMPLOYEE_SELF_DASHBOARD` | employee (all) | View Attendance, Leaves | `GET /api/wfm/my-attendance`, `GET /api/leaves/my-balance`, `GET /api/ats/my-onboarding-status` | `wfm.routes.ts`, `leave.routes.ts`, `ats.routes.ts` | `attendance_daily_record`, `leave_balance` | **BROKEN** |
| `/dashboard` | `Index` | — | authenticated | (role-aware hub) | `GET /api/dashboards/:code/summary` | `dashboard.routes.ts` | `dashboard_metric_value` | WORKING |
| `/payroll-hr/dashboard` | `PayrollHrDashboard` | `PAYROLL_HR_DASHBOARD` | payroll_hr, finance, admin | — | `GET /api/dashboards/PAYROLL_HR_DASHBOARD/summary` | `dashboard.routes.ts` | `dashboard_metric_value` | WORKING |

> **Fix Required — `/my-dashboard`**: `EmployeeSelfDashboard` calls `GET /api/ats/my-onboarding-status` which is **not defined** in `ats.routes.ts` or any ATS router — returns 404. Also note the `DASHBOARD_CODE` constant is not set in `EmployeeSelfDashboard.tsx` (no match in grep); the component uses direct endpoint calls. The missing `/api/ats/my-onboarding-status` endpoint should be added to `ats.routes.ts`.

---

## ATS Payroll HR Validation

| Frontend Route | Component | PageCode | Allowed Roles | Key Buttons | API Endpoint | Backend File | DB Table | Status |
|---|---|---|---|---|---|---|---|---|
| `/ats/payroll-hr` | `NativePayrollHRValidation` | `ATS_PAYROLL_HR` | admin, hr, payroll_hr | Validate, Approve | `GET /api/ats/payroll-hr/*` | `payroll-hr.routes.ts` | `ats_payroll_hr_validation` | WORKING |
| `/ats/payroll-hr-validation` | `NativePayrollHRValidation` | `ATS_PAYROLL_HR` | authenticated | (same) | same | same | same | WORKING |

---

## Summary of BROKEN Routes

| Route | Root Cause |
|---|---|
| `/ats/branch-head-approval` | `branchHeadApprovalRouter` defined but never mounted in `app.ts` |
| `/payroll/incentive-upload` | Route not in `App.tsx`; no component exists |
| `/payroll/incentive-approvals` | Route not in `App.tsx`; no component exists |
| `/payroll/incentive-register` | Route not in `App.tsx`; no component exists |
| `/governance/tat-dashboard` | Renders `NativePlaceholderPage`; no real UI or API wiring |
| `/governance/tat-matrix` | Renders `NativePlaceholderPage`; no real UI or API wiring |
| `/exit/resignation` | Renders `NativePlaceholderPage`; backend fully implemented |
| `/exit/resignation-command-center` | Renders `NativePlaceholderPage`; backend fully implemented |
| `/compliance/dpdp-withdrawal` | Route not in `App.tsx`; working path is `/privacy/dpdp-withdrawal` |
| `/my-dashboard` | `GET /api/ats/my-onboarding-status` endpoint missing from ATS router |
