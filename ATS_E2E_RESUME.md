# ATS E2E Audit — Session Resume

> Session: HRMS1 ATS End-to-End Baseline  
> Date: 2026-06-10  
> Commit: `5488cef4805fd5fc41b3b77e9a802ab11b37ed26`  
> Scope: ATS module + directly dependent onboarding / BGV / offer / training flows  

---

## 1. Current Commit

| Property | Value |
|----------|-------|
| **SHA** | `5488cef4805fd5fc41b3b77e9a802ab11b37ed26` |
| **Message** | `fix(backend): SQL LIMIT/OFFSET interpolation for employee list query` |
| **Branch** | `main` |
| **Working tree** | Clean (documentation-only changes pending) |

---

## 2. Baseline Results

### 2.1 Frontend (Root)

| Command | Exit | Errors | Notes |
|---------|------|--------|-------|
| `npm ci` | 0 | 0 | 698 packages, 5 vulns (2 mod, 3 crit) |
| `npx tsc --noEmit` | 0 | 0 | TypeScript clean |
| `npm run test -- --run` | 1 | — | **Script missing** — no frontend unit-test runner configured |
| `npm run build` | 0 | 0 | 12.47s, 4058 modules, 259 PWA entries, ~6.64 MB |

**Frontend Verdict**: Build passes. No unit tests configured. Playwright E2E infra exists (`test:e2e:smoke`).

### 2.2 Backend (`/backend`)

| Command | Exit | Errors | Notes |
|---------|------|--------|-------|
| `npm ci` | 0 | 0 | 313 packages, 0 vulns |
| `npm run typecheck` | 0 | 0 | `tsc --noEmit` clean |
| `npm test -- --run` | 1 | 25 | 1148 total (1067 passed, 25 failed, 56 skipped) |
| `npm run build` | 0 | 0 | `tsc` clean |

**Backend Test Failures** (25 total — all out of ATS scope, preserved as-is):

| File | Count | Pattern |
|------|-------|---------|
| `tests/integrationHub.service.test.ts` | 3 | Integration hub field-map / suggestion / run creation |
| `tests/leave.routes.test.ts` | 4 | Leave request submission & balance (403 vs expected 200/400) |
| `tests/routes.integration.test.ts` | 1 | Health endpoint DB-error mock returns 503 instead of 200 |
| `src/modules/customization/__tests__/customization-api.test.ts` | 17 | All 401 Unauthorized — test JWT/auth middleware mismatch |

**Backend Verdict**: Type-safe, builds clean. 93 % pass rate. No ATS-specific test failures.

---

## 3. Current ATS Routes

### 3.1 Frontend Routes (React Router)

| # | Route | Page Component | Access | Gate Code |
|---|-------|----------------|--------|-----------|
| 1 | `/interview-registration` | `NativeATSCandidateRegistration` | Public | — |
| 2 | `/candidate-registration` | → `/interview-registration` | Public | — |
| 3 | `/walkin-registration` | → `/interview-registration` | Public | — |
| 4 | `/onboard` | `CandidateOnboardingPage` | Public (token) | — |
| 5 | `/onboard-full` | `CandidateOnboardingFullPage` | Public | — |
| 6 | `/ats/dashboard` | `NativeATSDashboardReplica` | Protected | `ATS_DASHBOARD` |
| 7 | `/ats/candidate-registration` | `NativeATSCandidateRegistration` | Protected | — |
| 8 | `/ats/recruiter/my-candidates` | `NativeATSRecruiterDashboard` | Protected | `ATS_RECRUITER_QUEUE` |
| 9 | `/ats/onboarding-bridge` | `NativeATSOnboardingBridge` | Protected | `ATS_ONBOARDING_BRIDGE` |
| 10 | `/ats/waiting-queue` | `NativeATSWaitingQueue` | Protected | `ATS_WAITING_QUEUE` |
| 11 | `/ats/candidate-master` | `NativeATSCandidateMaster` | Protected | `ATS_CANDIDATE_MASTER` |
| 12 | `/ats/recruiter/workspace` | `NativeATSRecruiterWorkspace` | Protected | `ATS_RECRUITER_WORKSPACE` |
| 13 | `/ats/dashboard-v2` | `NativeATSDashboardV2` | Protected | `ATS_DASHBOARD` |
| 14 | `/ats/sourcing-analysis` | `NativeATSSourcingAnalysis` | Protected | `ATS_DASHBOARD` |
| 15 | `/ats/extensions` | `NativeATSExtensions` | Protected | `ATS_EXTENSIONS` |
| 16 | `/ats/form-config` | `NativeATSFormConfig` | Protected | — |
| 17 | `/ats/command-center` | `NativeATSFullParityCommandCenter` | Protected | `ATS_DASHBOARD` |
| 18 | `/ats/onboarding-requests` | `NativeHROnboardingRequests` | Protected | — |
| 19 | `/ats/offer-approvals` | `NativeBranchHeadApproval` | Protected | — |
| 20 | `/ats/bgv` | `NativeBGVVerificationCenter` | Protected | `ATS_BGV` |
| 21 | `/ats/walkin-queue` | `NativeWalkinQueue` | Protected | `ATS_WAITING_QUEUE` |

### 3.2 Backend API Routes ( Express — mounted at `/api/ats` )

| # | Method | Route | Auth | Roles | Notes |
|---|--------|-------|------|-------|-------|
| 1 | POST | `/api/ats/candidates` | None | Public | Self-registration (walk-in) |
| 2 | GET | `/api/ats/candidates` | JWT | admin, hr, recruiter, manager | Scoped list |
| 3 | GET | `/api/ats/candidates/:id` | JWT | admin, hr, recruiter, manager | Detail |
| 4 | PUT | `/api/ats/candidates/:id` | JWT | admin, recruiter | Update |
| 5 | POST | `/api/ats/candidates/:id/move-stage` | JWT | admin, recruiter, manager | Stage transition |
| 6 | GET | `/api/ats/candidates/:id/stage-logs` | JWT | admin, hr, recruiter, manager | Audit trail |
| 7 | POST | `/api/ats/convert/:candidateId` | JWT | admin, hr | Candidate → Employee |
| 8 | POST | `/api/ats/onboarding-bridge` | JWT | admin, hr | Create bridge |
| 9 | PATCH | `/api/ats/onboarding-bridge/:id` | JWT | admin, hr | Update bridge |
| 10 | GET | `/api/ats/sourcing-channels` | JWT | admin, hr, recruiter | Reference data |
| 11 | GET | `/api/ats/stats` | JWT | admin, hr, recruiter, manager | Dashboard stats |
| 12 | GET | `/api/ats/walkin-queue` | JWT | admin, hr, recruiter | Walk-in queue |
| 13 | GET | `/api/ats/waiting-queue` | JWT | admin, hr, recruiter, manager | New/Screening queue |
| 14 | POST | `/api/ats/candidates/:id/upload` | None | Public (1-hr window) | Resume / selfie upload |
| 15 | GET | `/api/ats/onboarding-full/...` | None | Public | Full onboarding (external router) |
| 16 | GET | `/api/ats/bgv/...` | None | Public | BGV verification (external router) |

**Onboarding Sub-Router** (`/api/ats/onboarding`)

| # | Method | Route | Auth | Roles | Notes |
|---|--------|-------|------|-------|-------|
| 17 | GET | `/validate-token` | None | Public | Token validation |
| 18 | POST | `/submit-profile` | None | Public | Profile submission |
| 19 | POST | `/send-token/:candidateId` | JWT | hr, recruiter, admin | Send onboarding token |
| 20 | GET | `/requests` | JWT | hr, recruiter, admin | List onboarding requests |
| 21 | POST | `/calculate-salary` | JWT | hr, recruiter, admin | Salary calculator |
| 22 | POST | `/requests/:id/offer` | JWT | hr, recruiter, admin | Save/submit offer |
| 23 | PATCH | `/requests/:id/offer` | JWT | hr, recruiter, admin | Update offer draft |
| 24 | GET | `/pending-approval` | JWT | branch_head, admin | Pending offer approvals |
| 25 | POST | `/offers/:id/approve` | JWT | branch_head, admin | Approve offer |
| 26 | POST | `/offers/:id/reject` | JWT | branch_head, admin | Reject offer |

**Form-Config Sub-Router** (`/api/ats/form-config` + `/api/ats/recruiters`)

| # | Method | Route | Auth | Roles | Notes |
|---|--------|-------|------|-------|-------|
| 27 | GET | `/form-config/bootstrap` | None | Public | Registration form bootstrap |
| 28 | GET | `/form-config` | JWT | admin, hr | List configs |
| 29 | PUT | `/form-config/fields` | JWT | admin, hr | Update field schema |
| 30 | PUT | `/form-config/:key` | JWT | admin, hr | Update option list |
| 31 | GET | `/recruiters` | JWT | admin, hr | List recruiters |
| 32 | POST | `/recruiters` | JWT | admin, hr | Create recruiter |
| 33 | PATCH | `/recruiters/:id` | JWT | admin, hr | Update recruiter |
| 34 | DELETE | `/recruiters/:id` | JWT | admin, hr | Soft-delete recruiter |

---

## 4. Database Schema (ATS-relevant)

| Migration | Tables / Alterations |
|-----------|----------------------|
| `004_ats.sql` | `ats_sourcing_channel`, `ats_candidate`, `ats_interview_slot`, `ats_candidate_stage_log`, `ats_onboarding_bridge` |
| `054_ats_onboarding_flow.sql` | Alters `ats_candidate` (profile fields), `auth_user` (must_change_password), `ats_onboarding_bridge` (token, approval tracking); new: `ats_onboarding_request`, `ats_employment_offer`, `ats_offer_approval`, `ats_email_log`, `salary_band_master`; alters `employee_salary_snapshot` |

---

## 5. Open Issues (Baseline — No Fixes Applied)

| # | Priority | Description | Location |
|---|----------|-------------|----------|
| 1 | P1 | `GET /api/ats/candidates/:id` does **not** verify row-scope access — any authenticated user with a valid role can read any candidate | `ats.routes.ts:48` |
| 2 | P1 | `GET /api/ats/walkin-queue` and `GET /api/ats/waiting-queue` hard-coded SQL — no branch/process scope injection | `ats.routes.ts:75-100` |
| 3 | P1 | Onboarding token expiry check uses `new Date(row.onboarding_token_expires_at) < new Date()` — timezone risk if server & DB differ | `ats.onboarding.service.ts:84` |
| 4 | P2 | `POST /api/ats/candidates/:id/upload` allows upload without verifying candidate ownership — only time-window check | `ats.routes.ts:135-190` |
| 5 | P2 | `convertCandidateToEmployee` does not verify actor scope on candidate branch before conversion | `ats.convert.service.ts:25` |
| 6 | P2 | `ats_onboarding_request` list in `listOnboardingRequests` accepts `branchId` but caller always passes `undefined` — no scope enforced | `ats.onboarding.service.ts:137` |
| 7 | P2 | `listPendingApprovals` same pattern — `branchId` parameter always `undefined` from router | `ats.onboarding.service.ts:280` |
| 8 | P3 | `ats_email_log` SMTP config silently skips when env missing — acceptable for dev, must fail closed in production | `ats.email.service.ts:41` |
| 9 | P3 | Duplicate `normalizeSourceChannel` logic in both `ats.controller.ts` and `ats.service.ts` — divergence risk | `ats.controller.ts:87`, `ats.service.ts:22` |
| 10 | P3 | Frontend has no `test` script — cannot run unit tests | `package.json` |

---

## 6. Exact Next Task

**Task**: Fix Issue #1 — Add row-scope verification to `GET /api/ats/candidates/:id`.

**Files to Modify**:
1. `backend/src/modules/ats/ats.routes.ts` — wrap `c.getCandidate` with `hasScopedAccess` or reuse scope-filter pattern.
2. `backend/src/modules/ats/ats.controller.ts` — inject scope check before service call.

**Tests to Add**:
1. `backend/tests/ats.routes.test.ts` — manager from Branch A cannot GET candidate from Branch B.
2. `backend/tests/ats.service.test.ts` — verify `getCandidate` throws when scoped out.

**Next Command**:
```bash
cd HRMS1-ats-e2e/backend
npx vitest run tests/ats.routes.test.ts
```

---

## 7. Preservation Rules

- **Employee fixes**: Do not modify `employees`, `leave`, `attendance`, `payroll` modules.
- **Admin fixes**: Do not modify `scopeAccess.ts` default `allowAdminBypass` logic unless explicitly requested.
- **Manager fixes**: Do not modify `management`, `performance-feedback`, `wfm` modules.
- **No secrets**: Do not commit `.env` or any SMTP/credential values.

---

## 8. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial ATS E2E baseline |

---

**AUDIT STATUS**: 🟡 Baseline Recorded — Ready to Fix  
**NEXT ACTION**: Fix Issue #1 — Scope verification on candidate detail  
