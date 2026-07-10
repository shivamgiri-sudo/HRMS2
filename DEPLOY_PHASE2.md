# Phase 2 Deployment Guide

**Server:** 192.168.11.225  
**User:** masadmin  
**Password:** Support#123  
**Date:** 2026-07-10

---

## Phase 2 Changes Summary

**What's New:**
- 4 business signal sync functions (payroll, attendance, onboarding, roster)
- 4 new API routes for manual signal sync
- AI explain-action endpoint
- Scheduled jobs (daily + 6-hour intervals)
- Comprehensive testing guide

**No Breaking Changes:**
- Uses existing database tables
- No migration required
- Additive routes only
- Backward compatible

---

## Quick Deployment (Automated)

```bash
# 1. SSH to server
ssh masadmin@192.168.11.225

# 2. Pull latest from GitHub
cd /home/masadmin/HRMS2
git pull origin main

# 3. Rebuild backend
cd backend
npm run build

# 4. Restart backend
pm2 restart mcn-hrms-backend

# 5. Verify
pm2 logs mcn-hrms-backend --lines 50 | grep CRON
# Should see: [CRON] Business action sync jobs initialized
```

---

## Manual Deployment Steps

### Step 1: Connect to Server
```bash
ssh masadmin@192.168.11.225
cd /home/masadmin/HRMS2
```

### Step 2: Backup Current Code
```bash
cd backend
tar -czf backup-phase2-$(date +%Y%m%d-%H%M%S).tar.gz src/
cd ..
```

### Step 3: Pull Latest Code
```bash
git pull origin main
```

**Expected files changed:**
- `backend/src/modules/business-actions/business-actions.signal-sync.ts`
- `backend/src/modules/business-actions/business-actions.routes.ts`
- `backend/src/modules/ai/ai-insights.routes.ts`
- `backend/src/cron/business-action-sync.cron.ts` (NEW)
- `backend/src/server.ts`

### Step 4: Verify Scheduler Setting
```bash
grep ENABLE_SCHEDULERS backend/.env
```

**Should show:**
```
ENABLE_SCHEDULERS=true
```

If not set:
```bash
echo "ENABLE_SCHEDULERS=true" >> backend/.env
```

### Step 5: Build Backend
```bash
cd backend
npm run build
```

**Expected:** No errors, build succeeds

### Step 6: Restart Backend
```bash
pm2 restart mcn-hrms-backend
```

### Step 7: Check Logs
```bash
pm2 logs mcn-hrms-backend --lines 100
```

**Look for:**
```
[CRON] Initializing business action sync jobs...
[CRON] Business action sync jobs initialized
[CRON] - Payroll readiness: Daily 7 AM IST
[CRON] - Attendance gaps: Daily 6 AM IST
[CRON] - Onboarding stuck: Every 6 hours
[CRON] - Roster shortages: Daily 9 AM IST
[schedulers] ...business-action-sync started
```

---

## Post-Deployment Verification

### Test 1: Check Server Health
```bash
curl -s http://localhost:5055/api/ai/providers/active \
  -H "Authorization: Bearer <YOUR_TOKEN>"
```

**Expected:** Returns active AI provider

### Test 2: Manual Sync Test
```bash
# From server or local machine (replace IP with server IP)
curl -X POST http://192.168.11.225:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer <YOUR_REAL_JWT_TOKEN>" \
  -H "Content-Type: application/json"
```

**Expected:**
```json
{
  "success": true,
  "data": {
    "count": N,
    "message": "N payroll actions synced",
    "details": { ... }
  }
}
```

### Test 3: Check Database
```bash
mysql -u shivam_user -p mas_hrms << EOF
SELECT source_module, COUNT(*) as count, MAX(created_at) as last_created
FROM business_action_queue
WHERE created_by = 'system'
GROUP BY source_module;
EOF
```

**Expected:** Shows actions from payroll, attendance, onboarding, roster

### Test 4: Verify Scheduled Jobs (Wait or Check Logs)
```bash
# Wait for next scheduled time OR check logs tomorrow morning
pm2 logs mcn-hrms-backend | grep "CRON.*sync complete"
```

**Expected:**
```
[CRON] Payroll readiness sync complete: 3 actions
[CRON] Attendance gap sync complete: 7 actions
```

---

## Frontend Changes (Not Yet Implemented)

Phase 2 backend is complete. Frontend enhancements are pending:

**To Add:**
- "Explain" button in Business Action Queue table
- Individual sync buttons (Payroll, Attendance, Onboarding, Roster)
- AI explanation display below actions

**File to modify:** `src/pages/NativeBusinessActionQueue.tsx`

**Deploy frontend after adding these features:**
```bash
cd /home/masadmin/HRMS2
npm run build
# Frontend dist is served by nginx
```

---

## Rollback Plan

### Quick Rollback
```bash
# 1. Stop backend
pm2 stop mcn-hrms-backend

# 2. Restore backup
cd /home/masadmin/HRMS2/backend
tar -xzf backup-phase2-YYYYMMDD-HHMMSS.tar.gz

# 3. Rebuild
npm run build

# 4. Restart
pm2 restart mcn-hrms-backend
```

### Disable Scheduled Jobs Only
```bash
# In backend/.env
ENABLE_SCHEDULERS=false

pm2 restart mcn-hrms-backend
```

### Remove Test Actions
```sql
DELETE FROM business_action_queue
WHERE created_by = 'system'
  AND source_module IN ('payroll', 'attendance', 'onboarding', 'roster');
```

---

## Monitoring After Deployment

### Daily Checks (First Week)

**Check 1: Scheduled Job Execution**
```bash
pm2 logs mcn-hrms-backend | grep CRON | tail -20
```

**Check 2: Action Count**
```sql
SELECT source_module, COUNT(*) as count
FROM business_action_queue
WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY source_module;
```

**Check 3: AI Usage**
```sql
SELECT provider_key, COUNT(*) as requests, SUM(input_token_count) as tokens
FROM ai_provider_usage_log
WHERE created_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
GROUP BY provider_key;
```

**Check 4: Errors**
```bash
pm2 logs mcn-hrms-backend --err --lines 50
```

### Expected Behavior

**Daily Sync Execution:**
- 6 AM: Attendance gap sync
- 7 AM: Payroll readiness sync
- 9 AM: Roster shortage sync
- Every 6 hours: Onboarding stuck sync

**Action Creation:**
- Actions created only if issues detected
- No duplicates on re-sync
- Owner assignment (user or role)
- Due dates set based on severity

**AI Explain:**
- Called when user clicks "Explain" (frontend pending)
- Returns concise explanation (2-3 sentences)
- Falls back to rule-based if Gemini fails
- All calls audited

---

## Known Issues & Limitations

**Issue 1: First Sync May Create Many Actions**
- First run scans entire database history
- May create 50-100+ actions if many issues exist
- **Solution:** This is normal. Actions deduplicate on future runs.

**Issue 2: Scheduled Jobs Run on Server Time**
- Cron schedule uses IST (Asia/Kolkata timezone)
- Server time zone must match
- **Solution:** Verify with `date` command on server

**Issue 3: No Real-time Updates**
- Frontend requires manual refresh
- Scheduled jobs run in background
- **Solution:** Users can manually trigger sync via API/UI

**Issue 4: Mock Tokens May Not Work in Production**
- `INTERNAL_DEMO_BYPASS` should be false in production
- Real JWT tokens required
- **Solution:** Users must login and get real tokens

---

## Support & Troubleshooting

**Contact:** Shivam (Admin)  
**Documentation:** PHASE2_TESTING_GUIDE.md, PHASE2_SMART_WORK_INBOX_BACKEND_COMPLETE.md

**Common Issues:**

| Issue | Solution |
|-------|----------|
| Scheduled jobs not running | Check `ENABLE_SCHEDULERS=true` |
| Sync returns 0 created | No issues in database (normal) |
| AI explain fails | Check Gemini configuration |
| Token invalid | Use real JWT, not demo token |
| No actions visible | Check user role permissions |

---

## Success Criteria

✅ **Backend deployed successfully**  
✅ **Scheduled jobs initialized**  
✅ **Manual sync endpoints working**  
✅ **AI explain endpoint working**  
✅ **No errors in PM2 logs**  
✅ **Actions appearing in database**  
⏳ **Frontend UI pending**  

---

**Deployment Guide Created:** 2026-07-10  
**Phase:** Phase 2 Backend  
**Status:** Ready for Production Deployment
