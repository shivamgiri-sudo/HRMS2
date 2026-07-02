# HRMS2 Production Error Audit
**Date:** 2026-06-25 | **Auditor:** Code audit of live source files

---

## 1. Login / Auth Issues

| Issue | File | Root Cause | Fix | Priority |
|-------|------|-----------|-----|----------|
| Demo users have no `role` set on `req.authUser` | `authMiddleware.ts:66` | `req.authUser = { id, email, isDemo: true }` — no `role` field; downstream code that reads `req.authUser.role` gets `undefined` | Populate `role` from `DEMO_TOKEN_MAP` token key suffix OR accept that `requireRole` handles demo via `isDemo` flag | High |
| `requireRole` uses `active_status = 1` but `roleResolver.ts` uses `is_active = 1` on same `user_roles` table | `requireRole.ts:45` vs `roleResolver.ts:21` | Schema has `active_status` (not `is_active`); `roleResolver.ts` fallback to `user_roles` always returns 0 rows | Fix `roleResolver.ts:21` — change `is_active = 1` to `active_status = 1` | Critical |
| `roleResolver.ts` third fallback queries `employees WHERE auth_user_id = ?` but employees table has `user_id` not `auth_user_id` | `roleResolver.ts:39` | Column mismatch — fallback always returns 0 rows, forcing default `'employee'` role for all employees | Change `auth_user_id` to `user_id` in the fallback query | Critical |
| `dashboardScope.ts` queries `employees WHERE auth_user_id = ?` (branch/process assignment fallback) | `dashboardScope.ts:81,106,116` | Same column mismatch as above; branch/process scope resolution silently returns empty arrays, causing BRANCH_ALL/PROCESS_ALL roles to downgrade to SELF_ONLY | Replace `auth_user_id` with `user_id` in all three scope fallback queries | Critical |

---

## 2. Page Access Issues

| Page | PageCode | Role Missing | Fix | Priority |
|------|---------|-------------|-----|----------|
| `/ats/payroll-hr` | `ATS_PAYROLL_HR` | Route has `roles={['admin','hr','payroll_hr']}` but backend role key is `payroll_hr` which may not match user_roles entries if seeded differently | Verify `payroll_hr` key exists in `workforce_role_catalog`; seed if missing | High |
| `/ats/command-centre` | — | `ProtectedRoute roles={['admin','manager','hr']}` — does not include `recruiter`, `branch_head`, `ceo` but `commandCentreRouter` allows them | Align frontend roles prop to match backend: add `recruiter`, `branch_head`, `ceo`, `wfm`, `finance`, `payroll`, `trainer`, `qa` | Medium |
| `/ats/offer-approvals` | `ATS_OFFER_APPROVALS` | No `roles` prop on `ProtectedRoute`; relies solely on `Gate` page code check | `NativeBranchHeadApproval` calls `/api/ats/onboarding/pending-approval` — route not found (no mount); add roles guard | High |
| `/ats/branch-head-approval` | `ATS_BRANCH_HEAD_APPROVAL` | `BranchHeadApproval` calls `/api/ats/branch-head-approval/*` which is unmounted | Mount `branchHeadApprovalRouter`; add roles `['admin','branch_head','manager']` to ProtectedRoute | Critical |
| `/ats/payroll-hr-validation` | `ATS_PAYROLL_HR` | Duplicate route for same page as `/ats/payroll-hr` without `roles` prop — security gap | Either remove duplicate or add `roles={['admin','hr','payroll_hr']}` | Medium |

---

## 3. Role Mismatch

| API | Expected Role | Current Check | Fix | Priority |
|-----|--------------|---------------|-----|----------|
| `GET /api/ats/candidates` | `hr`, `recruiter`, `manager` | `requireRole("admin","hr","recruiter","manager")` — misses `branch_head`, `ceo`, `process_manager` who legitimately view candidates | Add `branch_head`, `ceo` to allowed roles | Medium |
| `PUT /api/ats/candidates/:id` | `hr`, `recruiter` | `requireRole("admin","recruiter")` — HR cannot edit candidate directly | Add `hr` to the PUT guard | Medium |
| `POST /api/ats/convert/:candidateId` | `hr` | `requireRole("admin","hr")` — `payroll_hr` should also be able to trigger conversion post-validation | Add `payroll_hr` | Low |
| `payrollHRRouter` | `hr`, `payroll_hr` | `requireRole('admin','hr','payroll_hr')` — correct, but router is **never mounted** | Mount at `/api/ats/payroll-hr` in `app.ts` | Critical |
| `commandCentreRouter` | Management/supervisory | `requireRole(...)` correct — but router is **never mounted** | Mount at `/api/ats/command-centre` in `app.ts` | Critical |
| `branchHeadApprovalRouter` | `admin`, `manager`, `branch_head` | Correct check — but router is **never mounted** | Mount at `/api/ats/branch-head-approval` in `app.ts` | Critical |
| `bgvEnhancedRouter` | — | Never mounted | Mount at `/api/ats/bgv-enhanced` in `app.ts` | Critical |
| `candidatePortalRouter` | — | Never mounted | Mount at `/api/ats/candidate-portal` in `app.ts` | Critical |
| `superAdminRouter` | `super_admin` | Never mounted | Mount at `/api/ats/super-admin` in `app.ts` | Critical |

---

## 4. Button Click Failures

| Page | Button | API Called | Error | Fix | Priority |
|------|--------|-----------|-------|-----|----------|
| `NativePayrollHRValidation` | Load pending candidates | `GET /api/ats/payroll-hr/pending-candidates` | 404 Not Found — router not mounted | Mount `payrollHRRouter` at `/api/ats/payroll-hr` in `app.ts` | Critical |
| `NativePayrollHRValidation` | Calculate breakdown | `POST /api/ats/payroll-hr/calculate-breakdown` | 404 Not Found | Same fix | Critical |
| `NativePayrollHRValidation` | Submit validation | `POST /api/ats/payroll-hr/validate` | 404 Not Found | Same fix | Critical |
| `ATSCommandCentre` | Load dashboard | `GET /api/ats/command-centre/metrics` | 404 Not Found | Mount `commandCentreRouter` at `/api/ats/command-centre` in `app.ts` | Critical |
| `ATSCommandCentre` | Timeline, branches, recruiters tabs | Multiple `GET /api/ats/command-centre/*` | 404 Not Found | Same fix | Critical |
| `BranchHeadApproval` | Load pending | `GET /api/ats/branch-head-approval/pending` | 404 Not Found | Mount `branchHeadApprovalRouter` | Critical |
| `BranchHeadApproval` | Approve / Reject | `POST /api/ats/branch-head-approval/process` | 404 Not Found | Same fix | Critical |
| `NativeBGVEnhanced` | Load BGV queue | `GET /api/ats/bgv-enhanced/pending` | 404 Not Found | Mount `bgvEnhancedRouter` | Critical |
| `SuperAdminModuleAccess` | Load modules | `GET /api/ats/super-admin/modules` | 404 Not Found | Mount `superAdminRouter` | Critical |
| `CandidatePortalDashboard` | Load profile | `GET /api/ats/candidate-portal/profile` | 404 Not Found | Mount `candidatePortalRouter` | Critical |
| `NativeATSOnboardingBridge` | Load bridge list | `GET /api/ats/onboarding-bridge` | 404 Not Found — only POST and PATCH exist; no GET route defined | Add `atsRouter.get("/onboarding-bridge", requireRole("admin","hr"), h(c.listOnboardingBridges.bind(c)))` | Critical |
| `NativeBranchHeadApproval` | Load pending offers | `GET /api/ats/onboarding/pending-approval` | 404 — not found under `/api/ats/onboarding/*` | Verify or add route in `ats.onboarding.routes.ts`; or redirect page to use `branchHeadApprovalRouter` | High |

---

## 5. API Endpoint Failures

| Page | API | HTTP Status | Error | Fix | Priority |
|------|-----|------------|-------|-----|----------|
| All ATS payroll validation flows | `POST /api/ats/payroll-hr/validate` | 404 | Router `payrollHRRouter` defined in `payroll-hr.routes.ts` but not imported or mounted in `app.ts` | Add `import { payrollHRRouter } from "./modules/ats/payroll-hr.routes.js"` and `app.use("/api/ats/payroll-hr", payrollHRRouter)` | Critical |
| All ATS command centre dashboards | `GET /api/ats/command-centre/*` | 404 | Same — `commandCentreRouter` orphaned | Add `import { commandCentreRouter }` and `app.use("/api/ats/command-centre", commandCentreRouter)` | Critical |
| Branch head approval flow | `GET /api/ats/branch-head-approval/pending` | 404 | `branchHeadApprovalRouter` orphaned | Mount at `/api/ats/branch-head-approval` | Critical |
| BGV Enhanced | `GET /api/ats/bgv-enhanced/pending` | 404 | `bgvEnhancedRouter` orphaned | Mount at `/api/ats/bgv-enhanced` | Critical |
| Super Admin Module Access | `GET /api/ats/super-admin/modules` | 404 | `superAdminRouter` orphaned | Mount at `/api/ats/super-admin` | Critical |
| Candidate Portal | `GET /api/ats/candidate-portal/profile` | 404 | `candidatePortalRouter` orphaned | Mount at `/api/ats/candidate-portal` | Critical |
| `GET /api/ats/payroll-hr/validated-candidates` | (same router, once mounted) | Wrong data | Routes calls `getPendingCandidates()` instead of a separate `getValidatedCandidates()` function | Implement `getValidatedCandidates()` that filters `phr.validation_status = 'validated'` | Medium |

---

## 6. DB Column Errors

| Service File | SQL Query | Wrong Column | Actual Column | Fix | Priority |
|-------------|----------|-------------|--------------|-----|----------|
| `payroll-hr.service.ts:364` | `getValidationRecord` JOIN to `department_master dept` | `dept.department_name` | `dept.dept_name` (schema `001_core_org.sql:40`) | Change `dept.department_name` → `dept.dept_name` in SELECT | High |
| `roleResolver.ts:21` | `SELECT role_key FROM user_roles WHERE user_id = ? AND is_active = 1` | `is_active` | `active_status` (schema `003_access_control.sql:5`) | Change `is_active` → `active_status` | Critical |
| `roleResolver.ts:39` | `SELECT role FROM employees WHERE auth_user_id = ?` | `auth_user_id` | `user_id` (schema `002_employees.sql:7`) | Change `auth_user_id` → `user_id` | Critical |
| `dashboardScope.ts:81,106,116` | `SELECT … FROM employees WHERE auth_user_id = ?` | `auth_user_id` | `user_id` | Change all three occurrences to `user_id` | Critical |
| `payroll-hr.service.ts:303-309` | `UPDATE ats_candidate SET candidate_status = 'pending_approval'` | `candidate_status` | Column not defined in `004_ats.sql` base schema; only an index CREATE exists in `138_ats_complete_journey.sql` | Add `ALTER TABLE ats_candidate ADD COLUMN candidate_status VARCHAR(100) NULL` migration before using the column | Critical |
| `payroll-hr.service.ts:96` | `WHERE LOWER(COALESCE(c.final_decision, c.status, c.current_stage, '')) = 'selected'` | `c.final_decision`, `c.status` | `final_decision` is on `ats_interview_submission`, not `ats_candidate`; `status` is not a column on `ats_candidate` | Join to `ats_interview_submission` for `final_decision`, or add the column to `ats_candidate` | High |

---

## 7. Missing Tables

| Table | Required By | Fix | Priority |
|-------|------------|-----|----------|
| `candidate_onboarding_otp` | `onboarding-full.routes.ts` OTP send/verify | Defined in migration `289_candidate_onboarding_full_field_parity.sql` — run migration | High |
| `candidate_onboarding_autosave` | `onboarding-full.routes.ts` autosave route | Same migration `289` | High |
| `employee_branch_assignment` | `dashboardScope.ts:77` — queried for BRANCH_ALL scope | Not found in any migration SQL; no `CREATE TABLE` exists | Create migration: table with `user_id`, `branch_id`, `is_active` columns | High |
| `employee_process_assignment` | `dashboardScope.ts:101` — queried for PROCESS_ALL scope | Not found in any migration SQL | Create migration alongside `employee_branch_assignment` | High |
| `salary_exception_proposal` | `payroll-hr.routes.ts:127` POST `/salary-proposal` | Defined in `267_lifecycle_completion_surfaces.sql` — run if not applied | High |

---

## 8. ATS Status Machine Gaps

| Current States | Missing States | Risk | Priority |
|---------------|---------------|------|----------|
| `ats_candidate.current_stage` uses free-text VARCHAR with only `'Applied'` default | No ENUM constraint; `payroll_validated`, `pending_approval`, `employee_created` set in service code but not validated | Any typo creates silent invalid state; queries on current_stage fail silently | Convert to ENUM or add CHECK constraint; add migration | High |
| `ats_branch_head_approval` in migration `141` has `approval_status ENUM('approved','rejected')` with no `'pending'` state | `'pending'` state | Service code (`payroll-hr.service.ts:314`) inserts `'pending'` — MySQL rejects with enum violation | Migration `138` has the correct ENUM `('pending','approved','rejected','sent_back')` — need to reconcile with `141` migration which has truncated ENUM | Critical |
| `ats_branch_head_approval` has no `UNIQUE KEY` on `candidate_id` | Needed for `ON DUPLICATE KEY UPDATE` in `payroll-hr.service.ts:311` | `ON DUPLICATE KEY` clause never triggers; re-running validation always inserts duplicate approval rows | Add `UNIQUE KEY uq_candidate_approval (candidate_id)` to table | High |
| No backend state transition for `selected → bgv_pending → bgv_verified → payroll_validated → approval_pending → employee` | States partially implemented in separate tables | No single source of truth for candidate lifecycle stage | Implement canonical state machine in `ats_candidate.current_stage` with enforced transitions | Medium |

---

## 9. Onboarding Field Gaps

| Field | Required | Present | Section | Fix | Priority |
|-------|---------|---------|---------|-----|----------|
| `otp_verified` flag on `candidate_onboarding_profile` | Yes — set by OTP verify route | Column present in migration `289` | OTP verification | Run migration `289` | High |
| `otp_mobile` on `candidate_onboarding_profile` | Set on OTP verify | Present in `289` | OTP verification | Run migration `289` | High |
| `salary_start_date` on `ats_payroll_hr_validation` | Optional, defaults to joining_date | Present in migration `139` | Payroll HR | Verify migration `139` applied | Medium |
| Family members bulk replace | Token-based | Route present at `POST /onboarding-full/family-members` using `saveFamilyMembers` | Family | Verify `candidate_onboarding_family_member` table exists | Medium |
| Nominee bulk replace | Token-based | Route present at `POST /onboarding-full/nominees` using `saveNominees` | Nominees | Verify `candidate_onboarding_nominee` table exists | Medium |
| Section completion tracking | Needed for UI progress bar | Route present at `PUT /onboarding-full/section-status` using `updateSectionStatus` | All | Verify `candidate_onboarding_section_status` table exists | Medium |
| GET `/api/ats/onboarding-bridge` | Required by `NativeATSOnboardingBridge` page | MISSING — only POST and PATCH exist in `ats.routes.ts` | Bridge | Add GET route wired to `c.listOnboardingBridges` in `ats.routes.ts` | Critical |

---

## 10. Payroll HR / JCLR Blockers

| Gate | Required Field | Present | Fix | Priority |
|------|--------------|---------|-----|----------|
| Candidate eligible for payroll validation | `final_decision = 'selected'` | `c.final_decision` does not exist on `ats_candidate`; `COALESCE` falls through to `current_stage` which is unlikely to equal `'selected'` | Fix query to join `ats_interview_submission.final_decision` or add `final_decision` column to `ats_candidate` | Critical |
| Salary validation transaction | `candidate_status` column update | `ats_candidate.candidate_status` column not in schema; UPDATE fails with MySQL unknown column error | Add column via migration before service goes live | Critical |
| Branch ID resolution in `validateAndAssignSalary` | `applied_for_branch` must match a `branch_master` row | `LEFT JOIN` used — query succeeds even if no branch matches, then throws `'branch_id must exist'` error | Change to INNER JOIN or validate before query | Medium |
| Salary exception proposal | `salary_exception_proposal` table | Defined in migration `267` — unconfirmed if applied | Run migration `267`; add check in service | High |
| Branch head notified for approval | `portal_notification` table | Defined in migration `138` — check applied | Verify `portal_notification` applied | Medium |
| `calculateSalaryBreakdown` — hardcoded PF 12%, ESIC 0.75% | `statutory_config` table should be the source | Hardcoded values — violates charter: "TDS/LWP blocked until approved effective-dated config" | Block payroll activation; wire PF/ESIC rates to `statutory_config` | High |
| `/api/ats/payroll-hr/*` endpoints all return 404 | Router not mounted | All payroll-HR validation buttons non-functional | Mount `payrollHRRouter` in `app.ts` | Critical |

---

## 11. Employee Code Gate Gaps

| Gate Check | Currently Enforced | Fix | Priority |
|------------|------------------|-----|----------|
| Duplicate `employee_code` check on creation | `employee.service.ts:77-80` queries for duplicate before insert | Enforced correctly | None |
| `employee_code` uniqueness at DB level | `employees` table has UNIQUE on `employee_code` (inferred from service check) | Enforce at DB level if not already a UNIQUE KEY in schema | Verify in `002_employees.sql` |  Low |
| Employee code only generated after Branch Head approval | `branchHeadApprovalRouter POST /process` handles generation — but router not mounted | Gate exists in code but unreachable | Mount `branchHeadApprovalRouter` | Critical |
| Candidate-to-employee conversion blocked until BGV + payroll validation complete | `convertCandidateToEmployee` function exists but does not check `ats_payroll_hr_validation.validation_status` | No gate enforced — conversion can be triggered by HR without payroll validation | Add pre-check: `SELECT id FROM ats_payroll_hr_validation WHERE candidate_id = ? AND validation_status = 'validated'` | High |
| Auth user created for employee on conversion | `createAuthUserForEmployee` called in `employee.service.ts` | Implemented; assigns `employee` role from `workforce_role_catalog` if present | Verify `workforce_role_catalog` has `employee` role seeded | Medium |

---

## 12. Approval Flow Misalignment

| Workflow | Expected Approver | Actual | Fix | Priority |
|---------|-----------------|--------|-----|----------|
| Salary validation → Branch Head approval | `payroll_hr` validates → notifies branch head → branch head approves → employee code generated | `notifyBranchHeadForApproval` inserts to `ats_branch_head_approval` but uses plain INSERT (no UNIQUE constraint check) — duplicate rows inserted on retry | Add `UNIQUE KEY uq_candidate_approval (candidate_id)` to `ats_branch_head_approval` table | High |
| Branch Head approval action | Branch head approves via `branchHeadApprovalRouter POST /process` | Router unmounted — approval button returns 404 | Mount router | Critical |
| `ats_branch_head_approval.approval_status` ENUM mismatch | Migration `138` has `('pending','approved','rejected','sent_back')` | Migration `141` overwrites with `('approved','rejected')` — removes `'pending'` and `'sent_back'` | Reconcile: keep migration `138` ENUM definition; make `141` not redefine the ENUM | Critical |
| Payroll HR → Branch Head notification | `payrollHRRouter POST /notify-branch-head` should create approval record | Router unmounted; notification never sent | Mount router | Critical |
| Employee creation approval chain | Payroll HR validates → Branch Head approves → Employee code generated → Auth user created | Steps 1-2 broken (unmounted routers); step 4 (`createAuthUserForEmployee`) works but never reached | Fix all upstream blockers first | Critical |

---

## Summary: Critical Blockers (Must Fix Before Go-Live)

1. **6 ATS routers unmounted** — `payrollHRRouter`, `commandCentreRouter`, `branchHeadApprovalRouter`, `bgvEnhancedRouter`, `candidatePortalRouter`, `superAdminRouter` — all defined, never imported in `app.ts`. Every button on those pages returns 404.
2. **`candidate_status` column missing** from `ats_candidate` — the `UPDATE` in `validateAndAssignSalary` fails with MySQL unknown column error.
3. **`is_active` vs `active_status`** in `roleResolver.ts` — role fallback always returns `'employee'`, breaking scope resolution for all non-`user_roles`-seeded users.
4. **`auth_user_id` vs `user_id`** in `roleResolver.ts` and `dashboardScope.ts` — branch/process scope always degrades to SELF_ONLY.
5. **`ats_branch_head_approval` ENUM mismatch** between migration `138` and `141` — `'pending'` status not allowed in `141` schema.
6. **GET `/api/ats/onboarding-bridge` missing** — `NativeATSOnboardingBridge` page loads blank.
7. **`dept.department_name`** should be **`dept.dept_name`** in `getValidationRecord` — SQL error on validation record fetch.
