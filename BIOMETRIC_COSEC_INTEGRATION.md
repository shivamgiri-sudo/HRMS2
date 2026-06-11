# COSEC Biometric System Integration

**Date**: 2026-06-12  
**Status**: 📋 **READY FOR IMPLEMENTATION**

---

## 🔐 **COSEC Server Details**

### **Server Information**

| Component | Details |
|-----------|---------|
| **COSEC Server** | 172.10.10.146 |
| **MIS_SQL Server** | 172.10.10.140 |
| **Username** | shivamg |
| **Password** | Noida$1234 |
| **Port** | 3306 (MySQL) |
| **Access** | Internal network only |

⚠️ **Security Note**: Server is on internal network. Sync scripts must run from a server with access to 172.10.10.140.

---

## 🎯 **Integration Objectives**

1. **Pull biometric punch data** from COSEC MIS_SQL server
2. **Map to employees** using employee codes
3. **Calculate attendance** (clock in/out, working hours, breaks)
4. **Sync to mas_hrms** daily
5. **Handle multiple punch events** (in/out/break)

---

## 📊 **Expected COSEC Database Schema**

### **Typical COSEC MIS Tables**:

**Table 1**: `transaction` or `punch_log`
```sql
-- Employee punch events
Fields (expected):
- emp_code / employee_id
- punch_datetime / transaction_datetime
- punch_type / direction (IN/OUT/BREAK_START/BREAK_END)
- device_id / terminal_id
- location
```

**Table 2**: `employees` or `emp_master`
```sql
-- Employee master data
Fields (expected):
- emp_code
- emp_name
- department
- designation
- active_status
```

**Table 3**: `attendance_summary` (if exists)
```sql
-- Pre-processed attendance
Fields (expected):
- emp_code
- att_date
- clock_in_time
- clock_out_time
- total_hours
- attendance_status
```

---

## 🔧 **Sync Strategy**

### **Phase 1: Schema Discovery**

**Step 1**: Connect to COSEC MIS_SQL server from authorized machine
```bash
mysql -h 172.10.10.140 -u shivamg -p'Noida$1234'
```

**Step 2**: List databases
```sql
SHOW DATABASES;
```

**Step 3**: Identify attendance database (common names)
- `attendance`
- `biometric`
- `cosec`
- `mis`
- `punch_data`

**Step 4**: Explore schema
```sql
USE <database_name>;
SHOW TABLES;
DESCRIBE <table_name>;
```

---

### **Phase 2: Data Mapping**

#### **Employee Code Mapping**

**COSEC** → **mas_hrms**
```javascript
// Map COSEC employee codes to mas_hrms employee_id
{
  cosec_emp_code: 'MAS00175',
  mas_hrms_employee_id: '0000bf5c-5e8b-11f1-adb1-00155d0ab410'
}
```

**Query**:
```sql
SELECT 
    e.employee_code as cosec_emp_code,
    e.id as mas_hrms_employee_id
FROM mas_hrms.employees e
WHERE e.employee_code IN (
    SELECT DISTINCT emp_code FROM cosec.transaction
);
```

---

#### **Punch Event Mapping**

**COSEC** → **mas_hrms**
```javascript
{
  'IN': 'clock_in',
  'OUT': 'clock_out',
  'BREAK_START': 'break_start',
  'BREAK_END': 'break_end'
}
```

---

### **Phase 3: Attendance Calculation**

#### **Daily Attendance Logic**:

```javascript
// For each employee, each day:
function calculateAttendance(employeeCode, date) {
  // 1. Get all punches for the day
  const punches = getPunches(employeeCode, date);
  
  // 2. Find first IN punch → clock_in_time
  const clockIn = punches.find(p => p.type === 'IN');
  
  // 3. Find last OUT punch → clock_out_time
  const clockOut = punches.findLast(p => p.type === 'OUT');
  
  // 4. Calculate working hours
  const rawMinutes = clockOut - clockIn;
  
  // 5. Calculate breaks
  const breakMinutes = calculateBreaks(punches);
  
  // 6. Net working hours
  const workMinutes = rawMinutes - breakMinutes;
  
  // 7. Determine status
  let status = 'unreconciled';
  if (workMinutes >= 480) status = 'present';      // 8 hours
  else if (workMinutes >= 240) status = 'half_day'; // 4 hours
  else if (workMinutes > 0) status = 'absent';      // < 4 hours
  
  // 8. Late mark
  const lateByMinutes = clockIn > '09:15' ? calculateLateness(clockIn) : 0;
  const lateMark = lateByMinutes > 0;
  
  return {
    clock_in_time: clockIn,
    clock_out_time: clockOut,
    raw_minutes: rawMinutes,
    break_minutes: breakMinutes,
    biometric_minutes: workMinutes,
    attendance_status: status,
    late_mark: lateMark,
    late_by_minutes: lateByMinutes
  };
}
```

---

### **Phase 4: Sync Implementation**

#### **Script 1: Schema Discovery**
**File**: `cosec-schema-discovery.js`

```javascript
// Connects to COSEC, lists databases/tables
// Generates schema documentation
// Identifies punch log table
```

**Usage**:
```bash
node cosec-schema-discovery.js
```

**Output**: `COSEC_SCHEMA_REPORT.md`

---

#### **Script 2: Biometric Sync**
**File**: `cosec-to-mas_hrms-attendance-sync.js`

```javascript
// Pulls punch data from COSEC
// Maps to mas_hrms employees
// Calculates attendance
// Syncs to attendance_daily_record
```

**Usage**:
```bash
# Daily sync (yesterday's data)
node cosec-to-mas_hrms-attendance-sync.js --mode=delta --days=1

# Historical sync (last 30 days)
node cosec-to-mas_hrms-attendance-sync.js --mode=delta --days=30

# Full sync (all data)
node cosec-to-mas_hrms-attendance-sync.js --mode=full

# Single employee
node cosec-to-mas_hrms-attendance-sync.js --employee=MAS00175 --date=2026-06-11
```

---

## 📋 **Sync Configuration**

### **Attendance Rules** (To be confirmed):

```javascript
const ATTENDANCE_RULES = {
  // Office timings
  officeStart: '09:00',
  officeEnd: '18:00',
  
  // Grace period
  gracePeriodMinutes: 15,  // Can clock in by 09:15 without late mark
  
  // Working hours
  fullDayMinutes: 480,     // 8 hours
  halfDayMinutes: 240,     // 4 hours
  
  // Break time
  maxBreakMinutes: 60,     // 1 hour lunch break
  deductBreak: true,       // Deduct break from working hours
  
  // Late mark
  lateMarkAfter: '09:15',
  lateMarkThreshold: 15,   // Minutes
  
  // Overtime
  overtimeAfter: 540,      // After 9 hours
  overtimeRate: 1.5
};
```

---

## 🔄 **Auto-Sync Schedule**

### **Cron Jobs** (once scripts are deployed):

```bash
# Daily sync at 6 AM (previous day data)
0 6 * * * /path/to/cosec-to-mas_hrms-attendance-sync.js --mode=delta --days=1

# Hourly sync during office hours (real-time)
0 9-18 * * * /path/to/cosec-to-mas_hrms-attendance-sync.js --mode=delta --hours=2

# Weekly full reconciliation (Sunday 2 AM)
0 2 * * 0 /path/to/cosec-to-mas_hrms-attendance-sync.js --mode=delta --days=7 --reconcile
```

---

## 📊 **Data Flow Diagram**

```
┌─────────────────────────────────────────────────────────────┐
│              COSEC Biometric Devices                        │
│         (Punch in/out at office locations)                  │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Real-time punch events
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         COSEC MIS_SQL Server (172.10.10.140)               │
│                                                             │
│  - transaction / punch_log table                           │
│  - emp_master table                                        │
│  - attendance_summary (if exists)                          │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Daily/Hourly Sync
                     │ (cosec-to-mas_hrms-attendance-sync.js)
                     ▼
┌─────────────────────────────────────────────────────────────┐
│         mas_hrms @ 122.184.128.90                          │
│                                                             │
│  - attendance_daily_record                                 │
│  - wfm_attendance_session                                  │
│  - attendance_regularization                               │
└────────────────────┬────────────────────────────────────────┘
                     │
                     │ Employee Self-Service
                     ▼
┌─────────────────────────────────────────────────────────────┐
│              HRMS Web Application                           │
│         (Attendance Page - Profile View)                    │
└─────────────────────────────────────────────────────────────┘
```

---

## ⚠️ **Implementation Checklist**

### **Pre-requisites**:
- [ ] Network access from sync server to 172.10.10.140:3306
- [ ] COSEC database name identified
- [ ] Punch log table name identified
- [ ] Employee code mapping verified
- [ ] Punch event types understood

### **Phase 1: Discovery**:
- [ ] Run schema discovery script
- [ ] Document COSEC database schema
- [ ] Identify all relevant tables
- [ ] Test sample queries
- [ ] Verify employee code mapping

### **Phase 2: Development**:
- [ ] Create sync script (cosec-to-mas_hrms-attendance-sync.js)
- [ ] Implement attendance calculation logic
- [ ] Add error handling and logging
- [ ] Test with single employee
- [ ] Test with date range

### **Phase 3: Testing**:
- [ ] Sync last 7 days for 10 test employees
- [ ] Verify data accuracy in mas_hrms
- [ ] Test attendance page display
- [ ] Verify clock in/out times
- [ ] Check break calculations
- [ ] Validate late marks

### **Phase 4: Deployment**:
- [ ] Deploy script to authorized server
- [ ] Setup cron jobs
- [ ] Run historical sync (last 90 days)
- [ ] Monitor daily sync execution
- [ ] Setup alerting for failures

---

## 🚨 **Troubleshooting**

### **Issue 1: Cannot Connect to COSEC Server**
```
ERROR 2003 (HY000): Can't connect to MySQL server on '172.10.10.140:3306'
```

**Solutions**:
1. Run from server on internal network (not cloud)
2. Check firewall rules (allow 3306 from sync server IP)
3. Verify COSEC MIS_SQL service is running
4. Test with ping: `ping 172.10.10.140`
5. Test with telnet: `telnet 172.10.10.140 3306`

---

### **Issue 2: Authentication Failed**
```
ERROR 1045 (28000): Access denied for user 'shivamg'@'host'
```

**Solutions**:
1. Verify username: `shivamg`
2. Verify password: `Noida$1234`
3. Check if user has access from this IP
4. Contact COSEC admin to grant access

---

### **Issue 3: Employee Code Mismatch**
```
Employee code 'EMP001' in COSEC not found in mas_hrms
```

**Solutions**:
1. Check employee_code format (COSEC vs mas_hrms)
2. Create mapping table for different formats
3. Add prefix/suffix transformation logic
4. Update sync script with mapping rules

---

### **Issue 4: Multiple Punches**
```
Employee has 10 IN punches, 8 OUT punches on 2026-06-12
```

**Solutions**:
1. Take FIRST IN punch as clock_in
2. Take LAST OUT punch as clock_out
3. Pair remaining IN/OUT punches as breaks
4. Log anomalies for HR review
5. Add data quality validation

---

## 📚 **Related Documentation**

- **ATTENDANCE_LEAVE_SYNC_PLAN.md** - Overall sync strategy
- **DB_BILL_SALARY_SYNC_COMPLETE.md** - Salary sync (template)
- **AUTO_SYNC_SETUP_SUMMARY.md** - Auto-sync configuration

---

## 🎯 **Success Criteria**

### **Phase 1 (Discovery)**:
- [x] COSEC server details obtained
- [ ] Database schema documented
- [ ] Punch log table identified
- [ ] Employee mapping verified

### **Phase 2 (Development)**:
- [ ] Sync script created
- [ ] Attendance logic implemented
- [ ] Error handling added
- [ ] Logging configured

### **Phase 3 (Testing)**:
- [ ] 100% accuracy for test employees
- [ ] All punch types handled correctly
- [ ] Break calculations verified
- [ ] Late marks working

### **Phase 4 (Production)**:
- [ ] Historical sync completed (90 days)
- [ ] Daily sync running automatically
- [ ] Attendance page showing data
- [ ] Employees can view their attendance
- [ ] < 1% sync error rate

---

## 📞 **Support Contacts**

**COSEC System Admin**: [Contact details]  
**Network Team**: For firewall/access issues  
**HR Team**: For attendance rules clarification  
**HRMS Dev Team**: For sync script issues

---

## 🔒 **Security**

### **Credentials Storage**:
```bash
# Store in environment variables
export COSEC_HOST="172.10.10.140"
export COSEC_USER="shivamg"
export COSEC_PASSWORD="Noida$1234"
export COSEC_DATABASE="<database_name>"
```

### **Script Usage**:
```javascript
const COSEC_CONFIG = {
  host: process.env.COSEC_HOST,
  user: process.env.COSEC_USER,
  password: process.env.COSEC_PASSWORD,
  database: process.env.COSEC_DATABASE
};
```

---

**Status**: 📋 **READY - Need schema discovery from authorized server**

**Next Steps**:
1. Run schema discovery from server with access to 172.10.10.140
2. Document COSEC database schema
3. Create sync script based on actual schema
4. Test with sample data
5. Deploy to production

---

**Generated**: 2026-06-12  
**COSEC Server**: 172.10.10.140  
**Credentials**: shivamg / Noida$1234  
**Status**: Pending schema discovery from authorized server
