# Phase 10: Scope Governance Testing Plan

**Date**: 2026-06-04  
**Status**: IN PROGRESS  
**Estimated Time**: 1.5-2 hours

---

## 🎯 TESTING OBJECTIVES

1. Validate scope guards work correctly across 7 modules
2. Ensure HR/Manager/Recruiter/Finance see ONLY their scope
3. Verify CEO read-only access
4. Confirm Admin emergency override
5. Test 403 Forbidden for out-of-scope access
6. Validate grace period defaults work

---

## 📊 TEST MATRIX (21 Scenarios)

### HR Scope Tests (5 scenarios)

#### Test 1: HR Creates Employee in Assigned Branch ✅
```bash
POST /api/employees
Authorization: Bearer <hr_pune_token>
Body: { branch_id: "pune", first_name: "Test", ... }

Expected: 201 Created
Validates: HR can create ONLY in assigned branch
```

#### Test 2: HR Creates Employee in Unassigned Branch ❌
```bash
POST /api/employees
Authorization: Bearer <hr_pune_token>
Body: { branch_id: "mumbai", first_name: "Test", ... }

Expected: 403 Forbidden
Validates: HR CANNOT create outside scope
```

#### Test 3: HR Views Employee List (Scoped) ✅
```bash
GET /api/employees
Authorization: Bearer <hr_pune_token>

Expected: 200 OK, ONLY Pune employees
Validates: List filtering works
```

#### Test 4: HR Updates Pune Employee ✅
```bash
PATCH /api/employees/{pune_employee_id}
Authorization: Bearer <hr_pune_token>
Body: { first_name: "Updated" }

Expected: 200 OK
Validates: HR can update within scope
```

#### Test 5: HR Updates Mumbai Employee ❌
```bash
PATCH /api/employees/{mumbai_employee_id}
Authorization: Bearer <hr_pune_token>
Body: { first_name: "Updated" }

Expected: 403 Forbidden
Validates: HR CANNOT update outside scope
```

---

### Manager Scope Tests (4 scenarios)

#### Test 6: Manager Views Employee List (Team Only) ✅
```bash
GET /api/employees
Authorization: Bearer <manager_token>

Expected: 200 OK, ONLY direct reports (manager_id match)
Validates: Manager sees team only
```

#### Test 7: Manager Assigns KPI to Team Member ✅
```bash
POST /api/kpi/assignments
Authorization: Bearer <manager_token>
Body: { employee_id: "team_member", template_id: "kpi_template" }

Expected: 201 Created
Validates: Manager can assign KPI to team
```

#### Test 8: Manager Assigns KPI to Non-Team Member ❌
```bash
POST /api/kpi/assignments
Authorization: Bearer <manager_token>
Body: { employee_id: "other_employee", template_id: "kpi_template" }

Expected: 403 Forbidden
Validates: Manager CANNOT assign outside team
```

#### Test 9: Manager Views All Employees ❌
```bash
GET /api/employees
Authorization: Bearer <manager_token>

Expected: 200 OK, but ONLY manager_id matches
Validates: Scope filtering enforced
```

---

### Recruiter Scope Tests (3 scenarios)

#### Test 10: Recruiter Views Candidates (Branch Scoped) ✅
```bash
GET /api/ats/candidates
Authorization: Bearer <recruiter_noida_token>

Expected: 200 OK, ONLY Noida branch candidates
Validates: Recruiter scope works
```

#### Test 11: Recruiter Moves Noida Candidate ✅
```bash
POST /api/ats/candidates/{noida_candidate_id}/move-stage
Authorization: Bearer <recruiter_noida_token>
Body: { new_stage: "Interview" }

Expected: 200 OK
Validates: Recruiter can move within scope
```

#### Test 12: Recruiter Moves Mumbai Candidate ❌
```bash
POST /api/ats/candidates/{mumbai_candidate_id}/move-stage
Authorization: Bearer <recruiter_noida_token>
Body: { new_stage: "Interview" }

Expected: 403 Forbidden
Validates: Recruiter CANNOT move outside scope
```

---

### Finance/Payroll Scope Tests (3 scenarios)

#### Test 13: Finance Creates Payroll Run for Ahmedabad ✅
```bash
POST /api/payroll/runs
Authorization: Bearer <finance_ahmedabad_token>
Body: { branch_id: "ahmedabad", month_year: "2026-06", ... }

Expected: 201 Created
Validates: Finance can create run within scope
```

#### Test 14: Finance Creates Run for Delhi ❌
```bash
POST /api/payroll/runs
Authorization: Bearer <finance_ahmedabad_token>
Body: { branch_id: "delhi", month_year: "2026-06", ... }

Expected: 403 Forbidden
Validates: Finance CANNOT create outside scope
```

#### Test 15: Finance Assigns Salary to Ahmedabad Employee ✅
```bash
POST /api/payroll/salary-assignments
Authorization: Bearer <finance_ahmedabad_token>
Body: { employee_id: "ahmedabad_employee", ... }

Expected: 201 Created
Validates: Salary assignment scoped
```

---

### WFM/Roster Scope Tests (3 scenarios)

#### Test 16: WFM Creates Roster Plan for Pune ✅
```bash
POST /api/wfm/roster/plans
Authorization: Bearer <wfm_pune_token>
Body: { branch_id: "pune", process_id: "process_1", ... }

Expected: 201 Created
Validates: WFM can create plan within scope
```

#### Test 17: WFM Creates Plan for Noida ❌
```bash
POST /api/wfm/roster/plans
Authorization: Bearer <wfm_pune_token>
Body: { branch_id: "noida", process_id: "process_2", ... }

Expected: 403 Forbidden
Validates: WFM CANNOT create outside scope
```

#### Test 18: WFM Submits Draft ✅
```bash
POST /api/wfm/auto-roster/plans
Authorization: Bearer <wfm_pune_token>
Body: { branch_id: "pune", ... }

Expected: 201 Created
Validates: Auto-roster draft submission works
```

#### Test 19: WFM Publishes Plan ❌
```bash
PATCH /api/wfm/roster/plans/{plan_id}/publish
Authorization: Bearer <wfm_pune_token>

Expected: 403 Forbidden
Validates: WFM CANNOT publish (PM-only)
```

---

### CEO/Admin Tests (2 scenarios)

#### Test 20: CEO Views All Employees ✅
```bash
GET /api/employees
Authorization: Bearer <ceo_token>

Expected: 200 OK, ALL employees
Validates: CEO read-only all data
```

#### Test 21: CEO Updates Employee ❌
```bash
PATCH /api/employees/{employee_id}
Authorization: Bearer <ceo_token>
Body: { first_name: "Updated" }

Expected: 403 Forbidden (if read-only enforced)
OR 200 OK (if CEO has write - depends on implementation)
Validates: CEO read-only enforcement
```

#### Test 22: Admin Overrides Scope Check ✅
```bash
POST /api/employees
Authorization: Bearer <admin_token>
Body: { branch_id: "any_branch", ... }

Expected: 201 Created
Validates: Admin emergency override works
```

---

## 🧪 TEST EXECUTION STRATEGY

### Option A: Manual API Testing (Postman/curl)
**Effort**: 2 hours  
**Steps**:
1. Create test users for each role + scope
2. Get auth tokens for each user
3. Run 22 API requests
4. Document results

### Option B: Automated Test Suite
**Effort**: 3-4 hours (write tests) + 30 min (run)  
**Steps**:
1. Create test file: `backend/tests/scope-governance.test.ts`
2. Setup test users + tokens
3. Write 22 test cases
4. Run with `npm test`

### Option C: Hybrid (Recommended)
**Effort**: 1.5 hours  
**Steps**:
1. Create test users manually (5 min)
2. Write quick test script (30 min)
3. Run 22 scenarios (30 min)
4. Document results (15 min)

---

## 🔧 TEST SETUP

### Step 1: Create Test Users (5 min)

```sql
-- HR Pune
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('hr_pune_id', 'hr_pune@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('hr_pune_id', 'hr', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id)
VALUES (UUID(), 'hr_pune_id', 'hr', 'branch', 'pune_branch_id');

-- Manager
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('manager_id', 'manager@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('manager_id', 'manager', 'system');

INSERT INTO employees (id, user_id, branch_id, first_name, last_name)
VALUES ('manager_emp_id', 'manager_id', 'branch_id', 'Manager', 'Test');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, manager_employee_id)
VALUES (UUID(), 'manager_id', 'manager', 'team', 'manager_emp_id');

-- Recruiter Noida
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('recruiter_noida_id', 'recruiter_noida@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('recruiter_noida_id', 'recruiter', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id)
VALUES (UUID(), 'recruiter_noida_id', 'recruiter', 'branch', 'noida_branch_id');

-- Finance Ahmedabad
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('finance_ahmedabad_id', 'finance_ahmedabad@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('finance_ahmedabad_id', 'finance', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id)
VALUES (UUID(), 'finance_ahmedabad_id', 'finance', 'branch', 'ahmedabad_branch_id');

-- WFM Pune
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('wfm_pune_id', 'wfm_pune@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('wfm_pune_id', 'wfm', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type, branch_id, process_id)
VALUES (UUID(), 'wfm_pune_id', 'wfm', 'branch_process', 'pune_branch_id', 'process_id');

-- CEO
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('ceo_id', 'ceo@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('ceo_id', 'ceo', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type)
VALUES (UUID(), 'ceo_id', 'ceo', 'all');

-- Admin
INSERT INTO users (id, email, password_hash, active_status)
VALUES ('admin_id', 'admin@test.com', '<hash>', 1);

INSERT INTO user_roles (user_id, role_key, assigned_by)
VALUES ('admin_id', 'admin', 'system');

INSERT INTO user_assignment_scope (id, user_id, role_key, scope_type)
VALUES (UUID(), 'admin_id', 'admin', 'all');
```

### Step 2: Get Auth Tokens

```bash
# Login each user
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"hr_pune@test.com","password":"test123"}'

# Save token
export HR_PUNE_TOKEN="<access_token>"
export MANAGER_TOKEN="<access_token>"
export RECRUITER_NOIDA_TOKEN="<access_token>"
export FINANCE_AHMEDABAD_TOKEN="<access_token>"
export WFM_PUNE_TOKEN="<access_token>"
export CEO_TOKEN="<access_token>"
export ADMIN_TOKEN="<access_token>"
```

---

## 📝 TEST RESULTS TEMPLATE

```markdown
| Test | Scenario | Expected | Actual | Status |
|------|----------|----------|--------|--------|
| 1 | HR creates employee in Pune | 201 | 201 | ✅ |
| 2 | HR creates employee in Mumbai | 403 | 403 | ✅ |
| 3 | HR views employee list | 200 (Pune only) | 200 (Pune only) | ✅ |
| 4 | HR updates Pune employee | 200 | 200 | ✅ |
| 5 | HR updates Mumbai employee | 403 | 403 | ✅ |
| 6 | Manager views employee list | 200 (team only) | 200 (team only) | ✅ |
| 7 | Manager assigns KPI to team | 201 | 201 | ✅ |
| 8 | Manager assigns KPI to non-team | 403 | 403 | ✅ |
| 9 | Manager views all employees | 200 (team only) | 200 (team only) | ✅ |
| 10 | Recruiter views candidates (Noida) | 200 (Noida only) | 200 (Noida only) | ✅ |
| 11 | Recruiter moves Noida candidate | 200 | 200 | ✅ |
| 12 | Recruiter moves Mumbai candidate | 403 | 403 | ✅ |
| 13 | Finance creates run (Ahmedabad) | 201 | 201 | ✅ |
| 14 | Finance creates run (Delhi) | 403 | 403 | ✅ |
| 15 | Finance assigns salary (Ahmedabad) | 201 | 201 | ✅ |
| 16 | WFM creates plan (Pune) | 201 | 201 | ✅ |
| 17 | WFM creates plan (Noida) | 403 | 403 | ✅ |
| 18 | WFM submits draft | 201 | 201 | ✅ |
| 19 | WFM publishes plan | 403 | 403 | ✅ |
| 20 | CEO views all employees | 200 (all) | 200 (all) | ✅ |
| 21 | CEO updates employee | 403 | 403 | ✅ |
| 22 | Admin overrides scope | 201 | 201 | ✅ |

**Pass Rate**: 22/22 (100%)
```

---

## 🚨 KNOWN ISSUES TO WATCH

1. **Grace Period Active**
   - Default "all" scopes seeded
   - Some tests may pass when they should fail
   - Solution: Remove grace period after testing

2. **Service Layer Filtering**
   - List endpoints pass scopeFilter to controller
   - But service layer may not use WHERE clause yet
   - Solution: Update service layer after tests

3. **CEO Read-Only**
   - Need to verify CEO can't write
   - May need additional role checks

4. **Self-Access**
   - Employees viewing own data
   - Need to test self-scope

---

## 🎯 SUCCESS CRITERIA

- ✅ All 22 tests pass
- ✅ 403 Forbidden for out-of-scope
- ✅ Scoped lists return correct data
- ✅ CEO read-only enforced
- ✅ Admin override works
- ✅ No breaking changes

---

## 📅 NEXT STEPS AFTER TESTING

1. Document test results
2. Fix any failures
3. Update service layer for list filtering
4. Remove grace period (if ready)
5. Commit Phase 10 complete
6. Proceed to Payroll Compliance Pack integration

---

**Ready to execute tests?**
