# MAS-CallNet HRMS: Comprehensive Role-Based Testing Plan

**Version**: 1.0  
**Date**: 2026-06-01  
**Purpose**: Validate every page, function, and permission for each user role

---

## Testing Environment

**URLs**:
- Backend: `http://localhost:3002` (Railway production: TBD)
- Frontend: `http://localhost:5173` (Vercel: TBD)

**Test Credentials** (from `src/lib/demoCreds.ts`):
```javascript
Admin:    admin@shivu.ai / admin123
HR:       hr@shivu.ai / hr123
Manager:  manager@shivu.ai / manager123
Employee: employee@shivu.ai / employee123
Client:   demo@mascallnet.com / [OTP-based]
```

**Databases**:
- MySQL: `mas_hrms` (operational data)
- Supabase: Authentication + storage only

---

## Role Matrix: Page Access

| Page | Admin | HR | Manager | Employee | Client | Notes |
|---|---|---|---|---|---|
| **Dashboard** |
| `/` | ✅ | ✅ | ✅ | ✅ | ❌ | Role-specific widgets |
| **Employees** |
| `/employees` | ✅ | ✅ | 🟡 | ❌ | ❌ | Manager: team only |
| `/profile` | ✅ | ✅ | ✅ | ✅ | ❌ | Own profile |
| `/onboarding` | ✅ | ✅ | 🟡 | 🟡 | ❌ | Manager: team, Employee: self |
| **Attendance** |
| `/attendance` | ✅ | ✅ | 🟡 | ✅ | ❌ | Manager: team, Employee: self |
| `/attendance/regularization` | ✅ | ✅ | ✅ | ✅ | ❌ | Submit/approve |
| `/wfm-roster` | ✅ | ✅ | ✅ | ✅ | ❌ | View schedule |
| `/wfm-governance` | ✅ | ✅ | ❌ | ❌ | ❌ | HR only |
| **Leave** |
| `/leaves` | ✅ | ✅ | ✅ | ✅ | ❌ | Apply/approve |
| `/leave-calendar` | ✅ | ✅ | ✅ | ✅ | ❌ | View calendar |
| `/company-calendar` | ✅ | ✅ | ✅ | ✅ | ❌ | Holidays |
| **Payroll** |
| `/payroll` | ✅ | ✅ | ❌ | ✅ | ❌ | Employee: payslips only |
| `/payroll/runs` | ✅ | ✅ | ❌ | ❌ | ❌ | HR: payroll execution |
| `/payroll/structures` | ✅ | ✅ | ❌ | ❌ | ❌ | Salary structures |
| `/payroll/statutory-config` | ✅ | ❌ | ❌ | ❌ | ❌ | Admin only |
| `/tax-declaration` | ✅ | ✅ | ❌ | ✅ | ❌ | Employee: declare |
| **Performance** |
| `/performance` | ✅ | ✅ | ✅ | ✅ | ❌ | Reviews |
| `/goals-appraisal` | ✅ | ✅ | ✅ | ✅ | ❌ | Goals/KRAs |
| `/performance-feedback` | ✅ | ✅ | ✅ | ✅ | ❌ | Feedback forms |
| **Assets** |
| `/assets` | ✅ | ✅ | ❌ | ✅ | ❌ | Employee: assigned only |
| **Communication** |
| `/communication/templates` | ✅ | ✅ | ❌ | ❌ | ❌ | HR: manage templates |
| `/communication/dispatch` | ✅ | ✅ | ❌ | ❌ | ❌ | HR: send messages |
| `/communication/history` | ✅ | ✅ | 🟡 | 🟡 | ❌ | Manager/Employee: own logs |
| `/communication/preferences` | ✅ | ✅ | ✅ | ✅ | ❌ | Own preferences |
| **System** |
| `/settings` | ✅ | ❌ | ❌ | ❌ | ❌ | Admin only |
| `/org-masters` | ✅ | ❌ | ❌ | ❌ | ❌ | Admin only |
| `/exit-management` | ✅ | ✅ | ✅ | ❌ | ❌ | Resignation flow |
| `/migration-console` | ✅ | ❌ | ❌ | ❌ | ❌ | Admin only |
| **Client Portal** |
| `/portal` | ❌ | ❌ | ❌ | ❌ | ✅ | Client dashboard |
| `/portal/kpi` | ❌ | ❌ | ❌ | ❌ | ✅ | Process KPIs |
| `/portal/glidepath` | ❌ | ❌ | ❌ | ❌ | ✅ | Performance charts |
| `/portal/action-plans` | ❌ | ❌ | ❌ | ❌ | ✅ | Action items |

Legend:
- ✅ Full access
- 🟡 Restricted access (own data or team only)
- ❌ No access (should redirect or 403)

---

## Test Cases by Role

### ROLE 1: ADMIN (Superuser)

**Login**: `admin@shivu.ai / admin123`

#### Test Suite: Admin Navigation
```
Test 1.1: Dashboard Access
- [ ] Navigate to `/`
- [ ] Verify admin-specific widgets visible
- [ ] Check all nav sections visible (Employees, Attendance, Leave, Payroll, etc.)

Test 1.2: Employee Management
- [ ] Navigate to `/employees`
- [ ] Verify can see ALL employees (not just own team)
- [ ] Click "Add Employee" button → Form opens
- [ ] Create test employee → Success
- [ ] Edit employee → Success
- [ ] Archive employee → Success (status change to inactive)

Test 1.3: Payroll Operations
- [ ] Navigate to `/payroll/runs`
- [ ] Click "Create Payroll Run" → Form opens
- [ ] Select month, process → Create run
- [ ] Verify run appears in list
- [ ] Click run → View salary prep lines
- [ ] Export NEFT file → Download works
- [ ] Export PF ECR → Download works

Test 1.4: System Settings (Admin Only)
- [ ] Navigate to `/settings`
- [ ] Verify page loads (not 403)
- [ ] Update system config → Success
- [ ] Navigate to `/org-masters`
- [ ] Add new branch → Success
- [ ] Add new client → Success
- [ ] Navigate to `/migration-console`
- [ ] Verify migration tools visible

Test 1.5: Statutory Config (Admin Only)
- [ ] Navigate to `/payroll/statutory-config`
- [ ] Verify PF slabs visible
- [ ] Update PF rate → Success
- [ ] Verify ESIC slabs visible
- [ ] Update ESIC rate → Success
```

#### Expected: ALL pages accessible, ALL actions succeed

---

### ROLE 2: HR

**Login**: `hr@shivu.ai / hr123`

#### Test Suite: HR Operations
```
Test 2.1: Dashboard Access
- [ ] Navigate to `/`
- [ ] Verify HR-specific widgets (Attendance summary, Leave requests, Payroll pending)
- [ ] Check nav: Employees, Attendance, Leave, Payroll, Performance visible
- [ ] Check nav: Settings, Migration Console NOT visible (admin-only)

Test 2.2: Employee Management
- [ ] Navigate to `/employees`
- [ ] Verify can see ALL employees
- [ ] Click "Add Employee" → Form opens
- [ ] Create test employee → Success
- [ ] Edit employee → Success
- [ ] Archive employee → Success

Test 2.3: Attendance Management
- [ ] Navigate to `/attendance`
- [ ] Verify can see ALL employees attendance
- [ ] Navigate to `/wfm-governance`
- [ ] Verify page loads (HR can access)
- [ ] Update attendance rule → Success

Test 2.4: Payroll Execution
- [ ] Navigate to `/payroll/runs`
- [ ] Verify can see all runs
- [ ] Create new payroll run → Success
- [ ] Navigate to `/payroll/structures`
- [ ] View salary structures → Success
- [ ] Update salary structure → Success

Test 2.5: Communication Module
- [ ] Navigate to `/communication/templates`
- [ ] Verify page loads (HR can access)
- [ ] Create new template → Success
- [ ] Navigate to `/communication/dispatch`
- [ ] Send test message to employee → Success
- [ ] Navigate to `/communication/history`
- [ ] Verify can see ALL dispatch logs

Test 2.6: Restricted Pages (Should Fail)
- [ ] Navigate to `/settings` → Expect 403 or redirect
- [ ] Navigate to `/payroll/statutory-config` → Expect 403 or redirect
- [ ] Navigate to `/migration-console` → Expect 403 or redirect
```

#### Expected: HR pages accessible, Admin pages blocked

---

### ROLE 3: MANAGER

**Login**: `manager@shivu.ai / manager123`

#### Test Suite: Manager Team Operations
```
Test 3.1: Dashboard Access
- [ ] Navigate to `/`
- [ ] Verify manager-specific widgets (Team attendance, Team leaves, Team performance)
- [ ] Check nav: Attendance, Leave, Performance visible
- [ ] Check nav: Payroll Runs, Settings NOT visible

Test 3.2: Team Employee View (Restricted)
- [ ] Navigate to `/employees`
- [ ] Verify can see ONLY reportees (not all employees)
- [ ] Verify cannot see other teams' employees
- [ ] Click reportee → View profile → Success
- [ ] Try to edit reportee → Check if allowed (depends on RBAC)

Test 3.3: Team Attendance
- [ ] Navigate to `/attendance`
- [ ] Verify can see ONLY team members' attendance
- [ ] Verify cannot see other teams' attendance
- [ ] Click team member → View attendance detail → Success

Test 3.4: Leave Approvals
- [ ] Navigate to `/leaves`
- [ ] Verify can see team leave requests
- [ ] Click pending leave request → Approve button visible
- [ ] Approve leave → Success
- [ ] Reject leave → Success
- [ ] Verify cannot approve leaves for other teams

Test 3.5: Attendance Regularization Approvals
- [ ] Navigate to `/attendance/regularization`
- [ ] Verify can see team regularization requests
- [ ] Approve regularization → Success
- [ ] Reject regularization → Success

Test 3.6: Performance Reviews
- [ ] Navigate to `/performance`
- [ ] Verify can see team members only
- [ ] Click team member → Start review → Success
- [ ] Submit review → Success
- [ ] Navigate to `/goals-appraisal`
- [ ] Assign KRA to team member → Success

Test 3.7: Restricted Pages (Should Fail)
- [ ] Navigate to `/payroll/runs` → Expect 403
- [ ] Navigate to `/payroll/structures` → Expect 403
- [ ] Navigate to `/communication/templates` → Expect 403
- [ ] Navigate to `/wfm-governance` → Expect 403
- [ ] Navigate to `/settings` → Expect 403
```

#### Expected: Team-only data, no cross-team access, no HR/Admin functions

---

### ROLE 4: EMPLOYEE (Self-Service)

**Login**: `employee@shivu.ai / employee123`

#### Test Suite: Employee Self-Service
```
Test 4.1: Dashboard Access
- [ ] Navigate to `/`
- [ ] Verify employee-specific widgets (Own attendance, Leave balance, Payslip link)
- [ ] Check nav: Limited menu (Attendance, Leave, Payroll, Performance)
- [ ] Check nav: Employees list NOT visible

Test 4.2: Own Profile
- [ ] Navigate to `/profile`
- [ ] Verify can see own profile
- [ ] Edit contact details → Success
- [ ] Edit bank details → Success
- [ ] Upload profile photo → Success

Test 4.3: Attendance (Self Only)
- [ ] Navigate to `/attendance`
- [ ] Verify can see ONLY own attendance records
- [ ] Clock-in → Success
- [ ] Take break → Success
- [ ] Clock-out → Success
- [ ] Navigate to `/attendance/regularization`
- [ ] Submit regularization request → Success

Test 4.4: Leave Management (Self)
- [ ] Navigate to `/leaves`
- [ ] View leave balance → Success
- [ ] Apply new leave → Success
- [ ] Cancel pending leave → Success
- [ ] Verify cannot see other employees' leaves

Test 4.5: Payroll (View Only)
- [ ] Navigate to `/payroll`
- [ ] Verify can see ONLY own payslips
- [ ] Click payslip → View/download → Success
- [ ] Acknowledge payslip → Success
- [ ] Navigate to `/tax-declaration`
- [ ] Upload investment proof → Success

Test 4.6: Performance (Self)
- [ ] Navigate to `/performance`
- [ ] View own performance reviews → Success
- [ ] Navigate to `/goals-appraisal`
- [ ] View own KRAs → Success
- [ ] Self-assessment submission → Success

Test 4.7: Communication Preferences
- [ ] Navigate to `/communication/preferences`
- [ ] Update notification channel (email/SMS/WhatsApp) → Success
- [ ] Enable/disable categories → Success

Test 4.8: Restricted Pages (Should Fail)
- [ ] Navigate to `/employees` → Expect 403 or not visible
- [ ] Navigate to `/payroll/runs` → Expect 403
- [ ] Navigate to `/communication/templates` → Expect 403
- [ ] Navigate to `/communication/dispatch` → Expect 403
- [ ] Navigate to `/wfm-governance` → Expect 403
- [ ] Navigate to `/settings` → Expect 403
```

#### Expected: Self-service only, no access to others' data, no admin functions

---

### ROLE 5: CLIENT PORTAL

**Login**: `demo@mascallnet.com / [OTP via email]`

#### Test Suite: Client Portal Access
```
Test 5.1: OTP Authentication
- [ ] Navigate to `/portal-login`
- [ ] Enter email: demo@mascallnet.com
- [ ] Request OTP → Success
- [ ] Enter OTP → Login success
- [ ] Verify redirected to `/portal` (not main HRMS)

Test 5.2: Client Dashboard
- [ ] Verify on `/portal` (separate layout from HRMS)
- [ ] Verify process selector visible (if client has multiple processes)
- [ ] Select process → Dashboard updates with process-scoped data

Test 5.3: KPI Scorecards
- [ ] Navigate to `/portal/kpi`
- [ ] Verify can see ONLY assigned process KPIs
- [ ] Verify KPI metrics visible (target, actual, variance)
- [ ] Filter by date range → Data updates

Test 5.4: Glidepath Charts
- [ ] Navigate to `/portal/glidepath`
- [ ] Verify glidepath chart visible (committed vs target)
- [ ] Verify process-scoped data only
- [ ] Export chart → Success

Test 5.5: Action Plans
- [ ] Navigate to `/portal/action-plans`
- [ ] Verify action items visible
- [ ] Filter by status (Planned/In Progress/Done/Delayed) → Success
- [ ] View action detail → Success

Test 5.6: Restricted Access (Should Fail)
- [ ] Try to navigate to `/` (main dashboard) → Expect redirect to /portal
- [ ] Try to navigate to `/employees` → Expect 403
- [ ] Try to navigate to `/payroll` → Expect 403
- [ ] Try to navigate to `/communication/templates` → Expect 403
- [ ] Verify CANNOT see employee names, salaries, personal data
- [ ] Verify CANNOT see other clients' processes
```

#### Expected: Process-scoped data only, no HR data, no cross-client access

---

## Cross-Role Validation Tests

### Test: Data Isolation

```
Setup:
- Employee A (Team 1, Manager X)
- Employee B (Team 2, Manager Y)
- Manager X logs in

Test:
- [ ] Manager X views attendance → Should see Employee A, NOT Employee B
- [ ] Manager X views leaves → Should see Employee A requests, NOT Employee B
- [ ] Manager X tries to approve Employee B leave → Should fail (403 or hidden)

Setup:
- Client C1 (Process P1)
- Client C2 (Process P2)
- Client C1 logs in

Test:
- [ ] Client C1 views KPIs → Should see Process P1 only, NOT Process P2
- [ ] Client C1 tries to navigate to Process P2 → Should fail or redirect
```

### Test: Permission Escalation

```
Test:
- [ ] Employee logs in
- [ ] Manually navigate to `/settings` (URL hack) → Expect 403 or redirect
- [ ] Manually navigate to `/payroll/runs` → Expect 403
- [ ] Use browser DevTools to call admin API: POST /api/org/branches → Expect 401/403

Test:
- [ ] Manager logs in
- [ ] API call: GET /api/employees (all employees) → Should return team only
- [ ] API call: POST /api/payroll/runs → Expect 403

Test:
- [ ] Client logs in
- [ ] API call: GET /api/employees → Expect 403
- [ ] API call: GET /api/portal/kpi (other client's process) → Expect 403
```

---

## Backend API Testing

### Authentication Endpoints
```bash
# Test login
POST /api/auth/login
Body: { email: "admin@shivu.ai", password: "admin123" }
Expected: 200 + JWT token

# Test invalid credentials
POST /api/auth/login
Body: { email: "admin@shivu.ai", password: "wrong" }
Expected: 401

# Test portal OTP
POST /api/portal/auth/request-otp
Body: { email: "demo@mascallnet.com" }
Expected: 200 (OTP sent)

POST /api/portal/auth/verify-otp
Body: { email: "demo@mascallnet.com", otp: "123456" }
Expected: 200 + JWT token (process-scoped)
```

### RBAC Middleware Tests
```bash
# Test admin-only endpoint (as HR user)
GET /api/org/branches
Headers: { Authorization: "Bearer <hr_token>" }
Expected: 403 Forbidden

# Test admin-only endpoint (as admin)
GET /api/org/branches
Headers: { Authorization: "Bearer <admin_token>" }
Expected: 200 + branches list

# Test team-scoped endpoint (as manager)
GET /api/employees
Headers: { Authorization: "Bearer <manager_token>" }
Expected: 200 + team employees only (not all)

# Test self-only endpoint (as employee)
GET /api/payroll/payslips
Headers: { Authorization: "Bearer <employee_token>" }
Expected: 200 + own payslips only
```

---

## Frontend RBAC Tests

### Navigation Menu Rendering
```javascript
// Test: Admin sees all nav items
Login as admin → Check sidebar
Expected: All sections visible (Employees, Payroll, Settings, Migration)

// Test: HR doesn't see admin items
Login as HR → Check sidebar
Expected: Settings, Migration Console hidden

// Test: Manager sees limited menu
Login as manager → Check sidebar
Expected: Team-related items only (Attendance, Leave, Performance)

// Test: Employee sees minimal menu
Login as employee → Check sidebar
Expected: Self-service only (My Attendance, My Leaves, My Payroll)

// Test: Client sees portal menu only
Login as client → Check layout
Expected: Separate portal layout (KPI, Glidepath, Action Plans)
```

### Page Access Guards
```javascript
// Check ProtectedRoute wrapper
- [ ] All /admin/* routes wrapped with requireRole(['admin'])
- [ ] All /hr/* routes wrapped with requireRole(['admin', 'hr'])
- [ ] All /portal/* routes wrapped with PortalRoute

// Check conditional rendering
- [ ] "Add Employee" button: visible for admin/hr, hidden for manager/employee
- [ ] "Create Payroll Run" button: visible for admin/hr, hidden for others
- [ ] "Edit Salary" action: visible for admin/hr, hidden for others
```

---

## Testing Checklist Summary

### Phase 1: Role Access Matrix (1-2 days)
- [ ] Test Admin: All 30+ pages
- [ ] Test HR: 25+ pages (excluding admin-only)
- [ ] Test Manager: 15+ pages (team-scoped)
- [ ] Test Employee: 10+ pages (self-service)
- [ ] Test Client: 4 portal pages

### Phase 2: Data Isolation (1 day)
- [ ] Manager cannot see other teams
- [ ] Employee cannot see other employees
- [ ] Client cannot see other processes

### Phase 3: Permission Escalation Prevention (1 day)
- [ ] URL hacking blocked (403)
- [ ] API direct calls blocked (401/403)
- [ ] DevTools API calls blocked

### Phase 4: Backend API RBAC (1 day)
- [ ] All admin endpoints require admin role
- [ ] Team-scoped endpoints filter by manager
- [ ] Self-scoped endpoints filter by employee

### Phase 5: Frontend Guards (1 day)
- [ ] Nav menu conditional rendering
- [ ] Action buttons conditional rendering
- [ ] ProtectedRoute wrappers

---

## Issues Tracking Template

```markdown
## Issue #1: [Page] - [Role] - [Problem]

**Role**: Manager
**Page**: `/employees`
**Expected**: Should see team members only
**Actual**: Sees all employees
**Severity**: HIGH (data leak)
**Steps to Reproduce**:
1. Login as manager@shivu.ai
2. Navigate to /employees
3. Observe full employee list

**Fix Required**: 
- Backend: Add `getTeamEmployees(managerId)` filter
- Frontend: Pass manager context to API call

**Status**: Open
```

---

## Test Execution Log

Create `docs/testing/test-execution-log.md` with:
```markdown
# Test Execution Log

## Date: 2026-06-01

### Admin Tests
- [x] Dashboard access: PASS
- [x] Employee CRUD: PASS
- [x] Payroll runs: PASS
- [x] Settings access: PASS
- [x] Migration console: PASS

### HR Tests
- [ ] Dashboard access: PENDING
- [ ] Employee CRUD: PENDING
...

### Issues Found
1. Manager sees all employees (should see team only) - HIGH
2. Employee can access `/payroll/runs` via URL hack - CRITICAL
3. Client portal shows employee names (should show IDs only) - MEDIUM
```

---

**Total Estimated Testing Time**: 5-7 days (full manual testing)

**Priority Order**:
1. Admin + HR (core functionality)
2. Manager (data isolation critical)
3. Employee (self-service validation)
4. Client Portal (process-scoped validation)
5. Backend API (RBAC enforcement)
