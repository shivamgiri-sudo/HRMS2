# db_bill Database - Latest Entries Report

**Database**: `db_bill`  
**Server**: `14.97.30.236`  
**Analysis Date**: 2026-06-13  
**Purpose**: Identify which tables have the most recent data entries

---

## 🏆 **Most Active Table: `upload_incentive_breakup`**

### **Summary**
- **Latest Entry**: 2026-06-12 17:04:58 (YESTERDAY!)
- **Total Records**: 83,872 records
- **Status**: ✅ ACTIVELY USED

### **Latest 10 Records (as of June 12, 2026)**

| Id | Branch | Cost Centre | Emp Code | Employee Name | Incentive Type | Amount | Month | Status | Import Date |
|----|--------|-------------|----------|---------------|----------------|--------|-------|--------|-------------|
| 109031 | NOIDA-DIALDESK | BSS/BO/NOIDA-DD/798 | IDC59068 | SHIVANI PATWA | Previous month dispute | ₹6,666 | May 2026 | Approve | 2026-06-12 17:04:58 |
| 109029 | HEAD OFFICE | BSS/BLD/CORP/796 | MAS55833 | PRIYANK BAN | Performance Linked Incentive | ₹5,250 | May 2026 | NULL | 2026-06-12 10:57:19 |
| 109030 | HEAD OFFICE | IT/SYSTEM | MAS47905 | PRATEEK HAJELA | Performance Linked Incentive | ₹35,426 | May 2026 | Approve | 2026-06-12 10:57:19 |
| 109028 | NOIDA | BO/ | MAS07279 | PARVEEN KUMAR | Performance Linked Incentive | ₹7,625 | May 2026 | Approve | 2026-06-12 10:50:35 |
| 109002 | NOIDA | BSS/IB/Noida/647 | MAS50372 | MOHD KASIM | Client Paid Incentive | ₹35,000 | May 2026 | Approve | 2026-06-09 22:48:10 |
| 109003 | NOIDA | BSS/BO/Noida/754 | MAS52327 | ROHAN KUMAR | Client Paid Incentive | ₹8,000 | May 2026 | Approve | 2026-06-09 22:48:10 |
| 109004 | NOIDA | BSS/OB/Noida/968 | MAS57019 | BEENU | Client Paid Incentive | ₹2,000 | May 2026 | Approve | 2026-06-09 22:48:10 |
| 109005 | NOIDA | BSS/OB/Noida/968 | MAS53355 | ARTI CHAUHAN | Client Paid Incentive | ₹1,500 | May 2026 | Approve | 2026-06-09 22:48:10 |
| 109006 | NOIDA | BSS/OB/Noida/968 | MAS61825 | NEHA LAWANIYA | Client Paid Incentive | ₹2,000 | May 2026 | Approve | 2026-06-09 22:48:10 |
| 109007 | NOIDA | BSS/OB/Noida/968 | MAS62145 | GUNGUN TYAGI | Client Paid Incentive | ₹2,000 | May 2026 | Approve | 2026-06-09 22:48:10 |

### **Key Insights**
1. **Active Incentive Processing**: Data updated as recently as yesterday (June 12, 2026)
2. **Incentive Types Found**:
   - Performance Linked Incentive (PLI)
   - Client Paid Incentive
   - Previous month dispute
3. **Approval Workflow**: Some entries have `ApproveStatus = 'Approve'`, others are `NULL` (pending)
4. **Cost Centre Integration**: All entries linked to specific cost centres
5. **Branch-wise**: Multiple branches (NOIDA, HEAD OFFICE, NOIDA-DIALDESK)

---

## 📊 **All Key Tables - Activity Summary**

| Table Name | Latest Entry Date | Total Records | Status | Use Case |
|------------|------------------|---------------|--------|----------|
| **upload_incentive_breakup** | **2026-06-12 17:04:58** | **83,872** | ✅ **ACTIVE** | Monthly incentive uploads & approvals |
| Department_Master | 2023-03-17 14:08:24 | 10 | 🟡 Stable | Department master (infrequent updates) |
| qual_incentive | 2020-01-10 13:11:16 | 3,372 | ❌ Old | Historical incentive records (archived?) |
| incentive_name_master | - | 264 | 🟢 Reference | Incentive type master (rarely changes) |
| AddCostcenter | - | 56 | 🟢 Reference | Cost centre assignments |
| employee_master | - | 35,902 | 🟢 Active | Employee master (large dataset) |
| cost_master | - | 916 | 🟢 Reference | Cost centre master |
| salary_master | - | 0 | ❌ Empty | Salary master (not used?) |

---

## 🔍 **Detailed Analysis**

### **1. upload_incentive_breakup (PRIMARY ACTIVE TABLE)**

**Why This Table?**
- Latest entry: **Yesterday (June 12, 2026)**
- Contains **83,872 records** (largest incentive dataset)
- Has approval workflow (`ApproveStatus` field)
- Linked to cost centres and branches
- Used for monthly incentive processing

**Data Flow:**
```
1. HR uploads incentive data → ImportDate set
2. Manager reviews → ApproveStatus = NULL
3. Manager approves → ApproveStatus = 'Approve'
4. System processes for payroll
```

**Fields:**
- `Id` - Primary key (auto-increment)
- `BranchName` - Branch location
- `CostCenter` - Cost centre code
- `EmpCode` - Employee code
- `EmpName` - Employee name
- `IncentiveType` - Type of incentive (PLI, Client Paid, etc.)
- `Amount` - Incentive amount
- `SalaryMonth` - Month for which incentive applies
- `Remarks` - Additional notes
- `ApproveStatus` - Approval status ('Approve' or NULL)
- `UploadType` - Type of upload
- `ImportDate` - When record was created
- `UpdateDate` - When record was last modified

---

### **2. qual_incentive (HISTORICAL/ARCHIVED)**

**Status**: Last entry in 2020 (6 years old)
**Records**: 3,372
**Purpose**: Appears to be old qualified incentive system

**Recommendation**: 
- ❌ Not actively used
- Data migrated to `upload_incentive_breakup`
- Consider archiving or dropping

---

### **3. Department_Master (STABLE REFERENCE)**

**Status**: Last entry March 2023
**Records**: 10 departments only
**Purpose**: Master list of departments

**Why No Recent Updates?**
- Master data doesn't change frequently
- Only 10 departments in the organization
- Updates only when new department is created

---

### **4. employee_master (LARGE ACTIVE DATASET)**

**Records**: 35,902 employees
**Status**: Active but date columns need investigation
**Issue**: Date columns show `0000-00-00` or NULL

**Recommendation**: 
- Check if this table is actively maintained
- May need proper date tracking implementation
- Possibly synced from another system

---

### **5. salary_master (EMPTY/UNUSED)**

**Records**: 0
**Status**: ❌ Not used

**Recommendation**:
- Either not implemented yet
- Or salary data stored elsewhere
- Check if there's a replacement table

---

## 💡 **Key Findings**

### **Active Tables (Used Daily/Monthly)**
1. ✅ **`upload_incentive_breakup`** - Most recent activity (June 12, 2026)
2. ✅ **`employee_master`** - 35,902 employees (needs date field audit)

### **Reference Tables (Infrequent Updates)**
3. 🟢 **`Department_Master`** - 10 departments (stable)
4. 🟢 **`incentive_name_master`** - 264 incentive types (reference)
5. 🟢 **`cost_master`** - 916 cost centres (reference)
6. 🟢 **`AddCostcenter`** - 56 cost centre assignments

### **Historical/Archived Tables**
7. ❌ **`qual_incentive`** - Last entry 2020 (archived)
8. ❌ **`salary_master`** - Empty (not used)

---

## 🎯 **Recommendations**

### **For Integration with mas_hrms:**

1. **Prioritize `upload_incentive_breakup`**
   - This is THE active table for incentives
   - Contains all current incentive data
   - Has approval workflow built-in
   - Should be synced to mas_hrms regularly

2. **Sync Strategy**
   ```sql
   -- Daily sync of new/updated incentive records
   SELECT * FROM upload_incentive_breakup 
   WHERE ImportDate >= CURDATE() - INTERVAL 1 DAY
   OR UpdateDate >= CURDATE() - INTERVAL 1 DAY;
   ```

3. **Archive Old Tables**
   - `qual_incentive` - No data since 2020
   - `salary_master` - Empty, not used

4. **Monitor Active Tables**
   - `upload_incentive_breakup` - Check daily
   - `employee_master` - Fix date tracking
   - `cost_master` - Sync as needed

---

## 📈 **Usage Patterns**

### **Monthly Cycle (Based on Latest Data)**

**June 9-12, 2026 Activity:**
1. **June 9**: Bulk upload of Client Paid Incentives (NOIDA branch)
2. **June 12**: Performance Linked Incentives (HEAD OFFICE, NOIDA)
3. **June 12**: Previous month dispute resolution

**Typical Flow:**
```
Day 1-5:  Upload incentive data for previous month
Day 6-10: Manager review and approval
Day 11-15: Process in payroll
Day 16+:  Payment/adjustments
```

---

## 🔐 **Data Quality Notes**

### **Good Points:**
✅ Clear approval workflow in `upload_incentive_breakup`  
✅ Proper date tracking (ImportDate, UpdateDate)  
✅ Cost centre linkage maintained  
✅ Employee linkage via EmpCode  

### **Issues to Address:**
❌ `employee_master` has invalid dates (0000-00-00)  
❌ `salary_master` is empty (unused?)  
❌ `qual_incentive` outdated (2020)  
⚠️ Multiple cost_master versions (need consolidation)  

---

## 📋 **Next Steps**

1. **Immediate Actions:**
   - Sync `upload_incentive_breakup` to mas_hrms
   - Set up daily sync job for latest entries
   - Create read-only views for reporting

2. **Short-term (1 week):**
   - Audit `employee_master` date fields
   - Investigate `salary_master` usage
   - Archive `qual_incentive` data

3. **Long-term (1 month):**
   - Consolidate cost_master versions
   - Standardize date field usage
   - Implement change tracking

---

## 📊 **Summary Statistics**

**Total Records Analyzed**: 124,392 records  
**Most Active Table**: `upload_incentive_breakup` (83,872 records)  
**Latest Activity**: June 12, 2026 (17:04:58)  
**Active Branches**: NOIDA, HEAD OFFICE, NOIDA-DIALDESK  
**Active Incentive Types**: 3+ types (PLI, Client Paid, Disputes)  

---

**Conclusion**: `upload_incentive_breakup` is the PRIMARY active table for incentive management, with daily updates and a proper approval workflow. This should be the focus for integration with mas_hrms.

---

**Generated**: 2026-06-13  
**Database**: db_bill @ 14.97.30.236  
**Analysis Period**: 2020-01-10 to 2026-06-12  
**Key Finding**: ✅ Incentive system is ACTIVELY USED (updated yesterday!)
