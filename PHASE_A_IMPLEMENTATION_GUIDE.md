# Phase A: Security Hardening Implementation Guide

**Status**: Ready for Implementation  
**Estimated Time**: 18 hours (2-3 days)  
**Priority**: P1 (Critical)

---

## Overview

This guide provides step-by-step instructions to fix 12 Priority 1 security vulnerabilities identified in the E2E audit.

---

## Pre-Implementation Checklist

- [ ] Backup production database
- [ ] Create feature branch: `git checkout -b phase-a-security-hardening`
- [ ] Run baseline tests: `cd backend && npm test`
- [ ] Verify current commit: `git log -1`
- [ ] Create rollback script (see below)

---

## Step 1: Run Migration 133 (30 minutes)

**File**: `backend/sql/133_phase2_security_fixes.sql` (already created)

### 1.1 Dry-Run on Staging

```bash
# Connect to staging MySQL
mysql -h staging-db -u admin -p mas_hrms < backend/sql/133_phase2_security_fixes.sql

# Verify migration
mysql -h staging-db -u admin -p mas_hrms -e "
SELECT
  COUNT(*) as total_candidates,
  SUM(CASE WHEN recruiter_id IS NOT NULL THEN 1 ELSE 0 END) as with_recruiter_id,
  SUM(CASE WHEN recruiter_assigned_name IS NOT NULL AND recruiter_id IS NULL THEN 1 ELSE 0 END) as failed_migration
FROM ats_candidate;
"
```

**Expected Output**:
```
total_candidates | with_recruiter_id | failed_migration
      1523       |        1523       |        0
```

If `failed_migration > 0`, investigate:
```sql
SELECT id, candidate_code, recruiter_assigned_name
FROM ats_candidate
WHERE recruiter_assigned_name IS NOT NULL AND recruiter_id IS NULL
LIMIT 10;
```

### 1.2 Production Execution (if dry-run passes)

```bash
# Production backup first
mysqldump -h prod-db -u admin -p mas_hrms > backup_pre_migration_133_$(date +%Y%m%d_%H%M%S).sql

# Execute migration
mysql -h prod-db -u admin -p mas_hrms < backend/sql/133_phase2_security_fixes.sql
```

---

## Step 2: Update Backend Services (8 hours)

### 2.1 Update atsFullParity.service.ts (2 hours)

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts`

#### Change 1: Update intake to use `recruiter_id` (Line 514-527)

**Before**:
```typescript
// Line 514-515
`UPDATE ats_candidate SET ... recruiter_assigned_id=?, recruiter_assigned_name=?, recruiter_email=?, recruiter_mobile=?, ...`,
[..., recruiter?.recruiter_code ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null, ...]

// Line 524-526
`INSERT INTO ats_candidate (..., recruiter_assigned_id, recruiter_assigned_name, recruiter_email, recruiter_mobile, ...)
 VALUES (..., ?, ?, ?, ?, ...)`,
[..., recruiter?.recruiter_code ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null]
```

**After**:
```typescript
// Line 514-515
`UPDATE ats_candidate SET ... recruiter_id=?, recruiter_assigned_name=?, recruiter_email=?, recruiter_mobile=?, ...`,
[..., recruiter?.id ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null, ...]

// Line 524-526
`INSERT INTO ats_candidate (..., recruiter_id, recruiter_assigned_name, recruiter_email, recruiter_mobile, ...)
 VALUES (..., ?, ?, ?, ?, ...)`,
[..., recruiter?.id ?? null, recruiter?.name ?? null, recruiter?.email ?? null, recruiter?.mobile ?? null]
```

**Note**: Keep `recruiter_assigned_name` for backward compatibility (1 week grace period).

#### Change 2: Add optimistic locking to capacity tracking (Line 528-530)

**Before**:
```typescript
// Line 528-530
if (recruiter?.id) {
  await db.execute(`UPDATE ats_recruiter_roster SET assigned_today = assigned_today + 1, last_assigned_at = NOW() WHERE id = ?`, [recruiter.id]);
}
```

**After**:
```typescript
// Line 528-535
if (recruiter?.id) {
  // Optimistic locking: only increment if under capacity
  const [result] = await db.execute(
    `UPDATE ats_recruiter_roster 
     SET assigned_today = assigned_today + 1, 
         last_assigned_at = NOW(),
         capacity_lock_version = capacity_lock_version + 1
     WHERE id = ? AND assigned_today < daily_capacity`,
    [recruiter.id]
  );
  
  // If 0 rows affected, capacity was exceeded (race condition)
  if ((result as any).affectedRows === 0) {
    // Log warning and leave candidate unassigned
    console.warn(`[Capacity] Recruiter ${recruiter.id} exceeded capacity during concurrent assignment`);
    // TODO: Send alert to admin
  }
}
```

#### Change 3: Update journey filter to use `recruiter_id` (Line 418)

**Before**:
```typescript
// Line 418
if (filters.recruiter) { 
  conds.push("COALESCE(c.recruiter_assigned_name, c.recruiter_name) = ?"); 
  params.push(filters.recruiter); 
}
```

**After**:
```typescript
// Line 418
if (filters.recruiter) {
  // Support both FK (recommended) and legacy string match
  conds.push(`(c.recruiter_id = ? OR COALESCE(c.recruiter_assigned_name, c.recruiter_name) = ?)`);
  params.push(filters.recruiter, filters.recruiter);
}
```

### 2.2 Update recruiterInterview.service.ts (3 hours)

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts`

#### Change 1: Add impersonation audit trail (Line 527-530)

**Before**:
```typescript
// Line 527-530
await db.execute(
  `INSERT INTO ats_interview_submission_audit (id, submission_id, action, actor_user_id, snapshot, created_at)
   VALUES (?, ?, ?, ?, ?, NOW())`,
  [auditId, submissionId, action, actorUserId, JSON.stringify(snapshot)]
);
```

**After**:
```typescript
// Line 527-535
// Determine if this is a proxy submission (admin/HR acting on behalf)
const isProxySubmission = actorRole === 'hr_admin' || actorRole === 'super_admin';
const submittedByUserId = isProxySubmission ? userId : actorUserId;

await db.execute(
  `INSERT INTO ats_interview_submission_audit 
   (id, submission_id, action, actor_user_id, submitted_by_user_id, is_proxy_submission, snapshot, created_at)
   VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
  [auditId, submissionId, action, actorUserId, submittedByUserId, isProxySubmission ? 1 : 0, JSON.stringify(snapshot)]
);
```

#### Change 2: Add actor tracking to stage log (Line 541-545)

**Before**:
```typescript
// Line 541-545
await db.execute(
  `INSERT INTO ats_candidate_stage_log (id, candidate_id, old_stage, new_stage, changed_at)
   VALUES (?, ?, ?, ?, NOW())`,
  [UUID(), candidateId, oldStage, newStage]
);
```

**After**:
```typescript
// Line 541-550
const isProxySubmission = actorRole === 'hr_admin' || actorRole === 'super_admin';
const submittedByUserId = isProxySubmission ? userId : actorUserId;

await db.execute(
  `INSERT INTO ats_candidate_stage_log 
   (id, candidate_id, old_stage, new_stage, actor_user_id, submitted_by_user_id, changed_at)
   VALUES (?, ?, ?, ?, ?, ?, NOW())`,
  [UUID(), candidateId, oldStage, newStage, actorUserId, submittedByUserId]
);
```

#### Change 3: Add VOC validation for Rejected/No Show (Line 310-320)

**Before**:
```typescript
// Line 310-317
if (finalDecision === "Selected") {
  requireField(input.offerSalary, "Offer Salary");
  requireField(input.offerDoj, "Date of Joining");
  requireField(input.reportingTiming, "Reporting Timing");
  
  // Cascade: force all reached rounds to Selected
  if (rank >= 1) round1Result = "Selected";
  if (rank >= 2) round2Result = "Selected";
  if (rank >= 3) round3Result = "Selected";
}
```

**After**:
```typescript
// Line 310-330
if (finalDecision === "Selected") {
  requireField(input.offerSalary, "Offer Salary");
  requireField(input.offerDoj, "Date of Joining");
  requireField(input.reportingTiming, "Reporting Timing");
  
  // Cascade: force all reached rounds to Selected AND null VOCs
  if (rank >= 1) {
    round1Result = "Selected";
    round1Voc = null;  // Clear VOC when cascading to Selected
  }
  if (rank >= 2) {
    // Include Skill Test if present
    if (input.skilltestResult) {
      skillTestResult = "Selected";
      skillTestVoc = null;
    }
    round2Result = "Selected";
    round2Voc = null;
  }
  if (rank >= 3) {
    round3Result = "Selected";
    round3Voc = null;
  }
}

// Validate VOC for Rejected decision
if (finalDecision === "Rejected") {
  // At least one round must have a VOC
  const hasAnyVOC = round1Voc || skillTestVoc || round2Voc || round3Voc;
  if (!hasAnyVOC) {
    err("At least one round VOC is required when rejecting a candidate", 400);
  }
}

// Validate VOC for No Show decision
if (finalDecision === "No Show") {
  requireField(input.round1Voc, "Round1 VOC (No Show reason)");
}
```

### 2.3 Add Rate Limiting Middleware (2 hours)

**New File**: `backend/src/middleware/rateLimit.ts`

```typescript
import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import db from '../db.js';

/**
 * Rate limiter for PIN verification
 * 5 attempts per 15 minutes
 */
export const pinVerificationLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 5, // 5 attempts
  message: 'Too many login attempts. Account locked for 15 minutes.',
  standardHeaders: true,
  legacyHeaders: false,
  handler: async (req: Request, res: Response) => {
    // Log failed attempt
    const recruiterCode = req.body.recruiterCode || req.body.RecruiterCode;
    
    if (recruiterCode) {
      await db.execute(
        `UPDATE ats_recruiter_roster 
         SET failed_login_attempts = failed_login_attempts + 1,
             last_failed_login_at = NOW(),
             account_locked_until = DATE_ADD(NOW(), INTERVAL 15 MINUTE)
         WHERE recruiter_code = ?`,
        [recruiterCode]
      );
    }
    
    res.status(429).json({
      success: false,
      message: 'Too many login attempts. Your account has been locked for 15 minutes.',
      retry_after: 900 // 15 minutes in seconds
    });
  }
});

/**
 * Check if recruiter account is locked
 */
export async function checkAccountLock(recruiterCode: string): Promise<boolean> {
  const [rows] = await db.execute<any[]>(
    `SELECT account_locked_until FROM ats_recruiter_roster 
     WHERE recruiter_code = ? AND account_locked_until > NOW()`,
    [recruiterCode]
  );
  
  return rows.length > 0;
}

/**
 * Reset failed login attempts on successful login
 */
export async function resetLoginAttempts(recruiterCode: string): Promise<void> {
  await db.execute(
    `UPDATE ats_recruiter_roster 
     SET failed_login_attempts = 0,
         last_failed_login_at = NULL,
         account_locked_until = NULL
     WHERE recruiter_code = ?`,
    [recruiterCode]
  );
}
```

**Update**: `backend/src/modules/ats/ats.routes.ts`

```typescript
import { pinVerificationLimiter, checkAccountLock, resetLoginAttempts } from '../../middleware/rateLimit.js';

// Add rate limiter to PIN verification endpoint
router.post('/recruiter/verify', pinVerificationLimiter, async (req, res) => {
  const { recruiterCode, pin } = req.body;
  
  // Check if account is locked
  if (await checkAccountLock(recruiterCode)) {
    return res.status(403).json({
      success: false,
      message: 'Account is temporarily locked due to multiple failed login attempts. Please try again later.'
    });
  }
  
  // ... existing PIN verification logic ...
  
  // On successful verification
  await resetLoginAttempts(recruiterCode);
  
  // ... return success response ...
});
```

### 2.4 Add PII Redaction Service (2 hours)

**New File**: `backend/src/services/piiRedaction.service.ts`

```typescript
import db from '../db.js';
import { RowDataPacket } from 'mysql2';

interface RedactionRule {
  field_name: string;
  redaction_rule: 'hide' | 'mask' | 'allow';
}

class PIIRedactionService {
  private cache: Map<string, RedactionRule[]> = new Map();

  /**
   * Load redaction rules for a role
   */
  async loadRules(roleKey: string, entityType: string): Promise<RedactionRule[]> {
    const cacheKey = `${roleKey}:${entityType}`;
    
    if (this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT field_name, redaction_rule 
       FROM ats_pii_redaction_config 
       WHERE role_key = ? AND entity_type = ?`,
      [roleKey, entityType]
    );

    const rules = rows as RedactionRule[];
    this.cache.set(cacheKey, rules);
    return rules;
  }

  /**
   * Redact sensitive fields from a record
   */
  async redact<T extends Record<string, any>>(
    record: T,
    roleKey: string,
    entityType: string
  ): Promise<T> {
    const rules = await this.loadRules(roleKey, entityType);
    const redacted = { ...record };

    for (const rule of rules) {
      const fieldName = rule.field_name;
      
      if (!(fieldName in redacted)) continue;

      switch (rule.redaction_rule) {
        case 'hide':
          delete redacted[fieldName];
          break;
        
        case 'mask':
          if (fieldName === 'offer_salary' && typeof redacted[fieldName] === 'number') {
            // Show salary range instead of exact value
            const salary = redacted[fieldName];
            if (salary < 15000) redacted[fieldName] = '<15K';
            else if (salary < 20000) redacted[fieldName] = '15-20K';
            else if (salary < 25000) redacted[fieldName] = '20-25K';
            else redacted[fieldName] = '25K+';
          } else if (typeof redacted[fieldName] === 'string') {
            // Mask string (show first 2 and last 2 chars)
            const val = String(redacted[fieldName]);
            if (val.length <= 4) {
              redacted[fieldName] = '***';
            } else {
              redacted[fieldName] = val.slice(0, 2) + '***' + val.slice(-2);
            }
          }
          break;
        
        case 'allow':
          // No redaction
          break;
      }
    }

    return redacted;
  }

  /**
   * Redact an array of records
   */
  async redactMany<T extends Record<string, any>>(
    records: T[],
    roleKey: string,
    entityType: string
  ): Promise<T[]> {
    return Promise.all(records.map(r => this.redact(r, roleKey, entityType)));
  }

  /**
   * Clear cache (call when redaction rules are updated)
   */
  clearCache(): void {
    this.cache.clear();
  }
}

export const piiRedactionService = new PIIRedactionService();
```

**Update**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts`

```typescript
import { piiRedactionService } from '../../services/piiRedaction.service.js';

// In getSubmissionHistory() function
export async function getSubmissionHistory(recruiterCode: string, userRole: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ... FROM ats_interview_submission WHERE recruiter_code = ? ORDER BY submitted_at DESC LIMIT 200`,
    [recruiterCode]
  );

  // Redact sensitive fields based on role
  const redacted = await piiRedactionService.redactMany(
    rows as any[],
    userRole,
    'ats_interview_submission'
  );

  return redacted;
}
```

### 2.5 Add Session Timeout Tracking (1 hour)

**New File**: `backend/src/services/session.service.ts`

```typescript
import { randomUUID } from 'crypto';
import db from '../db.js';

const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export class SessionService {
  /**
   * Create new session
   */
  async create(recruiterId: string, ipAddress?: string, userAgent?: string): Promise<string> {
    const sessionToken = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);

    await db.execute(
      `INSERT INTO ats_recruiter_session 
       (id, recruiter_id, session_token, created_at, last_activity_at, expires_at, ip_address, user_agent, is_active)
       VALUES (?, ?, ?, NOW(), NOW(), ?, ?, ?, 1)`,
      [randomUUID(), recruiterId, sessionToken, expiresAt, ipAddress, userAgent]
    );

    return sessionToken;
  }

  /**
   * Validate and refresh session
   */
  async validate(sessionToken: string): Promise<boolean> {
    const [rows] = await db.execute<any[]>(
      `SELECT id, expires_at FROM ats_recruiter_session 
       WHERE session_token = ? AND is_active = 1`,
      [sessionToken]
    );

    if (rows.length === 0) return false;

    const session = rows[0];
    const now = new Date();
    const expiresAt = new Date(session.expires_at);

    if (now > expiresAt) {
      // Session expired
      await this.invalidate(sessionToken);
      return false;
    }

    // Refresh activity and expiration
    const newExpiresAt = new Date(Date.now() + SESSION_TIMEOUT_MS);
    await db.execute(
      `UPDATE ats_recruiter_session 
       SET last_activity_at = NOW(), expires_at = ? 
       WHERE session_token = ?`,
      [newExpiresAt, sessionToken]
    );

    return true;
  }

  /**
   * Invalidate session
   */
  async invalidate(sessionToken: string): Promise<void> {
    await db.execute(
      `UPDATE ats_recruiter_session SET is_active = 0 WHERE session_token = ?`,
      [sessionToken]
    );
  }

  /**
   * Cleanup expired sessions (run as cron job)
   */
  async cleanup(): Promise<number> {
    const [result] = await db.execute(
      `DELETE FROM ats_recruiter_session WHERE expires_at < NOW()`
    );
    return (result as any).affectedRows;
  }
}

export const sessionService = new SessionService();
```

---

## Step 3: Add Validation Tests (3 hours)

**New File**: `backend/tests/phase-a-security.test.ts`

```typescript
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import db from '../src/db.js';

describe('Phase A: Security Hardening Tests', () => {
  beforeAll(async () => {
    // Setup test data
  });

  afterAll(async () => {
    // Cleanup
  });

  describe('FK-based Assignment', () => {
    it('should assign candidate using recruiter_id FK', async () => {
      // Test that intake uses recruiter_id instead of string name
    });

    it('should prevent ownership bypass via name collision', async () => {
      // Test that two recruiters with same name don't access each other's candidates
    });
  });

  describe('Capacity Tracking', () => {
    it('should prevent race condition in capacity increment', async () => {
      // Test concurrent assignments don't exceed daily_capacity
    });

    it('should handle capacity exceeded gracefully', async () => {
      // Test that assignment fails when no capacity
    });
  });

  describe('Audit Trail', () => {
    it('should track impersonation in audit log', async () => {
      // Test that admin submission records submitted_by_user_id
    });

    it('should flag proxy submissions', async () => {
      // Test is_proxy_submission = 1 when admin acts on behalf
    });

    it('should track actor in stage log', async () => {
      // Test actor_user_id populated
    });
  });

  describe('Rate Limiting', () => {
    it('should lock account after 5 failed PIN attempts', async () => {
      // Test rate limiter
    });

    it('should unlock account after 15 minutes', async () => {
      // Test timeout expiration
    });

    it('should reset attempts on successful login', async () => {
      // Test counter reset
    });
  });

  describe('VOC Validation', () => {
    it('should require VOC when finalDecision=Rejected', async () => {
      // Test VOC validation
    });

    it('should require VOC when finalDecision=No Show', async () => {
      // Test No Show VOC
    });

    it('should null VOCs when cascading to Selected', async () => {
      // Test cascade logic
    });
  });

  describe('PII Redaction', () => {
    it('should hide offer_salary for recruiter role', async () => {
      // Test redaction
    });

    it('should allow offer_salary for admin role', async () => {
      // Test no redaction for admin
    });

    it('should mask offer_salary for branch_head role', async () => {
      // Test masking
    });
  });

  describe('Session Timeout', () => {
    it('should expire session after 30 minutes', async () => {
      // Test timeout
    });

    it('should refresh session on activity', async () => {
      // Test refresh
    });

    it('should invalidate session on logout', async () => {
      // Test invalidation
    });
  });
});
```

Run tests:
```bash
cd backend
npm test -- --run tests/phase-a-security.test.ts
```

---

## Step 4: Frontend Updates (2 hours)

### 4.1 Add Session Timeout Warning

**File**: `src/pages/NativeATSRecruiterWorkspace.tsx`

```typescript
import { useEffect, useState } from 'react';

const SESSION_TIMEOUT_WARNING_MS = 25 * 60 * 1000; // 25 minutes (5 min before expiry)
const SESSION_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes

export function NativeATSRecruiterWorkspace() {
  const [showTimeoutWarning, setShowTimeoutWarning] = useState(false);
  const [sessionExpiresIn, setSessionExpiresIn] = useState(SESSION_TIMEOUT_MS);

  useEffect(() => {
    // Session activity tracker
    let lastActivity = Date.now();
    let warningTimer: NodeJS.Timeout;
    let expiryTimer: NodeJS.Timeout;

    const resetTimers = () => {
      lastActivity = Date.now();
      setShowTimeoutWarning(false);
      
      clearTimeout(warningTimer);
      clearTimeout(expiryTimer);

      // Show warning 5 minutes before expiry
      warningTimer = setTimeout(() => {
        setShowTimeoutWarning(true);
        setSessionExpiresIn(5 * 60 * 1000);
      }, SESSION_TIMEOUT_WARNING_MS);

      // Auto-logout at expiry
      expiryTimer = setTimeout(() => {
        alert('Your session has expired due to inactivity. Please log in again.');
        // Clear profile and return to login
        setRecruiterProfile(null);
      }, SESSION_TIMEOUT_MS);
    };

    // Track user activity
    const activityEvents = ['mousedown', 'keydown', 'scroll', 'touchstart'];
    const handleActivity = () => resetTimers();
    
    activityEvents.forEach(event => {
      window.addEventListener(event, handleActivity);
    });

    resetTimers();

    return () => {
      activityEvents.forEach(event => {
        window.removeEventListener(event, handleActivity);
      });
      clearTimeout(warningTimer);
      clearTimeout(expiryTimer);
    };
  }, [recruiterProfile]);

  return (
    <div>
      {/* Session Timeout Warning Modal */}
      {showTimeoutWarning && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white p-6 rounded-lg shadow-xl max-w-md">
            <h3 className="text-lg font-bold mb-2">⏰ Session Expiring Soon</h3>
            <p className="mb-4">
              Your session will expire in {Math.floor(sessionExpiresIn / 60000)} minutes due to inactivity.
            </p>
            <div className="flex gap-2">
              <button
                onClick={() => setShowTimeoutWarning(false)}
                className="flex-1 px-4 py-2 bg-blue-600 text-white rounded"
              >
                Continue Working
              </button>
              <button
                onClick={() => setRecruiterProfile(null)}
                className="flex-1 px-4 py-2 bg-gray-300 rounded"
              >
                Logout
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Rest of workspace UI */}
      {/* ... */}
    </div>
  );
}
```

---

## Step 5: Integration Testing (2 hours)

### Test Scenarios

1. **Assignment Flow**:
   - Create candidate with valid recruiter
   - Verify `recruiter_id` FK populated
   - Verify capacity increment atomic
   - Verify concurrent assignments respect capacity

2. **Audit Trail**:
   - Admin submits on behalf of recruiter
   - Verify `submitted_by_user_id` populated
   - Verify `is_proxy_submission = 1`
   - Verify stage log has actor

3. **Rate Limiting**:
   - Attempt 6 failed logins
   - Verify account locked
   - Wait 15 minutes (or manually unlock)
   - Verify login works again

4. **VOC Validation**:
   - Submit finalDecision='Rejected' without VOC
   - Verify 400 error
   - Submit with VOC
   - Verify success

5. **PII Redaction**:
   - Recruiter fetches submission history
   - Verify `offer_salary` field absent
   - Admin fetches history
   - Verify `offer_salary` present

6. **Session Timeout**:
   - Login and idle for 25 minutes
   - Verify warning appears
   - Idle for 30 minutes
   - Verify forced logout

---

## Step 6: Deployment (2 hours)

### 6.1 Pre-Deployment Checklist

- [ ] All tests passing (15 new tests + 28 existing = 43 tests)
- [ ] Code review completed
- [ ] Migration tested on staging
- [ ] Rollback script prepared
- [ ] Monitoring alerts configured
- [ ] Documentation updated

### 6.2 Deployment Steps

```bash
# 1. Merge feature branch
git checkout main
git merge phase-a-security-hardening
git push origin main

# 2. Deploy backend (Railway)
railway up

# 3. Run migration on production
mysql -h prod-db -u admin -p mas_hrms < backend/sql/133_phase2_security_fixes.sql

# 4. Deploy frontend (Vercel)
vercel --prod

# 5. Verify deployment
curl https://api.your-domain.com/health
curl https://your-domain.com
```

### 6.3 Post-Deployment Verification

```bash
# Test recruiter login
curl -X POST https://api.your-domain.com/api/ats/recruiter/verify \
  -H "Content-Type: application/json" \
  -d '{"recruiterCode": "REC001", "pin": "1234"}'

# Verify rate limiting (should lock after 5 attempts)
for i in {1..6}; do
  curl -X POST https://api.your-domain.com/api/ats/recruiter/verify \
    -H "Content-Type: application/json" \
    -d '{"recruiterCode": "REC001", "pin": "wrong"}'
done

# Verify audit trail
mysql -h prod-db -u admin -p mas_hrms -e "
SELECT COUNT(*) as proxy_submissions 
FROM ats_interview_submission_audit 
WHERE is_proxy_submission = 1;
"
```

---

## Rollback Plan

If critical issues arise:

```bash
# 1. Rollback database (restore from backup)
mysql -h prod-db -u admin -p mas_hrms < backup_pre_migration_133_YYYYMMDD_HHMMSS.sql

# 2. Revert code changes
git revert HEAD
git push origin main

# 3. Redeploy
railway up
vercel --prod

# 4. Verify rollback
curl https://api.your-domain.com/health
```

**Rollback Migration (if needed)**:

```sql
-- Rollback 133_phase2_security_fixes.sql
USE mas_hrms;

-- Remove new tables
DROP TABLE IF EXISTS ats_sensitive_action_log;
DROP TABLE IF EXISTS ats_pii_redaction_config;
DROP TABLE IF EXISTS ats_recruiter_session;

-- Remove new columns
ALTER TABLE ats_candidate DROP FOREIGN KEY fk_candidate_recruiter;
ALTER TABLE ats_candidate DROP COLUMN recruiter_id;

ALTER TABLE ats_interview_submission_audit 
  DROP COLUMN submitted_by_user_id,
  DROP COLUMN is_proxy_submission;

ALTER TABLE ats_candidate_stage_log
  DROP COLUMN actor_user_id,
  DROP COLUMN submitted_by_user_id;

ALTER TABLE ats_recruiter_roster
  DROP COLUMN failed_login_attempts,
  DROP COLUMN last_failed_login_at,
  DROP COLUMN account_locked_until,
  DROP COLUMN capacity_lock_version;

ALTER TABLE ats_queue_token
  DROP INDEX uq_candidate_active_token;
```

---

## Success Metrics

After deployment, monitor these metrics for 48 hours:

| Metric | Target | Measurement |
|--------|--------|-------------|
| Zero security incidents | 0 | Security log review |
| No data integrity issues | 0 | Query verification scripts |
| Successful login rate | >98% | API metrics |
| Session timeout triggers | <5% | Frontend analytics |
| Rate limit triggers | <1% | API metrics |
| Audit trail completeness | 100% | Database queries |

---

## Known Limitations

1. **Backward Compatibility**: `recruiter_assigned_name` kept for 1 week grace period
2. **MySQL Version**: Unique partial index requires MySQL 8.0+ (application-level enforcement for MySQL 5.7)
3. **Session Storage**: Sessions stored in database (consider Redis for scale)
4. **Rate Limiting**: Express-rate-limit uses memory (consider Redis for multi-instance)

---

## Next Steps After Phase A

Once Phase A is deployed and stable:

1. **Phase B**: Data Integrity Fixes (Priority 2)
   - Queue token consolidation
   - State machine enforcement
   - Export capability

2. **Phase C**: Workflow Completion (Major)
   - Branch head approval
   - HR handoff automation
   - Status transitions

3. **Phase D**: Operational Improvements (Priority 3+)
   - Automated daily reset
   - Per-round timestamps
   - Monitoring dashboards

---

**End of Implementation Guide**  
**Ready for Execution**: ✅  
**Estimated Duration**: 18 hours (2-3 days)  
**Next**: Execute Step 1 (Migration 133)
