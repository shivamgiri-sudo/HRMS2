# Phase 1 Sidebar Deployment Guide
**Date:** 2026-07-14  
**Status:** Ready for Production Deployment

---

## Quick Summary

Added **18 critical missing pages** to sidebar:
- 6 Expenses module pages (NEW section)
- 6 Role-specific dashboards
- 3 Critical payroll features
- 3 Super admin tools

**Build Status:** ✅ Successful  
**Commit:** 79d2e8f7  
**Risk:** LOW (purely additive, no breaking changes)

---

## Deployment Steps

### Step 1: Database Migration

```bash
# Connect to MySQL
mysql -u root -p mas_hrms

# Run migration
source /var/www/HRMS2/backend/sql/add_missing_page_catalog_entries.sql;

# Verify (should return 18 rows)
SELECT COUNT(*) FROM page_catalog 
WHERE page_code IN (
  'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
  'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
  'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
  'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER'
);
```

**Expected Output:** `18`

---

### Step 2: Pull Latest Code

```bash
cd /var/www/HRMS2
git pull origin main
```

**Expected:** Should pull commit `79d2e8f7`

---

### Step 3: Build Frontend

```bash
npm run build
```

**Expected:** Build completes in ~2 minutes with no errors

---

### Step 4: Deploy Build

```bash
# Backup current dist
sudo cp -r dist dist-backup-$(date +%Y%m%d-%H%M%S)

# Deploy new build
sudo rm -rf dist/*
sudo cp -r dist-new/* dist/
sudo chown -R www-data:www-data dist/

# Reload nginx
sudo nginx -t
sudo systemctl reload nginx
```

---

### Step 5: Verification

**1. Check Homepage:**
```bash
curl -I https://mcnhrms.teammas.in/
```
**Expected:** HTTP 200

**2. Test Sidebar (Manual):**
- Login as employee → Should see My Dashboard, My Expenses
- Login as manager → Should see Manager Dashboard, Expense Approvals
- Login as super_admin → Should see all 18 new pages

**3. Test Access Control:**
- Go to `/settings/access-control`
- Revoke `MY_EXPENSES` from a test user
- Wait 30 seconds or logout/login
- **Expected:** Page disappears from test user's sidebar

---

## What Users Will See

### All Employees:
- ✅ My Dashboard (new)
- ✅ My Expenses (new)
- ✅ New Claim button (new)
- ✅ Salary Certificates (new)

### Managers:
- ✅ Manager Dashboard (new)
- ✅ Expense Approvals (new)

### Finance Team:
- ✅ Finance Queue (new)
- ✅ Expense Reports (new)
- ✅ Payroll Disbursal (new)

### Payroll Team:
- ✅ Payroll Dashboard (new)
- ✅ Disbursal Management (new)
- ✅ Loan Management (new)

### HR Team:
- ✅ HR Dashboard (new)
- ✅ Loan Management (view) (new)

### WFM Team:
- ✅ WFM Dashboard (new)

### CEO:
- ✅ CEO Dashboard (new)

### Super Admin:
- ✅ Module Access (new)
- ✅ Super Admin Dashboard (new)
- ✅ Security Center (new)

---

## Rollback Plan

**If any issues occur:**

```bash
# Step 1: Rollback database
mysql -u root -p mas_hrms <<EOF
DELETE FROM role_page_access WHERE page_code IN (
  'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
  'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
  'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
  'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER'
);
DELETE FROM page_catalog WHERE page_code IN (
  'MY_EXPENSES', 'EXPENSE_CREATE', 'EXPENSE_APPROVALS', 'EXPENSE_FINANCE', 'EXPENSE_REPORTS',
  'EMPLOYEE_DASHBOARD', 'CEO_DASHBOARD', 'HR_DASHBOARD', 'WFM_DASHBOARD', 'PAYROLL_DASHBOARD', 'MANAGER_DASHBOARD',
  'PAYROLL_DISBURSAL', 'PAYROLL_LOANS', 'SALARY_CERTIFICATE',
  'MODULE_ACCESS', 'SUPER_ADMIN_DASHBOARD', 'SECURITY_CENTER'
);
EOF

# Step 2: Rollback code
cd /var/www/HRMS2
git checkout HEAD~1
npm run build
sudo rm -rf dist/*
sudo cp -r dist-new/* dist/
sudo systemctl reload nginx
```

---

## Post-Deployment

### Monitor (24 hours):
- Check PM2 logs: `pm2 logs hrms2-backend --lines 100`
- Monitor Nginx errors: `sudo tail -f /var/log/nginx/error.log`
- Watch for support tickets about missing pages or access issues

### Gather Feedback (1 week):
- Survey users on discoverability improvement
- Track which new pages are most accessed
- Identify any permission-related confusion

---

## Success Metrics

- ✅ No errors during deployment
- ✅ All 18 pages visible to appropriate roles
- ✅ Unauthorized users don't see restricted pages
- ✅ Access revocation works within 30 seconds
- ✅ No performance degradation
- ✅ No increase in support tickets

---

## Next Steps

**After Phase 1 is stable:**

### Phase 2 (Next Sprint):
- Add 7 ATS workflow pages
- Add 3 Onboarding pages
- Add 2 WFM pages
- **Effort:** ~4 hours

### Phase 3 (Future):
- Review LMS, Compliance, System Tool pages with stakeholders
- Determine which are needed
- **Effort:** ~3 hours

---

## Contact

**Questions or Issues:**
- Check logs: `pm2 logs hrms2-backend`
- Review documentation: `PHASE1_SIDEBAR_IMPLEMENTATION.md`
- Rollback if critical issue detected

---

**Deployment Checklist:**
- [ ] Database migration executed
- [ ] Code pulled from GitHub
- [ ] Frontend built successfully
- [ ] Dist deployed and nginx reloaded
- [ ] Homepage accessible
- [ ] Test user login works
- [ ] Sidebar shows new pages
- [ ] Access control verified
- [ ] No errors in logs

**Ready to deploy!** 🚀
