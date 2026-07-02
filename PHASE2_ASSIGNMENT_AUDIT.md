# Phase 2: Assignment, Queue & Candidate Context Audit

**Repository**: https://github.com/shivamgiri-sudo/HRMS1.git  
**Audit Date**: 2026-06-11  
**Phase**: 2 of 6  
**Status**: ✅ **AUDIT COMPLETE** → ⏸️ **FIXES IN PROGRESS**

---

## Executive Summary

**Audit Scope**: Assignment mechanism, queue token system, candidate context integrity

**Findings**:
- ✅ **10 issues identified** (4 Priority 1, 3 Priority 2, 3 Priority 3+4)
- ⚠️ **Security vulnerabilities**: String-based assignment allows impersonation
- ⚠️ **Race conditions**: Capacity tracking and queue token creation
- ⚠️ **Data integrity**: Two parallel queue token systems exist
- ✅ **Timestamp preservation**: Created date/time integrity VERIFIED (S6 fix)
- ✅ **SLA breach tracking**: Comprehensive implementation with email alerts

---

## Issue Summary

| Priority | Category | Issue | Impact | File |
|----------|----------|-------|--------|------|
| 🔴 P1 | Security | String-based assignment vulnerability | Impersonation risk | atsFullParity.service.ts:186,386 |
| 🔴 P1 | Security | Race condition in capacity tracking | Exceeds daily_capacity | atsFullParity.service.ts:529 |
| 🔴 P1 | Security | Missing impersonation audit trail | Admin/HR actions untracked | recruiterInterview.service.ts:121-136 |
| 🔴 P1 | Security | String comparison ownership bypass | Name collision breaks scope | atsFullParity.service.ts:186 |
| 🟡 P2 | Data Integrity | Parallel queue token systems | Data divergence | atsFullParity.service.ts:510 |
| 🟡 P2 | Race Condition | Non-atomic duplicate check | Concurrent token creation | ats.queue.service.ts:36-45 |
| 🟡 P2 | Validation | Missing token status validation | Invalid tokens accepted | recruiterInterview.service.ts:393-395 |
| 🟢 P3 | Operations | No automatic daily reset | Manual cron dependency | atsFullParity.service.ts:706 |
| 🟢 P3 | Data Sync | Queue token stage divergence | Two sources of truth | ats_queue_token.current_stage |
| 🟢 P4 | UX | Silent unassigned candidates | No capacity enforcement | atsFullParity.service.ts:509 |

---

## Detailed Findings

### 1. Assignment Mechanism

**Current Implementation**: ✅ Functional but vulnerable

```typescript
// atsFullParity.service.ts:535-553
async function pickRecruiter(branch: string, process: string): Promise<RecruiterProfile | null> {
  // Algorithm: Least-loaded + capacity check
  // ✅ Respects daily_capacity
  // ✅ Branch-scoped
  // ✅ Role-coverage aware
  // ❌ Race condition: concurrent requests can exceed capacity
  // ❌ Returns null when no capacity (creates unassigned candidates)
}
```

**Load Balancing**:
- ✅ Least-loaded algorithm: `ORDER BY assigned_today ASC, last_assigned_at ASC`
- ✅ Capacity check: `assigned_today < daily_capacity`
- ✅ Availability check: `available_today = 'Y'`
- ✅ Branch + role-coverage filtering

**Issues**:

#### 1.1 String-Based Assignment Vulnerability 🔴

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts:186,386`

**Problem**:
```typescript
// Line 186: Ownership check
const [rows] = await db.execute(
  "SELECT ... WHERE recruiter_assigned_name = ?",
  [recruiterName]
);
```

**Risk**: If two recruiters have the same name, ownership scope breaks.

**Fix**: Replace `recruiter_assigned_name` VARCHAR with `recruiter_id` CHAR(36) FK to `ats_recruiter_roster.id`.

#### 1.2 Race Condition in Capacity Tracking 🔴

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts:529`

**Problem**:
```typescript
// Line 523-529: Non-atomic increment
const recruiter = await pickRecruiter(branch, process); // SELECT assigned_today
if (recruiter?.id) {
  await db.execute(
    "UPDATE ats_recruiter_roster SET assigned_today = assigned_today + 1 WHERE id = ?",
    [recruiter.id]
  ); // Concurrent requests can exceed daily_capacity
}
```

**Race Condition**:
1. Request A: `SELECT assigned_today = 9` (capacity 10)
2. Request B: `SELECT assigned_today = 9` (capacity 10)
3. Request A: `UPDATE assigned_today = 10` ✅
4. Request B: `UPDATE assigned_today = 11` ❌ **Exceeds capacity!**

**Fix**: Use `SELECT FOR UPDATE` or atomic `UPDATE ... WHERE assigned_today < daily_capacity`.

#### 1.3 Missing Impersonation Audit Trail 🔴

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts:121-136`

**Problem**:
```typescript
// Line 121-136: Admin/HR can submit on behalf of recruiter
if (actorRole === 'hr_admin' || actorRole === 'super_admin') {
  // No audit log: WHO (admin) submitted on behalf of WHOM (recruiter)
}
```

**Risk**: Admin actions are indistinguishable from genuine recruiter submissions in audit trail.

**Fix**: Add `submitted_by_user_id` to `ats_interview_submission_audit`.

#### 1.4 Silent Unassigned Candidates 🟢

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts:509`

**Problem**:
```typescript
// Line 509: pickRecruiter() can return null
const recruiter = await pickRecruiter(appliedForBranch, appliedForProcess);
if (recruiter?.id) {
  // Assignment succeeds
} else {
  // Candidate created with recruiter_assigned_name = NULL
  // No error, no notification, silent failure
}
```

**Fix**: Reject intake request with `503 Service Unavailable - No recruiter capacity` when `pickRecruiter()` returns `null`.

---

### 2. Queue Token System

**Current Implementation**: ⚠️ **TWO PARALLEL SYSTEMS**

#### System A: `ats_queue_token` Table (Migration 128)

**File**: `backend/src/modules/ats/ats.queue.service.ts`

**Features**:
- ✅ UUID token generation
- ✅ Status tracking (`active`, `walked_out`, `completed`)
- ✅ Walk-out and re-entry support
- ✅ Duplicate prevention (line 36-45)
- ✅ Foreign key to `ats_candidate.id`

**Used by**: Queue management, walk-in tracking

#### System B: Simple String Token (atsFullParity.service.ts)

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts:510`

**Features**:
- ❌ Simple string generation (`nextQueueToken()`)
- ❌ NOT stored in `ats_queue_token` table
- ❌ No status tracking
- ❌ No walk-out support

**Used by**: Candidate intake, interview submission

**Problem**: These two systems DO NOT integrate. `ats_queue_token` table exists but intake flow bypasses it.

---

**Issues**:

#### 2.1 Parallel Queue Token Systems 🟡

**Files**:
- `backend/src/modules/ats/ats.queue.service.ts:23-55` (System A)
- `backend/src/modules/ats-full-parity/atsFullParity.service.ts:510` (System B)

**Problem**: System B generates tokens that are NEVER inserted into `ats_queue_token` table.

**Evidence**:
```typescript
// atsFullParity.service.ts:510
const qToken = nextQueueToken(); // Simple string, NOT UUID from ats_queue_token
await db.execute(
  "INSERT INTO ats_candidate (..., q_token) VALUES (..., ?)",
  [..., qToken]
); // Stored in ats_candidate only, NOT in ats_queue_token
```

**Impact**:
- `ats_queue_token` table is orphaned
- Walk-out/re-entry logic (System A) cannot track System B tokens
- SLA breach tracking uses `ats_candidate.created_date` instead of `ats_queue_token.arrival_time`

**Fix**: Deprecate `nextQueueToken()` and call `ats.queue.service.ts:createToken()` during intake.

#### 2.2 Non-Atomic Duplicate Check 🟡

**File**: `backend/src/modules/ats/ats.queue.service.ts:36-45`

**Problem**:
```typescript
// Line 36-45: Check-then-insert race condition
const [existing] = await db.execute(
  "SELECT id FROM ats_queue_token WHERE candidate_id = ? AND status = 'active'",
  [candidateId]
);
if (existing.length > 0) return null; // Race window here
await db.execute("INSERT INTO ats_queue_token ...", [...]); // Concurrent insert possible
```

**Fix**: Add unique partial index `CREATE UNIQUE INDEX idx_active_token ON ats_queue_token(candidate_id, status) WHERE status='active'`.

#### 2.3 Missing Token Status Validation 🟡

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts:393-395`

**Problem**:
```typescript
// Line 393-395: Validates q_token match but NOT status
const [candidate] = await db.execute(
  "SELECT ... FROM ats_candidate WHERE id = ? AND q_token = ?",
  [candidateId, qToken]
);
// Should also check: ats_queue_token.status = 'active'
```

**Risk**: Interview submissions accepted for walked-out or completed tokens.

**Fix**: Join with `ats_queue_token` and validate `status='active'`.

---

### 3. Candidate Context

**Current Implementation**: ✅ **VERIFIED CORRECT**

**Timestamp Integrity**: ✅ **PASS**

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts:533-538`

```typescript
// Line 533-538: NEVER touches created_date/created_time ✅
await db.execute(
  `UPDATE ats_candidate 
   SET current_stage = ?, status = ?, updated_at = NOW() 
   WHERE id = ?`,
  [stage, status, candidateId]
);
// Comment at line 533: "// Update ats_candidate status/stage only (never touch created_date / created_time)"
```

**Verified**: S6 fix (git commit `6a4b9da`) already addressed this issue.

**Journey Stages**: ✅ **COMPLETE**

- Arrival
- Round 1 - HR Screening
- Interview - Skill Test
- Round 2 - Op's
- Round 3 - Client
- Selection Discussion

---

**Issues**:

#### 3.1 Missing Audit Actor 🔴

**File**: `backend/src/modules/ats-full-parity/recruiterInterview.service.ts:541-545`

**Problem**:
```typescript
// Line 541-545: Stage log captures WHAT changed, not WHO triggered it
await db.execute(
  `INSERT INTO ats_candidate_stage_log (...) VALUES (...)`,
  [candidateId, oldStage, newStage, timestamp]
  // Missing: submitted_by_user_id (when admin/HR acts on behalf of recruiter)
);
```

**Fix**: Add `actor_user_id` column to `ats_candidate_stage_log`.

#### 3.2 Queue Token Stage Divergence 🟢

**Problem**: `ats_queue_token.current_stage` and `ats_candidate.current_stage` are NEVER synchronized.

**Files**:
- `backend/sql/128_ats_queue_token.sql:9` (`current_stage VARCHAR(100)`)
- `backend/src/modules/ats-full-parity/recruiterInterview.service.ts:533` (updates `ats_candidate.current_stage` only)

**Impact**: Two sources of truth for candidate stage.

**Fix**: Add trigger or update both columns in transaction.

#### 3.3 Missing Per-Round Timestamps 🟢

**Problem**: `ats_interview_submission` tracks `submitted_at` (final submission) but NOT per-round completion times.

**Use Case**: "How long did Round 1 take?" → Cannot answer from data.

**Fix**: Add columns `round1_completed_at`, `skilltest_completed_at`, `round2_completed_at`, `round3_completed_at` to `ats_interview_submission`.

---

## SLA Breach Tracking (Existing Feature)

**Status**: ✅ **COMPREHENSIVE IMPLEMENTATION**

**File**: `backend/src/modules/ats-full-parity/atsFullParity.service.ts:644-679`

**Features**:
- ✅ Configurable threshold (default 120 minutes)
- ✅ Automatic flag update: `ats_candidate.sla_breached = 1`
- ✅ Event logging: `ats_command_sla_event` table
- ✅ Email notifications: Recruiter + CC manager/branch head
- ✅ Uses `TIMESTAMPDIFF(MINUTE, CONCAT(created_date, ' ', created_time), NOW())`

**No issues found** ✅

---

## Recommendations

### Priority 1 (Security + Data Integrity) 🔴

**Estimated Time**: 90 minutes  
**Impact**: HIGH - Prevents impersonation, race conditions, audit gaps

1. **Replace string-based assignment with FK**
   - Migration: Add `recruiter_id CHAR(36)` to `ats_candidate`, FK to `ats_recruiter_roster.id`
   - Migrate data: `UPDATE ats_candidate c JOIN ats_recruiter_roster r ON c.recruiter_assigned_name = r.name SET c.recruiter_id = r.id`
   - Update queries: Replace `recruiter_assigned_name = ?` with `recruiter_id = ?`
   - Deprecate `recruiter_assigned_name` column

2. **Add transaction isolation to capacity tracking**
   - Change `pickRecruiter()` to use `SELECT FOR UPDATE`
   - Wrap assignment + increment in transaction
   - Alternative: Atomic `UPDATE ats_recruiter_roster SET assigned_today = assigned_today + 1 WHERE id = ? AND assigned_today < daily_capacity`

3. **Add impersonation audit trail**
   - Add `submitted_by_user_id CHAR(36)` to `ats_interview_submission_audit`
   - Track when admin/HR submits on behalf of recruiter
   - Add index on `submitted_by_user_id` for audit queries

4. **Add actor tracking to stage log**
   - Add `actor_user_id CHAR(36)` to `ats_candidate_stage_log`
   - Populate during stage transitions

### Priority 2 (Queue Token Race Conditions) 🟡

**Estimated Time**: 60 minutes  
**Impact**: MEDIUM - Prevents duplicate tokens, validates token status

5. **Consolidate queue token systems**
   - Replace `nextQueueToken()` with `ats.queue.service.ts:createToken()`
   - Insert token into `ats_queue_token` table during intake
   - Update `ats_candidate.q_token` with UUID from `ats_queue_token.token`

6. **Add unique partial index for active tokens**
   - `CREATE UNIQUE INDEX idx_active_token ON ats_queue_token(candidate_id, status) WHERE status='active'`
   - Prevents race condition at database level

7. **Validate token status in interview submission**
   - Join with `ats_queue_token` table
   - Reject submission if `status != 'active'`
   - Return `409 Conflict - Token is no longer active` error

### Priority 3 (Operational Gaps) 🟢

**Estimated Time**: 45 minutes  
**Impact**: LOW - Improves data quality, operational reliability

8. **Add automated daily reset**
   - Create cron job: `0 0 * * * curl -X POST http://localhost:3000/api/ats/recruiter/reset-daily-load`
   - Add health check endpoint: `GET /api/ats/recruiter/daily-reset-status`
   - Alert if reset failed

9. **Synchronize queue token stage with candidate stage**
   - Add trigger: `CREATE TRIGGER sync_queue_stage AFTER UPDATE ON ats_candidate ...`
   - Or: Update both columns in same transaction

10. **Add per-round completion timestamps**
    - Migration: Add `round1_completed_at DATETIME`, `skilltest_completed_at DATETIME`, `round2_completed_at DATETIME`, `round3_completed_at DATETIME` to `ats_interview_submission`
    - Populate during submission
    - Use for per-round duration analytics

### Priority 4 (Capacity Enforcement) 🟢

**Estimated Time**: 15 minutes  
**Impact**: LOW - Better UX

11. **Reject intake when no capacity**
    - Change `pickRecruiter()` null return to throw error
    - Return `503 Service Unavailable - No recruiter capacity available. Please try again later.`
    - Add retry-after header

---

## Migration Strategy

### Phase 2A: Security Fixes (Priority 1)

1. Create migration `133_phase2_security_fixes.sql`
2. Add columns: `recruiter_id`, `submitted_by_user_id`, `actor_user_id`
3. Migrate existing data
4. Update backend queries
5. Test ownership scope, capacity tracking
6. Deploy with backward compatibility (keep `recruiter_assigned_name` as fallback for 1 week)

### Phase 2B: Queue Token Consolidation (Priority 2)

1. Create migration `134_phase2_queue_token_consolidation.sql`
2. Add unique partial index
3. Update intake flow to use `ats.queue.service.ts`
4. Add token status validation
5. Test walk-out/re-entry scenarios
6. Deploy

### Phase 2C: Operational Improvements (Priority 3+4)

1. Create migration `135_phase2_operational_improvements.sql`
2. Add per-round timestamps
3. Add trigger for stage sync
4. Set up cron job for daily reset
5. Add capacity enforcement
6. Deploy

---

## Testing Requirements

### Security Tests (P1)

- [ ] Test: Recruiter cannot access other recruiter's candidates (FK-based scope)
- [ ] Test: Admin submission tracked with `submitted_by_user_id`
- [ ] Test: Capacity tracking prevents race conditions (concurrent requests)
- [ ] Test: Stage transitions capture `actor_user_id`

### Queue Token Tests (P2)

- [ ] Test: Intake creates row in `ats_queue_token`
- [ ] Test: Duplicate active token rejected by unique index
- [ ] Test: Submission rejected for walked-out token
- [ ] Test: Submission rejected for completed token

### Operational Tests (P3+4)

- [ ] Test: Daily reset cron job executes successfully
- [ ] Test: Queue token stage syncs with candidate stage
- [ ] Test: Per-round timestamps populated correctly
- [ ] Test: Intake rejected when no capacity (503 error)

---

## Risk Assessment

| Risk | Impact | Mitigation |
|------|--------|------------|
| Breaking existing recruiter workflow | HIGH | Additive migrations, backward compatibility |
| Data migration failure | HIGH | Dry-run migration on staging, rollback script |
| Performance regression | MEDIUM | Index on `recruiter_id`, test query plans |
| Race conditions persist | MEDIUM | Load testing with concurrent requests |
| Downstream dependencies | LOW | Audit all queries using `recruiter_assigned_name` |

---

## Current Commit Status

| Property | Value |
|----------|-------|
| **SHA** | `20ae210` |
| **Branch** | `main` |
| **Message** | feat(notifications): Add testing, monitoring, integration docs and deployment checklist |
| **Date** | 2026-06-11 |
| **Working Tree** | Clean |

---

## Next Steps

1. ✅ Phase 2 audit complete
2. ⏸️ Create migrations for Priority 1 fixes
3. ⏸️ Update backend services
4. ⏸️ Add tests for security fixes
5. ⏸️ Deploy Phase 2A (Security Fixes)
6. ⏸️ Continue with Phase 3 (Interview Decisions & Reschedule)

---

**End of Phase 2 Audit**  
**Status**: ✅ **COMPLETE**  
**Next**: Implement Priority 1 fixes (estimated 90 minutes)
