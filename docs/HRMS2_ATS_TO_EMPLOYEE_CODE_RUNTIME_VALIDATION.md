# HRMS2 ATS-to-Employee-Code End-to-End Runtime Validation

## Purpose
Production runtime validation checklist for the full ATS pipeline from candidate creation through employee code generation.

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid recruiter and HR Admin tokens available
- ATS, onboarding bridge, and employee tables exist in `mas_hrms`

---

## Flow Stages

| # | Stage | Steps | Expected Result | Actual Result | Status |
|---|-------|--------|-----------------|---------------|--------|
| S-01 | Recruiter creates candidate | POST /api/ats/candidates with job_opening_id, name, phone, email | Candidate record created, `current_stage = applied` | — | PENDING |
| S-02 | Candidate moves through ATS stages to selected | Advance through screening → interview → offer → selected via stage-change API | `current_stage = selected` in `ats_candidate` | — | PENDING |
| S-03 | Onboarding link generated | POST /api/ats/candidates/:id/generate-onboarding-link | Returns onboarding URL, `onboarding_link_sent = true` | — | PENDING |
| S-04 | Candidate opens /onboard-full and completes OTP | Navigate to onboarding URL, enter phone OTP | OTP verified, candidate session established | — | PENDING |
| S-05 | Onboarding form submitted | Candidate fills and submits personal/bank/address details | Form saved, `onboarding_status = form_submitted` | — | PENDING |
| S-06 | Documents uploaded | Candidate uploads Aadhaar, PAN, photo, certificates | Documents stored, `docs_uploaded = true` | — | PENDING |
| S-07 | BGV status: completed/approved/cleared | HR marks BGV result | `bgv_status = cleared` or `approved` in bridge record | — | PENDING |
| S-08 | Name consistency: passed or approved | System or HR validates name across documents | `name_consistency_status = passed` or `approved` | — | PENDING |
| S-09 | Payroll HR validation completed | Payroll HR reviews and approves compensation inputs | `payroll_hr_validated = true` | — | PENDING |
| S-10 | BM/JCLR approval completed | Branch Manager completes JCLR approval step | `bm_jclr_approved = true` | — | PENDING |
| S-11 | JCLR entry completed | JCLR data entered and confirmed | `jclr_entry_status = completed` | — | PENDING |
| S-12 | Statutory/EPF completed | EPF/UAN/ESIC data verified | `statutory_epf_status = completed` | — | PENDING |
| S-13 | Salary slab assigned (governance gate must pass) | Assign salary slab; governance gate validates slab + CTC match | HTTP 201, `salary_slab_id` set; governance gate blocks mismatched CTC | — | PENDING |
| S-14 | Appointment e-sign or policy override approved | Candidate e-signs appointment letter OR manual override approved by authorised user | `appointment_status = finalized_locked` or `override_approved` | — | PENDING |
| S-15 | Employee code gate check passes | System evaluates all gate conditions | All gates green; gate check returns `ready = true` | — | PENDING |
| S-16 | Employee code generated | POST /api/ats/candidates/:id/generate-employee-code | HTTP 200, `employee_code` assigned, employee record created in `employees` | — | PENDING |

---

## SQL Verification Queries

```sql
-- Check candidate stage and employee code
SELECT employee_code, current_stage
FROM ats_candidate
WHERE id = '<candidate_id>';

-- Check onboarding bridge
SELECT employee_code, bridge_status
FROM ats_onboarding_bridge
WHERE candidate_id = '<candidate_id>';

-- Verify employee record created
SELECT employee_code
FROM employees
WHERE employee_code = '<generated_code>';

-- Audit trail
SELECT *
FROM sensitive_action_log
WHERE entity_type = 'employee_code'
ORDER BY created_at DESC
LIMIT 5;
```

---

## Summary Table

| Stage | Status |
|-------|--------|
| S-01: Recruiter creates candidate | PENDING |
| S-02: Candidate reaches selected stage | PENDING |
| S-03: Onboarding link generated | PENDING |
| S-04: Candidate OTP verified on /onboard-full | PENDING |
| S-05: Onboarding form submitted | PENDING |
| S-06: Documents uploaded | PENDING |
| S-07: BGV completed/cleared | PENDING |
| S-08: Name consistency passed | PENDING |
| S-09: Payroll HR validation completed | PENDING |
| S-10: BM/JCLR approval completed | PENDING |
| S-11: JCLR entry completed | PENDING |
| S-12: Statutory/EPF completed | PENDING |
| S-13: Salary slab assigned (governance gate passed) | PENDING |
| S-14: Appointment e-sign or override approved | PENDING |
| S-15: Employee code gate check passes | PENDING |
| S-16: Employee code generated | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
