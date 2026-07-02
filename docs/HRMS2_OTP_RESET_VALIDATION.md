# HRMS2 OTP Password Reset Runtime Validation

## Purpose
Production runtime validation checklist for the OTP-based password reset flow.

---

## Pre-conditions
- Backend running at http://localhost:5056
- A valid registered user exists (known email and phone)
- `auth_otp_reset` table exists in `mas_hrms`

---

## Test Cases

| # | Test | Steps | Expected Result | Actual Result | Status |
|---|------|--------|-----------------|---------------|--------|
| T-01 | POST /api/auth/forgot-password with valid email | Send `{ "identifier": "user@example.com" }` | Generic success response — must NOT contain "OTP sent to user@example.com" or reveal delivery channel | — | PENDING |
| T-02 | POST /api/auth/forgot-password with valid phone | Send `{ "identifier": "9999999999" }` | Generic success response — must NOT reveal "OTP sent to phone" | — | PENDING |
| T-03 | POST /api/auth/forgot-password with unknown phone/email | Send `{ "identifier": "unknown@notexist.com" }` | Same generic success response as T-01/T-02 — no enumeration leak | — | PENDING |
| T-04 | POST /api/auth/forgot-password/verify-otp with wrong OTP | Send `{ "identifier": "user@example.com", "otp": "000000" }` | HTTP 400 — `"invalid OTP"` | — | PENDING |
| T-05 | POST /api/auth/forgot-password/verify-otp with expired OTP | Wait for OTP TTL to expire, then submit correct OTP value | HTTP 400 — `"OTP expired"` | — | PENDING |
| T-06 | POST /api/auth/forgot-password/verify-otp with valid OTP | Submit correct OTP within TTL window | HTTP 200 — success + `password_reset_token` in response | — | PENDING |
| T-07 | POST /api/auth/reset-password with new password | Send `{ "token": "<reset_token>", "new_password": "NewPass@123" }` | HTTP 200 — password updated successfully | — | PENDING |
| T-08 | POST /api/auth/login with new password | Send `{ "identifier": "user@example.com", "password": "NewPass@123" }` | HTTP 200 — valid JWT returned, login succeeds | — | PENDING |

---

## SQL Verification Query

```sql
SELECT id, used, expires_at
FROM auth_otp_reset
WHERE user_id = '<id>'
ORDER BY created_at DESC
LIMIT 1;
```

**Expected:** After T-06, `used = 1`; `expires_at` is in the past or OTP is marked consumed.

---

## Summary Table

| Test | Status |
|------|--------|
| T-01: Valid email → generic response | PENDING |
| T-02: Valid phone → generic response | PENDING |
| T-03: Unknown identifier → generic response (no enumeration) | PENDING |
| T-04: Wrong OTP → invalid OTP error | PENDING |
| T-05: Expired OTP → OTP expired error | PENDING |
| T-06: Valid OTP → success + reset token | PENDING |
| T-07: Reset password → 200 success | PENDING |
| T-08: Login with new password → success | PENDING |

---

**Validated by:** ___________________  
**Date:** ___________________  
**Environment:** ___________________
