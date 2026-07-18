# Route Deprecation Register

> Branch: `refactor/peopleos-enterprise-convergence` | 2026-07-18
>
> Purpose: Track every legacy or duplicate route, its canonical replacement, migration requirements, and removal prerequisites.
>
> Status values: `REDIRECT_ACTIVE` | `DUPLICATE_REMOVE` | `PENDING_MIGRATION` | `LEGACY_LIVE` | `PROTECTED`

---

## Critical: Exact Duplicate Declarations (must fix before Package 2)

| Legacy Route | Canonical Route | Same Data Tables | Active Records | Migration Required | Current Status | Removal Prerequisite |
|---|---|---|---|---|---|---|
| `/ats/walkin-queue` (App.tsx line 643) | `/ats/walkin-queue` (App.tsx line 461) | YES | YES | NO | **DUPLICATE_REMOVE** | Remove second declaration immediately — same path, same component |

---

## Duplicates Loading Same Component (Convert to Redirect)

| Legacy Route | Canonical Route | Same Data Tables | Migration Required | Current Status | Removal Prerequisite | Target Release |
|---|---|---|---|---|---|---|
| `/attendance/regularizations` | `/attendance-regularization` | YES | NO | DUPLICATE_REMOVE | None — safe redirect | Package 2 |
| `/ats/candidate-registration` | `/interview-registration` | YES | NO | DUPLICATE_REMOVE | Verify no external links use this path | Package 2 |
| `/candidate-onboarding-full` | `/onboard-full` | YES | NO | DUPLICATE_REMOVE | Verify no token emails reference this path | Package 2 |
| `/onboard-v1` | `/onboard-full` | YES | NO | DUPLICATE_REMOVE | None | Package 2 |
| `/ats/recruiter/calling-entry` | `/ats/recruiter/hiring-entry` | YES | NO | DUPLICATE_REMOVE | Update any bookmarks/nav links | Package 2 |
| `/ats/recruiter/calling-dashboard` | `/ats/recruiter/hiring-dashboard` | YES | NO | DUPLICATE_REMOVE | Update nav links | Package 2 |
| `/hr-onboarding-requests` | `/ats/onboarding-requests` | YES | NO | DUPLICATE_REMOVE | None | Package 2 |
| `/break-management/devices` | `/wfm/break-desk-devices` | YES | NO | DUPLICATE_REMOVE | Choose canonical; update nav | Package 2 |
| `/quality/audit` | `/quality/dashboard` | YES | NO | DUPLICATE_REMOVE | None | Package 2 |
| `/ats/payroll-hr` | `/ats/payroll-hr-validation` | YES | NO | DUPLICATE_REMOVE | Update nav references | Package 2 |
| `/provisioning/wfm-alignment` | Consolidate into `/it-provisioning?type=wfm` | YES | NO | REFACTOR | Consolidate 5 provisioning routes with tab/query param | Package 2 |
| `/provisioning/it` | Consolidate into `/it-provisioning?type=it` | YES | NO | REFACTOR | Same | Package 2 |
| `/provisioning/admin` | Consolidate into `/it-provisioning?type=admin` | YES | NO | REFACTOR | Same | Package 2 |
| `/provisioning/appointment-letter` | Consolidate into `/it-provisioning?type=letter` | YES | NO | REFACTOR | Same | Package 2 |

---

## Already Redirecting (Confirmed Safe)

| Legacy Route | Redirects To | Status |
|---|---|---|
| `/candidate-registration` | `/interview-registration` | REDIRECT_ACTIVE ✓ |
| `/walkin-registration` | `/interview-registration` | REDIRECT_ACTIVE ✓ |
| `/leave-approvals` | `/leaves` | REDIRECT_ACTIVE ✓ |
| `/wfm-roster` | `/wfm/roster` | REDIRECT_ACTIVE ✓ |
| `/onboarding-requests` | `/onboarding?tab=requests` | REDIRECT_ACTIVE ✓ |
| `/reports/enterprise` | `/reports` | REDIRECT_ACTIVE ✓ |
| `/master-reports` | `/reports` | REDIRECT_ACTIVE ✓ |
| `/advanced-reports` | `/reports` | REDIRECT_ACTIVE ✓ |
| `/goals` | `/performance` | REDIRECT_ACTIVE ✓ |
| `/lms` | `/lms/my-learning` | REDIRECT_ACTIVE ✓ |
| `/lms/management-dashboard` | `/lms/admin` | REDIRECT_ACTIVE ✓ |
| `/reviews-management` | `/performance-feedback/assignments` | REDIRECT_ACTIVE ✓ |
| `/engagement/command-center` | `/people-experience/command-center` | REDIRECT_ACTIVE ✓ |
| `/management/ceo-command-center` | `/ceo/dashboard` | REDIRECT_ACTIVE ✓ |

---

## Parallel Journeys Using Different Tables (DO NOT MERGE blindly)

| Legacy Route | Canonical Route | Different Tables | Existing Active Records | Migration Plan Required | Status |
|---|---|---|---|---|---|
| `/ats/branch-head-approval` (BranchHeadApproval) | `/ats/offer-approvals` (NativeBranchHeadApproval) | YES — `ats_branch_head_approval` vs `ats_hiring_entry` | **UNKNOWN — verify count** | YES — pending record reconciliation, canonical write path migration | LEGACY_LIVE / PROTECTED |
| `/employee-lifecycle` (NativeLifecycle) | `/employee-lifecycle-v2` (NativeEmployeeLifecycle) | Needs investigation | UNKNOWN | YES if different tables | LEGACY_LIVE |
| `/ats/dashboard` (NativeATSDashboardReplica) | `/ats/command-center` (NativeATSFullParityCommandCenter) | Possibly different query shapes | YES | Consolidate to single data source | LEGACY_LIVE |
| `/assets` (Supabase) | `/assets-manager` (MySQL) | YES — Supabase vs MySQL | YES | Migration console path — deferred | PROTECTED |
| `/attendance` (Supabase-backed) | WFM MySQL attendance path | YES | YES | Convergence deferred | PROTECTED |

---

## Legacy Onboarding Route

| Route | Component | Active Tokens | Status | Removal Prerequisite |
|---|---|---|---|---|
| `/onboard-full-legacy` | `CandidateOnboardingV2` | POSSIBLY YES — old email tokens | PROTECTED | Expire all old tokens + verify zero active resume sessions; audit token table |

---

## Backend Router Compat Debt

| Compat Router | Mounted At | Purpose | Removal Prerequisite | Priority |
|---|---|---|---|---|
| `payrollStatutoryConfigCompatRouter` | `/api/payroll` | Legacy statutory config endpoints | Verify no frontend calls remain | MEDIUM |
| `payrollLinesCompatRouter` | `/api/payroll` | Legacy lines endpoints | Verify no frontend calls remain | MEDIUM |
| `exitCompatRouter` | `/api/exit` | Legacy exit endpoints | Verify no frontend calls remain | MEDIUM |
| `ffApprovalGuardCompatRouter` | `/api/exit` | Legacy F&F guard | Verify no frontend calls remain | MEDIUM |
| `exitStatusGuardCompatRouter` | `/api/exit` | Legacy status guard | Verify no frontend calls remain | MEDIUM |
| `atsFullParityRouter` | `/api/ats-full-parity` | Legacy parity router | Verify all features in canonical ATS router | LOW |
| `clientRouter` (catch-all) | `/api` | Generic client/portal handler | Move specific routes; remove catch-all | HIGH |

---

*End of Route Deprecation Register*
