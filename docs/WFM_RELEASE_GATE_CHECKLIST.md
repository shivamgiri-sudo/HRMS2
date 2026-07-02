# WFM Release Gate Checklist
**Version:** 1.0  
**Date:** 2026-06-20  
**Purpose:** Step-by-step production deployment validation

---

## Prerequisites

**Execute on server or machine with working npm/node (not local dev machine with stuck npm).**

**Required Access:**
- Server SSH access
- Staging/local MySQL database
- Production MySQL database (read-only for version check)
- Admin JWT token for API tests
- GitHub repository access

---

## Gate 1: Backend Dependencies

### 1.1 Install Type Packages
```bash
cd backend
npm install --save-dev @types/express @types/cors @types/nodemailer @types/bcryptjs @types/node @types/handlebars
```

**Expected:**
```
added <N> packages
found 0 vulnerabilities
```

**If fails:** Check npm registry connectivity, package.json syntax

---

## Gate 2: Backend Build

### 2.1 Run TypeScript Build
```bash
cd backend
npm run build
```

**Expected:** 0 errors

**Critical files must have 0 errors:**
```
backend/src/modules/wfm/hcCalculation.service.ts
backend/src/modules/wfm/planningRule.service.ts
backend/src/modules/wfm/slotRequirement.service.ts
backend/src/modules/wfm/weekoffDayRule.service.ts
backend/src/modules/wfm/wfm.routes.ts
backend/src/modules/rta/rta.routes.ts
```

**Check:**
```bash
npx tsc --noEmit 2>&1 | grep -E "(hcCalculation|planningRule|slotRequirement|weekoffDayRule|wfm\.routes|rta\.routes)" | wc -l
```

**Expected:** 0

**If fails:** Review errors, fix imports, fix type issues

---

## Gate 3: Frontend Build

### 3.1 Install Frontend Dependencies
```bash
cd .. # root directory
npm install --legacy-peer-deps
```

### 3.2 Build Frontend
```bash
npm run build
```

**Expected:**
```
✓ built in <time>
PWA v1.3.0
precache <N> entries
```

**If fails:** Check React component syntax, import paths

---

## Gate 4: Database Version Check

### 4.1 Check MySQL Version
```bash
# Connect to staging DB
mysql -h <staging-host> -u <user> -p mas_hrms

# Or from Node
node -e "const mysql = require('mysql2/promise'); (async () => { const c = await mysql.createConnection({host:'<host>', user:'<user>', password:'<pw>'}); const [r] = await c.query('SELECT VERSION()'); console.log(r[0]['VERSION()']); await c.end(); })()"
```

**SQL:**
```sql
SELECT VERSION();
```

**Expected:** `8.0.16` or higher

**Critical:** Migrations 227-236 use `ADD COLUMN IF NOT EXISTS` which requires MySQL 8.0.16+

**If version < 8.0.16:** Migration syntax must be rewritten to use separate `SHOW COLUMNS` checks

---

## Gate 5: Migration Dry-Run (Staging/Local DB)

### 5.1 Backup Staging Database
```bash
mysqldump -h <staging-host> -u <user> -p mas_hrms > mas_hrms_backup_$(date +%Y%m%d_%H%M%S).sql
```

### 5.2 Check Migration Manifest
```bash
grep -A 10 "MIGRATION_MANIFEST" backend/src/db/runPendingMigrations.ts | tail -12
```

**Expected:** Lines 227-236 present

### 5.3 Run Migrations on Staging
```bash
cd backend
DB_HOST=<staging-host> DB_NAME=mas_hrms DB_USER=<user> DB_PASSWORD=<pw> npm start
```

**Monitor logs for:**
```
[migration] applied: 227_week_off_preference_schema_fix.sql
[migration] applied: 228_wfm_roster_assignment_lifecycle.sql
[migration] applied: 229_roster_decision_audit_extension.sql
[migration] applied: 230_attendance_reconciliation_rta_linkage.sql
[migration] applied: 231_process_master_workload_type.sql
[migration] applied: 232_wfm_process_planning_rule.sql
[migration] applied: 233_wfm_slot_requirement.sql
[migration] applied: 234_process_weekoff_day_rule.sql
[migration] applied: 235_soft_delete_wfm_planning_tables.sql
[migration] applied: 236_add_rejected_request_decision_type.sql
```

### 5.4 Verify Schema Changes
```sql
-- Check wfm_roster_assignment added columns
SHOW COLUMNS FROM wfm_roster_assignment LIKE 'final_roster_status';
SHOW COLUMNS FROM wfm_roster_assignment LIKE 'employee_ack_status';

-- Check new tables exist
SHOW TABLES LIKE 'wfm_process_planning_rule';
SHOW TABLES LIKE 'wfm_slot_requirement';
SHOW TABLES LIKE 'process_weekoff_day_rule';

-- Check roster_decision_audit ENUM
SHOW COLUMNS FROM roster_decision_audit LIKE 'decision_type';
-- Should include 'manager_rejected_request'

-- Check soft delete columns
SHOW COLUMNS FROM wfm_slot_requirement LIKE 'is_active';
SHOW COLUMNS FROM wfm_slot_requirement LIKE 'deleted_by';
```

**If migration fails:** Review error, check rollback SQL in migration file, restore from backup

---

## Gate 6: API Smoke Tests

### 6.1 Start Backend Server (Staging)
```bash
cd backend
npm start
# Or: pm2 start ecosystem.config.js --env staging
```

**Wait for:** `Server listening on port 4000`

### 6.2 Get Admin JWT Token
```bash
# Login as admin user
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"<password>"}'

# Extract token from response
TOKEN="<jwt_token_here>"
```

### 6.3 Test Planning Rules Endpoints
```bash
# List planning rules (should return empty array or existing rules)
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/wfm/planning-rules?processId=<existing_process_uuid>"

# Expected: {"success":true,"data":[]}

# Calculate HC (pure function, no DB write)
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/planning-rules/calculate \
  -d '{"workload_type":"inbound_voice","forecast_calls":500,"aht_seconds":300,"shrinkage_pct":20}'

# Expected: {"success":true,"data":{"productive_hc":6,"planned_hc":7,"calculation_method":"erlang_lite",...}}
```

### 6.4 Test Slot Requirements Endpoints
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/wfm/slot-requirements?processId=<uuid>&fromDate=2026-06-23&toDate=2026-06-29"

# Expected: {"success":true,"data":[]}
```

### 6.5 Test Week-Off Day Rules Endpoints
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/wfm/weekoff/day-rules?processId=<uuid>"

# Expected: {"success":true,"data":[]}

curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/wfm/weekoff/day-rules/capacity-grid?processId=<uuid>&weekStartDate=2026-06-23"

# Expected: {"success":true,"data":[7 day objects with is_safe boolean]}
```

### 6.6 Test Employee Self-Service Endpoints
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/wfm/my-weekoff

# Expected: {"success":true,"data":[]}
```

### 6.7 Test Manager Review Endpoints
```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:4000/api/wfm/manager/weekoff-review

# Expected: {"success":true,"data":[]}
```

### 6.8 Test RTA Final Roster Endpoint
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/rta/final-roster-state?date=2026-06-25"

# Expected: {"success":true,"data":[]}
```

**All 9 endpoints should return 200 status with {"success":true} shape**

**If any endpoint fails:**
- 401: Token invalid or expired
- 403: Role access issue
- 404: Route not registered
- 500: Server error (check logs)

---

## Gate 7: Manager Scope Authorization Test

### 7.1 Create Test Data
```sql
-- Create manager user (role=manager)
INSERT INTO auth_user (id, email, role) VALUES ('test-mgr-001', 'test-mgr@example.com', 'manager');

-- Create manager employee record
INSERT INTO employees (id, employee_code, first_name, user_id) VALUES ('EMP-MGR-001', 'M001', 'Test Manager', 'test-mgr-001');

-- Create team member under manager
INSERT INTO employees (id, employee_code, first_name, reporting_manager_id) VALUES ('EMP-TEAM-001', 'T001', 'Team Member', 'EMP-MGR-001');

-- Create employee NOT under manager
INSERT INTO employees (id, employee_code, first_name) VALUES ('EMP-OTHER-001', 'O001', 'Other Employee');

-- Create test roster assignment for OTHER employee (NOT manager's team)
INSERT INTO wfm_roster_assignment (id, employee_id, roster_date, process_name, final_roster_status)
VALUES ('test-assign-001', 'EMP-OTHER-001', '2026-06-25', 'Test Process', 'rejected_by_employee');
```

### 7.2 Get Manager Token
```bash
# Login as test manager
curl -X POST http://localhost:4000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"test-mgr@example.com","password":"<password>"}'

MGR_TOKEN="<manager_jwt>"
```

### 7.3 Attempt Unauthorized Action
```bash
# Try to force-approve assignment for OTHER employee (not in manager's team)
curl -X POST -H "Authorization: Bearer $MGR_TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/manager/weekoff-review/test-assign-001/force-approve \
  -d '{"reason":"Test unauthorized action"}'

# Expected: 403 {"error":"Not authorized to act on this employee"}
```

**If returns 200:** SECURITY VULNERABILITY — scope check not working

### 7.4 Cleanup Test Data
```sql
DELETE FROM wfm_roster_assignment WHERE id = 'test-assign-001';
DELETE FROM employees WHERE id IN ('EMP-MGR-001', 'EMP-TEAM-001', 'EMP-OTHER-001');
DELETE FROM auth_user WHERE id = 'test-mgr-001';
```

---

## Gate 8: RTA Status Filter Test

### 8.1 Create Test Assignments
```sql
-- Insert test employee
INSERT INTO employees (id, employee_code, first_name) VALUES ('EMP-RTA-TEST', 'R001', 'RTA Test');

-- Insert DRAFT assignment (should NOT appear in RTA)
INSERT INTO wfm_roster_assignment (id, employee_id, roster_date, process_name, final_roster_status)
VALUES ('rta-test-draft', 'EMP-RTA-TEST', '2026-06-26', 'Test Process', 'pending_employee_ack');

-- Insert FINAL assignment (SHOULD appear in RTA)
INSERT INTO wfm_roster_assignment (id, employee_id, roster_date, process_name, final_roster_status)
VALUES ('rta-test-final', 'EMP-RTA-TEST', '2026-06-26', 'Test Process', 'approved_final');
```

### 8.2 Query RTA Endpoint
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/rta/final-roster-state?date=2026-06-26"
```

### 8.3 Verify Response
```json
{
  "success": true,
  "data": [
    {
      "employee_id": "EMP-RTA-TEST",
      "final_roster_status": "approved_final",
      ...
    }
  ]
}
```

**Expected:** Only 1 row with `final_roster_status='approved_final'`  
**Draft assignment with `pending_employee_ack` should NOT appear**

**If draft appears:** RTA WHERE clause not correctly tightened

### 8.4 Cleanup
```sql
DELETE FROM wfm_roster_assignment WHERE id IN ('rta-test-draft', 'rta-test-final');
DELETE FROM employees WHERE id = 'EMP-RTA-TEST';
```

---

## Gate 9: E2E WFM Lifecycle Test

### 9.1 Setup Test Process
```sql
-- Verify test process exists
SELECT id, process_name FROM process_master WHERE process_name = 'Test WFM Process' LIMIT 1;
-- If not exists, create one
INSERT INTO process_master (id, process_name, process_code) VALUES (UUID(), 'Test WFM Process', 'TWP');
```

### 9.2 Create Planning Rule
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/planning-rules \
  -d '{
    "process_id": "<process_uuid>",
    "workload_type": "inbound_voice",
    "effective_from": "2026-06-23",
    "aht_seconds": 300,
    "shrinkage_pct": 20
  }'

# Expected: {"success":true,"data":{...}}
# Save planning rule ID
```

### 9.3 Create Slot Requirement
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/slot-requirements \
  -d '{
    "process_id": "<process_uuid>",
    "requirement_date": "2026-06-27",
    "slot_start": "09:00",
    "slot_end": "17:00",
    "workload_type": "inbound_voice",
    "forecast_calls": 500
  }'

# Expected: {"success":true,"data":{"id":"<slot_id>",...}}
```

### 9.4 Calculate HC
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/slot-requirements/calculate \
  -d '{"slotId": "<slot_id>"}'

# Expected: {"success":true,"data":{"required_planned_hc":7,...}}
```

### 9.5 Verify HC Stored
```sql
SELECT required_productive_hc, required_planned_hc, calculation_method
  FROM wfm_slot_requirement
 WHERE id = '<slot_id>';

-- Expected: required_planned_hc = 7, calculation_method = 'erlang_lite'
```

### 9.6 Create Week-Off Rule
```bash
curl -X POST -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/weekoff/day-rules \
  -d '{
    "process_id": "<process_uuid>",
    "week_start_date": "2026-06-23",
    "min_hc_friday": 5,
    "fcfs_enabled": 1
  }'

# Expected: {"success":true,"data":{...}}
```

### 9.7 Create Test Roster Assignment (Manual)
```sql
INSERT INTO wfm_roster_assignment (id, employee_id, roster_date, process_name, final_roster_status, is_week_off)
VALUES (UUID(), '<test_employee_id>', '2026-06-27', 'Test WFM Process', 'pending_employee_ack', 1);
-- Save assignment ID
```

### 9.8 Employee Acknowledge (via API)
```bash
# Get employee token (or use admin impersonation)
curl -X POST -H "Authorization: Bearer $EMP_TOKEN" \
  http://localhost:4000/api/wfm/my-weekoff/<assignment_id>/acknowledge

# Expected: {"success":true,"message":"Week-off acknowledged"}
```

### 9.9 Verify Status Change
```sql
SELECT final_roster_status, employee_ack_status
  FROM wfm_roster_assignment
 WHERE id = '<assignment_id>';

-- Expected: final_roster_status = 'acknowledged', employee_ack_status = 'acknowledged'
```

### 9.10 Manager Reject Request
```bash
curl -X POST -H "Authorization: Bearer $MGR_TOKEN" -H "Content-Type: application/json" \
  http://localhost:4000/api/wfm/manager/weekoff-review/<assignment_id>/reject-request \
  -d '{"reason":"Test E2E flow - manager reject"}'

# Expected: {"success":true,"message":"Employee request rejected..."}
```

### 9.11 Verify Audit Log
```sql
SELECT decision_type, rule_applied, override_reason, acted_by_role
  FROM roster_decision_audit
 WHERE employee_id = '<test_employee_id>'
   AND roster_date = '2026-06-27'
 ORDER BY override_at DESC
 LIMIT 1;

-- Expected: decision_type = 'manager_rejected_request', acted_by_role = 'manager'
```

### 9.12 Publish Final Roster (Set to published status manually for test)
```sql
UPDATE wfm_roster_assignment
   SET final_roster_status = 'published_to_rta',
       published_to_rta_at = NOW()
 WHERE id = '<assignment_id>';
```

### 9.13 RTA Read Final State
```bash
curl -H "Authorization: Bearer $TOKEN" \
  "http://localhost:4000/api/rta/final-roster-state?date=2026-06-27"

# Expected: Assignment appears with final_roster_status='published_to_rta'
```

### 9.14 Cleanup E2E Test Data
```sql
DELETE FROM roster_decision_audit WHERE employee_id = '<test_employee_id>';
DELETE FROM wfm_roster_assignment WHERE id = '<assignment_id>';
DELETE FROM wfm_slot_requirement WHERE id = '<slot_id>';
DELETE FROM process_weekoff_day_rule WHERE process_id = '<process_uuid>';
DELETE FROM wfm_process_planning_rule WHERE process_id = '<process_uuid>';
```

**E2E Test PASS if all 13 steps succeed**

---

## Gate 10: Production Deployment

### 10.1 Pre-Deployment Checklist
- [ ] All gates 1-9 passed on staging
- [ ] Backup production database
- [ ] Deployment window scheduled
- [ ] Rollback plan documented
- [ ] Team notified

### 10.2 Production Database Backup
```bash
mysqldump -h <prod-host> -u <user> -p mas_hrms > mas_hrms_prod_backup_$(date +%Y%m%d_%H%M%S).sql
```

### 10.3 Deploy Backend
```bash
# Pull latest code
git pull origin main

# Install dependencies
cd backend
npm install --save-dev @types/express @types/cors @types/nodemailer @types/bcryptjs @types/node @types/handlebars
npm install

# Build
npm run build

# Restart backend (zero-downtime if using PM2)
pm2 reload ecosystem.config.js --env production
```

### 10.4 Run Production Migrations
```bash
# Migrations auto-run on backend start
# Monitor logs:
pm2 logs backend --lines 50 | grep migration

# Or manual trigger if needed:
DB_HOST=<prod-host> DB_NAME=mas_hrms DB_USER=<user> DB_PASSWORD=<pw> node dist/db/runPendingMigrations.js
```

### 10.5 Deploy Frontend
```bash
cd ..
npm install --legacy-peer-deps
npm run build

# Deploy dist/ to Vercel/hosting
vercel --prod
# Or: rsync dist/ to CDN
```

### 10.6 Smoke Test Production
```bash
# Test 3 critical endpoints
curl https://api.yourapp.com/api/wfm/planning-rules?processId=<uuid>
curl https://api.yourapp.com/api/wfm/my-weekoff
curl https://api.yourapp.com/api/rta/final-roster-state?date=2026-06-25

# All should return 200 with {"success":true}
```

### 10.7 Monitor for Errors
```bash
# Watch backend logs for 10 minutes
pm2 logs backend --lines 100

# Check for:
# - Migration errors
# - 500 errors
# - Authentication failures
# - Database connection errors
```

### 10.8 Rollback Plan (if production issues)
```bash
# Stop backend
pm2 stop backend

# Restore database from backup
mysql -h <prod-host> -u <user> -p mas_hrms < mas_hrms_prod_backup_<timestamp>.sql

# Revert to previous code
git reset --hard <previous-commit-sha>
npm run build
pm2 start ecosystem.config.js --env production
```

---

## Gate Results Summary

**Record results:**

| Gate | Status | Notes |
|---|---|---|
| 1. Backend deps | ⬜ PASS / FAIL | |
| 2. Backend build | ⬜ PASS / FAIL | Error count: |
| 3. Frontend build | ⬜ PASS / FAIL | |
| 4. MySQL version | ⬜ PASS / FAIL | Version: |
| 5. Migration dry-run | ⬜ PASS / FAIL | |
| 6. API smoke tests | ⬜ PASS / FAIL | Failed endpoints: |
| 7. Manager scope test | ⬜ PASS / FAIL | |
| 8. RTA filter test | ⬜ PASS / FAIL | |
| 9. E2E lifecycle | ⬜ PASS / FAIL | |
| 10. Prod deployment | ⬜ PASS / FAIL | |

**Final Status:** ⬜ GO / NO-GO

**Sign-Off:**
- Engineer: __________________ Date: __________
- QA Lead: ___________________ Date: __________
- Product Owner: _____________ Date: __________

---

**Checklist Complete**
