# Attendance & Leave Data Sync Plan

**Date**: 2026-06-12  
**Status**: 📋 **READY FOR IMPLEMENTATION** (Awaiting attendance logic)

---

## 🎯 **Objective**

Sync attendance, leave, and biometric data from multiple sources into mas_hrms for unified employee self-service.

---

## 📊 **Data Sources Identified**

### **Source 1: db_bill @ 14.97.30.236**

#### **Attendance Data**
**Table**: `qual_attendance`
```sql
Fields:
- EmpCode (varchar)
- Present (varchar) - Present days
- WO (varchar) - Week off
- Holiday (varchar) - Holidays
- HalfDay (varchar) - Half days
- Compoff (varchar) - Comp off
- EL, CL, SL (varchar) - Leave types
- ArrerDays (varchar) - Arrear days
- OT (varchar) - Overtime
- SalMonth, SalYear (varchar) - Month/Year
```

**Sample Query**:
```sql
SELECT * FROM db_bill.qual_attendance
WHERE EmpCode = 'MAS47814'
ORDER BY SalYear DESC, SalMonth DESC
LIMIT 12;
```

#### **Leave Data**
**Table 1**: `leave_management` (Applications)
```sql
Fields:
- EmpCode, EmpName, EmpLocation
- LeaveFrom, LeaveTo (date)
- LeaveFor (varchar) - Duration
- LeaveType (varchar) - Type (CL/ML/DL/EL/etc)
- CurrentStatus (varchar)
- Purpose, Address, Contact
- Status (varchar) - Approval status
- CL, ML, DL, EL, PTRL, MTRL, LWP (double) - Days per type
- TotalLeave (double)
- LeaveApproveBy, LeaveApproveDate
```

**Table 2**: `leave_balance` (Balances)
```sql
Fields:
- EmpCode
- BalancePl, BalanceCL, BalanceSL
- LeaveDate
```

---

### **Source 2: dialer_db @ 122.184.128.90 (Biometric/Dialer)**

**Tables**: `vicidial_agent_log_*` (multiple tables by process)
```sql
Fields:
- user (varchar) - Agent username
- event_time (datetime) - Event timestamp
- pause_sec, wait_sec, talk_sec, dispo_sec
- status (varchar) - Agent status
- campaign_id (varchar)
- processed (enum) - Y/N
```

**Purpose**: Clock in/out times from dialer system for call center employees

---

### **Source 3: Shivamgiri @ 122.184.128.90 (COSE System)**

**Table**: `ci_call_master` (Call data)
- Has agent_id, call_datetime, duration_sec
- Can derive working hours from call activity

**Table**: `ci_agent_master` (Agent mapping)
- Maps employee_code to agent_id
- Links COSE agents to HRMS employees

---

### **Target: mas_hrms @ 122.184.128.90**

#### **Attendance Tables**

**Table 1**: `attendance_daily_record` (Primary)
```sql
Fields:
- employee_id (char36 - UUID)
- record_date (date)
- clock_in_time, clock_out_time (datetime)
- work_mode (varchar) - office/wfh/hybrid
- attendance_source (enum) - dialler/biometric
- dialler_minutes, biometric_minutes (int)
- raw_minutes (int)
- attendance_status (enum) - present/half_day/absent/leave_approved/holiday/week_off
- lwp_value (decimal)
- late_mark, late_by_minutes (int)
- is_locked (boolean)
```

**Table 2**: `wfm_attendance_session` (Session logs)
- Detailed clock in/out sessions
- Break tracking
- Location tracking

#### **Leave Tables**

**Existing Tables** (to sync into):
- `leave_application` - Leave requests
- `leave_balance_ledger` - Leave balances
- `leave_approval_workflow` - Approval chain

---

## 🔧 **Sync Strategy**

### **Phase 1: Attendance Sync**

#### **Data Flow**:
```
db_bill.qual_attendance  ────┐
                             │
dialer_db.vicidial_agent_*  ─┼──→  mas_hrms.attendance_daily_record
                             │
Shivamgiri.ci_call_master ──┘
```

#### **Sync Logic** (To be provided by user):

**Employee Types** (awaiting input):
1. **Office-based employees** - Biometric attendance
2. **Call center employees** - Dialer log based
3. **Remote employees** - Manual entry
4. **Hybrid employees** - Mixed source
5. **Field employees** - GPS/mobile based

**Attendance Status Mapping**:
```javascript
// db_bill → mas_hrms mapping
{
  'Present': 'present',
  'WO': 'week_off',
  'Holiday': 'holiday',
  'HalfDay': 'half_day',
  'Compoff': 'present', // with comp_off flag
  'EL': 'leave_approved',
  'CL': 'leave_approved',
  'SL': 'leave_approved',
  'LWP': 'absent' // with lwp_value
}
```

---

### **Phase 2: Leave Sync**

#### **Data Flow**:
```
db_bill.leave_management  ─┐
                           ├──→  mas_hrms.leave_application
db_bill.leave_balance     ─┤
                           └──→  mas_hrms.leave_balance_ledger
```

#### **Sync Logic**:

**Leave Type Mapping**:
```javascript
// db_bill → mas_hrms
{
  'CL': 'Casual Leave',
  'ML': 'Medical Leave',
  'DL': 'Duty Leave',
  'EL': 'Earned Leave',
  'PTRL': 'Paternity Leave',
  'MTRL': 'Maternity Leave',
  'LWP': 'Leave Without Pay'
}
```

**Leave Status Mapping**:
```javascript
{
  'Approved': 'approved',
  'Pending': 'pending',
  'Rejected': 'rejected',
  'Cancelled': 'cancelled'
}
```

---

### **Phase 3: Biometric/Dialer Sync**

#### **For Call Center Employees**:

**Source**: `dialer_db.vicidial_agent_log_*`

**Logic**:
1. Get first LOGIN event of day → clock_in_time
2. Get last LOGOUT event of day → clock_out_time
3. Sum talk_sec + wait_sec → dialler_minutes
4. Calculate breaks from pause_sec
5. Set attendance_source = 'dialler'

#### **For Office Employees**:

**Source**: Biometric device integration (TBD)
- **Note**: Biometric API/database location to be provided

---

## 📋 **Sync Scripts to Create**

### **Script 1: Attendance Sync** (Node.js)
**File**: `db_bill-to-mas_hrms-attendance-sync.js`

**Features**:
- Pull monthly attendance from qual_attendance
- Map employee codes to employee_ids
- Create attendance_daily_record entries
- Handle different employee types
- Support full/delta sync modes

**Usage**:
```bash
node db_bill-to-mas_hrms-attendance-sync.js --mode=full
node db_bill-to-mas_hrms-attendance-sync.js --mode=delta --months=3
node db_bill-to-mas_hrms-attendance-sync.js --employee=MAS47814
```

---

### **Script 2: Leave Sync** (Node.js)
**File**: `db_bill-to-mas_hrms-leave-sync.js`

**Features**:
- Sync leave applications
- Sync leave balances
- Map leave types
- Handle approval status
- Link to approvers

**Usage**:
```bash
node db_bill-to-mas_hrms-leave-sync.js --mode=full
node db_bill-to-mas_hrms-leave-sync.js --mode=delta --months=6
```

---

### **Script 3: Biometric/Dialer Sync** (Node.js)
**File**: `dialer-to-mas_hrms-attendance-sync.js`

**Features**:
- Pull dialer logs from vicidial tables
- Calculate clock in/out from events
- Compute working hours
- Handle multiple campaigns/processes
- Daily sync for real-time data

**Usage**:
```bash
node dialer-to-mas_hrms-attendance-sync.js --date=2026-06-12
node dialer-to-mas_hrms-attendance-sync.js --mode=delta --days=7
```

---

## 🎯 **Employee Type Classification**

**Awaiting Input**: Please provide attendance logic for each employee type:

### **Type 1: Office-Based** (Biometric)
- **Source**: ?
- **Clock In/Out**: Biometric device
- **Attendance Calculation**: ?
- **Late Mark Rule**: ?
- **Half Day Rule**: ?

### **Type 2: Call Center** (Dialer)
- **Source**: vicidial_agent_log
- **Clock In/Out**: First LOGIN / Last LOGOUT
- **Attendance Calculation**: ?
- **Break Rules**: ?
- **Minimum Hours**: ?

### **Type 3: Remote/WFH** (Manual)
- **Source**: ?
- **Attendance Marking**: ?
- **Verification**: ?

### **Type 4: Hybrid** (Mixed)
- **Office Days**: Biometric
- **WFH Days**: Manual/Dialer
- **Logic**: ?

### **Type 5: Field** (GPS/Mobile)
- **Source**: ?
- **Location Tracking**: ?
- **Attendance Marking**: ?

---

## 🚨 **Pending Information Needed**

### **1. Biometric System Details**
- [ ] Biometric device API endpoint
- [ ] Database location for biometric data
- [ ] Data format (raw logs vs processed)
- [ ] Employee ID mapping in biometric system

### **2. Attendance Rules** ⏳ **AWAITING USER INPUT**
- [ ] Office hours (start/end time)
- [ ] Grace period for late mark
- [ ] Half day hours threshold
- [ ] Full day hours minimum
- [ ] Break time calculation
- [ ] Overtime calculation

### **3. Employee Type Mapping**
- [ ] How to identify employee type? (from employees table field?)
- [ ] Which employees use biometric?
- [ ] Which employees use dialer?
- [ ] Which are hybrid?

### **4. Leave Rules**
- [ ] Leave balance allocation per year
- [ ] Carry forward rules
- [ ] Encashment rules
- [ ] Approval hierarchy

---

## 📊 **Data Volume Estimates**

**Attendance**:
- ~1000 employees × 30 days/month × 12 months = 360,000 records/year
- Current backlog: 2-3 years = ~1M records

**Leave**:
- ~1000 employees × 10 applications/year = 10,000 records/year
- Current backlog: 2-3 years = ~30,000 records

**Dialer Logs**:
- ~500 agents × 200 events/day × 365 days = 36M records/year
- Store last 90 days only = ~9M records

**Sync Duration Estimate**:
- Attendance full sync: 1-2 hours
- Leave full sync: 10-15 minutes
- Dialer daily sync: 5-10 minutes

---

## 🔄 **Auto-Sync Schedule**

Once scripts are created:

```bash
# Daily attendance sync (2:30 AM)
30 2 * * * /path/to/db_bill-to-mas_hrms-attendance-sync.js --mode=delta --months=1

# Daily leave sync (3:00 AM)
0 3 * * * /path/to/db_bill-to-mas_hrms-leave-sync.js --mode=delta --months=1

# Daily dialer sync (every 4 hours)
0 */4 * * * /path/to/dialer-to-mas_hrms-attendance-sync.js --mode=delta --days=1
```

---

## ✅ **Next Steps**

### **Immediate** (Waiting for User Input):
1. ⏳ **User to provide attendance logic for each employee type**
2. ⏳ **User to provide biometric system details**
3. ⏳ **User to confirm attendance rules**

### **After Input Received**:
1. Create attendance sync script
2. Create leave sync script
3. Create dialer sync script
4. Test with sample employees
5. Run full historical sync
6. Setup auto-sync cron jobs
7. Fix attendance page frontend issue

---

## 📞 **Support**

**For Questions**:
- Attendance rules clarification
- Employee type classification
- Biometric system integration
- Dialer log interpretation

---

## 📚 **Related Documentation**

- **DB_BILL_SALARY_SYNC_COMPLETE.md** - Salary sync (template)
- **AUTO_SYNC_SETUP_SUMMARY.md** - Auto-sync configuration
- **MIGRATION_PLAN_MAS_HRMS_SOURCE_OF_TRUTH.md** - Long-term plan

---

**Status**: 📋 **PLANNING COMPLETE - AWAITING USER INPUT**

**Next Action**: User to provide:
1. Attendance logic for each employee type
2. Biometric system details
3. Attendance calculation rules

---

**Generated**: 2026-06-12  
**Data Sources**: db_bill, dialer_db, Shivamgiri (COSE)  
**Target**: mas_hrms.attendance_daily_record, leave_application, leave_balance_ledger
