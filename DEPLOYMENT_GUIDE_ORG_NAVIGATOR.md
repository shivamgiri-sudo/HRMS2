# PeopleOS Org Navigator — Deployment & Testing Guide

**Status:** ✅ Phase 1 Complete — Ready for Staging Deployment  
**Date:** 2026-07-13  
**Feature:** Dynamic org chart with 5-level scope system + data quality validation

---

## 📋 Pre-Deployment Checklist

### ✅ Files Verified
- [x] Backend module: `backend/src/modules/org-chart/` (6 files)
- [x] Frontend components: `src/components/org-chart/` (4 files)
- [x] Frontend pages: `src/pages/OrgChartSettings.tsx`, `NativeOrgChartEnhanced.tsx`
- [x] Migration: `backend/sql/migrations/402_org_chart_foundation.sql`
- [x] Routes mounted: `backend/src/app.ts` (line 190, 329)
- [x] Frontend routes: `src/App.tsx` (line 126, 344)

### ⚠️ NOT Applied Yet
- [ ] Database migration NOT applied to any environment
- [ ] No testing performed yet
- [ ] Existing `/api/employees/org-tree` route kept intact (parallel implementation)

---

## 🚀 Deployment Steps

### **Step 1: Backup Database**
```bash
# Backup production database BEFORE migration
mysqldump -u root -p mas_hrms > backup_mas_hrms_$(date +%Y%m%d_%H%M%S).sql

# Verify backup
ls -lh backup_mas_hrms_*.sql
```

### **Step 2: Apply Migration (Staging First)**
```bash
# Connect to STAGING MySQL
mysql -u root -p mas_hrms

# Run migration
SOURCE /path/to/backend/sql/migrations/402_org_chart_foundation.sql;

# Verify tables created
SHOW TABLES LIKE 'org_chart%';
# Expected: org_chart_snapshot, org_chart_access_log, org_chart_override, org_chart_data_issue

# Verify indexes
SHOW INDEX FROM org_chart_access_log;
SHOW INDEX FROM org_chart_snapshot;

# Exit
EXIT;
```

### **Step 3: Restart Backend (Staging)**
```bash
cd backend

# If using PM2
pm2 restart mcn-hrms-backend

# Or if running manually
npm run dev

# Check logs for errors
tail -f backend.log

# Look for successful mount
# Expected: No errors related to org-chart routes
```

### **Step 4: Verify Backend Endpoints (Staging)**
```bash
# Get auth token (replace with valid credentials)
TOKEN="<your-jwt-token>"

# Test 1: Get available scopes
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/org-chart/scopes

# Expected response:
# {
#   "success": true,
#   "data": {
#     "available_scopes": [...],
#     "default_scope": "my-chain",
#     "current_employee": {...}
#   }
# }

# Test 2: Get org tree (company scope - admin only)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/org-chart/tree?scope=company&status=active"

# Expected: Tree structure with nodes, edges, data_quality

# Test 3: Get data quality report (HR/Admin only)
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/org-chart/data-quality

# Expected: Summary with issues array

# Test 4: Search (within scope)
curl -H "Authorization: Bearer $TOKEN" "http://localhost:3000/api/org-chart/search?q=manager&scope=process"

# Expected: Search results array
```

### **Step 5: Test Frontend (Staging)**
1. **Navigate to org chart page:**
   - URL: `http://localhost:5173/org-chart`
   - Expected: Scope selector appears with available scopes
   - Expected: Tree renders for default scope

2. **Test scope switching:**
   - Change scope dropdown
   - Expected: Tree reloads with new scope data

3. **Test filters (if company/branch/process scope):**
   - Apply branch/process filter
   - Expected: Tree filters correctly

4. **Test node click:**
   - Click on any employee node
   - Expected: Side drawer opens with details

5. **Test data quality panel (HR/Admin only):**
   - Expected: Panel shows confidence score + issues
   - Click severity filter
   - Expected: Issues filter by severity

6. **Test settings page:**
   - Navigate to `/org-chart/settings`
   - Change default scope
   - Click "Save Changes"
   - Expected: Toast confirmation

---

## 🧪 Testing Matrix

### **Test 1: Scope Access Control**

| User Role | Available Scopes | Expected Behavior |
|---|---|---|
| **Employee** | my-chain | Can only see self + managers + direct reports |
| **Team Leader** | my-chain, my-team | Can see own team + manager chain |
| **Process Manager** | my-chain, my-team, process | Can see entire process |
| **Branch Head** | my-chain, my-team, branch | Can see entire branch |
| **HR / Admin / CEO** | all 5 scopes | Can see entire company |

**Test Commands:**
```bash
# As Employee
curl -H "Authorization: Bearer <employee-token>" http://localhost:3000/api/org-chart/scopes
# Expected: only "my-chain" in available_scopes

# As Process Manager
curl -H "Authorization: Bearer <pm-token>" http://localhost:3000/api/org-chart/scopes
# Expected: "my-chain", "my-team", "process" in available_scopes

# As Admin
curl -H "Authorization: Bearer <admin-token>" http://localhost:3000/api/org-chart/scopes
# Expected: all 5 scopes + can_export: true + can_see_data_quality: true
```

### **Test 2: Data Quality Validation**

Create test data with known issues:

```sql
-- Test missing manager
UPDATE employees SET reporting_manager_id = NULL WHERE employee_code = 'TEST001' LIMIT 1;

-- Test inactive manager
UPDATE employees SET active_status = 0 WHERE id = (
  SELECT reporting_manager_id FROM employees WHERE employee_code = 'TEST002' LIMIT 1
);

-- Test circular mapping (A→B, B→C, C→A)
-- DO NOT RUN ON PRODUCTION — FOR STAGING ONLY
```

**Test Commands:**
```bash
# Get data quality report
curl -H "Authorization: Bearer <admin-token>" http://localhost:3000/api/org-chart/data-quality

# Expected response:
# {
#   "success": true,
#   "data": {
#     "total_employees": 1240,
#     "issues_count": 17,
#     "critical_count": 2,
#     "high_count": 5,
#     "issues": [
#       {
#         "employee_name": "TEST001",
#         "issue_type": "missing_manager",
#         "severity": "high",
#         "suggested_fix": "Assign a valid reporting manager..."
#       }
#     ]
#   }
# }
```

### **Test 3: Security (Critical)**

**Test 403 Forbidden:**
```bash
# Employee tries to access company scope
curl -H "Authorization: Bearer <employee-token>" "http://localhost:3000/api/org-chart/tree?scope=company"
# Expected: 403 Forbidden

# Employee tries to access employee outside their chain
curl -H "Authorization: Bearer <employee-token>" http://localhost:3000/api/org-chart/node/<outside-employee-id>
# Expected: 403 Forbidden

# Employee tries to access data quality report
curl -H "Authorization: Bearer <employee-token>" http://localhost:3000/api/org-chart/data-quality
# Expected: 403 Access denied
```

**Test PII Protection:**
```bash
# Get org tree
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/org-chart/tree?scope=process"

# Verify response does NOT contain:
# - salary / ctc_annual
# - pan_number
# - aadhaar_number
# - bank_name / account_number
# - date_of_birth
# - personal_mobile (unless self)

# Expected: Only safe fields (name, designation, branch, process, employee_code_masked)
```

**Test Client Portal Block:**
```bash
# Try to access from client portal (if client portal auth exists)
curl -H "Authorization: Bearer <client-portal-token>" http://localhost:3000/api/org-chart/scopes
# Expected: 401 or 403 (client portal should be blocked from org chart entirely)
```

### **Test 4: Audit Logging**

```sql
-- Check audit logs after testing
SELECT * FROM org_chart_access_log ORDER BY accessed_at DESC LIMIT 20;

-- Expected columns populated:
-- user_id, action_type, scope_type, scope_id, ip_address, accessed_at
```

### **Test 5: Performance**

```bash
# Large org tree (1000+ employees)
time curl -H "Authorization: Bearer <admin-token>" "http://localhost:3000/api/org-chart/tree?scope=company"

# Expected: < 3 seconds for 1000 employees
# If > 5 seconds, consider Phase 2 snapshot caching
```

### **Test 6: Edge Cases**

```bash
# Test 1: Employee with no manager (CEO)
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/org-chart/node/<ceo-employee-id>"
# Expected: reporting_chain = empty array, no warnings

# Test 2: Empty scope (new branch with no employees)
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/org-chart/tree?scope=branch&branch_id=<empty-branch-id>"
# Expected: nodes = [], no error

# Test 3: Invalid scope
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/org-chart/tree?scope=invalid"
# Expected: 403 Forbidden

# Test 4: Circular chain detection
# (Create circular chain in staging DB first)
curl -H "Authorization: Bearer <token>" "http://localhost:3000/api/org-chart/tree?scope=process"
# Expected: Tree renders without infinite loop, nodes have "circular chain broken" warning
```

---

## 🔥 Rollback Plan

### **If Migration Breaks Something:**

```sql
-- Connect to MySQL
mysql -u root -p mas_hrms

-- Drop new tables (ONLY if migration caused issues)
DROP TABLE IF EXISTS org_chart_snapshot;
DROP TABLE IF EXISTS org_chart_access_log;
DROP TABLE IF EXISTS org_chart_override;
DROP TABLE IF EXISTS org_chart_data_issue;

-- Exit
EXIT;
```

### **If Backend Breaks:**

1. **Comment out route in `backend/src/app.ts`:**
   ```typescript
   // app.use("/api/org-chart", orgChartRouter);
   ```

2. **Comment out import:**
   ```typescript
   // import { orgChartRouter } from "./modules/org-chart/org-chart.routes.js";
   ```

3. **Restart backend:**
   ```bash
   pm2 restart mcn-hrms-backend
   ```

4. **Verify existing org chart still works:**
   ```bash
   curl -H "Authorization: Bearer <token>" http://localhost:3000/api/employees/org-tree
   # Expected: Old org tree API still functional
   ```

### **If Frontend Breaks:**

1. **Revert `src/App.tsx` changes:**
   - Remove `OrgChartSettings` import
   - Remove `/org-chart/settings` route

2. **Clear browser cache:**
   ```bash
   # In browser DevTools Console:
   localStorage.clear();
   location.reload();
   ```

---

## ✅ Production Deployment Checklist

### **Pre-Production**
- [ ] All staging tests passed
- [ ] Security tests passed (403, PII protection, client portal block)
- [ ] Data quality validation working
- [ ] Audit logging verified
- [ ] Performance acceptable (< 3s for company scope)
- [ ] User acceptance testing complete
- [ ] Rollback plan tested on staging

### **Production Deployment**
- [ ] Backup production database
- [ ] Schedule maintenance window (optional — migration is additive)
- [ ] Apply migration to production MySQL
- [ ] Verify tables created
- [ ] Restart production backend (PM2 or manual)
- [ ] Verify endpoints respond correctly
- [ ] Check audit logs for errors
- [ ] Monitor backend.log for 10 minutes
- [ ] Test frontend org chart page
- [ ] Verify existing `/api/employees/org-tree` still works

### **Post-Deployment**
- [ ] Notify HR/Admin users of new features
- [ ] Monitor data quality reports
- [ ] Check audit logs daily for first week
- [ ] Gather user feedback
- [ ] Plan Phase 2 (export, cache, mini-map)

---

## 📊 Monitoring

### **Backend Logs**
```bash
# Watch for errors
tail -f backend/backend.log | grep -i "org-chart\|error"

# Check for 403/500 errors
grep "403\|500" backend/backend.log | grep "org-chart"
```

### **Database Metrics**
```sql
-- Audit log growth
SELECT COUNT(*), DATE(accessed_at) FROM org_chart_access_log GROUP BY DATE(accessed_at);

-- Most accessed scopes
SELECT scope_type, COUNT(*) FROM org_chart_access_log GROUP BY scope_type ORDER BY COUNT(*) DESC;

-- Data quality issues
SELECT issue_type, severity, COUNT(*) FROM org_chart_data_issue WHERE active_status = 1 GROUP BY issue_type, severity;
```

### **Performance Metrics**
```bash
# API response times (add to monitoring)
# Alert if > 5 seconds for company scope
# Alert if > 2 seconds for process scope
```

---

## 🐛 Troubleshooting

### **Issue: "orgChartRouter is not defined"**
**Cause:** Route import failed  
**Fix:**
```bash
# Check file exists
ls backend/src/modules/org-chart/org-chart.routes.ts

# Check for TypeScript errors
cd backend && npx tsc --noEmit

# Restart backend
pm2 restart mcn-hrms-backend
```

### **Issue: "Table org_chart_access_log doesn't exist"**
**Cause:** Migration not applied  
**Fix:**
```bash
mysql -u root -p mas_hrms < backend/sql/migrations/402_org_chart_foundation.sql
```

### **Issue: "403 Forbidden" for admin user**
**Cause:** User has no role assigned  
**Fix:**
```sql
SELECT * FROM user_roles WHERE user_id = '<user-id>';
-- If empty, assign role:
INSERT INTO user_roles (user_id, role_key, active_status) VALUES ('<user-id>', 'admin', 1);
```

### **Issue: Frontend "Cannot read property 'available_scopes'"**
**Cause:** API not returning expected structure  
**Fix:**
```bash
# Check API response
curl -H "Authorization: Bearer <token>" http://localhost:3000/api/org-chart/scopes

# Check browser console for errors
# Verify backend is running
pm2 status mcn-hrms-backend
```

### **Issue: Data quality panel not showing**
**Cause:** User doesn't have HR/Admin role  
**Expected:** Data quality panel only visible to HR/Admin/Super Admin

### **Issue: Circular chain causes infinite loop**
**Should not happen** — cycle detection is built-in  
**If it does:**
```sql
-- Find circular chains manually
SELECT e1.id, e1.employee_code, e1.reporting_manager_id,
       e2.id, e2.reporting_manager_id
FROM employees e1
JOIN employees e2 ON e2.id = e1.reporting_manager_id
WHERE e2.reporting_manager_id = e1.id;

-- Break the cycle by updating one employee
UPDATE employees SET reporting_manager_id = NULL WHERE id = '<employee-id>' LIMIT 1;
```

---

## 📞 Support

**If deployment fails:**
1. Check `backend/backend.log` for errors
2. Run rollback plan (see above)
3. Revert to existing `/api/employees/org-tree` endpoint
4. Report issue with logs

**Phase 2 Features (Not in this deployment):**
- Export to Excel/PDF
- Cache/snapshot rebuild
- Mini-map component
- Manual overrides (hide employee)
- Layout direction toggle (left-right mode)

---

## ✅ Deployment Sign-Off

**Staging Deployment:**
- [ ] Tested by: ________________
- [ ] Date: ________________
- [ ] All tests passed: Yes / No
- [ ] Issues found: ________________

**Production Deployment:**
- [ ] Approved by: ________________
- [ ] Date: ________________
- [ ] Backup confirmed: Yes / No
- [ ] Migration applied: Yes / No
- [ ] Rollback plan ready: Yes / No

---

**END OF DEPLOYMENT GUIDE**
