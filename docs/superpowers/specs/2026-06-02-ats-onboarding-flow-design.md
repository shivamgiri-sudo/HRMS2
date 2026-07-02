# ATS → Candidate Onboarding → Employee Activation — Design Spec
**Date:** 2026-06-02
**Status:** Approved

---

## 1. Goal

Build the complete flow from candidate walk-in registration through HR employment offer, Branch Head salary approval, and final employee account activation — with email notifications at every stage and salary auto-calculation from offered CTC per Indian statutory laws.

---

## 2. End-to-End Flow

```
STAGE 1: CANDIDATE REGISTRATION
  Walk-in fills public form → ats_candidate row created
  profile_status = 'registered'
  ✉ "Registration Successful — Your ID is CND-XXXXX"

STAGE 2: INTERVIEW & DECISION
  HR/Recruiter moves stage → "Selected"
  profile_status = 'selected'
  ✉ "Congratulations! You have been selected at MAS Callnet [Branch]"
  → ats_onboarding_request auto-created for the branch HR queue

  OR HR moves stage → "Rejected"
  ✉ "Thank you for visiting MAS Callnet"

STAGE 3: CANDIDATE PROFILE COMPLETION
  Branch HR accepts request → generates onboarding_token (7-day expiry)
  profile_status = 'onboarding_sent'
  ✉ "Complete your joining formalities — [secure link valid 7 days]"

  Candidate opens /onboard?token=xxx
  Pre-populated: name, mobile, email, branch, process (from ATS)
  Candidate fills:
    - Father's Name
    - Date of Birth
    - Current Address, Permanent Address
    - Aadhaar Number (optional verification)
    - PAN Number (optional verification)
    - UAN Number (optional — fresher may not have one)
    - Bank Account, IFSC, Bank Name
    - Emergency Contact Name + Mobile
    - Resume upload, Photo upload
  profile_status = 'profile_submitted'

STAGE 4: HR EMPLOYMENT OFFER
  Branch HR opens submitted profile in /ats/onboarding-requests
  HR fills employment details:
    - OnRoll / OffRoll
    - Date of Joining (default = onboarding date)
    - Date of Salary Start
    - Profile, Department, Designation
    - Cost Centre
    - Reporting Manager (employee code or name lookup)
    - Role Type: Analyst / Support Staff
    - Salary Band (from salary_band_master)
    - Offered CTC → AUTO-CALCULATES all salary components
  HR submits offer → ats_employment_offer.status = 'submitted'
  ✉ Branch Head(s) notified: "New offer awaiting your approval"

STAGE 5: BRANCH HEAD APPROVAL
  Branch Head reviews at /ats/offer-approvals
  → Approve OR Reject (with remarks)

  On APPROVE:
    - Employee Code generated (MAS + zero-padded sequence)
    - auth_user row created (email + temp password = mobile last 4 digits + @MAS)
    - employees row created (all fields from ATS profile + offer)
    - employee_statutory_info row (Aadhaar, PAN, UAN, PF/ESIC eligibility)
    - employee_bank_detail row
    - employee_salary_snapshot row (all salary components)
    - employee_client_mapping row (CostCentre)
    - user_roles row (role = 'employee')
    - ats_onboarding_bridge.status = 'joined'
    - profile_status = 'onboarded'
    ✉ Welcome email to candidate:
      "Your Employee ID is MAS00XXX. Login at [URL] with your credentials."

STAGE 6: EMPLOYEE ACTIVE
  Employee logs in with temp credentials → all HRMS employee pages accessible
  Employee prompted to change password on first login
```

---

## 3. Database — New Migration `054_ats_onboarding_flow.sql`

### 3.1 ALTER ats_candidate — add 30 columns (all nullable, additive)

**Registration fields (missing from current schema):**
- `address` TEXT
- `education` VARCHAR(100)
- `experience` VARCHAR(50)
- `rotational_shift` TINYINT(1)
- `preferred_shift` VARCHAR(50)
- `night_shift_ok` VARCHAR(50)
- `leaves_in_3months` TINYINT(1)
- `owns_two_wheeler` TINYINT(1)
- `id_proof_available` TINYINT(1)
- `education_proof_available` TINYINT(1)
- `resume_url` VARCHAR(500)
- `selfie_url` VARCHAR(500)
- `recruiter_name` VARCHAR(255)

**Onboarding profile fields:**
- `user_id` CHAR(36) — linked auth_user post-signup
- `profile_status` ENUM('registered','selected','onboarding_sent','profile_submitted','onboarded') DEFAULT 'registered'
- `father_name` VARCHAR(255)
- `current_address` TEXT
- `permanent_address` TEXT
- `aadhar_number` VARCHAR(20)
- `pan_number` VARCHAR(20)
- `uan_number` VARCHAR(50)
- `aadhar_verified` TINYINT(1) DEFAULT 0
- `pan_verified` TINYINT(1) DEFAULT 0
- `bank_account_no` VARCHAR(50)
- `bank_ifsc` VARCHAR(20)
- `bank_name` VARCHAR(100)
- `emergency_contact_name` VARCHAR(255)
- `emergency_contact_mobile` VARCHAR(20)
- `profile_submitted_at` DATETIME

### 3.1b ALTER auth_user — add must_change_password flag

- `must_change_password` TINYINT(1) NOT NULL DEFAULT 0
  — Set to 1 when account is auto-created by HR approval; employee must set their own password on first login.

### 3.2 ALTER ats_onboarding_bridge — add 3 columns

- `onboarding_token` VARCHAR(100) UNIQUE
- `onboarding_token_expires_at` DATETIME
- `hr_approved_by` CHAR(36)
- `hr_approved_at` DATETIME

### 3.3 NEW: `ats_onboarding_request`

```sql
CREATE TABLE IF NOT EXISTS ats_onboarding_request (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id   CHAR(36)    NOT NULL UNIQUE,
  branch_id      CHAR(36),
  requested_by   CHAR(36)    NOT NULL,  -- user who moved to Selected
  assigned_to    CHAR(36),              -- HR assigned to handle
  status         ENUM('pending','in_progress','offer_submitted','approved','rejected')
                             NOT NULL DEFAULT 'pending',
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id)    REFERENCES branch_master(id)  ON DELETE SET NULL,
  INDEX idx_onb_req_branch   (branch_id),
  INDEX idx_onb_req_status   (status)
);
```

### 3.4 NEW: `ats_employment_offer`

```sql
CREATE TABLE IF NOT EXISTS ats_employment_offer (
  id                       CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  onboarding_request_id    CHAR(36)      NOT NULL UNIQUE,
  candidate_id             CHAR(36)      NOT NULL,
  -- Employment details
  emp_type                 ENUM('OnRoll','OffRoll') NOT NULL DEFAULT 'OnRoll',
  date_of_joining          DATE          NOT NULL,
  date_of_salary           DATE,
  profile                  VARCHAR(100),
  department_id            CHAR(36),
  designation_id           CHAR(36),
  cost_centre              VARCHAR(100),
  reporting_manager_id     CHAR(36),
  role_type                ENUM('Analyst','SupportStaff'),
  salary_band              VARCHAR(50),
  -- Salary components (all DECIMAL 12,2)
  offered_ctc              DECIMAL(12,2) NOT NULL,
  basic                    DECIMAL(12,2),
  hra                      DECIMAL(12,2),
  conveyance               DECIMAL(12,2),
  da                       DECIMAL(12,2),
  special_allowance        DECIMAL(12,2),
  other_allowance          DECIMAL(12,2),
  bonus                    DECIMAL(12,2),
  gross                    DECIMAL(12,2),
  pf_employee              DECIMAL(12,2),
  pf_employer              DECIMAL(12,2),
  esic_employee            DECIMAL(12,2),
  esic_employer            DECIMAL(12,2),
  professional_tax         DECIMAL(12,2),
  gratuity                 DECIMAL(12,2),
  admin_charges            DECIMAL(12,2),
  net_in_hand              DECIMAL(12,2),
  -- Workflow
  status                   ENUM('draft','submitted') NOT NULL DEFAULT 'draft',
  created_by               CHAR(36)      NOT NULL,
  submitted_at             DATETIME,
  created_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at               DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (onboarding_request_id) REFERENCES ats_onboarding_request(id) ON DELETE CASCADE,
  FOREIGN KEY (candidate_id)          REFERENCES ats_candidate(id)           ON DELETE CASCADE,
  FOREIGN KEY (department_id)         REFERENCES department_master(id)       ON DELETE SET NULL,
  FOREIGN KEY (designation_id)        REFERENCES designation_master(id)      ON DELETE SET NULL,
  FOREIGN KEY (reporting_manager_id)  REFERENCES employees(id)               ON DELETE SET NULL
);
```

### 3.5 NEW: `ats_offer_approval`

```sql
CREATE TABLE IF NOT EXISTS ats_offer_approval (
  id           CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  offer_id     CHAR(36)    NOT NULL,
  approver_id  CHAR(36)    NOT NULL,
  action       ENUM('approved','rejected') NOT NULL,
  remarks      TEXT,
  action_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (offer_id) REFERENCES ats_employment_offer(id) ON DELETE CASCADE,
  INDEX idx_offer_approval_offer (offer_id)
);
```

### 3.6 NEW: `ats_email_log`

```sql
CREATE TABLE IF NOT EXISTS ats_email_log (
  id             CHAR(36)    NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  candidate_id   CHAR(36)    NOT NULL,
  email_type     ENUM(
    'registration','selected','rejected',
    'token_sent','offer_review','approved','welcome'
  )              NOT NULL,
  sent_to        VARCHAR(255) NOT NULL,
  status         ENUM('sent','failed','skipped') NOT NULL DEFAULT 'sent',
  error_message  TEXT,
  sent_at        DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  INDEX idx_email_log_cand (candidate_id),
  INDEX idx_email_log_type (email_type)
);
```

### 3.7 NEW: `salary_band_master`

```sql
CREATE TABLE IF NOT EXISTS salary_band_master (
  id          CHAR(36)      NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  band_code   VARCHAR(50)   NOT NULL UNIQUE,
  band_name   VARCHAR(100)  NOT NULL,
  min_ctc     DECIMAL(12,2) NOT NULL,
  max_ctc     DECIMAL(12,2) NOT NULL,
  basic_pct   DECIMAL(5,2)  NOT NULL DEFAULT 40.00,  -- % of gross
  hra_pct     DECIMAL(5,2)  NOT NULL DEFAULT 40.00,  -- % of basic
  active_status TINYINT(1)  NOT NULL DEFAULT 1,
  created_at  DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

INSERT INTO salary_band_master (band_code, band_name, min_ctc, max_ctc, basic_pct, hra_pct) VALUES
  ('D', 'Band D — Entry',        80000,   150000,  40.00, 40.00),
  ('C', 'Band C — Junior',      150001,   300000,  40.00, 40.00),
  ('B', 'Band B — Mid',         300001,   600000,  45.00, 40.00),
  ('A', 'Band A — Senior',      600001,  1200000,  50.00, 50.00),
  ('M', 'Band M — Management', 1200001, 99999999,  50.00, 50.00)
ON DUPLICATE KEY UPDATE band_name = VALUES(band_name);
```

---

## 4. Salary Auto-Calculation Logic

Endpoint: `POST /api/ats/onboarding/calculate-salary`
Input: `{ ctc: number, bandCode: string, isMetro?: boolean }`

```
annual_ctc = ctc (already annual figure)

gratuity_annual     = (basic / 26) × 15          (monthly: /12)
pf_employer_annual  = min(basic × 0.12, basic × 0.12)  [capped if basic > 15000]
esic_employer_annual = gross × 0.0325             (only if monthly gross ≤ 21000)
admin_charges_annual = basic × 0.005

gross_annual = annual_ctc - pf_employer_annual - esic_employer_annual
             - gratuity_annual - admin_charges_annual

basic_annual     = gross_annual × (basic_pct / 100)
hra_annual       = basic_annual × (hra_pct / 100)   [metro or non-metro]
conveyance_annual = 19200                            (₹1,600 × 12, standard)
da_annual        = 0
special_annual   = gross_annual - basic_annual - hra_annual - conveyance_annual - da_annual

pf_employee_annual   = min(basic_annual × 0.12, 21600)  [capped at ₹1,800/month]
esic_employee_annual = gross_annual × 0.0075        (only if monthly gross ≤ 21000)
professional_tax_annual = 2400                       (₹200 × 12, state default)
bonus_annual     = basic_annual × 0.0833            (statutory bonus 8.33%)

net_in_hand_annual = gross_annual - pf_employee_annual
                   - esic_employee_annual - professional_tax_annual
```

All values stored monthly (÷ 12) in `ats_employment_offer`.
References `statutory_config` for PF/ESIC rates (already in `mas_hrms`).

---

## 5. Email Templates (6 types)

| Trigger | Template Name | Key Fields |
|---|---|---|
| Candidate created | `registration` | candidateName, candidateCode, branch, recruiterName, recruiterMobile |
| Stage → Selected | `selected` | candidateName, branchName, hrName, hrPhone |
| Stage → Rejected | `rejected` | candidateName, branchName |
| Token generated | `token_sent` | candidateName, onboardingLink (expires in 7 days) |
| Offer submitted to BH | `offer_review` | (internal — to Branch Head user email) candidateName, offerDetails |
| Offer approved | `welcome` | candidateName, employeeCode, loginEmail, tempPassword, loginURL |

All sent via nodemailer (SMTP_HOST/USER/PASS already in `env.ts`). Logged to `ats_email_log` with sent/failed status.

---

## 6. Backend Endpoints

### Public (no auth)
- `POST /api/ats/candidates` — candidate self-registration *(already fixed)*
- `GET /api/ats/form-config/bootstrap` — form config *(already exists)*
- `GET /api/ats/onboarding/validate-token?token=xxx` — validate token, return pre-fill data
- `POST /api/ats/onboarding/submit-profile` — candidate submits profile (token in body)
- `POST /api/auth/register` — updated: accepts `onboardingToken`, validates ATS eligibility

### HR (requireAuth + role: hr, recruiter, admin)
- `POST /api/ats/candidates/:id/send-onboarding` — generate token, create onboarding_request, send email
- `GET /api/ats/onboarding/requests` — list branch onboarding requests (filtered by branch_id)
- `POST /api/ats/onboarding/calculate-salary` — CTC → salary components
- `POST /api/ats/onboarding/requests/:id/offer` — save/submit employment offer
- `PATCH /api/ats/onboarding/requests/:id/offer` — update draft offer

### Branch Head (requireAuth + role: branch_head, admin)
- `GET /api/ats/onboarding/pending-approval` — offers awaiting approval
- `POST /api/ats/onboarding/offers/:id/approve` — approve → activate employee
- `POST /api/ats/onboarding/offers/:id/reject` — reject with remarks

### Email hook (internal, called from stage change)
- Stage move `POST /api/ats/candidates/:id/move-stage` — triggers appropriate email on every stage transition

---

## 7. Frontend Pages

### New Pages
| Page | Route | Who |
|---|---|---|
| `CandidateOnboardingPage` | `/onboard` | Candidate — multi-step form (token validated from `?token=`) |
| `NativeHROnboardingRequests` | existing ATS nav | Branch HR — request list + offer form |
| `NativeBranchHeadApproval` | existing ATS nav | Branch Head — review + approve |

### Updated Pages
- `NativeATSCandidateRegistration.tsx` — POST now sends all 19 form fields (currently 9 are dropped)
- `NativeATSOnboardingBridge.tsx` — add "Send Onboarding Link" button for Selected candidates
- `Auth.tsx` — signup tab reads `?token=` from URL, validates before allowing register

### Candidate Onboarding Page — Steps
1. **Token validation** (auto, shows error if expired)
2. **Personal details** — pre-populated: name, mobile, email; fill: father, DOB, addresses
3. **Statutory details** — Aadhaar, PAN, UAN (all optional, verified via stub)
4. **Bank details** — account no, IFSC, bank name
5. **Emergency contact**
6. **Document upload** — Aadhaar copy, PAN copy, photo, education certificate
7. **Review & Submit**

---

## 8. Employee Code Generation

Format: `MAS` + zero-padded 5-digit sequence
Query: `SELECT MAX(CAST(SUBSTRING(employee_code, 4) AS UNSIGNED)) FROM employees WHERE employee_code LIKE 'MAS%'`
Next code = last + 1, padded to 5 digits (e.g., MAS00043)

---

## 9. Temporary Password Format

`<mobile_last_4_digits>@MAS` — e.g., `6789@MAS`
Sent in welcome email. Employee forced to change on first login (flag: `must_change_password` on `auth_user`).

---

## 10. Files to Create / Modify

### SQL
- `backend/sql/054_ats_onboarding_flow.sql` — all new tables + alters

### Backend (new)
- `backend/src/modules/ats/ats.onboarding.service.ts` — token gen, profile submit, salary calc, approve flow
- `backend/src/modules/ats/ats.onboarding.routes.ts` — all onboarding endpoints
- `backend/src/modules/ats/ats.email.service.ts` — 6 email templates + nodemailer sending + logging
- `backend/src/modules/ats/salary.calculator.ts` — pure CTC → components function

### Backend (updated)
- `backend/src/modules/ats/ats.service.ts` — trigger emails on stage change
- `backend/src/modules/ats/ats.routes.ts` — mount onboarding router
- `backend/src/modules/auth/auth.routes.ts` — onboardingToken validation in register
- `backend/src/modules/auth/auth.service.ts` — `registerFromATS()` helper

### Frontend (new)
- `src/pages/CandidateOnboardingPage.tsx` — 7-step candidate form
- `src/pages/NativeHROnboardingRequests.tsx` — HR request list + offer form with salary calc
- `src/pages/NativeBranchHeadApproval.tsx` — BH review + approve/reject

### Frontend (updated)
- `src/pages/NativeATSCandidateRegistration.tsx` — send all 19 fields in POST body
- `src/pages/NativeATSOnboardingBridge.tsx` — "Send Onboarding Link" button
- `src/pages/Auth.tsx` — token-gated signup
- `src/App.tsx` — add `/onboard` public route

---

## 11. Out of Scope (separate spec)

- Document verification via external Aadhaar/PAN API (Karza/Digio) — stubs only, fires when credentials provided
- Offer letter PDF generation
- LMS learner mapping (covered by LMS integration spec)
- Payroll run activation from this offer (payroll module gate still applies)
