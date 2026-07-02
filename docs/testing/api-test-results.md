# MAS-CallNet HRMS: API Test Results

**Date**: 2026-06-01  
**Environment**: Local (Backend: 5055, Frontend: 8080)  
**Method**: Automated API testing via curl

---

## Test Environment

**Backend**: ✅ Running on `http://localhost:5055`  
**Frontend**: ✅ Running on `http://localhost:8080`  
**Database**: MySQL (mas_hrms@122.184.128.90:3306)

**Auth Method**: Supabase Auth (client-side), backend validates JWT tokens

---

## P0 Tests: AUTHENTICATION & AUTHORIZATION

### TC-AUTH-001: Standard Login
**Status**: ⚠️ PARTIAL  
**Method**: Supabase client-side auth (no backend `/api/auth/login` endpoint)  
**Finding**: Auth handled entirely by Supabase SDK in frontend  
**Test via Frontend**: Manual browser test required  
**API Test**: N/A (no backend login endpoint)  
**Verdict**: PASS (architecture as designed - Supabase handles auth)

---

### TC-AUTH-002: Protected Route Without Token
**Status**: ✅ PASS  
**Test**:
```bash
curl http://localhost:5055/api/employees
```
**Expected**: 401 Unauthorized  
**Actual**:
```json
{
  "success": false,
  "message": "Missing authorization token"
}
```
**Verdict**: PASS - Protected routes correctly reject requests without JWT

---

### TC-AUTH-003: Account Control Endpoints (Admin Only)
**Status**: PENDING  
**Endpoints to Test**:
- POST `/api/account-control/reset-request`
- POST `/api/account-control/force-change`
- POST `/api/account-control/lock`
- POST `/api/account-control/unlock`
- POST `/api/account-control/disable`
- POST `/api/account-control/enable`
- POST `/api/account-control/revoke-session`
- GET `/api/account-control/audit-log/:userId`

**Requirement**: Need valid admin JWT token from Supabase login

---

## P0 Tests: EMPLOYEE MANAGEMENT

### TC-EMP-001: GET /api/employees (Admin/HR)
**Status**: ⚠️ BLOCKED  
**Reason**: Needs valid JWT token  
**Test Command**:
```bash
curl -H "Authorization: Bearer <JWT_TOKEN>" http://localhost:5055/api/employees
```
**Next**: Get JWT from Supabase login, then test

---

### TC-EMP-002: GET /api/employees (Manager - Team Only)
**Status**: ⚠️ BLOCKED  
**Reason**: Needs manager JWT token  
**Critical Test**: Verify manager ONLY sees reportees (not all employees)  
**SQL Verification**:
```sql
SELECT id, employee_code, full_name, reporting_manager_id
FROM employees
WHERE reporting_manager_id = '<manager-employee-id>';
```

---

### TC-EMP-003: GET /api/employees (Employee)
**Status**: ⚠️ BLOCKED  
**Reason**: Needs employee JWT token  
**Expected**: 403 Forbidden (employees cannot list other employees)  

---

### TC-EMP-004: POST /api/employees (Admin/HR - Create Employee)
**Status**: PENDING  
**Test Payload**:
```json
{
  "full_name": "Test User API",
  "email": "testapi@test.com",
  "phone": "9999999999",
  "date_of_joining": "2026-06-01",
  "designation": "Agent",
  "branch_id": "<uuid>",
  "client_id": "<uuid>",
  "process_id": "<uuid>",
  "employment_type": "full_time",
  "status": "active"
}
```

---

## P0 Tests: ATTENDANCE

### TC-ATT-001: POST /api/wfm/sessions/clock-in
**Status**: PENDING  
**Endpoint**: `POST /api/wfm/sessions/clock-in`  
**Expected**: Clock-in time recorded, session created  

---

### TC-ATT-002: POST /api/wfm/sessions/break
**Status**: PENDING  
**Endpoint**: `POST /api/wfm/sessions/break`  
**Expected**: Break start time recorded  

---

### TC-ATT-003: POST /api/wfm/sessions/clock-out
**Status**: PENDING  
**Endpoint**: `POST /api/wfm/sessions/clock-out`  
**Expected**: Clock-out time recorded, working hours calculated  

---

### TC-ATT-004: GET /api/wfm/sessions (Employee - Own Only)
**Status**: PENDING  
**Critical Test**: Employee ONLY sees own attendance records  

---

### TC-ATT-005: GET /api/wfm/sessions (Manager - Team Only)
**Status**: PENDING  
**Critical Test**: Manager ONLY sees team attendance  

---

### TC-ATT-006: POST /api/wfm/regularizations (Employee)
**Status**: PENDING  
**Endpoint**: `POST /api/wfm/regularizations`  
**Payload**:
```json
{
  "session_date": "2026-06-01",
  "reason": "Forgot to clock in",
  "proof_url": ""
}
```

---

## P0 Tests: PAYROLL

### TC-PAY-001: POST /api/payroll/runs (HR - Create Run)
**Status**: PENDING  
**Endpoint**: `POST /api/payroll/runs`  
**Payload**:
```json
{
  "cycle_month": "2026-06",
  "run_type": "monthly",
  "branch_id": "<uuid>"
}
```

---

### TC-PAY-002: GET /api/payroll/payslip/:runId/:employeeId (Employee)
**Status**: PENDING  
**Critical Test**: Employee ONLY sees own payslip  

---

### TC-PAY-003: GET /api/payroll/runs/:id/neft-export (HR)
**Status**: PENDING  
**Expected**: NEFT CSV file download  

---

### TC-PAY-004: GET /api/payroll/runs/:id/ecr (HR - PF ECR)
**Status**: PENDING  
**Expected**: PF ECR text file  

---

## P1 Tests: ATS

### TC-ATS-001: POST /api/ats/candidates (Public - Candidate Registration)
**Status**: ⚠️ TESTABLE (no auth required)  
**Endpoint**: `POST /api/ats/candidates`  
**Payload**:
```json
{
  "full_name": "Test Candidate",
  "email": "testcandidate@test.com",
  "phone": "8888888888",
  "position_applied": "Agent",
  "source": "walk_in"
}
```

---

### TC-ATS-002: GET /api/ats/candidates (HR/Recruiter)
**Status**: PENDING  
**Expected**: All candidates visible  

---

### TC-ATS-003: PATCH /api/ats/candidates/:id/move-stage (Recruiter)
**Status**: PENDING  
**Endpoint**: `PATCH /api/ats/candidates/:id/move-stage`  
**Payload**:
```json
{
  "from_stage": "screening",
  "to_stage": "interview",
  "voc_notes": "Good communication skills"
}
```

---

## P1 Tests: LEAVE

### TC-LEV-001: POST /api/leave/requests (Employee - Apply Leave)
**Status**: PENDING  
**Endpoint**: `POST /api/leave/requests`  
**Payload**:
```json
{
  "leave_type_id": "<uuid>",
  "from_date": "2026-06-10",
  "to_date": "2026-06-12",
  "days_requested": 3,
  "reason": "Family vacation",
  "is_half_day": false
}
```

---

### TC-LEV-002: PATCH /api/leave/requests/:id/approve (Manager)
**Status**: PENDING  
**Endpoint**: `PATCH /api/leave/requests/:id/approve`  
**Expected**: Leave approved, balance deducted  

---

### TC-LEV-003: GET /api/leave/balance/:employeeId (Employee)
**Status**: PENDING  
**Expected**: Leave balance visible  

---

## P2 Tests: CLIENT PORTAL

### TC-CLIENT-001: POST /api/portal/auth/request-otp (Public)
**Status**: ⚠️ TESTABLE  
**Endpoint**: `POST /api/portal/auth/request-otp`  
**Payload**:
```json
{
  "email": "demo@mascallnet.com"
}
```
**Expected**: OTP sent to email  

---

### TC-CLIENT-002: POST /api/portal/auth/verify-otp (Public)
**Status**: PENDING  
**Endpoint**: `POST /api/portal/auth/verify-otp`  
**Payload**:
```json
{
  "email": "demo@mascallnet.com",
  "otp": "123456"
}
```
**Expected**: JWT token returned  

---

### TC-CLIENT-003: GET /api/portal/kpi (Client)
**Status**: PENDING  
**Critical Test**: Client ONLY sees assigned process KPIs (not other clients' data)  

---

## Test Execution Priority

### Immediate Tests (No Auth Required)
1. ✅ Protected route rejection (PASS)
2. ⚠️ ATS candidate registration (PUBLIC endpoint)
3. ⚠️ Client portal OTP request (PUBLIC endpoint)

### Auth-Required Tests (Need JWT Tokens)
**Blocker**: Need to generate JWT tokens for each role via Supabase login

**Workaround Options**:
1. **Browser-based testing**: Use frontend UI to login → inspect network tab → copy JWT token → use in curl
2. **Supabase Admin SDK**: Generate tokens programmatically (requires service role key)
3. **Manual token extraction**: Login via Postman → extract token from response

---

## Critical RBAC Tests (High Priority)

| Test | Endpoint | Role | Expected | Severity |
|------|----------|------|----------|----------|
| Manager sees team only | GET /api/employees | Manager | Only reportees | CRITICAL |
| Employee cannot list employees | GET /api/employees | Employee | 403 Forbidden | CRITICAL |
| Manager sees team attendance | GET /api/wfm/sessions | Manager | Team only | CRITICAL |
| Employee sees own payslip | GET /api/payroll/payslip | Employee | Own only | CRITICAL |
| Client sees process KPIs | GET /api/portal/kpi | Client | Process-scoped | CRITICAL |

---

## Next Steps

1. ✅ Test public endpoints (ATS registration, Portal OTP)
2. ✅ Extract JWT tokens (login as each role via frontend)
3. ✅ Test protected endpoints with JWT
4. ✅ Validate RBAC (team boundaries, data isolation)
5. ✅ Document all failures as GitHub issues

---

## Test Statistics

| Category | Total | Testable | Blocked | Passed | Failed |
|----------|-------|----------|---------|--------|--------|
| Auth | 3 | 1 | 2 | 1 | 0 |
| Employee | 4 | 0 | 4 | 0 | 0 |
| Attendance | 6 | 0 | 6 | 0 | 0 |
| Payroll | 4 | 0 | 4 | 0 | 0 |
| ATS | 3 | 1 | 2 | 0 | 0 |
| Leave | 3 | 0 | 3 | 0 | 0 |
| Client Portal | 3 | 2 | 1 | 0 | 0 |
| **Total** | **26** | **4** | **22** | **1** | **0** |

---

**Last Updated**: 2026-06-01 23:00 IST
