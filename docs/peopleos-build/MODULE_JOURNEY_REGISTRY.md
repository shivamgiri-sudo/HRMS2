# PeopleOS Module and Journey Registry

> Version: 1.0.0 | Branch: `refactor/peopleos-enterprise-convergence` | 2026-07-18
>
> Machine-readable source: `config/peopleos-module-registry.json`
>
> Status key: `PRODUCTION` | `CONTROLLED_PILOT` | `BETA` | `LEGACY` | `REDIRECT_ONLY` | `DISABLED` | `PLANNED`
>
> Readiness key: `READY` | `PARTIAL` | `BLOCKED` | `UNVERIFIED`

---

## Domain: People

### EMPLOYEE_MANAGEMENT — Employee Management

| Field | Value |
|---|---|
| Canonical Route | `/employees` |
| Canonical API | `/api/employees` |
| Legacy Routes | `/employee-stat-card`, `/employee-stat-card/:id` |
| Authoritative Tables | `employees`, `employee_employment_detail`, `employee_personal_detail` |
| Roles | super_admin, admin, hr, manager, branch_head, employee |
| Scope | branch_id, process_id, department_id, reporting_manager_id |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Contains PII | YES |
| Contains Payroll | YES |
| Audit Required | YES |
| Known Gaps | Field-level masking for PAN/Aadhaar missing server-side; cross-employee access not universally tested |

---

### EMPLOYEE_360 — Employee 360 View

| Field | Value |
|---|---|
| Canonical Route | `/employees/:id/360` |
| Canonical API | `/api/employees/:id/360` |
| Roles | super_admin, admin, hr, manager |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Contains PII | YES |
| Contains Payroll | YES |
| Known Gaps | Salary data visible without explicit payroll role check in 360 view |

---

### EMPLOYEE_LIFECYCLE — Employee Lifecycle

| Field | Value |
|---|---|
| Canonical Route | `/employee-lifecycle` |
| Legacy Routes | `/employee-lifecycle-v2` |
| Canonical API | `/api/lifecycle` |
| Authoritative Tables | `employee_lifecycle_event`, `employee_journey_log` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | `/employee-lifecycle-v2` is a parallel page with separate component — needs convergence decision |

---

### EXIT_FF — Exit Management & Full and Final

| Field | Value |
|---|---|
| Canonical Route | `/exit/command-center` |
| Legacy Routes | `/exit-management` |
| Canonical API | `/api/exit` |
| Authoritative Tables | `exit_request`, `full_final_calculation`, `exit_clearance` |
| Status | CONTROLLED_PILOT |
| Readiness | BLOCKED |
| Known Gaps | F&F blocked when `is_ff_provisional=1`; 4 compat routers active; `/exit-management` (old) serves different component than `/exit/command-center` |

---

## Domain: Recruitment

### ATS_DASHBOARD — ATS Dashboard

| Field | Value |
|---|---|
| Canonical Route | `/ats/command-center` |
| Legacy Routes | `/ats/dashboard` (Replica), `/ats/dashboard-v2`, `/ats/command-centre` (old spelling) |
| Canonical API | `/api/ats` |
| Legacy APIs | `/api/ats-full-parity`, `/api/ats-ext` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | 4 ATS dashboard variants active simultaneously; `/ats/command-centre` and `/ats/command-center` are separate routes |

---

### CANDIDATE_REGISTRATION — Candidate Registration

| Field | Value |
|---|---|
| Canonical Route | `/interview-registration` |
| Legacy Routes | `/candidate-registration` → redirect, `/walkin-registration` → redirect, `/ats/candidate-registration` → **DIRECT DUPLICATE (not a redirect)** |
| Canonical API | `/api/ats/registration` |
| Status | PRODUCTION |
| Readiness | READY |
| Known Gaps | `/ats/candidate-registration` loads the same component directly — not a redirect; could receive independent writes |

---

### CANDIDATE_ONBOARDING — Candidate Onboarding

| Field | Value |
|---|---|
| Canonical Route | `/onboard-full` |
| Legacy Routes | `/onboard` (old 3-step form), `/onboard-full-legacy` (CandidateOnboardingV2 — for existing tokens), `/onboard-v1` (duplicate of canonical), `/candidate-onboarding-full` (duplicate of canonical) |
| Canonical API | `/api/candidate/onboarding` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | `/candidate-onboarding-full` and `/onboard-v1` are direct duplicates of `/onboard-full`; `/onboard-full-legacy` must stay alive for existing tokens |

---

### BGV — Background Verification

| Field | Value |
|---|---|
| Canonical Route | `/ats/bgv` |
| Legacy Routes | `/ats/bgv-enhanced`, `/ats/bgv-report` |
| Canonical API | `/api/ats/bgv` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | `bgv-enhanced` is a separate page with no clear differentiation from canonical |

---

### JOINING_CONTROL_ROOM — Joining Control Room

| Field | Value |
|---|---|
| Canonical Route | `/ats/joining-control-room` |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### BRANCH_HEAD_APPROVAL — Branch Head Offer Approval

| Field | Value |
|---|---|
| Canonical Route | `/ats/offer-approvals` (NativeBranchHeadApproval — wired to offer submission flow) |
| Legacy Route | `/ats/branch-head-approval` (BranchHeadApproval — uses legacy `ats_branch_head_approval` table) |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Two separate approval tables; pending records in legacy table require reconciliation before removal |

---

## Domain: Workforce

### ATTENDANCE — Attendance

| Field | Value |
|---|---|
| Canonical Route | `/attendance` |
| Canonical API | `/api/wfm` |
| Authoritative Tables | `attendance_record`, `wfm_attendance_session`, `ncosec_raw_punch` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Attendance page still Supabase-backed; WFM MySQL path is separate |

---

### ATTENDANCE_REGULARIZATION — Attendance Regularization

| Field | Value |
|---|---|
| Canonical Route | `/attendance-regularization` |
| Legacy Routes | `/attendance/regularizations` (exact duplicate, same component) |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Two routes resolve to identical component |

---

### LEAVE — Leave Management

| Field | Value |
|---|---|
| Canonical Route | `/leaves` |
| Legacy Routes | `/leave-approvals` → redirect to `/leaves` |
| Canonical API | `/api/leave` |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### WFM — Workforce Management

| Field | Value |
|---|---|
| Canonical Route | `/wfm/roster` |
| Legacy Routes | `/wfm-roster` → redirect |
| Canonical API | `/api/wfm` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Multiple WFM sub-routers ordering-dependent; no endpoint collision test |

---

### ROSTER — Roster Management

| Field | Value |
|---|---|
| Canonical Route | `/wfm/roster` |
| Self-service | `/my-roster` |
| Admin | `/roster-master-builder`, `/roster-capacity-config` |
| Canonical API | `/api/roster-gov` |
| Legacy API | `/api/wfm/roster` |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### BREAK_MANAGEMENT — Break Management

| Field | Value |
|---|---|
| Canonical Route | `/break-desk` |
| Duplicate Routes | `/break-management/devices` + `/wfm/break-desk-devices` (same component) |
| Canonical API | `/api/break-management` |
| Legacy API | `/api/break-desk` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Two device management routes are exact duplicates; two backend routers for same domain |

---

## Domain: Payroll

### PAYROLL — Payroll Administration

| Field | Value |
|---|---|
| Canonical Route | `/payroll` |
| Canonical API | `/api/payroll` |
| Authoritative Tables | `salary_prep_run`, `salary_prep_line`, `salary_package`, `payroll_run_signoff` |
| Roles | super_admin, admin, payroll, payroll_head, payroll_hr, finance |
| Status | CONTROLLED_PILOT |
| Readiness | **BLOCKED** |
| Contains Payroll | YES |
| Known Gaps | 18 separate routers; TDS/LWP/gratuity/advance deduction all require configuration before activation |

---

### EPF_STATUTORY — EPF / Statutory Compliance

| Field | Value |
|---|---|
| Canonical Route | `/compliance/statutory` |
| Legacy Routes | `/payroll/epf-compliance`, `/employees/:id/epf-compliance` |
| Status | CONTROLLED_PILOT |
| Readiness | PARTIAL |

---

## Domain: Performance

### PERFORMANCE — Performance Management

| Field | Value |
|---|---|
| Canonical Route | `/performance` |
| Legacy Routes | `/reviews-management` → redirect, `/goals` → redirect |
| Status | BETA |
| Readiness | PARTIAL |

---

### QUALITY_DASHBOARD — Quality Dashboard

| Field | Value |
|---|---|
| Canonical Route | `/quality/dashboard` |
| Duplicate Route | `/quality/audit` (same component) |
| Canonical API | `/api/quality-dashboard` |
| Status | BETA |
| Readiness | PARTIAL |

---

## Domain: Learning

### LMS_INTEGRATION — LMS Integration

| Field | Value |
|---|---|
| Canonical Route | `/lms/my-learning` |
| Legacy Routes | `/lms` → redirect, `/lms/management-dashboard` → redirect |
| Canonical API | `/api/lms` |
| Status | BETA |
| Readiness | PARTIAL |
| Note | Integration-only. Deployed LMS is the system of record. No rebuild. |

---

## Domain: Employee Experience

### ASSETS — Asset Management

| Field | Value |
|---|---|
| Canonical Route | `/assets-manager` (MySQL-backed) |
| Legacy Route | `/assets` (Supabase-backed — still active) |
| Canonical API | `/api/assets-mgmt` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | Two coexisting pages with different backends — migration path pending |

---

### DOCUMENTS — Employee Documents

| Field | Value |
|---|---|
| Canonical Route | `/document-verification` |
| Canonical API | `/api/employee-docs` |
| Status | PRODUCTION |
| Readiness | PARTIAL |
| Known Gaps | No secure short-lived token preview; full document vault not built |

---

### HELPDESK — Helpdesk

| Field | Value |
|---|---|
| Canonical Route | `/helpdesk` |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### GRIEVANCE — Grievance Management

| Field | Value |
|---|---|
| Canonical Route | `/support/grievance-command-center` |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### ENGAGEMENT — Employee Engagement

| Field | Value |
|---|---|
| Canonical Route | `/engagement` |
| Legacy Routes | `/engagement/command-center` → redirect to `/people-experience/command-center` |
| Status | BETA |
| Readiness | PARTIAL |

---

## Domain: Finance

### FINANCE — Finance (P&L, GRN, Vendors)

| Field | Value |
|---|---|
| Canonical Route | `/finance/process-pnl` |
| Status | BETA |
| Readiness | PARTIAL |

---

### ERP — ERP Extensions

| Field | Value |
|---|---|
| Canonical Route | `/erp` |
| Status | PLANNED |
| Readiness | UNVERIFIED |

---

## Domain: External Portals

### CLIENT_PORTAL — Client Portal

| Field | Value |
|---|---|
| Canonical Route | `/portal` |
| Canonical API | `/api/portal` |
| Authoritative Tables | `client_user`, `portal_otp`, `portal_access_log`, `portal_published_data` |
| Status | CONTROLLED_PILOT |
| Readiness | PARTIAL |
| Note | Process-scoped isolation enforced at both controller and service layer |

---

## Domain: Platform

### VISITOR_MANAGEMENT — Visitor Management

| Field | Value |
|---|---|
| Canonical Route | `/visitor/management` |
| Status | BETA |
| Readiness | PARTIAL |

---

### REPORTING — Reports Center

| Field | Value |
|---|---|
| Canonical Route | `/reports` |
| Legacy Routes | `/master-reports` → redirect, `/advanced-reports` → redirect, `/reports/enterprise` → redirect |
| Status | PRODUCTION |
| Readiness | PARTIAL |

---

### COMPLIANCE — Compliance (Statutory / Labour / DPDP)

| Field | Value |
|---|---|
| Canonical Route | `/compliance/statutory` |
| Status | CONTROLLED_PILOT |
| Readiness | PARTIAL |

---

### AI_COPILOT — PeopleOS Copilot

| Field | Value |
|---|---|
| Canonical Route | `/peopleos/copilot` |
| Status | BETA |
| Readiness | PARTIAL |
| Known Gaps | Not yet role-aware or source-backed; no policy enforcement |

---

### INTEGRATION_HUB — Integration Hub

| Field | Value |
|---|---|
| Canonical Route | `/integration-hub` |
| Status | BETA |
| Readiness | PARTIAL |

---

### MIGRATION_CONSOLE — Migration Console

| Field | Value |
|---|---|
| Canonical Route | `/migration-console` |
| Status | BETA |
| Readiness | PARTIAL |

---

## Duplicate Route Declarations (Confirmed)

| Route | Duplicate Of | Action Required |
|---|---|---|
| `/ats/walkin-queue` line 461 | `/ats/walkin-queue` line 643 | **Remove one declaration** |
| `/attendance/regularizations` | `/attendance-regularization` | Keep one, redirect other |
| `/ats/candidate-registration` | `/interview-registration` | Convert to redirect |
| `/candidate-onboarding-full` | `/onboard-full` | Convert to redirect |
| `/onboard-v1` | `/onboard-full` | Convert to redirect |
| `/ats/recruiter/calling-entry` | `/ats/recruiter/hiring-entry` | Consolidate |
| `/ats/recruiter/calling-dashboard` | `/ats/recruiter/hiring-dashboard` | Consolidate |
| `/hr-onboarding-requests` | `/ats/onboarding-requests` | Convert to redirect |
| `/break-management/devices` | `/wfm/break-desk-devices` | Choose one canonical, redirect other |
| `/quality/audit` | `/quality/dashboard` | Convert to redirect |
| `/ats/payroll-hr` | `/ats/payroll-hr-validation` | Choose one canonical |
| `/provisioning/wfm-alignment`, `/provisioning/it`, `/provisioning/admin`, `/provisioning/appointment-letter`, `/it-provisioning` | Same component — 5 variants | Consolidate with query params or tabs |

---

*End of Module and Journey Registry*
