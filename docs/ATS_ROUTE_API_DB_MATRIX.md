# ATS Route ↔ API ↔ Database Matrix

> Version: 1.0.0  
> Date: 2026-06-10  
> Commit: `5488cef4805fd5fc41b3b77e9a802ab11b37ed26`

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
| `/ats/waiting-queue` | `GET /api/ats/waiting-queue` | 200 | `ats_candidate` | 🟡 | No scope filter in SQL |
| `/ats/walkin-queue` | `GET /api/ats/walkin-queue` | 200 | `ats_candidate` | 🟡 | No scope filter in SQL |
| `/ats/candidate-master` | `GET /api/ats/candidates` | 200 | `ats_candidate` | 🟡 | `buildScopeWhereClause` applied but detail lacks scope |
| `/ats/candidate-master` | `GET /api/ats/candidates/:id` | 200 | `ats_candidate` | 🔴 | **No row-scope check** |
| `/ats/candidate-master` | `PUT /api/ats/candidates/:id` | 200 | `ats_candidate` | ✅ | Role-gated |
| `/ats/candidate-master` | `POST /api/ats/candidates/:id/move-stage` | 200 | `ats_candidate` + `ats_candidate_stage_log` | ✅ | Email side-effects fire-and-forget |
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
| `/ats/candidate-master` | `POST /api/ats/convert/:candidateId` | 201 | `ats_candidate` + `employees` + `ats_onboarding_bridge` | 🔴 | **No actor scope check** |

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

### 6. BGV & Extensions

| Frontend Route | Backend API | HTTP | DB Tables | Status | Notes |
|----------------|-------------|------|-----------|--------|-------|
| `/ats/bgv` | `/api/ats/bgv/...` | — | — | 🟡 | External router; not audited in this baseline |
| `/ats/extensions` | `/api/ats-ext/...` | — | — | 🟡 | External module; not audited in this baseline |

---

## SQL Injection / Parameterization Audit

| Endpoint | Dynamic SQL | Parameterized | Risk |
|----------|-------------|---------------|------|
| `GET /api/ats/candidates` | `WHERE` clause built from filters | ✅ Yes | Low |
| `GET /api/ats/walkin-queue` | Static SQL | ✅ Yes | None |
| `GET /api/ats/waiting-queue` | Static SQL | ✅ Yes | None |
| `POST /api/ats/candidates/:id/upload` | `UPDATE ... SET ${updateField} = ?` | ⚠️ Column name interpolated | **Medium** — `updateField` is hard-coded to `resume_url`/`selfie_url`, but pattern is risky |
| `POST /api/ats/convert/:id` | Static INSERT/UPDATE | ✅ Yes | Low |
| Offer save (`saveOffer`) | Large static INSERT/UPDATE | ✅ Yes | Low |

---

*End of Matrix*
