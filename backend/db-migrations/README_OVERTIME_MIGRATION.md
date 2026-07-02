# Payroll Overtime Migration Guide

**Migration**: `007_add_overtime_to_payroll.sql`  
**Date**: 2026-06-16  
**Impact**: Adds overtime tracking to payroll system

---

## What This Migration Does

Adds two new columns to the `salary_prep_line` table:
- `overtime_hours` (DECIMAL 8,2) - Tracks overtime hours worked
- `overtime_amount` (DECIMAL 10,2) - Tracks overtime payment

Adds index for performance optimization on overtime queries.

---

## Pre-Migration Checklist

- [ ] Backup `salary_prep_line` table
- [ ] Verify database credentials
- [ ] Check no active payroll runs are being processed
- [ ] Notify WFM team of new feature

---

## Running the Migration

### Option 1: Direct MySQL Command
```bash
mysql -h 122.184.128.90 -u shuvam -p mas_hrms < 007_add_overtime_to_payroll.sql
```

### Option 2: MySQL Workbench
1. Connect to `122.184.128.90` (mas_hrms database)
2. Open `007_add_overtime_to_payroll.sql`
3. Execute SQL

### Option 3: Manual SQL (if file unavailable)
```sql
USE mas_hrms;

ALTER TABLE salary_prep_line
ADD COLUMN overtime_hours DECIMAL(8,2) DEFAULT 0 COMMENT 'Overtime hours worked (editable by WFM team only)',
ADD COLUMN overtime_amount DECIMAL(10,2) DEFAULT 0 COMMENT 'Overtime payment amount (editable by WFM team only)',
ADD INDEX idx_overtime (employee_id, overtime_hours);

UPDATE salary_prep_line 
SET overtime_hours = 0, overtime_amount = 0 
WHERE overtime_hours IS NULL;
```

---

## Verification

### 1. Check Columns Added
```sql
DESCRIBE salary_prep_line;
-- Should show overtime_hours and overtime_amount columns
```

### 2. Check Index Created
```sql
SHOW INDEX FROM salary_prep_line WHERE Key_name = 'idx_overtime';
```

### 3. Check Data Initialized
```sql
SELECT COUNT(*) AS total_lines,
       SUM(CASE WHEN overtime_hours = 0 THEN 1 ELSE 0 END) AS initialized
FROM salary_prep_line;
-- Both counts should match
```

---

## Rollback (If Needed)

```sql
USE mas_hrms;

ALTER TABLE salary_prep_line
DROP COLUMN overtime_hours,
DROP COLUMN overtime_amount,
DROP INDEX idx_overtime;
```

---

## Post-Migration Steps

### 1. Deploy Backend Code
Deploy these updated files:
- `backend/src/modules/payroll/payroll.types.ts`
- `backend/src/modules/payroll/payroll.validation.ts`
- `backend/src/modules/payroll/payroll.controller.ts`
- `backend/src/modules/payroll/payroll.service.ts`
- `backend/src/modules/payroll/payroll.routes.ts`
- `backend/src/middleware/requireWFMAccess.ts`

### 2. Restart Backend
```bash
# If using PM2
pm2 restart hrms-backend

# If using systemd
sudo systemctl restart hrms-backend

# If using Docker
docker restart hrms-backend
```

### 3. Test API Endpoint
```bash
# Get JWT token for WFM user
TOKEN="your-jwt-token"

# Test overtime update
curl -X PATCH http://localhost:3002/api/payroll/lines/{lineId}/overtime \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"overtimeHours": 10, "overtimeAmount": 2500}'

# Expected response:
# {"success": true, "data": {...overtime_hours: 10, overtime_amount: 2500...}}
```

### 4. Setup WFM User Access
```sql
-- Assign WFM role to users
INSERT INTO user_roles (id, user_id, role, created_at)
SELECT UUID(), 'wfm-user-uuid', 'wfm', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM user_roles WHERE user_id = 'wfm-user-uuid' AND role = 'wfm'
);

-- Assign branch scope
INSERT INTO scope_assignments (id, user_id, branch_id, created_at)
SELECT UUID(), 'wfm-user-uuid', 'branch-uuid', NOW()
WHERE NOT EXISTS (
  SELECT 1 FROM scope_assignments WHERE user_id = 'wfm-user-uuid' AND branch_id = 'branch-uuid'
);
```

---

## Troubleshooting

### Error: "Access denied for user"
**Solution**: 
- Verify database credentials in `.env`
- Check user has ALTER privileges: `SHOW GRANTS FOR 'shuvam'@'%'`
- Use correct host IP (122.184.128.90)

### Error: "Table doesn't exist"
**Solution**:
- Verify you're connected to `mas_hrms` database
- Check table name: `SHOW TABLES LIKE 'salary_prep_line'`

### Error: "Duplicate column name"
**Solution**:
- Migration already run, check: `DESCRIBE salary_prep_line`
- If columns exist but need revert, run rollback SQL

### Migration runs but columns show NULL
**Solution**:
- Run UPDATE statement manually:
```sql
UPDATE salary_prep_line 
SET overtime_hours = 0, overtime_amount = 0 
WHERE overtime_hours IS NULL;
```

---

## Database Backup (Recommended)

### Before Migration
```bash
mysqldump -h 122.184.128.90 -u shuvam -p mas_hrms salary_prep_line > salary_prep_line_backup_$(date +%Y%m%d).sql
```

### Restore if Needed
```bash
mysql -h 122.184.128.90 -u shuvam -p mas_hrms < salary_prep_line_backup_20260616.sql
```

---

## Impact Assessment

### Performance Impact
- **Low**: Adding 2 columns and 1 index
- **No downtime** required
- **Existing queries** unaffected

### Data Impact
- **Safe**: Only adds columns, no data deletion
- **Reversible**: Can rollback with DROP COLUMN
- **Initialized**: All existing rows set to 0 overtime

### Application Impact
- **Backend**: New API endpoint, no breaking changes
- **Frontend**: No immediate impact (new feature)
- **Reports**: Need update to show overtime (future work)

---

## Timeline

| Step | Duration | Status |
|------|----------|--------|
| Backup database | 2 min | ⏳ Pending |
| Run migration | 1 min | ⏳ Pending |
| Verify migration | 2 min | ⏳ Pending |
| Deploy backend | 5 min | ⏳ Pending |
| Test API | 5 min | ⏳ Pending |
| Setup WFM users | 10 min | ⏳ Pending |
| **Total** | **~25 min** | |

---

## Migration Checklist

### Pre-Migration
- [ ] Read this entire guide
- [ ] Backup `salary_prep_line` table
- [ ] Verify database credentials work
- [ ] Check no active payroll processing

### Migration Execution
- [ ] Run migration SQL
- [ ] Verify columns added
- [ ] Verify index created
- [ ] Verify data initialized

### Post-Migration
- [ ] Deploy backend code
- [ ] Restart backend service
- [ ] Test API endpoint with Postman/curl
- [ ] Setup WFM user roles and scopes
- [ ] Notify WFM team of new feature

### Testing
- [ ] WFM user can update overtime for own branch
- [ ] WFM user blocked for other branches
- [ ] Admin can update any branch
- [ ] Cannot update locked/disbursed runs
- [ ] Overtime shows in payroll line query

---

## Support Contacts

**Developer**: Shuvam Giri  
**Module**: Payroll (Overtime Feature)  
**Date**: 2026-06-16

**Related Documentation**:
- Design: `/docs/payroll-design.md`
- Feature: `/docs/payroll-overtime-feature.md`
- Summary: `/docs/PAYROLL_IMPLEMENTATION_SUMMARY.md`

---

## Quick Reference

### API Endpoint
```
PATCH /api/payroll/lines/:lineId/overtime
Authorization: Bearer {jwt-token}
Content-Type: application/json

Body:
{
  "overtimeHours": 15.5,
  "overtimeAmount": 3875
}
```

### Access Control
- **Admin**: Full access, all branches
- **WFM**: Own branch only
- **Others**: No access

### Validation
- `overtimeHours`: 0-200 (decimal, max 2 places)
- `overtimeAmount`: ≥0 (decimal, max 2 places)
- Run status must be `draft` (not locked/disbursed)

---

**Ready to Run**: ✅ All code complete, waiting for migration execution

---
