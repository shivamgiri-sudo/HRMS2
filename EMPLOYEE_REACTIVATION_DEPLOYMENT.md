# Employee Reactivation Feature - Deployment Summary

**Status**: ✅ Code Deployed to GitHub  
**Commit**: `1cc7c931`  
**Date**: 2026-07-14  
**Migration Status**: ✅ Applied to Production DB (`mas_hrms`)

---

## Business Rules Implemented

### Reactivation Eligibility
- ✅ **≤ 30 days from exit date** - Maximum window for reactivation
- ✅ **> 30 days** - Blocked, requires fresh ATS onboarding with full documentation
- ✅ **Same placement only** - Must rejoin exact same branch, process, and cost centre
- ✅ **Same employee code** - Original employee_code becomes active again
- ✅ **Documents retained** - No re-upload required (uses existing documents)

### Approval Workflow
1. **HR initiates** reactivation request for inactive employee
2. **Branch Head reviews** - Approves or rejects with remarks
3. **HR finalizes** - Confirms reactivation (employee becomes Active) or rejects

---

## Technical Implementation

### Backend Routes (`/api/employees/reactivation/*`)

| Method | Endpoint | Role | Description |
|--------|----------|------|-------------|
| GET | `/reactivation/pending` | Branch Head, HR | Pending requests requiring action |
| GET | `/reactivation/all` | HR, Payroll Head | All requests with pagination |
| POST | `/reactivation/initiate` | HR, Admin | Create reactivation request |
| GET | `/reactivation/:id` | Authenticated | Single request details |
| POST | `/reactivation/:id/branch-action` | Branch Head, HR | Approve/reject (step 1) |
| POST | `/reactivation/:id/hr-action` | HR, Admin | Confirm reactivation (step 2) |

### Database Schema

**Tables Created** (Migration: `backend/sql/020_employee_reactivation.sql`):

```sql
employee_reactivation_requests
├── id (PK)
├── employee_id
├── old_employment_status (Inactive, Absconding, etc.)
├── proposed_joining_date
├── reinstatement_reason
├── gap_days (calculated from exit to proposed join)
├── same_cost_centre (always 1 for reactivation)
├── ff_already_paid (flag if F&F settlement completed)
├── status (pending → branch_head_approved → approved/rejected)
├── initiated_by, initiated_at
├── branch_head_actioned_by, branch_head_actioned_at, branch_head_remarks
├── hr_final_actioned_by, hr_final_actioned_at, hr_final_remarks
└── created_at, updated_at

employee_reactivation_audit
├── id (PK)
├── request_id (FK)
├── action (initiated, branch_approved, branch_rejected, hr_approved, hr_rejected)
├── actioned_by
├── remarks
├── metadata (JSON)
└── created_at
```

**Indexes**:
- `idx_employee` on `employee_id`
- `idx_status` on `status`
- `idx_pending_branch` on `(status, branch_head_actioned_at)`
- `idx_pending_hr` on `(status, hr_final_actioned_at)`

### Frontend UI

**Route**: `http://localhost:8083/employees/reactivation`

**Features**:
- Search inactive/absconding employees
- Initiate reactivation with 30-day validation
- Branch Head review queue with approve/reject
- HR final action queue
- Status badges: Pending Branch Head → Pending HR Final → Reactivated/Rejected
- Full approval timeline with actor names and timestamps
- Detail drawer showing complete request history

---

## Deployment Checklist

### ✅ Completed
- [x] Backend routes implemented and compiled
- [x] Database migration created (`020_employee_reactivation.sql`)
- [x] Migration applied to production DB
- [x] Frontend UI implemented (`NativeEmployeeReactivation.tsx`)
- [x] Code committed and pushed to GitHub (`1cc7c931`)
- [x] Route already mounted in `backend/src/app.ts` (line 300)
- [x] Page route already configured in `src/App.tsx`

### ⏳ Pending Production Deployment
- [ ] Backend restart required to load new routes
- [ ] Test with demo/staging accounts:
  - HR: `mock-token-hr` (initiate + final action)
  - Branch Head: `mock-token-branch-head` (branch approval)
- [ ] Verify inactive employee search
- [ ] Test 30-day validation (should block > 30 days)
- [ ] Test full approval flow
- [ ] Verify employee reactivation (status → Active, active_status → 1)

---

## Testing Scenarios

### Happy Path (Within 30 Days)
1. HR searches for inactive employee (exited ≤ 30 days ago)
2. HR initiates reactivation with reason
3. Branch Head approves with remarks
4. HR confirms reactivation
5. **Result**: Employee status = Active, same employee_code retained

### Validation: Beyond 30 Days
1. HR searches for employee (exited > 30 days ago)
2. HR initiates reactivation
3. **Result**: API returns error "Gap exceeds 30 days. Employee must complete fresh onboarding through ATS"

### Workflow State Transitions
- `pending` → Branch Head reviews
- `branch_head_approved` → HR final action
- `approved` → Employee reactivated
- `rejected` → Request closed (can be at Branch Head or HR level)

---

## Production Restart Commands

```bash
# On production server (mcnhrms.teammas.in)
pm2 restart mcn-hrms-backend

# Verify
curl -H "Authorization: Bearer <token>" \
  https://mcnhrms.teammas.in/api/employees/reactivation/pending
```

---

## Migration Verification

**Migration already applied** (2026-07-14 12:46:40):

```
[STEP 3] Verification
------------------------------------------------------------
  employee_reactivation_requests table exists: True
  employee_reactivation_audit table exists: True
```

---

## API Testing Examples

### 1. Get Pending Requests (HR)
```bash
curl -H "Authorization: Bearer mock-token-hr" \
  http://localhost:8083/api/employees/reactivation/pending
```

### 2. Initiate Reactivation
```bash
curl -X POST -H "Authorization: Bearer mock-token-hr" \
  -H "Content-Type: application/json" \
  -d '{
    "employee_id": "uuid-here",
    "proposed_joining_date": "2026-07-20",
    "reinstatement_reason": "Employee requested to rejoin. Performance was good during previous tenure."
  }' \
  http://localhost:8083/api/employees/reactivation/initiate
```

### 3. Branch Head Approval
```bash
curl -X POST -H "Authorization: Bearer mock-token-branch-head" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "approved",
    "remarks": "Approved. Team needs additional resources."
  }' \
  http://localhost:8083/api/employees/reactivation/{id}/branch-action
```

### 4. HR Final Confirmation (Reactivates Employee)
```bash
curl -X POST -H "Authorization: Bearer mock-token-hr" \
  -H "Content-Type: application/json" \
  -d '{
    "action": "confirmed",
    "remarks": "Reactivation confirmed. Payroll and access restored."
  }' \
  http://localhost:8083/api/employees/reactivation/{id}/hr-action
```

---

## Known Limitations

1. **No process-level allow/block flag** - All processes currently allow reactivation. Future: add `allow_rejoining` flag to `processes` or `cost_centres` table.

2. **Foreign keys removed** - Migration doesn't include FK constraints to `users`, `branches`, `cost_centres` tables (these may not exist in current schema). Data integrity relies on application logic.

3. **No notification triggers** - Future: send email/SMS notifications to employee, branch head, HR on status changes.

4. **No F&F reconciliation workflow** - If F&F already paid, system flags it but doesn't auto-trigger payroll head notification. Manual coordination required.

---

## Future Enhancements

- [ ] Process-level `allow_rejoining` configuration
- [ ] Notification triggers (email/SMS/in-app)
- [ ] Payroll head notification when F&F already paid
- [ ] Bulk reactivation for mass rehiring events
- [ ] Analytics dashboard: reactivation rate by branch/process
- [ ] Employee self-service: request reactivation (subject to approval)

---

## Support

**Production DB**: `122.184.128.90:3306/mas_hrms`  
**Backend**: Express + TypeScript  
**Frontend**: React 18 + TypeScript + Vite  

**Access Roles**:
- Super Admin, Admin, HR: Full access (initiate + approve)
- Branch Head: Review and approve step 1
- Payroll Head: View-only access to completed reactivations

---

**Migration File**: `backend/sql/020_employee_reactivation.sql`  
**Route File**: `backend/src/modules/employees/employee-reactivation.routes.ts`  
**UI File**: `src/pages/NativeEmployeeReactivation.tsx`  
**Commit**: `1cc7c931` on `main` branch
