# ATS E2E Specification

> Version: 3.0.0  
> Date: 2026-06-10  
> Commit: post-S3 (see git log)
> Scope: ATS module + onboarding / BGV / offer / training dependency flows  
> Session: 3 — Full journey map complete, CI-001 PII issue recorded

---

## 1. Purpose

This document defines the end-to-end audit scope, boundaries, and success criteria for the ATS (Applicant Tracking System) module in MAS Callnet PeopleOS.

---

## 2. Scope Definition

### 2.1 In-Scope

| Layer | Components |
|-------|------------|
| **Frontend** | All `/ats/*` routes, `/interview-registration`, `/onboard`, `/onboard-full`, candidate registration pages, recruiter dashboards, waiting queues, sourcing analysis, form config, command center, BGV center |
| **Backend API** | `/api/ats/*` routes including candidates, onboarding, form-config, recruiters, stats, walk-in queue, waiting queue, uploads |
| **Database** | `ats_candidate`, `ats_candidate_stage_log`, `ats_onboarding_bridge`, `ats_onboarding_request`, `ats_employment_offer`, `ats_offer_approval`, `ats_email_log`, `ats_sourcing_channel`, `salary_band_master` |
| **Dependent Flows** | Onboarding bridge → employee conversion, offer letter generation, BGV verification, training assignment hand-off to LMS integration layer |

### 2.2 Out-of-Scope

| Component | Rationale |
|-----------|-----------|
| Employee module CRUD | Protected existing flow |
| Leave / attendance | Protected existing flow |
| Payroll computation | Foundation only, not ATS-dependent |
| LMS content / curriculum | External deployed system — integration only |
| WFM roster | Protected existing flow |

---

## 3. User Personas

| Persona | Role Key | Primary ATS Pages |
|---------|----------|-------------------|
| Walk-in Candidate | — | `/interview-registration`, `/onboard` |
| Recruiter | recruiter | `/ats/recruiter/*`, `/ats/candidate-master`, `/ats/waiting-queue` |
| HR Admin | hr | `/ats/*`, `/ats/onboarding-requests`, `/ats/form-config` |
| Branch Head | branch_head | `/ats/offer-approvals` |
| Manager | manager | `/ats/dashboard`, `/ats/stats` |
| System / Integration | — | Webhooks, email triggers, candidate-to-employee conversion |

---

## 4. Critical Flows

### 4.1 Candidate Self-Registration (Public)
```
/interview-registration → POST /api/ats/candidates → ats_candidate (Applied)
                                      ↓
                         POST /api/ats/candidates/:id/upload (within 1hr)
```

### 4.2 Recruiter Stage Management
```
/ats/candidate-master → GET /api/ats/candidates (scoped)
                              ↓
              POST /api/ats/candidates/:id/move-stage
                              ↓
              ats_candidate_stage_log + email side-effects
```

### 4.3 Onboarding Token Flow
```
/ats/onboarding-requests → POST /api/ats/onboarding/send-token/:candidateId
                                    ↓
                         Candidate receives email → /onboard?token=...
                                    ↓
                         POST /api/ats/onboarding/submit-profile
                                    ↓
                         ats_candidate.profile_status = 'profile_submitted'
```

### 4.4 Offer → Approval → Conversion
```
POST /api/ats/onboarding/requests/:id/offer (submit=true)
              ↓
GET /api/ats/onboarding/pending-approval (Branch Head view)
              ↓
POST /api/ats/onboarding/offers/:id/approve
              ↓
Transaction:
  - auth_user created
  - employees record created
  - employee_salary_snapshot inserted
  - ats_candidate.current_stage = 'converted'
  - ats_offer_approval inserted
  - welcome email sent
```

### 4.5 BGV Flow (Dependent)
```
/ats/bgv → BGV verification center → linked to candidate record
```

### 4.6 Training Hand-off (Dependent)
```
Converted employee → LMS integration layer → learner mapping
```

---

## 5. Security Requirements

| Requirement | Priority | Status |
|-------------|----------|--------|
| Public registration endpoints must not leak existing candidate data | P0 | ✅ Verified (duplicate mobile check returns generic error) |
| Candidate detail GET must enforce row-scope (branch/process) | P1 | ✅ Fixed S2 — `hasScopedAccess` added |
| Candidate PUT must enforce row-scope | P1 | ✅ Fixed S2 — `hasScopedAccess` added |
| Candidate move-stage must enforce row-scope | P1 | ✅ Fixed S2 — `hasScopedAccess` added |
| List endpoints must use `buildScopeWhereClause` | P1 | ✅ Fixed S2 — walkin-queue + waiting-queue now scoped |
| Convert endpoint must verify actor scope | P1 | ✅ Fixed S2 — `hasScopedAccess` added |
| Offer approval must verify approver is branch_head of candidate's branch | P1 | 🟡 Partial (role check exists; row-scope verification not explicit) |
| File upload window must be strictly 1 hour | P2 | ✅ Enforced |
| Token expiry must be validated server-side | P0 | ✅ Enforced (7 days) |
| Email side-effects must not break main transaction | P0 | ✅ Verified (try/catch + `.catch()`) |

---

## 6. Data Integrity Rules

1. `ats_candidate.mobile` must be unique (enforced by service + DB unique index).
2. `ats_onboarding_bridge.candidate_id` is unique — one bridge per candidate.
3. `ats_employment_offer.onboarding_request_id` is unique — one offer per request.
4. Candidate conversion (`current_stage = 'converted'`) is irreversible via normal API.
5. `salary_band_master.band_code` is unique and seeded with bands D, C, B, A, M.

---

## 7. Baseline Test Coverage

| Suite | File | Pass | Fail | Skip | Coverage |
|-------|------|------|------|------|----------|
| ATS Routes | `backend/tests/ats.routes.test.ts` | 18 | **1** | 0 | Candidates CRUD, move-stage, stage-logs, onboarding-bridge, sourcing-channels, stats, scope 403 tests |
| ATS Service | `backend/tests/ats.service.test.ts` | 10 | 0 | 0 | listCandidates filters, getCandidate, createCandidate duplicate guard, moveStage, listStageLogs, createOnboardingBridge, listSourcingChannels |
| ATS WFM Completion | `backend/tests/ats.wfm.completion.test.ts` | — | — | — | Not executed in this baseline (assumed preserved) |

**Session 2 New Test Failures**:
- `POST /api/ats/convert/:candidateId` (converts candidate when scope allows) — 500 vs 201  
  Root cause: `convertCandidateToEmployee` not mocked; real service calls DB which throws `Candidate not found`.

**Remaining Gaps**:
- No tests for `ats.onboarding.service.ts` (token generation, profile submission, offer save/approve/reject).
- No tests for `ats.convert.service.ts` (candidate → employee conversion).
- No tests for `ats.email.service.ts`.
- No tests for `ats-form-config.service.ts`.
- No frontend E2E tests for ATS flows.

---

## 8. Environment Assumptions

- MySQL `mas_hrms` database is available and migrations `004_ats.sql` + `054_ats_onboarding_flow.sql` applied.
- SMTP env vars (`SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`) are optional in dev; emails are logged to `ats_email_log` with status `skipped` if missing.
- `FRONTEND_URL` env var is used for onboarding token links; defaults to `http://localhost:5173`.
- Multer uploads directory: `process.cwd()/uploads/candidates`.

---

## 9. Rollback Plan

| Change Layer | Rollback Step |
|--------------|---------------|
| DB Schema | Migrations are additive; no destructive alters in scope. Rollback = revert migration file + restore from `backups/`. |
| Backend Code | Revert commit or restore from `backups/ats-backup-20260604_030010/`. |
| Frontend Code | Revert commit. Build artifacts in `dist/` are regenerable. |

---

## 10. Approval Gate

Before any ATS production deployment:
- [x] Candidate detail/update/move-stage endpoints have row-scope enforcement
- [x] walkin-queue + waiting-queue have branch/process scope SQL injection
- [x] convert endpoint has actor scope check
- [x] `convertCandidateToEmployee` mock added — ATS tests 19/19 passing (fixed S3)
- [x] CI-001 resolved — PII (Aadhaar/PAN/bank) masked+hashed before writing to ats_candidate (S4)
- [x] Onboarding `requests` + `pending-approval` endpoints have branch scope enforced (S4)
- [ ] BGV endpoints have row-scope enforcement (SG-010)
- [x] Offer approval passes branch-head scope — `hasScopedAccess` added to approveOffer + rejectOffer (S4)
- [ ] CI-BGV-01: BGV provider callback signature validation
- [ ] CI-FP-01/02/03: ats-full-parity public intake/BGV/doc endpoints require auth or token
- [ ] Frontend build passes (`npm run build`)
- [ ] Backend typecheck clean — `leave.routes.ts:134` `leaveService` error must be fixed
- [ ] Backend test pass rate >= 95 % (current S3: 25 failures / 1155 tests = 97.8 % pass rate)
- [ ] Manual E2E smoke of registration → stage move → onboarding → conversion

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial ATS E2E specification |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope enforcement status updated, new test failure recorded |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: test fix confirmed, CI-001 PII issue added, approval gate updated |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 fixed; requests/pending-approval scoped; offer approve/reject scoped; 4 new P0 CI issues added to gate |

---

*End of Specification*
