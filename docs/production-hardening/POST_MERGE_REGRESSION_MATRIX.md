# Post-Merge Regression Matrix

## Analysis Period
- **Hardening Merge**: `f332763d` (fix(security): complete remaining production hardening blockers)
- **Current Main**: `d890f44e` (fix(ops-board): show all today's walk-ins...)
- **Commits Between**: 20 commits
- **Analysis Date**: 2026-07-24

## Summary Statistics
| Metric | Value |
|--------|-------|
| Total Files Changed | 43 |
| Lines Added | 1,428 |
| Lines Removed | 1,960 |
| Net Change | -532 |
| Security Regressions | 8 files |
| Reliability Regressions | 3 files |
| Valid Recovery Fixes | 12 files |
| Unrelated ATS/Reports | 5 files |

---

## Critical Security Regressions

### 1. backend/src/modules/auth/auth.routes.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **SECURITY REGRESSION** | CRITICAL |
| Lines Changed | -226 | Major removal |
| HttpOnly Cookie Auth | REMOVED | Refresh tokens exposed in body/localStorage |
| Token Rotation | REMOVED | Old sessions valid after password change |
| 2FA Pre-Auth Challenge | REMOVED | Tokens created before 2FA completion |
| Invitation-Only Registration | REMOVED | Open registration vulnerability |
| Restoration | Manual merge required | Cannot cherry-pick |

**What was lost:**
- `auth-cookie.js` imports (setRefreshTokenCookie, clearRefreshTokenCookie, getRefreshTokenFromRequest)
- Pre-auth challenge creation and validation
- Invitation/activation token validation for registration
- Specific error codes (TOKEN_REUSED, PASSWORD_CHANGED, USER_BLOCKED)

---

### 2. backend/src/modules/auth/auth.service.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **SECURITY REGRESSION** | CRITICAL |
| Lines Changed | -415 | Major removal |
| Token Rotation | REMOVED | Same token reused indefinitely |
| Token Reuse Detection | REMOVED | Stolen tokens undetectable |
| Password Invalidation | REMOVED | Sessions survive password change |
| Cryptographic OTP | REMOVED | Uses Math.random() instead of crypto |
| Restoration | Manual merge required | Cannot cherry-pick |

**What was lost:**
- `token_family_id`, `previous_token_hash`, `rotated_at` tracking
- `password_changed_at_snapshot` validation
- Pre-auth challenge table operations
- `crypto.randomInt()` for OTP generation

---

### 3. backend/src/modules/files/files.routes.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **SECURITY REGRESSION** | HIGH |
| Lines Changed | -281 | Major removal |
| Magic Byte Validation | REMOVED | Executable files disguised as documents |
| Fail-Closed Auth | REMOVED | Authorization bypassed via env flag |
| Employee Photo Auth | REMOVED | Public access to photos |
| Legal Hold Protection | REMOVED | Protected docs deletable |
| Restoration | Manual merge required | Cannot cherry-pick |

**What was lost:**
- `MAGIC_BYTES` validation and `validateFileMagicBytes()`
- Mandatory vault registration with rollback
- Retention policy and legal hold checks
- Cross-branch/process scope enforcement

---

### 4. src/contexts/AuthContext.tsx
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **SECURITY REGRESSION** | CRITICAL |
| Lines Changed | -136 | Major removal |
| HttpOnly Cookie Support | REMOVED | Cookies not sent |
| localStorage Tokens | RESTORED (bad) | XSS vulnerability |
| Security Event Handling | REMOVED | No logout on TOKEN_REUSED |
| Geolocation Collection | RESTORED (bad) | DPDP privacy violation |
| Restoration | Manual merge required | Cannot cherry-pick |

**What was lost:**
- `credentials: "include"` on all auth requests
- Removal of `localStorage.setItem("hrms_refresh_token")`
- `logoutRequired` error code handling

---

## Reliability Regressions

### 5. backend/src/db/mysql.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **RELIABILITY REGRESSION** | HIGH |
| Lines Changed | -187 | Major removal |
| Circuit Breaker | REMOVED | Cascading failures possible |
| Connection Limits | REMOVED | queueLimit:0 causes memory exhaustion |
| Keep-Alive | REMOVED | Dead connections undetected |
| Non-Retryable Errors | REMOVED | ER_CON_COUNT retried (worse) |
| Restoration | Cherry-pick possible | Minor conflicts |

**What was lost:**
- Circuit breaker state machine
- `queueLimit: 100`, `acquireTimeout: 10000`
- `enableKeepAlive`, `keepAliveInitialDelay`
- `getCircuitBreakerStatus()`, `getPoolStats()`

---

### 6. backend/src/db/runPendingMigrations.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **RELIABILITY REGRESSION** | HIGH |
| Lines Changed | -462 | Major removal |
| Advisory Lock | REMOVED | Concurrent migrations corrupt schema |
| Checksum Tracking | REMOVED | Modified migrations undetected |
| Strict Mode | REMOVED | Missing files allowed |
| Stop-on-Failure | REMOVED | Chain continues after failure |
| Restoration | Manual merge required | Cannot cherry-pick |

**What was lost:**
- `GET_LOCK('hrms_migration', 30)` exclusivity
- `checksum_sha256` column and validation
- `MIGRATION_STRICT_MODE` enforcement
- Governance columns (start_time, end_time, duration_ms, executor, success, error_message)

---

### 7. backend/src/server.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **RELIABILITY REGRESSION** | HIGH |
| Lines Changed | -269 | Major removal |
| Graceful Shutdown | REMOVED | Connections forcibly terminated |
| Worker Separation Check | REMOVED | Workers run inline |
| DB Pool Cleanup | REMOVED | Connections left open |
| Migration Governance | REMOVED | Auto-runs on startup |
| Restoration | Manual merge required | Keep worker logic |

**What was lost:**
- `gracefulShutdown()` with connection draining
- Production safety check for WORKERS_PROCESS=external
- Parallel pool closing for all external DBs
- SIGTERM/SIGINT handlers

---

### 8. backend/src/routes/health.routes.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **RELIABILITY REGRESSION** | MEDIUM |
| Lines Changed | -77 | Moderate removal |
| Liveness Probe | REMOVED | No /health/live endpoint |
| Readiness Probe | REMOVED | No /health/ready endpoint |
| Schema State | REMOVED | Can't diagnose pending migrations |
| Restoration | Cherry-pick possible | Clean extraction |

---

## Valid Recovery Fixes (Keep These)

### 9. ecosystem.config.cjs
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **VALID RECOVERY FIX** | CORRECT |
| Lines Changed | +67 | Addition |
| Worker Separation | ADDED | Proper hrms-api/hrms-workers split |
| WORKERS_PROCESS=external | ADDED | Prevents inline workers |
| Graceful Shutdown Config | ADDED | kill_timeout, wait_ready |
| Restoration | KEEP AS-IS | No changes needed |

---

### 10. backend/src/workers/all-workers.ts
| Aspect | Status | Impact |
|--------|--------|--------|
| Classification | **VALID RECOVERY FIX** | CORRECT |
| Lines Changed | +36 | Addition |
| Stop Function Imports | ADDED | All workers have stop() |
| Shutdown Handler | ADDED | Calls all stop functions |
| Restoration | KEEP AS-IS | No changes needed |

---

### 11. Worker Files (12 files)
| File | Classification | Status |
|------|---------------|--------|
| kpi-daily-sync.worker.ts | VALID FIX | Stop function added |
| leave-monthly-credit.worker.ts | VALID FIX | Stop function added |
| leave-annual-el-credit.worker.ts | VALID FIX | Stop function added |
| payroll-nightly-recalc.worker.ts | VALID FIX | Stop function added |
| sla-breach-worker.ts | VALID FIX | Stop function added |
| interview-delay-alert.worker.ts | VALID FIX | Stop function added |
| lms-sync.worker.ts | VALID FIX | Stop function added |
| apr-vicidial-sync.worker.ts | VALID FIX | Stop function added |
| official-email-compliance.worker.ts | VALID FIX | Stop function added |
| it-provisioning.cron.ts | VALID FIX | Stop function added |
| payroll-window.cron.ts | VALID FIX | Stop function added |
| dpdp-breach-sla.cron.ts | VALID FIX | Stop function added |

---

## Unrelated ATS/Reports Changes (Preserve)

| File | Classification | Notes |
|------|---------------|-------|
| src/pages/NativeATSHiringEntry.tsx | UNRELATED | Branch analytics, UI changes |
| src/pages/NativeReportsCenterV2.tsx | UNRELATED | Reports UI fixes |
| src/pages/NativeJobRequisition.tsx | UNRELATED | Job requisition approval |
| src/pages/OpsBoard.tsx | UNRELATED | Walk-ins display |
| backend/src/modules/ats/queue.enhanced.service.ts | UNRELATED | Queue service changes |
| backend/src/modules/ats/recruiter-hiring.service.ts | UNRELATED | Hiring service changes |
| backend/src/modules/job-requisition/*.ts | UNRELATED | Job requisition logic |

---

## Line-Ending Only Changes

| File | Status |
|------|--------|
| backend/sql/038_engagement_gamification.sql | CRLF/LF normalization only |

---

## Restoration Strategy

### Phase 1: Cherry-Pick Safe Files
1. `backend/src/db/mysql.ts` - Connection pool config
2. `backend/src/routes/health.routes.ts` - Liveness/readiness probes

### Phase 2: Manual Merge (Complex)
3. `backend/src/modules/auth/auth.routes.ts` - Restore cookie auth + keep logout limiter
4. `backend/src/modules/auth/auth.service.ts` - Restore token rotation + keep transactions
5. `backend/src/modules/files/files.routes.ts` - Restore all security controls
6. `backend/src/db/runPendingMigrations.ts` - Restore governance + keep verification
7. `backend/src/server.ts` - Restore graceful shutdown + keep worker separation
8. `src/contexts/AuthContext.tsx` - Restore cookie auth + remove localStorage

### Phase 3: Verification
- Full test suite
- Security tests
- Migration tests
- Cookie integration tests
- Load tests

---

## Root Cause

Commit `66233bca` appears to have been a bad merge that:
1. **Correctly applied** worker stop functions and PM2 config
2. **Accidentally reverted** all security hardening from f332763d

This created a state where operational improvements exist but security controls were lost.

---

## Risk Assessment

| Category | Files Affected | Severity |
|----------|---------------|----------|
| Authentication Bypass | 2 | CRITICAL |
| Data Exposure (XSS) | 2 | CRITICAL |
| Document Security | 1 | HIGH |
| Connection Exhaustion | 1 | HIGH |
| Migration Corruption | 1 | HIGH |
| Graceful Shutdown | 1 | HIGH |
| Health Monitoring | 1 | MEDIUM |

**Total Critical Issues**: 4 files with CRITICAL security regressions
**Total High Issues**: 4 files with HIGH reliability regressions
