# HRMS2 role dashboard inventory

## Audit boundary

This inventory traces the dashboard runtime in commit `ae9372b1` plus the access/scope
remediation on branch `codex/dashboard-remediation-access-scope`. It is a source-code
audit. No production database query, write, migration, deployment, PM2 restart, or
Nginx change was performed.

The canonical access source is
`backend/src/shared/dashboardAccessRegistry.ts`. The frontend imports that registry
directly; the backend uses it to authorize every parameterized dashboard endpoint.

## Role, route, page-code, and access matrix

| Display name | Dashboard code | Route | Frontend component | Page code | Permitted roles (aliases normalized) | Assignment scope | Backend handler |
|---|---|---|---|---|---|---|---|
| Super Admin | `SUPER_ADMIN_DASHBOARD` | `/super-admin/dashboard` | `SuperAdminDashboardV2` → `ReferenceRoleDashboard` | `SUPER_ADMIN_DASHBOARD` | super_admin | Organisation | `GET /api/dashboards/:dashboardCode/summary` plus `/api/management/system-dashboard` |
| CEO | `CEO_DASHBOARD` | `/ceo/dashboard` | `CeoDashboard` → `ReferenceRoleDashboard` | `CEO_DASHBOARD` | ceo, coo, management, super_admin | Organisation, branch, process | Dashboard summary plus executive, workforce and P&L APIs |
| HR | `HR_DASHBOARD` | `/hr/dashboard` | `HrDashboard` → `ReferenceRoleDashboard` | `HR_DASHBOARD` | hr, hr_admin, ho_hr, branch_hr, process_hr, super_admin | Organisation, branch, process | Dashboard summary plus ATS APIs |
| WFM | `WFM_DASHBOARD` | `/wfm/dashboard` | `WfmDashboard` → `ReferenceRoleDashboard` | `WFM_DASHBOARD` | wfm, ho_wfm, wfm_spoc, rta, super_admin | Organisation, branch, process | Dashboard summary plus biometric adherence |
| WFM Attendance | `WFM_ATTENDANCE_DASHBOARD` | `/wfm-attendance` | `WfmAttendanceDashboard` → `ReferenceRoleDashboard` | `WFM_ATTENDANCE_DASHBOARD` | wfm, ho_wfm, wfm_spoc, rta, hr, operations_manager, super_admin | Organisation, branch, process, team | Dashboard summary, biometric adherence and COSEC sync status |
| Payroll | `PAYROLL_HR_DASHBOARD` | `/payroll-hr/dashboard` | `PayrollHrDashboard` → `ReferenceRoleDashboard` | `PAYROLL_HR_DASHBOARD` | payroll, payroll_head, payroll_branch, ho_payroll, finance, finance_head, accounts_head, branch_finance, super_admin | Organisation, branch, process | Dashboard summary and payroll operational summary |
| Quality | `QUALITY_DASHBOARD` | `/quality-dashboard` | `QualityDashboardRole` → `ReferenceRoleDashboard` | `QUALITY_DASHBOARD` | qa, quality_analyst, quality_lead, qa_manager, operations_manager, super_admin | Organisation, branch, process, team | Dashboard summary plus quality summary/trend/agents APIs |
| Operations | `OPERATIONS_DASHBOARD` | `/operations-dashboard` | `OperationsDashboardRole` → `ReferenceRoleDashboard` | `OPERATIONS_DASHBOARD` | operations_manager, operations_head, ho_operations, process_manager, branch_head, super_admin | Organisation, branch, process, team | Dashboard summary plus daily operations pulse |
| Recruiter | `RECRUITER_DASHBOARD` | `/recruiter-dashboard` | `RecruiterDashboard` → `ReferenceRoleDashboard` | `RECRUITER_DASHBOARD` | recruiter, hr, hr_admin, ho_hr, super_admin | Organisation, branch, process, custom | Dashboard summary, ATS stats and recruiter hiring dashboard |
| IT Manager | `IT_MANAGER_DASHBOARD` | `/it/dashboard` | `ItManagerDashboard` → `ReferenceRoleDashboard` | `IT_MANAGER_DASHBOARD` | it, branch_it, ho_it, super_admin | Organisation, branch | Dashboard summary plus `/api/provisioning/it/stats` |
| Manager | `MANAGEMENT_DASHBOARD` | `/manager/dashboard` | `ManagerDashboard` → `ReferenceRoleDashboard` | `MANAGEMENT_DASHBOARD` | manager, process_manager, assistant_manager, branch_head, branch_manager, team_leader, super_admin | Branch, process, team | Dashboard summary, workforce, leave and quality APIs |
| My Dashboard | `EMPLOYEE_SELF_DASHBOARD` | `/my-dashboard` | `EmployeeSelfDashboard` / employee V3 layout | `EMPLOYEE_SELF_DASHBOARD` | Any explicitly listed workforce role; not generic admin | Self | Employee summary plus self-only attendance, leave, onboarding, LMS and engagement APIs |

Role aliases are normalized centrally (for example `tl` → `team_leader`,
`ops_manager` → `operations_manager`, and `payroll_hr` → `payroll`). `admin`
has no implicit business-dashboard entitlement. `super_admin` access is explicit
in each definition.

## Shared dashboard engine and states

The active shared engine is `ReferenceRoleDashboard`. It supplies scoped filters,
loading skeletons, per-source error collection, refresh controls, role-specific
composition, and source-specific queries. The former `RoleDashboardV3` duplicate
has been retired; `/dashboard`, direct role routes, and My Dashboard now use the
same engine.

| Capability | Current implementation | Classification |
|---|---|---|
| Loading state | React Query loading state and dashboard skeletons | Correct and verified by source |
| Empty state | Role layouts contain per-panel empty/unavailable rendering | Correct but unverified visually in this PR |
| Error state | Reference engine retains and displays per-source failures | Correct and verified by source |
| Refresh | Manual refresh of active queries; query-specific stale times of 30–60 seconds | Correct and verified by source |
| Export | Registry declares entitlement, but unified API export enforcement is not yet implemented | Placeholder |
| Drill-down | Generic metric drill-down route exists and is entitlement-protected | Correct but unverified against live data |
| Sensitive data | Categories are declared per dashboard in the registry | Correct but field-level masking audit remains |

## Generic metric lineage

All generic dashboard summary metrics are calculated in
`backend/src/modules/dashboards/dashboard-metric.service.ts`. Time-sensitive
attendance expressions use IST (`Asia/Kolkata`, UTC+05:30).

| Metric | Definition (numerator / denominator) | Period | Source tables | Scope/filter | Drill-down | Classification |
|---|---|---|---|---|---|---|
| Active headcount | Count of active employees / n/a | Current | `employees` | Employee, team, branch, process or organisation | Generic metric drill-down | Correct but unverified against live data |
| Required HC | Planned HC, else configured workforce mandate; never active-HC fallback | Today | `wfm_slot_requirement`, `workforce_mandate` | Branch/process; unavailable for team/self when no employee-linked plan exists | Generic metric drill-down | Correct but unverified against live data |
| Available HC | Distinct employees in active attendance sessions / n/a | Today IST | `wfm_attendance_session`, `employees` | Canonical employee/team/branch/process scope | Generic metric drill-down | Correct but unverified against live data |
| Attendance rate | Processed-present employees / processed expected-to-work employees; live biometric count is separate metadata | Today IST | `attendance_daily_record`; live count separately from `wfm_attendance_session` | Canonical employee/team/branch/process scope | Generic metric drill-down | Correct but unverified against live data |
| Onboarding | Submitted + pending bridge rows / n/a | Current | `ats_onboarding_bridge`, `candidate_onboarding_profile` | Branch/process | Generic metric drill-down | Contract mismatch: OTP subquery is not scoped |
| Payroll readiness | Employees with bank and PAN / active employees | Current | `employees` | Canonical employee/team/branch/process scope | Generic metric drill-down | Correct but unverified against live data |
| Incentive queue | Pending upload batches / n/a | Current | `incentive_upload_batch` | Branch/process | Generic metric drill-down | Correct but unverified against live data |
| TAT | Open task instances / n/a | Current | `task_tat_instance` | Branch/process | Generic metric drill-down | Correct but unverified against live data |
| Resignation | Non-completed exit requests / n/a | Current | `exit_request` | Branch/process | Generic metric drill-down | Correct but unverified against live data |
| DPDP requests | Pending consent withdrawal requests / n/a | Current | `dpdp_consent_withdrawal`, `employees` | Employee-linked branch/process | Generic metric drill-down | Correct but unverified against live data |
| Appointment eSign | Pending appointment signature requests / n/a | Current | `appointment_letter_request`, `employees` | Employee-linked branch/process | Generic metric drill-down | Correct but unverified against live data |
| BGV | Pending candidate checks / n/a | Current | `candidate_bgv_check`, `ats_onboarding_bridge` | Branch/process | Generic metric drill-down | Contract mismatch: fallback source has reduced semantics |
| Name mismatch | Mismatch + partial records / n/a | Current | `candidate_name_match_summary`, `ats_onboarding_bridge` | Branch/process | Generic metric drill-down | Correct but unverified against live data |
| Joining document eSign | Pending joining-document signatures / n/a | Current | `employee_joining_document_checklist`, `employees` | Employee-linked branch/process | Generic metric drill-down | Correct but unverified against live data |

Targets and prior-period enrichment come from dashboard target/snapshot services.
Where a target or previous value is absent, the metric remains `null`; comparison
text must not be inferred.

## Scope resolution

| Scope | Resolution | Failure behavior |
|---|---|---|
| Organisation | Explicit organisation-wide role only | No implicit elevation from a broad assignment |
| Branch | Active assignment, employee mapping, or process-derived branch | HTTP 409 `DASHBOARD_SCOPE_NOT_CONFIGURED` when missing |
| Process | Active assignment or employee process mapping | HTTP 409 when missing |
| Team | Recursive direct and indirect reports via `reporting_manager_id` or `manager_id` | Empty hierarchy is a genuine empty team; missing manager employee mapping is HTTP 409 |
| Self | Authenticated user's active employee mapping | Missing mapping is HTTP 409 |
| Custom | Valid requested branch/process narrowed inside the base entitlement | Invalid or out-of-scope filters fail closed as `1=0` |

The same resolved employee IDs can now filter employee master, attendance,
payroll-linked, WFM-linked, and other employee-linked tables. A failed scope never
falls back to organisation-wide access.

## Known remediation remaining

This access/scope PR does not claim all eleven phases complete. The following are
still open and must remain non-production-ready:

- reconciliation of the canonical Zod metric response against staging data;
- reconciliation of role-specific metric selections against business owners;
- complete payroll-run scoping and reconciliation;
- direct audit-record quality calculation and event-based recruiter funnel;
- `RoleDashboardV3` retirement;
- permission-filtered exports and all quick actions;
- twelve-dashboard visual, accessibility, broken-link, performance, and UAT evidence.
