# Role-Based Function Testing Guide

## Roles Overview
- **Super Admin** — Full system access, all operations
- **HR Admin** — Employee lifecycle, leave, payroll
- **Recruitment HR** — ATS, candidate→employee conversion, offer approval
- **Finance/Payroll** — Payroll runs, salary processing, F&F
- **WFM** — Roster, attendance, shrinkage
- **Branch Head** — Process-scoped operations, approval authority
- **Operations Manager** — Quality, KPI tracking
- **Process Manager** — Process-specific roster, leave approval
- **QA/T&Q** — Quality assessments, anomalies
- **Employee** — Self-service (profile, leave, documents)
- **Client** — Client portal (aggregate data only)

---

## FUNCTION TESTING BY ROLE

### 1. SUPER ADMIN / HR ADMIN

**Employee Creation (POST /api/employees)**
```bash
# Test: Create new employee with all 25 columns
curl -X POST http://localhost:5055/api/employees \
  -H "Authorization: Bearer SUPER_ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeCode": "MAS00500",
    "firstName": "John",
    "lastName": "Doe",
    "email": "john@mas.in",
    "mobile": "9876543210",
    "personalEmail": "john.doe@gmail.com",
    "personalPhone": "9999999999",
    "gender": "Male",
    "dateOfBirth": "1990-01-15",
    "dateOfJoining": "2026-06-21",
    "employmentType": "Full Time",
    "branchId": "branch-uuid",
    "processId": "process-uuid",
    "departmentId": "dept-uuid",
    "designationId": "desig-uuid",
    "reportingManagerId": "mgr-uuid"
  }'

# Verify: Check all 25 columns inserted
mysql -u root -p -e "
USE mas_hrms;
SELECT id, employee_code, first_name, last_name, mobile, personal_phone, 
       address1, permanent_address1, gender, date_of_birth 
FROM employees WHERE employee_code='MAS00500' LIMIT 1;
"
```

**Expected Result:** ✅ All 25 columns present, no NULL in required fields

---

### 2. RECRUITMENT HR

**Offer Approval (POST /api/ats/onboarding/offers/{id}/approve)**
```bash
# Test: Approve offer → auto-create employee + migrate nominees
curl -X POST http://localhost:5055/api/ats/onboarding/offers/offer-uuid/approve \
  -H "Authorization: Bearer RECRUITMENT_HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "remarks": "Approved for joining"
  }'

# Verify: Employee created with offer data
mysql -u root -p -e "
USE mas_hrms;
SELECT e.employee_code, e.first_name, e.mobile, 
       n.nominee_name, n.relationship, n.share_percentage
FROM employees e
LEFT JOIN employee_nominee n ON n.employee_id = e.id
WHERE e.employee_code LIKE 'MAS%' OR e.employee_code LIKE 'IDC%'
ORDER BY e.created_at DESC LIMIT 5;
"

# Expected: Employee + up to 2 nominees with share percentages
```

**Expected Result:** ✅ Employee + nominees auto-migrated from onboarding

---

### 3. HR ADMIN / PROCESS MANAGER

**Leave Request Submission (POST /api/leave/submit)**
```bash
# Test: Submit leave with all 6 validation rules

# 3A: Max 2 days rule
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "cl-uuid",
    "fromDate": "2026-06-22",
    "toDate": "2026-06-25",
    "reason": "Personal work"
  }'
# Expected: ❌ Error "max 2 days"

# 3B: Valid 2-day CL request
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "cl-uuid",
    "fromDate": "2026-06-22",
    "toDate": "2026-06-23",
    "reason": "Personal work"
  }'
# Expected: ✅ Success if balance available

# 3C: Backdated cutoff (only until 5th of month)
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "cl-uuid",
    "fromDate": "2026-06-15",
    "toDate": "2026-06-16",
    "reason": "Personal work"
  }'
# Expected: ❌ Error "backdated requests allowed only until 5th"

# 3D: Balance pool check (CL + ML combined)
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "cl-uuid",
    "fromDate": "2026-06-22",
    "toDate": "2026-06-23",
    "reason": "Checking pool"
  }'
# Expected: ✅ Success with cross-type message if ML used

# 3E: EL continuity (single month block)
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "el-uuid",
    "fromDate": "2026-06-28",
    "toDate": "2026-07-03",
    "reason": "Long leave across months"
  }'
# Expected: ❌ Error "EL must be continuous within one month"

# 3F: EL limits (max 2x/year, max 12 days)
curl -X POST http://localhost:5055/api/leave/submit \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "leaveTypeId": "el-uuid",
    "fromDate": "2026-06-22",
    "toDate": "2026-07-05",
    "reason": "15 days EL"
  }'
# Expected: ⚠️ Routes to Branch Head (exceeds 12 days)
```

**Verify Database:**
```sql
SELECT id, employee_id, leave_type_id, total_days, status, 
       requires_branch_head_approval, cross_type_deduction, 
       payroll_closed_flag, backdated_applied
FROM leave_request 
ORDER BY created_at DESC LIMIT 10;
```

---

### 4. FINANCE/PAYROLL

**Gratuity Distribution (Exit Settlement)**
```bash
# Test: Exit request → create F&F → verify nominee distribution

# 4A: Create exit request
curl -X POST http://localhost:5055/api/exit/requests \
  -H "Authorization: Bearer HR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "employeeId": "emp-uuid",
    "noticeDate": "2026-06-21",
    "lastWorkingDate": "2026-07-21",
    "reasonType": "voluntary"
  }'

# 4B: Verify F&F record created
mysql -u root -p -e "
USE mas_hrms;
SELECT id, employee_id, gratuity_amount, nominee_distribution_status 
FROM full_final_calculation 
WHERE status='draft' 
ORDER BY created_at DESC LIMIT 5;
"

# 4C: Check nominee payouts
mysql -u root -p -e "
USE mas_hrms;
SELECT gd.id, gd.employee_id, gd.nominee_name, gd.payout_amount, gd.status
FROM gratuity_distribution gd
ORDER BY created_at DESC LIMIT 10;
"

# 4D: Verify gratuity calculation audit
mysql -u root -p -e "
USE mas_hrms;
SELECT id, employee_id, years_of_service, basic_monthly, 
       gratuity_formula, gross_gratuity, tax_deducted, net_gratuity
FROM gratuity_calculation_audit
ORDER BY calculation_date DESC LIMIT 5;
"
```

**Expected Result:**
- ✅ F&F record created
- ✅ Nominees distributed by share %
- ✅ Gratuity audit trail recorded

---

### 5. BRANCH HEAD

**Approval Authority (Approve/Reject Leaves)**
```bash
# Test: Branch Head approves EL over-limit requests

# 5A: List pending EL approvals (set by requires_branch_head_approval flag)
curl -X GET "http://localhost:5055/api/leave/approvals?status=pending&leave_type=EL" \
  -H "Authorization: Bearer BRANCH_HEAD_TOKEN"

# 5B: Approve over-limit EL
curl -X POST http://localhost:5055/api/leave/approvals/leave-uuid/approve \
  -H "Authorization: Bearer BRANCH_HEAD_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "remarks": "Exception approved for business need"
  }'

# 5C: Verify approval recorded with cross_type_deduction
mysql -u root -p -e "
USE mas_hrms;
SELECT lr.id, lr.employee_id, lr.total_days, lr.status, 
       lr.requires_branch_head_approval, lr.cross_type_deduction
FROM leave_request lr
WHERE lr.requires_branch_head_approval = 1
ORDER BY lr.created_at DESC LIMIT 10;
"
```

**Expected Result:** ✅ Approval routed to Branch Head, not auto-approved

---

### 6. OPERATIONS MANAGER

**Quality Dashboard (Live Data)**
```bash
# Test: Fetch quality metrics by role

curl -X GET "http://localhost:5055/api/quality-dashboard/summary?process=process-uuid" \
  -H "Authorization: Bearer OPS_MANAGER_TOKEN"

# Expected response includes:
# - Agent quality scores
# - Process KPIs
# - Anomalies
# - No client-portal data leak
```

**Verify Scope:** ✅ Only process-scoped data returned

---

### 7. EMPLOYEE (Self-Service)

**Profile Update (PUT /me/...)**
```bash
# Test: Save sensitive profile data via new endpoints

# 7A: Bank details
curl -X PUT http://localhost:5055/api/employees/me/bank-details \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "bankName": "HDFC",
    "accountNumber": "123456789",
    "ifscCode": "HDFC0001234",
    "accountType": "Savings"
  }'
# Expected: ✅ Saved to employee_bank_detail

# 7B: Nominee
curl -X PUT http://localhost:5055/api/employees/me/nominee \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "nomineeName": "Jane Doe",
    "relationship": "Spouse",
    "dateOfBirth": "1992-03-20",
    "mobile": "9876543210"
  }'
# Expected: ✅ Saved to employee_nominee

# 7C: Emergency contact
curl -X PUT http://localhost:5055/api/employees/me/emergency-contact \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Mom",
    "relationship": "Mother",
    "mobile": "9876543211",
    "address": "123 Main St"
  }'
# Expected: ✅ Saved to employee_emergency_contact

# 7D: Statutory details
curl -X PUT http://localhost:5055/api/employees/me/statutory-details \
  -H "Authorization: Bearer EMPLOYEE_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "panNumber": "ABCDE1234F",
    "aadhaarLast4": "1234",
    "uan": "123456789012",
    "pfNumber": "HR/123456789"
  }'
# Expected: ✅ Saved to employee profile
```

**Verify Database:**
```sql
SELECT bd.bank_name, bd.ifsc_code, 
       en.nominee_name, en.relationship,
       ec.name as emergency_name, ec.mobile
FROM employee_bank_detail bd
JOIN employee_nominee en ON bd.employee_id = en.employee_id
JOIN employee_emergency_contact ec ON en.employee_id = ec.employee_id
WHERE bd.employee_id = 'emp-uuid';
```

---

### 8. CLIENT (Portal Access)

**Client Data Isolation (Read-Only Aggregate)**
```bash
# Test: Client sees only process-scoped, aggregate data (no PII)

curl -X GET "http://localhost:5055/api/client-portal/summary?client_id=client-uuid" \
  -H "Authorization: Bearer CLIENT_TOKEN"

# Expected: ✅ Process summary (no individual employee details)
# Expected: ❌ No personal_email, personal_phone, address, nominee data
# Expected: ❌ No salary/payroll data
```

**Verify:** ✅ No PII leaks to client portal

---

## LEAVE CREDIT VERIFICATION

**Check 12-Month Schedule:**
```sql
SELECT month, leave_code, credit_days FROM leave_credit_schedule ORDER BY month;
-- Expected: (1,CL,1), (2,ML,1), (3,CL,1), (4,ML,1), (5,CL,1), (6,ML,1), 
--          (7,CL,1), (8,CL,1), (9,ML,1), (10,CL,1), (11,ML,1), (12,CL,1)
```

**Check Balance Ledger:**
```sql
SELECT e.employee_code, lt.leave_code, lbl.allocated_days, 
       lbl.used_days, (lbl.allocated_days - lbl.used_days) as available
FROM leave_balance_ledger lbl
JOIN employees e ON e.id = lbl.employee_id
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lbl.balance_year = 2026
ORDER BY e.employee_code, lt.leave_code;
```

---

## TESTING CHECKLIST

- [ ] Super Admin: Create employee (25 columns inserted)
- [ ] Recruitment HR: Approve offer (nominees auto-migrated)
- [ ] Employee: Submit CL (max 2 days enforced)
- [ ] Employee: Submit EL (continuity enforced, limits routed to BH)
- [ ] Employee: Backdated request (rejected after 5th)
- [ ] Branch Head: Approve EL over-limit
- [ ] Finance: Exit settlement (gratuity distribution recorded)
- [ ] Employee: Save bank/nominee/emergency/statutory
- [ ] Client: Portal access (no PII visible)
- [ ] Database: Leave schedule seeded (12 months)
- [ ] Database: Gratuity audit trail (calculation recorded)
- [ ] Database: Cross-type deduction (JSON populated)

---

## Troubleshooting

### Leave validation fails
- Check `leave_credit_schedule` seeded
- Verify employee balance exists in `leave_balance_ledger`
- Check `salary_prep_run.status` not 'closed' for that month

### Nominee not migrating
- Verify `candidate_onboarding_profile` has nominee data
- Check offer approval runs both nominee INSERTs
- Query `employee_nominee` for newly hired employee

### Gratuity distribution not recording
- Check exit request → F&F record created
- Verify `gratuity_distribution` table exists
- Check `nominee_distribution_status` updated

### Bank/Nominee endpoints returning 404
- Verify routes added in `employee.routes.ts` (lines 342-372)
- Check imports present (bankDetailsSchema, etc.)
- Verify service methods exist in `employee.profile.service.ts`
