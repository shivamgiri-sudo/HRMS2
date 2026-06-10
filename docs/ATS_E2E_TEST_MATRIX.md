# ATS E2E Test Matrix

> Version: 3.0.0  
> Date: 2026-06-10  
> Commit: post-S3 (see git log)
> Session: 3 — Convert mock fix applied; 19/19 ATS tests passing; CI-001 gap added

---

## Legend

| Status | Meaning |
|--------|---------|
| 🟢 | Test exists and passes |
| 🟡 | Test exists but has gaps |
| 🔴 | No test exists |
| ⚪ | Not applicable / deferred |

---

## 1. Backend Unit / Integration Tests

### 1.1 Candidate Lifecycle

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.1.1 | `GET /api/ats/candidates` returns paginated list | `ats.routes.test.ts` | 🟢 | Mocked service |
| 1.1.2 | `GET /api/ats/candidates` returns 401 without auth | `ats.routes.test.ts` | 🟢 | |
| 1.1.3 | `POST /api/ats/candidates` creates candidate and returns 201 | `ats.routes.test.ts` | 🟢 | |
| 1.1.4 | `POST /api/ats/candidates` returns 400 when fullName missing | `ats.routes.test.ts` | 🟢 | |
| 1.1.5 | `POST /api/ats/candidates` returns 400 when mobile too short | `ats.routes.test.ts` | 🟢 | |
| 1.1.6 | `POST /api/ats/candidates` rejects duplicate mobile | `ats.service.test.ts` | 🟢 | |
| 1.1.7 | `GET /api/ats/candidates/:id` returns candidate when scope allows | `ats.routes.test.ts` | 🟢 | S2: scope-allow path tested |
| 1.1.7b | `GET /api/ats/candidates/:id` returns 403 when scope denied | `ats.routes.test.ts` | 🟢 | S2: added |
| 1.1.8 | `GET /api/ats/candidates/:id` returns 404 for missing | — | 🔴 | |
| 1.1.9 | `GET /api/ats/candidates/:id` returns 403 for cross-branch | `ats.routes.test.ts` | 🟢 | S2: added via `hasScopedAccess` mock |
| 1.1.10 | `PUT /api/ats/candidates/:id` updates candidate when scope allows | `ats.routes.test.ts` | 🟢 | S2: added |
| 1.1.10b | `PUT /api/ats/candidates/:id` returns 403 when scope denied | `ats.routes.test.ts` | 🟢 | S2: added |
| 1.1.11 | `POST /api/ats/candidates/:id/move-stage` moves stage | `ats.routes.test.ts` | 🟢 | |
| 1.1.11b | `POST /api/ats/candidates/:id/move-stage` returns 403 when scope denied | `ats.routes.test.ts` | 🟢 | S2: added |
| 1.1.12 | `POST /api/ats/candidates/:id/move-stage` returns 400 when toStage missing | `ats.routes.test.ts` | 🟢 | |
| 1.1.13 | `GET /api/ats/candidates/:id/stage-logs` returns logs | `ats.routes.test.ts` | 🟢 | |
| 1.1.14 | `POST /api/ats/convert/:id` converts candidate to employee | `ats.routes.test.ts` | 🟢 | S3: fix applied — mock added, 201 confirmed |
| 1.1.15 | `POST /api/ats/convert/:id` returns 403 for unauthorized actor | `ats.routes.test.ts` | 🟢 | S2: added |

### 1.2 Service Layer

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.2.1 | `listCandidates` returns candidates | `ats.service.test.ts` | 🟢 | |
| 1.2.2 | `listCandidates` filters by stage | `ats.service.test.ts` | 🟢 | |
| 1.2.3 | `listCandidates` filters by branch | `ats.service.test.ts` | 🟢 | |
| 1.2.4 | `listCandidates` filters by search | `ats.service.test.ts` | 🟢 | |
| 1.2.5 | `listCandidates` applies scopeFilter from middleware | — | 🔴 | |
| 1.2.6 | `getCandidate` returns candidate | `ats.service.test.ts` | 🟢 | |
| 1.2.7 | `getCandidate` throws when not found | `ats.service.test.ts` | 🟢 | |
| 1.2.8 | `createCandidate` inserts and returns | `ats.service.test.ts` | 🟢 | |
| 1.2.9 | `createCandidate` normalizes sourcing channel | — | 🔴 | |
| 1.2.10 | `moveStage` updates stage and inserts log | `ats.service.test.ts` | 🟢 | |
| 1.2.11 | `moveStage` triggers email on Selected | — | 🔴 | Email mocked away |
| 1.2.12 | `moveStage` triggers email on Rejected | — | 🔴 | Email mocked away |
| 1.2.13 | `listStageLogs` returns ordered logs | `ats.service.test.ts` | 🟢 | |
| 1.2.14 | `createOnboardingBridge` creates bridge | `ats.service.test.ts` | 🟢 | |
| 1.2.15 | `createOnboardingBridge` throws if bridge exists | `ats.service.test.ts` | 🟢 | |
| 1.2.16 | `listSourcingChannels` returns active channels | `ats.service.test.ts` | 🟢 | |
| 1.2.17 | `getDashboardStats` returns aggregations | — | 🔴 | |

### 1.3 Onboarding Service

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.3.1 | `sendOnboardingToken` generates token and updates DB | — | 🔴 | |
| 1.3.2 | `sendOnboardingToken` sends email if SMTP configured | — | 🔴 | |
| 1.3.3 | `validateToken` returns candidate data for valid token | — | 🔴 | |
| 1.3.4 | `validateToken` throws 410 for expired token | — | 🔴 | |
| 1.3.5 | `submitProfile` updates candidate and request status | — | 🔴 | |
| 1.3.6 | `listOnboardingRequests` returns requests | — | 🔴 | |
| 1.3.7 | `listOnboardingRequests` filters by branch scope | — | 🔴 | |
| 1.3.8 | `saveOffer` inserts draft offer | — | 🔴 | |
| 1.3.9 | `saveOffer` updates existing offer | — | 🔴 | |
| 1.3.10 | `saveOffer` submits and notifies branch head | — | 🔴 | |
| 1.3.11 | `listPendingApprovals` returns submitted offers | — | 🔴 | |
| 1.3.12 | `approveOffer` creates employee in transaction | — | 🔴 | |
| 1.3.13 | `approveOffer` rolls back on failure | — | 🔴 | |
| 1.3.14 | `rejectOffer` updates statuses and logs rejection | — | 🔴 | |
| 1.3.15 | `calculateSalary` computes components correctly | — | 🔴 | |

### 1.4 Conversion Service

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.4.1 | `convertCandidateToEmployee` creates employee | — | 🔴 | |
| 1.4.2 | `convertCandidateToEmployee` prevents duplicate conversion | — | 🔴 | |
| 1.4.3 | `convertCandidateToEmployee` logs journey event | — | 🔴 | |
| 1.4.4 | `generateEmployeeCode` increments correctly | — | 🔴 | |

### 1.5 Email Service

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.5.1 | `sendRegistrationEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.2 | `sendSelectedEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.3 | `sendRejectedEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.4 | `sendOnboardingTokenEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.5 | `sendOfferReviewEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.6 | `sendWelcomeEmail` logs to `ats_email_log` | — | 🔴 | |
| 1.5.7 | Email skips when SMTP not configured | — | 🔴 | |
| 1.5.8 | Email logs failure on SMTP error | — | 🔴 | |

### 1.6 Form Config Service

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 1.6.1 | `getBootstrap` returns public config | — | 🔴 | |
| 1.6.2 | `getAllConfigs` returns all configs | — | 🔴 | |
| 1.6.3 | `updateFieldSchema` persists changes | — | 🔴 | |
| 1.6.4 | `updateOptionList` persists changes | — | 🔴 | |
| 1.6.5 | `listRecruiters` returns recruiters | — | 🔴 | |
| 1.6.6 | `createRecruiter` inserts recruiter | — | 🔴 | |
| 1.6.7 | `updateRecruiter` modifies recruiter | — | 🔴 | |
| 1.6.8 | `deleteRecruiter` soft-deletes | — | 🔴 | |

---

## 2. Frontend E2E / Smoke Tests (Playwright)

| # | Test Case | File | Status | Notes |
|---|-----------|------|--------|-------|
| 2.1.1 | Public candidate registration loads | — | 🔴 | |
| 2.1.2 | Public candidate registration submits successfully | — | 🔴 | |
| 2.1.3 | Public upload within 1 hour works | — | 🔴 | |
| 2.1.4 | Public upload after 1 hour is rejected | — | 🔴 | |
| 2.1.5 | Onboarding token page loads with valid token | — | 🔴 | |
| 2.1.6 | Onboarding token page shows error for expired token | — | 🔴 | |
| 2.1.7 | Onboarding profile submission succeeds | — | 🔴 | |
| 2.2.1 | HR login → `/ats/candidate-master` loads candidate list | — | 🔴 | |
| 2.2.2 | HR login → stage move updates card | — | 🔴 | |
| 2.2.3 | HR login → stage log modal shows history | — | 🔴 | |
| 2.2.4 | Recruiter login → `/ats/recruiter/my-candidates` loads | — | 🔴 | |
| 2.2.5 | Manager login → `/ats/dashboard` shows stats | — | 🔴 | |
| 2.3.1 | HR login → `/ats/onboarding-requests` lists requests | — | 🔴 | |
| 2.3.2 | HR login → send onboarding token succeeds | — | 🔴 | |
| 2.3.3 | HR login → save offer draft succeeds | — | 🔴 | |
| 2.3.4 | HR login → submit offer for approval succeeds | — | 🔴 | |
| 2.4.1 | Branch Head login → `/ats/offer-approvals` loads | — | 🔴 | |
| 2.4.2 | Branch Head login → approve offer succeeds | — | 🔴 | |
| 2.4.3 | Branch Head login → reject offer succeeds | — | 🔴 | |
| 2.5.1 | Admin login → `/ats/form-config` loads | — | 🔴 | |
| 2.5.2 | Admin login → recruiter CRUD works | — | 🔴 | |
| 2.6.1 | Scope isolation: Branch A HR cannot see Branch B candidate | — | 🔴 | **Critical** |
| 2.6.2 | Scope isolation: Branch Head only sees own branch approvals | — | 🔴 | **Critical** |

---

## 3. Security / Negative Tests

| # | Test Case | Status | Notes |
|---|-----------|--------|-------|
| 3.1 | Unauthenticated `GET /api/ats/candidates` → 401 | 🟢 | |
| 3.2 | Unauthenticated `POST /api/ats/onboarding-bridge` → 401 | — | 🔴 |
| 3.3 | Employee role `POST /api/ats/candidates/:id/move-stage` → 403 | — | 🔴 |
| 3.4 | Recruiter role `POST /api/ats/convert/:id` → 403 | — | 🔴 |
| 3.5 | Manager `GET /api/ats/candidates/:id` cross-branch → 403 | `ats.routes.test.ts` | 🟢 | S2: added via `hasScopedAccess` mock |
| 3.6 | HR `GET /api/ats/onboarding/pending-approval` → 403 | — | 🔴 | Role check exists but not tested |
| 3.7 | SQL injection via `search` param in `listCandidates` | — | 🔴 | Parameterized; needs explicit test |
| 3.8 | SQL injection via `upload` `type` param | — | 🔴 | Hard-coded whitelist; needs test |
| 3.9 | Path traversal via `upload` filename | — | 🔴 | `randomUUID()` filename; low risk |
| 3.10 | CI-001: `POST /onboarding/submit-profile` — Aadhaar/PAN/bank masked before write | — | 🟡 | Fix applied S4; unit test for masking helpers pending |
| 3.11 | BGV `GET /candidates/:id` cross-branch scope denied → 403 | — | 🔴 | No row-scope on BGV routes |
| 3.12 | Offer approve by branch_head of wrong branch → 403 | — | 🔴 | hasScopedAccess added S4; test not yet written |
| 3.13 | `POST /api/ats/bgv/provider/callback` with forged payload → rejected | — | 🔴 **CRITICAL** | No signature validation (CI-BGV-01) |
| 3.14 | `POST /api/ats-full-parity/intake` with PII from unauthenticated client → rejected | — | 🔴 **CRITICAL** | Public endpoint accepts PII (CI-FP-01) |
| 3.15 | `POST /api/ats/onboarding/offers/:id/approve` by branch_head of wrong branch → 403 | — | 🔴 | Unit test needed; logic added S4 |

---

## 4. Performance / Load Tests

| # | Test Case | Status | Notes |
|---|-----------|--------|-------|
| 4.1 | `GET /api/ats/candidates` with 10k records < 500ms | — | 🔴 |
| 4.2 | `GET /api/ats/stats` with 10k records < 200ms | — | 🔴 |
| 4.3 | `GET /api/ats/walkin-queue` < 100ms | — | 🔴 |
| 4.4 | Concurrent candidate creation does not duplicate mobile | — | 🔴 | Race condition risk |
| 4.5 | Concurrent offer approval does not duplicate employee code | — | 🔴 | `FOR UPDATE` lock present but untested |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial test matrix |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope enforcement tests reflected; convert mock gap flagged |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: convert mock fix applied (19/19 green); CI-001, BGV, offer scope tests added as gaps |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 fixed; approve/reject scope fixed; 3 new security test gaps added from full-parity audit |

---

*End of Test Matrix*
