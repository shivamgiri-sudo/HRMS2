# HRMS2 DB Backup and Rollback Plan

**Date:** 2026-06-25  
**Target database:** mas_hrms  
**Host:** As configured in production .env (DB_HOST / DB_PORT)  
**Migrations being protected:** 303, 305, 306

> **RULE: No migration may be applied to production without the backup file confirmed present and restorable.**

---

## 1. Backup Command

```bash
# Create backup directory first
mkdir -p "c:\Users\shivamg\Upgraded HRMS\backups"

# Take full dump (replace <user> and run interactively for password prompt):
mysqldump -u <user> -p \
  --single-transaction \
  --routines \
  --triggers \
  --set-gtid-purged=OFF \
  mas_hrms \
  > "c:\Users\shivamg\Upgraded HRMS\backups\mas_hrms_pre_go_live_20260625_HHMM.sql"
```

**Notes:**
- `--single-transaction`: ensures consistent snapshot for InnoDB without locking tables
- `--routines`: includes stored procedures (migration 303 uses a stored procedure that is dropped after)
- Replace `HHMM` with actual time (e.g. `1045`)
- If MySQL host is remote, run from the server where MySQL is accessible

---

## 2. Backup File Path

```
c:\Users\shivamg\Upgraded HRMS\backups\mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql
```

The backups directory is in `.gitignore` — backup files are never committed to Git.

---

## 3. Verify Backup Integrity

```bash
# Check file exists and has content (must be > 0 bytes):
ls -lh "c:\Users\shivamg\Upgraded HRMS\backups\mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql"

# Quick sanity check — dump should contain CREATE TABLE statements:
grep -c "CREATE TABLE" "c:\Users\shivamg\Upgraded HRMS\backups\mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql"
# Expected: > 50 (the database has > 50 tables)
```

---

## 4. Tables Impacted by Migrations 303 / 305 / 306

### Migration 303 — New + Modified
| Table / Object | Change |
|---|---|
| `auth_user` | ADD COLUMN `is_read_only TINYINT(1) DEFAULT 0` |
| `auth_otp_reset` | CREATE TABLE (new) |

### Migration 305 — New + Modified
| Table / Object | Change |
|---|---|
| `exit_retention_action` | CREATE TABLE (new) |
| `employees` | ADD COLUMN `auth_user_id` (generated alias for `user_id`) |
| `candidate_name_match_summary` | ADD COLUMN `overall_match_status` (generated alias for `overall_status`) |
| `ats_bgv_verification` | MODIFY COLUMN `verification_status` ENUM — add values `completed`, `approved`, `cleared` |
| `incentive_upload_batch` | ADD COLUMN `pay_month` (generated alias for `salary_month`) |
| `incentive_payroll_register` | ADD COLUMN `pay_month` (generated alias for `salary_month`) |

### Migration 306 — New + Modified
| Table / Object | Change |
|---|---|
| `payroll_salary_slabs` | CREATE TABLE (new) |
| `salary_proposal` | CREATE TABLE (new) |
| `salary_register` | CREATE TABLE (new) |
| `salary_register_audit_log` | CREATE TABLE (new) |
| `employee_salary_assignment` | ADD COLUMNS: `salary_slab_id`, `salary_proposal_id`, `governance_mode`, `assigned_by`, `assignment_reason` |
| `access_pages` | INSERT IGNORE for `SALARY_SLAB_MASTER`, `SALARY_PROPOSAL_QUEUE` page codes |

---

## 5. Rollback Plan

If any migration fails or causes unexpected production errors after application:

### Step 1 — Stop backend
```bash
pm2 stop hrms-backend
```

### Step 2 — Restore backup
```bash
mysql -u <user> -p mas_hrms < "c:\Users\shivamg\Upgraded HRMS\backups\mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql"
```

**Warning:** This restore will DROP all tables and re-create them from the dump. Any data written AFTER the backup was taken will be lost. Inform all users to stop activity before restore.

### Step 3 — Verify restore
```sql
-- Confirm tables reverted to pre-migration state:
SHOW COLUMNS FROM auth_user LIKE 'is_read_only';   -- should return empty (not present)
SHOW TABLES LIKE 'auth_otp_reset';                 -- should return empty (not present)
SHOW TABLES LIKE 'payroll_salary_slabs';           -- should return empty (not present)
```

### Step 4 — Restart backend on pre-migration code
```bash
# Checkout the commit before migration was applied:
git checkout 797bc81  -- or the commit before c103fb0

# Rebuild backend
cd backend && npm run build

# Restart PM2
pm2 restart hrms-backend
```

### Step 5 — Confirm health
```bash
curl http://localhost:5056/api/health
# Expected: { "success": true, "status": "healthy" }
```

---

## 6. Rollback Command Reference (Quick)

```bash
# Emergency full rollback — restore DB + restart previous build:
mysql -u <user> -p mas_hrms < backups/mas_hrms_pre_go_live_YYYYMMDD_HHMM.sql
pm2 restart hrms-backend
curl http://localhost:5056/api/health
```

---

## 7. Validation Query After Rollback

```sql
-- All of these should return EMPTY result sets after rollback:
SHOW COLUMNS FROM auth_user LIKE 'is_read_only';
SHOW TABLES LIKE 'auth_otp_reset';
SHOW TABLES LIKE 'exit_retention_action';
SHOW TABLES LIKE 'payroll_salary_slabs';
SHOW TABLES LIKE 'salary_proposal';
SHOW TABLES LIKE 'salary_register';
SHOW COLUMNS FROM employee_salary_assignment LIKE 'salary_slab_id';
```

---

## 8. Responsible Person

| Action | Owner |
|---|---|
| Take backup | DBA / DevOps Engineer |
| Verify backup integrity | DBA |
| Apply migrations | DBA (with Release Manager approval) |
| Post-migration schema check | DBA |
| Rollback if required | DBA + Backend Engineer |
| PM2 restart after migration | DevOps Engineer |

---

## 9. Date / Time

| Event | Timestamp | Person |
|---|---|---|
| Backup taken | _(fill on execution)_ | _(fill)_ |
| Backup verified | _(fill on execution)_ | _(fill)_ |
| Migration 303 applied | _(fill on execution)_ | _(fill)_ |
| Migration 305 applied | _(fill on execution)_ | _(fill)_ |
| Migration 306 applied | _(fill on execution)_ | _(fill)_ |
| Post-migration schema check | _(fill on execution)_ | _(fill)_ |
| PM2 restarted | _(fill on execution)_ | _(fill)_ |
