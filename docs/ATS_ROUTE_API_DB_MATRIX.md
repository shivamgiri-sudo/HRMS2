# ATS Route ↔ API ↔ Database Matrix

> Version: 3.0.0  
> Date: 2026-06-10  
> Commit: post-S3 (see git log)
> Session: 3 — BGV, onboarding-full, extensions, full-parity routes added

---

## Legend

| Symbol | Meaning |
|--------|---------|
| ✅ | Implemented & verified |
| 🟡 | Implemented with known gaps |
| 🔴 | Missing / broken |
| N/A | Not applicable |

---

## Matrix

### 1. Public Candidate Registration Flow

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/interview-registration` | `POST /api/ats/candidates` | 201 | `ats_candidate` | ✅ | Public; duplicate mobile guard |
| `/interview-registration` | `POST /api/ats/candidates/:id/upload` | 200 | `ats_candidate` (resume_url / selfie_url) | ✅ | Public; 1-hr window |
| `/interview-registration` | `GET /api/ats/form-config/bootstrap` | 200 | `ats_form_config*` | ✅ | Public; form field schema |
| `/onboard?token=...` | `GET /api/ats/onboarding/validate-token` | 200 | `ats_onboarding_bridge` | ✅ | Public |
| `/onboard?token=...` | `POST /api/ats/onboarding/submit-profile` | 200 | `ats_candidate` | ✅ | Public; updates profile fields |

### 2. Recruiter / HR Dashboard & Queue

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/dashboard` | `GET /api/ats/stats` | 200 | `ats_candidate` | ✅ | Filters: date, branch, process |
| `/ats/dashboard-v2` | `GET /api/ats/stats` | 200 | `ats_candidate` | ✅ | Same endpoint |
| `/ats/command-center` | `GET /api/ats/stats` | 200 | `ats_candidate` | ✅ | Same endpoint |
| `/ats/waiting-queue` | `GET /api/ats/waiting-queue` | 200 | `ats_candidate` | ✅ | `buildScopeWhereClause` injected S2 |
| `/ats/walkin-queue` | `GET /api/ats/walkin-queue` | 200 | `ats_candidate` | ✅ | `buildScopeWhereClause` injected S2 |
| `/ats/candidate-master` | `GET /api/ats/candidates` | 200 | `ats_candidate` | ✅ | `buildScopeWhereClause` applied |
| `/ats/candidate-master` | `GET /api/ats/candidates/:id` | 200 | `ats_candidate` | ✅ | `hasScopedAccess` added S2 |
| `/ats/candidate-master` | `PUT /api/ats/candidates/:id` | 200 | `ats_candidate` | ✅ | `hasScopedAccess` added S2 |
| `/ats/candidate-master` | `POST /api/ats/candidates/:id/move-stage` | 200 | `ats_candidate` + `ats_candidate_stage_log` | ✅ | `hasScopedAccess` added S2; email fire-and-forget |
| `/ats/candidate-master` | `GET /api/ats/candidates/:id/stage-logs` | 200 | `ats_candidate_stage_log` | ✅ | Audit trail |
| `/ats/recruiter/my-candidates` | `GET /api/ats/candidates` | 200 | `ats_candidate` | 🟡 | Same scope gap as list |
| `/ats/recruiter/workspace` | `GET /api/ats/candidates` | 200 | `ats_candidate` | 🟡 | Same scope gap as list |
| `/ats/sourcing-analysis` | `GET /api/ats/stats` | 200 | `ats_candidate` | ✅ | by_source aggregation |
| `/ats/sourcing-analysis` | `GET /api/ats/sourcing-channels` | 200 | `ats_sourcing_channel` | ✅ | Reference data |

### 3. Onboarding Bridge & Offer

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/onboarding-bridge` | `POST /api/ats/onboarding-bridge` | 201 | `ats_onboarding_bridge` | ✅ | HR only |
| `/ats/onboarding-bridge` | `PATCH /api/ats/onboarding-bridge/:id` | 200 | `ats_onboarding_bridge` | ✅ | HR only |
| `/ats/onboarding-requests` | `GET /api/ats/onboarding/requests` | 200 | `ats_onboarding_request` + `ats_candidate` + `ats_employment_offer` | 🟡 | No branch scope in query |
| `/ats/onboarding-requests` | `POST /api/ats/onboarding/send-token/:id` | 200 | `ats_onboarding_bridge` + `ats_onboarding_request` | ✅ | 7-day expiry |
| `/ats/onboarding-requests` | `POST /api/ats/onboarding/calculate-salary` | 200 | `salary_band_master` | ✅ | CTC → components |
| `/ats/onboarding-requests` | `POST /api/ats/onboarding/requests/:id/offer` | 200 | `ats_employment_offer` | ✅ | Draft or submit |
| `/ats/onboarding-requests` | `PATCH /api/ats/onboarding/requests/:id/offer` | 200 | `ats_employment_offer` | ✅ | Update draft |
| `/ats/offer-approvals` | `GET /api/ats/onboarding/pending-approval` | 200 | `ats_employment_offer` + `ats_onboarding_request` + `ats_candidate` | 🟡 | No branch scope in query |
| `/ats/offer-approvals` | `POST /api/ats/onboarding/offers/:id/approve` | 200 | `ats_employment_offer`, `employees`, `auth_user`, `employee_salary_snapshot`, `ats_offer_approval`, `ats_onboarding_request`, `ats_onboarding_bridge`, `ats_candidate`, `user_roles` | ✅ | Full transaction; welcome email |
| `/ats/offer-approvals` | `POST /api/ats/onboarding/offers/:id/reject` | 200 | `ats_employment_offer` + `ats_offer_approval` + `ats_onboarding_request` | ✅ | Reverts offer status |

### 4. Conversion Flow

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/candidate-master` | `POST /api/ats/convert/:candidateId` | 201 | `ats_candidate` + `employees` + `ats_onboarding_bridge` | ✅ | `hasScopedAccess` added S2; test mock pending |

### 5. Form Configuration

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/form-config` | `GET /api/ats/form-config` | 200 | `ats_form_config*` | ✅ | HR/Admin |
| `/ats/form-config` | `PUT /api/ats/form-config/fields` | 200 | `ats_form_config*` | ✅ | HR/Admin |
| `/ats/form-config` | `PUT /api/ats/form-config/:key` | 200 | `ats_form_config*` | ✅ | HR/Admin |
| `/ats/form-config` | `GET /api/ats/recruiters` | 200 | `ats_recruiters*` | ✅ | HR/Admin |
| `/ats/form-config` | `POST /api/ats/recruiters` | 201 | `ats_recruiters*` | ✅ | HR/Admin |
| `/ats/form-config` | `PATCH /api/ats/recruiters/:id` | 200 | `ats_recruiters*` | ✅ | HR/Admin |
| `/ats/form-config` | `DELETE /api/ats/recruiters/:id` | 200 | `ats_recruiters*` | ✅ | HR/Admin |

### 6. BGV (Audited S3)

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/bgv` | `GET /api/ats/bgv/queue` | 200 | `ats_candidate`, `candidate_bgv_check` | 🟡 | Role-gated; ⚠ no row-scope |
| `/ats/bgv` | `GET /api/ats/bgv/candidates/:id` | 200 | `candidate_bgv_consent`, `candidate_bgv_check`, `candidate_onboarding_document`, `candidate_bank_verification` | 🟡 | Role-gated; ⚠ no row-scope |
| `/ats/bgv` | `POST /api/ats/bgv/candidates/:id/manual-review` | 200 | `candidate_bgv_check` | 🟡 | admin/hr; ⚠ no row-scope |
| `/ats/bgv` | `POST /api/ats/bgv/candidates/:id/waive` | 200 | `candidate_bgv_exception` | 🟡 | admin/hr; ⚠ no row-scope |
| `/onboard-full` | `POST /api/ats/bgv/consent` | 200 | `candidate_bgv_consent` | ✅ | Token-based public |
| `/onboard-full` | `POST /api/ats/bgv/verify/pan` | 200 | `candidate_bgv_check`, `candidate_onboarding_profile` | ✅ | Token-based public |
| `/onboard-full` | `POST /api/ats/bgv/verify/bank` | 200 | `candidate_bank_verification`, `candidate_onboarding_bank_detail` | ✅ | Token-based public |
| `/onboard-full` | `POST /api/ats/bgv/verify/aadhaar-offline` | 200 | `candidate_bgv_check`, `candidate_onboarding_document` | ✅ | Token-based public |
| `/onboard-full` | `POST /api/ats/bgv/digilocker/start` | 200 | `candidate_digilocker_session` | ✅ | Token-based public |

### 7. Onboarding Full Profile (Audited S3)

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/onboard-full` | `GET /api/ats/onboarding-full/validate-token` | 200 | `ats_onboarding_bridge`, `ats_candidate` | ✅ | Public token |
| `/onboard-full` | `GET /api/ats/onboarding-full/status` | 200 | All candidate_onboarding_* tables | ✅ | Full status |
| `/onboard-full` | `POST /api/ats/onboarding-full/employee-details` | 200 | `candidate_onboarding_profile`, `ats_candidate` | ✅ | Hashed PII |
| `/onboard-full` | `POST /api/ats/onboarding-full/bank-details` | 200 | `candidate_onboarding_bank_detail` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/qualification` | 200 | `candidate_onboarding_qualification` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/family` | 200 | `candidate_onboarding_family` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/experience` | 200 | `candidate_onboarding_experience` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/final` | 200 | `candidate_onboarding_profile` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/submit` | 200 | `candidate_onboarding_submission_log` | ✅ | |
| `/onboard-full` | `POST /api/ats/onboarding-full/documents` | 200 | `candidate_onboarding_document` | ✅ | File upload |

### 8. Extensions / Requisitions (Audited S3)

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/extensions` | `GET /api/ats-ext/requisitions` | 200 | `manpower_requisition` | 🟡 | Role-gated; scope unclear |
| `/ats/extensions` | `POST /api/ats-ext/requisitions` | 201 | `manpower_requisition` | 🟡 | |
| `/ats/extensions` | `PUT /api/ats-ext/requisitions/:id` | 200 | `manpower_requisition` | 🟡 | |
| `/ats/extensions` | `DELETE /api/ats-ext/requisitions/:id` | 200 | `manpower_requisition` | 🟡 | |

### 9. Full Parity Command Center (Audited S3)

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/command-center` | `GET /api/ats-full-parity/web-data` | 200 | `ats_candidate`, multiple | 🟡 | Diagnostics; scope unclear |
| `/ats/command-center` | `GET /api/ats-full-parity/journey` | 200 | `ats_candidate`, logs | 🟡 | By candidate code/name |
| `/ats/command-center` | `GET /api/ats-full-parity/health` | 200 | Multiple | 🟡 | System health |
| `/ats/command-center` | `POST /api/ats-full-parity/jobs/sla-check` | 200 | — | 🟡 | Admin job |
| `/ats/command-center` | `POST /api/ats-full-parity/jobs/repair` | 200 | `ats_candidate`, bridgess | 🟡 | Repair/sync job |
| `/ats/command-center` | `GET /api/ats-full-parity/daily-report/snapshot` | 200 | `ats_candidate` | 🟡 | Daily snapshot |

### 10. PII / Security Audit

| Issue | Endpoint | Risk | Status |
|-------|----------|------|--------|
| **CI-001** | `POST /api/ats/onboarding/submit-profile` | ⚠ Aadhaar/PAN/bank written as plain text to `ats_candidate` | **✅ Fixed S4 — masked display + SHA-256 hash stored; migration 126 adds hash columns** |
| Safe | `POST /api/ats/onboarding-full/employee-details` | ✅ hashed/masked via `candidate_onboarding_profile` | ✅ |
| Medium | `POST /api/ats/candidates/:id/upload` | Column name interpolated but hard-coded to `resume_url`/`selfie_url` | 🟡 Monitor |
| **CI-BGV-01** | `POST /api/ats/bgv/provider/callback` | ⚠ No provider signature validation — BGV results can be forged | **🔴 CRITICAL** |
| **CI-FP-01** | `POST /api/ats-full-parity/intake` | ⚠ Public endpoint accepts PII without auth | **🔴 CRITICAL** |
| **CI-FP-02** | `POST /api/ats-full-parity/bgv` | ⚠ Public BGV submission without token | **🔴 CRITICAL** |
| **CI-FP-03** | `POST /api/ats-full-parity/doc-upload-response` | ⚠ Public doc upload without validation | **🔴 CRITICAL** |
| **CI-FP-04** | `POST /api/ats-full-parity/recruiter-devices` | ⚠ Public device registration without auth | **🔴 HIGH** |
| P2 | `POST /api/ats/onboarding-full/family` | Family member names stored unmasked | 🟡 Open |

---

## SQL Injection / Parameterization Audit

| Endpoint | Dynamic SQL | Parameterized | Risk |
|----------|-------------|---------------|------|
| `GET /api/ats/candidates` | `WHERE` clause built from filters | ✅ Yes | Low |
| `GET /api/ats/walkin-queue` | Scope SQL appended dynamically | ✅ Yes (scope params bound) | Low |
| `GET /api/ats/waiting-queue` | Scope SQL appended dynamically | ✅ Yes (scope params bound) | Low |
| `POST /api/ats/candidates/:id/upload` | `UPDATE ... SET ${updateField} = ?` | ⚠️ Column name interpolated | **Medium** — `updateField` is hard-coded to `resume_url`/`selfie_url`, but pattern is risky |
| `POST /api/ats/convert/:id` | Static INSERT/UPDATE | ✅ Yes | Low |
| Offer save (`saveOffer`) | Large static INSERT/UPDATE | ✅ Yes | Low |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Audit Agent | Initial matrix |
| 2.0.0 | 2026-06-10 | Audit Agent | Session 2: scope enforcement applied to 6 endpoints; matrix statuses updated |
| 3.0.0 | 2026-06-10 | Audit Agent | Session 3: BGV, onboarding-full, extensions, full-parity routes added; CI-001 PII issue recorded |
| 4.0.0 | 2026-06-10 | Audit Agent | Session 4: CI-001 fixed; migration 126; approve/reject scope fixed; 5 new P0/P1 issues from full-parity audit |

---

*End of Matrix*
