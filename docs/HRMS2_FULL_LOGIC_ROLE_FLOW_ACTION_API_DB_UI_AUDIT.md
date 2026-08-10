# HRMS2 Full Logic / Role / Flow / Action / API / DB / UI Audit

**Date:** 2026-06-25 | **Auditor:** Claude Code (automated static audit)
**Scope:** App.tsx routes, backend app.ts mounts, middleware, and 14 key route files.

---

## Legend

| Status | Meaning |
|--------|---------|
| Working | Route exists, backend wired, auth/role enforced, DB tables referenced |
| Partial | Route exists but missing auth, role gap, DB table unverified, or UI placeholder |
| Missing | Frontend route exists, backend not mounted or service not implemented |
| Broken | Wiring mismatch, wrong pageCode, duplicate route, or security hole confirmed |
| Risky | Works but has a known security/data integrity risk |

---

## 1. Authentication / Login

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Auth/Login | Email+password login | /auth, /login | AuthClean | Submit | POST /api/auth/login | POST /api/auth/login | auth.routes.ts | auth.service.ts | users, user_roles | None (public) | None | None | N/A | No | No | Working | — | — | — |
| Auth/Login | Token verification | Internal | requireAuth | — | Bearer header | requireAuth middleware | authMiddleware.ts | auth.service.verifyAccessToken | users | JWT | Any | — | N/A | No | No | Working | Demo bypass enabled via INTERNAL_DEMO_BYPASS=true; demo tokens hardcoded in DEMO_TOKEN_MAP | Remove demo bypass in production | P1 |
| Auth/Login | Demo bypass | Internal | — | — | mock-token-* | DEMO_TOKEN_MAP | authMiddleware.ts | — | — | Env flag | super_admin | — | ORG_ALL | No | No | Risky | Demo tokens exist for 13 roles; bypass only disabled when NODE_ENV=production AND INTERNAL_DEMO_BYPASS!=true | Ensure INTERNAL_DEMO_BYPASS=false in prod | P1 |

---

## 2. Password Change Flow

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| ChangePassword | Force password change | /change-password | ChangePassword | Submit | POST /api/auth/change-password | Mounted at /api/auth | auth.routes.ts | auth.service.ts | users | requireAuth | Any | — | N/A | No | No | Working | ProtectedRoute enforces redirect if mustChangePassword=true; works correctly | — | — |
| ResetPassword | Forgot password reset | /reset-password | ResetPassword | Submit | POST /api/auth/reset-password | Mounted at /api/auth | password-reset.routes.ts | tempPassword.service.ts | users, password_reset_tokens | None (public) | None | — | N/A | No | No | Partial | Route is public; SMS/email integration required; need to verify token expiry logic | Verify token expiry in tempPassword.service.ts | P2 |

---

## 3. 2FA Flow

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| TwoFactor | TOTP/OTP verification | /two-factor | TwoFactor | Submit OTP | POST /api/auth/2fa/verify | Mounted at /api/auth | auth.routes.ts | twoFactor.service.ts | users, org_settings | requireAuth | Any | — | N/A | No | No | Partial | ProtectedRoute correctly redirects when twoFactorRequired=true AND !twoFactorVerified; global 2FA toggle in org_settings exists (commit 630a196) | Need to verify org_settings 2FA column is read on every login | P2 |
| TwoFactor | Global 2FA disable | /settings | Settings | Org Settings toggle | PATCH /api/org/settings | /api/org/settings | org_settings.routes.ts | — | org_settings | requireAuth | admin | — | ORG_ALL | Yes | No | Working | Global toggle added in 2a37fb0 | — | — |

---

## 4. ProtectedRoute Role Checks

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| ProtectedRoute | Auth guard | All protected routes | ProtectedRoute | — | GET /api/employees/status (employeeStatus) | useEmployeeStatus hook | employee.routes.ts | — | employees | requireAuth | — | — | N/A | No | No | Working | — | — | — |
| ProtectedRoute | Role gate | Routes with roles=[] prop | ProtectedRoute | — | GET /api/employees/my-roles (roleKeys) | useIsAdminOrHR hook | employee.routes.ts | — | user_roles | requireAuth | roles prop | — | N/A | No | No | Working | Role alias expansion (manager↔process_manager, tl↔team_leader) only in backend requireRole; frontend roleKeys check uses raw keys | Ensure frontend alias expansion matches backend | P2 |
| ProtectedRoute | Non-employee lock | All routes except /dashboard | ProtectedRoute | — | useEmployeeStatus | — | — | — | employees | requireAuth | — | — | N/A | No | No | Partial | Non-employees who are non-admin/HR are locked to /dashboard only; legitimate HR-role users without employee records can be blocked | Check isAdminOrHR hook scope covers all HR role variants | P2 |
| WorkforcePageGate | Page-level access control | Routes wrapped in Gate | WorkforcePageGate | — | GET /api/access/page-access/:pageCode | Not confirmed | access.routes.ts | — | workforce_page_access | requireAuth | Depends on pageCode | pageCode | Depends | No | No | Partial | /governance/tat-matrix, /governance/tat-dashboard, /ats/name-consistency, /letters/appointment-esign, /exit/resignation* all render NativePlaceholderPage — no dedicated UI components built | Build dedicated UI or mark pages as coming-soon | P1 |

---

## 5. WorkforcePageGate pageCodes

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| PageGate | TAT Matrix | /governance/tat-matrix | NativePlaceholderPage | None | GET /api/governance/tat/matrix | /api/governance/tat/matrix | tat.routes.ts | tat.service.ts | tat_matrix_master | requireAuth | admin/hr | TAT_MATRIX | ORG_ALL | No | No | Broken | Route renders placeholder instead of a real UI component | Build TAT matrix UI component | P1 |
| PageGate | TAT Dashboard | /governance/tat-dashboard | NativePlaceholderPage | None | GET /api/governance/tat/dashboard | /api/governance/tat/dashboard | tat.routes.ts | — | task_tat_instance | requireAuth | admin/hr | TAT_DASHBOARD | ORG_ALL | No | No | Broken | Route renders placeholder | Build TAT dashboard UI | P2 |
| PageGate | Name Consistency | /ats/name-consistency | NativePlaceholderPage | None | GET /api/ats/name-consistency | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary | requireAuth | admin/hr | NAME_CONSISTENCY_MATRIX | ORG_ALL | Yes | No | Broken | Route renders placeholder; backend is fully implemented | Build name consistency UI | P1 |
| PageGate | Appointment E-sign | /letters/appointment-esign | NativePlaceholderPage | None | GET /api/letters/appointment/* | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr | APPOINTMENT_ESIGN | ORG_ALL | Yes | No | Broken | Route renders placeholder; backend fully implemented | Build appointment e-sign UI | P1 |
| PageGate | Resignation My Request | /exit/resignation | NativePlaceholderPage | None | GET /api/exit/resignation/my | /api/exit/resignation | resignation.routes.ts | — | resignation_discussion | requireAuth | Any employee | RESIGNATION_MY_REQUEST | SELF_ONLY | No | No | Broken | Route renders placeholder | Build employee resignation UI | P1 |
| PageGate | Resignation Command Center | /exit/resignation-command-center | NativePlaceholderPage | None | GET /api/exit/resignation | /api/exit/resignation | resignation.routes.ts | — | resignation_discussion | requireAuth | admin/hr/manager | RESIGNATION_COMMAND_CENTER | ORG_ALL | No | No | Broken | Route renders placeholder | Build resignation command center UI | P1 |

---

## 6. Candidate Onboarding /onboard-full

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| CandidateOnboarding | 10-step form (V2 / primary) | /onboard-full | CandidateOnboardingV2 | Next/Prev/Submit | POST /api/ats/onboard/* | /api/ats | ats.routes.ts | ats.enhanced.service.ts | candidate_onboarding_profile, ats_candidate | token-based (no JWT) | None (public) | None | N/A | No | No | Working | Primary path is CandidateOnboardingV2; legacy CandidateOnboardingFullPage at /onboard-full-legacy | — | — |
| CandidateOnboarding | Legacy 10-step (legacy path) | /onboard-full-legacy | CandidateOnboardingFullPage | Next/Prev/Submit | POST /api/ats/onboard/* | /api/ats | ats.routes.ts | ats.enhanced.service.ts | candidate_onboarding_profile | token-based | None | None | N/A | No | No | Partial | Steps 1-10 cover: Welcome, Personal, Address/KYC, Documents, BGV, Bank, Education, Experience/Lang, Statutory. Family/nominees step not verified in file; autosave via useOnboardingFull hook | Confirm family/nominees step exists in useOnboardingFull | P2 |
| CandidateOnboarding | OTP verification | /onboard-full | — | Verify OTP button | POST /api/ats/onboard/verify-otp | /api/ats | ats.routes.ts | ats.enhanced.service.ts | candidate_onboarding_otp | token-based | None | None | N/A | No | No | Partial | OTP service referenced in hook; SMS integration required | Verify OTP service wiring end-to-end | P2 |
| CandidateOnboarding | Blocker enforcement | Internal | useOnboardingFull | — | GET /api/ats/name-consistency/:id | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary | token-based | None | None | N/A | No | No | Partial | blocks_employee_code=1 enforced at DB level; blocker enforcement in UI not confirmed | Verify UI blocks progression when blocks_employee_code=1 | P1 |
| CandidateOnboarding | Migration SQL gap | /onboard-full | — | — | — | — | — | — | 289_candidate_onboarding_full_field_parity.sql | — | — | — | — | — | — | Risky | SQL file exists as unexecuted migration (in git status ??); 289 fields listed as gap — not yet applied | Apply migration to staging first then production | P1 |

---

## 7. Dashboard System (role-specific)

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Dashboard | CEO dashboard | /ceo/dashboard | CeoDashboard | Drilldown cards | GET /api/dashboards/CEO/metric-values | /api/dashboards | dashboard.routes.ts | dashboard-metric.service.ts | dashboard_metric_catalog, dashboard_role_metric_config, dashboard_metric_snapshot | requireAuth | ceo | CEO_DASHBOARD | ORG_ALL | No | Yes (work_item) | Partial | Drilldown service exists (getDrilldown); metric catalog tables must be seeded; snapshot generation not automated | Seed dashboard_metric_catalog; add cron for snapshot generation | P1 |
| Dashboard | PayrollHR dashboard | /payroll-hr/dashboard | PayrollHrDashboard | — | GET /api/dashboards/PAYROLL_HR/metric-values | /api/dashboards | dashboard.routes.ts | dashboard-metric.service.ts | dashboard_metric_catalog | requireAuth | payroll_hr/hr | PAYROLL_HR_DASHBOARD | ORG_ALL | No | Yes | Partial | Same seed dependency as CEO | Seed metric catalog | P1 |
| Dashboard | WFM dashboard | /wfm/dashboard | WfmDashboard | — | GET /api/dashboards/WFM/metric-values | /api/dashboards | dashboard.routes.ts | dashboard-metric.service.ts | dashboard_metric_catalog | requireAuth | wfm | WFM_DASHBOARD | PROCESS_ALL | No | Yes | Partial | Same seed dependency | Seed metric catalog | P1 |
| Dashboard | HR dashboard | /hr/dashboard | HrDashboard | — | GET /api/dashboards/HR/metric-values | /api/dashboards | dashboard.routes.ts | dashboard-metric.service.ts | dashboard_metric_catalog | requireAuth | hr | HR_DASHBOARD | BRANCH_ALL | No | Yes | Partial | Same seed dependency | Seed metric catalog | P1 |
| Dashboard | Employee self dashboard | /my-dashboard | EmployeeSelfDashboard | — | GET /api/dashboards/EMPLOYEE/summary | /api/dashboards | dashboard.routes.ts | — | work_item | requireAuth | employee | EMPLOYEE_SELF_DASHBOARD | SELF_ONLY | No | Yes | Partial | Role="employee" resolves to SELF_ONLY; SELF_ONLY buildScopeWhere uses employee_id=userId which may not match employees.id | See item 8 below | P1 |
| Dashboard | Drilldown | All dashboards | — | Click metric card | GET /api/dashboards/:code/metric/:code/drilldown | /api/dashboards | dashboard.routes.ts | dashboard-drilldown.service.ts | Depends on metric | requireAuth | Any | Depends | Depends | No | No | Working | getDrilldown service exists; correctness depends on metric implementations | — | — |
| Dashboard | Trend | All dashboards | — | Trend chart | GET /api/dashboards/:code/metric/:code/trend | /api/dashboards | dashboard.routes.ts | — | dashboard_metric_snapshot | requireAuth | Any | Depends | Depends | No | No | Partial | Returns empty until snapshots are populated by scheduled job | Add snapshot job | P2 |
| Dashboard | Root causes | All dashboards | — | Root cause panel | GET /api/dashboards/:code/root-causes | /api/dashboards | dashboard.routes.ts | — | task_tat_instance, candidate_name_match_summary, ats_onboarding_bridge | requireAuth | Any | — | — | No | No | Working | Queries three domains; queries may return empty if tables have no data | Seed test data | P3 |

---

## 8. Dashboard Scope (SELF_ONLY bug)

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| DashboardScope | Role→scope resolution | Internal | — | — | Internal | resolveDashboardScope | dashboardScope.ts | — | user_roles, employees | requireAuth | All | — | All | No | No | Working | Role-to-scope mapping implemented; ORG_ALL_ROLES does not include plain "hr" — branch HR falls through to SELF_ONLY | Add "hr", "hr_admin", "recruitment_hr" to BRANCH_ALL_ROLES or ORG_ALL_ROLES as appropriate | P1 |
| DashboardScope | SELF_ONLY WHERE clause | Internal | — | — | Internal | buildScopeWhere | dashboardScope.ts | — | employees | requireAuth | employee/agent/trainee | — | SELF_ONLY | No | No | Risky | buildScopeWhere for SELF_ONLY generates `employee_id = ?` with params=[scope.userId] which is the auth user_id, NOT the employee primary key — metric queries using employees.id will return 0 rows | Fix: join employees to get id from auth_user_id before applying scope, or use buildScopeWhereEmployees (which uses e.auth_user_id) consistently | P1 |
| DashboardScope | CUSTOM_SCOPE fallback | Internal | — | — | Internal | buildScopeWhere | dashboardScope.ts | — | — | requireAuth | Any | — | CUSTOM_SCOPE | No | No | Risky | CUSTOM_SCOPE defaults to 1=1 (full access) with a console.warn — this is an over-permissive fallback | Change CUSTOM_SCOPE default to 1=0 or require explicit handler | P1 |
| DashboardScope | dashboard.routes.ts role extraction | Internal | — | — | Internal | (user as any).role | dashboard.routes.ts | — | — | requireAuth | All | — | — | No | No | Risky | role is extracted as `(user as any).role ?? "employee"` — authUser object from requireAuth only has id/email/isDemo; role is never set on authUser; always falls through to "employee" string; resolveDashboardScope will always return SELF_ONLY for authenticated users except demo super-admin | Fix: load role from DB in requireAuth or in dashboard routes via requireRole | P1 |

---

## 9. Work Inbox

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| WorkInbox | My items | /work-inbox | NativeWorkInbox | — | GET /api/work-inbox/my | /api/work-inbox | work-inbox.routes.ts | work-inbox.service.ts | work_item | requireAuth | Any | WORK_INBOX | SELF_ONLY | No | Yes | Partial | Role extracted as `(req.authUser as any).role ?? ""` — same bug as dashboard; role will always be "" | Same fix: load role from DB | P1 |
| WorkInbox | Team items | /work-inbox | NativeWorkInbox | — | GET /api/work-inbox/team | /api/work-inbox | work-inbox.routes.ts | work-inbox.service.ts | work_item | requireAuth | Any | WORK_INBOX | TEAM_ONLY | No | Yes | Partial | getTeamWorkItems only takes userId; no role-based team scope | Add manager/TL scope filtering | P2 |
| WorkInbox | Stats | /work-inbox | — | — | GET /api/work-inbox/stats | /api/work-inbox | work-inbox.routes.ts | work-inbox.service.ts | work_item | requireAuth | Any | — | — | No | No | Partial | Same role extraction bug | Fix role extraction | P1 |
| WorkInbox | Overdue | /work-inbox | — | — | GET /api/work-inbox/overdue | /api/work-inbox | work-inbox.routes.ts | work-inbox.service.ts | work_item | requireAuth | Any | — | — | No | No | Partial | Same role extraction bug | Fix role extraction | P1 |
| WorkInbox | Priority change | /work-inbox | — | Change priority | PATCH /api/work-inbox/:id/priority | /api/work-inbox | work-inbox.routes.ts | — | work_item | requireAuth | admin/hr | — | ORG_ALL | No | No | Working | requireRole("admin","hr") enforced | — | — |
| WorkInbox | Complete | /work-inbox | — | Complete button | POST /api/work-inbox/:id/complete | /api/work-inbox | work-inbox.routes.ts | work-inbox.service.ts | work_item | requireAuth | Any | — | — | No | No | Partial | No ownership check — any authenticated user can complete any work item | Add ownership or role check before completing | P1 |
| WorkInbox | Trigger wiring | Internal | — | — | Various modules create work_item rows | Not confirmed in routes | work-inbox.service.ts | — | work_item | — | — | — | — | No | — | Partial | Work items are consumed by inbox; creation side wiring (what triggers insertion into work_item) not confirmed across all modules | Audit all modules for work_item INSERT calls | P2 |

---

## 10. TAT / Escalation

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| TAT | Matrix CRUD | /governance/tat-matrix | NativePlaceholderPage | None (placeholder) | GET/POST/PUT /api/governance/tat/matrix | /api/governance/tat | tat.routes.ts | tat.service.ts | tat_matrix_master | requireAuth | admin/hr (write) | TAT_MATRIX | ORG_ALL | No | No | Broken | Backend fully implemented; UI is placeholder | Build TAT matrix UI | P1 |
| TAT | Escalation matrix CRUD | — | — | — | GET/POST /api/governance/tat/escalation-matrix | /api/governance/tat | tat.routes.ts | — | escalation_matrix_master | requireAuth | admin/hr | — | ORG_ALL | No | No | Working (API only) | No UI route defined for escalation matrix management | Add /governance/escalation-matrix route | P2 |
| TAT | Task list | /governance/tat-dashboard | NativePlaceholderPage | None | GET /api/governance/tat/tasks | /api/governance/tat | tat.routes.ts | — | task_tat_instance | requireAuth | Any | TAT_DASHBOARD | Unscoped | No | No | Broken | No scope filter on task list — returns up to 200 rows globally regardless of role | Add scope filter; build UI | P1 |
| TAT | Create instance | Internal | — | — | POST /api/governance/tat/tasks | /api/governance/tat | tat.routes.ts | tat.service.ts (createTatInstance) | task_tat_instance, tat_matrix_master | requireAuth | Any | — | — | No | No | Working | createTatInstance looks up TAT hours from tat_matrix_master | — | — |
| TAT | Breach recalc | Admin/HR action | — | Recalculate button | POST /api/governance/tat/tasks/recalculate | /api/governance/tat | tat.routes.ts | tat.service.ts (checkAndEscalate) | task_tat_instance, escalation_matrix_master | requireAuth | admin/hr | — | ORG_ALL | No | No | Working | checkAndEscalate runs escalation logic; no scheduled trigger — must be called manually | Add cron job or call on login | P2 |
| TAT | Complete task | — | — | Complete button | POST /api/governance/tat/tasks/:id/complete | /api/governance/tat | tat.routes.ts | tat.service.ts (completeTatInstance) | task_tat_instance | requireAuth | Any | — | — | No | No | Risky | No ownership check — any authenticated user can complete any TAT task | Add ownership/role check | P1 |

---

## 11. Name Consistency

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| NameConsistency | 8-source match calculation | /ats/name-consistency | NativePlaceholderPage | None (placeholder) | POST /api/ats/name-consistency/:id/recalculate | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_detail, candidate_name_match_summary | requireAuth | Any | NAME_CONSISTENCY_MATRIX | N/A | No | No | Broken | Backend recalculates from: form, aadhaar, PAN, bank, education, employee_master (6 sources confirmed); ATS source and BGV source not yet in recalculate endpoint (spec says 8 sources) | Add ats_source and bgv_source extraction; build UI | P1 |
| NameConsistency | Override request | — | — | Request override | POST /api/ats/name-consistency/:id/override-request | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary, candidate_name_override_audit | requireAuth | admin/hr | — | ORG_ALL | Yes | No | Working | override-request and override-approve both set is_override_approved=1 and clear block — they are functionally identical; two-step redundancy | Clarify if override-request is a request-to-approve vs approve; deduplicate | P2 |
| NameConsistency | Override approve/reject | — | — | Approve/Reject | POST /api/ats/name-consistency/:id/override-approve or /override-reject | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary, candidate_name_override_audit | requireAuth | admin/hr | — | ORG_ALL | Yes | No | Working | Audit log written to candidate_name_override_audit; block correctly toggled | — | — |
| NameConsistency | Blocker enforcement | Internal (onboarding) | — | — | GET /api/ats/name-consistency/:id | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary | requireAuth | Any | — | — | No | No | Partial | blocks_employee_code column used; employee code generation must check this column before issuing employee ID | Verify employee code generator reads blocks_employee_code | P1 |

---

## 12. Incentive Workflow

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Incentives | Masters CRUD | /payroll/incentives | NativeIncentives | Create/Edit master | GET/POST/PUT/DELETE /api/incentives/masters | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_master | requireAuth | admin/hr/finance | PAYROLL_INCENTIVES | ORG_ALL | No | No | Working | Zod validation with CreateIncentiveMasterSchema | — | — |
| Incentives | Batch creation | /payroll/incentives | NativeIncentives | Create batch | POST /api/incentives/batches | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch | requireAuth | admin/hr/finance | PAYROLL_INCENTIVES | ORG_ALL | No | No | Working | — | — | — |
| Incentives | WFM upload / import lines | /payroll/incentives | NativeIncentives | Import CSV | POST /api/incentives/batches/:id/lines/import | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch_line | requireAuth | admin/hr/finance | PAYROLL_INCENTIVES | ORG_ALL | No | No | Working | — | — | — |
| Incentives | Submit for approval (step 0→1) | /payroll/incentives | — | Submit | POST /api/incentives/batches/:id/submit | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch | requireAuth | admin/hr/finance | — | — | No | No | Working | Submits batch; advances to step 1 (branch_head review) | — | — |
| Incentives | 3-tier approval chain | /payroll/incentives | NativeIncentives | Approve/Reject | POST /api/incentives/batches/:id/approve or /reject | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch | requireAuth | admin/finance | — | ORG_ALL | No | No | Partial | approve/reject only guarded by admin/finance — spec says step1=branch_head, step2=operations_head, step3=finance_head; these role distinctions are not enforced in the route guards seen in first 100 lines | Read rest of incentives.routes.ts to confirm step-role enforcement; add requireRole per step | P1 |
| Incentives | Apply to payroll run | /payroll/incentives | — | Apply to run | POST /api/incentives/apply-to-run | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch, payroll_run | requireAuth | admin/finance/payroll | — | ORG_ALL | No | No | Working | Wired to payroll run | — | — |
| Incentives | Register (fully_approved) | /payroll/incentives | — | Register button | Not seen in first 100 lines | /api/incentives | incentives.routes.ts | incentives.service.ts | incentive_batch | requireAuth | admin/finance | — | ORG_ALL | No | No | Partial | "register" action sets status=fully_approved per code comment; endpoint not confirmed in first 100 lines | Read full incentives.routes.ts to confirm /register endpoint | P2 |

---

## 13. Appointment E-sign

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| AppointmentEsign | Create request | /letters/appointment-esign | NativePlaceholderPage | None (placeholder) | POST /api/letters/appointment/:candidateId/create | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | Any | APPOINTMENT_ESIGN | — | Yes | No | Broken | Backend state machine fully implemented; UI is placeholder | Build appointment e-sign UI | P1 |
| AppointmentEsign | Generate letter | — | — | Generate | POST /api/letters/appointment/:id/generate | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr | — | — | Yes | No | Working (API) | templateData required as object body | — | — |
| AppointmentEsign | Candidate e-sign initiate | — | — | Send to candidate | POST /api/letters/appointment/:id/candidate-esign/initiate | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr | — | — | Yes | No | Working (API) | DigiLocker/OTP integration assumed; mock-digilocker.routes.ts exists for dev | — | — |
| AppointmentEsign | Candidate e-sign complete | — | — | Candidate signs | POST /api/letters/appointment/:id/candidate-esign/complete | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | Any | — | — | Yes | No | Risky | signedBy can be overridden by body param — anyone can complete a candidate e-sign for anyone | Enforce: only the candidate's own auth token may complete | P1 |
| AppointmentEsign | Company sign | — | — | Company signs | POST /api/letters/appointment/:id/company-sign/initiate + /complete | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr | — | — | Yes | No | Working (API) | Both steps require admin/hr | — | — |
| AppointmentEsign | Finalize | — | — | Finalize | POST /api/letters/appointment/:id/finalize | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr | — | — | Yes | No | Working (API) | — | — | — |
| AppointmentEsign | Manual override | — | — | Override | POST /api/letters/appointment/:id/manual-override/request + /approve + /reject | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_request | requireAuth | admin/hr (approve/reject) | — | — | Yes | No | Working (API) | — | — | — |
| AppointmentEsign | Audit trail | — | — | View audit | GET /api/letters/appointment/:id/audit | /api/letters | appointment-esign.routes.ts | appointmentEsignService | appointment_esign_audit | requireAuth | admin/hr | — | — | Yes | No | Working (API) | — | — | — |

---

## 14. DPDP Withdrawal

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| DPDPWithdrawal | Submit request | /privacy/dpdp-withdrawal | NativeDPDPWithdrawal | Submit form | POST /api/privacy/dpdp-withdrawal/request | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | Any employee | DPDP_WITHDRAWAL | SELF_ONLY | Yes | No | Working | reason required; scope_json optional | — | — |
| DPDPWithdrawal | My requests | /privacy/dpdp-withdrawal | NativeDPDPWithdrawal | View my requests | GET /api/privacy/dpdp-withdrawal/my-requests | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | Any | — | SELF_ONLY | No | No | Working | — | — | — |
| DPDPWithdrawal | HR admin list | /compliance/dpdp-withdrawal-admin | NativeDPDPWithdrawalAdmin | List all | GET /api/privacy/dpdp-withdrawal | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | hr/admin/compliance/dpo | DPDP_WITHDRAWAL_ADMIN | ORG_ALL | No | No | Working | — | — | — |
| DPDPWithdrawal | Start review (hold) | /compliance/dpdp-withdrawal-admin | — | Start review | POST /api/privacy/dpdp-withdrawal/:id/start-review | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | hr/admin/compliance | — | ORG_ALL | Yes | No | Working | Applies processing hold | — | — |
| DPDPWithdrawal | Approve | — | — | Approve | POST /api/privacy/dpdp-withdrawal/:id/approve | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | hr/admin/compliance/dpo | — | ORG_ALL | Yes | No | Working | — | — | — |
| DPDPWithdrawal | Reject | — | — | Reject | POST /api/privacy/dpdp-withdrawal/:id/reject | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | hr/admin/compliance/dpo | — | ORG_ALL | Yes | No | Working | reason required | — | — |
| DPDPWithdrawal | Release hold | — | — | Release hold | POST /api/privacy/dpdp-withdrawal/:id/release-hold | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | hr/admin | — | ORG_ALL | Yes | No | Working | — | — | — |
| DPDPWithdrawal | GET by id (role check bug) | — | — | View detail | GET /api/privacy/dpdp-withdrawal/:id | /api/privacy | dpdp-withdrawal.routes.ts | dpdp-withdrawal.service.ts | dpdp_withdrawal_request | requireAuth | Any | — | SELF_ONLY/ORG_ALL | No | No | Risky | Role check reads `(req.authUser as any)?.role` — authUser has no role field; isHr will always be false; HR users will only see their own requests, not all | Same root fix: load role from DB | P1 |

---

## 15. Resignation Discussion

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Resignation | Submit resignation | /exit/resignation | NativePlaceholderPage | None (placeholder) | POST /api/exit | /api/exit | exit.routes.ts | exit.controller.ts | exit_request | requireAuth | Any employee | RESIGNATION_MY_REQUEST | SELF_ONLY | No | No | Broken | Frontend is placeholder; POST /api/exit exists and auto-fills employeeId for non-privileged users | Build employee resignation submission UI | P1 |
| Resignation | Manager discussion | — | — | Log manager discussion | POST /api/exit/resignation/:exitId/discussion | /api/exit/resignation | resignation.routes.ts | — | resignation_discussion | requireAuth | admin/hr/manager | — | — | No | No | Working (API) | discussion_type: "manager"\|"hr" | — | — |
| Resignation | HR discussion | — | — | Log HR discussion | POST /api/exit/resignation/:exitId/discussion | /api/exit/resignation | resignation.routes.ts | — | resignation_discussion | requireAuth | admin/hr/manager | — | — | No | No | Working (API) | Same endpoint, different discussion_type | — | — |
| Resignation | Retention action | — | — | Add retention | POST /api/exit/:id/retention | /api/exit | exit.routes.ts | exit-intelligence.service.ts | exit_retention_action | requireAuth | admin/hr/manager | — | — | No | No | Working (API) | actionType: manager_discussion\|counter_offer\|etc | — | — |
| Resignation | Accept/withdraw/close | — | — | Status change | PATCH /api/exit/:id/status | /api/exit | exit.routes.ts | exit.controller.ts | exit_request | requireAuth | admin/hr/manager | — | — | No | No | Working (API) | — | — | — |
| Resignation | Command center | /exit/resignation-command-center | NativePlaceholderPage | None | GET /api/exit/command-center | /api/exit | exit.routes.ts | exit-intelligence.service.ts (getExitCommandCenter) | exit_request, employees | requireAuth | admin/hr/manager/finance/payroll/ceo | RESIGNATION_COMMAND_CENTER | ORG_ALL | No | No | Broken | UI is placeholder | Build command center UI | P1 |

---

## 16. JCR / Payroll HR Readiness (section completion, blockers, JCLR)

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| PayrollHRValidation | JCR section review | /ats/payroll-hr | NativePayrollHRValidation | Approve sections | GET /api/ats/payroll-hr/* | /api/ats | ats.routes.ts | ats.enhanced.service.ts | candidate_onboarding_profile | requireAuth | admin/hr/payroll_hr | ATS_PAYROLL_HR | ORG_ALL | No | No | Partial | Route guarded with roles=["admin","hr","payroll_hr"] in App.tsx AND pageCode=ATS_PAYROLL_HR in Gate; section completion status needs DB-backed tracking | Add section_completion_status table or column | P2 |
| PayrollHRValidation | JCLR fields | /ats/payroll-hr | NativePayrollHRValidation | Fill JCLR fields | POST /api/ats/payroll-hr/jclr | /api/ats | ats.routes.ts | ats.enhanced.service.ts | candidate_onboarding_profile | requireAuth | admin/hr/payroll_hr | ATS_PAYROLL_HR | ORG_ALL | No | No | Partial | JCLR (Joining Confirmation Letter & Release) field set not confirmed in migration 289; may be in gap report | Check 289 migration for JCLR fields | P2 |
| PayrollHRValidation | Blocker display | /ats/payroll-hr | NativePayrollHRValidation | View blockers | GET /api/ats/name-consistency/:id + blocks_employee_code | /api/ats/name-consistency | name-consistency.routes.ts | — | candidate_name_match_summary | requireAuth | admin/hr | — | — | No | No | Partial | Blocker data exists in DB; UI must pull and display | Confirm UI reads blocks_employee_code | P2 |

---

## 17. Employee Master / Profile CRUD

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| EmployeeMaster | List employees | /employees | Employees | List/filter | GET /api/employees | /api/employees | employee.routes.ts | employee.service.ts | employees | requireAuth | admin/hr | EMPLOYEE_MANAGEMENT | BRANCH_ALL/ORG_ALL | No | No | Working | listEndpointLimiter applied | — | — |
| EmployeeMaster | Employee profile | /employees/:id | NativeEmployeeStatCard | View profile | GET /api/employees/:id | /api/employees | employee.routes.ts | employee.service.ts | employees | requireAuth | admin/hr | EMPLOYEE_MANAGEMENT | Row-scoped | No | No | Working | — | — | — |
| EmployeeMaster | 360 view | /employees/:id/360 | NativeEmployee360 | View 360 | GET /api/employees/:id/360 | /api/employees | employee.routes.ts | — | employees, kpi_*, attendance | requireAuth | admin/hr | EMPLOYEE_MANAGEMENT | Row-scoped | No | No | Partial | employee360Router separate mount | — | — |
| EmployeeMaster | Create/edit employee | /employees | Employees | Save | POST/PUT /api/employees | /api/employees | employee.routes.ts | employee.service.ts | employees | requireAuth | admin/hr | EMPLOYEE_MANAGEMENT | ORG_ALL | Yes | No | Working | Zod validation in employee.validation.ts | — | — |
| EmployeeMaster | Self profile | /profile | Profile | View/Edit | GET /api/employees/me | /api/employees | employee.routes.ts | employee.service.ts | employees | requireAuth | Any | None | SELF_ONLY | No | No | Partial | Profile.tsx recently modified (in git status M); may have incomplete fields | Verify all profile fields round-trip correctly | P2 |

---

## 18. Leave Management

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Leave | Apply leave | /leaves | Leaves | Apply | POST /api/leave | /api/leave | leave.routes.ts | leave.service.ts | leave_request, leave_balance | requireAuth | Any employee | None | SELF_ONLY | No | No | Working | — | — | — |
| Leave | Approve/reject | /leaves | Leaves | Approve/Reject | PATCH /api/leave/:id/status | /api/leave | leave.secure.routes.ts | leave.service.ts | leave_request | requireAuth | admin/hr/manager | None | BRANCH_ALL | No | No | Working | leaveSecureRouter mounted before leaveRouter | — | — |
| Leave | Balance check | /leaves | Leaves | — | GET /api/leave/balance | /api/leave | leave.routes.ts | — | leave_balance | requireAuth | Any | None | SELF_ONLY | No | No | Working | — | — | — |
| Leave | Maternity leave | /maternity-leave | NativeMaternityLeave | — | Separate maternity endpoints | /api/leave | leave.routes.ts | — | leave_request | requireAuth | admin/hr | None | ORG_ALL | No | No | Partial | roles prop in App.tsx: ["admin","hr"] only | — | — |

---

## 19. Payroll Readiness

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| PayrollReadiness | Readiness dashboard | /payroll/readiness | NativePayrollReadiness | View status | GET /api/payroll/readiness | /api/payroll/readiness | peopleos.routes.ts (payrollReadinessRouter) | — | payroll_readiness_snapshot | requireAuth | admin/hr/payroll_hr | PAYROLL | ORG_ALL | No | No | Partial | payrollReadinessRouter is a peopleos module; actual DB table names need verification | — | — |
| PayrollReadiness | Statutory config | /payroll/statutory-config | NativeStatutoryConfig | Config slabs | GET/POST /api/payroll/statutory-config | /api/payroll | payroll-statutory-config.compat.routes.ts | — | statutory_config | requireAuth | admin/finance | STATUTORY_CONFIG | ORG_ALL | Yes | No | Working | compat router ensures backward compat | — | — |
| PayrollReadiness | Run payroll | /payroll | Payroll | Run button | POST /api/payroll/run | /api/payroll | payroll.secure.routes.ts | payrollCalculate.service.ts | payroll_run, payroll_lines | requireAuth | admin/finance/payroll | PAYROLL | ORG_ALL | Yes | No | Risky | payrollRunLimiter applied; TDS/LWP/gratuity blocked if statutory_config missing per CLAUDE.md; is_ff_provisional guard exists | CLAUDE.md audit items: reconcile payrollCalculate.service.ts with statutory_config contract | P1 |

---

## 20. Exit / F&F

| Module | Functionality | Frontend Route | Component | Buttons/Actions | Expected API | Actual API | Backend Route File | Service | DB Tables | Auth | Role | PageCode | Scope | Audit Log | Work Item | Status | Issue | Fix Required | Priority |
|--------|--------------|----------------|-----------|-----------------|--------------|------------|-------------------|---------|-----------|------|------|----------|-------|-----------|-----------|--------|-------|--------------|----------|
| Exit | Create exit request | /exit-management | NativeExitManagement | Submit | POST /api/exit | /api/exit | exit.routes.ts | exit.controller.ts | exit_request | requireAuth | Any employee | EXIT_COMMAND_CENTER | SELF_ONLY | No | No | Working | Auto-resolves employeeId for non-privileged users | — | — |
| Exit | List exit requests | /exit/command-center | NativeExitCommandCenter | List/filter | GET /api/exit | /api/exit | exit.routes.ts | exit.controller.ts | exit_request | requireAuth | admin/hr/manager | EXIT_COMMAND_CENTER | ORG_ALL | No | No | Working | — | — | — |
| Exit | Clearance tasks | /exit/command-center | — | View/update clearance | GET/PATCH /api/exit/:id/clearance | /api/exit | exit.routes.ts | — | exit_clearance_task | requireAuth | admin/hr/manager/finance/payroll/wfm | — | Row-scoped | No | No | Working | FIELD() ordering in clearance task query ensures blocked items appear first | — | — |
| Exit | Generate clearance | — | — | Generate tasks | POST /api/exit/:id/clearance/generate | /api/exit | exit.routes.ts | exit-intelligence.service.ts | exit_clearance_task | requireAuth | admin/hr | — | ORG_ALL | No | No | Working | createDefaultClearanceTasks | — | — |
| Exit | Exit interview | — | — | Save interview | POST /api/exit/:id/interview | /api/exit | exit.routes.ts | exit-intelligence.service.ts | exit_interview | requireAuth | admin/hr/manager | — | ORG_ALL | No | No | Working | saveExitInterview | — | — |
| Exit | F&F create | /payroll/full-final | NativeFullFinal | Create F&F | POST /api/exit/ff/:exitRequestId | /api/exit | exit.routes.ts | ff.service.ts | exit_ff, exit_request | requireAuth | admin/hr/finance/payroll | FULL_FINAL | ORG_ALL | Yes | No | Working | logSensitiveAction called on create | — | — |
| Exit | F&F approve | /payroll/full-final | NativeFullFinal | Approve F&F | POST /api/exit/ff/:id/approve | /api/exit | exit.routes.ts | ff.service.ts | exit_ff | requireAuth | admin only | FULL_FINAL | ORG_ALL | Yes | No | Working | Only admin can approve F&F; logSensitiveAction called | — | — |
| Exit | F&F provisional guard | Internal | — | — | exitCompatRouter | /api/exit | exit.compat.routes.ts + ff-approval-guard | ffService | exit_ff | requireAuth | admin | — | — | Yes | No | Working | is_ff_provisional=1 blocks approval per CLAUDE.md | — | — |
| Exit | Duplicate status route | Internal | — | — | POST /:id/status and PATCH /:id/status | /api/exit | exit.routes.ts | exit.controller.ts | exit_request | requireAuth | admin/hr/manager | — | — | No | No | Risky | POST /:id/status handler is registered twice (lines 152-161 both register the same handler) | Remove duplicate route registration | P2 |

---

## Cross-Cutting Issues Summary

| Issue | Affected Modules | Priority |
|-------|-----------------|----------|
| `(req.authUser as any).role` is always undefined — authUser only has id/email/isDemo | Dashboards, WorkInbox, DPDP (HR check), all role-scoped queries | P1 |
| SELF_ONLY `buildScopeWhere` uses auth user_id as employee_id | Dashboard EMPLOYEE scope, any SELF_ONLY metric query | P1 |
| CUSTOM_SCOPE defaults to 1=1 (over-permissive) | dashboardScope.ts | P1 |
| 6 frontend routes render NativePlaceholderPage — backend complete but UI missing | TAT Matrix, TAT Dashboard, Name Consistency, Appointment E-sign, Resignation My Request, Resignation Command Center | P1 |
| Migration 289_candidate_onboarding_full_field_parity.sql not yet applied | Candidate Onboarding | P1 |
| Work item completion has no ownership check | WorkInbox | P1 |
| TAT task completion has no ownership check | TAT/Escalation | P1 |
| Appointment e-sign candidate-sign/complete allows signedBy body override | Appointment E-sign | P1 |
| Dashboard metric catalog tables require seeding before any metric values render | All role dashboards | P1 |
| "hr" role not in BRANCH_ALL_ROLES — plain HR users get SELF_ONLY scope | DashboardScope | P1 |
| Duplicate POST /:id/status registration in exit.routes.ts | Exit | P2 |
| override-request and override-approve are functionally identical in name-consistency | Name Consistency | P2 |
| Trend endpoint returns empty until snapshot cron runs | All dashboards | P2 |
