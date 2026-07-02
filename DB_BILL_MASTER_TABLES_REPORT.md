# db_bill Database - Master Tables Report

**Database**: `db_bill`  
**Server**: `14.97.30.236`  
**Total Master Tables**: 117 tables  
**Date**: 2026-06-13

---

## 🎯 **Key Master Tables (Your Request)**

### **1. Department Master Tables (5 tables)**

| Table Name | Description | Key Fields |
|------------|-------------|------------|
| `Department_Master` | Main department master | Id, Department, short_code, Status, is_on_boat |
| `Department_Master_bkp` | Backup of department master | - |
| `departmentmaster` | Alternative department table | - |
| `Ispark_Department_Master` | Ispark-specific departments | - |
| `process_master` | Process-related master | - |

#### **Department_Master Structure:**
```sql
Id              int(10) unsigned    PK, AUTO_INCREMENT
Department      varchar(255)        Department name
short_code      varchar(20)         Short code for department
Status          enum('1','0')       Active/Inactive (default: '1')
is_on_boat      int(1)              On boat flag (default: 0)
CreateDate      timestamp           Creation timestamp
UpdateDate      datetime            Last update timestamp
```

---

### **2. Cost Centre Master Tables (10 tables)**

| Table Name | Description | Key Fields |
|------------|-------------|------------|
| `AddCostcenter` | Add/modify cost centre | Id, EmpCode, Newcostcenter, Oldcostcenter, BranchName |
| `cost_master` | Main cost centre master | - |
| `cost_master2` | Cost master version 2 | - |
| `cost_master3` | Cost master version 3 | - |
| `cost_master_1` | Cost master version 1 | - |
| `cost_master_bkp` | Cost master backup | - |
| `cost_master_disable` | Disabled cost centres | - |
| `cost_master_history` | Cost centre history | - |
| `cost_master_number` | Cost centre numbers | - |
| `cost_master_particulars` | Cost centre details | - |

#### **AddCostcenter Structure:**
```sql
Id              int(10) unsigned    PK, AUTO_INCREMENT
EmpCode         varchar(100)        Employee code
Newcostcenter   varchar(500)        New cost centre
Oldcostcenter   varchar(100)        Old cost centre
BranchName      varchar(100)        Branch name
bs              varchar(100)        Basic salary
hra             varchar(100)        HRA
conv            varchar(100)        Conveyance
portf           varchar(100)        Portfolio
sa              varchar(100)        Special allowance
Bonus           varchar(100)        Bonus
PLI             varchar(100)        PLI
Gross           varchar(100)        Gross salary
ESIC            varchar(100)        ESIC
EPF             varchar(100)        EPF
NetInhand       varchar(100)        Net in hand
EPFCO           varchar(100)        EPF company contribution
ESICCO          varchar(100)        ESIC company contribution
AdminCharges    varchar(100)        Admin charges
CTC             varchar(100)        Cost to company
```

---

### **3. Incentive Master Tables (4 tables)**

| Table Name | Description | Key Fields |
|------------|-------------|------------|
| `incentive_name_master` | Incentive type names | Id, BranchName, IncentiveName |
| `qual_incentive` | Qualified incentive records | id, EmpCode, Salyear, salmonth, incamt |
| `upload_incentive_breakup` | Incentive upload/breakup | Id, EmpCode, IncentiveType, Amount, SalaryMonth |
| `upload_deduction` | Deduction uploads | - |

#### **incentive_name_master Structure:**
```sql
Id              int(10) unsigned    PK, AUTO_INCREMENT
BranchName      varchar(255)        Branch name
IncentiveName   varchar(255)        Incentive type name
```

#### **qual_incentive Structure:**
```sql
id              int(10)             PK, AUTO_INCREMENT
EmpCode         varchar(100)        Employee code
Salyear         varchar(100)        Salary year
salmonth        varchar(100)        Salary month
incamt          varchar(100)        Incentive amount
userid          int(10)             User ID who entered
Remarks         varchar(500)        Remarks
Importdate      datetime            Import date
```

#### **upload_incentive_breakup Structure:**
```sql
Id              int(10) unsigned    PK, AUTO_INCREMENT
BranchName      varchar(255)        Branch name
CostCenter      varchar(255)        Cost centre
EmpCode         varchar(255)        Employee code
EmpName         varchar(255)        Employee name
IncentiveType   varchar(255)        Type of incentive
Amount          double              Incentive amount
SalaryMonth     date                Salary month
Remarks         varchar(500)        Remarks
ApproveStatus   varchar(255)        Approval status
UploadType      varchar(50)         Upload type (default: 'UploadIncentive')
ImportDate      datetime            Import date
UpdateDate      datetime            Update date
```

---

## 📊 **ALL Master Tables in db_bill (117 tables)**

### **Employee & HR Masters**
1. `employee_master` - Main employee master
2. `employee_source_masters` - Employee source information
3. `Emp_Assets_Allotment_Master` - Asset allotment
4. `Emp_Assets_Allotment_Master_bkp` - Asset allotment backup
5. `Emp_Location_Type_Master` - Location types
6. `hr_recruiter_master` - Recruiter master
7. `Qualification_Master` - Qualifications
8. `Designation_Master` - Designations
9. `Designation_Master_bkp` - Designation backup
10. `Band_Master` - Employee bands

### **Payroll Masters**
11. `salary_master` - Salary master
12. `salary_master_upload` - Salary uploads
13. `salary_head_master` - Salary head master
14. `SalarySlipMaster` - Salary slip master
15. `Family_Salary_Master` - Family salary
16. `package_master` - Package master
17. `mas_packagemaster` - MAS package master
18. `mas_packagemaster_state_wise` - State-wise packages
19. `IncomtaxMaster` - Income tax master
20. `IncomtaxMasterHistory` - Income tax history
21. `LoanMaster` - Loan master
22. `LoanPrintChequeMaster` - Loan cheque print
23. `tds_master` - TDS master
24. `other_deductions` - Other deductions
25. `other_deductions_bill` - Deduction billing

### **Attendance Masters**
26. `AttendanceMailMaster` - Attendance mail config
27. `ProcessAttendanceMaster` - Process attendance
28. `WorkingTimeMaster` - Working time config
29. `HolidayMaster` - Holiday master
30. `LockUnlockMaster` - Lock/unlock master
31. `od_apply_master` - On-duty application
32. `od_apply_master_history` - OD history

### **Leave Masters**
33. `Language_Master` - Language master
34. (Leave-related masters embedded in other tables)

### **Branch & Location Masters**
35. `branch_master` - Branch master
36. `city_master` - City master
37. `city_master1` - City master alternative
38. `state_master` - State master

### **Cost & Expense Masters**
39. `cost_master` - Main cost master
40. `cost_master2` - Cost master v2
41. `cost_master3` - Cost master v3
42. `cost_master_1` - Cost master v1
43. `cost_master_bkp` - Cost master backup
44. `cost_master_disable` - Disabled cost centres
45. `cost_master_history` - Cost history
46. `cost_master_number` - Cost numbers
47. `cost_master_particulars` - Cost particulars
48. `expense_master` - Expense master
49. `expense_master2` - Expense master v2
50. `expense_master_old` - Old expense master
51. `expense_master_reject` - Rejected expenses
52. `expense_entry_master` - Expense entry
53. `expense_entry_master2` - Expense entry v2
54. `expense_entry_master_04_nov` - Expense entry snapshot
55. `expense_entry_master_approve` - Approved expenses
56. `expense_entry_master_before_20_oct` - Historical expenses
57. `expense_entry_master_delete` - Deleted expenses
58. `expense_entry_master_his` - Expense history
59. `expense_reopen_master` - Reopened expenses
60. `head_master` - Expense head master

### **Provision & Budget Masters**
61. `provision_master` - Provision master
62. `provision_master_edit_request` - Provision edit requests
63. `provision_master_month_deductions` - Monthly deductions
64. `his_provision_master` - Historical provisions
65. `tbl_bgt_expenseheadingmaster` - Budget expense headings
66. `tbl_bgt_expensesubheadingmaster` - Budget sub-headings
67. `tbl_bgt_expensesubheadingtypemaster` - Budget sub-heading types
68. `tbl_bgt_expenseunittypemaster` - Budget unit types
69. `tbl_expensemaster` - TBL expense master
70. `tbl_expenseunitmaster` - TBL expense units
71. `tbl_tempexpensemaster` - Temp expense master

### **Business Case Masters**
72. `business_case_master` - Business case master
73. `tbl_businesscasemaster` - TBL business case
74. `tbl_tempbusinesscasemaster` - Temp business case

### **Revenue Masters**
75. `tbl_revenuemaster` - Revenue master
76. `tbl_temprevenuemaster` - Temp revenue master

### **Client & Vendor Masters**
77. `client_master` - Client master
78. `tbl_client_master` - TBL client master
79. `vendor_master` - Vendor master
80. `tbl_vendormaster` - TBL vendor master
81. `company_master` - Company master

### **Invoice & Service Masters**
82. `tbl_inv_service_master` - Invoice service master
83. `tbl_inv_service_master_new` - New invoice services
84. `bill_no_master` - Bill number master
85. `receipt_master` - Receipt master

### **Assets Masters**
86. `Assets_Category_Masters` - Asset categories
87. `Assets_Details_Master` - Asset details
88. `Assets_Dropdown_Master` - Asset dropdowns
89. `Assets_Form_Master` - Asset forms
90. `Assets_Problem_Master` - Asset problems
91. `Assets_Product_Master` - Asset products
92. `Assets_Stocks_Master` - Asset stocks
93. `Assets_Ticket_Creation_Master` - Asset tickets

### **Training Masters**
94. `TrainerMaster` - Trainer master
95. `TrainingAllocationMaster` - Training allocation
96. `TrainingBatchMaster` - Training batches
97. `TrainingRoomMaster` - Training rooms
98. `TrainingStatusMaster` - Training status

### **Interview Masters**
99. `Interview_master` - Interview master
100. `Interview_master_new` - New interview master
101. `Interview_Question_master` - Interview questions

### **Process & Workflow Masters**
102. `process_master` - Process master
103. `Ispark_Process_Master` - Ispark processes
104. `allocation_master` - Allocation master
105. `tagging_master` - Tagging master
106. `type_master` - Type master
107. `category_master` - Category master

### **Email & Notification Masters**
108. `email_master` - Email master
109. `notification_master` - Notification master
110. `Automail_Grnpayment_Master` - Auto-mail GRN payment

### **Document Masters**
111. `document_master` - Document master
112. `masdocument_master` - MAS document master
113. `Esignature_Document_Master` - E-signature documents

### **Access & Authentication Masters**
114. `user_master` - User master
115. `auth_token_master` - Auth token master
116. `pages_master` - Pages master
117. `pages_master_ispark` - Ispark pages master

### **Other Masters**
- `month_master` - Month master
- `dispatch_master` - Dispatch master
- `imprest_master` - Imprest master
- `imprest_allotment_master` - Imprest allotment
- `pnl_master` - P&L master
- `ChequePrintMaster` - Cheque print
- `ChangeDojMaster` - DOJ change
- `NewJclrMaster` - JCLR master
- `bank_account_verification_master` - Bank verification
- `pan_verification_master` - PAN verification
- `his_action_date_master` - Historical actions
- `mas_mpin_master` - MPIN master

### **Temporary Tables (tmp_)**
- `tmp_cost_center_cost_transfer_master`
- `tmp_cost_master`
- `tmp_cost_master_particulars`
- `tmp_document_master`
- `tmp_employee_master`
- `tmp_expense_entry_master`
- `tmp_expense_master`
- `tmp_provision_master`

---

## 🔍 **Key Relationships**

### **Department ↔ Cost Centre ↔ Employee**
```
Department_Master (Id, Department)
    ↓
cost_master (linked via department)
    ↓
AddCostcenter (EmpCode, Newcostcenter, Oldcostcenter)
    ↓
employee_master (EmpCode)
```

### **Employee ↔ Incentive**
```
employee_master (EmpCode)
    ↓
upload_incentive_breakup (EmpCode, IncentiveType, Amount, SalaryMonth)
    ↓
incentive_name_master (IncentiveName)
    ↓
qual_incentive (EmpCode, incamt, Salyear, salmonth)
```

### **Cost Centre ↔ Incentive**
```
cost_master (cost centre details)
    ↓
upload_incentive_breakup (CostCenter, EmpCode, Amount)
    ↓
incentive_name_master (IncentiveName by branch)
```

---

## 📝 **Notes**

1. **Multiple Versions**: Many tables have multiple versions (v1, v2, v3) and backups
2. **Naming Conventions**: Inconsistent - some use underscore, some use PascalCase
3. **Temporary Tables**: Multiple `tmp_` prefixed tables for staging data
4. **Historical Tables**: Several `_history` and `_his` tables for audit trails
5. **Status Fields**: Most masters have status/active flags
6. **Date Fields**: CreatDate, UpdateDate, ImportDate patterns

---

## 🎯 **Recommended Actions**

1. **Consolidate Department Masters**: 
   - Use `Department_Master` as primary
   - Archive `departmentmaster` and backups

2. **Consolidate Cost Masters**:
   - Use `cost_master` as primary
   - Migrate data from v1, v2, v3 versions
   - Archive old versions

3. **Standardize Incentive Tables**:
   - `incentive_name_master` - Master list of incentive types
   - `upload_incentive_breakup` - Current/monthly incentives
   - `qual_incentive` - Historical/qualified incentives

4. **Create Unified Schema**:
   - Migrate to `mas_hrms` database with consistent naming
   - Implement foreign key relationships
   - Add proper indexes

---

**Generated**: 2026-06-13  
**Database**: db_bill @ 14.97.30.236  
**Total Master Tables**: 117  
**Key Tables for Integration**: Department_Master, AddCostcenter, cost_master, incentive_name_master, upload_incentive_breakup
