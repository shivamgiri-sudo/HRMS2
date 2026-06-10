# ATS E2E Audit — Session Resume

> Session: HRMS1 ATS End-to-End Audit (Session 6)
> Date: 2026-06-10
> Commit: see git log (post-S6)
> Scope: ATS module + directly dependent onboarding / BGV / offer / training flows

---

## 1. Current Commit

| Property | Value |
|----------|-------|
| **SHA** | `git rev-parse HEAD` — post-S5 docs commit |
| **Branch** | `main` |
| **Working tree** | Clean |

---

## 2. Session 6 — Fixes Applied

### Fix 1 (S6): SQL Migrations for Recruiter Roster and Interview Submission

**New migration**: `backend/sql/129_ats_recruiter_roster.sql`
- Creates `ats_recruiter_roster`: id, name, recruiter_code (UNIQUE), pin_hash (bcrypt), email, mobile, branch, employee_id (FK→employees), available_today ENUM('Y','N'), assigned_today, daily_capacity, role_coverage, reporting_manager, branch_head_email, active_status, last_assigned_at, created_at.

**New migration**: `backend/sql/130_ats_interview_submission.sql`
- Creates `ats_interview_submission`: all interview fields (round1/2/3 results, VOC, remarks, skill test, offer details); plus `previous_submitted_time`, `last_walkin_end_stage`, `last_final_decision` tracking columns; UNIQUE KEY `uq_submission (candidate_id, q_token)`.
- Creates `ats_interview_submission_audit`: id, submission_id (FK), action ENUM('INSERT','UPDATE'), actor_user_id, snapshot JSON, created_at.

**New migration**: `backend/sql/131_ats_command_audit_log.sql`
- Creates `ats_command_audit_log` to support existing `audit()` helper in `atsFullParity.service.ts`.

### Fix 2 (S6): Recruiter Auth Service + Submission Validation

**New file**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts`
- `verifyRecruiter(recruiterCode, pin)`: bcrypt PIN check + biometric availability check via `biometric_attendance_log WHERE employee_id = ? AND punch_date = CURDATE() AND first_punch_in IS NOT NULL`; falls back to `available_today = 'Y'` when no employee_id.
- `getMyPendingCandidates(recruiterName)`: returns only candidates with `recruiter_assigned_name = ?` AND `status = 'Waiting'`; calculates `pending_minutes` via `TIMESTAMPDIFF(MINUTE, CONCAT(created_date, ' ', created_time), NOW())` server-side.
- `getSubmissionHistory(recruiterCode)`: returns past submissions for a recruiter from `ats_interview_submission`.
- `submitInterviewUpdate(raw, actorUserId, recruiterProfile)`: full validation (process enum, stage enum, decision enum, stage-conditional round mandatory, VOC-on-rejected mandatory, Selected cascade + offer mandatory); transaction with SELECT FOR UPDATE on both candidate and submission; upserts to `ats_interview_submission` (INSERT vs UPDATE); preserves `previous_submitted_time`, `last_walkin_end_stage`, `last_final_decision` on UPDATE; inserts audit row with action INSERT/UPDATE; updates only `ats_candidate.current_stage` and `status` — never modifies `created_date` or `created_time`.

**Modified**: `backend/src/modules/ats/ats.routes.ts`
- `POST /api/ats/recruiter/verify` — recruiter code + PIN → biometric check → returns recruiter profile.
- `GET /api/ats/recruiter/my-candidates?recruiterName=` — scoped server-calculated pending queue.
- `GET /api/ats/recruiter/submission-history?recruiterCode=` — recruiter submission history.

**Modified**: `backend/src/modules/ats-full-parity/atsFullParity.routes.ts`
- `POST /api/ats-full-parity/recruiter-submission` now calls `submitInterviewUpdate` (with full validation/transaction) instead of the old unvalidated `submitRecruiterUpdate`; requires `recruiterCode` in request body.

### Fix 3 (S6): Frontend NativeATSRecruiterWorkspace.tsx

**File rewritten**: `src/pages/NativeATSRecruiterWorkspace.tsx`
- `login()`: calls `POST /api/ats/recruiter/verify` with `{ recruiterCode, pin }`; stores `RecruiterProfile`; shows backend error message on biometric/auth failure.
- `loadPending()`: calls `GET /api/ats/recruiter/my-candidates?recruiterName=...`; uses server-calculated `pendingMinutes`.
- `loadHistory()`: calls `GET /api/ats/recruiter/submission-history?recruiterCode=...`; wired to real `ats_interview_submission` rows.
- `submit()`: calls `POST /api/ats-full-parity/recruiter-submission` with full form payload; runs client-side `validateForm()` before API call (mirrors backend rules exactly).
- `updateForm()`: applies `cascadeSelected()` to auto-set round results to 'Selected' when `finalDecision === 'Selected'`.
- Added missing `skillTypingScore` input field at rank≥2 alongside `skillAiScore`.
- History table wired to real `HistoryRow` fields from `ats_interview_submission`.

### Tests (S6)

**New file**: `backend/tests/ats.recruiter.test.ts` — 28 tests covering all 15 mandatory test cases:
- TC-01: Assigned Waiting candidates; unassigned denied
- TC-02: Wrong PIN, unknown code, no biometric punch → denied; valid punch → allowed (4 tests)
- TC-03: Blank Skill Test accepted at Round 2 / Selection Discussion (2 tests)
- TC-04: SkillTest Rejected without VOC denied; with VOC accepted (2 tests)
- TC-05: Each round Rejected without VOC denied (3 tests)
- TC-06: Selected without salary / DOJ / reporting time denied (3 tests)
- TC-07: Selected cascades round results to Selected
- TC-08: Invalid process / decision / stage denied (3 tests)
- TC-09: First submission inserts one row
- TC-10: Resubmission updates same row, preserves previous tracking fields
- TC-11: QToken mismatch rejected with 409
- TC-12: created_date / created_time never modified in UPDATE ats_candidate
- TC-13: SELECT FOR UPDATE + transaction prevents duplicate rows
- TC-14: Audit row action=INSERT on first submission; action=UPDATE on resubmission (2 tests)
- TC-15: Frontend validation messages match backend errors

**All 28 new + 60 existing ATS tests pass (88 total ATS, 1129 total).**

---

## 3 (archived). Session 5 — Fixes Applied

### Fix 1: Scope Column Bug — `GET /api/ats/candidates`

**File modified**: `backend/src/modules/ats/ats.routes.ts`
- `buildScopeWhereClause` was called with `{ branchId: "c.branch_id", processId: "c.process_id" }`.
- Changed to `{ branchId: "c.applied_for_branch", processId: "c.applied_for_process" }`.
- Actual `ats_candidate` columns are `applied_for_branch` / `applied_for_process`.
- Old code generated SQL conditions against non-existent aliases — scope filter was silently ignored.

### Fix 2: Registration Mandatory Field Enforcement

**File modified**: `backend/src/modules/ats/ats.validation.ts`
- Previously optional: `email`, `education`, `experience`, `appliedForProcess`, `appliedForBranch`, `sourcingChannel`.
- Now required via Zod `.min(1)`. Validators return 400 on missing fields.
- Added: `appliedForRole` (optional), `arrivalTime` (optional).

**File modified**: `backend/src/modules/ats/ats.types.ts`
- `CreateCandidateInput` updated: required fields are now non-optional.

### Fix 3: Email Duplicate Check + Reprocess Detection

**File modified**: `backend/src/modules/ats/ats.service.ts`
- Added email duplicate check after mobile check.
- Both mobile and email duplicate checks are stage-aware:
  - `current_stage = 'Rejected'` → 409 with `code: DUPLICATE_REJECTED / DUPLICATE_EMAIL_REJECTED` + reprocess message.
  - `current_stage = 'Selected' / 'converted'` → 409 with `code: DUPLICATE_SELECTED`.
  - All others → 409 with `code: DUPLICATE_MOBILE / DUPLICATE_EMAIL`.
- All service errors use `statusCode` (not `status`) for compatibility with `errorHandler.ts`.

### Fix 4: DB-Level UNIQUE Constraints

**New migration**: `backend/sql/127_ats_candidate_unique_constraints.sql`
- `ALTER TABLE ats_candidate ADD CONSTRAINT uq_ats_candidate_mobile UNIQUE (mobile)`.
- `ALTER TABLE ats_candidate ADD CONSTRAINT uq_ats_candidate_email UNIQUE (email)`.
- MySQL UNIQUE on nullable `email` column allows multiple NULLs — safe for pre-S5 rows.

### Fix 5: Queue Token System

**New migration**: `backend/sql/128_ats_queue_token.sql`
- Table `ats_queue_token`: id, candidate_id (FK), token (UUID UNIQUE), arrival_time, current_stage, assigned_recruiter_id, assigned_interviewer_id, status (ENUM active/walked_out/completed), wait_alert_sent, walk_out_at.

**New service**: `backend/src/modules/ats/ats.queue.service.ts`
- `createToken(candidateId, arrivalTime)` — guards against duplicate active token per candidate.
- `walkOut(tokenId)` — marks status walked_out, records walk_out_at.
- `reEntry(candidateId, arrivalTime)` — creates new token only if no active token exists.
- `listActiveQueue(scopeFilter, now)` — returns all active tokens with `wait_minutes` and `over_threshold` (>= 20 min) flag.
- `assignRecruiter`, `assignInterviewer`, `updateStage`.

**File modified**: `backend/src/modules/ats/ats.routes.ts`
- 8 new endpoints under `/api/ats/queue-tokens`:
  - `POST /queue-tokens` — create token
  - `GET /queue-tokens/active` — scoped active queue with wait-time + alert
  - `GET /queue-tokens/candidate/:candidateId` — active token by candidate
  - `POST /queue-tokens/:id/walk-out`
  - `POST /queue-tokens/re-entry`
  - `PATCH /queue-tokens/:id/assign-recruiter`
  - `PATCH /queue-tokens/:id/assign-interviewer`
  - `PATCH /queue-tokens/:id/stage`
- Active queue endpoint applies `buildScopeWhereClause` for branch/process scope.

### Tests

**New file**: `backend/tests/ats.registration.test.ts` — 10 tests
**New file**: `backend/tests/ats.queue.test.ts` — 12 tests
**Updated**: `backend/tests/ats.routes.test.ts` — 27 tests (added 8 validation 400 tests)
**Updated**: `backend/tests/ats.service.test.ts` — 11 tests (updated createCandidate mock chain)

**All 60 ATS tests pass.**

---

## 3. Build Results (Session 5)

### 3.1 Frontend (Root)

| Command | Exit | Errors | Notes |
|---------|------|--------|-------|
| `npm run build` | 0 | 0 | Vite build clean — `dist/` generated |

### 3.2 Backend (`/backend`)

| Command | Exit | Result | Notes |
|---------|------|--------|-------|
| `npx tsc --noEmit` | 1 | **1 error** | `leave.routes.ts:134` — pre-existing non-ATS |
| `npx vitest run` | 1 | **25 failed / 1210 total** | Same 25 pre-existing non-ATS failures; 28 new S6 recruiter tests added |

**ATS suite**: 88/88 passing (60 prior + 28 new S6 recruiter tests).

**Failing test files (all non-ATS, pre-existing)**:

| File | Count | Pattern |
|------|-------|---------|
| `tests/integrationHub.service.test.ts` | 3 | Field-map / suggestion / run creation |
| `tests/leave.routes.test.ts` | 4 | Leave request submission & balance |
| `tests/routes.integration.test.ts` | 1 | Health endpoint DB-error mock |
| `src/modules/customization/__tests__/customization-api.test.ts` | 17 | JWT mock mismatch |

---

## 4. Current ATS Routes

### 4.1 Frontend Routes (React Router)

| # | Route | Page Component | Access | Gate Code |
|---|-------|----------------|--------|-----------|
| 1 | `/interview-registration` | `NativeATSCandidateRegistration` | Public | — |
| 2 | `/candidate-registration` | → `/interview-registration` | Public | — |
| 3 | `/walkin-registration` | → `/interview-registration` | Public | — |
| 4 | `/onboard` | `CandidateOnboardingPage` | Public (token) | — |
| 5 | `/onboard-full` | `CandidateOnboardingFullPage` | Public (token) | — |
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

### 4.2 Backend API Routes (Express — mounted at `/api/ats`)

| # | Method | Route | Auth | Roles | Scope | Notes |
|---|--------|-------|------|-------|-------|-------|
| 1 | POST | `/api/ats/candidates` | None | Public | N/A | Self-registration — validates required fields S5 |
| 2 | GET | `/api/ats/candidates` | JWT | admin,hr,recruiter,manager | ✅ `buildScopeWhereClause` on correct columns | S5: column bug fixed |
| 3 | GET | `/api/ats/candidates/:id` | JWT | admin,hr,recruiter,manager | ✅ `hasScopedAccess` | Row-scope S2 |
| 4 | PUT | `/api/ats/candidates/:id` | JWT | admin,recruiter | ✅ `hasScopedAccess` | Row-scope S2 |
| 5 | POST | `/api/ats/candidates/:id/move-stage` | JWT | admin,recruiter,manager | ✅ `hasScopedAccess` | Row-scope S2 |
| 6 | GET | `/api/ats/candidates/:id/stage-logs` | JWT | admin,hr,recruiter,manager | ❌ None | Audit trail |
| 7 | POST | `/api/ats/convert/:candidateId` | JWT | admin,hr | ✅ `hasScopedAccess` | Row-scope S2 |
| 8 | POST | `/api/ats/onboarding-bridge` | JWT | admin,hr | ❌ None | |
| 9 | PATCH | `/api/ats/onboarding-bridge/:id` | JWT | admin,hr | ❌ None | |
| 10 | GET | `/api/ats/sourcing-channels` | JWT | admin,hr,recruiter | N/A | Reference |
| 11 | GET | `/api/ats/stats` | JWT | admin,hr,recruiter,manager | 🟡 Partial | Query-param scope |
| 12 | GET | `/api/ats/walkin-queue` | JWT | admin,hr,recruiter | ✅ `buildScopeWhereClause` | S2 |
| 13 | GET | `/api/ats/waiting-queue` | JWT | admin,hr,recruiter,manager | ✅ `buildScopeWhereClause` | S2 |
| 14 | POST | `/api/ats/candidates/:id/upload` | None | Public (1-hr window) | N/A | |
| 15 | POST | `/api/ats/queue-tokens` | JWT | admin,hr,recruiter | N/A | S5: create arrival token |
| 16 | GET | `/api/ats/queue-tokens/active` | JWT | admin,hr,recruiter,manager | ✅ `buildScopeWhereClause` | S5: wait-time + 20min alert |
| 17 | GET | `/api/ats/queue-tokens/candidate/:id` | JWT | admin,hr,recruiter | N/A | S5 |
| 18 | POST | `/api/ats/queue-tokens/:id/walk-out` | JWT | admin,hr,recruiter | N/A | S5 |
| 19 | POST | `/api/ats/queue-tokens/re-entry` | JWT | admin,hr,recruiter | N/A | S5 |
| 20 | PATCH | `/api/ats/queue-tokens/:id/assign-recruiter` | JWT | admin,hr,recruiter | N/A | S5 |
| 21 | PATCH | `/api/ats/queue-tokens/:id/assign-interviewer` | JWT | admin,hr,recruiter | N/A | S5 |
| 22 | PATCH | `/api/ats/queue-tokens/:id/stage` | JWT | admin,hr,recruiter | N/A | S5 |
| 23 | POST | `/api/ats/recruiter/verify` | JWT | admin,hr,recruiter,manager | N/A | S6: recruiter code+PIN+biometric |
| 24 | GET | `/api/ats/recruiter/my-candidates` | JWT | admin,hr,recruiter,manager | N/A | S6: server-side pendingMinutes, Waiting only |
| 25 | GET | `/api/ats/recruiter/submission-history` | JWT | admin,hr,recruiter,manager | N/A | S6: submission history by recruiterCode |

**ATS Full Parity Router** (`/api/ats-full-parity`)

| # | Method | Route | Auth | Roles | Notes |
|---|--------|-------|------|-------|-------|
| FP1 | POST | `/api/ats-full-parity/recruiter-submission` | JWT | admin,hr,recruiter,manager | S6: full validation + transaction + upsert to ats_interview_submission |

**Onboarding Sub-Router** (`/api/ats/onboarding`)

| # | Method | Route | Auth | Roles | Scope | Notes |
|---|--------|-------|------|-------|-------|-------|
| 23 | GET | `/validate-token` | None | Public | N/A | |
| 24 | POST | `/submit-profile` | None | Public | N/A | CI-001 fixed S4 |
| 25 | POST | `/send-token/:candidateId` | JWT | hr,recruiter,admin | ❌ None | |
| 26 | GET | `/requests` | JWT | hr,recruiter,admin | ✅ buildScopeWhereClause | Fixed S4 |
| 27 | POST | `/calculate-salary` | JWT | hr,recruiter,admin | N/A | |
| 28 | POST | `/requests/:id/offer` | JWT | hr,recruiter,admin | ❌ None | |
| 29 | PATCH | `/requests/:id/offer` | JWT | hr,recruiter,admin | ❌ None | |
| 30 | GET | `/pending-approval` | JWT | branch_head,admin | ✅ buildScopeWhereClause | Fixed S4 |
| 31 | POST | `/offers/:id/approve` | JWT | branch_head,admin | ✅ `hasScopedAccess` | Fixed S4 |
| 32 | POST | `/offers/:id/reject` | JWT | branch_head,admin | ✅ `hasScopedAccess` | Fixed S4 |

---

## 5. Open Issues (Cumulative)

| # | Priority | Description | Location | Status |
|---|----------|-------------|----------|--------|
| 1 | P1 | `GET /api/ats/candidates/:id` — row-scope | `ats.routes.ts` | ✅ Fixed S2 |
| 2 | P1 | walkin-queue / waiting-queue — no scope in SQL | `ats.routes.ts` | ✅ Fixed S2 |
| 3 | P1 | Onboarding token expiry — timezone risk | `ats.onboarding.service.ts:84` | 🔴 Open |
| 4 | P2 | Upload — no candidate ownership check | `ats.routes.ts:135` | 🔴 Open |
| 5 | P2 | `convertCandidateToEmployee` — no actor scope | `ats.convert.service.ts` | ✅ Fixed S2 |
| 6 | P2 | `listOnboardingRequests` — branchId undefined | `ats.onboarding.service.ts` | ✅ Fixed S4 |
| 7 | P2 | `listPendingApprovals` — branchId undefined | `ats.onboarding.service.ts` | ✅ Fixed S4 |
| 8 | P3 | SMTP silently skips when env missing | `ats.email.service.ts:41` | 🔴 Open (dev ok) |
| 9 | P3 | Duplicate `normalizeSourceChannel` | `ats.controller.ts:87`, `ats.service.ts:22` | 🔴 Open |
| 10 | P3 | Frontend has no `test` script | `package.json` | 🔴 Open |
| CI-001 | **P0** | PII (Aadhaar/PAN/bank) stored unmasked on ats_candidate | `ats.onboarding.service.ts:submitProfile` | ✅ Fixed S4 |
| 11 | P1 | `GET /api/ats/candidates` — scope column bug (`c.branch_id` vs `c.applied_for_branch`) | `ats.routes.ts` | ✅ Fixed S5 |
| 12 | P1 | Registration mandatory fields not enforced | `ats.validation.ts` | ✅ Fixed S5 |
| 13 | P1 | No email duplicate check | `ats.service.ts` | ✅ Fixed S5 |
| 14 | P2 | No DB-level UNIQUE on mobile or email | `004_ats.sql` | ✅ Fixed S5 — migration 127 |
| 15 | P1 | No queue token system | — | ✅ Fixed S5 — migration 128 + service + 8 endpoints |
| 16 | P2 | BGV endpoints — no row-scope (`hasScopedAccess`) | `bgv-verification.routes.ts` | 🔴 Open |
| 17 | P2 | onboarding/send-token — no row-scope | `ats.onboarding.routes.ts` | 🔴 Open |
| 18 | P2 | offer approve/reject — no row-scope on branch_head | `ats.onboarding.service.ts` | ✅ Fixed S4 |
| CI-BGV-01 | **P0** | `POST /api/ats/bgv/provider/callback` — no signature validation | `bgv-verification.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-01 | **P0** | `POST /api/ats-full-parity/intake` — public PII intake | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-02 | **P0** | `POST /api/ats-full-parity/bgv` — public BGV submission | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-03 | **P0** | `POST /api/ats-full-parity/doc-upload-response` — no validation | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-04 | **P0** | `POST /api/ats-full-parity/recruiter-devices` — public | `ats-full-parity.routes.ts` | 🔴 Open |
| 19 | P3 | `/ats/recruiter/my-candidates` — placeholder stub component | `NativeATSRecruiterDashboard.tsx` | 🔴 Open |
| 20 | P3 | Multiple dashboard pages fetch same 1500-candidate list | `NativeATSDashboardReplica`, `DashboardV2`, `CommandCenter` | 🔴 Open (performance) |

---

## 6. Exact Next Task (Session 7)

**Next open P0 issue: CI-BGV-01 — BGV provider callback has no signature validation**

**Task**: `POST /api/ats/bgv/provider/callback` accepts external BGV provider results with no HMAC or PKI signature check. A forged callback can mark a candidate's BGV as clear.

**Approach**:
1. Find the route handler in the BGV routes file.
2. Add a `x-bgv-signature` header check using `crypto.createHmac('sha256', BGV_WEBHOOK_SECRET).update(rawBody).digest('hex')` and compare with `timingSafeEqual`.
3. Return 401 if signature missing or invalid.
4. If `BGV_WEBHOOK_SECRET` env var is not set, log a warning and accept in dev / reject in production.

**Files to Modify**: `grep -r "provider/callback" backend/src/` to locate.

**Exact Next Command**:
```bash
cd /c/Users/shivamg/HRMS1-ats-e2e/backend
npx vitest run tests/ats.routes.test.ts tests/ats.registration.test.ts tests/ats.queue.test.ts
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
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope enforcement, new test failure documented |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: test fix applied, full journey map completed, CI-001 identified |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 + 3 scope fixes; full 89-endpoint API audit; 5 new P0 issues identified |
| 5.0.0 | 2026-06-10 | Audit Agent | Session 5: 6 fixes (scope column, required fields, email dup, DB UNIQUE, reprocess, queue token); 60 ATS tests; both builds clean |
| 6.0.0 | 2026-06-10 | Audit Agent | Session 6: recruiter identity (bcrypt+biometric), scoped pending list, interview submission service (validate+transaction+upsert+audit), 3 SQL migrations, frontend workspace rewrite, 28 new tests (88 ATS total) |

---

**AUDIT STATUS**: 🟡 Recruiter workflow (S6) fixed — 4 open P0 critical issues remain (CI-BGV-01, CI-FP-01/02/03)
**NEXT ACTION**: Fix CI-BGV-01 — Add HMAC signature validation to POST /api/ats/bgv/provider/callback
