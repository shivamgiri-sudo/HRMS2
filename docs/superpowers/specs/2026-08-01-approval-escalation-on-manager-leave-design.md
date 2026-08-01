# Approval Escalation When Reporting Manager Is On Leave

**Date:** 2026-08-01  
**Status:** Approved  
**Scope:** Leave requests, Attendance Regularization, Attendance Disputes

---

## Problem

When an employee's reporting manager is on approved leave, their pending leave requests, regularization requests, and attendance dispute actions sit unactioned. No escalation exists today.

## Decision

**Option A trigger:** Any approved leave record covering today's date escalates the approver — regardless of whether it is full-day or half-day.

**Pattern:** Skip-level escalation via a shared utility. No database migration required.

---

## Architecture

### New File: `backend/src/shared/approvalEscalation.ts`

Exports one function:

```typescript
interface EffectiveApprover {
  approverId: string | null;
  isEscalated: boolean;
  escalationReason: string | null;
}

async function resolveEffectiveApprover(employeeId: string): Promise<EffectiveApprover>
```

**Logic:**
1. Look up direct manager via `COALESCE(reporting_manager_id, manager_id)` on `employees`.
2. If none → `{ approverId: null, isEscalated: false, escalationReason: null }`.
3. Check `leave_request` for the direct manager: `status IN ('approved', 'branch_head_approved') AND from_date <= CURDATE() AND to_date >= CURDATE()`.
4. If NOT on leave → `{ approverId: directManagerId, isEscalated: false, escalationReason: null }`.
5. If ON leave → walk one level up (manager's manager via same COALESCE).
6. Return `{ approverId: skipLevelId | null, isEscalated: true, escalationReason: "Direct manager on approved leave" }`.

**Edge cases handled:**
- No manager set → `approverId: null`, HR Admin fallback via existing role bypass.
- Skip-level also on leave or missing → `approverId: null`, same fallback.
- Circular chains impossible: exactly 2 SQL hops, not recursive.
- Half-day leave escalates (Option A decision).

---

## Integration Points

### 1. Leave — `backend/src/modules/leave/leave.secure.routes.ts`

`canReviewLeave()` line 31 — replace direct ID comparison:

```typescript
// Before
return Boolean(callerEmp?.id && (callerEmp.id === target.reporting_manager_id || callerEmp.id === target.manager_id));

// After
const { approverId } = await resolveEffectiveApprover(target.employee_id);
return Boolean(callerEmp?.id && approverId !== null && callerEmp.id === approverId);
```

### 2. Regularization — `backend/src/modules/wfm/wfm.regularization.secure.routes.ts`

`regularizationReviewRole()` line 92 — replace direct ID comparison:

```typescript
// Before
if (callerEmp?.id && (callerEmp.id === target.reporting_manager_id || callerEmp.id === target.manager_id)) return "manager";

// After
const { approverId } = await resolveEffectiveApprover(target.employee_id);
if (callerEmp?.id && approverId !== null && callerEmp.id === approverId) return "manager";
```

### 3. Disputes — `backend/src/modules/attendance/attendance.dispute.routes.ts`

`manager-action` route — add escalated approver as an **additional** allowed path alongside existing `hasScopedAccess`:

```typescript
// After hasScopedAccess check fails, also allow escalated approver
const { approverId } = await resolveEffectiveApprover(dispute.employee_id);
const isEscalatedApprover = callerEmp?.id && approverId !== null && callerEmp.id === approverId;
if (!scoped && !isEscalatedApprover) return res.status(403)...
```

---

## What Is NOT Changed

- `super_admin`, `admin`, `hr`, `hr_admin`, `payroll_hr` bypass — unchanged, always works.
- Dispute HR-action and payroll-action routes — not affected (not manager-gated).
- `canAccessEmployee` in regularization listing — unchanged (listing scope is separate from approval scope).
- No database tables added or modified.
- No existing leave policy escalation paths (`pending_branch_head`, EL 3rd-occurrence) touched.

---

## Rollback

Delete `approvalEscalation.ts` and revert the three one-line changes in the approval gates. No data migration to reverse.
