# Admin Role E2E Security Audit Specification

## Document Information
- **Version**: 1.0.0
- **Date**: June 10, 2026
- **Status**: Draft - Ready for Audit
- **Owner**: Security & QA Team

---

## 1. Executive Summary

### Audit Scope
This document defines the comprehensive End-to-End (E2E) security audit for Admin-role access control in the HRMS system. The audit focuses on validating proper branch-scoped data access enforcement for different admin privilege levels.

### Admin Types Under Audit
| Admin Type | Description | Risk Level |
|------------|-------------|------------|
| Global Admin | Full system access across all branches | Medium |
| Branch Admin | Access limited to assigned branch(es) | **Critical** |
| Multi-Branch Admin | Access to multiple but not all branches | **Critical** |
| No-Scope Admin | Admin role without scope assignment | **Critical** |

### Key Finding
The current implementation contains a **Critical Security Vulnerability**: `allowAdminBypass: true` default in `scopeAccess.ts` allows ANY user with `admin` role to bypass ALL scope checks, enabling Branch Admins to access records across all branches.

---

## 2. Access Model Architecture

### 2.1 Database Schema

#### Core Tables
```
auth_user
├── id (PK)
├── email
├── password_hash
├── is_active
└── created_at

user_roles
├── id (PK)
├── user_id (FK → auth_user)
├── role_id (FK → workforce_role_catalog)
└── assigned_at

user_assignment_scope
├── id (PK)
├── user_id (FK → auth_user)
├── role_id (FK → workforce_role_catalog)
├── scope_type (enum: all, branch, process, branch_process, lob, department, team, self)
├── branch_id (FK → branch_master, nullable)
├── process_id (FK → process_master, nullable)
├── lob_id (FK → lob_master, nullable)
├── department_id (FK → department_master, nullable)
├── team_id (FK → team_master, nullable)
├── is_active
└── created_at

workforce_role_catalog
├── id (PK)
├── role_name (e.g., 'admin', 'hr', 'manager', 'employee')
├── role_code
├── role_level
└── is_system_role

role_page_access
├── id (PK)
├── role_id (FK → workforce_role_catalog)
├── page_code (e.g., 'EMPLOYEE_MASTER', 'PAYROLL_VIEW')
├── access_level (enum: view, create, edit, delete, full)
└── is_active

user_page_access
├── id (PK)
├── user_id (FK → auth_user)
├── page_code
├── access_level
└── granted_by_role_id

employees
├── id (PK)
├── employee_code
├── user_id (FK → auth_user)
├── branch_id (FK → branch_master)
├── department_id
├── process_id
└── status

branch_master
├── id (PK)
├── branch_code
├── branch_name
├── location
├── is_active
└── company_id
```

### 2.2 Scope Types Definition

| Scope Type | Description | Use Case |
|------------|-------------|----------|
| `all` | Access to all records across all branches | Global Admin |
| `branch` | Access limited to specific branch(es) | Branch Admin |
| `process` | Access limited to specific process(es) | Process Owner |
| `branch_process` | Access limited to branch + process combination | Branch Process Lead |
| `lob` | Access limited to Line of Business | LOB Head |
| `department` | Access limited to department | Department Head |
| `team` | Access limited to team | Team Lead |
| `self` | Access limited to own records only | Individual Contributor |

### 2.3 Admin Type Determination

```typescript
// Global Admin
const isGlobalAdmin = (
  user.roles.includes('admin') && 
  user.scopes.some(s => s.scope_type === 'all' && s.is_active)
);

// Branch Admin
const isBranchAdmin = (
  user.roles.includes('admin') && 
  user.scopes.some(s => s.scope_type === 'branch' && s.is_active)
);

// Multi-Branch Admin
const isMultiBranchAdmin = (
  user.roles.includes('admin') && 
  user.scopes.filter(s => s.scope_type === 'branch' && s.is_active).length > 1
);

// No-Scope Admin (Critical: Should default deny)
const isNoScopeAdmin = (
  user.roles.includes('admin') && 
  !user.scopes.some(s => s.is_active)
);
```

---

## 3. Critical Security Findings

### 3.1 Finding #1: Admin Bypass Vulnerability

**Severity**: CRITICAL  
**Status**: UNRESOLVED  
**Location**: `backend/src/utils/scopeAccess.ts`

#### Current Code (Vulnerable)
```typescript
export async function hasScopedAccess(
  userId: string,
  resourceType: string,
  resourceId: string,
  options: ScopeAccessOptions = {}
): Promise<boolean> {
  const { 
    allowAdminBypass = true,  // ← CRITICAL: Defaults to true
    requireAllScopes = false 
  } = options;

  // Check if user has admin role
  const userRoles = await getUserRoles(userId);
  const isAdmin = userRoles.some(r => r.role_name === 'admin');

  if (isAdmin && allowAdminBypass) {
    return true;  // ← CRITICAL: Bypasses all scope checks
  }

  // ... rest of scope checking logic
}
```

#### Issue Description
The `allowAdminBypass: true` default means ANY user with the `admin` role bypasses ALL scope validation, regardless of their actual `scope_type` assignment. This allows:

1. A Branch Admin (scope_type="branch") to access records from ALL branches
2. A No-Scope Admin to access all records
3. No distinction between Global Admin and Branch Admin

#### Impact
- **Data Breach Risk**: Branch Admins can view/edit employee data from other branches
- **Compliance Violation**: Violates data isolation requirements
- **Privilege Escalation**: Lower-privilege admins gain unauthorized access

---

## 4. Required Security Model

### 4.1 Correct Admin Access Logic

```typescript
export async function hasScopedAccess(
  userId: string,
  resourceType: string,
  resourceId: string,
  options: ScopeAccessOptions = {}
): Promise<boolean> {
  const { 
    requireAllScopes = false 
  } = options;

  // Get user roles and scopes
  const userRoles = await getUserRoles(userId);
  const userScopes = await getUserScopes(userId);
  
  const isAdmin = userRoles.some(r => r.role_name === 'admin');
  
  if (isAdmin) {
    // Check if admin has global scope (scope_type = "all")
    const hasGlobalScope = userScopes.some(
      s => s.scope_type === 'all' && s.is_active
    );
    
    if (hasGlobalScope) {
      return true; // Global Admin: bypass scope checks
    }
    
    // Admin without global scope must go through scope validation
    // Branch Admin, Multi-Branch Admin, etc.
    return validateScopedAccess(userId, resourceType, resourceId, userScopes);
  }
  
  // Non-admin users: always validate scope
  return validateScopedAccess(userId, resourceType, resourceId, userScopes);
}
```

### 4.2 Access Decision Matrix

| User Type | scope_type | Global Access? | Branch-Scoped? | Default Deny? |
|-----------|------------|----------------|----------------|---------------|
| Global Admin | `all` | ✅ Yes | N/A | No |
| Branch Admin | `branch` | ❌ No | ✅ Yes | If no branch match |
| Multi-Branch Admin | Multiple `branch` | ❌ No | ✅ Yes (union) | If no branch match |
| No-Scope Admin | None | ❌ No | N/A | ✅ Yes - Default deny |
| HR Role | Various | ❌ No | ✅ Yes | If no scope match |

---

## 5. Admin Journeys to Audit

### 5.1 Authentication & Context

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Login → JWT | Auth | `/login` | `POST /api/auth/login` | - |
| Access Context Load | Auth | All | `GET /api/auth/me` | user_assignment_scope |
| Token Refresh | Auth | All | `POST /api/auth/refresh` | - |

### 5.2 Dashboard

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| View KPI Cards | Dashboard | `/dashboard` | `GET /api/dashboard/kpis` | employees (count) |
| KPI Drilldown | Dashboard | `/dashboard/:kpi` | `GET /api/dashboard/kpi/:id/details` | employees |
| Branch Filter | Dashboard | `/dashboard` | `GET /api/branches/list` | branch_master |

### 5.3 Employee Master

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| List Employees | Employee | `/employees` | `GET /api/employees` | employees |
| Search Employees | Employee | `/employees` | `GET /api/employees/search` | employees |
| Employee Detail | Employee | `/employees/:id` | `GET /api/employees/:id` | employees |
| Create Employee | Employee | `/employees/new` | `POST /api/employees` | employees |
| Update Employee | Employee | `/employees/:id/edit` | `PUT /api/employees/:id` | employees |
| Export Employees | Employee | `/employees/export` | `POST /api/employees/export` | employees |
| Bulk Operations | Employee | `/employees/bulk` | `POST /api/employees/bulk` | employees |

### 5.4 Onboarding & Provisioning

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Onboarding List | Onboarding | `/onboarding` | `GET /api/onboarding` | onboarding_requests |
| Onboarding Detail | Onboarding | `/onboarding/:id` | `GET /api/onboarding/:id` | onboarding_requests |
| Create Onboarding | Onboarding | `/onboarding/new` | `POST /api/onboarding` | onboarding_requests |
| Provisioning Tasks | Onboarding | `/onboarding/:id/tasks` | `GET /api/onboarding/:id/tasks` | onboarding_tasks |

### 5.5 Movement / Cost Centre

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Movement List | Movement | `/movements` | `GET /api/movements` | employee_movements |
| Initiate Transfer | Movement | `/movements/new` | `POST /api/movements` | employee_movements |
| Approve Movement | Movement | `/movements/:id/approve` | `PUT /api/movements/:id` | employee_movements |
| Cost Centre Change | Movement | `/cost-centre/change` | `POST /api/cost-centre/change` | cost_centre_history |

### 5.6 Attendance & Regularization

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Attendance List | Attendance | `/attendance` | `GET /api/attendance` | attendance_records |
| Attendance Detail | Attendance | `/attendance/:id` | `GET /api/attendance/:id` | attendance_records |
| Regularization List | Attendance | `/regularization` | `GET /api/regularization` | regularization_requests |
| Approve Regularization | Attendance | `/regularization/:id` | `PUT /api/regularization/:id` | regularization_requests |

### 5.7 Leave Management

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Leave Requests | Leave | `/leave/requests` | `GET /api/leave/requests` | leave_requests |
| Leave Calendar | Leave | `/leave/calendar` | `GET /api/leave/calendar` | leave_requests |
| Approve Leave | Leave | `/leave/requests/:id` | `PUT /api/leave/requests/:id` | leave_requests |
| Leave Balance | Leave | `/leave/balance` | `GET /api/leave/balance` | leave_balance |

### 5.8 WFM & Roster

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Roster Plan List | WFM | `/wfm/roster` | `GET /api/wfm/roster-plans` | wfm_roster_plan |
| Roster Assignment | WFM | `/wfm/roster/:id` | `GET /api/wfm/roster-assignments` | wfm_roster_assignment |
| Create Roster | WFM | `/wfm/roster/new` | `POST /api/wfm/roster-plans` | wfm_roster_plan |
| Shift Swap | WFM | `/wfm/shift-swaps` | `GET /api/wfm/shift-swaps` | shift_swap_requests |

### 5.9 ATS & Recruitment

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Job Openings | ATS | `/ats/jobs` | `GET /api/ats/job-openings` | job_openings |
| Candidates | ATS | `/ats/candidates` | `GET /api/ats/candidates` | candidates |
| Candidate Detail | ATS | `/ats/candidates/:id` | `GET /api/ats/candidates/:id` | candidates |
| Interview Schedule | ATS | `/ats/interviews` | `GET /api/ats/interviews` | interview_schedule |

### 5.10 Payroll (if permitted)

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Payroll Runs | Payroll | `/payroll/runs` | `GET /api/payroll/runs` | salary_prep_run |
| Payroll Detail | Payroll | `/payroll/runs/:id` | `GET /api/payroll/runs/:id` | salary_prep_run |
| Payslips | Payroll | `/payroll/payslips` | `GET /api/payroll/payslips` | payslip_records |
| Salary Register | Payroll | `/payroll/register` | `GET /api/payroll/register` | salary_register |

### 5.11 Exit Management

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Exit Requests | Exit | `/exit/requests` | `GET /api/exit/requests` | exit_requests |
| Exit Process | Exit | `/exit/process/:id` | `GET /api/exit/process/:id` | exit_process |
| Clearance | Exit | `/exit/clearance/:id` | `GET /api/exit/clearance/:id` | exit_clearance |
| F&F Settlement | Exit | `/exit/fnf/:id` | `GET /api/exit/fnf/:id` | fnf_settlement |

### 5.12 Assets & Helpdesk

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Asset List | Assets | `/assets` | `GET /api/assets` | assets |
| Asset Allocation | Assets | `/assets/allocation` | `GET /api/assets/allocations` | asset_allocations |
| Helpdesk Tickets | Helpdesk | `/helpdesk/tickets` | `GET /api/helpdesk/tickets` | helpdesk_tickets |
| Ticket Detail | Helpdesk | `/helpdesk/tickets/:id` | `GET /api/helpdesk/tickets/:id` | helpdesk_tickets |

### 5.13 Performance / KPI / Reports

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Performance Reviews | Performance | `/performance/reviews` | `GET /api/performance/reviews` | performance_reviews |
| KPI Dashboard | Performance | `/performance/kpi` | `GET /api/performance/kpi` | kpi_records |
| Reports List | Reports | `/reports` | `GET /api/reports` | report_definitions |
| Generate Report | Reports | `/reports/:id/run` | `POST /api/reports/:id/run` | report_results |

### 5.14 Work Inbox

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Pending Approvals | Work Inbox | `/inbox/pending` | `GET /api/inbox/pending` | approval_requests |
| Notifications | Work Inbox | `/inbox/notifications` | `GET /api/inbox/notifications` | notifications |
| Delegations | Work Inbox | `/inbox/delegations` | `GET /api/inbox/delegations` | delegations |

### 5.15 Admin Settings

| Journey | Module | Route | API Endpoint | Branch-Owned Table |
|---------|--------|-------|--------------|-------------------|
| Access Control | Admin | `/admin/access-control` | `GET /api/admin/access-control` | role_page_access |
| User Management | Admin | `/admin/users` | `GET /api/admin/users` | auth_user |
| Role Management | Admin | `/admin/roles` | `GET /api/admin/roles` | workforce_role_catalog |
| Org Masters | Admin | `/admin/org-masters` | `GET /api/admin/org-masters` | branch_master, dept_master |
| Process Config | Admin | `/admin/process-config` | `GET /api/admin/process-config` | process_master |
| Email Templates | Admin | `/admin/email-templates` | `GET /api/admin/email-templates` | email_templates |
| Audit Logs | Admin | `/admin/audit-logs` | `GET /api/admin/audit-logs` | audit_logs |

---

## 6. Frontend Route Security Requirements

### 6.1 Route Protection Matrix

| Route | Page Access Code | Required Role | Scope Check |
|-------|-----------------|---------------|-------------|
| `/dashboard` | DASHBOARD_VIEW | Any | Yes |
| `/employees` | EMPLOYEE_MASTER_VIEW | admin, hr | Yes |
| `/employees/new` | EMPLOYEE_MASTER_CREATE | admin, hr | Yes |
| `/employees/:id/edit` | EMPLOYEE_MASTER_EDIT | admin, hr | Yes |
| `/onboarding` | ONBOARDING_VIEW | admin, hr | Yes |
| `/movements` | MOVEMENT_VIEW | admin, hr | Yes |
| `/attendance` | ATTENDANCE_VIEW | admin, hr, manager | Yes |
| `/leave` | LEAVE_VIEW | admin, hr, manager | Yes |
| `/wfm/*` | WFM_VIEW | admin, wfm_manager | Yes |
| `/ats/*` | ATS_VIEW | admin, recruiter | Yes |
| `/payroll/*` | PAYROLL_VIEW | admin, payroll | Yes |
| `/exit/*` | EXIT_VIEW | admin, hr | Yes |
| `/assets` | ASSET_VIEW | admin, hr, asset_manager | Yes |
| `/helpdesk` | HELPDESK_VIEW | admin, helpdesk | Yes |
| `/reports` | REPORTS_VIEW | admin, hr | Yes |
| `/inbox` | INBOX_VIEW | Any | Yes |
| `/admin/*` | ADMIN_SETTINGS | admin | Yes |

### 6.2 Direct URL Navigation Tests

| Test Scenario | Expected Behavior |
|---------------|-------------------|
| Branch Admin accesses `/employees` | Shows only branch employees |
| Branch Admin accesses `/employees?branch_id=OTHER` | Redirects to 403 or ignores param |
| No-Scope Admin accesses `/employees` | Shows empty list or 403 page |
| Branch Admin accesses `/admin/access-control` | 403 - Insufficient privileges |
| Global Admin accesses any route | Full access granted |

### 6.3 Unauthorized Access Page

```typescript
// Requirements for 403/Unauthorized Page
interface UnauthorizedPageProps {
  attemptedRoute: string;
  requiredRole?: string;
  requiredScope?: string;
  userCurrentRoles: string[];
  userCurrentScopes: Scope[];
  contactAdminAction: () => void;
  goBackAction: () => void;
  goToDashboardAction: () => void;
}

// Page must display:
// - Clear 403 status indication
// - Explanation of missing access
// - Current user permissions
// - Contact admin option
// - Navigation alternatives
```

---

## 7. Backend Authorization Requirements

### 7.1 Scope Enforcement Checklist

#### List Queries
```typescript
// REQUIRED: Every list query must use buildScopeWhereClause
async function listEmployees(req: Request, res: Response) {
  const userId = req.user.id;
  
  // Get user's scope clause
  const scopeWhereClause = await buildScopeWhereClause(userId, 'employees');
  
  const employees = await db.query(
    `SELECT * FROM employees 
     WHERE ${scopeWhereClause}
     AND status = 'active'
     ORDER BY created_at DESC`,
    [userId]
  );
  
  res.json(employees);
}
```

#### Detail Queries
```typescript
// REQUIRED: Every detail query must verify record ownership
async function getEmployeeDetail(req: Request, res: Response) {
  const userId = req.user.id;
  const employeeId = req.params.id;
  
  // First verify access
  const hasAccess = await hasScopedAccess(userId, 'employees', employeeId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this record' });
  }
  
  const employee = await db.query(
    'SELECT * FROM employees WHERE id = $1',
    [employeeId]
  );
  
  res.json(employee);
}
```

#### Create Operations
```typescript
// REQUIRED: Create must validate target branch scope
async function createEmployee(req: Request, res: Response) {
  const userId = req.user.id;
  const { branch_id, ...employeeData } = req.body;
  
  // Validate user can create in this branch
  const canCreateInBranch = await validateBranchScope(userId, branch_id);
  if (!canCreateInBranch) {
    return res.status(403).json({ 
      error: 'Cannot create employee in this branch' 
    });
  }
  
  const newEmployee = await db.query(
    'INSERT INTO employees (branch_id, ...) VALUES ($1, ...) RETURNING *',
    [branch_id, ...employeeData]
  );
  
  res.json(newEmployee);
}
```

#### Update Operations
```typescript
// REQUIRED: Update must validate both source and target branch scope
async function updateEmployee(req: Request, res: Response) {
  const userId = req.user.id;
  const employeeId = req.params.id;
  const { branch_id: newBranchId, ...updates } = req.body;
  
  // Verify access to existing record
  const hasAccess = await hasScopedAccess(userId, 'employees', employeeId);
  if (!hasAccess) {
    return res.status(403).json({ error: 'Access denied to this record' });
  }
  
  // If changing branch, verify access to new branch
  if (newBranchId) {
    const canAccessNewBranch = await validateBranchScope(userId, newBranchId);
    if (!canAccessNewBranch) {
      return res.status(403).json({ 
        error: 'Cannot transfer employee to this branch' 
      });
    }
  }
  
  const updated = await db.query(
    'UPDATE employees SET ... WHERE id = $1 RETURNING *',
    [employeeId]
  );
  
  res.json(updated);
}
```

#### Export Operations
```typescript
// REQUIRED: Export must use same scoped query as UI
async function exportEmployees(req: Request, res: Response) {
  const userId = req.user.id;
  
  // Same scope clause as list API
  const scopeWhereClause = await buildScopeWhereClause(userId, 'employees');
  
  const employees = await db.query(
    `SELECT * FROM employees 
     WHERE ${scopeWhereClause}`,
    [userId]
  );
  
  // Generate export file
  const csv = generateCSV(employees);
  res.attachment('employees.csv').send(csv);
}
```

#### KPI/Dashboard Queries
```typescript
// REQUIRED: KPI must use same branch filter as drilldown
async function getDashboardKPIs(req: Request, res: Response) {
  const userId = req.user.id;
  
  // Get user's accessible branches
  const branchFilter = await buildBranchFilter(userId);
  
  const kpis = await db.query(
    `SELECT 
       COUNT(*) FILTER (WHERE status = 'active') as active_count,
       COUNT(*) FILTER (WHERE status = 'onboarding') as onboarding_count
     FROM employees 
     WHERE ${branchFilter}`,
    [userId]
  );
  
  res.json(kpis);
}
```

---

## 8. Security Tampering Tests

### 8.1 Query Parameter Manipulation

| Test ID | Attack Vector | Expected Defense | Pass Criteria |
|---------|---------------|------------------|---------------|
| TAMPER-001 | `GET /employees?branch_id=OTHER_BRANCH` | Scope clause overrides param | Returns only authorized branch data |
| TAMPER-002 | `GET /employees?branch_id=*` | Rejected as invalid | 400 Bad Request |
| TAMPER-003 | `GET /employees?branch_id=1 OR 1=1` | SQL injection prevention | 400 Bad Request |
| TAMPER-004 | `GET /employees?limit=1000000` | Rate limiting applied | Respects max limit |

### 8.2 Request Body Manipulation

| Test ID | Attack Vector | Expected Defense | Pass Criteria |
|---------|---------------|------------------|---------------|
| TAMPER-005 | `POST /employees { branch_id: OTHER }` | Branch scope validation | 403 - Cannot create in this branch |
| TAMPER-006 | `PUT /employees/1 { branch_id: OTHER }` | Source + target validation | 403 - Cannot transfer to this branch |
| TAMPER-007 | `POST /api/movements { to_branch_id: ALL }` | Scope validation | 403 - Invalid target branch |
| TAMPER-008 | `POST /api/bulk { branch_scope: 'all' }` | Reject unauthorized scope | 403 - Insufficient scope |

### 8.3 Direct ID Access

| Test ID | Attack Vector | Expected Defense | Pass Criteria |
|---------|---------------|------------------|---------------|
| TAMPER-009 | `GET /employees/CROSS_BRANCH_ID` | hasScopedAccess check | 403 - Access denied |
| TAMPER-010 | `GET /employees/1?bypass=true` | Ignore unknown params | Normal scope enforcement |
| TAMPER-011 | `GET /api/employees?ids[]=1&ids[]=2&ids[]=CROSS` | Filter unauthorized IDs | Returns only accessible records |
| TAMPER-012 | `GET /employees/export?id=CROSS_BRANCH` | Export scope enforcement | 403 or filtered export |

### 8.4 Export with Cross-Branch Scope

| Test ID | Attack Vector | Expected Defense | Pass Criteria |
|---------|---------------|------------------|---------------|
| TAMPER-013 | `POST /employees/export { format: 'csv', scope: 'all' }` | Reject unauthorized scope | 403 - Cannot export all branches |
| TAMPER-014 | Export with modified query params | Scope enforced server-side | Export contains only authorized data |
| TAMPER-015 | Export via direct API call | JWT + scope validation | Same restrictions as UI |

---

## 9. Test Environment Requirements

### 9.1 Test Identities

| Identity | Role | Scope Type | Branch(es) | Expected Access |
|----------|------|------------|------------|-----------------|
| admin.global@hrms.com | admin | all | All | Full system access |
| admin.branch1@hrms.com | admin | branch | Branch A | Branch A only |
| admin.multi@hrms.com | admin | branch | Branch A, B | Branches A & B only |
| admin.noscope@hrms.com | admin | - | - | Default deny |
| hr.branch1@hrms.com | hr | branch | Branch A | Branch A only |
| manager.a@hrms.com | manager | department | Dept X in Branch A | Dept X only |
| employee.a@hrms.com | employee | self | Branch A | Own records only |

### 9.2 Test Data Setup

```sql
-- Test Branches
INSERT INTO branch_master (id, branch_code, branch_name) VALUES
('branch-a-uuid', 'BR001', 'Branch A - Mumbai'),
('branch-b-uuid', 'BR002', 'Branch B - Delhi'),
('branch-c-uuid', 'BR003', 'Branch C - Bangalore');

-- Test Employees per Branch
INSERT INTO employees (id, employee_code, branch_id, status) VALUES
('emp-a1', 'EMP001', 'branch-a-uuid', 'active'),
('emp-a2', 'EMP002', 'branch-a-uuid', 'active'),
('emp-b1', 'EMP003', 'branch-b-uuid', 'active'),
('emp-c1', 'EMP004', 'branch-c-uuid', 'active');
```

---

## 10. Success Criteria

### 10.1 Security Requirements
- [ ] Branch Admin cannot access cross-branch records
- [ ] No-Scope Admin defaults to deny for all branch-owned data
- [ ] Global Admin has full access
- [ ] All APIs enforce scope checks
- [ ] Frontend routes protect against direct URL access
- [ ] Export operations respect scope

### 10.2 Functional Requirements
- [ ] Dashboard KPIs match drilldown counts
- [ ] Employee list respects branch filter
- [ ] Create operations validate target branch
- [ ] Update operations validate source and target
- [ ] All 22 admin journeys complete successfully

### 10.3 Performance Requirements
- [ ] Scope query overhead < 10ms per request
- [ ] List queries with scope < 200ms for 10k records
- [ ] Detail queries with scope check < 50ms

---

## 11. Audit Timeline

| Phase | Duration | Activities |
|-------|----------|------------|
| Phase 1 | Week 1 | Fix critical admin bypass vulnerability |
| Phase 2 | Week 1-2 | Implement missing scope checks |
| Phase 3 | Week 2 | Frontend route security |
| Phase 4 | Week 3 | E2E test automation |
| Phase 5 | Week 3-4 | Security tampering tests |
| Phase 6 | Week 4 | Documentation & sign-off |

---

## Document Control

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0.0 | 2026-06-10 | Security Team | Initial specification |

---

**NEXT**: See [ADMIN_BRANCH_SCOPE_MATRIX.md](./ADMIN_BRANCH_SCOPE_MATRIX.md) for detailed scope enforcement matrix.
