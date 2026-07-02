# Interviewer Role E2E Specification

**Repository**: https://github.com/shivamgiri-sudo/HRMS1.git  
**Date**: 2026-06-10  
**Status**: ❌ **NOT IMPLEMENTED** (Recruiter workflow exists instead)

---

## Executive Summary

This document specifies what an **Interviewer Role** and **Branch Head Approval** workflow WOULD look like in HRMS1, based on the HRMS (hrms-audit) implementation.

**Current Reality**:
- ✅ **Recruiter Interview Workflow** exists and works
- ❌ **NO separate Interviewer role**
- ❌ **NO Branch Head approval workflow**
- ❌ **NO interview assignment mechanism**

**This is a GAP ANALYSIS document**, not a description of existing features.

---

## Architecture Comparison

### Current: Recruiter Workflow

```
┌──────────┐
│  Walk-In │
│ Candidate│
└────┬─────┘
     │
     ▼
┌─────────────────┐
│ Queue Assignment│ (ats_queue_token)
│ assign_recruiter│
└────┬────────────┘
     │
     ▼
┌──────────────────┐
│ Recruiter Login  │ (PIN + Biometric)
│  NativeATS       │
│ RecruiterWorkspace│
└────┬─────────────┘
     │
     ▼
┌───────────────────┐
│ Submit Interview  │ (ats_interview_submission)
│ All rounds at once│
└────┬──────────────┘
     │
     ▼
┌──────────────┐
│ Candidate    │
│ Stage Update │
└──────────────┘
```

### Proposed: Interviewer + Branch Head Workflow

```
┌──────────┐
│    HR    │
│  Creates │
│Assignment│
└────┬─────┘
     │
     ▼
┌─────────────────────┐
│ Interview Assignment│ (ats_interview_assignment)
│ candidate_id        │
│ interviewer_id      │
│ interview_round     │
└────┬────────────────┘
     │
     ▼
┌──────────────────┐
│ Interviewer Login│ (JWT + Role Check)
│  /interviewer/   │
│    dashboard     │
└────┬─────────────┘
     │
     ▼
┌───────────────────┐
│ Submit Result     │ (per round)
│ Selected/Rejected │
│      /OnHold      │
└────┬──────────────┘
     │
     ├─────────────────────────────────┐
     │                                 │
     ▼                                 ▼
┌──────────┐                   ┌──────────────┐
│ Selected │                   │   Rejected   │
│   → OK   │                   │ → Needs      │
└──────────┘                   │   Approval   │
                                └────┬─────────┘
                                     │
                                     ▼
                              ┌──────────────────┐
                              │ Branch Head      │
                              │ Approval Queue   │
                              │ /branch-head/    │
                              │ interview-approvals│
                              └────┬─────────────┘
                                   │
                       ┌───────────┴───────────┐
                       │                       │
                       ▼                       ▼
                ┌──────────┐           ┌──────────┐
                │ Approve  │           │ Override │
                │ Rejection│           │ Decision │
                └──────────┘           └──────────┘
```

---

## Database Schema: What's Missing

### 1. ats_interview_assignment (NOT IN HRMS1)

**Purpose**: Track interview assignments to specific interviewers

**From HRMS Implementation**:
```sql
CREATE TABLE ats_interview_assignment (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  candidate_id CHAR(36) NOT NULL,
  interviewer_id CHAR(36) NOT NULL,          -- FK → employees.id
  interview_round TINYINT NOT NULL,          -- 1, 2, 3, or 4
  assigned_by CHAR(36),                      -- HR user who assigned
  assigned_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  interview_date DATE,
  interview_time TIME,
  status VARCHAR(50) DEFAULT 'Assigned',     -- Assigned, Completed, NoShow, Rescheduled, Cancelled
  result VARCHAR(120),                       -- Selected, Rejected, OnHold, Pending
  voc VARCHAR(255),                          -- Voice of Customer (rejection reason)
  remarks TEXT,
  evidence_url VARCHAR(500),                 -- Optional evidence document
  submitted_at DATETIME,
  branch_id CHAR(36),
  process_id CHAR(36),
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  FOREIGN KEY (candidate_id) REFERENCES ats_candidate(id) ON DELETE CASCADE,
  FOREIGN KEY (interviewer_id) REFERENCES employees(id) ON DELETE RESTRICT,
  FOREIGN KEY (assigned_by) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branch_master(id) ON DELETE SET NULL,
  FOREIGN KEY (process_id) REFERENCES process_master(id) ON DELETE SET NULL,
  
  INDEX idx_interviewer_status (interviewer_id, status),
  INDEX idx_candidate_round (candidate_id, interview_round),
  INDEX idx_interview_date (interview_date),
  INDEX idx_branch_process (branch_id, process_id)
);
```

**Key Differences from ats_interview_submission**:
- ✅ One row **PER ROUND** (not all rounds in one row)
- ✅ FK to `employees.id` (not string-based assignment)
- ✅ Per-round status tracking
- ✅ Interview date/time scheduling
- ❌ NO skill test fields (that's Round 1.5, separate)
- ❌ NO offer fields (those go in ats_candidate after final round)

### 2. ats_interview_approval_log (NOT IN HRMS1)

**Purpose**: Branch head approval tracking for interview rejections

**From HRMS Design**:
```sql
CREATE TABLE ats_interview_approval_log (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  assignment_id CHAR(36) NOT NULL,           -- FK → ats_interview_assignment.id
  approver_id CHAR(36) NOT NULL,             -- Branch head employee_id
  action VARCHAR(50),                        -- 'Approved', 'Overridden', 'ReInterviewRequested'
  remarks TEXT,                              -- Branch head notes
  approved_at DATETIME,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  
  FOREIGN KEY (assignment_id) REFERENCES ats_interview_assignment(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_id) REFERENCES employees(id) ON DELETE RESTRICT,
  
  INDEX idx_approver (approver_id),
  INDEX idx_assignment (assignment_id)
);
```

**Workflow**:
1. Interviewer submits "Rejected" result
2. Entry created in approval_log with action=NULL (pending)
3. Branch head reviews and updates action + remarks
4. Candidate stage updated based on action

### 3. Role Additions (NOT IN HRMS1)

**workforce_role_catalog**:
```sql
INSERT INTO workforce_role_catalog (id, role_key, role_name, description)
VALUES 
(UUID(), 'interviewer', 'Interviewer', 'Conducts candidate interviews and submits results');
```

**page_catalog**:
```sql
INSERT INTO page_catalog (page_code, page_name, module, route, description)
VALUES
('ATS_INTERVIEW_QUEUE', 'My Interviews', 'ATS', '/interviewer/dashboard', 'View and manage assigned interviews'),
('ATS_INTERVIEW_SUBMIT', 'Submit Interview Result', 'ATS', '/interviewer/submit', 'Submit interview results'),
('ATS_INTERVIEW_APPROVALS', 'Interview Approvals', 'ATS', '/branch-head/interview-approvals', 'Approve/override interview rejections');
```

**role_page_access**:
```sql
INSERT INTO role_page_access (id, role_key, page_code, can_view, can_create, can_edit, can_delete, can_export)
VALUES
(UUID(), 'interviewer', 'ATS_INTERVIEW_QUEUE', 1, 0, 1, 0, 0),
(UUID(), 'interviewer', 'ATS_INTERVIEW_SUBMIT', 1, 1, 1, 0, 0),
(UUID(), 'branch_head', 'ATS_INTERVIEW_APPROVALS', 1, 0, 1, 0, 0);
```

---

## Backend API: What's Missing

### Interviewer Endpoints (NOT IN HRMS1)

| Method | Endpoint | Auth | Roles | Scope | Status |
|--------|----------|------|-------|-------|--------|
| GET | `/api/ats/interviewer/my-interviews` | JWT | interviewer, admin | Own assignments | ❌ Missing |
| GET | `/api/ats/interviewer/interview/:id` | JWT | interviewer, admin | Ownership check | ❌ Missing |
| POST | `/api/ats/interviewer/submit-result` | JWT | interviewer, admin | Ownership check | ❌ Missing |
| POST | `/api/ats/interviewer/mark-noshow` | JWT | interviewer, admin | Ownership check | ❌ Missing |
| POST | `/api/ats/interviewer/reschedule` | JWT | interviewer, admin | Ownership check | ❌ Missing |
| GET | `/api/ats/interviewer/stats` | JWT | interviewer, admin | Own data | ❌ Missing |

### Branch Head Endpoints (NOT IN HRMS1)

| Method | Endpoint | Auth | Roles | Scope | Status |
|--------|----------|------|-------|-------|--------|
| GET | `/api/ats/branch-head/pending-approvals` | JWT | branch_head, admin | Branch scope | ❌ Missing |
| POST | `/api/ats/branch-head/approve` | JWT | branch_head, admin | Branch scope | ❌ Missing |
| POST | `/api/ats/branch-head/override` | JWT | branch_head, admin | Branch scope | ❌ Missing |
| POST | `/api/ats/branch-head/request-reinterview` | JWT | branch_head, admin | Branch scope | ❌ Missing |

---

## Frontend UI: What's Missing

### 1. InterviewerDashboard.tsx (NOT IN HRMS1)

**From HRMS Implementation** (220 lines):

**Features**:
- 5 stat cards: Total, Pending, Completed, NoShow, Today
- Interview list table with filters (status, date, round)
- Click row → navigate to submit form
- Loading states + error handling
- Responsive design

**Current HRMS1**: N/A (uses NativeATSRecruiterWorkspace instead)

### 2. InterviewSubmitResult.tsx (NOT IN HRMS1)

**From HRMS Implementation** (290 lines):

**Features**:
- Interview info card (candidate details, round, date/time)
- Result selection: Selected / Rejected / OnHold
- Context-aware VOC dropdown (8 selection / 10 rejection reasons)
- Remarks textarea (min 10 chars)
- Mark as No-Show button with reason prompt
- Reschedule button with date picker
- View mode for completed interviews (read-only)

**Current HRMS1**: NativeATSRecruiterWorkspace has similar UI but combines ALL rounds in one form

### 3. BranchHeadApprovalQueue.tsx (NOT IN HRMS OR HRMS1)

**Planned Design**:

**Features**:
- List of pending rejections
- Filter by: round, process, date range
- Candidate profile quick view
- Interview feedback display
- Approve / Override / Request Re-interview actions
- Remarks field for approval decision

---

## Business Logic: What's Missing

### 1. Interview Assignment

**Current HRMS1**: NO assignment mechanism
- Candidates assigned to recruiter via `recruiter_assigned_name` string
- No per-round assignment
- No date/time scheduling

**Needed**:
```typescript
// interviewer.service.ts - assignInterview()
async assignInterview(input: {
  candidateId: string;
  interviewerId: string;
  interviewRound: number;
  interviewDate: string;
  interviewTime: string;
  assignedBy: string;
}): Promise<Assignment> {
  // Validate candidate exists and is in correct stage
  // Validate interviewer has capacity
  // Create assignment row
  // Send notification to interviewer
}
```

### 2. Per-Round Result Submission

**Current HRMS1**: All rounds submitted together in one form
- Single `ats_interview_submission` row with all round fields
- Cannot submit Round 1 result without knowing Round 2 outcome

**Needed**:
```typescript
// interviewer.service.ts - submitResult()
async submitResult(input: {
  assignmentId: string;
  result: 'Selected' | 'Rejected' | 'OnHold';
  voc: string | null;
  remarks: string;
}, interviewerId: string): Promise<void> {
  // Validate ownership (assignment.interviewer_id === interviewerId)
  // Validate result + VOC combination
  // Update assignment.result, assignment.status = 'Completed'
  // If result = 'Rejected' → create approval_log entry (status = 'Pending')
  // If result = 'Selected' → update candidate stage to next round
  // Insert audit log
}
```

### 3. Branch Head Approval

**Current HRMS1**: NO approval workflow

**Needed**:
```typescript
// branchHead.service.ts - approveRejection()
async approveRejection(input: {
  assignmentId: string;
  action: 'Approved' | 'Overridden' | 'ReInterviewRequested';
  remarks: string;
}, approverId: string): Promise<void> {
  // Validate branch scope (assignment.branch_id IN user's branches)
  // Validate assignment has pending approval
  // Update approval_log entry
  // If action = 'Approved' → finalize rejection, update candidate stage
  // If action = 'Overridden' → revert rejection, move to next round
  // If action = 'ReInterviewRequested' → create new assignment
  // Insert audit log
}
```

### 4. No-Show Tracking

**Current HRMS1**: Limited support
- `ats_queue_token.status = 'walked_out'` exists
- But no per-round no-show tracking

**Needed**:
```typescript
// interviewer.service.ts - markNoShow()
async markNoShow(input: {
  assignmentId: string;
  reason: string;
}, interviewerId: string): Promise<void> {
  // Validate ownership
  // Update assignment.status = 'NoShow'
  // Update assignment.remarks = reason
  // Update candidate stage = 'No Show Round X'
  // Send notification to HR
}
```

### 5. Rescheduling

**Current HRMS1**: NO rescheduling

**Needed**:
```typescript
// interviewer.service.ts - reschedule()
async reschedule(input: {
  assignmentId: string;
  newDate: string;
  newTime: string;
  reason: string;
}, interviewerId: string): Promise<void> {
  // Validate ownership
  // Validate new date is future
  // Update assignment.interview_date, assignment.interview_time
  // Update assignment.status = 'Rescheduled'
  // Insert reschedule log
  // Send notification to candidate + HR
}
```

---

## Security Model: Current vs Needed

### Current (Recruiter Workflow)

**Authentication**: PIN + Biometric
```typescript
// recruiterInterview.service.ts
const pinValid = await bcrypt.compare(pin, recruiter.pin_hash);
const hasPunch = await checkBiometricPunch(recruiter.employee_id);
```

**Authorization**: String-based assignment check
```typescript
WHERE recruiter_assigned_name = ?
```

**Scope**: Per-recruiter (can only see own assigned candidates)

### Needed (Interviewer Workflow)

**Authentication**: JWT + Role Check
```typescript
// middleware/requireAuth.ts
const user = verifyToken(req.headers.authorization);
requireRole(['interviewer', 'admin'])(req, res, next);
```

**Authorization**: FK-based ownership check
```typescript
// interviewer.service.ts - getInterviewById()
const [assignment] = await db.execute(
  "SELECT * FROM ats_interview_assignment WHERE id = ? AND interviewer_id = ?",
  [assignmentId, interviewerId]
);
if (!assignment) throw { statusCode: 404, message: "Not found or not authorized" };
```

**Scope**: Multi-level
- Interviewer: Own assignments only (`WHERE interviewer_id = ?`)
- Branch Head: Branch scope (`WHERE branch_id IN (SELECT branch_id FROM user_assignment_scope WHERE user_id = ?)`)
- Admin/HR: All data (bypass scope)

---

## Migration Path: Recruiter → Interviewer

### Option 1: Keep Both Systems

**Pros**:
- No disruption to existing recruiter workflow
- Gradual rollout

**Cons**:
- Duplicate functionality
- Confusion about which to use

**Implementation**:
1. Add interviewer tables alongside existing
2. Create new `/api/ats/interviewer/*` namespace
3. Build new frontend pages
4. Allow both workflows to coexist

### Option 2: Replace Recruiter with Interviewer

**Pros**:
- Single source of truth
- Matches HRMS architecture

**Cons**:
- Breaking change
- Data migration required
- Mobile app must be updated

**Implementation**:
1. Create migration: `ats_interview_submission` → `ats_interview_assignment`
   - Split combined submission into per-round rows
   - Map `recruiter_code` to `interviewer_id` via employees table
2. Deprecate `/api/ats/recruiter/*` endpoints
3. Update NativeATSRecruiterWorkspace to use new APIs
4. Update mobile app (EXTERNAL - NOT IN THIS REPO)

### Option 3: Hybrid Model

**Pros**:
- Recruiter handles initial screening (Round 1)
- Specialist interviewers handle later rounds
- Best of both worlds

**Cons**:
- Most complex
- Requires careful workflow design

**Implementation**:
1. Keep `ats_interview_submission` for Round 1 (recruiter)
2. Use `ats_interview_assignment` for Rounds 2-4 (interviewer)
3. Trigger: When Round 1 result = 'Selected' → create Round 2 assignment
4. Frontend: Recruiter workspace for R1, Interviewer dashboard for R2+

---

## Data Model Example

### Current: Recruiter Submission

**Single row in ats_interview_submission**:
```json
{
  "id": "uuid-1",
  "candidate_id": "cand-123",
  "q_token": "token-456",
  "recruiter_code": "REC001",
  "walkin_end_stage": "Round 3- Client",
  "final_decision": "Selected",
  "round1_result": "Selected",
  "round1_voc": null,
  "round1_remarks": "Good communication",
  "skilltest_typing": 35.5,
  "skilltest_ai": 78.2,
  "skilltest_result": "Selected",
  "round2_result": "Selected",
  "round2_remarks": "Strong ops knowledge",
  "round3_result": "Selected",
  "round3_remarks": "Client approved",
  "offer_salary": 18000,
  "offer_doj": "2026-06-15"
}
```

### Proposed: Interviewer Assignments

**Multiple rows in ats_interview_assignment**:
```json
[
  {
    "id": "uuid-1",
    "candidate_id": "cand-123",
    "interviewer_id": "emp-hr-001",
    "interview_round": 1,
    "interview_date": "2026-06-10",
    "interview_time": "10:00:00",
    "status": "Completed",
    "result": "Selected",
    "voc": null,
    "remarks": "Good communication"
  },
  {
    "id": "uuid-2",
    "candidate_id": "cand-123",
    "interviewer_id": "emp-ops-002",
    "interview_round": 2,
    "interview_date": "2026-06-10",
    "interview_time": "11:00:00",
    "status": "Completed",
    "result": "Selected",
    "voc": null,
    "remarks": "Strong ops knowledge"
  },
  {
    "id": "uuid-3",
    "candidate_id": "cand-123",
    "interviewer_id": "emp-client-003",
    "interview_round": 4,
    "interview_date": "2026-06-11",
    "interview_time": "14:00:00",
    "status": "Completed",
    "result": "Selected",
    "voc": null,
    "remarks": "Client approved"
  }
]
```

**Offer data stays in ats_candidate**:
```json
{
  "id": "cand-123",
  "current_stage": "Selected - Offer Extended",
  "offer_salary": 18000,
  "offer_doj": "2026-06-15"
}
```

---

## Summary: What This Repo Has vs HRMS

| Feature | HRMS1 (shivamgiri-sudo) | HRMS (hrms-audit) |
|---------|-------------------------|-------------------|
| **Recruiter Interview** | ✅ COMPLETE | ❌ NO (different use case) |
| **Interviewer Role** | ❌ NO | ✅ COMPLETE |
| **Branch Head Approval** | ❌ NO | ⏸️ PARTIAL (table ready, API pending) |
| **Per-Round Assignment** | ❌ NO | ✅ YES |
| **Interview Scheduling** | ❌ NO | ✅ YES |
| **No-Show Tracking** | ⚠️ LIMITED | ✅ COMPLETE |
| **Reschedule Flow** | ❌ NO | ✅ YES |
| **Navigation Menu** | ❌ NO | ✅ YES |
| **Mobile-First UI** | ✅ YES | ❌ NO (desktop-first) |
| **PIN Auth** | ✅ YES | ❌ NO (JWT only) |
| **Biometric Integration** | ✅ YES | ❌ NO |
| **Resubmission Tracking** | ✅ YES | ❌ NO |
| **All-Rounds-At-Once** | ✅ YES | ❌ NO (per-round) |

---

## Recommendation

**For HRMS1 Users**:
- ✅ Current recruiter workflow is **PRODUCTION READY**
- ✅ Works well for mobile-first, single-person interview process
- ❌ Does NOT match HRMS architecture (different use case)
- ⚠️ Consider interviewer/branch head ONLY if:
  - Need separation of duties (recruit ≠ interview)
  - Need quality control (branch head oversight)
  - Need per-round scheduling (specialist interviewers)
  - Need multi-round reassignment

**If implementing interviewer/branch head**:
- Recommend **Option 3: Hybrid Model** for minimal disruption
- Keep recruiter for Round 1, add interviewer for Rounds 2-4
- Estimated effort: 3-5 days backend + 2-3 days frontend + 1 day testing

**If NOT implementing**:
- Document current architecture as intentional design choice
- Add note to README explaining difference from HRMS
- Close gap analysis

---

**End of Specification**  
**Status**: GAP ANALYSIS  
**Next**: Test Matrix + Scope Matrix documents
