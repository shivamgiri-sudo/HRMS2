# Interviewer E2E Test Matrix

**Repository**: https://github.com/shivamgiri-sudo/HRMS1.git  
**Date**: 2026-06-10  
**Status**: ❌ **NOT APPLICABLE** (Interviewer role not implemented)

---

## Summary

This repository implements a **RECRUITER interview workflow**, not an interviewer role.

**Current Test Coverage**:
- ✅ **Recruiter tests**: 28/28 passing (`backend/tests/ats.recruiter.test.ts`)
- ✅ **Total ATS tests**: 126/126 passing
- ✅ **Total backend tests**: 1201/1282 passing (93.7%)

**Interviewer Test Coverage**: ❌ **N/A** (role does not exist)

---

## Existing Test Coverage (Recruiter Workflow)

### Backend Tests: ats.recruiter.test.ts

**File**: `backend/tests/ats.recruiter.test.ts`  
**Tests**: 28  
**Status**: ✅ **ALL PASS**

| Test ID | Category | Description | Status |
|---------|----------|-------------|--------|
| TC-01-A | Assignment Scope | Returns only assigned Waiting candidates | ✅ PASS |
| TC-01-B | Assignment Scope | Rejects unassigned candidates | ✅ PASS |
| TC-02-A | Authentication | Wrong PIN rejected | ✅ PASS |
| TC-02-B | Authentication | Unknown recruiter code rejected | ✅ PASS |
| TC-02-C | Authentication | No biometric punch rejected | ✅ PASS |
| TC-02-D | Authentication | Valid biometric punch accepted | ✅ PASS |
| TC-03-A | Validation | Blank Skill Test accepted at Round 2 | ✅ PASS |
| TC-03-B | Validation | Blank Skill Test accepted at Selection Discussion | ✅ PASS |
| TC-04-A | VOC Validation | SkillTest Rejected without VOC denied | ✅ PASS |
| TC-04-B | VOC Validation | SkillTest Rejected with VOC accepted | ✅ PASS |
| TC-05-A | VOC Validation | Round1 Rejected without VOC denied | ✅ PASS |
| TC-05-B | VOC Validation | Round2 Rejected without VOC denied | ✅ PASS |
| TC-05-C | VOC Validation | Round3 Rejected without VOC denied | ✅ PASS |
| TC-06-A | Offer Validation | Selected without salary denied | ✅ PASS |
| TC-06-B | Offer Validation | Selected without DOJ denied | ✅ PASS |
| TC-06-C | Offer Validation | Selected without reporting time denied | ✅ PASS |
| TC-07 | Cascade Logic | Selected cascades all round results to Selected | ✅ PASS |
| TC-08-A | Enum Validation | Invalid process denied | ✅ PASS |
| TC-08-B | Enum Validation | Invalid decision denied | ✅ PASS |
| TC-08-C | Enum Validation | Invalid stage denied | ✅ PASS |
| TC-09 | Upsert Logic | First submission inserts one row | ✅ PASS |
| TC-10 | Upsert Logic | Resubmission updates same row, preserves tracking | ✅ PASS |
| TC-11 | Token Validation | QToken mismatch rejected with 409 | ✅ PASS |
| TC-12 | Data Integrity | created_date/created_time never modified in UPDATE | ✅ PASS |
| TC-13 | Concurrency | SELECT FOR UPDATE prevents duplicate rows | ✅ PASS |
| TC-14-A | Audit | Audit row action=INSERT on first submission | ✅ PASS |
| TC-14-B | Audit | Audit row action=UPDATE on resubmission | ✅ PASS |
| TC-15 | Validation | Frontend validation matches backend errors | ✅ PASS |

---

## Hypothetical Test Coverage (If Interviewer Implemented)

### Backend Tests: interviewer.routes.test.ts (NOT IMPLEMENTED)

**Estimated**: 58 test cases  
**Status**: ❌ **NOT CREATED**

| Test ID | Category | Description | Priority |
|---------|----------|-------------|----------|
| INT-01 | Auth | Returns 401 without authentication | P0 |
| INT-02 | Auth | Returns 403 for non-interviewer role | P0 |
| INT-03 | Assignment List | Returns empty array when no interviews assigned | P1 |
| INT-04 | Assignment List | Filters by status parameter | P1 |
| INT-05 | Assignment List | Filters by date parameter | P1 |
| INT-06 | Assignment List | Filters by round parameter | P1 |
| INT-07 | Assignment Detail | Returns 404 for non-existent assignment | P1 |
| INT-08 | Assignment Detail | Returns 404 when assignment belongs to different interviewer | P0 |
| INT-09 | Assignment Detail | Returns assignment details for valid request | P1 |
| INT-10 | Submit Result | Returns 400 with missing required fields | P0 |
| INT-11 | Submit Result | Returns 400 with invalid result value | P0 |
| INT-12 | Submit Result | Returns 400 with remarks too short | P1 |
| INT-13 | Submit Result | Returns 400 when trying to modify completed interview | P0 |
| INT-14 | Submit Result | Returns 404 when assignment belongs to different interviewer | P0 |
| INT-15 | Submit Result | Successfully submits Selected result | P0 |
| INT-16 | Submit Result | Successfully submits Rejected result | P0 |
| INT-17 | Submit Result | Rejected result creates approval_log entry | P0 |
| INT-18 | Submit Result | Updates candidate stage correctly | P0 |
| INT-19 | Mark No-Show | Returns 400 with missing required fields | P1 |
| INT-20 | Mark No-Show | Returns 400 with remarks too short | P1 |
| INT-21 | Mark No-Show | Returns 400 when trying to mark completed interview | P1 |
| INT-22 | Mark No-Show | Successfully marks assignment as no-show | P1 |
| INT-23 | Reschedule | Returns 400 with missing required fields | P1 |
| INT-24 | Reschedule | Returns 400 with invalid date format | P1 |
| INT-25 | Reschedule | Returns 400 when rescheduling to past date | P1 |
| INT-26 | Reschedule | Returns 400 with reason too short | P1 |
| INT-27 | Reschedule | Returns 400 when trying to reschedule completed interview | P1 |
| INT-28 | Reschedule | Successfully reschedules interview | P1 |
| INT-29 | Stats | Returns 401 without authentication | P1 |
| INT-30 | Stats | Returns statistics for interviewer | P1 |
| INT-31 | Stats | Counts only interviewer's own assignments | P0 |
| INT-32 | Security | Interviewer cannot access admin-only endpoints | P0 |
| INT-33 | Security | Interviewer cannot modify other interviewer's assignments | P0 |
| INT-34 | Security | Interviewer cannot view candidates outside their assignments | P0 |
| INT-35 | Security | SQL injection attempts are blocked | P0 |
| INT-36 | Security | Assignment ID tampering is detected | P0 |
| INT-37 | Security | Role-based access control enforced | P0 |
| INT-38 | Scope | Branch scope enforced for branch_head role | P0 |
| INT-39 | Scope | Admin can access all assignments | P1 |
| INT-40 | Scope | Process scope enforced for process_manager role | P0 |
| INT-41 | Concurrency | Simultaneous submit by 2 interviewers handled | P1 |
| INT-42 | Validation | VOC required on rejection | P0 |
| INT-43 | Validation | Remarks min 10 chars enforced | P1 |
| INT-44 | Validation | Future date validation on reschedule | P1 |
| INT-45 | Audit | Audit log created on submit | P1 |
| INT-46 | Audit | Audit log includes user_id | P1 |
| INT-47 | Stage Update | Round 1 Selected → Stage = 'Interview Round 2' | P0 |
| INT-48 | Stage Update | Round 4 Selected → Stage = 'Selected - Offer Extended' | P0 |
| INT-49 | Stage Update | Rejected → Stage = 'Rejected Round X' | P0 |
| INT-50 | Stage Update | OnHold → Stage = 'On Hold Round X' | P1 |
| INT-51 | Assignment Creation | HR can create assignment | P0 |
| INT-52 | Assignment Creation | Interviewer cannot create assignment | P0 |
| INT-53 | Assignment Creation | Branch scope enforced on creation | P0 |
| INT-54 | Assignment Update | Reassignment updates interviewer_id | P1 |
| INT-55 | Assignment Update | Cannot reassign completed assignment | P1 |
| INT-56 | Assignment Delete | Cannot delete assignment with submitted result | P1 |
| INT-57 | Assignment Delete | Can delete unsubmitted assignment | P1 |
| INT-58 | Assignment Delete | Soft delete preserves audit trail | P1 |

### Frontend E2E Tests: interviewer-dashboard.spec.ts (NOT IMPLEMENTED)

**Estimated**: 39 test cases  
**Status**: ❌ **NOT CREATED**

#### File 1: interviewer-dashboard.spec.ts (8 tests)

| Test ID | Description | Priority |
|---------|-------------|----------|
| E2E-01 | Login as interviewer → Navigate to /interviewer/dashboard | P0 |
| E2E-02 | Dashboard displays 5 stat cards correctly | P1 |
| E2E-03 | Interview list loads with correct data | P0 |
| E2E-04 | Filter by status (All, Assigned, Completed, NoShow) | P1 |
| E2E-05 | Click interview row → Navigate to submit form | P0 |
| E2E-06 | Loading states display correctly | P1 |
| E2E-07 | Error handling works (network error) | P1 |
| E2E-08 | Responsive design on mobile | P2 |

#### File 2: interviewer-submit-result.spec.ts (12 tests)

| Test ID | Description | Priority |
|---------|-------------|----------|
| E2E-09 | Navigate to /interviewer/submit/:assignmentId | P0 |
| E2E-10 | Interview info card displays correctly | P1 |
| E2E-11 | Select result (Selected) → VOC updates to selection reasons | P1 |
| E2E-12 | Select result (Rejected) → VOC updates to rejection reasons | P0 |
| E2E-13 | Submit result with valid data → Success message | P0 |
| E2E-14 | Submit result → Verify database update | P0 |
| E2E-15 | Submit result → Verify redirect to dashboard | P1 |
| E2E-16 | Submit result with missing remarks → Validation error | P1 |
| E2E-17 | Submit result with remarks < 10 chars → Validation error | P1 |
| E2E-18 | Try to submit completed interview → Error message | P1 |
| E2E-19 | View completed interview → View mode (read-only) | P1 |
| E2E-20 | Back button → Navigate to dashboard | P2 |

#### File 3: interviewer-noshow.spec.ts (5 tests)

| Test ID | Description | Priority |
|---------|-------------|----------|
| E2E-21 | Click "Mark as No-Show" button → Prompt appears | P1 |
| E2E-22 | Enter reason < 10 chars → Validation error | P1 |
| E2E-23 | Enter valid reason → Success message | P1 |
| E2E-24 | Verify database status = 'NoShow' | P1 |
| E2E-25 | Verify redirect to dashboard | P2 |

#### File 4: interviewer-reschedule.spec.ts (6 tests)

| Test ID | Description | Priority |
|---------|-------------|----------|
| E2E-26 | Click "Reschedule" button → Date prompt appears | P1 |
| E2E-27 | Enter invalid date format → Error | P1 |
| E2E-28 | Enter past date → Validation error | P1 |
| E2E-29 | Enter future date + valid reason → Success | P1 |
| E2E-30 | Verify database interview_date updated | P1 |
| E2E-31 | Verify redirect to dashboard | P2 |

#### File 5: interviewer-security.spec.ts (8 tests)

| Test ID | Description | Priority |
|---------|-------------|----------|
| E2E-32 | Non-interviewer user → Cannot access /interviewer/dashboard | P0 |
| E2E-33 | Interviewer A → Cannot access Interviewer B's assignment | P0 |
| E2E-34 | Direct URL to other interviewer's assignment → 404/403 | P0 |
| E2E-35 | Modify assignment ID in form submit → Validation fails | P0 |
| E2E-36 | SQL injection in filter params → Blocked | P0 |
| E2E-37 | XSS in remarks field → Sanitized | P0 |
| E2E-38 | CSRF token validation (if applicable) | P1 |
| E2E-39 | Session timeout → Redirect to login | P1 |

### Branch Head Tests: branch-head-approval.spec.ts (NOT IMPLEMENTED)

**Estimated**: 15 test cases  
**Status**: ❌ **NOT CREATED**

| Test ID | Description | Priority |
|---------|-------------|----------|
| BH-01 | Branch head login → Navigate to /branch-head/interview-approvals | P0 |
| BH-02 | Approval queue displays pending rejections | P0 |
| BH-03 | Filter by round/process/date | P1 |
| BH-04 | Click approval row → Review modal opens | P1 |
| BH-05 | View interview feedback in modal | P1 |
| BH-06 | Approve rejection → Success message | P0 |
| BH-07 | Verify database action='Approved' | P0 |
| BH-08 | Verify candidate stage updated | P0 |
| BH-09 | Override rejection → Success message | P0 |
| BH-10 | Verify database action='Overridden' | P0 |
| BH-11 | Verify candidate moved to next round | P0 |
| BH-12 | Request re-interview → New assignment created | P1 |
| BH-13 | Branch scope enforced (cannot approve other branches) | P0 |
| BH-14 | Admin can approve all branches | P1 |
| BH-15 | Audit log created on approval | P1 |

---

## Test Data Setup (If Implemented)

### Required Test Data

#### 1. Create Test Interviewer User
```sql
-- 1. Create employee with interviewer role
INSERT INTO employees (id, employee_code, full_name, email, role_key, active_status)
VALUES (UUID(), 'INT001', 'Test Interviewer', 'interviewer@test.com', 'interviewer', 1);

-- 2. Create auth_user
INSERT INTO auth_user (id, email, password, employee_id)
VALUES (UUID(), 'interviewer@test.com', '$2b$10$hashedpassword', 
  (SELECT id FROM employees WHERE email = 'interviewer@test.com'));
```

#### 2. Create Test Candidate
```sql
INSERT INTO ats_candidate (id, full_name, mobile, email, current_stage, branch_id, process_id)
VALUES (UUID(), 'Test Candidate', '+919999999999', 'candidate@test.com', 
  'Interview Scheduled', 'branch-id', 'process-id');
```

#### 3. Create Test Interview Assignment
```sql
INSERT INTO ats_interview_assignment (
  id, candidate_id, interviewer_id, interview_round,
  assigned_by, interview_date, interview_time,
  status, branch_id, process_id
) VALUES (
  UUID(),
  (SELECT id FROM ats_candidate WHERE email = 'candidate@test.com'),
  (SELECT id FROM employees WHERE email = 'interviewer@test.com'),
  1, -- Round 1
  (SELECT id FROM employees WHERE role_key = 'hr' LIMIT 1),
  CURDATE() + INTERVAL 1 DAY,
  '14:00:00',
  'Assigned',
  'branch-id',
  'process-id'
);
```

---

## Test Coverage Goals (If Implemented)

### Phase 1 (Baseline)
- [ ] Backend test structure: 58 test cases defined
- [ ] Backend integration: Structure ready, needs execution
- [ ] Frontend E2E: 0/39 implemented
- **Target Coverage**: 58% (58/112 total)

### Phase 2 (Core E2E)
- [ ] Implement interviewer-dashboard.spec.ts: 8 tests
- [ ] Implement interviewer-submit-result.spec.ts: 12 tests
- [ ] Create test data setup script
- [ ] Run full E2E suite locally
- **Target Coverage**: 80% (78/112)

### Phase 3 (Complete)
- [ ] Implement all remaining E2E tests: 19 tests
- [ ] Implement branch-head tests: 15 tests
- [ ] Add security penetration tests
- [ ] Add performance/load tests
- **Target Coverage**: 95%

---

## Current Reality

**This repository does NOT have**:
- ❌ Interviewer role
- ❌ Interview assignment table
- ❌ Per-round submission
- ❌ Branch head approval
- ❌ Interviewer API endpoints
- ❌ Interviewer frontend pages

**This repository DOES have**:
- ✅ Recruiter interview workflow (complete)
- ✅ Recruiter authentication (PIN + biometric)
- ✅ All-rounds-at-once submission
- ✅ Comprehensive recruiter tests (28/28 passing)

---

## Recommendation

**Do NOT implement interviewer tests** unless:
1. Interviewer role is implemented first
2. ats_interview_assignment table is created
3. Interviewer API endpoints are built
4. Interviewer frontend pages are created

**Current test coverage is EXCELLENT** for what exists:
- ✅ 28/28 recruiter tests passing
- ✅ 126/126 ATS tests passing
- ✅ 93.7% backend tests passing overall

**If implementing interviewer/branch head**:
- Estimate: 58 backend + 39 E2E + 15 branch head = **112 additional tests**
- Effort: 3-5 days (backend tests) + 2-3 days (E2E tests)
- Priority: P0 tests first (auth, scope, security)

---

**End of Test Matrix**  
**Status**: ❌ **NOT APPLICABLE** (interviewer role not implemented)  
**Next**: Scope Matrix document
