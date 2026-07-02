# COSEC Biometric Connector Setup Guide

**Public IP:** 14.97.30.234  
**Port:** 1433 (SQL Server default)  
**System:** Matrix COSEC NCOSEC Biometric Attendance System

---

## 🎯 Current Status

### ✅ **Infrastructure Exists**
Your project has complete COSEC biometric integration infrastructure:

1. ✅ **Database Connection Module** - `backend/src/db/ncosecDb.ts`
2. ✅ **Migration Script** - `backend/scripts/migrate-ncosec-biometric.ts`
3. ✅ **Biometric Routes** - `backend/src/modules/wfm/biometric-punch.routes.ts`
4. ✅ **Integration Hub Support** - Can store COSEC credentials
5. ✅ **Enrollment System** - Maps COSEC UserID → HRMS Employee ID

### ⚠️ **Connectivity Test**
```bash
# Port 1433 (SQL Server) on 14.97.30.234
✗ Port 1433 CLOSED (from your current location)
```

**Possible Reasons:**
1. Firewall blocking external access
2. VPN required to access the IP
3. Different port number
4. IP needs whitelisting

---

## 📊 System Architecture

### **COSEC System (14.97.30.234)**
```
┌──────────────────────────────────────┐
│  Matrix COSEC NCOSEC                 │
│  IP: 14.97.30.234:1433               │
│                                      │
│  Database: NCOSEC (SQL Server)       │
│                                      │
│  Tables:                             │
│  ├─ Mx_ATDEventTrn   (3M+ rows)     │
│  │  └─ Punch events                 │
│  │     - UserID (employee ID)        │
│  │     - IDateTime (punch time)      │
│  │     - EDateTime (event time)      │
│  └─ Mx_UserMst                       │
│     └─ User master data              │
└──────────────────────────────────────┘
         ↓ (ETL Migration)
┌──────────────────────────────────────┐
│  HRMS (mas_hrms)                     │
│  IP: 122.184.128.90:3306             │
│                                      │
│  Tables:                             │
│  ├─ employee_biometric_enrollment    │
│  │  └─ Maps COSEC UserID → Employee │
│  ├─ biometric_attendance_log         │
│  │  └─ Raw punch data                │
│  └─ attendance_daily_record          │
│     └─ Daily attendance summary      │
└──────────────────────────────────────┘
```

---

## 🔧 Setup Instructions

### **Option 1: Configure via Environment Variables**

**File:** `backend/.env` (create if doesn't exist)

```bash
# ── NCOSEC Biometric DB Configuration ──
NCOSEC_DB_HOST=14.97.30.234
NCOSEC_DB_PORT=1433
NCOSEC_DB_USER=your_username
NCOSEC_DB_PASSWORD=your_password
NCOSEC_DB_NAME=NCOSEC
NCOSEC_DB_ENCRYPT=false
```

**Steps:**
1. Add above configuration to `backend/.env`
2. Replace `your_username` and `your_password` with actual credentials
3. Restart backend server
4. Test connection

---

### **Option 2: Configure via Integration Hub** (Recommended)

**Advantages:**
- ✅ Credentials encrypted at rest
- ✅ Can be updated without code changes
- ✅ Supports multiple COSEC instances
- ✅ Web UI management

**Steps:**

1. **Login as Admin**

2. **Navigate to Integration Hub**
   - URL: `/integration-hub` or `/integrations`

3. **Create New Connector**
   ```
   Connector Name:    COSEC Biometric Attendance
   Connector Key:     cosec_biometric
   Connector Type:    mssql (SQL Server)
   
   Database Details:
   - Host:            14.97.30.234
   - Port:            1433
   - Database:        NCOSEC
   - Username:        [COSEC DB Username]
   - Password:        [COSEC DB Password]
   - Encrypt:         false
   
   Status:            active
   ```

4. **Test Connection**
   - Click "Test Connection" button
   - Should show: ✅ Connection successful

5. **Save Connector**

---

## 🧪 Testing Connectivity

### **Method 1: Port Check**
```bash
# From your server
timeout 5 bash -c 'cat < /dev/null > /dev/tcp/14.97.30.234/1433'
```

**Expected:**
- If successful: No output (exit code 0)
- If failed: "Connection timed out" (exit code 124)

### **Method 2: SQL Server Test (Node.js)**
```bash
cd /home/shuvam/hrms-audit/backend

# Create test file
cat > test-cosec-connection.js << 'EOF'
import sql from 'mssql';

const config = {
  server: '14.97.30.234',
  port: 1433,
  user: 'YOUR_USERNAME',
  password: 'YOUR_PASSWORD',
  database: 'NCOSEC',
  options: {
    encrypt: false,
    trustServerCertificate: true,
    enableArithAbort: true,
  },
  connectionTimeout: 15000,
};

async function test() {
  try {
    console.log('Connecting to COSEC...');
    const pool = await new sql.ConnectionPool(config).connect();
    console.log('✅ Connected!');
    
    const result = await pool.request().query('SELECT TOP 5 UserID, IDateTime FROM Mx_ATDEventTrn ORDER BY IDateTime DESC');
    console.log('Recent punches:', result.recordset);
    
    await pool.close();
  } catch (err) {
    console.error('✗ Connection failed:', err.message);
  }
}

test();
EOF

# Run test
npx tsx test-cosec-connection.js
```

### **Method 3: Via HRMS API**
```bash
# Test using backend API
curl -X POST http://localhost:5055/api/integration-hub/test-connection \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  -d '{
    "connector_key": "cosec_biometric",
    "db_type": "mssql",
    "host": "14.97.30.234",
    "port": 1433,
    "database": "NCOSEC",
    "username": "YOUR_USERNAME",
    "password": "YOUR_PASSWORD"
  }'
```

---

## 📦 Database Schema

### **COSEC Tables**

#### **Mx_ATDEventTrn** (Attendance Event Transactions)
```sql
-- 3M+ rows - All punch events
Columns:
- UserID (nvarchar) - Employee ID from COSEC
- IDateTime (datetime) - Punch timestamp (IN)
- EDateTime (datetime) - Event timestamp
- AccessLocationID (int) - Biometric device location
```

**Sample Query:**
```sql
SELECT TOP 10
    UserID,
    CAST(EDateTime AS DATE) AS punch_date,
    MIN(IDateTime) AS first_punch,
    MAX(IDateTime) AS last_punch,
    DATEDIFF(MINUTE, MIN(IDateTime), MAX(IDateTime)) AS total_minutes
FROM Mx_ATDEventTrn
WHERE CAST(EDateTime AS DATE) = '2026-06-14'
    AND UserID IS NOT NULL
GROUP BY UserID, CAST(EDateTime AS DATE)
ORDER BY UserID;
```

#### **Mx_UserMst** (User Master)
```sql
Columns:
- UserID (nvarchar) - Unique user identifier
- UserName (nvarchar) - Display name
- Active (bit) - Active status
```

---

### **HRMS Tables**

#### **employee_biometric_enrollment**
```sql
CREATE TABLE employee_biometric_enrollment (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    cosec_user_id VARCHAR(50) NOT NULL,  -- Maps to COSEC UserID
    cosec_user_name VARCHAR(200),
    device_id VARCHAR(50),
    enrollment_date DATETIME,
    is_active TINYINT DEFAULT 1,
    last_sync_at DATETIME,
    
    UNIQUE KEY unique_employee_cosec (employee_id, cosec_user_id),
    FOREIGN KEY (employee_id) REFERENCES employees(id)
);
```

**Purpose:** Maps COSEC UserID to HRMS employee_id

**Sample Data:**
```sql
INSERT INTO employee_biometric_enrollment 
(id, employee_id, cosec_user_id, cosec_user_name, is_active)
VALUES 
(UUID(), 
 (SELECT id FROM employees WHERE employee_code = 'MAS60618' LIMIT 1),
 'MAS60618',
 'John Doe',
 1);
```

#### **biometric_attendance_log**
```sql
CREATE TABLE biometric_attendance_log (
    id VARCHAR(36) PRIMARY KEY,
    employee_id VARCHAR(36) NOT NULL,
    cosec_user_id VARCHAR(50),
    punch_date DATE NOT NULL,
    first_punch_in DATETIME,
    last_punch_out DATETIME,
    raw_minutes INT,
    source_system VARCHAR(50) DEFAULT 'ncosec',
    attendance_record_id VARCHAR(36),  -- Links to attendance_daily_record
    synced_at DATETIME,
    
    UNIQUE KEY unique_emp_date (employee_id, punch_date),
    FOREIGN KEY (employee_id) REFERENCES employees(id),
    FOREIGN KEY (attendance_record_id) REFERENCES attendance_daily_record(id)
);
```

**Purpose:** Stores daily punch summary from COSEC

#### **attendance_daily_record**
```sql
-- Main attendance table (already exists)
Columns used by COSEC migration:
- clock_in_time (DATETIME)
- clock_out_time (DATETIME)
- raw_minutes (INT)
- source (VARCHAR) - Set to 'biometric'
- created_by (VARCHAR) - Set to 'ncosec_migration'
```

---

## 🚀 Migration Process

### **Run One-Time Migration**

**Script:** `backend/scripts/migrate-ncosec-biometric.ts`

**Features:**
- ✅ Fetches punch data day-by-day (avoids timeout)
- ✅ Maps COSEC UserID → HRMS employee_id
- ✅ Auto-creates enrollment records
- ✅ Upserts biometric_attendance_log
- ✅ Upserts attendance_daily_record
- ✅ Idempotent (safe to re-run)
- ✅ Detailed error logging

**Usage:**
```bash
cd /home/shuvam/hrms-audit/backend

# Migrate last 30 days
npx tsx scripts/migrate-ncosec-biometric.ts

# Output:
# ┌─────────────────────────────────────────┐
# │  NCOSEC → HRMS Biometric Migration      │
# └─────────────────────────────────────────┘
# 
# [NCOSEC] Testing connection...
# [NCOSEC] ✓ Connected to 14.97.30.234:1433
# [HRMS] Building UserID → employee_id map...
# [HRMS] Loaded 45 existing enrollment mappings
# [HRMS] Fallback: matched 120 via employee_code
# 
# Migrating date range: 2026-05-15 to 2026-06-14 (31 days)
# 
# Day 1/31: 2026-05-15 ... 187 rows → 180 inserted, 7 updated
# Day 2/31: 2026-05-16 ... 191 rows → 185 inserted, 6 updated
# ...
# Day 31/31: 2026-06-14 ... 195 rows → 190 inserted, 5 updated
# 
# ┌─────────────────────────────────────────┐
# │  Migration Summary                      │
# ├─────────────────────────────────────────┤
# │  Total COSEC rows:         5,823        │
# │  Attendance inserted:      5,650        │
# │  Attendance updated:       173          │
# │  Employees not found:      3            │
# │    - GUEST001                           │
# │    - TEMP999                            │
# │    - VISITOR                            │
# └─────────────────────────────────────────┘
```

### **Schedule Automated Sync**

**Create cron job:**
```bash
# Edit crontab
crontab -e

# Add daily sync at 1 AM
0 1 * * * cd /home/shuvam/hrms-audit/backend && npx tsx scripts/migrate-ncosec-biometric.ts >> /var/log/cosec-sync.log 2>&1
```

**Or via systemd timer:**
```bash
# Create service
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

# Create timer
sudo nano /etc/systemd/system/cosec-sync.timer

[Unit]
Description=Run COSEC sync daily at 1 AM

[Timer]
OnCalendar=*-*-* 01:00:00
Persistent=true

[Install]
WantedBy=timers.target

# Enable and start
sudo systemctl enable cosec-sync.timer
sudo systemctl start cosec-sync.timer
```

---

## 🔐 Security Considerations

### **Firewall Rules**

**If port 1433 is blocked:**

1. **Check current firewall status:**
```bash
sudo ufw status
```

2. **Allow from HRMS server IP:**
```bash
# On COSEC server (14.97.30.234)
sudo ufw allow from 122.184.128.90 to any port 1433
```

3. **Or allow from specific subnet:**
```bash
sudo ufw allow from 122.184.128.0/24 to any port 1433
```

### **VPN Requirements**

If COSEC is on a private network:

1. **Check VPN connectivity:**
```bash
ping 14.97.30.234
```

2. **Verify routing:**
```bash
traceroute 14.97.30.234
```

3. **Connect to VPN before migration:**
```bash
# Example: OpenVPN
sudo openvpn --config /path/to/company.ovpn
```

### **SQL Server Authentication**

**Recommended:** Use SQL Server authentication (not Windows auth)

**Create read-only user on COSEC:**
```sql
-- Run on COSEC SQL Server
USE NCOSEC;

CREATE LOGIN hrms_reader WITH PASSWORD = 'SecurePassword123!';
CREATE USER hrms_reader FOR LOGIN hrms_reader;

GRANT SELECT ON Mx_ATDEventTrn TO hrms_reader;
GRANT SELECT ON Mx_UserMst TO hrms_reader;
```

---

## 📊 Verification Queries

### **Check COSEC Data**
```sql
-- Connect to COSEC (14.97.30.234)
USE NCOSEC;

-- Total events
SELECT COUNT(*) AS total_events 
FROM Mx_ATDEventTrn;

-- Events today
SELECT COUNT(*) AS today_events 
FROM Mx_ATDEventTrn 
WHERE CAST(EDateTime AS DATE) = CAST(GETDATE() AS DATE);

-- Active users
SELECT COUNT(DISTINCT UserID) AS active_users 
FROM Mx_ATDEventTrn 
WHERE CAST(EDateTime AS DATE) >= DATEADD(DAY, -30, CAST(GETDATE() AS DATE));
```

### **Check HRMS Data**
```sql
-- Connect to HRMS (122.184.128.90)
USE mas_hrms;

-- Enrolled employees
SELECT COUNT(*) AS enrolled_employees 
FROM employee_biometric_enrollment 
WHERE is_active = 1;

-- Biometric logs
SELECT COUNT(*) AS total_logs 
FROM biometric_attendance_log;

-- Recent syncs
SELECT 
    punch_date,
    COUNT(*) AS employees,
    AVG(raw_minutes) AS avg_hours
FROM biometric_attendance_log
WHERE punch_date >= DATE_SUB(CURDATE(), INTERVAL 7 DAY)
GROUP BY punch_date
ORDER BY punch_date DESC;
```

---

## 🐛 Troubleshooting

### **Issue 1: Connection Timeout**

**Error:** `ConnectionError: Failed to connect to 14.97.30.234:1433 - timeout`

**Solutions:**
1. Check firewall rules
2. Verify IP is correct (not 14.97.30.236 or similar)
3. Try telnet: `telnet 14.97.30.234 1433`
4. Connect via VPN if required
5. Check if SQL Server is running: `netstat -an | grep 1433`

### **Issue 2: Login Failed**

**Error:** `Login failed for user 'username'`

**Solutions:**
1. Verify username/password
2. Check SQL Server authentication mode (must allow SQL auth)
3. Verify user has permissions on NCOSEC database
4. Try connecting via SQL Server Management Studio first

### **Issue 3: UserID Not Found**

**Error:** `Employee not found for COSEC UserID: XXX`

**Solutions:**

**Option A: Create enrollment mapping**
```sql
INSERT INTO employee_biometric_enrollment 
(id, employee_id, cosec_user_id, cosec_user_name, is_active)
VALUES 
(UUID(), 
 (SELECT id FROM employees WHERE employee_code = 'XXX' LIMIT 1),
 'XXX',
 'Employee Name',
 1);
```

**Option B: Bulk enrollment**
```sql
-- Auto-enroll all employees with matching codes
INSERT INTO employee_biometric_enrollment 
(id, employee_id, cosec_user_id, cosec_user_name, is_active)
SELECT 
    UUID(),
    e.id,
    e.employee_code,
    CONCAT(e.first_name, ' ', e.last_name),
    1
FROM employees e
WHERE e.active_status = 1
    AND e.employee_code IS NOT NULL
    AND NOT EXISTS (
        SELECT 1 FROM employee_biometric_enrollment ebe 
        WHERE ebe.employee_id = e.id AND ebe.is_active = 1
    );
```

### **Issue 4: Slow Query**

**Error:** Query takes >30 seconds on Mx_ATDEventTrn

**Solutions:**
1. Migration script already handles this (queries day-by-day)
2. Add index on EDateTime if missing:
```sql
CREATE INDEX idx_edatetime ON Mx_ATDEventTrn(EDateTime);
```
3. Use NOLOCK hint (already in script)

---

## 📈 Performance Optimization

### **Batch Size**
```typescript
// Adjust in migrate-ncosec-biometric.ts
const BATCH_SIZE = 50; // Process 50 employees at a time
```

### **Date Range**
```typescript
// Migrate only last N days
const startDate = new Date();
startDate.setDate(startDate.getDate() - 30); // Last 30 days
```

### **Connection Pooling**
```typescript
// Already configured in ncosecDb.ts
requestTimeout: 60000,  // 60 seconds
connectionTimeout: 15000, // 15 seconds
```

---

## 📞 Next Steps

### **1. Verify Network Connectivity**
```bash
# Check if IP is reachable
ping 14.97.30.234

# Check if port 1433 is open
nc -zv 14.97.30.234 1433
# or
telnet 14.97.30.234 1433
```

### **2. Get COSEC Credentials**
- Contact IT/Infrastructure team
- Request:
  - Database username (read-only preferred)
  - Database password
  - Confirm database name (likely "NCOSEC")
  - VPN configuration (if required)

### **3. Configure Connector**
- Use Integration Hub UI (Option 2 recommended)
- Or add to `backend/.env` (Option 1)

### **4. Test Connection**
```bash
cd /home/shuvam/hrms-audit/backend
npx tsx -e "
import { testNcosecConnection } from './src/db/ncosecDb.js';
const result = await testNcosecConnection();
console.log(result.ok ? '✅ Connected!' : '✗ Failed:', result.error);
"
```

### **5. Run Migration**
```bash
npx tsx scripts/migrate-ncosec-biometric.ts
```

---

## 📚 Related Documentation

- **Integration Hub Guide:** `/docs/integration-hub.md`
- **Biometric Tables SQL:** `backend/sql/102_biometric_tables.sql`
- **WFM Module:** `backend/src/modules/wfm/`
- **External DB Service:** `backend/src/modules/external-db/external-db.service.ts`

---

## ✅ Summary

### **What You Have:**
✅ Complete COSEC integration infrastructure  
✅ Migration script ready to use  
✅ Database schema in place  
✅ API endpoints for biometric data  
✅ Integration Hub support  

### **What You Need:**
❓ COSEC database credentials (username/password)  
❓ Network access to 14.97.30.234:1433  
❓ VPN configuration (if required)  

### **Quick Start Command:**
```bash
# Once you have credentials, add to .env:
echo "NCOSEC_DB_HOST=14.97.30.234" >> backend/.env
echo "NCOSEC_DB_PORT=1433" >> backend/.env
echo "NCOSEC_DB_USER=your_username" >> backend/.env
echo "NCOSEC_DB_PASSWORD=your_password" >> backend/.env
echo "NCOSEC_DB_NAME=NCOSEC" >> backend/.env
echo "NCOSEC_DB_ENCRYPT=false" >> backend/.env

# Test connection
cd backend && npx tsx scripts/migrate-ncosec-biometric.ts
```

---

**Status:** ⚠️ **Ready to Configure**  
**Next Action:** Get COSEC credentials and test connectivity

**Last Updated:** June 15, 2026
