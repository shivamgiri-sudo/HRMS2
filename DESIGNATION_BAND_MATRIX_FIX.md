# Designation-Band Matrix - Blank Data Issue - FIXED

**Issue:** Designation-Band Matrix showing blank/no data  
**Root Cause:** Table `designation_band_matrix` not created in database  
**Solution:** Create table and verify data

---

## 🔍 Problem Analysis

### **What's Wrong:**
1. ✅ Frontend page exists: `NativePayrollMasters.tsx`
2. ✅ Backend API exists: `/api/payroll-masters/matrix`
3. ✅ SQL schema exists: `135_payroll_masters.sql`
4. ❌ **Table NOT created in database**

### **Why it's Blank:**
The API query tries to SELECT from `designation_band_matrix` table, but the table doesn't exist, causing the query to fail and return empty data.

---

## ✅ Solution: Create the Table

### **Step 1: Run SQL Migration**

```bash
cd /home/shuvam/hrms-audit/backend

# Run the migration script
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms < sql/135_payroll_masters.sql
```

### **Step 2: Verify Table Created**

```sql
-- Check if table exists
SHOW TABLES LIKE 'designation_band_matrix';

-- Check table structure
DESC designation_band_matrix;

-- Check data count
SELECT COUNT(*) FROM designation_band_matrix;
```

---

## 📊 Table Schema

```sql
CREATE TABLE IF NOT EXISTS designation_band_matrix (
  id             CHAR(36)   NOT NULL DEFAULT (UUID()) PRIMARY KEY,
  department_id  CHAR(36)   NOT NULL,
  designation_id CHAR(36)   NOT NULL,
  grade_id       CHAR(36)   NOT NULL,
  min_slab_id    CHAR(36)   NULL,
  active_status  TINYINT(1) NOT NULL DEFAULT 1,
  created_by     CHAR(36)   NULL,
  created_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME   NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  
  UNIQUE KEY uq_dbm (department_id, designation_id),
  INDEX idx_dbm_grade (grade_id)
);
```

---

## 🎯 What This Table Does

**Purpose:** Maps Designations to Grade Bands and Salary Slabs

**Example Data:**
| Department | Designation | Grade Band | Min Slab |
|------------|-------------|------------|----------|
| Sales | Manager | Band A | ₹50K-75K |
| IT | Senior Developer | Band B | ₹60K-90K |
| HR | HR Executive | Band C | ₹35K-50K |

---

## 📝 How to Add Data

### **Option 1: Via UI** (Recommended)

1. Navigate to: `/payroll-masters`
2. Click "Designation-Band Matrix" tab
3. Click "+ Add" button
4. Fill in:
   - Department (e.g., Sales, IT, HR)
   - Designation (e.g., Manager, Developer)
   - Grade/Band (e.g., Band A, Band B)
   - Minimum Slab (e.g., S1, S2)
5. Click "Create"

### **Option 2: Via API**

```bash
curl -X POST http://localhost:5055/api/payroll-masters/matrix \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -d '{
    "department_id": "dept-uuid-here",
    "designation_id": "designation-uuid-here",
    "grade_id": "grade-uuid-here",
    "min_slab_id": "slab-uuid-here"
  }'
```

### **Option 3: Bulk Import via SQL**

```sql
-- Sample data insertion
INSERT INTO designation_band_matrix 
(id, department_id, designation_id, grade_id, min_slab_id, active_status)
SELECT 
    UUID(),
    dm.id AS department_id,
    desm.id AS designation_id,
    gbm.id AS grade_id,
    ssm.id AS min_slab_id,
    1
FROM department_master dm
CROSS JOIN designation_master desm
CROSS JOIN grade_band_master gbm
LEFT JOIN salary_slab_master ssm ON ssm.seq_order = 1
WHERE dm.active_status = 1
  AND desm.active_status = 1
  AND gbm.active_status = 1
LIMIT 10;  -- Remove limit for all combinations
```

### **Option 4: Bulk Import via CSV (UI)**

1. In UI, click "Bulk Import" button
2. Paste CSV in format:
   ```
   dept_id,desig_id,grade_id,min_slab_id
   uuid1,uuid2,uuid3,uuid4
   uuid5,uuid6,uuid7,uuid8
   ```
3. Click "Import"

---

## 🧪 Testing

### **Test 1: Check Table Exists**
```sql
USE mas_hrms;
SHOW TABLES LIKE 'designation_band_matrix';
-- Expected: designation_band_matrix
```

### **Test 2: Check Data**
```sql
SELECT 
    dbm.*,
    dm.dept_name AS department,
    desm.designation_name AS designation,
    gbm.grade_name AS band,
    ssm.label AS slab
FROM designation_band_matrix dbm
JOIN department_master dm ON dm.id = dbm.department_id
JOIN designation_master desm ON desm.id = dbm.designation_id
JOIN grade_band_master gbm ON gbm.id = dbm.grade_id
LEFT JOIN salary_slab_master ssm ON ssm.id = dbm.min_slab_id
WHERE dbm.active_status = 1
LIMIT 10;
```

### **Test 3: Test API**
```bash
# Test list endpoint
curl http://localhost:5055/api/payroll-masters/matrix \
  -H "Authorization: Bearer YOUR_TOKEN"

# Expected: {"success":true,"data":[...]}
```

### **Test 4: Test Frontend**
1. Open: http://localhost:8083/payroll-masters
2. Click "Designation-Band Matrix" tab
3. Should see data in table (or "No matrix entries found" if empty)
4. Click "+ Add" button - should open form
5. Select dropdowns - should have options

---

## 🔧 Troubleshooting

### **Issue 1: Table Creation Fails**

**Error:** `Table 'designation_band_matrix' already exists`

**Solution:** Table exists but might be corrupted. Check:
```sql
SELECT * FROM designation_band_matrix LIMIT 1;
```

### **Issue 2: Foreign Key Errors**

**Error:** `Cannot add or update a child row: a foreign key constraint fails`

**Solution:** Check if referenced tables exist:
```sql
-- Check if parent tables exist
SHOW TABLES LIKE 'department_master';
SHOW TABLES LIKE 'designation_master';
SHOW TABLES LIKE 'grade_band_master';
SHOW TABLES LIKE 'salary_slab_master';

-- Check if they have data
SELECT COUNT(*) FROM department_master;
SELECT COUNT(*) FROM designation_master;
SELECT COUNT(*) FROM grade_band_master;
SELECT COUNT(*) FROM salary_slab_master;
```

### **Issue 3: Still Showing Blank After Creating Table**

**Cause:** Table is empty

**Solution:** Add data using one of the methods above

---

## 📋 Prerequisites

Before the matrix will work, you need:

1. ✅ **Departments** (`department_master`)
   ```sql
   SELECT id, dept_name FROM department_master WHERE active_status = 1;
   ```

2. ✅ **Designations** (`designation_master`)
   ```sql
   SELECT id, designation_name FROM designation_master WHERE active_status = 1;
   ```

3. ✅ **Grade Bands** (`grade_band_master`)
   ```sql
   SELECT id, grade_name, band FROM grade_band_master WHERE active_status = 1;
   ```

4. ✅ **Salary Slabs** (`salary_slab_master`)
   ```sql
   SELECT id, label, range_from, range_to FROM salary_slab_master WHERE active_status = 1;
   ```

If any of these are empty, the dropdowns in the form will be empty.

---

## 🚀 Quick Fix Commands

```bash
# 1. Create table
cd /home/shuvam/hrms-audit/backend
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms < sql/135_payroll_masters.sql

# 2. Verify
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms -e "DESC designation_band_matrix"

# 3. Check prerequisites
mysql -h 122.184.128.90 -u shivam_user -p'Mas@2024$secure' mas_hrms -e "
SELECT 
    (SELECT COUNT(*) FROM department_master WHERE active_status=1) AS departments,
    (SELECT COUNT(*) FROM designation_master WHERE active_status=1) AS designations,
    (SELECT COUNT(*) FROM grade_band_master WHERE active_status=1) AS bands,
    (SELECT COUNT(*) FROM salary_slab_master WHERE active_status=1) AS slabs;
"

# 4. Test API
curl http://localhost:8083/api/payroll-masters/matrix | jq
```

---

## ✅ Success Criteria

Matrix is working when:

- [ ] Table `designation_band_matrix` exists
- [ ] Can view matrix page without errors
- [ ] Can click "+ Add" and see form
- [ ] Dropdowns have options (departments, designations, bands, slabs)
- [ ] Can create new matrix entry
- [ ] Created entry appears in table

---

## 📞 Related Files

- **Frontend:** `src/pages/NativePayrollMasters.tsx`
- **Backend API:** `backend/src/modules/payroll-masters/payrollMasters.routes.ts`
- **Backend Service:** `backend/src/modules/payroll-masters/payrollMasters.service.ts`
- **SQL Schema:** `backend/sql/135_payroll_masters.sql`
- **API Route:** `GET /api/payroll-masters/matrix`

---

**Status:** ✅ **Solution Ready**  
**Action:** Run SQL migration to create table  
**ETA:** 1 minute to fix

**Last Updated:** June 15, 2026
