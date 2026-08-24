# Task 2 Report — Backend Service

**Status:** DONE
**Commit:** f4e70b6e
**File:** `backend/src/modules/salary-dispute/salary-dispute.service.ts`

## TypeScript Check
```
cd backend && npx tsc --noEmit 2>&1 | grep "salary-dispute"
(no output — zero errors)
```

## Deviation from Plan
The plan assumed `inboxService.createItem(...)` with a flat object using snake_case keys (`user_id`, `type`, `entity_type`, etc.). The actual `work-inbox.service.ts` exports a standalone `createWorkItem(input: WorkItemInput)` function with camelCase fields (`itemType`, `assignedToUserId`, `entityType`, `entityId`, `moduleCode`). All notification calls were corrected to match. The `"normal"` priority for the manager view notification was changed to `"low"` since WorkItemInput only accepts `"low" | "medium" | "high" | "critical"`.

## listManagerTeam simplification
Used the simplified query from the task instructions (subquery on `user_roles.user_id = managerId`), not the complex double-subquery from the plan.

## Functions Delivered
- `raise()` — validates, inserts, notifies WFM/Payroll HR and manager
- `listMine()` — employee's own disputes
- `get()` — single dispute by id
- `wfmReview()` — Stage 1 approve/reject with differential
- `payrollHeadReview()` — Stage 2 approve/reject + triggers arrear
- `applyArrear()` — inserts ARREAR component into salary_prep_line_component, updates gross/net
- `listQueue()` — filtered by role (wfm vs payroll_head) and optional branchId
- `listManagerTeam()` — team disputes for a manager user
- `_notifyEmployee()` — internal helper for employee inbox notifications
