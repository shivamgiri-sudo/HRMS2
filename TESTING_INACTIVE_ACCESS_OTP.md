# Testing Guide: Inactive Employee Access & SMS OTP Authentication

## Overview
This document provides step-by-step testing procedures for the newly implemented features:
1. **Inactive Employee Read-Only Access** (90-day grace period)
2. **SMS/OTP Password Reset** (for email-less employees)

---

## Prerequisites

### 1. Database Migration
**Run the migration first:**

```bash
# Connect to your MySQL database
mysql -u [username] -p [database_name]

# Run the migration
source backend/sql/215_inactive_access_and_otp_auth.sql
```

**Verify migration success:**
```sql
-- Check new columns exist
SHOW COLUMNS FROM employees LIKE 'access_end_date';

-- Check new tables exist
SHOW TABLES LIKE 'auth_inactive_access_log';
SHOW TABLES LIKE 'auth_password_reset_otp';

-- Check trigger exists
SHOW TRIGGERS WHERE `Trigger` = 'set_access_end_date_on_inactive';
```

### 2. SMS Provider Configuration
Ensure your SMS provider is configured in the `provider_config` table:

```sql
SELECT * FROM provider_config WHERE channel = 'sms' AND active_status = 1;
```

If not configured, the system will log OTP to console instead of sending SMS.

---

## Test Scenario 1: Inactive Employee Read-Only Access

### Setup
1. **Select a test employee:**
```sql
SELECT id, employee_code, full_name, email, active_status, access_end_date 
FROM employees 
WHERE employee_code = 'TEST001' -- Replace with your test employee code
LIMIT 1;
```

2. **Make employee inactive with grace period:**
```sql
UPDATE employees 
SET active_status = 0 
WHERE employee_code = 'TEST001';
```

The database trigger will automatically set `access_end_date` to 90 days from today.

3. **Verify grace period was set:**
```sql
SELECT employee_code, active_status, access_end_date, 
       DATEDIFF(access_end_date, CURDATE()) as days_remaining
FROM employees 
WHERE employee_code = 'TEST001';
```
Expected: `days_remaining` should be 90.

---

### Test 1.1: Login Within Grace Period

**Action:** Login with the inactive employee's credentials.

**Frontend URL:** `http://localhost:5173/login`

**Expected Results:**
- ✅ Login succeeds
- ✅ Amber banner appears at top: "Your account is in read-only mode..."
- ✅ User can navigate to Dashboard, Profile, Leaves, Documents

**Verify in Database:**
```sql
SELECT * FROM auth_inactive_access_log 
WHERE employee_id = (SELECT id FROM employees WHERE employee_code = 'TEST001')
ORDER BY login_at DESC 
LIMIT 1;
```
Expected: New row with `access_granted = 1`.

---

### Test 1.2: Write Operations Blocked (Frontend)

**While logged in as read-only user:**

**Test Profile Edit:**
1. Navigate to Profile page
2. Click "Edit" button
3. **Expected:** Button is disabled and shows "Read-Only"

**Test Leave Application:**
1. Navigate to Leaves tab
2. Scroll to "Request Time Off" section
3. **Expected:** 
   - Amber alert: "Your account is in read-only mode. You cannot submit leave requests."
   - Submit button disabled and shows "Cannot Submit (Read-Only)"

**Test Document Upload:**
1. Navigate to Documents tab
2. **Expected:** Upload section is hidden (no file input or upload button)

---

### Test 1.3: Write Operations Blocked (Backend API)

**Using curl or Postman:**

1. **Get access token:**
```bash
# Login as inactive employee
curl -X POST http://localhost:5055/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "TEST001",
    "password": "your_password"
  }'
```

Copy the `accessToken` from response.

2. **Try to submit leave request:**
```bash
curl -X POST http://localhost:5055/api/leave/requests \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "some-leave-type-id",
    "fromDate": "2026-06-25",
    "toDate": "2026-06-25",
    "reason": "Test leave request"
  }'
```

**Expected Response:**
```json
{
  "success": false,
  "error": "Write access denied. Your account is in read-only mode.",
  "code": "READ_ONLY_ACCESS"
}
```
HTTP Status: 403

3. **Try to update profile:**
```bash
curl -X PATCH http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "personal_email": "test@example.com"
  }'
```

**Expected:** Same 403 error with "READ_ONLY_ACCESS" code.

---

### Test 1.4: Read Operations Allowed

**While logged in as read-only user, verify these work:**

- ✅ View Dashboard
- ✅ View Profile (all tabs)
- ✅ View Payslips
- ✅ Download Payslips
- ✅ View Leave Balance
- ✅ View Leave History
- ✅ View Documents
- ✅ Download Documents
- ✅ View Attendance History

**API Test - Get Profile:**
```bash
curl -X GET http://localhost:5055/api/employees/me \
  -H "Authorization: Bearer YOUR_ACCESS_TOKEN"
```

**Expected:** 200 OK with profile data.

---

### Test 1.5: Login After Grace Period Expires

1. **Manually expire the grace period:**
```sql
UPDATE employees 
SET access_end_date = DATE_SUB(CURDATE(), INTERVAL 1 DAY) 
WHERE employee_code = 'TEST001';
```

2. **Try to login:**

**Expected Results:**
- ❌ Login fails
- Error message: "Account is inactive. Access period has ended. Contact HR for assistance."

**Verify in Database:**
```sql
SELECT * FROM auth_inactive_access_log 
WHERE employee_id = (SELECT id FROM employees WHERE employee_code = 'TEST001')
ORDER BY login_at DESC 
LIMIT 1;
```
Expected: New row with `access_granted = 0` and `denial_reason` filled.

---

## Test Scenario 2: SMS/OTP Password Reset

### Setup

1. **Select a test employee with phone number:**
```sql
SELECT id, employee_code, full_name, phone_primary, active_status 
FROM employees 
WHERE phone_primary IS NOT NULL 
  AND phone_primary != ''
LIMIT 1;
```

2. **Ensure employee has a user account:**
```sql
SELECT e.employee_code, e.phone_primary, u.email 
FROM employees e
LEFT JOIN auth_user u ON u.id = e.user_id
WHERE e.employee_code = 'EMP002' -- Replace with your test employee
LIMIT 1;
```

---

### Test 2.1: Request OTP (Frontend)

**Action:**
1. Navigate to login page: `http://localhost:5173/login`
2. Click "Forgot password?"
3. Click "SMS/OTP" tab
4. Enter phone number: `9876543210` (use employee's actual phone)
5. Click "Send OTP"

**Expected Results:**
- ✅ Success toast: "OTP sent to your registered mobile number."
- ✅ Form advances to OTP verification step
- ✅ Shows OTP input field and new password field

**Check Database:**
```sql
SELECT phone, otp_code, expires_at, verified, created_at 
FROM auth_password_reset_otp 
WHERE phone LIKE '%9876543210%' 
ORDER BY created_at DESC 
LIMIT 1;
```
Expected: New row with `verified = 0`.

**Check SMS:**
- If SMS provider configured: Check phone for SMS
- If not configured: Check backend console logs for OTP

---

### Test 2.2: Verify OTP and Reset Password

**Action:**
1. Enter the 6-digit OTP from SMS (or console)
2. Enter new password: `NewSecure@123`
3. Click "Reset Password"

**Expected Results:**
- ✅ Success toast: "Password reset successful. Please login."
- ✅ Form returns to login screen

**Verify in Database:**
```sql
-- Check OTP marked as verified
SELECT phone, otp_code, verified 
FROM auth_password_reset_otp 
WHERE phone LIKE '%9876543210%' 
ORDER BY created_at DESC 
LIMIT 1;
```
Expected: `verified = 1`.

```sql
-- Check password was updated
SELECT email, password_changed_at, must_change_password 
FROM auth_user 
WHERE id = (SELECT user_id FROM employees WHERE phone_primary LIKE '%9876543210%' LIMIT 1);
```
Expected: 
- `password_changed_at` is recent
- `must_change_password = 0`

---

### Test 2.3: Login with New Password

**Action:** Login with employee code and new password.

**Expected Results:**
- ✅ Login succeeds
- ✅ User can access dashboard

---

### Test 2.4: Invalid/Expired OTP

**Test Invalid OTP:**
1. Request OTP again
2. Enter wrong OTP: `000000`
3. Click "Reset Password"

**Expected:** Error toast: "Invalid or expired OTP"

**Test Expired OTP:**
```sql
-- Manually expire an OTP
UPDATE auth_password_reset_otp 
SET expires_at = DATE_SUB(NOW(), INTERVAL 1 HOUR) 
WHERE phone LIKE '%9876543210%' 
  AND verified = 0 
ORDER BY created_at DESC 
LIMIT 1;
```

Try to verify with correct OTP.

**Expected:** Error: "Invalid or expired OTP"

---

### Test 2.5: OTP Security - Single Use

1. Request OTP
2. Reset password successfully
3. **Try to reuse the same OTP:**
   - Request new password reset with same phone
   - Enter the **old OTP** (already verified)
   - Click "Reset Password"

**Expected:** Error: "Invalid or expired OTP"

Database should show `verified = 1` for old OTP, preventing reuse.

---

## Test Scenario 3: Inactive Employee + OTP Reset

**Combined test:**

1. Set employee as inactive (within grace period)
2. Use SMS/OTP to reset password
3. Login with new password
4. Verify read-only mode is active

**Expected:**
- ✅ All OTP steps work for inactive employee
- ✅ After login, read-only banner appears
- ✅ Write operations blocked

---

## Test Scenario 4: Email vs SMS Reset Comparison

**Test switching between channels:**

1. Click "Forgot password?"
2. Click "Email" tab
3. Enter email address
4. Click "Send Link"
5. **Expected:** "If this email is registered, you will receive a reset link."

6. Go back, click "SMS/OTP" tab
7. Enter phone number
8. Click "Send OTP"
9. **Expected:** Advances to OTP verification

**Both channels should work independently.**

---

## Rollback Procedures

### If Issues Found

**1. Disable feature temporarily:**
```sql
-- Remove grace period for all inactive employees
UPDATE employees SET access_end_date = NULL WHERE active_status = 0;
```

**2. Revert migration (if needed):**
```sql
-- Drop trigger
DROP TRIGGER IF EXISTS set_access_end_date_on_inactive;

-- Drop tables
DROP TABLE IF EXISTS auth_password_reset_otp;
DROP TABLE IF EXISTS auth_inactive_access_log;

-- Remove column
ALTER TABLE employees DROP COLUMN access_end_date;
```

**3. Restore old authentication flow:**
Revert changes to `auth.service.ts`, `authMiddleware.ts`, and routes.

---

## Production Checklist

Before deploying to production:

- [ ] Run migration on production database (during maintenance window)
- [ ] Verify SMS provider is configured and working
- [ ] Test with real employee accounts in staging
- [ ] Confirm all write endpoints are protected
- [ ] Verify audit logs are being captured
- [ ] Test grace period expiry behavior
- [ ] Inform HR team about new features
- [ ] Update employee documentation
- [ ] Monitor error logs for first 48 hours
- [ ] Set up alerts for:
  - Failed OTP deliveries
  - Suspicious inactive access patterns (>10 logins/day)
  - Grace period expiry notifications

---

## Troubleshooting

### OTP Not Received

**Check:**
1. SMS provider configuration in database
2. Backend console logs for OTP
3. Phone number format in database
4. SMS provider credits/balance

**Debug Query:**
```sql
SELECT * FROM auth_password_reset_otp 
WHERE phone LIKE '%[last_4_digits]%' 
ORDER BY created_at DESC 
LIMIT 5;
```

### Read-Only Mode Not Working

**Check:**
1. JWT token payload contains `isReadOnly: true`
   - Decode token at jwt.io
2. Frontend `useIsReadOnly()` hook is used
3. Backend middleware applied to routes

**Debug:**
```javascript
// In browser console
const token = localStorage.getItem('hrms_access_token');
const payload = JSON.parse(atob(token.split('.')[1]));
console.log('isReadOnly:', payload.isReadOnly);
```

### Grace Period Not Auto-Setting

**Check trigger:**
```sql
SHOW TRIGGERS WHERE `Trigger` = 'set_access_end_date_on_inactive';
```

**Manually test trigger:**
```sql
-- Set employee active first
UPDATE employees SET active_status = 1 WHERE employee_code = 'TEST001';

-- Set inactive (trigger should fire)
UPDATE employees SET active_status = 0 WHERE employee_code = 'TEST001';

-- Check result
SELECT access_end_date FROM employees WHERE employee_code = 'TEST001';
```

---

## Success Metrics

After deployment, track:

- **Inactive Employee Logins:** Count of `auth_inactive_access_log` entries
- **OTP Success Rate:** `verified = 1` / total OTPs sent
- **Read-Only Violations:** 403 errors with `READ_ONLY_ACCESS` code
- **Grace Period Usage:** Average days before access expires
- **HR Support Tickets:** Reduction in "can't access payslip" tickets

---

## Contact

For issues or questions, contact: [Your Support Team]

**Implementation completed:** 2026-06-18
