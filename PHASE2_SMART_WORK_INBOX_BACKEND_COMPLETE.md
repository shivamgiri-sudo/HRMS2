# Phase 2: Smart Work Inbox / Universal Action Center - Backend Complete

**Date:** 2026-07-10  
**Status:** ✅ Backend Implementation Complete, Ready for Testing  
**Phase:** PeopleOS AI Enhancement Phase 2

---

## Summary

Phase 2 backend implementation adds **4 critical business signal sources** to the Business Actions module and enables **AI-powered explanations** for every action. The implementation integrates payroll readiness blockers, attendance exceptions, onboarding/BGV stuck candidates, and roster shortages into the existing Business Actions infrastructure.

---

## Changes Implemented

### 1. Signal Sync Enhancement
**File:** `backend/src/modules/business-actions/business-actions.signal-sync.ts`

**Added 4 new sync functions:**
- `syncPayrollReadiness()` - Scans active payroll runs, creates actions for blocker issues
- `syncAttendanceGaps()` - Scans unreconciled attendance > 3 days, creates actions per employee
- `syncOnboardingStuck()` - Scans candidates stuck in onboarding stages > 48 hours
- `syncRosterShortages()` - Scans roster requirements vs planned HC for next 7 days

**Deduplication logic:** Source_module + source_id + risk_type (prevents duplicates on re-sync)

**Updated `syncAll()`** to include all 4 new sources

---

### 2. New Sync Routes
**File:** `backend/src/modules/business-actions/business-actions.routes.ts`

**Added 4 new POST routes:**
- `POST /api/business-actions/sync-signals/payroll` - Payroll HR only
- `POST /api/business-actions/sync-signals/attendance` - HR, WFM
- `POST /api/business-actions/sync-signals/onboarding` - HR
- `POST /api/business-actions/sync-signals/roster` - Operations, WFM

All routes return: `{ success: true, data: { count, message, details } }`

---

### 3. AI Explain Endpoint
**File:** `backend/src/modules/ai/ai-insights.routes.ts`

**Added new endpoint:**
```
POST /api/ai/explain-action
Body: { action_id: string }
Returns: {
  explanation: string,
  insights: array,
  actions: array,
  provider: string,
  model: string,
  safe_mode: boolean,
  fallback_used: boolean,
  data_confidence: object,
  generated_at: string
}
```

**Features:**
- Fetches business action from database
- Builds sanitized context (no PII - counts only)
- Calls active AI provider (Gemini or rule-based fallback)
- Returns concise explanation with recommended next steps
- Logs usage and audit trail

---

### 4. Scheduled Jobs
**File:** `backend/src/cron/business-action-sync.cron.ts` (NEW)

**Cron schedule:**
- Payroll readiness: Daily 7 AM IST
- Attendance gaps: Daily 6 AM IST
- Onboarding stuck: Every 6 hours
- Roster shortages: Daily 9 AM IST

**Implementation:** Uses native `setTimeout` (matching existing pattern, not node-cron dependency)

---

### 5. Server Integration
**File:** `backend/src/server.ts`

**Changes:**
- Import: `initBusinessActionSyncJobs` from `./cron/business-action-sync.cron.js`
- Call: Added to `ENABLE_SCHEDULERS` section
- Logs: Updated scheduler log message

---

## Verification

### TypeScript
```bash
cd backend
npm run typecheck
# ✅ PASSED - No errors
```

### Build
```bash
cd backend
npx tsc
# ✅ PASSED - Build succeeded
```

---

## Testing Steps

### 1. Manual Sync Test (Backend Running)

**Test payroll sync:**
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/payroll \
  -H "Authorization: Bearer <token>"
```

**Expected response:**
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

**Verify in database:**
```sql
SELECT * FROM business_action_queue
WHERE source_module = 'payroll'
ORDER BY created_at DESC
LIMIT 10;
```

---

### 2. AI Explain Test

**Get an action ID:**
```sql
SELECT id FROM business_action_queue LIMIT 1;
```

**Test AI explain:**
```bash
curl -X POST http://localhost:5055/api/ai/explain-action \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"action_id": "<action_id>"}'
```

**Expected response:**
```json
{
  "success": true,
  "data": {
    "explanation": "This action exists because 7 employees have unresolved attendance exceptions...",
    "insights": [],
    "actions": [],
    "provider": "gemini",
    "model": "gemini-flash",
    "safe_mode": true,
    "fallback_used": false,
    "data_confidence": {},
    "generated_at": "2026-07-10T15:30:00+05:30"
  }
}
```

---

### 3. Scheduled Jobs Test

**Enable schedulers:**
```bash
# In backend/.env
ENABLE_SCHEDULERS=true
```

**Start backend:**
```bash
npm run dev
```

**Check logs:**
```bash
pm2 logs mcn-hrms-backend | grep CRON
```

**Expected output:**
```
[CRON] Initializing business action sync jobs...
[CRON] Business action sync jobs initialized
[CRON] - Payroll readiness: Daily 7 AM IST
[CRON] - Attendance gaps: Daily 6 AM IST
[CRON] - Onboarding stuck: Every 6 hours
[CRON] - Roster shortages: Daily 9 AM IST
```

**Wait for next scheduled time or manually trigger sync via API**

---

### 4. Deduplication Test

**Run same sync twice:**
```bash
curl -X POST http://localhost:5055/api/business-actions/sync-signals/attendance \
  -H "Authorization: Bearer <token>"

# Run again immediately
curl -X POST http://localhost:5055/api/business-actions/sync-signals/attendance \
  -H "Authorization: Bearer <token>"
```

**Expected:** Second call returns `created: 0, skipped: N` (no duplicates)

**Verify in database:**
```sql
SELECT COUNT(*) AS duplicate_count
FROM business_action_queue
WHERE source_module = 'attendance'
GROUP BY source_id, risk_type
HAVING duplicate_count > 1;
```

**Expected:** 0 rows (no duplicates)

---

## Security Verification

### ✅ PII Protection
- No employee names sent to AI (only counts)
- No Aadhaar, PAN, bank, salary data in context
- Module-specific sanitization for payroll, attendance, onboarding, roster

### ✅ Role-Based Access
- Payroll sync: payroll_hr only
- Attendance sync: hr, wfm
- Onboarding sync: hr
- Roster sync: operations, wfm

### ✅ Audit Logging
- All AI calls logged in `ai_provider_usage_log`
- Prompt audit in `ai_prompt_audit_log`
- Action creation logged in `business_action_activity_log`

---

## Frontend Integration (Next Step)

The frontend enhancements are straightforward additions to `src/pages/NativeBusinessActionQueue.tsx`:

1. **Add state:**
   ```typescript
   const [explainLoading, setExplainLoading] = useState<string | null>(null);
   const [explanations, setExplanations] = useState<Record<string, any>>({});
   const [syncLoading, setSyncLoading] = useState<string | null>(null);
   ```

2. **Add "Explain" button in action table row:**
   ```tsx
   <Button size="sm" onClick={() => handleExplain(row.id)}>
     <Sparkles className="h-4 w-4 mr-2" />
     Explain
   </Button>
   ```

3. **Add individual sync buttons:**
   ```tsx
   <Button onClick={() => handleSync('payroll')}>Sync Payroll</Button>
   <Button onClick={() => handleSync('attendance')}>Sync Attendance</Button>
   <Button onClick={() => handleSync('onboarding')}>Sync Onboarding</Button>
   <Button onClick={() => handleSync('roster')}>Sync Roster</Button>
   ```

4. **Display AI explanation below action when available**

---

## Rollback Plan

**If issues occur:**

1. **Disable scheduled jobs:**
   ```bash
   # In backend/.env
   ENABLE_SCHEDULERS=false
   pm2 restart mcn-hrms-backend
   ```

2. **Comment out new routes:**
   ```typescript
   // In business-actions.routes.ts
   // Comment lines with /sync-signals/payroll, /attendance, /onboarding, /roster
   ```

3. **Comment out AI explain:**
   ```typescript
   // In ai-insights.routes.ts
   // Comment the /explain-action endpoint
   ```

4. **Restart backend:**
   ```bash
   pm2 restart mcn-hrms-backend
   ```

5. **Clean test actions (optional):**
   ```sql
   DELETE FROM business_action_queue
   WHERE created_by = 'system'
     AND source_module IN ('payroll', 'attendance', 'onboarding', 'roster');
   ```

**No data loss. Existing actions unaffected.**

---

## Known Limitations

1. **No Multi-turn Conversations:** AI explain is single-shot Q&A
2. **No Predictive Analytics:** Phase 2 is reactive (signals → actions), not predictive
3. **No Real-time Updates:** Frontend requires manual refresh/sync
4. **No Action Prioritization Algorithm:** Uses severity + due date only

---

## Files Modified

**Backend (5 files):**
- `backend/src/modules/business-actions/business-actions.signal-sync.ts` - Added 4 sync functions
- `backend/src/modules/business-actions/business-actions.routes.ts` - Added 4 sync routes
- `backend/src/modules/ai/ai-insights.routes.ts` - Added explain-action endpoint
- `backend/src/cron/business-action-sync.cron.ts` - NEW, scheduled jobs
- `backend/src/server.ts` - Registered cron jobs

**No database changes required** - Uses existing tables from Phase 1 and Business Actions foundation.

---

## Next Steps

1. **Test backend endpoints** (manual sync, AI explain)
2. **Verify scheduled jobs** (check logs after starting with ENABLE_SCHEDULERS=true)
3. **Frontend implementation** (add Explain button + sync buttons)
4. **End-to-end testing** (full workflow from sync → explain → action completion)
5. **Deploy to production server** (192.168.11.225)
6. **Monitor scheduled job execution** in production logs

---

## Conclusion

Phase 2 backend implementation is **complete and ready for testing**. All 4 critical business signal sources are now integrated into the Business Actions module with AI-powered explanations. The system can automatically detect payroll blockers, attendance exceptions, onboarding stuck candidates, and roster shortages, creating actionable items with proper ownership, severity, and due dates.

**Status:** ✅ Backend Complete  
**Next:** Frontend UI enhancements + Production Deployment

---

**Implementation completed:** 2026-07-10  
**Developer:** Claude Sonnet 4.5 (Fable 5 thinking mode)  
**Phase:** Phase 2 Backend Complete - Ready for Testing
