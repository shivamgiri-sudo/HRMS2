# Task 1: Database Migration - Add assigned_hr_user_id Column

**Files:**
- Create: `backend/sql/363_joining_document_assigned_hr.sql`

**Interfaces:**
- Consumes: Existing `employee_joining_document_checklist` table schema
- Produces: Column `assigned_hr_user_id CHAR(36) NULL` with index

## Steps

- [ ] **Step 1: Write migration SQL**

Create file `backend/sql/363_joining_document_assigned_hr.sql`:

```sql
-- Add assigned_hr_user_id column for HR task assignment tracking
-- Purpose: Track which HR person is responsible for each employee's document checklist
-- Used by: Bulk Assign HR action + "Assigned HR" column in tracker table

SET @sql = IF(
  (SELECT COUNT(*) FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE()
      AND TABLE_NAME = 'employee_joining_document_checklist'
      AND COLUMN_NAME = 'assigned_hr_user_id') = 0,
  'ALTER TABLE employee_joining_document_checklist 
     ADD COLUMN assigned_hr_user_id CHAR(36) NULL AFTER verified_at,
     ADD INDEX idx_ejdc_assigned_hr (assigned_hr_user_id)',
  'SELECT ''employee_joining_document_checklist.assigned_hr_user_id already exists'' AS note'
);
PREPARE stmt FROM @sql;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
```

- [ ] **Step 2: Test migration on development database**

Run against development MySQL:

```bash
mysql -h 192.168.10.6 -u [user] -p mas_hrms < backend/sql/363_joining_document_assigned_hr.sql
```

Expected: Column added successfully or "already exists" message

- [ ] **Step 3: Verify column exists**

```bash
mysql -h 192.168.10.6 -u [user] -p mas_hrms -e "DESCRIBE employee_joining_document_checklist;" | grep assigned_hr_user_id
```

Expected: Output shows `assigned_hr_user_id | char(36) | YES | | NULL`

- [ ] **Step 4: Commit migration**

```bash
git add backend/sql/363_joining_document_assigned_hr.sql
git commit -m "feat(db): add assigned_hr_user_id column to joining documents checklist

Migration adds assigned_hr_user_id column for tracking HR task assignments.

File: backend/sql/363_joining_document_assigned_hr.sql"
```
