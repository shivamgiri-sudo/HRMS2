# HRMS2 Appointment E-Sign Runtime Validation

## Purpose
Production runtime validation checklist for appointment letter e-sign workflow including candidate signing, manual override path, company sign, and finalization.

---

## Routes
- **Frontend:** `/letters/appointment-esign`
- **Backend:** `/api/letters/appointment/*`

---

## Pre-conditions
- Backend running at http://localhost:5056
- Valid candidate ID at `selected` or post-onboarding stage
- `DIGIO_CLIENT_ID` is NOT configured (pilot mode — mock e-sign path applies)
- HR Admin and authorized approver tokens available

---

## Provider Status Note

> `DIGIO_CLIENT_ID` not configured → candidate e-sign URL is a **mock internal URL** → manual override is the valid production path for pilot.

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | GET /api/letters/appointment/:candidateId | Fetch existing request for candidate | Returns request object or `null` if none exists | — | PENDING |
| T-02 | POST /api/letters/appointment | Create appointment letter request | HTTP 201 — request created, `current_state = draft` | — | PENDING |
| T-03 | POST /api/letters/appointment/:id/candidate-esign/initiate | Initiate candidate e-sign | HTTP 200 — `current_state = candidate_esign_pending`; response contains `esign_url` | — | PENDING |
| T-04 | Verify mock URL returned | Inspect `esign_url` from T-03 | URL is internal/mock (not Digio); note: manual override required for actual signing in pilot | — | PENDING |
| T-05 | POST /api/letters/appointment/:id/manual-override/request | Submit manual override request | HTTP 200 — override request created, pending approval | — | PENDING |
| T-06 | POST /api/letters/appointment/:id/manual-override/approve | Authorised approver approves override | HTTP 200 — state advances past candidate e-sign | — | PENDING |
| T-07 | POST /api/letters/appointment/:id/company-sign | Company signs the letter | HTTP 200 — `current_state = company_signed` | — | PENDING |
| T-08 | POST /api/letters/appointment/:id/finalize | Finalize and lock the letter | HTTP 200 — `current_state = finalized_locked` | — | PENDING |
| T-09 | Confirm audit log written | Check audit table after T-08 | At least one audit row per state transition exists in `appointment_letter_audit` | — | PENDING |

---

## SQL Verification Queries

```sql
-- Check letter state
SELECT current_state, candidate_esign_status, company_sign_status
FROM appointment_letter_request
WHERE id = '<id>';

-- Check audit trail
SELECT *
FROM appointment_letter_audit
WHERE request_id = '<id>'
ORDER BY created_at;
```

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: GET request by candidateId | PENDING |
| T-02: Create request → state = draft | PENDING |
| T-03: Initiate candidate e-sign → state = candidate_esign_pending | PENDING |
| T-04: Mock e-sign URL returned (Digio not configured) | PENDING |
| T-05: Manual override request created | PENDING |
| T-06: Manual override approved → state advances | PENDING |
| T-07: Company sign → state = company_signed | PENDING |
| T-08: Finalize → state = finalized_locked | PENDING |
| T-09: Audit log rows present for all transitions | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
