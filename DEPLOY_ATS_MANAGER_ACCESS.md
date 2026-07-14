# Quick Deployment Guide — ATS Hiring Entry Manager Access

## Overview
Enable managers and all HR roles to access `/ats/recruiter/hiring-entry` page.

## Changes Summary
- ✅ Backend route authorization expanded
- ✅ Manager relationship checks added
- ✅ SQL migration created
- ⏳ Ready to deploy

---

## Deployment Steps

### Step 1: Verify Current Production State
```bash
# SSH to production server
ssh mcnhrms.teammas.in

# Check current backend process
pm2 list | grep hrms-backend
```

### Step 2: Apply Database Migration
```bash
# Connect to MySQL
mysql -u [your_user] -p mas_hrms

# Run the migration
source /path/to/backend/sql/999_ats_hiring_entry_manager_access.sql;

# Verify the changes
SELECT role_key, page_code, can_view, can_create, can_edit 
FROM role_page_access 
WHERE page_code = 'ATS_RECRUITER_QUEUE';
```

**Expected Result**: Should show `manager`, `process_manager`, and `team_leader` roles with access.

### Step 3: Deploy Backend Code
```bash
# Pull latest code
cd /path/to/HRMS2-latest
git pull origin main  # or your deployment branch

# Rebuild backend
cd backend
npm run build  # May show unrelated dependency warnings - ignore

# Restart backend service
pm2 restart hrms-backend

# Check logs
pm2 logs hrms-backend --lines 50
```

### Step 4: Verify Access
Test with different user roles:

#### Test 1: Manager User
```bash
# Get manager JWT token
curl -X POST https://mcnhrms.teammas.in/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"manager@example.com","password":"password"}'

# Test hiring entry access
curl -H "Authorization: Bearer <manager-token>" \
     https://mcnhrms.teammas.in/api/ats/recruiter/hiring/bootstrap

# Expected: 200 OK with data
```

#### Test 2: Recruiter User
```bash
# Should still work as before
curl -H "Authorization: Bearer <recruiter-token>" \
     https://mcnhrms.teammas.in/api/ats/recruiter/hiring/activity

# Expected: 200 OK with data
```

#### Test 3: Regular Employee (Negative Test)
```bash
# Should be denied
curl -H "Authorization: Bearer <employee-token>" \
     https://mcnhrms.teammas.in/api/ats/recruiter/hiring/bootstrap

# Expected: 403 Forbidden
```

### Step 5: Browser Testing
1. Login as manager user
2. Navigate to: `https://mcnhrms.teammas.in/ats/recruiter/hiring-entry`
3. Verify page loads without 403 error
4. Verify manager can see hiring activities from their team
5. Verify manager cannot see activities from other branches

---

## Files Changed

### Backend Code
- `backend/src/modules/ats/recruiter-hiring.routes.ts`
  - Line 31: Added manager roles to requireRole()
  - Lines 80-90: Added manager relationship check in ensureRowAccess()

### Database
- `backend/sql/999_ats_hiring_entry_manager_access.sql` (new file)

---

## Rollback Procedure

If issues occur:

### 1. Rollback Database
```sql
DELETE FROM role_page_access
WHERE role_key IN ('manager', 'process_manager', 'team_leader')
  AND page_code = 'ATS_RECRUITER_QUEUE';
```

### 2. Rollback Code
```bash
git revert <commit-hash>
cd backend && npm run build
pm2 restart hrms-backend
```

---

## Success Criteria

- ✅ Manager users can access `/ats/recruiter/hiring-entry`
- ✅ Managers see only their team's hiring activities
- ✅ HR roles (branch_hr, ho_hr, hr_admin) have access
- ✅ Existing recruiter access unchanged
- ✅ Non-authorized roles still blocked
- ✅ No 500 errors in PM2 logs
- ✅ Frontend navigation shows "Hiring Entry" link for managers

---

## Support Contact

If deployment issues arise:
- Check PM2 logs: `pm2 logs hrms-backend --lines 100`
- Check MySQL access: `SELECT * FROM role_page_access WHERE page_code = 'ATS_RECRUITER_QUEUE';`
- Verify user roles: `SELECT * FROM user_roles WHERE user_id = '<user-id>';`
- Check middleware logs in backend console for authorization failures

---

**Estimated Deployment Time**: 10-15 minutes  
**Downtime Required**: None (rolling restart)  
**Risk Level**: Low (additive changes only, no data modification)
