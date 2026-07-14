# ATS Recruiter Visibility Fix - Deployment Guide

## Issue Summary
Candidates were not visible to recruiters in:
- `/ats/candidate-master` 
- `/ats/recruiter/my-candidates` endpoint

**Root Cause:** The `status` column (added in migration 344) had NULL values for existing candidates, and the query filtered by `status = 'Waiting'`, excluding all NULL records.

## Changes Made

### Backend
1. **recruiterInterview.service.ts** - Fixed `getMyPendingCandidates()` query
   - Use `COALESCE(status, current_stage, 'Waiting')` in SELECT
   - Added fallback WHERE: `(status = 'Waiting' OR (status IS NULL AND current_stage IN ('New', 'Applied', 'Screening', 'Registered')))`

2. **ats.validation.ts** - Added `sourcingChannel` filter parameter

3. **ats.service.ts** - Apply `sourcingChannel` filter in `listCandidates()`

4. **999_ats_backfill_status_column.sql** - New migration
   - Backfills NULL status from `final_decision` (priority 1)
   - Maps `current_stage` to appropriate status (priority 2)
   - Adds index on `status` column

### Frontend
1. **NativeATSCandidateMaster.tsx**
   - Filter by `sourcingChannel=Walk-In` for HR/Admin (only show registration form candidates)

2. **NativeATSWaitingQueue.tsx**
   - Improved filter robustness with `.trim()` on all filter values
   - Added visual indicators when filters are active (blue highlight)
   - Added "Clear all" button and active filter count badge

## Deployment Steps

### 1. Pull Latest Changes
```bash
ssh user@mcnhrms.teammas.in
cd /var/www/mcn-peopleOS-hrms/HRMS2-latest
git pull origin main
```

### 2. Run Database Migration
```bash
mysql -u root -p mas_hrms < backend/sql/999_ats_backfill_status_column.sql
```

**Expected output:**
```
Query OK, X rows affected (...)  -- Updates from final_decision
Query OK, Y rows affected (...)  -- Updates from current_stage mapping
```

### 3. Build Frontend
```bash
npm install
npm run build
```

### 4. Restart Backend
```bash
pm2 restart mcn-hrms-backend
pm2 logs mcn-hrms-backend --lines 50
```

### 5. Verify Nginx is Serving Latest Build
```bash
# Check nginx config points to correct dist folder
cat /etc/nginx/sites-available/mcnhrms.teammas.in

# Reload nginx if needed
sudo nginx -t
sudo systemctl reload nginx
```

## Testing Checklist

### Test with Recruiter Accounts
1. **Login as MAS62536** (Password: `Khushi@123`)
   - Go to `/ats/candidate-master`
   - Verify candidates assigned to this recruiter are visible
   - Check filters work correctly

2. **Login as MAS61042** (Password: `Mehar@2005`)
   - Go to `/ats/candidate-master`
   - Verify candidates assigned to this recruiter are visible

### Test with HR/Admin Account
3. **Login as HR/Admin**
   - Go to `/ats/candidate-master`
   - Verify only Walk-In sourced candidates are shown
   - Check "All" filter shows all candidates

### Test Walk-in Queue
4. **Go to `/ats/walkin-queue`**
   - Select a branch from dropdown → should filter immediately
   - Select a recruiter from dropdown → should filter immediately
   - Verify active filter badge appears
   - Click "Clear all" → all filters reset to "All"

## Verification Queries

### Check status column population
```sql
-- Should return 0 if migration worked
SELECT COUNT(*) FROM ats_candidate WHERE status IS NULL AND active_status = 1;

-- View status distribution
SELECT status, COUNT(*) as count 
FROM ats_candidate 
WHERE active_status = 1 
GROUP BY status;
```

### Check recruiter assignments
```sql
-- List candidates by recruiter
SELECT 
  recruiter_assigned_name,
  COUNT(*) as candidate_count,
  GROUP_CONCAT(DISTINCT status) as statuses
FROM ats_candidate
WHERE active_status = 1
GROUP BY recruiter_assigned_name;
```

## Rollback Plan (if needed)

If issues occur, rollback with:

```bash
# 1. Revert git changes
cd /var/www/mcn-peopleOS-hrms/HRMS2-latest
git reset --hard HEAD~1

# 2. No database rollback needed (migration is additive/safe)
#    The status backfill and index won't break anything

# 3. Rebuild and restart
npm run build
pm2 restart mcn-hrms-backend
sudo systemctl reload nginx
```

## Expected Behavior After Fix

✅ **Recruiters see their assigned candidates** in Candidate Master
✅ **HR/Admin see only Walk-In candidates** by default (registration form submissions)
✅ **Walk-in Queue filters work smoothly** with visual feedback
✅ **All existing candidates have status populated** (no NULL values)
✅ **API performance improved** with new `idx_ats_status` index

## Support

If issues persist:
1. Check PM2 logs: `pm2 logs mcn-hrms-backend --lines 100`
2. Check browser console for frontend errors
3. Verify database migration ran successfully
4. Test API directly: `curl https://mcnhrms.teammas.in/api/ats/recruiter/my-candidates`

---
**Deployed:** [DATE]
**Tested by:** [NAME]
**Status:** ✅ Verified / ⏳ Pending / ❌ Issues
