# HRMS2 Auth / 2FA Runtime Validation

**Date:** 2026-06-25  
**Backend URL:** http://localhost:5056 (or production URL)  
**Status:** PENDING — checklist to be executed against running backend

---

## Prerequisites

- Backend running: `pm2 status` or `node dist/server.js`
- Migrations 303/305/306 applied
- At least one user with `two_factor_enabled = 1` in `auth_user`
- Valid employee with `active_status = 0` for inactive test
- Valid user with `is_read_only = 1` for read-only test

---

## Test 1 — Login with 2FA enabled

```bash
curl -X POST http://localhost:5056/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"2fa-user@example.com","password":"password123"}'
```

**Expected response:**
```json
{
  "success": true,
  "twoFactorRequired": true,
  "preAuthToken": "<short-lived token>",
  "message": "OTP sent"
}
```

**Result:** _(pending)_  
**Pass criteria:** `twoFactorRequired=true` present; `preAuthToken` present (NOT a full `accessToken`)

---

## Test 2 — Use pre_auth token on protected API (must be blocked)

```bash
curl http://localhost:5056/api/employees \
  -H "Authorization: Bearer <preAuthToken from Test 1>"
```

**Expected response:**
```json
{
  "success": false,
  "message": "2FA verification required",
  "twoFactorRequired": true
}
```
HTTP status: 401

**Result:** _(pending)_  
**Pass criteria:** 401 returned, not employee data

---

## Test 3 — Send 2FA OTP

```bash
curl -X POST http://localhost:5056/api/auth/2fa/send \
  -H "Authorization: Bearer <preAuthToken>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** 200 success, OTP sent to registered phone

**Result:** _(pending)_

---

## Test 4 — Verify OTP and get full token

```bash
curl -X POST http://localhost:5056/api/auth/2fa/verify \
  -H "Authorization: Bearer <preAuthToken>" \
  -H "Content-Type: application/json" \
  -d '{"otp":"<otp-from-sms>"}'
```

**Expected:**
```json
{
  "success": true,
  "accessToken": "<full-access-token>"
}
```

**Result:** _(pending)_  
**Pass criteria:** `accessToken` returned (different from `preAuthToken`)

---

## Test 5 — Use full access token on protected API

```bash
curl http://localhost:5056/api/employees \
  -H "Authorization: Bearer <accessToken from Test 4>"
```

**Expected:** 200 with employee data

**Result:** _(pending)_

---

## Test 6 — Login with employee code

```bash
curl -X POST http://localhost:5056/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"employeeCode":"EMP0001","password":"password123"}'
```

**Expected:** Login succeeds (or 2FA flow if enabled)

**Result:** _(pending)_

---

## Test 7 — Login with inactive employee

```bash
# First set employee inactive in DB, then attempt login
curl -X POST http://localhost:5056/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"inactive-user@example.com","password":"password123"}'
```

**Expected:** 401 or 403 with message indicating inactive/blocked

**Result:** _(pending)_

---

## Test 8 — Read-only user login and write block

```bash
# Login as read-only user (is_read_only=1 in auth_user)
# Then attempt a POST:
curl -X POST http://localhost:5056/api/employees \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test"}'
```

**Expected:** Login succeeds; POST returns 403 (write blocked for read-only user)

**Result:** _(pending)_  
**Note:** Read-only enforcement must be at API middleware level

---

## Summary Table

| Test | Description | Expected | Result | Pass/Fail |
|---|---|---|---|---|
| T1 | 2FA login | pre_auth token returned | PENDING | PENDING |
| T2 | pre_auth on protected route | 401 twoFactorRequired | PENDING | PENDING |
| T3 | Send OTP | OTP delivered to phone | PENDING | PENDING |
| T4 | Verify OTP → full token | accessToken returned | PENDING | PENDING |
| T5 | Full token on protected route | 200 success | PENDING | PENDING |
| T6 | Employee code login | success | PENDING | PENDING |
| T7 | Inactive employee login | blocked | PENDING | PENDING |
| T8 | Read-only write block | 403 | PENDING | PENDING |

**Overall status: PENDING**
