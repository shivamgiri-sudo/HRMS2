# HRMS2 Auth / Role / Page-Access Matrix
**Generated:** 2026-06-25  
**Scope:** ProtectedRoute.tsx · requireRole.ts · authMiddleware.ts · role.catalog.ts · App.tsx roles props

---

## 1. Middleware Behaviour Summary

### requireRole.ts
- Accepts variadic string args: `requireRole("admin", "hr")` — array handling is correct.
- **super_admin bypass:** yes — any user with `super_admin` in `user_roles` passes every guard unconditionally.
- **Role aliases (bidirectional):** `process_manager ↔ manager`, `team_leader ↔ tl`. Expansion runs on both allowed list and user roles.
- No other aliases are defined; `branch_head`, `wfm`, `finance`, `payroll`, `qa`, `recruiter`, `trainer`, `ceo`, `employee` have no aliases.
- Source of truth: MySQL `user_roles.role_key` with `active_status = 1`.

### ProtectedRoute.tsx
- Receives `roles?: string[]` prop.
- Super-admin bypass: `roleKeys.includes("super_admin")` — correct, mirrors backend.
- `roleKeys` is populated from `/api/access/me` via `useUserRole` → `expandRoleKeys` which applies the same `manager ↔ process_manager`, `tl ↔ team_leader` aliases.
- Non-employee non-admin users are locked to `/dashboard` regardless of role prop (secondary gate).

---

## 2. Role Key Reference

| Role Key (DB / backend) | In AppRole type | In role.catalog.ts | Notes |
|---|---|---|---|
| `super_admin` | yes | yes | Full bypass on both FE and BE |
| `admin` | yes | yes | Full bypass in catalog; not super_admin bypass in BE |
| `hr` | yes | yes | Listed as `hr` everywhere |
| `ceo` | yes | yes | |
| `branch_head` | yes | yes | |
| `process_manager` | yes | yes | Aliased ↔ `manager` |
| `manager` | yes | no (alias only) | Not in catalog; alias for `process_manager` |
| `assistant_manager` | yes | yes | |
| `team_leader` | yes | yes | Aliased ↔ `tl` |
| `tl` | yes | no (alias only) | Not in catalog; alias for `team_leader` |
| `wfm` | yes | yes | |
| `finance` | yes | yes | |
| `payroll` | yes | yes | |
| `qa` | yes | yes | |
| `trainer` | yes | yes | |
| `recruiter` | yes | yes | |
| `employee` | yes | yes | |
| `branch_it` | no | yes | In catalog, not in AppRole type |
| `client_user` | no | yes | Client portal only |
| `mcp_server` | no | yes | No module access |

---

## 3. Roles Requested in Task vs Actual Keys

The task lists these role keys. Status against codebase:

| Requested Role | Actual Key in DB/Backend | Frontend (AppRole) | Status |
|---|---|---|---|
| `super_admin` | `super_admin` | yes | OK |
| `admin` | `admin` | yes | OK |
| `ceo` | `ceo` | yes | OK |
| `management` | **NOT DEFINED** | no | **MISSING — no such role key anywhere** |
| `ho_hr` | **NOT DEFINED** | no | **MISSING — use `hr` instead** |
| `hr_branch` | **NOT DEFINED** | no | **MISSING — use `hr` instead** |
| `branch_head` | `branch_head` | yes | OK |
| `bm` | **NOT DEFINED** | no | **MISSING — no alias defined for `branch_head`** |
| `process_manager` | `process_manager` | yes | OK (alias: `manager`) |
| `team_lead` | **NOT DEFINED** | no | **MISSING — correct key is `team_leader` (alias `tl`)** |
| `wfm_spoc` | **NOT DEFINED** | no | **MISSING — use `wfm` instead** |
| `operations_head` | **NOT DEFINED** | no | **MISSING — no such role key** |
| `finance_head` | **NOT DEFINED** | no | **MISSING — use `finance` instead** |
| `payroll_head` | **NOT DEFINED** | no | **MISSING — use `payroll` instead** |
| `payroll_hr` | **NOT DEFINED** | no | **MISSING — used in FE route but not in catalog/DB** |
| `recruiter` | `recruiter` | yes | OK |
| `employee` | `employee` | yes | OK |
| `agent` | **NOT DEFINED** | no | **MISSING — no role key; content reachable via Gate only** |
| `trainee` | **NOT DEFINED** | no | **MISSING — covered by `employee` or `trainer` depending on context** |

---

## 4. Frontend Role-Protected Routes vs Backend Expected Keys

| Route | FE roles prop | Backend requireRole (if any) | Mismatch? |
|---|---|---|---|
| `/ats/form-config` | `['admin', 'hr']` | none (no dedicated backend route guard shown) | No BE guard — risk |
| `/ats/payroll-hr` | `['admin', 'hr', 'payroll_hr']` | none visible | `payroll_hr` not in catalog; FE-only gate |
| `/ats/bgv-enhanced` | `['admin', 'hr']` | none visible | No BE guard |
| `/super-admin/module-access` | `['admin']` | none (UI admin tool) | OK — admin only |
| `/super-admin/dashboard` | `['admin']` | none | OK |
| `/ats/command-centre` | `['admin', 'manager', 'hr']` | none | `manager` is alias; resolves via FE alias map |
| `/provisioning/wfm-alignment` | `['wfm', 'admin', 'super_admin']` | none | OK |
| `/provisioning/it` | `['it', 'admin', 'super_admin']` | none | **`it` not in catalog or AppRole** |
| `/provisioning/admin` | `['branch_admin', 'hr', 'admin', 'super_admin']` | none | **`branch_admin` not in catalog or AppRole** |
| `/provisioning/appointment-letter` | `['hr', 'admin', 'super_admin']` | none | OK |
| `/security-center` | `['admin', 'ceo', 'hr']` | none | OK |
| `/super-admin/page-access` | `['admin']` | none | OK |
| `/settings/call-centre-config` | `['admin']` | none | OK |
| `/people-experience/command-center` | `['admin','hr','ceo','manager','process_manager','team_leader','tl','branch_head','employee']` | none | OK — broad; both alias forms listed explicitly |
| `/maternity-leave` | `['admin', 'hr']` | none | OK |
| `/payroll/overtime` | `['admin', 'wfm']` | none | OK |
| `/communication/templates` | `['admin', 'hr']` | none | OK |
| `/communication/dispatch` | `['admin', 'hr']` | none | OK |
| `/communication/history` | `['admin', 'hr']` | none | OK |
| `/settings/communication-config` | `['admin']` | none | OK |
| `/migration-console` | `['admin']` | none | OK |
| `/attendance-rules-master` | `['admin', 'hr']` | none | OK |
| `/access/rbac-reconciliation` (API) | — | `requireRole("admin")` | OK |
| `/access/roles/catalog` (API) | — | `requireRole("admin", "hr")` | OK |
| `/access/roles/assign` (API) | — | `requireRole("admin")` | OK — `super_admin` guard for SA assignment |
| `/access/page-access` (API) | — | `requireRole("admin")` | **`super_admin` not in list; passes via DB bypass but not explicit** |

---

## 5. Pages with pageCode but No Role Prop (Gate Only)

These routes use `<Gate pageCode="...">` without a `roles` prop on ProtectedRoute. Access is controlled entirely by `role_page_access` database entries.

Key examples: `/employees`, `/payroll`, `/payroll/payslips`, `/payroll/full-final`, `/payroll/statutory-config`, `/wfm/roster`, `/wfm/live-tracker`, `/lms/*`, `/quality/dashboard`, `/operations/dashboard`, `/management/dashboard`, `/exit/command-center`, `/compliance/*`, `/erp`, `/integration-hub`, `/org-masters`, `/advanced-reports`, `/ceo/dashboard`, `/hr/dashboard`, `/wfm/dashboard`, `/payroll-hr/dashboard`.

These are correctly database-driven. Risk: if the `role_page_access` table has missing seed rows for a role, the user sees nothing and gets no error message (Gate returns blank).

---

## 6. Pages with Role Prop but No pageCode (Role Prop Only)

Access enforced by ProtectedRoute role check alone; no database page-access entry required.

| Route | Roles |
|---|---|
| `/ats/form-config` | admin, hr |
| `/ats/bgv-enhanced` | admin, hr |
| `/super-admin/module-access` | admin |
| `/super-admin/dashboard` | admin |
| `/super-admin/page-access` | admin |
| `/ats/command-centre` | admin, manager, hr |
| `/security-center` | admin, ceo, hr |
| `/settings/call-centre-config` | admin |
| `/maternity-leave` | admin, hr |
| `/payroll/overtime` | admin, wfm |
| `/communication/templates` | admin, hr |
| `/communication/dispatch` | admin, hr |
| `/communication/history` | admin, hr |
| `/settings/communication-config` | admin |
| `/migration-console` | admin |
| `/attendance-rules-master` | admin, hr |
| `/people-experience/command-center` | (broad list) |

These bypass the `role_page_access` table entirely. Audit trail gap: no page access record is written for these visits.

---

## 7. Fix-Required Items

| # | Severity | Issue | Fix |
|---|---|---|---|
| F1 | HIGH | `payroll_hr` used in FE route `/ats/payroll-hr` roles prop but does not exist in `role.catalog.ts`, `user_roles`, or `AppRole` type. Role check always fails for genuine payroll HR users who lack `admin`/`hr`. | Add `payroll_hr` to `role.catalog.ts` ROLES array, `AppRole` type, `ROLE_MODULE_ACCESS`, and provision it in DB. |
| F2 | HIGH | `it` role used in `/provisioning/it` roles prop but is not defined anywhere. Users with IT provisioning responsibility have no FE role key. | Define `branch_it` (already in catalog) as the correct key; change FE prop from `'it'` to `'branch_it'`. |
| F3 | HIGH | `branch_admin` role used in `/provisioning/admin` roles prop but is not defined anywhere. | Remove or replace with `hr` + `admin`; or formally add `branch_admin` to catalog and DB. |
| F4 | MEDIUM | `management`, `ho_hr`, `hr_branch`, `bm`, `wfm_spoc`, `operations_head`, `finance_head`, `payroll_head`, `team_lead`, `agent`, `trainee` are all undefined role keys (listed in task, not in codebase). | Either formally add them to `role.catalog.ts` and DB with appropriate module access, or document which canonical key maps to each conceptual role. |
| F5 | MEDIUM | `ats/form-config`, `/ats/bgv-enhanced`, `/maternity-leave`, `/attendance-rules-master`, `/communication/templates`, `/communication/dispatch`, `/communication/history` have no backend route-level `requireRole` guard visible. FE roles prop is the only gate; backend API endpoints may be callable by any authenticated user. | Audit each page's backend API calls and add `requireRole` to those routes. |
| F6 | MEDIUM | `manager` (alias for `process_manager`) is used in FE role props (`/ats/command-centre`, `/people-experience/command-center`) but is not a real DB role key and is not in `AppRole` type. It works only because `useUserRole.expandRoleKeys` adds it as an alias. If a new developer uses `manager` directly in a backend `requireRole` call it will work due to alias expansion, but it is confusing and undocumented at the DB level. | Add explicit alias documentation to `requireRole.ts` and `AppRole`. Consider normalising to `process_manager` in all FE props. |
| F7 | LOW | `super_admin` is not listed explicitly in most `requireRole(...)` calls (e.g. `requireRole("admin")`). It passes silently via the DB-level `super_admin` bypass check. This is correct behaviour but means code reviewers cannot see super_admin access from the route definition alone. | Document the bypass in a comment on each such route, or accept as architectural decision. |
| F8 | LOW | `/ats/payroll-hr-validation` (line 305) has no roles prop — open to any authenticated employee via Gate only — while `/ats/payroll-hr` (line 304) has `['admin', 'hr', 'payroll_hr']`. Both render the same component. The duplicate route without role prop is a security gap. | Remove `/ats/payroll-hr-validation` or add the same roles prop. |
| F9 | LOW | `useIsAdminOrHR` returns `true` for `super_admin`, `admin`, `hr` — so any non-employee user with one of these roles bypasses the "must be employee to access non-dashboard pages" check. This is intentional but means a newly created `hr` account with no employee record can browse all employee-restricted pages immediately. | Acceptable design decision; document it. |

---

## 8. Data Scope per Role (from ROLE_MODULE_ACCESS)

| Role | Key Modules | Row Scope Source |
|---|---|---|
| `super_admin` | All | None (full) |
| `admin` | All | None (full) |
| `hr` | employees, ats, leave, lifecycle, attendance, lms, kpi, communication | `user_assignment_scope` |
| `ceo` | leadership_dashboard, kpi, performance, reports, wfm_shrinkage | Org-wide read |
| `branch_head` | employees, attendance, wfm_roster, kpi, ats, reports | Branch scope |
| `process_manager` / `manager` | attendance, wfm_roster, kpi, performance, coaching | Process scope |
| `assistant_manager` | attendance, wfm_roster, kpi, performance | Process/team scope |
| `team_leader` / `tl` | attendance, leave, kpi, performance | Team scope |
| `wfm` | attendance, wfm_roster, wfm_rta, wfm_shrinkage | Branch/process scope |
| `finance` | payroll, payslip, tax_declaration, reports | Org-wide |
| `payroll` | payroll, payslip, tax_declaration, reports | Org-wide |
| `qa` | quality, performance, kpi, coaching | Process scope |
| `recruiter` | ats, helpdesk, engagement | ATS scope |
| `trainer` | lms, employees, helpdesk | Assigned batches |
| `employee` | own payslip, leave, attendance, lms, performance | Self only |
| `client_user` | client_portal only | Mapped process/LOB only |
