# ATS E2E Journey Map

> Version: 4.0.0
> Date: 2026-06-10
> Commit: post-S4 (see git log)
> Session: 4 — journey map refreshed; approve/reject scope fixed; full API audit completed

---

## Candidate Unique Key

| Field | Type | Notes |
|-------|------|-------|
| `id` | UUID PK | Internal primary key |
| `candidate_code` | VARCHAR(50) UNIQUE | External reference `CND-{timestamp}` |
| `mobile` | VARCHAR(20) UNIQUE (enforced in service) | Primary duplicate-check key |

Mobile uniqueness is enforced in `ats.service.ts` `createCandidate()` with:
```sql
SELECT id FROM ats_candidate WHERE mobile = ? LIMIT 1
```
Email is nullable and NOT unique — used for communication only.

---

## Recruiter Ownership

- `ats_candidate.created_by` → `auth_user.id` of the creating user
- `ats_candidate.recruiter_name` → VARCHAR(255) free-text name for display

---

## Stage State Machine

```
Applied
  ↓ moveStage
Screening
  ↓ moveStage
[Interview 1 / Interview 2 / Client Round]  ← freeform string
  ↓ moveStage
Selected  →  onboarding_sent (profile_status)
               ↓  candidate fills /onboard or /onboard-full
             profile_submitted
               ↓  HR saves offer → branch_head approves
             onboarded  →  current_stage = 'converted'

Any stage → Rejected  (sends rejection email)
```

`current_stage` is VARCHAR(100) — no DB ENUM constraint; validated in application layer.

### current_stage values in use

| Value | Set by |
|-------|--------|
| `Applied` | Default on `createCandidate()` |
| `Screening` | `moveStage` call |
| `Interview 1` / `Interview 2` / `Client Round` | `moveStage` (freeform) |
| `Selected` | `moveStage` — also triggers email |
| `Rejected` | `moveStage` — also triggers rejection email |
| `converted` | `approveOffer()` transaction OR `convertCandidateToEmployee()` |

### profile_status values (ENUM on ats_candidate)

| Value | Trigger |
|-------|---------|
| `registered` | `createCandidate()` |
| `selected` | `moveStage` to Selected |
| `onboarding_sent` | `sendOnboardingToken()` |
| `profile_submitted` | `submitProfile()` (legacy) or `onboarding-full/final-section` |
| `onboarded` | `approveOffer()` transaction |

---

## Stage-by-Stage Map

### Stage 1 — Pre-Visit / Arrival / Registration (Public)

| Layer | Detail |
|-------|--------|
| **Frontend route** | `/interview-registration`, `/candidate-registration`, `/walkin-registration` (all resolve to same component) |
| **Component** | `NativeATSCandidateRegistration.tsx` |
| **API call** | `POST /api/ats/candidates` |
| **Backend route** | `ats.routes.ts` → `c.createCandidate.bind(c)` (public) |
| **Middleware** | None (public) |
| **Service** | `ats.service.ts` `createCandidate()` |
| **SQL** | INSERT into `ats_candidate`; mobile uniqueness check prior |
| **DB tables** | `ats_candidate`, `ats_form_config*` (bootstrap form schema) |
| **Key columns written** | id, candidate_code, full_name, mobile, email, gender, date_of_birth, applied_for_process, applied_for_branch, sourcing_channel, referred_by, walk_in_date, remarks, created_by, profile_status='registered', current_stage='Applied' |
| **Response** | `{ success: true, data: AtsCandidate, message: "Candidate registered" }` |
| **Next stage** | Recruiter manually moves to Screening |
| **Allowed roles** | Public (no auth) |
| **Scope** | N/A |

**File upload (within 1 hour of registration):**
- `POST /api/ats/candidates/:id/upload` — public, time-window gated
- Writes `resume_url` or `selfie_url` on `ats_candidate`

---

### Stage 2 — Eligibility / Duplicate Check

- **No automated eligibility flow** — HR reviews candidate profile manually.
- Duplicate detection: `candidate_duplicate_detection` table (via `ats-ext` service); matches on mobile, PII hash.
- Duplicate log columns: candidate_id, matched_with_id, match_reason, match_score, resolved, resolution_note.

---

### Stage 3 — Queue

| Layer | Detail |
|-------|--------|
| **Frontend routes** | `/ats/waiting-queue` → `NativeATSWaitingQueue.tsx`; `/ats/walkin-queue` → `NativeWalkinQueue.tsx` |
| **API calls** | `GET /api/ats/waiting-queue`; `GET /api/ats/walkin-queue` |
| **Backend route** | `ats.routes.ts` lines 115-154 |
| **Middleware** | requireAuth, requireRole |
| **Scope** | `buildScopeWhereClause(userId, roles, { branchId: "c.applied_for_branch", processId: "c.applied_for_process" })` |
| **SQL** | `WHERE current_stage IN ('New','Screening') [scope] ORDER BY walk_in_date DESC LIMIT 100` |
| **DB tables** | `ats_candidate` |
| **Allowed roles** | admin, hr, recruiter (walkin); admin, hr, recruiter, manager (waiting) |

---

### Stage 4 — Screening / Assessment / Interviews

| Layer | Detail |
|-------|--------|
| **Frontend routes** | `/ats/candidate-master` → `NativeATSCandidateMaster.tsx`; `/ats/recruiter/workspace` → `NativeATSRecruiterWorkspace.tsx` |
| **API calls** | `GET /api/ats/candidates`, `GET /api/ats/candidates/:id`, `POST /api/ats/candidates/:id/move-stage` |
| **Middleware** | requireAuth, requireRole, `hasScopedAccess` on detail/mutation endpoints |
| **Service** | `ats.service.ts` `moveStage()` |
| **SQL (moveStage)** | `UPDATE ats_candidate SET current_stage = ? WHERE id = ?`; INSERT into `ats_candidate_stage_log` |
| **DB tables** | `ats_candidate`, `ats_candidate_stage_log`, `ats_interview_slot` |
| **Stage log columns** | id, candidate_id, from_stage, to_stage, stage_date, remarks, updated_by, interview_slot_id |
| **Email side-effects** | Selected → `sendSelectedEmail()`; Rejected → `sendRejectedEmail()` |
| **Next stage** | Selected → HR sends onboarding token; Rejected → closed |
| **Allowed roles** | admin, hr, recruiter (list/get); admin, recruiter, manager (move-stage) |
| **Scope** | `hasScopedAccess(userId, roles, { branchId, processId }, { allowAdminBypass: true })` |

**Assessment:** No formal assessment endpoint; custom stage values used (e.g. "Assessment", "Test"). `ats_interview_slot` links via `stage_log.interview_slot_id`.

---

### Stage 5 — Onboarding Token

| Layer | Detail |
|-------|--------|
| **Frontend route** | `/ats/onboarding-requests` → `NativeHROnboardingRequests.tsx` |
| **API call** | `POST /api/ats/onboarding/send-token/:candidateId` |
| **Middleware** | requireAuth, requireRole('hr','recruiter','admin') |
| **Service** | `ats.onboarding.service.ts` `sendOnboardingToken()` |
| **Token** | `randomUUID() + '-' + randomUUID()`, expires 7 days |
| **DB writes** | `ats_onboarding_request` (upsert, status='pending'); `ats_onboarding_bridge` (token + expiry); `ats_candidate.profile_status='onboarding_sent'` |
| **Email** | `sendOnboardingTokenEmail()` → `{FRONTEND_URL}/onboard?token={token}` |
| **Scope gap** | No `hasScopedAccess` on candidateId — P1 open |

**Candidate fills form at `/onboard?token=...` or `/onboard-full?token=...`**

---

### Stage 6 — Profile Submission (Token-gated, Public)

Two paths:

**Legacy (`/onboard?token=...` → `POST /api/ats/onboarding/submit-profile`):**
- Service: `submitProfile()` in `ats.onboarding.service.ts`
- Writes masked+hashed PII to `ats_candidate`: `aadhar_number` (masked), `aadhar_number_hash`, `pan_number` (masked), `pan_number_hash`, `bank_account_no` (masked), `bank_account_no_hash`
- Sets `profile_status='profile_submitted'`, `ats_onboarding_request.status='in_progress'`

**Full (`/onboard-full?token=...` → `POST /api/ats/onboarding-full/employee-details` etc.):**
- 8 steps: employee-details, bank-details, qualification, family, experience, final-section, documents, submit
- PII stored in `candidate_onboarding_profile` (masked + hashed — separate table, NOT `ats_candidate`)
- PAN: `pan_number_masked` (AB*****34F) + `pan_number_hash` (SHA-256)
- Aadhaar: `aadhaar_number_masked` (XXXX-XXXX-LAST4) + `aadhaar_number_hash` (SHA-256)
- Bank: `account_no_masked` (XXXXXX-LAST4) + `account_no_hash` (SHA-256)

---

### Stage 7 — BGV

| Layer | Detail |
|-------|--------|
| **Frontend route** | `/ats/bgv` → `NativeBGVVerificationCenter.tsx` |
| **Public (token-gated) APIs** | `POST /bgv/consent`, `POST /bgv/verify/pan`, `POST /bgv/verify/bank`, `POST /bgv/verify/aadhaar-offline`, `POST /bgv/digilocker/start`, `POST /bgv/provider/callback` |
| **HR APIs** | `GET /bgv/queue`, `GET /bgv/candidates/:id`, `POST /bgv/candidates/:id/manual-review`, `POST /bgv/candidates/:id/waive` |
| **DB tables** | `candidate_bgv_consent`, `candidate_bgv_check`, `candidate_bgv_verification_event`, `candidate_bank_verification`, `candidate_onboarding_document`, `candidate_digilocker_session` |
| **BGV status field** | `ats_candidate.bgv_status` VARCHAR(50) default 'pending' |
| **BGV check statuses** | pending / clear / adverse (per check type: address, education, employment, criminal) |
| **Scope gap** | No `hasScopedAccess` on any HR BGV endpoint — P1 open |
| **P0 gap** | `POST /bgv/provider/callback` has no provider signature validation |

---

### Stage 8 — Offer

| Layer | Detail |
|-------|--------|
| **Frontend route** | `/ats/onboarding-requests` → `NativeHROnboardingRequests.tsx` |
| **API calls** | `GET /api/ats/onboarding/requests`, `POST /api/ats/onboarding/requests/:id/offer`, `PATCH /api/ats/onboarding/requests/:id/offer` |
| **Middleware** | requireAuth, requireRole('hr','recruiter','admin') |
| **Scope** | `buildScopeWhereClause` on `r.branch_id` for GET; no row-scope for POST/PATCH — P1 open |
| **Service** | `saveOffer()` |
| **Salary calc** | `calculateSalary(ctc, basic_pct, hra_pct, isMetro)` from `salary_band_master` |
| **DB tables** | `ats_employment_offer`, `ats_onboarding_request`, `salary_band_master` |
| **Key offer columns** | emp_type, date_of_joining, salary_band, offered_ctc, basic, hra, conveyance, da, special_allowance, other_allowance, bonus, gross, pf_employee, pf_employer, esic_employee, esic_employer, professional_tax, gratuity, admin_charges, net_in_hand, status (draft/submitted) |
| **On submit** | `ats_onboarding_request.status='offer_submitted'`; email sent to branch_head |

---

### Stage 9 — Offer Approval / Joining

| Layer | Detail |
|-------|--------|
| **Frontend route** | `/ats/offer-approvals` → `NativeBranchHeadApproval.tsx` |
| **API calls** | `GET /api/ats/onboarding/pending-approval`, `POST /api/ats/onboarding/offers/:id/approve`, `POST /api/ats/onboarding/offers/:id/reject` |
| **Middleware** | requireAuth, requireRole('branch_head','admin') |
| **Scope** | `buildScopeWhereClause` on `r.branch_id` (GET); `hasScopedAccess` on `applied_for_branch/process` (approve/reject) — **Fixed S4** |
| **Service** | `approveOffer()` — 12-step atomic transaction |
| **Transaction steps** | Lock employee_code via `FOR UPDATE`; create auth_user; create employee; create salary_snapshot; insert offer_approval; update request/bridge/candidate; assign employee role; commit; send welcome email |
| **DB tables written** | `auth_user`, `employees`, `employee_salary_snapshot`, `ats_offer_approval`, `ats_onboarding_request`, `ats_onboarding_bridge`, `ats_candidate`, `user_roles` |
| **Final state** | `ats_candidate.current_stage='converted'`, `profile_status='onboarded'` |
| **Allowed roles** | branch_head (own branch), admin (all) |

---

### Stage 10 — Rejection / Walk-out Closure

| Layer | Detail |
|-------|--------|
| **Via moveStage** | `POST /api/ats/candidates/:id/move-stage` with `toStage='Rejected'` |
| **Via offer rejection** | `POST /api/ats/onboarding/offers/:id/reject` |
| **Rejection fields** | `ats_candidate_stage_log.remarks`; `ats_offer_approval.remarks`; `ats_offer_approval.action='rejected'` |
| **Email** | `sendRejectedEmail()` logged to `ats_email_log` |
| **Email log columns** | id, candidate_id, email_type, sent_to, status (sent/failed/skipped), error_message, sent_at |

---

### Stage 11 — Training / Post-Selection

- Linked via employee → LMS integration layer (`020_lms_integration.sql`)
- `training_need` table: status (identified/mapped_to_lms/in_training/completed/closed)
- Employee task system: `TRAINING_INDUCTION`, `TRAINING_PROCESS` task types
- No ATS-native training endpoint — hand-off is via employee conversion event

---

## Assessment Fields

No formal assessment endpoint in current code. Fields in use:
- `ats_interview_slot.slot_date`, `slot_time`, `branch_id`, `process_id`, `max_capacity`, `registered`
- `ats_candidate_stage_log.interview_slot_id` links a stage move to a slot
- Assessment scores: not in schema — custom remarks used

---

## Rejection Fields Summary

| Table | Column | Notes |
|-------|--------|-------|
| `ats_candidate` | `current_stage='Rejected'` | Stage value |
| `ats_candidate_stage_log` | `to_stage, remarks, updated_by` | Audit trail |
| `ats_offer_approval` | `action='rejected', remarks` | Offer-level rejection |
| `ats_onboarding_request` | `status='rejected'` | Request-level rejection |
| `ats_email_log` | `email_type='rejected'` | Email audit |

---

## Offer / BGV / Training Fields

### Offer (ats_employment_offer)
emp_type (OnRoll/OffRoll), date_of_joining, date_of_salary, profile, department_id, designation_id, cost_centre, reporting_manager_id, role_type, salary_band, offered_ctc, basic, hra, conveyance, da, special_allowance, other_allowance, bonus, gross, pf_employee, pf_employer, esic_employee, esic_employer, professional_tax, gratuity, admin_charges, net_in_hand, status (draft/submitted)

### BGV (candidate_bgv_check)
check_type, status (pending/clear/adverse), verified_at, match_score, matched_name, matched_dob, remarks, verified_by

### Training (training_need + employee_task)
status (identified/mapped_to_lms/in_training/completed/closed), task_type (TRAINING_INDUCTION/TRAINING_PROCESS), assigned_to, due_date, completed_at

---

## Open Scope Gaps (post-S4)

| # | Priority | Endpoint | Gap | Status |
|---|----------|----------|-----|--------|
| CI-BGV-01 | P0 | `POST /api/ats/bgv/provider/callback` | No provider signature validation | 🔴 Open |
| CI-FP-01 | P0 | `POST /api/ats-full-parity/intake` | Public endpoint accepts PII, no auth | 🔴 Open |
| CI-FP-02 | P0 | `POST /api/ats-full-parity/bgv` | Public BGV submission, no token | 🔴 Open |
| CI-FP-03 | P0 | `POST /api/ats-full-parity/doc-upload-response` | Public doc upload, no validation | 🔴 Open |
| CI-FP-04 | P0 | `POST /api/ats-full-parity/recruiter-devices` | Public device registration | 🔴 Open |
| SG-006 | P1 | `GET /api/ats/candidates/:id/stage-logs` | No row-scope | 🔴 Open |
| SG-007 | P1 | `GET/POST/PATCH /api/ats/onboarding-bridge` | No row-scope | 🔴 Open |
| SG-008 | P1 | `POST /api/ats/onboarding/send-token/:id` | No row-scope | 🔴 Open |
| SG-009 | P1 | `POST/PATCH /api/ats/onboarding/requests/:id/offer` | No row-scope | 🔴 Open |
| SG-010 | P1 | All 6 BGV HR endpoints | No row-scope | 🔴 Open |
| SG-011 | P1 | `GET/PATCH /api/ats/onboarding-full/candidate/:id` | No row-scope | 🔴 Open |
| SG-012 | P1 | `/api/ats-full-parity/web-data`, `/queue`, `/journey` | No row-scope | 🔴 Open |
| SG-013 | P2 | `GET /api/ats/stats` | No scope filtering for non-admin | 🔴 Open |
| SG-014 | P2 | `POST /api/ats/onboarding-full/family` | Family member names unmasked | 🔴 Open |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial journey map from code |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope fixes noted |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: CI-001 recorded; full journey documented |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: approve/reject scope fixed; full API audit complete; 14 open gaps recorded |

---

*End of ATS E2E Journey Map*
