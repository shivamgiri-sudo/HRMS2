# Employee Access Control - Active vs Inactive Status

**Date:** 2026-06-07  
**Security Level:** ✅ ENFORCED

---

## 📊 Employee Status Breakdown

| Status | Count | Login Access | System Access |
|--------|-------|--------------|---------------|
| **ACTIVE** | **2,089** | ✅ **Allowed** | ✅ **Full access to all features** |
| **INACTIVE** | **33,717** | ❌ **BLOCKED** | ❌ **Cannot login - restricted** |

---

## 🔒 How Access Control Works

### Active Employees (active_status = 1)
**Can:**
- ✅ Login with email + password
- ✅ Access dashboard
- ✅ View profile
- ✅ Use attendance system
- ✅ Apply for leave
- ✅ View payslips
- ✅ Use all HRMS features

**Default Password:** `Employee@123`

---

### Inactive Employees (active_status = 0)
**Cannot:**
- ❌ Login to the system
- ❌ Access any pages
- ❌ Use any features

**When they try to login:**
```
Error: "Account is inactive. Please contact HR for assistance."
```

**Why inactive?**
- Resigned/Left the company
- On long leave
- Suspended
- Awaiting onboarding completion

---

## 🛡️ Technical Implementation

### Database Level
```sql
-- Active status is stored in employees table
ALTER TABLE employees ADD COLUMN active_status TINYINT(1) DEFAULT 1;

-- Synced from legacy database
-- legacy Status='1' → active_status=1 (Active)
-- legacy Status='0' → active_status=0 (Inactive)
```

### Authentication Level
```typescript
// backend/src/modules/auth/auth.service.ts
// Lines 30-48

async login(identifier: string, password: string) {
  // ... fetch user from database
  
  // Check if account is blocked
  if (user.is_blocked) {
    throw new Error('Account is blocked');
  }
  
  // CRITICAL: Check if employee is active
  if (user.active_status === 0) {
    throw new Error('Account is inactive. Please contact HR for assistance.');
  }
  
  // ... proceed with login
}
```

---

## 🔄 Activating/Deactivating Employees

### HR Admin Can Activate Employee
```sql
-- Make employee active
UPDATE employees 
SET active_status = 1, updated_at = NOW()
WHERE employee_code = 'MAS00001';

-- Employee can now login immediately
```

### HR Admin Can Deactivate Employee
```sql
-- Make employee inactive
UPDATE employees 
SET active_status = 0, updated_at = NOW()
WHERE employee_code = 'MAS00001';

-- Employee is immediately blocked from login
-- Existing sessions remain valid until token expires (15 minutes)
```

---

## 📋 Common Scenarios

### Scenario 1: Employee Resigns
1. HR updates employee status to inactive
2. Employee cannot login anymore
3. Data remains in database for records
4. Can be reactivated if employee rejoins

### Scenario 2: New Employee Onboarding
1. Employee synced from legacy with active_status=0
2. After completing onboarding, HR activates account
3. Employee receives welcome email with credentials
4. Can login immediately

### Scenario 3: Temporary Suspension
1. HR deactivates account
2. Employee blocked during investigation
3. HR reactivates after resolution
4. Employee regains full access

---

## 🧪 Testing Access Control

### Test 1: Active Employee Login (Should Work)
```bash
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "active-employee@company.com",
    "password": "Employee@123"
  }'

# Expected: 200 OK with JWT token
```

### Test 2: Inactive Employee Login (Should Fail)
```bash
curl -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "inactive-employee@company.com",
    "password": "Employee@123"
  }'

# Expected: 401 Unauthorized
# Message: "Account is inactive. Please contact HR for assistance."
```

### Test 3: Verify Status in Database
```sql
-- Check specific employee
SELECT 
  employee_code,
  CONCAT(first_name, ' ', COALESCE(last_name, '')) as name,
  email,
  active_status,
  CASE 
    WHEN active_status = 1 THEN '✅ Can Login'
    WHEN active_status = 0 THEN '❌ Login Blocked'
  END as login_access
FROM employees
WHERE employee_code = 'MAS00001';
```

---

## 🚨 Security Notes

### 1. **Inactive ≠ Deleted**
- Inactive employees are NOT deleted
- Data preserved for compliance/audit
- Can be reactivated anytime

### 2. **Session Handling**
- Existing sessions remain valid until token expires
- Access token expires in 15 minutes
- Refresh token expires in 7 days
- Deactivating employee won't kick out active sessions immediately

### 3. **Bulk Operations**
```sql
-- Deactivate all employees from specific branch
UPDATE employees 
SET active_status = 0, updated_at = NOW()
WHERE branch = 'Mumbai' AND active_status = 1;

-- Reactivate specific employee codes
UPDATE employees 
SET active_status = 1, updated_at = NOW()
WHERE employee_code IN ('MAS00001', 'MAS00002', 'MAS00003');
```

---

## 📊 Audit & Monitoring

### Track Login Attempts
```sql
-- See who tried to login (including blocked attempts)
SELECT 
  au.email,
  e.active_status,
  au.last_login_at,
  CASE 
    WHEN e.active_status = 1 THEN 'Login Allowed'
    WHEN e.active_status = 0 THEN 'Login Blocked'
  END as access_status
FROM auth_user au
JOIN employees e ON e.id = au.id
WHERE au.last_login_at > DATE_SUB(NOW(), INTERVAL 24 HOUR)
ORDER BY au.last_login_at DESC;
```

### Count Login-Enabled Employees
```sql
SELECT 
  COUNT(*) as total_employees,
  SUM(CASE WHEN active_status = 1 THEN 1 ELSE 0 END) as can_login,
  SUM(CASE WHEN active_status = 0 THEN 1 ELSE 0 END) as blocked,
  ROUND(SUM(CASE WHEN active_status = 1 THEN 1 ELSE 0 END) * 100.0 / COUNT(*), 2) as active_percentage
FROM employees
WHERE legacy_emp_id IS NOT NULL;
```

**Current Stats:**
- Total: 35,806 employees
- Can Login: 2,089 (5.8%)
- Blocked: 33,717 (94.2%)

---

## 🔧 HR Admin Controls (Future Enhancement)

### Recommended UI Features:
1. **Employee List Page**
   - Show active/inactive status badge
   - Toggle switch to activate/deactivate
   - Bulk actions for status change

2. **Employee Profile Page**
   - Status indicator (Active/Inactive)
   - "Deactivate Account" button (with confirmation)
   - Reason field for deactivation

3. **Reports**
   - Active employees count
   - Recently deactivated employees
   - Login attempts by inactive users

---

## 📞 Support Information

### For Inactive Employees:
**Error Message:** "Account is inactive. Please contact HR for assistance."

**What to do:**
1. Contact HR department
2. Verify employment status
3. Request account activation if eligible
4. Wait for HR to update status
5. Try logging in again

### For HR Admin:
**Activate Employee:**
```sql
UPDATE employees SET active_status = 1 WHERE employee_code = '<CODE>';
```

**Deactivate Employee:**
```sql
UPDATE employees SET active_status = 0 WHERE employee_code = '<CODE>';
```

---

## ✅ Summary

| Feature | Status | Notes |
|---------|--------|-------|
| Active Status Check | ✅ **ENFORCED** | Checked during login |
| Inactive User Block | ✅ **WORKING** | Clear error message |
| Database Sync | ✅ **AUTOMATIC** | Status synced from legacy |
| HR Controls | ⏳ **TODO** | UI for status management |
| Audit Logging | ⏳ **TODO** | Track status changes |

**🔒 System Security: ACTIVE EMPLOYEES ONLY CAN LOGIN! 🔒**

---

**Last Updated:** 2026-06-07  
**Status:** ✅ OPERATIONAL - Access control fully enforced
