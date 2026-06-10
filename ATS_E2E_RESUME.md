# ATS E2E Audit — Session Resume

> Session: HRMS1 ATS End-to-End Audit (Session 4)
> Date: 2026-06-10
> Commit: see git log (post-S4)
> Scope: ATS module + directly dependent onboarding / BGV / offer / training flows

---

## 1. Current Commit

| Property | Value |
|----------|-------|
| **SHA** | see `git rev-parse HEAD` — post-S3 commit after test fix + docs |
| **Branch** | `main` |
| **Working tree** | `backend/tests/ats.routes.test.ts` modified (test fix applied, not yet committed) |

---

## 2. Session 4 — Fixes Applied

### Fix 1: CI-001 — Aadhaar / PAN / bank account masked + hashed before writing to `ats_candidate`

**File modified**: `backend/src/modules/ats/ats.onboarding.service.ts`
- Import `createHash` added; four pure helpers: `hashPii`, `maskAadhaar`, `maskPan`, `maskBankAccount`.
- `submitProfile()` now writes masked display + SHA-256 hash for each PII field.
- Migration `backend/sql/126_ats_candidate_pii_hash_columns.sql`: adds `*_hash CHAR(64)` columns (additive).

### Fix 2: `listOnboardingRequests` + `listPendingApprovals` — branch scope enforced

**Files modified**: `ats.onboarding.service.ts`, `ats.onboarding.routes.ts`
- Both service functions now accept `{ sql, params }` scope filter.
- Route handlers call `buildScopeWhereClause()` on `r.branch_id` before every list query.

### Fix 3: Offer `approveOffer` + `rejectOffer` — branch_head row-scope enforced

**File modified**: `backend/src/modules/ats/ats.onboarding.service.ts`
- `hasScopedAccess()` imported and called after fetching the offer row in both functions.
- `rejectOffer` SELECT expanded to include `c.applied_for_branch`, `c.applied_for_process`.
- Throws 403 if approver's scope does not cover candidate's branch/process.

### Fix 4: S2 scope enforcement committed (previously uncommitted working tree)

- `GET/PUT /api/ats/candidates/:id`, `POST move-stage`, `POST /convert/:id` — `hasScopedAccess` wrappers.
- `GET /walkin-queue`, `GET /waiting-queue` — `buildScopeWhereClause` injected.

**All results**: `tests/ats.routes.test.ts` — 19/19 passing. Typecheck: same pre-existing `leave.routes.ts:134` error only.

### Journey Map Audit (S4)

Full parallel API audit completed. 89 endpoints mapped. New P0 issues found:
- CI-BGV-01: `POST /api/ats/bgv/provider/callback` — no provider signature validation
- CI-FP-01: `POST /api/ats-full-parity/intake` — public endpoint accepts PII
- CI-FP-02: `POST /api/ats-full-parity/bgv` — public BGV submission without token
- CI-FP-03: `POST /api/ats-full-parity/doc-upload-response` — public without validation
- CI-FP-04: `POST /api/ats-full-parity/recruiter-devices` — public device registration

---

## 3. Baseline Results (Session 3)

### 3.1 Frontend (Root)

| Command | Exit | Errors | Notes |
|---------|------|--------|-------|
| `npx tsc --noEmit` | 0 | 0 | TypeScript clean |
| `npm run build` | — | — | Not re-run (no frontend changes) |

### 3.2 Backend (`/backend`)

| Command | Exit | Result | Notes |
|---------|------|--------|-------|
| `npm run typecheck` | 1 | 1 error | `leave.routes.ts:134` — `leaveService` undefined (non-ATS, pre-existing) |
| `npm test -- --run` | 1 | **25 failed / 1155 total** | Down from 26 (ATS convert fix) |
| `npm run build` | — | — | Not re-run (type-clean as of S2) |

**Failing test files (all non-ATS, pre-existing)**:

| File | Count | Pattern |
|------|-------|---------|
| `tests/integrationHub.service.test.ts` | 3 | Integration hub field-map / suggestion / run creation |
| `tests/leave.routes.test.ts` | 4 | Leave request submission & balance (403 vs 200/400) |
| `tests/routes.integration.test.ts` | 1 | Health endpoint DB-error mock returns 503 vs 200 |
| `src/modules/customization/__tests__/customization-api.test.ts` | 17 | All 401 Unauthorized — test JWT mock mismatch |

**ATS test suite**: All tests passing.

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
| 1 | POST | `/api/ats/candidates` | None | Public | N/A | Self-registration |
| 2 | GET | `/api/ats/candidates` | JWT | admin,hr,recruiter,manager | ✅ `buildScopeWhereClause` | Scoped list |
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
| 15 | GET | `/api/ats/onboarding-full/...` | None | Public | N/A | External router |
| 16 | GET | `/api/ats/bgv/...` | JWT/None | Mixed | ⚠ No row-scope | BGV router |

**Onboarding Sub-Router** (`/api/ats/onboarding`)

| # | Method | Route | Auth | Roles | Scope | Notes |
|---|--------|-------|------|-------|-------|-------|
| 17 | GET | `/validate-token` | None | Public | N/A | |
| 18 | POST | `/submit-profile` | None | Public | N/A | ⚠ PII CI-001 |
| 19 | POST | `/send-token/:candidateId` | JWT | hr,recruiter,admin | ❌ None | |
| 20 | GET | `/requests` | JWT | hr,recruiter,admin | ⚠ branchId=undefined | |
| 21 | POST | `/calculate-salary` | JWT | hr,recruiter,admin | N/A | |
| 22 | POST | `/requests/:id/offer` | JWT | hr,recruiter,admin | ❌ None | |
| 23 | PATCH | `/requests/:id/offer` | JWT | hr,recruiter,admin | ❌ None | |
| 24 | GET | `/pending-approval` | JWT | branch_head,admin | ⚠ branchId=undefined | |
| 25 | POST | `/offers/:id/approve` | JWT | branch_head,admin | ❌ None | |
| 26 | POST | `/offers/:id/reject` | JWT | branch_head,admin | ❌ None | |

**BGV Sub-Router** (`/api/ats/bgv`)

| # | Method | Route | Auth | Scope | Notes |
|---|--------|-------|------|-------|-------|
| 27 | POST | `/consent` | None (token) | N/A | |
| 28 | GET | `/status` | None (token) | N/A | |
| 29 | POST | `/verify/pan` | None (token) | N/A | |
| 30 | POST | `/verify/bank` | None (token) | N/A | |
| 31 | POST | `/verify/aadhaar-offline` | None (token) | N/A | |
| 32 | POST | `/digilocker/start` | None (token) | N/A | |
| 33 | POST | `/provider/callback` | None | N/A | Webhook |
| 34 | GET | `/queue` | JWT | ⚠ No row-scope | admin,hr,recruiter |
| 35 | GET | `/candidates/:id` | JWT | ⚠ No row-scope | admin,hr,recruiter |
| 36 | POST | `/candidates/:id/verify/pan` | JWT | ⚠ No row-scope | admin,hr |
| 37 | POST | `/candidates/:id/verify/bank` | JWT | ⚠ No row-scope | admin,hr |
| 38 | POST | `/candidates/:id/manual-review` | JWT | ⚠ No row-scope | admin,hr |
| 39 | POST | `/candidates/:id/waive` | JWT | ⚠ No row-scope | admin,hr |

---

## 5. First Confirmed Critical Issue

**CI-001 — PII Stored Unmasked on ats_candidate**

| Attribute | Value |
|-----------|-------|
| **ID** | CI-001 |
| **Severity** | P0 — Critical |
| **Type** | Data Security / PII Exposure |
| **File** | `backend/src/modules/ats/ats.onboarding.service.ts` (submitProfile, ~line 60–100) |
| **Columns** | `ats_candidate.aadhar_number`, `ats_candidate.pan_number`, `ats_candidate.bank_account_no` |
| **What happens** | `submitProfile()` writes Aadhaar, PAN, bank account numbers as **plain text** to `ats_candidate` |
| **Contrast** | `onboarding-full.service.ts` correctly stores hashed/masked versions in `candidate_onboarding_profile` |
| **Exposure** | Any `GET /api/ats/candidates/:id` caller (scope-gated) sees raw PII in response |
| **Regulatory** | DPDP Act 2023 data minimisation; potential PCI-DSS if bank data in scope |
| **Fix** | Hash/mask before writing OR stop writing PII to `ats_candidate`, use `candidate_onboarding_profile` exclusively |
| **Status** | 🔴 Not fixed — record only per session rules |

---

## 6. Open Issues (Cumulative)

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
| **CI-001** | **P0** | **PII (Aadhaar/PAN/bank) stored unmasked on ats_candidate** | `ats.onboarding.service.ts:submitProfile` | **✅ Fixed S4** |
| 11 | P2 | BGV endpoints — no row-scope (`hasScopedAccess`) | `bgv-verification.routes.ts` | 🔴 Open |
| 12 | P2 | onboarding/send-token — no row-scope | `ats.onboarding.routes.ts` | 🔴 Open |
| 13 | P2 | offer approve/reject — no row-scope on branch_head | `ats.onboarding.service.ts` | ✅ Fixed S4 |
| CI-BGV-01 | P0 | `POST /api/ats/bgv/provider/callback` — no signature validation | `bgv-verification.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-01 | P0 | `POST /api/ats-full-parity/intake` — public PII intake | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-02 | P0 | `POST /api/ats-full-parity/bgv` — public BGV submission | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-03 | P0 | `POST /api/ats-full-parity/doc-upload-response` — no validation | `ats-full-parity.routes.ts` | 🔴 Open — CRITICAL |
| CI-FP-04 | P0 | `POST /api/ats-full-parity/recruiter-devices` — public | `ats-full-parity.routes.ts` | 🔴 Open |
| 14 | P3 | `/ats/recruiter/my-candidates` — placeholder stub component | `NativeATSRecruiterDashboard.tsx` | 🔴 Open |
| 15 | P3 | Multiple dashboard pages fetch same 1500-candidate list | `NativeATSDashboardReplica`, `DashboardV2`, `CommandCenter` | 🔴 Open (performance) |

---

## 7. Exact Next Task

**Next open P0 issue: CI-BGV-01 — BGV provider callback has no signature validation**

**Task**: `POST /api/ats/bgv/provider/callback` accepts external BGV provider results with no HMAC or PKI signature check. A forged callback can mark a candidate's BGV as clear.

**Approach**:
1. Find the route handler in the BGV routes file.
2. Add a `x-bgv-signature` header check using `crypto.createHmac('sha256', BGV_WEBHOOK_SECRET).update(rawBody).digest('hex')` and compare with `timingSafeEqual`.
3. Return 401 if signature missing or invalid.
4. If `BGV_WEBHOOK_SECRET` env var is not set, log a warning and accept (dev fallback) — or reject in production (`NODE_ENV=production`).

**Files to Modify**: BGV verification routes file (find with `grep -r "provider/callback" backend/src/`)

**Exact Next Command**:
```bash
cd /c/Users/shivamg/HRMS1-ats-e2e/backend
npx vitest run tests/ats.routes.test.ts
```

---

## 8. Preservation Rules

- **Employee fixes**: Do not modify `employees`, `leave`, `attendance`, `payroll` modules.
- **Admin fixes**: Do not modify `scopeAccess.ts` default `allowAdminBypass` logic unless explicitly requested.
- **Manager fixes**: Do not modify `management`, `performance-feedback`, `wfm` modules.
- **No secrets**: Do not commit `.env` or any SMTP/credential values.

---

## 9. Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial ATS E2E baseline |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope enforcement, new test failure documented |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: test fix applied, full journey map completed, CI-001 identified |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 + 3 scope fixes; full 89-endpoint API audit; 5 new P0 issues identified |

---

**AUDIT STATUS**: 🟡 All S4 fixes done — 5 new P0 issues (CI-BGV-01, CI-FP-01/02/03/04) identified from full API audit
**NEXT ACTION**: Fix CI-BGV-01 — Add HMAC signature validation to POST /api/ats/bgv/provider/callback
