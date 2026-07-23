# Non-Dashboard Production Hardening Audit

## PR 1: Authentication and Session Security

**Branch:** `fix/auth-session-security`  
**Status:** Ready for review

### Critical Fixes Implemented

#### 1. 2FA Refresh Token Bypass (CRITICAL)

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **File** | `backend/src/modules/auth/auth.service.ts` |
| **Function** | `login()` |
| **Root Cause** | Refresh token was created at lines 328-334 BEFORE checking if 2FA was required |
| **Exploit Scenario** | Attacker with stolen credentials could obtain a refresh token before completing 2FA, then use it to bypass 2FA entirely |
| **Fix** | Restructured login flow: check 2FA requirement FIRST, create `pre_auth_challenge` record, return `refreshToken: null` until 2FA completes |
| **Test** | `auth-security.test.ts` - "login() should NOT create refresh token when 2FA is required" |

#### 2. Open Registration (CRITICAL)

| Field | Value |
|-------|-------|
| **Severity** | Critical |
| **File** | `backend/src/modules/auth/auth.routes.ts` |
| **Function** | `POST /api/auth/register` |
| **Root Cause** | Registration endpoint had no authentication, no invitation validation, no rate limiting |
| **Exploit Scenario** | Anyone could create arbitrary accounts with any email address |
| **Fix** | Require valid `onboardingToken`, `invitationToken`, or `activationToken`; added `authLimiter` |
| **Test** | `auth-security.test.ts` - "register route should require an invitation/onboarding token" |

#### 3. No Token Rotation (HIGH)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **File** | `backend/src/modules/auth/auth.service.ts` |
| **Function** | `refreshAccess()` |
| **Root Cause** | Same refresh token valid for 7 days, no rotation on use |
| **Exploit Scenario** | Stolen refresh token could be used in parallel with legitimate user indefinitely |
| **Fix** | Implemented token rotation: each refresh returns new token, old marked as `rotated_at` |
| **Test** | `auth-security.test.ts` - "refreshAccess() should implement token rotation" |

#### 4. No Token Reuse Detection (HIGH)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **File** | `backend/src/modules/auth/auth.service.ts` |
| **Function** | `refreshAccess()` |
| **Root Cause** | No mechanism to detect if a rotated token was reused (theft indicator) |
| **Exploit Scenario** | Token theft goes undetected |
| **Fix** | Check `rotated_at` on refresh; if set, revoke entire `token_family_id`, log `TOKEN_REUSE_DETECTED` |
| **Test** | `auth-security.test.ts` - "refreshAccess() should detect token reuse" |

#### 5. Missing Refresh Validation (HIGH)

| Field | Value |
|-------|-------|
| **Severity** | High |
| **File** | `backend/src/modules/auth/auth.service.ts` |
| **Function** | `refreshAccess()` |
| **Root Cause** | Refresh didn't check: user blocked, employee status, password changed since token issued |
| **Exploit Scenario** | Blocked user, separated employee, or user with password reset could continue using old tokens |
| **Fix** | Added comprehensive validation: `is_blocked`, `employee_status`, `password_changed_at_snapshot` vs current |
| **Test** | `auth-security.test.ts` - "refreshAccess() should check if user is blocked" etc. |

#### 6. SMS OTP Uses Math.random() (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **File** | `backend/src/modules/auth/auth.service.ts` |
| **Function** | `forgotPasswordOtp()` |
| **Root Cause** | `Math.floor(100000 + Math.random() * 900000)` is not cryptographically secure |
| **Exploit Scenario** | Predictable OTPs under certain conditions |
| **Fix** | Changed to `crypto.randomInt(100000, 1000000)` |
| **Test** | `auth-security.test.ts` - "SMS OTP should use crypto.randomInt() not Math.random()" |

#### 7. requireRole Fails Open on DB Error (MEDIUM)

| Field | Value |
|-------|-------|
| **Severity** | Medium |
| **File** | `backend/src/middleware/requireRole.ts` |
| **Function** | `requireRole()` |
| **Root Cause** | DB errors propagated via `next(err)` to error handler, which might not deny access |
| **Exploit Scenario** | Transient DB errors could potentially allow unauthorized access |
| **Fix** | Changed to fail-closed: return 503 with `AUTH_SERVICE_UNAVAILABLE` on any error |
| **Test** | `auth-security.test.ts` - "requireRole should return 503 on DB errors" |

### Files Modified

| File | Changes |
|------|---------|
| `backend/sql/530_auth_session_security_hardening.sql` | New migration: `pre_auth_challenge` table, token family columns, `auth_invitation` table |
| `backend/src/db/runPendingMigrations.ts` | Added migration to manifest |
| `backend/src/modules/auth/auth.service.ts` | 2FA bypass fix, token rotation, comprehensive validation, crypto.randomInt |
| `backend/src/modules/auth/auth.routes.ts` | Registration gating, refresh token in response, 2FA token returns |
| `backend/src/middleware/requireRole.ts` | Fail-closed authorization |
| `src/contexts/AuthContext.tsx` | Handle token rotation, null refreshToken on 2FA |
| `backend/src/modules/auth/__tests__/auth-security.test.ts` | New: 22 security tests |

### Schema Changes (Additive)

```sql
-- New table
CREATE TABLE pre_auth_challenge (
  id, user_id, challenge_type, issued_at, expires_at, consumed_at, ip_address, user_agent
);

-- New table
CREATE TABLE auth_invitation (
  id, email, invited_by, invitation_type, token_hash, expires_at, consumed_at, created_at
);

-- New columns on auth_refresh_token
ALTER TABLE auth_refresh_token ADD COLUMN token_family_id VARCHAR(36);
ALTER TABLE auth_refresh_token ADD COLUMN previous_token_hash VARCHAR(128);
ALTER TABLE auth_refresh_token ADD COLUMN rotated_at DATETIME;
ALTER TABLE auth_refresh_token ADD COLUMN password_changed_at_snapshot DATETIME;

-- New column on auth_user
ALTER TABLE auth_user ADD COLUMN session_version INT NOT NULL DEFAULT 1;
```

### Test Evidence

```
 Test Files  1 passed (1)
      Tests  22 passed (22)
   Start at  20:25:50
   Duration  1.18s
```

All 22 security contract tests pass:
- 2FA Bypass Prevention (4 tests)
- Registration Security (3 tests)
- Refresh Token Rotation (4 tests)
- Comprehensive Refresh Validation (3 tests)
- Cryptographic Security (1 test)
- Fail-Closed Authorization (2 tests)
- Security Audit Events (3 tests)
- Token Family Tracking (2 tests)

### Rollback Plan

1. Revert commit
2. No backward migration needed (all schema changes are additive)
3. Old clients will work without token rotation (graceful degradation)

### Feature Flags

- Registration validation is unconditional (security-critical)
- Token rotation is unconditional (security-critical)
- Fail-closed authorization is unconditional (security-critical)

### Dashboard Scope Confirmation

This PR does NOT modify any files under:
- `src/pages/dashboards/**`
- `backend/src/modules/dashboards/**`

---

## Remaining PRs (Planned)

- PR 2: Document Vault, Upload, and DPDP Protection
- PR 3: Migration Governance
- PR 4: Workers and Distributed Job Safety
- PR 5: Database Connection Reliability
- PR 6: CI, Build, Deployment, and Health
- PR 7: Logging and Privacy Cleanup

See full plan in `.claude/plans/hrms2-non-dashboard-production-piped-clarke.md`
