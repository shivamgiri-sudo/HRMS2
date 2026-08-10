# MVP Final Validation Runbook — Comprehensive Server/CI Release Gate

**Date:** 2026-06-20  
**Status:** 🚫 **NO-GO — LOCAL ENVIRONMENT VALIDATION BLOCKER**  
**Reason:** Backend npm install stuck on @types packages on local system  
**Validation Environment:** Server/CI execution required  
**Repository:** https://github.com/shivamgiri-sudo/HRMS1.git  
**Branch:** main (commit 7a347a6)

---

## Current Implementation Status

### ✅ Complete

- **WFM Auto Roster MVP** — 10 migrations (223-236), 4 services, 26 API endpoints, 4 UI pages
- **Attendance Dispute MVP** — 2 migrations (237-238), 5 API endpoints, 1 UI page
- **Payroll Head Manual Override MVP** — API endpoints, 1 UI page
- **Audit Log + CSV Export MVP** — 2 API endpoints, 1 UI page
- **Backend static validation** — 0 TypeScript errors on new code
- **Frontend static validation** — 0 TypeScript errors on new routes/pages
- **Git status** — All code committed to `main` (commit: 5c366ec)

### ⏸️ Blocked (Local Machine)

- Backend npm install
- Backend build
- Frontend build
- API smoke tests
- E2E tests

### ❌ Not Approved

- Production deployment
- Production migrations
- PM2 restart
- Production database access

---

## Phase 1: Backend Build Verification

Run on server/CI environment where npm works.

### 1.1 Install dependencies

```bash
cd backend
npm install --legacy-peer-deps --no-audit --no-fund
```

**Expected:** Completes without hanging on @types packages  
**Actual:** [_______________]  
**Pass/Fail:** ☐ PASS ☐ FAIL

If install hangs, try explicit @types install:

```bash
npm install --save-dev @types/express @types/cors @types/bcryptjs @types/nodemailer @types/node --legacy-peer-deps --no-audit --no-fund
```

### 1.2 Build backend

```bash
npm run build
```

**Expected:** 0 errors, 0 warnings  
**Actual Error Count:** [___]  
**Actual Warning Count:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

**Files with errors (if any):**

```
[List file paths with line numbers]
```

### 1.3 Verify new WFM/Attendance files compiled

```bash
ls -la dist/modules/wfm/hcCalculation.service.js
ls -la dist/modules/wfm/planningRule.service.js
ls -la dist/modules/wfm/slotRequirement.service.js
ls -la dist/modules/wfm/weekoffDayRule.service.js
ls -la dist/modules/attendance/attendance.dispute.routes.js
ls -la dist/modules/attendance/attendance.manual-override.routes.js
ls -la dist/modules/audit/audit.log.routes.js
```

**All files present?** ☐ YES ☐ NO

---

## Phase 2: Frontend Build Verification

Run on server with working npm.

### 2.1 Install frontend dependencies

```bash
cd ..
npm install --legacy-peer-deps --no-audit --no-fund
```

**Expected:** Completes without hanging  
**Actual:** [_______________]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 2.2 Build frontend

```bash
npm run build
```

**Expected:** 0 errors  
**Actual Error Count:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 2.3 Verify new routes in bundle

Check that `/attendance/disputes`, `/payroll/attendance-overrides`, `/audit-log` routes are in bundle (lazy-loaded):

```bash
grep -r "NativeAttendanceDisputes\|NativePayrollAttendanceOverrides\|NativeAuditLog" dist/
```

**Routes found?** ☐ YES ☐ NO

---

## Phase 3: Database Migration Validation

**⚠️ CRITICAL: Use staging/local DB only. Do NOT run on production.**

### 3.1 Check MySQL version

```sql
SELECT VERSION();
```

**Expected:** MySQL 8.0.16 or higher  
**Actual:** [_______________]  
**Compatible?** ☐ YES ☐ NO

If MySQL < 8.0.16, migrations will fail (use `ADD COLUMN IF NOT EXISTS` syntax).

### 3.2 Dry-run WFM migrations

**File:** `backend/sql/223_wfm_roster_decision_engine.sql` through `236_add_rejected_request_decision_type.sql`

```bash
cd backend/sql
for i in {223..236}; do
  echo "Checking migration $i..."
  mysql -u root -p mas_hrms < ${i}_*.sql --verbose
done
```

Or manually:

```bash
mysql -u root -p mas_hrms < 223_wfm_roster_decision_engine.sql
mysql -u root -p mas_hrms < 224_wfm_notification_templates.sql
# ... through 236
```

| Migration | File | Status | Rollback Verified |
|-----------|------|--------|-------------------|
| 223 | `223_wfm_roster_decision_engine.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 224 | `224_wfm_notification_templates.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 225 | `225_employee_shift_rotation_type.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 226 | `226_wfm_bulk_upload_templates.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 227 | `227_week_off_preference_schema_fix.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 228 | `228_wfm_roster_assignment_lifecycle.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 229 | `229_roster_decision_audit_extension.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 230 | `230_attendance_reconciliation_rta_linkage.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 231 | `231_process_master_workload_type.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 232 | `232_wfm_process_planning_rule.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 233 | `233_wfm_slot_requirement.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 234 | `234_process_weekoff_day_rule.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 235 | `235_soft_delete_wfm_planning_tables.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 236 | `236_add_rejected_request_decision_type.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |

### 3.3 Dry-run Attendance migrations

**File:** `backend/sql/237_attendance_dispute_schema.sql`, `238_attendance_manual_override.sql`

```bash
mysql -u root -p mas_hrms < 237_attendance_dispute_schema.sql
mysql -u root -p mas_hrms < 238_attendance_manual_override.sql
```

| Migration | File | Status | Rollback Verified |
|-----------|------|--------|-------------------|
| 237 | `237_attendance_dispute_schema.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |
| 238 | `238_attendance_manual_override.sql` | ☐ Applied ☐ Failed | ☐ Yes ☐ No |

### 3.4 Verify new columns exist

```sql
-- Dispute schema columns
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME='attendance_regularization' AND COLUMN_NAME IN ('dispute_type', 'old_status', 'new_status', 'payroll_impact');

-- Manual override table
SELECT TABLE_NAME FROM INFORMATION_SCHEMA.TABLES 
WHERE TABLE_NAME='attendance_manual_override' AND TABLE_SCHEMA='mas_hrms';

-- Audit log columns
SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS 
WHERE TABLE_NAME='sensitive_action_log' AND COLUMN_NAME IN ('old_value_json', 'new_value_json', 'employee_id', 'actor_role', 'reason');
```

**All columns exist?** ☐ YES ☐ NO

---

## Phase 4: API Smoke Tests

Start backend server:

```bash
cd backend
npm run dev
```

Expected: Server listens on `http://localhost:3000`

Use curl or Postman with auth token from test user.

### 4.1 WFM Planning Rules

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/wfm/planning-rules` | GET | wfm | 200 | [___] | ☐ |
| `/api/wfm/planning-rules` | POST | wfm | 201 | [___] | ☐ |
| `/api/wfm/planning-rules/:id` | PATCH | wfm | 200 | [___] | ☐ |
| `/api/wfm/planning-rules/:id` | DELETE | wfm | 204 | [___] | ☐ |

**Sample POST /api/wfm/planning-rules:**

```bash
curl -X POST http://localhost:3000/api/wfm/planning-rules \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "process_id": "proc-001",
    "workload_type": "inbound_voice",
    "service_level_target": 80,
    "aht_seconds": 300,
    "shrinkage_pct": 20,
    "notes": "Test planning rule"
  }'
```

**Expected Response:** 201 with `{ success: true, data: {...} }`  
**Actual:** [_______________]

### 4.2 WFM Slot Requirements

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/wfm/slot-requirements` | GET | wfm | 200 | [___] | ☐ |
| `/api/wfm/slot-requirements` | POST | wfm | 201 | [___] | ☐ |
| `/api/wfm/slot-requirements/:id` | GET | wfm | 200 | [___] | ☐ |

### 4.3 WFM Week-Off Rules

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/wfm/weekoff/day-rules` | GET | wfm | 200 | [___] | ☐ |
| `/api/wfm/weekoff/day-rules` | POST | wfm | 201 | [___] | ☐ |
| `/api/wfm/weekoff/day-rules/:id` | DELETE | wfm | 204 or 200 | [___] | ☐ |

### 4.4 RTA Final Roster State

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/rta/final-roster-state` | GET | admin | 200 | [___] | ☐ |

**Response must exclude draft statuses:**

```bash
curl http://localhost:3000/api/rta/final-roster-state \
  -H "Authorization: Bearer <TOKEN>" | jq '.data[].final_roster_status'
```

**Expected values ONLY:** `approved_final`, `force_approved_by_manager`, `realigned_by_manager`, `published_to_rta`  
**Any other status present?** ☐ NO (PASS) ☐ YES (FAIL)

### 4.5 Attendance Disputes

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/attendance/disputes` | GET | employee | 200 | [___] | ☐ |
| `/api/attendance/disputes/:id` | GET | manager | 200 | [___] | ☐ |
| `/api/attendance/disputes/:id/manager-action` | POST | manager | 200 | [___] | ☐ |
| `/api/attendance/disputes/:id/hr-action` | POST | hr | 200 | [___] | ☐ |
| `/api/attendance/disputes/:id/payroll-action` | POST | payroll_head | 200 | [___] | ☐ |

### 4.6 Manual Attendance Overrides

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/attendance/manual-overrides` | POST | payroll_head | 201 | [___] | ☐ |
| `/api/attendance/manual-overrides` | GET | payroll_head | 200 | [___] | ☐ |
| `/api/attendance/manual-overrides/:id` | GET | payroll_head | 200 | [___] | ☐ |
| `/api/attendance/manual-overrides/:id/approve` | POST | super_admin | 200 | [___] | ☐ |
| `/api/attendance/manual-overrides/:id/reject` | POST | payroll_head | 200 | [___] | ☐ |

### 4.7 Audit Log

| Endpoint | Method | Token Role | Expected | Actual | Pass |
|----------|--------|-----------|----------|--------|------|
| `/api/access/audit-log?fromDate=2026-06-01` | GET | admin | 200 | [___] | ☐ |
| `/api/access/audit-log?actorRole=wfm` | GET | admin | 200 | [___] | ☐ |
| `/api/audit/export` | POST | admin | 200 + CSV | [___] | ☐ |

**Sample export:**

```bash
curl -X POST http://localhost:3000/api/audit/export \
  -H "Authorization: Bearer <TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "fromDate": "2026-06-01", "toDate": "2026-06-30" }' \
  --output audit.csv
```

**Expected:** CSV file with header row + audit events  
**Actual:** [_______________]

---

## Phase 5: Security & Access Control Tests

### 5.1 Manager Cannot Act Outside Mapped Employees

**Setup:**
- Manager A mapped to Employee E1 only
- Employee E2 under different manager

**Test:**

```bash
curl -X POST http://localhost:3000/api/attendance/disputes/<E2_DISPUTE_ID>/manager-action \
  -H "Authorization: Bearer <MANAGER_A_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "action": "approve", "reason": "Test" }'
```

**Expected:** 403 Forbidden  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 5.2 HR/WFM Cannot Perform Payroll Manual Override

**Test:**

```bash
curl -X POST http://localhost:3000/api/attendance/manual-overrides \
  -H "Authorization: Bearer <HR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "employee_id": "emp-001", "attendance_date": "2026-06-15", "new_status": "present", "reason": "Test override" }'
```

**Expected:** 403 Forbidden  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 5.3 Payroll Head Cannot Approve Locked-Month Override Unless Super Admin

**Setup:**
- Create manual override with `is_payroll_month_locked = 1`
- Payroll Head tries to approve

**Test:**

```bash
curl -X POST http://localhost:3000/api/attendance/manual-overrides/<OVERRIDE_ID>/approve \
  -H "Authorization: Bearer <PAYROLL_HEAD_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Approved" }'
```

**Expected:** 403 "Only Super Admin can approve locked-month..."  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

**Super Admin approves same override:**

```bash
curl -X POST http://localhost:3000/api/attendance/manual-overrides/<OVERRIDE_ID>/approve \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{ "reason": "Approved by Super Admin" }'
```

**Expected:** 200 Approved  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 5.4 Employee Cannot View Global Audit Log

**Test:**

```bash
curl http://localhost:3000/api/access/audit-log \
  -H "Authorization: Bearer <EMPLOYEE_TOKEN>"
```

**Expected:** 403 Forbidden  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 5.5 Manager Cannot Export Audit Log

**Test:**

```bash
curl -X POST http://localhost:3000/api/audit/export \
  -H "Authorization: Bearer <MANAGER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Expected:** 403 Forbidden  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS ☐ FAIL

### 5.6 RTA Does Not Show Draft Roster

**Setup:** Create roster with status `pending_employee_ack` or `generated`

**Test:**

```bash
curl http://localhost:3000/api/rta/final-roster-state \
  -H "Authorization: Bearer <TOKEN>" | jq '.data | length'
```

**Expected:** Records count excludes draft statuses  
**Query:** 

```sql
SELECT COUNT(*) FROM wfm_roster_assignment 
WHERE final_roster_status IN ('pending_employee_ack', 'generated', 'pending_manager_action', 'rejected_by_employee');
```

**Count in API response:** [___]  
**Count in DB (should be excluded):** [___]  
**Pass/Fail:** ☐ PASS (excluded) ☐ FAIL (included)

### 5.7 Manual Override Create Does NOT Update Attendance_Daily_Record

**Test:**

```bash
# Get employee's current attendance status
SELECT attendance_status FROM attendance_daily_record 
WHERE employee_id = 'emp-001' AND record_date = '2026-06-15';
# Current status: [________]

# Create override requesting new status
curl -X POST http://localhost:3000/api/attendance/manual-overrides \
  -H "Authorization: Bearer <PAYROLL_HEAD_TOKEN>" \
  -d '{ "employee_id": "emp-001", "attendance_date": "2026-06-15", "new_status": "present", "reason": "Device failed" }'

# Check attendance_daily_record again
SELECT attendance_status FROM attendance_daily_record 
WHERE employee_id = 'emp-001' AND record_date = '2026-06-15';
# Status after create: [________]
```

**Expected:** Status unchanged after create  
**Actual:** [___]  
**Pass/Fail:** ☐ PASS (unchanged) ☐ FAIL (changed)

### 5.8 Manual Override Approve Updates Attendance_Daily_Record + Audit

**Test:**

```bash
# Approve the override
curl -X POST http://localhost:3000/api/attendance/manual-overrides/<OVERRIDE_ID>/approve \
  -H "Authorization: Bearer <SUPER_ADMIN_TOKEN>" \
  -d '{ "reason": "Approved" }'

# Check attendance_daily_record
SELECT attendance_status, old_attendance_status, status_changed_by 
FROM attendance_daily_record 
WHERE employee_id = 'emp-001' AND record_date = '2026-06-15';
# New status: [________]
# Old status captured: [________]
# Changed by: [________]

# Check audit log
SELECT action_type, new_value_json FROM sensitive_action_log 
WHERE entity_type = 'attendance_daily_record' AND employee_id = 'emp-001' 
ORDER BY acted_at DESC LIMIT 1;
# Action: [________]
# new_value_json shows new_status: [________]
```

**Expected:** 
- `attendance_status` changed to new value
- `old_attendance_status` captured
- `status_changed_by` set to approver
- Audit event `ATTENDANCE_RECORD_MANUALLY_OVERRIDDEN` created

**Pass/Fail:** ☐ PASS ☐ FAIL

---

## Phase 6: E2E Workflow Tests

### E2E Flow A: WFM Roster Workflow

| Step | Action | Expected | Actual | Pass |
|------|--------|----------|--------|------|
| 1 | Create planning rule (POST /api/wfm/planning-rules) | 201, rule created | [___] | ☐ |
| 2 | Create slot requirement (POST /api/wfm/slot-requirements) | 201, requirement created | [___] | ☐ |
| 3 | Calculate HC (GET /api/wfm/planning-rules/:id/calculate-hc) | 200, calculated HC returned | [___] | ☐ |
| 4 | Create week-off rule (POST /api/wfm/weekoff/day-rules) | 201, rule created | [___] | ☐ |
| 5 | Create roster assignment (POST /api/wfm/roster) | 201, assignment created | [___] | ☐ |
| 6 | Employee acknowledges (POST /api/wfm/roster/:id/ack) | 200, ack recorded | [___] | ☐ |
| 7 | Manager reviews (PATCH /api/wfm/roster/:id/review) | 200, review recorded | [___] | ☐ |
| 8 | Publish to RTA (POST /api/wfm/roster/:id/publish-to-rta) | 200, published | [___] | ☐ |
| 9 | RTA reads final roster (GET /api/rta/final-roster-state) | 200, published roster visible | [___] | ☐ |

### E2E Flow B: Attendance Dispute Workflow

| Step | Action | Expected | Actual | Pass |
|------|--------|----------|--------|------|
| 1 | Employee submits dispute (POST /api/wfm/regularizations) | 201, dispute created | [___] | ☐ |
| 2 | Manager views dispute (GET /api/attendance/disputes) | 200, dispute in manager queue | [___] | ☐ |
| 3 | Manager escalates (POST /api/attendance/disputes/:id/manager-action) | 200, escalated_to = 'hr' | [___] | ☐ |
| 4 | HR views dispute (GET /api/attendance/disputes) | 200, dispute in HR queue | [___] | ☐ |
| 5 | HR escalates to payroll (POST /api/attendance/disputes/:id/hr-action) | 200, escalated_to = 'payroll_head' | [___] | ☐ |
| 6 | Payroll Head approves (POST /api/attendance/disputes/:id/payroll-action) | 200, approved | [___] | ☐ |
| 7 | Attendance_daily_record updated (GET /api/wfm/attendance) | 200, status changed | [___] | ☐ |
| 8 | Audit log shows all actions (GET /api/access/audit-log?employeeId=...) | 200, 3+ audit events | [___] | ☐ |

### E2E Flow C: Payroll Head Manual Override Workflow

| Step | Action | Expected | Actual | Pass |
|------|--------|----------|--------|------|
| 1 | Payroll Head creates override (POST /api/attendance/manual-overrides) | 201, override created | [___] | ☐ |
| 2 | Override has is_payroll_month_locked = 0 (unlocked month) | ☐ YES | [___] | ☐ |
| 3 | Payroll Head approves (POST /api/attendance/manual-overrides/:id/approve) | 200, approved | [___] | ☐ |
| 4 | Attendance_daily_record updated (SELECT...) | status changed, old status captured | [___] | ☐ |
| 5 | Audit log shows override approved + record corrected (GET /api/access/audit-log) | 2 events: MANUAL_...APPROVED + ATTENDANCE_RECORD_MANUALLY_OVERRIDDEN | [___] | ☐ |
| 6 | Payroll Head creates override for locked month | 201, is_payroll_month_locked = 1 | [___] | ☐ |
| 7 | Payroll Head tries to approve (POST .../approve) | 403 "Only Super Admin..." | [___] | ☐ |
| 8 | Super Admin approves (POST .../approve) | 200, approved | [___] | ☐ |
| 9 | Attendance_daily_record updated | status changed | [___] | ☐ |

### E2E Flow D: Audit Export Workflow

| Step | Action | Expected | Actual | Pass |
|------|--------|----------|--------|------|
| 1 | Admin exports audit log (POST /api/audit/export) | 200, CSV file downloaded | [___] | ☐ |
| 2 | CSV has correct columns (header row) | acted_at, actor_user_id, actor_role, module_key, action_type, entity_type, entity_id, employee_id, reason, old_value_json, new_value_json | [___] | ☐ |
| 3 | CSV has data rows from recent actions | rows > 0 | [___] | ☐ |
| 4 | Export itself is audited (SELECT FROM sensitive_action_log WHERE action_type = 'AUDIT_LOG_EXPORTED') | 1 row created | [___] | ☐ |
| 5 | Payroll Head exports payroll-scoped audit (POST /api/audit/export with module=payroll) | 200, CSV with payroll events only | [___] | ☐ |
| 6 | Payroll Head tries to export attendance (POST /api/audit/export with module=wfm) | 403 or 200 with empty result | [___] | ☐ |

---

## Final Go/No-Go Decision Matrix

### All Must Pass

| Category | Test | Status | Blocker |
|----------|------|--------|---------|
| Build | Backend npm install | ☐ PASS ☐ FAIL | ❌ YES |
| Build | Backend npm run build | ☐ PASS ☐ FAIL | ❌ YES |
| Build | Frontend npm install | ☐ PASS ☐ FAIL | ❌ YES |
| Build | Frontend npm run build | ☐ PASS ☐ FAIL | ❌ YES |
| DB | MySQL 8.0.16+ | ☐ YES ☐ NO | ❌ YES |
| DB | Migration 227-236 dry-run | ☐ PASS ☐ FAIL | ❌ YES |
| DB | Migration 237-238 dry-run | ☐ PASS ☐ FAIL | ❌ YES |
| API | WFM planning rules (GET/POST/PATCH) | ☐ PASS ☐ FAIL | ❌ YES |
| API | WFM slot requirements (GET/POST) | ☐ PASS ☐ FAIL | ❌ YES |
| API | WFM week-off rules (GET/POST) | ☐ PASS ☐ FAIL | ❌ YES |
| API | RTA final roster state (GET, no draft) | ☐ PASS ☐ FAIL | ❌ YES |
| API | Attendance disputes (all 5 endpoints) | ☐ PASS ☐ FAIL | ❌ YES |
| API | Manual overrides (all 5 endpoints) | ☐ PASS ☐ FAIL | ❌ YES |
| API | Audit log & export | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Manager scope enforced | ☐ PASS ☐ FAIL | ❌ YES |
| Security | HR cannot override | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Locked month → super_admin only | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Employee cannot view audit | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Manager cannot export audit | ☐ PASS ☐ FAIL | ❌ YES |
| Security | RTA excludes draft | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Manual override create doesn't update | ☐ PASS ☐ FAIL | ❌ YES |
| Security | Manual override approve updates + audits | ☐ PASS ☐ FAIL | ❌ YES |
| E2E | WFM roster flow A | ☐ PASS ☐ FAIL | ❌ YES |
| E2E | Attendance dispute flow B | ☐ PASS ☐ FAIL | ❌ YES |
| E2E | Override locked flow C | ☐ PASS ☐ FAIL | ❌ YES |
| E2E | Audit export flow D | ☐ PASS ☐ FAIL | ❌ YES |

### Final Recommendation

**Count failures:**

- Build failures: [___]
- Migration failures: [___]
- API failures: [___]
- Security test failures: [___]
- E2E failures: [___]

**Total failures:** [___]

### Final Status

#### If all pass:

```
✅ GO FOR STAGING DEPLOYMENT

Code is production-ready. All MVP features validated.
Next: Deploy to staging environment, run production smoke tests.
Timeline: Ready for production deployment after staging sign-off.
```

#### If blockers remain:

```
❌ NO-GO

Blockers:
[List each failure with impact]

Action:
1. Fix blocked items
2. Re-run validation
3. Resubmit for approval
```

---

## Sign-Off

**Validation Date:** [_______________]  
**Validated By:** [_______________]  
**Environment:** [_______________]  

**Decision:** ☐ GO FOR STAGING ☐ GO FOR PRODUCTION ☐ NO-GO

**Signature:** ___________________________

**Notes:**

```
[Add any findings, workarounds, or recommendations here]
```

---

## Appendix: Rollback Procedures

### Rollback WFM Migrations

Each migration has rollback SQL in comments. Example:

```sql
-- Rollback migration 236
DROP TRIGGER IF EXISTS trg_amo_locked_month_check;
DROP TABLE IF EXISTS attendance_manual_override;
-- ... (see file for full rollback)
```

To rollback all migrations 223-238:

```bash
# Run in reverse order
mysql -u root -p mas_hrms < rollback_236.sql
mysql -u root -p mas_hrms < rollback_235.sql
# ... through rollback_223.sql
```

### Rollback Manual Changes

If deployment fails:

```bash
# Revert to commit before MVP
git revert <COMMIT_SHA>

# Restart backend
npm run build
npm run dev
```

---

**Document Version:** 1.0  
**Last Updated:** 2026-06-20  
**Status:** Ready for Server Validation
