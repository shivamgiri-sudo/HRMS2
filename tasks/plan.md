# Implementation Plan: Role Page RBAC Cleanup

## Overview
Users are seeing irrelevant pages because page access is currently split across three sources: live `role_page_access` grants, sidebar `roles` arrays, and route-level `ProtectedRoute roles`. The live read-only audit also shows broad grants, especially `admin` with 127 pages across ATS, Payroll, HR, WFM, Finance, Quality, and dashboards. The fix should make `page_code` permissions the canonical source for business pages, keep `super_admin` broad, and make `admin` a system/config role unless explicitly assigned business access.

## Evidence From Planning Audit
- `/api/access/me` is the frontend RBAC source and resolves pages from `role_page_access` plus user overrides.
- `WorkforcePageGate` enforces page-code access correctly when routes use it.
- `ProtectedRoute roles` can still allow direct route access without page permission.
- `navConfig.tsx` still contains many hard-coded role lists, including business pages granted to `admin`.
- Live DB read-only audit shows no uncataloged grants, but many over-broad cataloged grants.

## Architecture Decisions
- Use `page_catalog.page_code` plus `role_page_access` as the canonical role-to-page contract for all business pages.
- Preserve `super_admin` as full access.
- Treat `admin` as system administration/access/configuration, not automatic access to HR, ATS, Payroll, Finance, WFM, Quality, or role dashboards.
- Use role arrays only as secondary scope constraints where a page genuinely has role-only behavior; they must not grant business pages by themselves.
- Make demo access derive from the same least-privilege matrix so local testing matches production RBAC.
- Apply live DB cleanup through an idempotent migration or reviewed SQL script, not one-off manual deletes.

## Role Page Matrix Target
- `employee`, `agent`, `trainee`: self-service profile, attendance self, leave self, payslip/tax self, my expenses, learning, engagement, resignation, DPDP withdrawal, work inbox where applicable.
- `manager`, `process_manager`, `assistant_manager`, `team_leader`, `tl`, `branch_head`: team pages, approvals, team attendance/roster, manager dashboard, scoped reports, PIP/goals, operational views needed for their teams.
- `hr`, `hr_admin`, `branch_hr`, `hr_branch`, `ho_hr`, `hr_head`: employee lifecycle, ATS/onboarding, HR dashboard, attendance lookup, leaves, compliance/letters, HR reports.
- `recruiter`, `recruitment_hr`, `interviewer`: ATS recruiter/interview pages and recruiter dashboard only; no payroll, finance, WFM, or broad HR admin unless separately granted.
- `wfm`, `wfm_spoc`, `ho_wfm`, `rta`: WFM roster/live tracker/attendance exceptions/RTA/WFM dashboard; no ATS, payroll, HR admin, or finance pages unless explicitly approved.
- `payroll`, `payroll_head`, `payroll_branch`, `payroll_hr`: payroll, statutory, payslip, payroll readiness, payroll dashboard; no finance P&L or ATS except onboarding/payroll validation where required.
- `finance`, `finance_head`, `accounts_head`: finance P&L, branch budget, GRN/vendor, finance expense queue/reports; payroll cost/signoff only where finance approval is required.
- `qa`, `quality`, `quality_analyst`, `quality_lead`, `qa_manager`: quality dashboards, call audits, quality reports, agent/team quality views.
- `operations`, `operations_manager`, `operations_head`, `coo`: operations dashboards, process/client operational views, business action queues, scoped executive operations reports.
- `ceo`, `management`: executive read-only dashboards and reports; no transactional HR/payroll/finance edit pages by default.
- `admin`: access control, settings, integrations, audit/security, catalog/configuration tools only.
- `super_admin`: all active pages.

## Task List

### Phase 1: Build the Canonical Contract
- [ ] Task 1: Add a typed role-page matrix module.
- [ ] Task 2: Add a read-only RBAC audit script that compares live DB grants to the matrix.
- [ ] Task 3: Generate a dry-run report of pages to keep, add, and revoke per role.

### Checkpoint: Matrix Review
- [ ] Review the proposed revokes/additions before any DB write.
- [ ] Confirm any business exceptions, especially Finance vs Payroll and HR vs Recruiter boundaries.

### Phase 2: Enforce the Contract in the App
- [ ] Task 4: Update sidebar filtering to prefer `pageCode` and remove broad business-role fallbacks.
- [ ] Task 5: Add missing `pageCode` gates to business routes that are currently role-only or auth-only.
- [ ] Task 6: Align demo credentials to the canonical matrix.

### Checkpoint: App Enforcement
- [ ] Typecheck frontend and backend.
- [ ] Run RBAC contract tests.
- [ ] Browser-smoke admin, employee, HR, WFM, finance, payroll, manager, and recruiter menus plus direct URLs.

### Phase 3: Clean Live Grants
- [ ] Task 7: Create an idempotent SQL migration that soft-disables irrelevant `role_page_access` rows and inserts missing approved rows.
- [ ] Task 8: Apply migration to the real database only after approval.
- [ ] Task 9: Re-run live audit and browser smoke tests against the real dashboard.

### Checkpoint: Launch Ready
- [ ] No role sees pages outside the agreed matrix in sidebar, My Modules, direct routes, or `/api/access/me`.
- [ ] Sensitive page families are denied to unrelated roles: Payroll, Finance, ATS, employee master, WFM, dashboards, access control.
- [ ] Builds and targeted tests pass.

## Risks and Mitigations
| Risk | Impact | Mitigation |
|------|--------|------------|
| Existing users rely on accidental broad grants | High | Dry-run report and explicit approval before live revokes |
| Route has no page code, so DB cleanup hides menu but direct URL still opens | High | Add `WorkforcePageGate` coverage before DB cleanup |
| User-specific overrides intentionally grant exceptions | Medium | Preserve `user_page_access`; audit separately instead of deleting |
| `admin` role is used as business admin in some departments | Medium | Replace broad `admin` with department roles or direct user overrides |
| Demo login differs from production | Medium | Generate demo pages from the same matrix |

## Open Questions
- Should `admin` be strictly system-only, or should it keep any business pages during transition?
- Should `finance` see payroll signoff/cost pages, or should that stay with `payroll_head` plus explicit approval roles?
- Should `ceo` get read-only sensitive payroll/finance pages, or only aggregated executive dashboards?
