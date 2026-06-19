# Payroll Overtime Feature

**Version**: 1.0  
**Date**: 2026-06-16  
**Feature**: WFM-only overtime management for payroll

---

## Overview

The Overtime feature allows WFM (Workforce Management) team members to add overtime hours and amounts to employee payroll records. This feature is **branch-scoped**, meaning WFM team members can only update overtime for employees in their assigned branch.

---

## Key Features

### 1. Branch-Scoped Access Control
- **WFM Role Required**: Only users with `wfm` role can update overtime
- **Branch Assignment**: WFM users can only update overtime for employees in their assigned branch
- **Admin Override**: Admin users bypass branch restrictions and have full access

### 2. Overtime Fields
| Field | Type | Description | Constraints |
|-------|------|-------------|-------------|
| `overtime_hours` | DECIMAL(8,2) | Hours worked beyond regular schedule | 0-200 per month |
| `overtime_amount` | DECIMAL(10,2) | Payment for overtime (₹) | ≥ 0 |

### 3. Integration with Payroll
- Overtime amount is **added to gross salary**
- Overtime is **fully taxable** (included in TDS)
- PF/ESI calculations remain based on base salary components
- Shows as separate line in payslip PDF

---

## Database Schema

### Migration: `007_add_overtime_to_payroll.sql`

```sql
ALTER TABLE salary_prep_line
ADD COLUMN overtime_hours DECIMAL(8,2) DEFAULT 0 COMMENT 'Overtime hours worked (editable by WFM team only)',
ADD COLUMN overtime_amount DECIMAL(10,2) DEFAULT 0 COMMENT 'Overtime payment amount (editable by WFM team only)',
ADD INDEX idx_overtime (employee_id, overtime_hours);

UPDATE salary_prep_line SET overtime_hours = 0, overtime_amount = 0 WHERE overtime_hours IS NULL;
```

---

## API Endpoint

### Update Overtime
**Endpoint**: `PATCH /api/payroll/lines/:lineId/overtime`

**Authentication**: JWT required

**Authorization**: 
- User must have `wfm` role
- User must have branch assignment matching employee's branch
- OR user must have `admin` role

**Request Body**:
```json
{
  "overtimeHours": 15.5,
  "overtimeAmount": 3875
}
```

**Validation**:
```typescript
{
  overtimeHours: number (0-200),
  overtimeAmount: number (≥0)
}
```

**Response** (200 OK):
```json
{
  "success": true,
  "data": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "employee_id": "660e8400-e29b-41d4-a716-446655440001",
    "employee_code": "EMP001",
    "overtime_hours": 15.5,
    "overtime_amount": 3875,
    "gross_salary": 55875,
    "net_salary": 46985,
    "working_days": 30,
    "present_days": 30,
    "lwp_days": 0
  }
}
```

**Error Responses**:

| Status | Error | Description |
|--------|-------|-------------|
| 400 | `Cannot update overtime: run is locked` | Payroll run is locked or disbursed |
| 400 | Validation error | Invalid overtime hours (>200) or amount (<0) |
| 401 | `Authentication required` | Missing or invalid JWT token |
| 403 | `Access denied: Only WFM team members can update overtime for this branch` | User doesn't have WFM role for this branch |
| 404 | `Payroll line not found` | Invalid line ID |

---

## Access Control Logic

### Middleware: `requireWFMAccess`

**File**: `backend/src/middleware/requireWFMAccess.ts`

**Flow**:
```
1. Extract user ID from JWT
2. Get payroll line → employee → branch_id
3. Check if user has 'admin' role → Allow
4. Check if user has 'wfm' role for this branch_id → Allow
5. Otherwise → 403 Forbidden
```

**SQL Query**:
```sql
SELECT ur.role, sa.branch_id
FROM user_roles ur
LEFT JOIN scope_assignments sa ON ur.user_id = sa.user_id
WHERE ur.user_id = ?
  AND ur.role = 'wfm'
  AND (sa.branch_id = ? OR sa.branch_id IS NULL)
LIMIT 1
```

---

## Business Rules

### 1. Editability
- Overtime can only be updated when run status is **`draft`**
- Cannot update when run is `locked` or `disbursed`

### 2. Calculation Impact
```typescript
// When overtime is updated:
new_gross_salary = base_gross_salary + overtime_amount
new_net_salary = new_gross_salary - total_deductions

// Example:
Base Gross: ₹52,000
Overtime: ₹3,875 (15.5 hours × ₹250/hour)
New Gross: ₹55,875
Deductions: ₹8,890 (PF + ESI + PT + TDS)
New Net: ₹46,985
```

### 3. Statutory Impact
| Component | Impact |
|-----------|--------|
| **PF (Employee)** | Calculated on Basic only (no change) |
| **PF (Employer)** | Calculated on Basic only (no change) |
| **ESI** | If gross ≤ ₹21k, includes overtime |
| **Professional Tax** | No change (state-fixed) |
| **TDS** | Includes overtime (fully taxable) |

### 4. Audit Trail
Every overtime update creates:

**Sensitive Action Log**:
```json
{
  "userId": "wfm-user-uuid",
  "action": "payroll.overtime.update",
  "resourceType": "salary_prep_line",
  "resourceId": "line-uuid",
  "metadata": {
    "employeeCode": "EMP001",
    "branchId": "branch-uuid",
    "overtimeHours": 15.5,
    "overtimeAmount": 3875
  },
  "timestamp": "2026-06-16T10:30:00Z"
}
```

**Journey Log Event**:
```json
{
  "employeeId": "emp-uuid",
  "eventType": "overtime_updated",
  "eventCategory": "payroll",
  "description": "Overtime updated: 15.5h = ₹3875",
  "metadata": {
    "lineId": "line-uuid",
    "overtimeHours": 15.5,
    "overtimeAmount": 3875,
    "updatedBy": "wfm-user-uuid"
  },
  "createdAt": "2026-06-16T10:30:00Z"
}
```

---

## Frontend Integration

### 1. UI Location
**Path**: `/payroll/runs/:runId` → Prep Lines Table

**Table Columns**:
```
| Employee | Base Gross | Overtime Hrs | Overtime Amt | Total Gross | Net Salary | Actions |
|----------|------------|--------------|--------------|-------------|------------|---------|
| EMP001   | ₹52,000   | 15.5         | ₹3,875      | ₹55,875    | ₹46,985   | [Edit OT] |
```

### 2. Edit Overtime Modal
**Component**: `EditOvertimeModal.tsx`

**Fields**:
- **Overtime Hours** (number input, 0-200)
- **Overtime Amount** (number input, ₹)
- **Preview**: Show old vs new gross/net salary

**API Call**:
```typescript
const updateOvertime = async (lineId: string, data: { overtimeHours: number; overtimeAmount: number }) => {
  const response = await fetch(`/api/payroll/lines/${lineId}/overtime`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });

  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.message);
  }

  return response.json();
};
```

### 3. Permissions Check
```typescript
// Show "Edit Overtime" button only if:
// 1. User has 'wfm' role for this branch
// 2. OR user is admin
// 3. AND run status is 'draft'

const canEditOvertime = (user: User, employee: Employee, runStatus: string) => {
  if (runStatus !== 'draft') return false;
  if (user.roles.includes('admin')) return true;
  
  const hasWFMRole = user.roles.includes('wfm');
  const hasBranchAccess = user.scopeAssignments?.some(
    scope => scope.branchId === employee.branchId
  );
  
  return hasWFMRole && hasBranchAccess;
};
```

---

## Testing

### 1. Unit Tests
**File**: `backend/src/modules/payroll/__tests__/overtime.test.ts`

```typescript
describe('Overtime Update', () => {
  test('WFM user can update overtime for own branch', async () => {
    const response = await request(app)
      .patch(`/api/payroll/lines/${lineId}/overtime`)
      .set('Authorization', `Bearer ${wfmToken}`)
      .send({ overtimeHours: 10, overtimeAmount: 2500 });

    expect(response.status).toBe(200);
    expect(response.body.data.overtime_hours).toBe(10);
    expect(response.body.data.overtime_amount).toBe(2500);
  });

  test('WFM user cannot update overtime for different branch', async () => {
    const response = await request(app)
      .patch(`/api/payroll/lines/${otherBranchLineId}/overtime`)
      .set('Authorization', `Bearer ${wfmToken}`)
      .send({ overtimeHours: 10, overtimeAmount: 2500 });

    expect(response.status).toBe(403);
    expect(response.body.message).toContain('Only WFM team members');
  });

  test('Cannot update overtime when run is locked', async () => {
    await lockRun(runId);

    const response = await request(app)
      .patch(`/api/payroll/lines/${lineId}/overtime`)
      .set('Authorization', `Bearer ${wfmToken}`)
      .send({ overtimeHours: 10, overtimeAmount: 2500 });

    expect(response.status).toBe(400);
    expect(response.body.message).toContain('run is locked');
  });

  test('Admin can update overtime for any branch', async () => {
    const response = await request(app)
      .patch(`/api/payroll/lines/${lineId}/overtime`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ overtimeHours: 10, overtimeAmount: 2500 });

    expect(response.status).toBe(200);
  });
});
```

### 2. Integration Tests
```typescript
describe('Overtime Calculation Integration', () => {
  test('Overtime adds to gross and net salary', async () => {
    const beforeLine = await getPayrollLine(lineId);
    const baseGross = beforeLine.gross_salary;
    const baseNet = beforeLine.net_salary;

    await request(app)
      .patch(`/api/payroll/lines/${lineId}/overtime`)
      .set('Authorization', `Bearer ${wfmToken}`)
      .send({ overtimeHours: 15.5, overtimeAmount: 3875 });

    const afterLine = await getPayrollLine(lineId);

    expect(afterLine.gross_salary).toBe(baseGross + 3875);
    expect(afterLine.net_salary).toBe(baseNet + 3875); // Assuming no additional deductions
  });

  test('Overtime appears in payslip PDF', async () => {
    await request(app)
      .patch(`/api/payroll/lines/${lineId}/overtime`)
      .set('Authorization', `Bearer ${wfmToken}`)
      .send({ overtimeHours: 10, overtimeAmount: 2500 });

    const pdfResponse = await request(app)
      .get(`/api/payroll/payslip/${lineId}`)
      .set('Authorization', `Bearer ${employeeToken}`);

    const pdfText = await extractTextFromPDF(pdfResponse.body);
    expect(pdfText).toContain('Overtime');
    expect(pdfText).toContain('10.0');
    expect(pdfText).toContain('₹2,500');
  });
});
```

### 3. Access Control Tests
```typescript
describe('WFM Access Control', () => {
  test('requireWFMAccess middleware validates branch', async () => {
    const req = mockRequest({
      authUser: { id: wfmUserId },
      params: { lineId: lineId },
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireWFMAccess(req, res, next);

    expect(next).toHaveBeenCalled();
  });

  test('requireWFMAccess rejects non-WFM user', async () => {
    const req = mockRequest({
      authUser: { id: employeeUserId },
      params: { lineId: lineId },
    });
    const res = mockResponse();
    const next = jest.fn();

    await requireWFMAccess(req, res, next);

    expect(res.status).toHaveBeenCalledWith(403);
    expect(next).not.toHaveBeenCalled();
  });
});
```

---

## Deployment Checklist

### 1. Database Migration
```bash
# Run migration to add overtime columns
mysql -h 122.184.128.90 -u shuvam -p'Shuvam1234@' mas_hrms < backend/db-migrations/007_add_overtime_to_payroll.sql
```

### 2. Backend Deployment
- ✅ Deploy updated `payroll.service.ts`
- ✅ Deploy updated `payroll.controller.ts`
- ✅ Deploy updated `payroll.routes.ts`
- ✅ Deploy new `requireWFMAccess.ts` middleware
- ✅ Update `payroll.types.ts` and `payroll.validation.ts`

### 3. Frontend Deployment
- [ ] Add "Edit Overtime" button in prep lines table
- [ ] Create `EditOvertimeModal` component
- [ ] Update payslip PDF template to show overtime
- [ ] Add overtime columns to payroll reports

### 4. User Access Setup
```sql
-- Assign WFM role to users
INSERT INTO user_roles (user_id, role) VALUES
('user-uuid-1', 'wfm'),
('user-uuid-2', 'wfm');

-- Assign branch scope to WFM users
INSERT INTO scope_assignments (user_id, branch_id) VALUES
('user-uuid-1', 'bangalore-branch-uuid'),
('user-uuid-2', 'mumbai-branch-uuid');
```

### 5. Testing
- [ ] Test WFM user can update overtime for own branch
- [ ] Test WFM user cannot update overtime for other branch
- [ ] Test overtime appears in payslip PDF
- [ ] Test overtime calculation impact on gross/net
- [ ] Test audit logs are created
- [ ] Test cannot update when run is locked

---

## Support & Troubleshooting

### Common Issues

**Issue**: WFM user gets 403 error
**Solution**: 
1. Verify user has `wfm` role: `SELECT * FROM user_roles WHERE user_id = ?`
2. Verify branch assignment: `SELECT * FROM scope_assignments WHERE user_id = ?`
3. Verify employee's branch matches: `SELECT branch_id FROM employees WHERE id = ?`

**Issue**: Overtime not showing in payslip
**Solution**: 
1. Check `salary_prep_line` has overtime fields populated
2. Verify payslip PDF template includes overtime section
3. Re-generate payslip after updating overtime

**Issue**: Cannot update overtime (run locked)
**Solution**: 
1. Check run status: `SELECT status FROM salary_prep_run WHERE id = ?`
2. If locked, unlock first: `POST /api/payroll/runs/:runId/unlock`
3. Update overtime
4. Re-lock run

---

## Future Enhancements

### 1. Overtime Rate Calculator
Auto-calculate overtime amount based on hourly rate:
```typescript
overtimeAmount = overtimeHours × hourlyRate × overtimeMultiplier
// where overtimeMultiplier = 1.5 (time-and-a-half) or 2.0 (double-time)
```

### 2. Overtime Approval Workflow
- WFM submits overtime → Pending approval
- Manager approves/rejects → Auto-updates payroll line

### 3. Overtime Reports
- Branch-wise overtime summary
- Employee overtime history
- Overtime vs regular hours comparison

### 4. Overtime Limits
- Weekly overtime cap (e.g., max 20 hours/week)
- Monthly overtime budget per branch
- Alerts when overtime exceeds threshold

---

## Document Control

**Prepared By**: Shuvam Giri  
**Date**: 2026-06-16  
**Version**: 1.0

**Change Log**:
| Version | Date | Changes |
|---------|------|---------|
| 1.0 | 2026-06-16 | Initial overtime feature documentation |

---

**End of Document**
