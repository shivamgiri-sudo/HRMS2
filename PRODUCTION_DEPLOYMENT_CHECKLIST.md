# Production Deployment Checklist

**Date:** 2026-06-07  
**Status:** ⚠️ Backend needs database access configuration

---

## ✅ **COMPLETED:**

### **1. Code Deployed to GitHub ✅**
- Commit: `fec6e79`
- Branch: `main`
- Includes: Employee sync + password reset + all features

### **2. Frontend Deployed to Vercel ✅**
- URL: https://hrms-1-xi.vercel.app/auth
- Status: Working
- Features: Login, forgot password UI functional

### **3. Database Migrations ✅**
All migrations already applied on production database (122.184.128.90):
- ✅ 062_employees_legacy_fields.sql (partial - columns exist)
- ✅ 063_password_reset.sql (password_reset_tokens table exists)
- ✅ 064_leave_legacy_sync.sql (leave_request has legacy columns)
- ✅ 065_employee_loans.sql (employee_loans table exists)
- ✅ 066_employee_deductions.sql (employee_deductions_log table exists)

### **4. Data Synced ✅**
- ✅ 35,818 employees
- ✅ 70 loans
- ✅ 95 deductions

---

## ⚠️ **BLOCKING ISSUE:**

### **Problem: Backend Cannot Connect to Database**

**Error:**
```
Access denied for user 'Shivam_user'@'34.145.131.166' (using password: YES)
```

**Root Cause:**
- Production backend hosted at IP: 34.145.131.166
- MySQL server (122.184.128.90) doesn't allow connections from this IP
- Database firewall/whitelist needs updating

---

## 🔧 **IMMEDIATE FIX REQUIRED:**

### **Option A: Whitelist Backend IP on Database Server (Recommended)**

**On MySQL server (122.184.128.90):**
```sql
-- Grant access to backend server IP
GRANT ALL PRIVILEGES ON mas_hrms.* 
TO 'shivam_user'@'34.145.131.166' 
IDENTIFIED BY 'qwersdfg!@#hjk';

FLUSH PRIVILEGES;
```

**OR update firewall rules to allow:**
- Source IP: 34.145.131.166
- Destination: 122.184.128.90:3306
- Protocol: TCP

---

### **Option B: Update Backend Environment Variables**

**If backend is using wrong credentials, update `.env`:**

```bash
# Database connection
DB_HOST=122.184.128.90
DB_PORT=3306
DB_USER=shivam_user
DB_PASSWORD=qwersdfg!@#hjk
DB_NAME=mas_hrms

# Legacy database
LEGACY_MYSQL_HOST=14.97.30.236
LEGACY_MYSQL_PORT=3306
LEGACY_MYSQL_USER=shivam_user
LEGACY_MYSQL_PASSWORD=qwersdfg!@#hjk
LEGACY_MYSQL_DATABASE=db_bill

# Disable legacy sync in production
LEGACY_SYNC_ENABLED=false
```

**Then restart backend service:**
```bash
pm2 restart hrms-backend
# OR
systemctl restart hrms-backend
```

---

## 📋 **VERIFICATION STEPS:**

### **After fixing database access:**

**1. Test password reset endpoint:**
```bash
curl -X POST https://hrms-1-xi.vercel.app/api/auth/forgot-password \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@shivu.ai"}'
```

**Expected response:**
```json
{
  "success": true,
  "message": "Password reset instructions sent to email",
  "debug_code": "123456"
}
```

**2. Test password reset code verification:**
```bash
curl -X POST https://hrms-1-xi.vercel.app/api/auth/verify-reset-code \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@shivu.ai","code":"123456"}'
```

**3. Test actual password reset:**
```bash
curl -X POST https://hrms-1-xi.vercel.app/api/auth/reset-password \
  -H "Content-Type: application/json" \
  -d '{"reset_token":"<from-step-2>","new_password":"NewPassword123"}'
```

**4. Test login with new password:**
```bash
curl -X POST https://hrms-1-xi.vercel.app/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"identifier":"admin@shivu.ai","password":"NewPassword123"}'
```

---

## 📊 **PRODUCTION READINESS:**

| Component | Status | Notes |
|-----------|--------|-------|
| Frontend Code | ✅ | Deployed on Vercel |
| Backend Code | ✅ | Deployed (commit fec6e79) |
| Database Schema | ✅ | All migrations applied |
| Database Data | ✅ | 35,983 records synced |
| Database Connection | ❌ | IP not whitelisted |
| Password Reset Endpoint | ⚠️ | Exists but can't connect to DB |
| Employee Login | ⚠️ | Same DB connection issue |

---

## 🎯 **NEXT STEPS:**

### **Immediate (Must do now):**
1. ⏳ **Whitelist backend IP (34.145.131.166) on MySQL server**
   - OR provide database credentials that work from this IP
   - OR configure VPN/tunnel if required

2. ⏳ **Restart backend service** (after DB access fixed)

3. ⏳ **Test password reset flow end-to-end**

4. ⏳ **Test employee login with Employee@123**

### **After Production Works:**
5. 📧 **Configure email sending** for password reset codes
   - Currently codes are logged to console (debug mode)
   - Need SMTP credentials in production .env:
     ```
     SMTP_HOST=smtp.gmail.com
     SMTP_PORT=587
     SMTP_USER=<your-email>
     SMTP_PASS=<app-password>
     SMTP_FROM=noreply@mascallnet.com
     ```

6. 🧪 **Load testing** with 2,089 active employees

7. 📱 **User acceptance testing** (UAT)

---

## 🔐 **SECURITY CHECKLIST:**

- ✅ Passwords hashed with bcrypt (10 rounds)
- ✅ JWT tokens for authentication
- ✅ Refresh token rotation
- ✅ Password reset with 6-digit codes
- ✅ 15-minute expiry on reset codes
- ✅ Inactive employee blocking
- ✅ Aadhaar data masked (last 4 digits)
- ⏳ HTTPS enabled (Vercel provides this)
- ⏳ CORS configured correctly
- ⏳ Rate limiting on auth endpoints (TODO)

---

## 📞 **WHO NEEDS TO DO WHAT:**

### **Backend/DevOps Team:**
1. Whitelist IP 34.145.131.166 on MySQL server (122.184.128.90)
2. Verify backend .env has correct DB credentials
3. Restart backend service after changes
4. Configure SMTP for email sending

### **Database Admin:**
```sql
-- Run this on MySQL server 122.184.128.90
GRANT ALL PRIVILEGES ON mas_hrms.* 
TO 'shivam_user'@'34.145.131.166' 
IDENTIFIED BY 'qwersdfg!@#hjk';

GRANT SELECT ON db_bill.* 
TO 'shivam_user'@'34.145.131.166';

FLUSH PRIVILEGES;

-- Verify
SELECT host, user FROM mysql.user WHERE user = 'shivam_user';
```

### **Testing Team:**
Once backend DB access is fixed:
1. Test password reset flow
2. Test employee login (Employee@123)
3. Test active vs inactive employee access
4. Test all 2,089 active employee accounts

---

## ✅ **SUCCESS CRITERIA:**

- [ ] Backend can connect to mas_hrms database
- [ ] Password reset endpoint returns success (not 500 error)
- [ ] Employees can reset password via 6-digit code
- [ ] Employees can login with new password
- [ ] Active employees can access system
- [ ] Inactive employees are blocked
- [ ] All 35,818 employees visible in database
- [ ] No errors in backend logs

---

## 📝 **CURRENT DEPLOYMENT STATUS:**

**Working:**
✅ Frontend UI  
✅ Backend API (code deployed)  
✅ Database schema  
✅ Data migration (35,983 records)

**Blocked:**
❌ Database connectivity (IP whitelist issue)

**Estimated Fix Time:** 10-15 minutes (after DB access granted)

---

**Last Updated:** 2026-06-07 12:15 PM  
**Next Review:** After database access is configured
