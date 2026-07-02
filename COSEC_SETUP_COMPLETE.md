# COSEC Connector - Setup Complete ✅

**Date:** June 15, 2026  
**Status:** Configured & Ready to Test

---

## 🎯 Configuration Summary

### **COSEC Database Details:**
```
Host:     14.97.30.234
Port:     1433 (SQL Server)
User:     shivamg
Password: ************ (configured)
Database: NCOSEC
Encrypt:  false
```

### **What Was Done:**

1. ✅ **Credentials Added** to `backend/.env`
   ```bash
   NCOSEC_DB_HOST=14.97.30.234
   NCOSEC_DB_PORT=1433
   NCOSEC_DB_USER=shivamg
   NCOSEC_DB_PASSWORD=<set-securely-in-backend-env>
   NCOSEC_DB_NAME=NCOSEC
   NCOSEC_DB_ENCRYPT=false
   ```

2. ✅ **Test Script Created** - `backend/scripts/test-cosec-connection.ts`

3. ✅ **Infrastructure Ready:**
   - Database connection module (`backend/src/db/ncosecDb.ts`)
   - Migration script (`backend/scripts/migrate-ncosec-biometric.ts`)
   - Biometric routes (`backend/src/modules/wfm/biometric-punch.routes.ts`)

---

## 🚀 Next Steps

### **Step 1: Test Connection**

**IMPORTANT:** You may need to be on VPN or office network to access 14.97.30.234

```bash
cd /home/shuvam/hrms-audit/backend

# Run connection test
npx tsx scripts/test-cosec-connection.ts
```

**Expected Output (if successful):**
```
┌────────────────────────────────────────────┐
│  COSEC Database Connection Test            │
└────────────────────────────────────────────┘

Configuration:
  Host:     14.97.30.234
  Port:     1433
  User:     shivamg
  Password: ************
  Database: NCOSEC
  Encrypt:  false

[1/4] Connecting to COSEC SQL Server...
✓ Connected successfully!

[2/4] Testing basic query...
✓ Basic query successful

[3/4] Checking required tables...
✓ Required tables found:
  - Mx_ATDEventTrn
  - Mx_UserMst

[4/4] Checking recent attendance data...
✓ Recent data (last 7 days):
  Total Events:   1,234
  Unique Users:   156
  Earliest Event: 2026-06-08 08:00:00
  Latest Event:   2026-06-15 17:30:00

┌────────────────────────────────────────────┐
│  ✅ ALL TESTS PASSED!                     │
│  COSEC database is ready for migration.   │
└────────────────────────────────────────────┘
```

---

### **Step 2: Run Migration (Once Test Passes)**

```bash
cd /home/shuvam/hrms-audit/backend

# Migrate biometric attendance data
npx tsx scripts/migrate-ncosec-biometric.ts
```

**What This Does:**
1. Fetches punch data from COSEC (last 30 days)
2. Maps COSEC UserID → HRMS Employee ID
3. Imports into:
   - `biometric_attendance_log` (raw punches)
   - `attendance_daily_record` (daily summary)
4. Auto-creates enrollment records for employees

**Expected Duration:** 2-5 minutes for 30 days of data

**Sample Output:**
```
┌─────────────────────────────────────────┐
│  NCOSEC → HRMS Biometric Migration      │
└─────────────────────────────────────────┘

[NCOSEC] Testing connection...
[NCOSEC] ✓ Connected to 14.97.30.234:1433
[HRMS] Building UserID → employee_id map...
[HRMS] Loaded 45 existing enrollment mappings
[HRMS] Fallback: matched 120 via employee_code

Migrating date range: 2026-05-16 to 2026-06-15 (31 days)

Day 1/31: 2026-05-16 ... 187 rows → 180 inserted, 7 updated
Day 2/31: 2026-05-17 ... 191 rows → 185 inserted, 6 updated
...
Day 31/31: 2026-06-15 ... 195 rows → 190 inserted, 5 updated

┌─────────────────────────────────────────┐
│  Migration Summary                      │
├─────────────────────────────────────────┤
│  Total COSEC rows:         5,823        │
│  Attendance inserted:      5,650        │
│  Attendance updated:       173          │
│  Employees not found:      3            │
└─────────────────────────────────────────┘

✓ Migration completed successfully!
```

---

### **Step 3: Verify Data in HRMS**

```bash
# Connect to HRMS MySQL
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms

# Check imported data
SELECT 
    COUNT(*) AS total_records,
    COUNT(DISTINCT employee_id) AS unique_employees,
    MIN(punch_date) AS earliest_date,
    MAX(punch_date) AS latest_date
FROM biometric_attendance_log;

# Check recent attendance
SELECT 
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) AS full_name,
    bal.punch_date,
    bal.first_punch_in,
    bal.last_punch_out,
    ROUND(bal.raw_minutes / 60, 2) AS hours_worked
FROM biometric_attendance_log bal
JOIN employees e ON e.id = bal.employee_id
WHERE bal.punch_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAYS)
ORDER BY bal.punch_date DESC, e.employee_code
LIMIT 20;

# Check enrollment status
SELECT 
    COUNT(*) AS enrolled_employees,
    COUNT(DISTINCT employee_id) AS unique_employees
FROM employee_biometric_enrollment
WHERE is_active = 1;
```

---

### **Step 4: Set Up Automated Daily Sync**

**Option A: Cron Job**
```bash
# Edit crontab
crontab -e

# Add daily sync at 1 AM
0 1 * * * cd /home/shuvam/hrms-audit/backend && npx tsx scripts/migrate-ncosec-biometric.ts >> /var/log/cosec-sync.log 2>&1
```

**Option B: Systemd Timer**
```bash
# Create service file
sudo nano /etc/systemd/system/cosec-sync.service

[Unit]
Description=COSEC Biometric Data Sync
After=network.target

[Service]
Type=oneshot
User=shuvam
WorkingDirectory=/home/shuvam/hrms-audit/backend
ExecStart=/usr/bin/npx tsx scripts/migrate-ncosec-biometric.ts
StandardOutput=journal
StandardError=journal

# Create timer file
sudo nano /etc/systemd/system/cosec-sync.timer

[Unit]
Description=Run COSEC sync daily at 1 AM

[Timer]
OnCalendar=*-*-* 01:00:00
Persistent=true

[Install]
WantedBy=timers.target

# Enable and start
sudo systemctl daemon-reload
sudo systemctl enable cosec-sync.timer
sudo systemctl start cosec-sync.timer

# Check status
sudo systemctl status cosec-sync.timer
```

---

## 🐛 Troubleshooting

### **Issue: Connection Timeout**

**Error:**
```
ConnectionError: Failed to connect to 14.97.30.234:1433 - timeout
```

**Solutions:**

1. **Check Network Connectivity:**
   ```bash
   ping 14.97.30.234
   ```

2. **Test Port:**
   ```bash
   nc -zv 14.97.30.234 1433
   # or
   telnet 14.97.30.234 1433
   ```

3. **Connect to VPN:**
   - The COSEC server might be on a private network
   - Connect to company VPN before running tests

4. **Check from Office Network:**
   - Try running the test from a machine on the office network

---

### **Issue: Login Failed**

**Error:**
```
Login failed for user 'shivamg'
```

**Solutions:**

1. **Verify Credentials:**
   ```bash
   # Check .env file
   cat backend/.env | grep NCOSEC
   ```

2. **Test on SQL Server Management Studio:**
   - Open SSMS
   - Connect to: 14.97.30.234,1433
   - Authentication: SQL Server Authentication
   - Login: shivamg
   - Password: use the rotated credential stored securely in `backend/.env`

3. **Check User Permissions:**
   ```sql
   -- Run on COSEC server
   USE NCOSEC;
   EXEC sp_helpuser 'shivamg';
   ```

4. **Verify SQL Authentication Enabled:**
   - SQL Server might be set to Windows auth only
   - Contact DBA to enable mixed mode authentication

---

### **Issue: Database Not Found**

**Error:**
```
Cannot open database "NCOSEC" requested by the login
```

**Solutions:**

1. **List Available Databases:**
   ```sql
   -- After connecting to master
   SELECT name FROM sys.databases;
   ```

2. **Try Different Database Name:**
   ```bash
   # Update .env if database name is different
   NCOSEC_DB_NAME=ActualDatabaseName
   ```

3. **Grant Access:**
   ```sql
   -- Run by DBA
   USE NCOSEC;
   CREATE USER shivamg FOR LOGIN shivamg;
   GRANT SELECT ON Mx_ATDEventTrn TO shivamg;
   GRANT SELECT ON Mx_UserMst TO shivamg;
   ```

---

### **Issue: No Data Found**

**Error:**
```
Employees not found: [MAS001, MAS002, ...]
```

**Solution: Create Enrollment Mappings**

**Option 1: Auto-enroll all employees**
```sql
-- Connect to HRMS MySQL
INSERT INTO employee_biometric_enrollment 
(id, employee_id, cosec_user_id, cosec_user_name, is_active, last_sync_at)
SELECT 
    UUID(),
    e.id,
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name),
    1,
    NOW()
FROM employees e
WHERE e.active_status = 1
    AND e.employee_code IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM employee_biometric_enrollment ebe 
        WHERE ebe.employee_id = e.id AND ebe.is_active = 1
    );
```

**Option 2: Manual enrollment**
```sql
-- Enroll specific employee
INSERT INTO employee_biometric_enrollment 
(id, employee_id, cosec_user_id, cosec_user_name, is_active)
VALUES (
    UUID(),
    (SELECT id FROM employees WHERE employee_code = 'MAS001' LIMIT 1),
    'MAS001',
    'John Doe',
    1
);
```

---

## 📊 Monitoring & Verification

### **Check Sync Status:**
```sql
-- Latest sync date
SELECT 
    MAX(synced_at) AS last_sync,
    COUNT(*) AS total_records,
    COUNT(DISTINCT employee_id) AS employees
FROM biometric_attendance_log;

-- Daily attendance summary
SELECT 
    punch_date,
    COUNT(*) AS employees_present,
    AVG(raw_minutes) / 60 AS avg_hours
FROM biometric_attendance_log
WHERE punch_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAYS)
GROUP BY punch_date
ORDER BY punch_date DESC;

-- Employees without enrollment
SELECT 
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name) AS full_name,
    e.employment_status
FROM employees e
WHERE e.active_status = 1
    AND NOT EXISTS (
        SELECT 1 FROM employee_biometric_enrollment ebe
        WHERE ebe.employee_id = e.id AND ebe.is_active = 1
    )
LIMIT 20;
```

### **Check Sync Logs:**
```bash
# If using cron
tail -f /var/log/cosec-sync.log

# If using systemd
journalctl -u cosec-sync.service -f
```

---

## 📈 Integration with HRMS

### **Attendance Reports:**

The migrated data will appear in:
1. **Attendance Dashboard** - `/attendance` or `/wfm/attendance`
2. **Employee Profile** - Attendance history per employee
3. **Reports** - Attendance reports with biometric data
4. **Payroll** - Attendance data used for salary calculation

### **API Endpoints (if available):**

```typescript
// Get employee biometric logs
GET /api/wfm/biometric-punches/:employeeId?from=YYYY-MM-DD&to=YYYY-MM-DD

// Get daily attendance summary
GET /api/wfm/attendance-daily?date=YYYY-MM-DD

// Get employee enrollment status
GET /api/wfm/biometric-enrollment/:employeeId
```

---

## ✅ Success Checklist

Before marking setup as complete:

- [ ] Connection test passes (`npx tsx scripts/test-cosec-connection.ts`)
- [ ] Migration completes successfully
- [ ] Data visible in `biometric_attendance_log` table
- [ ] Employee enrollment mappings created
- [ ] Daily sync scheduled (cron or systemd)
- [ ] Attendance appears in HRMS frontend
- [ ] Payroll integration verified

---

## 📞 Support

### **If You Need Help:**

1. **Check Logs:**
   ```bash
   # Migration errors
   cat /var/log/cosec-sync.log
   
   # Backend errors
   tail -f backend/logs/app.log
   ```

2. **Test Components:**
   ```bash
   # Test COSEC connection
   npx tsx scripts/test-cosec-connection.ts
   
   # Test MySQL connection
   mysql -h 122.184.128.90 -u shivam_user -p
   ```

3. **Contact:**
   - DBA for COSEC server issues
   - IT for VPN/network issues
   - Backend team for migration script issues

---

## 📚 Related Files

- **Test Script:** `backend/scripts/test-cosec-connection.ts`
- **Migration Script:** `backend/scripts/migrate-ncosec-biometric.ts`
- **DB Module:** `backend/src/db/ncosecDb.ts`
- **Biometric Routes:** `backend/src/modules/wfm/biometric-punch.routes.ts`
- **SQL Schema:** `backend/sql/102_biometric_tables.sql`
- **Full Guide:** `COSEC_CONNECTOR_SETUP.md`

---

## 🎯 Quick Start Commands

```bash
# 1. Test connection (run first!)
cd /home/shuvam/hrms-audit/backend
npx tsx scripts/test-cosec-connection.ts

# 2. If test passes, run migration
npx tsx scripts/migrate-ncosec-biometric.ts

# 3. Verify data in MySQL
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms \
  -e "SELECT COUNT(*) FROM biometric_attendance_log"

# 4. Set up daily sync (choose one)
# Cron:
echo "0 1 * * * cd /home/shuvam/hrms-audit/backend && npx tsx scripts/migrate-ncosec-biometric.ts" | crontab -

# Or systemd (see above for full setup)
```

---

**Status:** ✅ **Ready to Test**  
**Next Action:** Run `npx tsx scripts/test-cosec-connection.ts`

**Last Updated:** June 15, 2026
