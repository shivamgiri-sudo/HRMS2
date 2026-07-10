# Phase 2 Implementation Testing Guide

**Date:** 2026-07-10  
**Phase:** Smart Work Inbox / Universal Action Center  
**Status:** Backend Complete, Testing Guide

---

## Quick Testing Checklist

### ✅ Code Implementation Verification

**Backend Files Created/Modified:**
- ✅ `backend/src/modules/business-actions/business-actions.signal-sync.ts` - 4 new sync functions
- ✅ `backend/src/modules/business-actions/business-actions.routes.ts` - 4 new routes
- ✅ `backend/src/modules/ai/ai-insights.routes.ts` - AI explain endpoint
- ✅ `backend/src/cron/business-action-sync.cron.ts` - Scheduled jobs
- ✅ `backend/src/server.ts` - Cron registration

**Compilation:**
- ✅ TypeScript type check: PASSED
- ✅ Build: PASSED

**Git Status:**
- ✅ Committed: f4159ad1
- ✅ Documentation: PHASE2_SMART_WORK_INBOX_BACKEND_COMPLETE.md

---

## Manual Testing Steps

### Prerequisites

1. **Database Access**
   - MySQL connection to `mas_hrms` database
   - Tables exist: `business_action_queue`, `payroll_run`, `attendance_daily_record`, `ats_candidate`, `wfm_slot_requirement`

2. **Backend Running**
   ```bash
   cd backend
   npm run dev
   # Server should start on port 5055
   ```

3. **Authentication Token**
   - Get a valid JWT token from login
   - Or use demo token if `INTERNAL_DEMO_BYPASS=true` and `NODE_ENV != production`
   - Demo tokens: `mock-token-super-admin`, `mock-token-admin`, `mock-token-hr`

---

## Test 1: Payroll Readiness Sync

### API Call
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "count": 3,
    "message": "3 payroll actions synced",
    "details": {
      "scanned": 5,
      "created": 3,
      "skipped": 2
    }
  }
}
```

### Verification
```sql
-- Check created actions
SELECT id, source_module, risk_type, severity, title, status, created_at
FROM business_action_queue
WHERE source_module = 'payroll'
ORDER BY created_at DESC
LIMIT 10;

-- Verify deduplication
SELECT source_id, risk_type, COUNT(*) as count
FROM business_action_queue
WHERE source_module = 'payroll'
GROUP BY source_id, risk_type
HAVING count > 1;
-- Should return 0 rows (no duplicates)
```

### What Gets Synced
- Scans `payroll_run` table for active runs (`status IN ('draft', 'pending_approval')`)
- Calls `payrollGovernanceService.readiness(runId)` for each run
- Creates actions for blocker issues:
  - `MISSING_SALARY_ASSIGNMENT`
  - `MISSING_VERIFIED_BANK`
  - `NO_ATTENDANCE_RECORDS`
  - `UNRECONCILED_ATTENDANCE`
  - `ATTENDANCE_NOT_LOCKED`
  - `MISSING_PAN`
  - `MISSING_UAN`
  - `INCOMPLETE_JOINING_DOCUMENTS`

---

## Test 2: Attendance Gap Sync

### API Call
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/attendance \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "count": 12,
    "message": "12 attendance actions synced",
    "details": {
      "scanned": 15,
      "created": 12,
      "skipped": 3
    }
  }
}
```

### Verification
```sql
-- Check created actions
SELECT id, source_module, risk_type, severity, title, description, created_at
FROM business_action_queue
WHERE source_module = 'attendance'
ORDER BY created_at DESC
LIMIT 10;

-- Check which employees have unreconciled attendance
SELECT adr.employee_id, e.employee_code, COUNT(*) as unreconciled_days
FROM attendance_daily_record adr
JOIN employees e ON e.id = adr.employee_id
WHERE adr.attendance_status = 'unreconciled'
  AND adr.record_date < DATE_SUB(CURDATE(), INTERVAL 3 DAY)
  AND adr.is_locked = 0
  AND e.active_status = 1
GROUP BY adr.employee_id, e.employee_code
ORDER BY unreconciled_days DESC
LIMIT 10;
```

### What Gets Synced
- Scans `attendance_daily_record` for unreconciled records > 3 days old
- Groups by employee
- Creates one action per employee with:
  - Severity: high if > 7 days, medium if 3-7 days
  - Owner: reporting manager or HR
  - Title includes employee code and day count

---

## Test 3: Onboarding Stuck Sync

### API Call
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/onboarding \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "count": 5,
    "message": "5 onboarding actions synced",
    "details": {
      "scanned": 8,
      "created": 5,
      "skipped": 3
    }
  }
}
```

### Verification
```sql
-- Check created actions
SELECT id, source_module, risk_type, severity, title, description, created_at
FROM business_action_queue
WHERE source_module = 'onboarding'
ORDER BY created_at DESC
LIMIT 10;

-- Check stuck candidates
SELECT c.id, c.candidate_code, c.full_name, c.current_stage,
       TIMESTAMPDIFF(HOUR, c.created_at, NOW()) as age_hours
FROM ats_candidate c
WHERE c.current_stage IN ('bgv_pending', 'onboarding_pending', 'document_pending')
  AND c.active_status = 1
  AND TIMESTAMPDIFF(HOUR, c.created_at, NOW()) > 48
ORDER BY age_hours DESC
LIMIT 10;
```

### What Gets Synced
- Scans `ats_candidate` for stuck candidates in onboarding stages
- Candidates stuck > 48 hours trigger actions
- Severity: high if > 7 days (168 hours), medium otherwise
- Owner: HR role

---

## Test 4: Roster Shortage Sync

### API Call
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/roster \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json"
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "count": 2,
    "message": "2 roster actions synced",
    "details": {
      "scanned": 7,
      "created": 2,
      "skipped": 5
    }
  }
}
```

### Verification
```sql
-- Check created actions
SELECT id, source_module, risk_type, severity, title, description, due_date, created_at
FROM business_action_queue
WHERE source_module = 'roster'
ORDER BY created_at DESC
LIMIT 10;

-- Check roster shortages
SELECT wsr.requirement_date, wsr.process_id, p.process_name,
       wsr.required_hc, COUNT(DISTINCT ra.employee_id) AS planned_hc,
       wsr.required_hc - COUNT(DISTINCT ra.employee_id) AS shortage
FROM wfm_slot_requirement wsr
JOIN process p ON p.id = wsr.process_id
LEFT JOIN roster_assignment ra
  ON ra.roster_date = wsr.requirement_date
  AND ra.process_id = wsr.process_id
WHERE wsr.requirement_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY)
GROUP BY wsr.requirement_date, wsr.process_id, p.process_name, wsr.required_hc
HAVING shortage > 0
ORDER BY shortage DESC, wsr.requirement_date ASC;
```

### What Gets Synced
- Scans `wfm_slot_requirement` for next 7 days
- Compares required HC vs planned HC from `roster_assignment`
- Creates actions for shortages with:
  - Severity: critical if > 10, high if 5-10, medium if < 5
  - Due date: shortage date
  - Owner: operations role

---

## Test 5: AI Explain Action

### Get an Action ID First
```bash
# Get first action ID
curl -s http://localhost:5055/api/business-actions?limit=1 \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  | grep -o '"id":"[^"]*"' | head -1 | cut -d'"' -f4
```

### API Call
```bash
curl -X POST http://localhost:5055/api/ai/explain-action \
  -H "Authorization: Bearer <YOUR_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{"action_id": "<ACTION_ID_FROM_ABOVE>"}'
```

### Expected Response
```json
{
  "success": true,
  "data": {
    "explanation": "This action exists because 7 employees have unresolved attendance exceptions that are more than 3 days old. If not resolved, these employees cannot be processed for payroll and may face salary delays. The recommended next step is to review each employee's attendance records in the Attendance Exception Engine and reconcile discrepancies with their reporting managers.",
    "insights": [],
    "actions": [],
    "provider": "gemini",
    "model": "gemini-flash",
    "safe_mode": true,
    "fallback_used": false,
    "data_confidence": {},
    "generated_at": "2026-07-10T15:45:00+05:30"
  }
}
```

### Verification
```sql
-- Check AI usage log
SELECT *
FROM ai_provider_usage_log
WHERE request_source = 'explain_action'
ORDER BY created_at DESC
LIMIT 5;

-- Check prompt audit
SELECT *
FROM ai_prompt_audit_log
ORDER BY created_at DESC
LIMIT 5;
```

### What Happens
1. Fetches business action from `business_action_queue`
2. Builds sanitized context (no PII):
   - Payroll: blocked_count, blocker_type
   - Attendance: unreconciled_days
   - Onboarding: stuck_days, stage
   - Roster: shortage
3. Calls active AI provider (Gemini or rule-based)
4. Returns explanation with next steps
5. Logs usage and audit trail

---

## Test 6: Scheduled Jobs

### Enable Schedulers
```bash
# In backend/.env
ENABLE_SCHEDULERS=true
```

### Start Backend
```bash
cd backend
npm run dev
```

### Check Logs
```bash
# Look for initialization logs
grep "CRON" backend/logs/server.log

# Or check console output
# Should see:
# [CRON] Initializing business action sync jobs...
# [CRON] Business action sync jobs initialized
# [CRON] - Payroll readiness: Daily 7 AM IST
# [CRON] - Attendance gaps: Daily 6 AM IST
# [CRON] - Onboarding stuck: Every 6 hours
# [CRON] - Roster shortages: Daily 9 AM IST
```

### Wait for Next Scheduled Run
- Payroll: Next 7 AM IST
- Attendance: Next 6 AM IST
- Onboarding: Every 6 hours from server start
- Roster: Next 9 AM IST

### Verify Execution
```bash
# Check logs for execution
grep "CRON.*sync complete" backend/logs/server.log

# Check database
SELECT source_module, COUNT(*) as action_count, MAX(created_at) as last_created
FROM business_action_queue
WHERE created_by = 'system'
GROUP BY source_module;
```

---

## Test 7: Deduplication

### Run Same Sync Twice
```bash
# First run
curl -X POST http://localhost:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer <YOUR_TOKEN>"

# Second run immediately
curl -X POST http://localhost:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

### Expected Result
- First run: `created: N, skipped: 0`
- Second run: `created: 0, skipped: N`

### Verification
```sql
-- Should return 0 rows (no duplicates)
SELECT source_module, source_id, risk_type, COUNT(*) as dup_count
FROM business_action_queue
WHERE source_module IN ('payroll', 'attendance', 'onboarding', 'roster')
  AND status NOT IN ('completed', 'cancelled')
GROUP BY source_module, source_id, risk_type
HAVING dup_count > 1;
```

---

## Test 8: Role-Based Access

### Test Unauthorized Access
```bash
# Try payroll sync with employee token (should fail)
curl -X POST http://localhost:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer mock-token" \
  -H "Content-Type: application/json"
```

### Expected Response
```json
{
  "success": false,
  "message": "Forbidden: insufficient permissions"
}
```

### Role Access Matrix
| Endpoint | Allowed Roles |
|----------|---------------|
| `/sync-signals/payroll` | super_admin, admin, payroll_hr |
| `/sync-signals/attendance` | super_admin, admin, hr, wfm |
| `/sync-signals/onboarding` | super_admin, admin, hr |
| `/sync-signals/roster` | super_admin, admin, operations, wfm |
| `/explain-action` | All authenticated users |

---

## Test 9: PII Safety

### What Gets Sent to AI
```javascript
// Sanitized context example (payroll)
{
  risk_type: "payroll_readiness",
  severity: "critical",
  source_module: "payroll",
  title: "Missing verified bank (5 employees)",
  status: "open",
  escalation_level: 0,
  blocked_count: 5,
  blocker_type: "Missing verified bank"
}
```

### What NEVER Gets Sent
- ❌ Employee names (full_name)
- ❌ Employee codes (raw employee_code)
- ❌ Candidate names
- ❌ Aadhaar, PAN, bank details
- ❌ Salary amounts
- ❌ Mobile numbers, emails
- ❌ Any PII

### Verification
```sql
-- Check prompt audit for PII redaction
SELECT id, user_id, provider_key, pii_redaction_applied, 
       sensitive_fields_removed_json, created_at
FROM ai_prompt_audit_log
WHERE request_source = 'explain_action'
ORDER BY created_at DESC
LIMIT 10;

-- pii_redaction_applied should be 0 or FALSE
-- sensitive_fields_removed_json should be empty or null
```

---

## Common Issues & Troubleshooting

### Issue: "Invalid or expired token"
**Solution:**
1. Check `INTERNAL_DEMO_BYPASS=true` in backend/.env
2. Check `NODE_ENV != production`
3. Use exact demo token: `mock-token-super-admin`
4. Or login and get real JWT token

### Issue: "Cannot find module 'payrollGovernanceService'"
**Solution:**
- Verify `backend/src/modules/payroll/payroll-governance.service.ts` exists
- Check import path in `business-actions.signal-sync.ts`

### Issue: Sync returns "scanned: 0, created: 0"
**Possible causes:**
1. **Payroll:** No active payroll runs in database
2. **Attendance:** No unreconciled attendance > 3 days
3. **Onboarding:** No candidates stuck > 48 hours
4. **Roster:** No shortages in next 7 days

**Solution:** This is normal if no issues exist. Verify data exists:
```sql
-- Check payroll runs
SELECT id, run_period, status FROM payroll_run WHERE is_locked = 0 LIMIT 5;

-- Check attendance
SELECT COUNT(*) FROM attendance_daily_record 
WHERE attendance_status = 'unreconciled' 
AND record_date < DATE_SUB(CURDATE(), INTERVAL 3 DAY);

-- Check candidates
SELECT COUNT(*) FROM ats_candidate 
WHERE current_stage IN ('bgv_pending', 'onboarding_pending', 'document_pending')
AND TIMESTAMPDIFF(HOUR, created_at, NOW()) > 48;

-- Check roster
SELECT COUNT(*) FROM wfm_slot_requirement 
WHERE requirement_date BETWEEN CURDATE() AND DATE_ADD(CURDATE(), INTERVAL 7 DAY);
```

### Issue: Scheduled jobs not running
**Solution:**
1. Check `ENABLE_SCHEDULERS=true` in backend/.env
2. Check server logs for cron initialization
3. Verify server didn't crash
4. Wait for next scheduled time

### Issue: AI explain returns rule-based instead of Gemini
**Possible causes:**
1. Gemini provider not configured
2. Gemini provider disabled
3. Gemini API key invalid
4. Automatic fallback triggered

**Solution:**
1. Check AI provider configuration:
```bash
curl http://localhost:5055/api/ai/providers/active \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```
2. Test Gemini connection in Super Admin UI
3. Check `GEMINI_API_KEY` in backend/.env

---

## Success Criteria

✅ **All 4 sync endpoints return success**
✅ **Actions created in database with correct source_module**
✅ **No duplicate actions on re-sync**
✅ **AI explain returns explanation with provider info**
✅ **Scheduled jobs initialize successfully**
✅ **Role-based access enforced (403 for unauthorized)**
✅ **No PII in AI context (verified in audit log)**
✅ **Audit logs populated (usage + prompt audit)**

---

## Next Steps After Testing

1. **Frontend Implementation**
   - Add "Explain" button to NativeBusinessActionQueue.tsx
   - Add individual sync buttons (Payroll, Attendance, Onboarding, Roster)
   - Display AI explanation below action cards

2. **Production Deployment**
   - Deploy backend to 192.168.11.225
   - Run database migration (none required - uses existing tables)
   - Set `ENABLE_SCHEDULERS=true` in production
   - Monitor scheduled job execution
   - Test all endpoints with production data

3. **Monitoring**
   - Watch `business_action_queue` for new actions
   - Monitor `ai_provider_usage_log` for AI usage
   - Check cron logs daily for successful execution

---

**Testing Guide Created:** 2026-07-10  
**Phase:** Phase 2 Backend Complete  
**Status:** Ready for Manual Testing + Frontend Implementation
