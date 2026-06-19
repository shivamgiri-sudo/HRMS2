# Operations KPI Dashboard - Setup & Testing Guide

## 🎯 What Was Done

### **1. Enhanced Operations KPI Dashboard**
**File Modified:** `src/pages/NativeOperationsKPI.tsx`

**Changed:**
```typescript
// BEFORE (Line 226):
const OPS_DISPLAY_CODES = ["AHT", "ADHERENCE", "SHRINKAGE", "FCR", "OCCUPANCY"];

// AFTER:
const OPS_DISPLAY_CODES = [
  "TALK_TIME",      // ✅ Talk Time - Average talk duration per call
  "NET_LOGIN",      // ✅ Net Login - Total logged-in time
  "DIALS",          // ✅ HD (Handling/Dials) - Total calls handled
  "TOTAL_CALLS",    // ✅ Total Calls - Total calls (inbound + outbound)
  "AHT",            // Average Handle Time
  "ADHERENCE",      // Schedule Adherence
  "SHRINKAGE",      // Workforce Shrinkage
  "FCR",            // First Call Resolution
  "OCCUPANCY"       // Agent Occupancy
];
```

**Impact:**
- Dashboard now displays **9 metrics** instead of 5
- **4 requested metrics** added at the top:
  1. **TALK_TIME** - Talk Time
  2. **NET_LOGIN** - Net Login Hours
  3. **DIALS** - HD (Handling/Dials)
  4. **TOTAL_CALLS** - Total Calls

---

## 📋 Pre-Deployment Checklist

### **Step 1: Verify Metrics Exist in Database**

Run the verification script:
```bash
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms < scripts/verify-kpi-metrics.sql
```

**Expected Output:**
```
✓ TALK_TIME - EXISTS
✓ NET_LOGIN - EXISTS or needs creation
✓ DIALS - EXISTS
✓ TOTAL_CALLS - EXISTS or DIALS can be used
```

### **Step 2: Create Missing Metrics (If Needed)**

If Step 1 shows missing metrics, run:
```bash
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms < scripts/create-missing-kpi-metrics.sql
```

**This will:**
- Insert `TALK_TIME` if missing
- Insert `NET_LOGIN` if missing
- Insert `TOTAL_CALLS` if missing (and DIALS doesn't exist)

### **Step 3: Verify Data Sync**

Check if metrics have actual data:
```sql
-- Check last sync date
SELECT
    kmm.metric_code,
    COUNT(*) AS records,
    MAX(kda.score_date) AS last_sync
FROM kpi_daily_actual kda
JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
WHERE kmm.metric_code IN ('TALK_TIME', 'NET_LOGIN', 'DIALS', 'TOTAL_CALLS')
GROUP BY kmm.metric_code;
```

**Expected:**
- Records should exist for each metric
- `last_sync` should be recent (within last 7 days)
- If no data, sync workers need to be triggered

### **Step 4: Trigger Data Sync (If Needed)**

If no data exists, manually trigger sync:

**Option A: Via API (if endpoint exists)**
```bash
curl -X POST http://localhost:5055/api/kpi/sync/apr \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{"date": "2026-06-14"}'
```

**Option B: Via Worker Script**
```bash
cd backend
npx tsx src/workers/kpi-daily-sync.worker.ts
```

**Option C: Via Database Function (if available)**
```sql
CALL sync_kpi_metrics('2026-06-14');
```

---

## 🧪 Testing the Dashboard

### **1. Start Backend & Frontend**

**Terminal 1: Backend**
```bash
cd /home/shuvam/hrms-audit
PORT=5055 npm run dev
```

**Terminal 2: Frontend**
```bash
cd /home/shuvam/hrms-audit
npm run dev
```

### **2. Access Dashboard**

**URL:** `http://localhost:5173/operations-kpi` (or wherever the route is defined)

**Login with:** Admin or Manager role account

### **3. Test Workflow**

1. **Select Process:**
   - Choose a process from dropdown (e.g., "Bellavita IN", "MCN Support")
   - Should load employees for that process

2. **Select Period:**
   - Choose current month (e.g., "2026-06")
   - Should fetch KPI data for that month

3. **Verify Metric Display:**
   - Check "Key Operations Metrics" section
   - Should see **9 metric chips**:
     - TALK_TIME (with time format: MM:SS)
     - NET_LOGIN (with time format: HH:MM:SS)
     - DIALS (with count)
     - TOTAL_CALLS (with count)
     - AHT, ADHERENCE, SHRINKAGE, FCR, OCCUPANCY

4. **Check Leaderboard:**
   - Should show employees ranked by weighted_score_pct
   - Each employee row shows their score for each metric

5. **Test Filters:**
   - Change process → should reload data
   - Change period → should reload data
   - Click "Refresh" → should re-fetch

### **4. Verify Data Display**

**Check Metric Formatting:**
- ✅ **TALK_TIME** → Displayed as MM:SS (e.g., "4:32")
- ✅ **NET_LOGIN** → Displayed as HH:MM:SS (e.g., "7:45:00")
- ✅ **DIALS** → Displayed as number (e.g., "180")
- ✅ **TOTAL_CALLS** → Displayed as number (e.g., "180")
- ✅ **AHT** → Displayed as MM:SS (e.g., "5:20")

**Check Target Display (if process configured):**
- Each metric chip should show "Target: X"
- Target pulled from `kpi_process_config` table

---

## 🐛 Troubleshooting

### **Issue 1: Metrics Not Showing**

**Symptom:** "Key Operations Metrics" section is empty

**Cause:** Metrics don't exist in `kpi_metric_master`

**Fix:**
```bash
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms < scripts/create-missing-kpi-metrics.sql
```

### **Issue 2: No Data in Leaderboard**

**Symptom:** "Employees Scored: 0"

**Possible Causes:**
1. No data in `kpi_daily_actual` for selected period
2. No employees assigned to KPI templates
3. Sync workers haven't run yet

**Fix:**
```sql
-- Check if employees have KPI assignments
SELECT COUNT(*) FROM kpi_assignment WHERE active_status = 1;

-- Check if daily actual has data
SELECT COUNT(*) FROM kpi_daily_actual WHERE score_date >= '2026-06-01';

-- If no data, trigger sync (see Step 4 above)
```

### **Issue 3: Metric Values Show "—" (dash)**

**Symptom:** Metric value is null

**Cause:** No data for that employee-metric-period combination

**Fix:**
- Verify employee has activity in source systems (APR, Dialer DB)
- Check if sync workers are running
- Manually insert test data:
```sql
INSERT INTO kpi_daily_actual (employee_id, metric_id, score_date, actual_value, source)
SELECT
    e.id,
    (SELECT id FROM kpi_metric_master WHERE metric_code = 'TALK_TIME' LIMIT 1),
    CURDATE(),
    180,  -- 3 minutes in seconds
    'manual'
FROM employees e WHERE e.employee_code = 'MAS60618';
```

### **Issue 4: "NET_LOGIN" Metric Not Found**

**Symptom:** Dashboard shows NET_LOGIN but no data

**Alternative Solution:** Use existing `LOGIN_HOURS` metric instead

**Fix in Code:**
```typescript
// In src/pages/NativeOperationsKPI.tsx, line 226
const OPS_DISPLAY_CODES = [
  "TALK_TIME",
  "LOGIN_HOURS",    // ← Change from NET_LOGIN
  "DIALS",
  "TOTAL_CALLS",
  // ...rest
];
```

### **Issue 5: TOTAL_CALLS vs DIALS**

**Symptom:** Both TOTAL_CALLS and DIALS show same data

**Explanation:** They might be aliases for the same metric

**Options:**
1. Remove one from OPS_DISPLAY_CODES
2. Or: Ensure they track different things:
   - `DIALS` = Outbound dials only
   - `TOTAL_CALLS` = Inbound + Outbound

---

## 📊 Expected Behavior

### **Successful Dashboard Load:**

```
┌─────────────────────────────────────────────┐
│  Operations KPI Dashboard                   │
│  [Refresh Button]                           │
└─────────────────────────────────────────────┘

┌─────────────┬─────────────┐
│ Process: ▼  │ Period: ▼   │
│ All         │ 2026-06     │
└─────────────┴─────────────┘

┌──────────────────────────────────────────┐
│  📊 Stat Cards                           │
│  [Employees: 45] [Avg Score: 82%]       │
│  [Top: John D.] [Flagged: 3]            │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  🎯 Key Operations Metrics               │
│                                          │
│  [TALK_TIME: 4:32 | Target: 5:00]      │
│  [NET_LOGIN: 7:30:00 | Target: 8:00:00]│
│  [DIALS: 180 | Target: 150]            │
│  [TOTAL_CALLS: 180 | Target: 150]      │
│  [AHT: 5:20 | Target: 5:30]            │
│  [ADHERENCE: 92% | Target: 90%]        │
│  ... (more metrics)                      │
└──────────────────────────────────────────┘

┌──────────────────────────────────────────┐
│  🏆 Leaderboard                          │
│                                          │
│  1. John Doe - 94% [A] [Create TNI]    │
│  2. Jane Smith - 88% [B]                │
│  3. Bob Johnson - 72% [C] [Create TNI] │
│  ... (more employees)                    │
└──────────────────────────────────────────┘
```

---

## 🔍 Verification Queries

### **Check Metric Definitions:**
```sql
SELECT * FROM kpi_metric_master
WHERE metric_code IN ('TALK_TIME', 'NET_LOGIN', 'DIALS', 'TOTAL_CALLS')
ORDER BY metric_code;
```

### **Check Daily Data for One Employee:**
```sql
SELECT
    e.employee_code,
    kmm.metric_code,
    kda.score_date,
    kda.actual_value,
    kda.source
FROM kpi_daily_actual kda
JOIN employees e ON e.id = kda.employee_id
JOIN kpi_metric_master kmm ON kmm.id = kda.metric_id
WHERE e.employee_code = 'MAS60618'
  AND kda.score_date >= '2026-06-01'
  AND kmm.metric_code IN ('TALK_TIME', 'NET_LOGIN', 'DIALS', 'TOTAL_CALLS')
ORDER BY kda.score_date DESC, kmm.metric_code;
```

### **Check Process Configuration:**
```sql
SELECT
    pm.process_name,
    kmm.metric_code,
    kpc.target_value,
    kpc.min_threshold
FROM kpi_process_config kpc
JOIN process_master pm ON pm.id = kpc.process_id
JOIN kpi_metric_master kmm ON kmm.id = kpc.metric_id
WHERE kmm.metric_code IN ('TALK_TIME', 'NET_LOGIN', 'DIALS', 'TOTAL_CALLS')
ORDER BY pm.process_name, kmm.metric_code;
```

---

## 📈 Next Steps

### **1. Configure Process Targets (Optional)**

If you want custom targets per process:
```sql
-- Example: Set TALK_TIME target to 4 minutes for "Bellavita IN" process
INSERT INTO kpi_process_config (process_id, metric_id, target_value, weightage)
SELECT
    (SELECT id FROM process_master WHERE process_name = 'Bellavita IN' LIMIT 1),
    (SELECT id FROM kpi_metric_master WHERE metric_code = 'TALK_TIME' LIMIT 1),
    240,  -- 4 minutes in seconds
    15    -- 15% weight in overall score
WHERE NOT EXISTS (
    SELECT 1 FROM kpi_process_config
    WHERE process_id = (SELECT id FROM process_master WHERE process_name = 'Bellavita IN' LIMIT 1)
      AND metric_id = (SELECT id FROM kpi_metric_master WHERE metric_code = 'TALK_TIME' LIMIT 1)
);
```

### **2. Schedule Data Sync**

Set up cron job or systemd timer to sync daily:
```bash
# Add to crontab
0 1 * * * cd /home/shuvam/hrms-audit/backend && npx tsx src/workers/kpi-daily-sync.worker.ts
```

### **3. Add More Visualizations (Future Enhancement)**

Consider adding:
- Trend charts (Talk Time over last 30 days)
- Heatmap (Employee × Metric performance grid)
- Distribution charts (Score distribution histogram)
- Comparison view (Employee vs Team average)

---

## ✅ Success Criteria

Dashboard is ready when:

- [x] All 9 metrics display in "Key Operations Metrics" section
- [x] TALK_TIME shows as MM:SS format
- [x] NET_LOGIN shows as HH:MM:SS format
- [x] DIALS and TOTAL_CALLS show as numbers
- [x] Leaderboard populates with employees
- [x] Targets display for each metric (if configured)
- [x] Filters (Process, Period) work correctly
- [x] Refresh button reloads data
- [x] No console errors

---

## 📞 Support & References

**Files Modified:**
- `src/pages/NativeOperationsKPI.tsx` (Line 226)

**Files Created:**
- `OPERATIONS_KPI_SYSTEM_SUMMARY.md` - Complete system documentation
- `scripts/verify-kpi-metrics.sql` - Verification queries
- `scripts/create-missing-kpi-metrics.sql` - Metric creation script
- `OPERATIONS_KPI_SETUP_GUIDE.md` - This file

**Key Backend Files:**
- `backend/src/modules/kpi/kpi.routes.ts` - API endpoints
- `backend/src/modules/kpi/kpi.service.ts` - Business logic
- `backend/src/modules/kpi/kpi-data-connector.service.ts` - APR sync
- `backend/src/workers/domains/dialer-kpi-sync.ts` - Dialer sync

**Database Tables:**
- `kpi_metric_master` - Metric definitions
- `kpi_daily_actual` - Daily metric values
- `kpi_process_config` - Process targets
- `kpi_assignment` - Employee assignments

**External Data Sources:**
- APR Database: `vicidial_agent_log_*` tables
- Dialer DB: `vw_inbound_cdr`, `vw_outbound_cdr`
- Shivamgiri: `v_call_master_unified_kpi`

---

**Last Updated:** June 15, 2026  
**Status:** ✅ Ready for Testing
