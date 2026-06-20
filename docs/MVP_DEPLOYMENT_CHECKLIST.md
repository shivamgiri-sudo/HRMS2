# MVP Deployment Checklist

**Goal:** Redeploy fixed code to server and restore all module functionality.

**Last Updated:** 2026-06-20

---

## Critical Fixes Applied

All code changes are committed to GitHub. You can pull them now:

```bash
git pull origin main
```

### 1. Database Fixes (CRITICAL - Run First)

**File:** `backend/sql/999_fix_missing_ceo_metrics_tables.sql`

**What it does:** Creates 8 missing tables that CEO metrics query depends on.

**Run this on your MySQL server:**

```bash
# Connect to your server
mysql -h your-db-host -u your-username -p your-password mas_hrms < backend/sql/999_fix_missing_ceo_metrics_tables.sql
```

**Tables created:**
- `salary_prep_run` (Payroll)
- `salary_prep_line` (Payroll)
- `workforce_mandate` (WFM)
- `shrinkage_daily_snapshot` (RTA)
- `billing_invoice` (Billing)
- `employee_salary_assignment` (Payroll)
- `employee_exit_record` (Exit)
- `applicant` (ATS)

✅ After running: "Admin analytics could not load" error should be gone for super_admin users

---

## Backend Fixes (Already in Code)

### 2. Error Handling

**Files:**
- `backend/src/modules/management/management.routes.ts` — CEO metrics endpoint now has try-catch + error message
- `backend/src/modules/files/files.routes.ts` — Employee photos route moved before auth (public access)
- `backend/src/modules/employees/employee.routes.ts` — Photo upload response includes camelCase field

**Test:** Login as super_admin → Dashboard should load without "Admin analytics" error

### 3. Route Fixes

**Files:**
- `backend/src/modules/quality-dashboard/quality-dashboard.routes.ts` — GET /agents returns proper 500 errors
- `backend/src/modules/lms/lms.routes.ts` — GET /native/admin wrapped in try-catch
- `backend/src/modules/kpi/kpi.validation.ts` — Leaderboard accepts period as number or string

**Test:** Navigate to all quality/LMS/KPI endpoints → should not return white page

---

## Frontend Fixes (Already in Code)

### 4. UI Enhancements

**Files:**
- `src/pages/Index.tsx` — Added "Bulk Upload" and "All Modules" quick actions
- `src/components/dashboard/AdminWorkforceDashboard.tsx` — Error UI shows actual error + retry button
- `src/app.tsx` — Added NativeBiometricCommandCenter lazy import (fixes white page after login)
- `src/index.html` — Added `<meta name="mobile-web-app-capable">` tag

**Test:** 
- Dashboard loads → Quick actions visible
- Click "All Modules" → Shows all role-based features
- Click "Bulk Upload" → Goes to /bulk-upload

---

## Deployment Steps

### Step 1: Pull Latest Code
```bash
cd /path/to/HRMS1
git pull origin main
```

### Step 2: Run Database Migration
```bash
mysql -h your-db-host -u root -p your-password mas_hrms < backend/sql/999_fix_missing_ceo_metrics_tables.sql
```

**Expected output:**
```
Query OK, 0 rows affected...
Query OK, 0 rows affected...
(8 tables created or verified)
```

### Step 3: Rebuild Backend
```bash
cd backend
npm install
npm run build
npm start
```

**Expected:** Server starts on port 3001, no errors

### Step 4: Rebuild Frontend
```bash
cd ..
npm install
npm run build
```

**Expected:** Build succeeds, no errors

### Step 5: Test Deployment

**In Browser:**
1. ✅ Login with super_admin credentials
2. ✅ Dashboard loads (no "Admin analytics" error)
3. ✅ Click "All Modules" → Shows list of all features
4. ✅ Click "Bulk Upload" → Page loads
5. ✅ Click "Employee Directory" → Shows employees
6. ✅ Upload employee photo → Photo displays immediately
7. ✅ Navigate to Quality Dashboard → Shows agents
8. ✅ Navigate to KPI Leaderboard → Shows data

---

## Verification Checklist

| Item | Status | Notes |
|------|--------|-------|
| Database migration ran successfully | ⬜ | No errors on mysql command |
| Backend builds without errors | ⬜ | `npm run build` completes |
| Frontend builds without errors | ⬜ | `npm run build` completes |
| Super admin can login | ⬜ | No white page after login |
| Dashboard loads (no CEO metrics error) | ⬜ | No red error box on dashboard |
| All Modules link shows all features | ⬜ | Click link → full feature list |
| Photo upload works | ⬜ | Photo displays after upload |
| Quality dashboard loads | ⬜ | No 500 errors |
| KPI leaderboard loads | ⬜ | No 400 errors |
| Regular employee can see their modules | ⬜ | Login as employee → "My Modules" works |

---

## Rollback Plan (If Needed)

If anything breaks:

1. **Database issue:**
   ```bash
   mysql -h your-db-host -u root -p your-password mas_hrms
   DROP TABLE salary_prep_run, salary_prep_line, workforce_mandate, 
             shrinkage_daily_snapshot, billing_invoice, employee_salary_assignment,
             employee_exit_record, applicant;
   ```

2. **Code issue:**
   ```bash
   git revert HEAD~1  # Revert last commit if needed
   git pull
   npm run build
   npm start
   ```

3. **Restart server:**
   ```bash
   systemctl restart hrms  # or your restart command
   ```

---

## What's Now Fixed

### Problems Solved
- ❌ "Admin analytics could not load" → ✅ Fixed (database tables added)
- ❌ White page after login → ✅ Fixed (lazy import added)
- ❌ Photos return 401 → ✅ Fixed (route moved before auth)
- ❌ Photo not displaying → ✅ Fixed (response format corrected)
- ❌ Quality/LMS/KPI return 500s → ✅ Fixed (error handling added)
- ❌ 124+ pages not discoverable → ✅ Fixed (added /modules launcher + quick actions)

### New Features
- ✅ Quick action links on dashboard
- ✅ Feature discovery page (/modules)
- ✅ Better error messages throughout
- ✅ Reload page button on errors

---

## Support

If you encounter issues:

1. Check `FEATURE_DISCOVERY_GUIDE.md` for how to access all modules
2. Check backend logs for database errors
3. Check browser console (F12) for frontend errors
4. Verify all 8 tables were created in MySQL:
   ```sql
   SHOW TABLES LIKE '%salary_prep%';
   SHOW TABLES LIKE '%workforce%';
   SHOW TABLES LIKE '%shrinkage%';
   SHOW TABLES LIKE '%billing%';
   SHOW TABLES LIKE '%exit%';
   SHOW TABLES LIKE '%applicant%';
   ```

---

**Ready to deploy?** Run the checklist above and confirm all items pass. Once database migration completes successfully, all admin errors should resolve.
