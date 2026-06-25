# HRMS2 Production Migration Validation Report

**Date:** 2026-06-25  
**Target DB:** mas_hrms  
**Migrations in scope:** 303, 305, 306  
**Status:** PRE-EXECUTION — schema check commands documented, not yet run

> **Rule:** Do not apply any migration without: (a) DB backup confirmed, (b) schema pre-check run, (c) user/DBA approval.

---

## Pre-Check: Schema Status Queries

Run these SQL queries against the production `mas_hrms` DB BEFORE applying any migration.  
Document actual results in the "Actual Result" column.

```sql
-- ─── MIGRATION 303 checks ─────────────────────────────────────────────────────

-- 303-A: auth_otp_reset table
SHOW TABLES LIKE 'auth_otp_reset';
-- Expected if not applied: empty result set
-- Expected if already applied: 'auth_otp_reset' row

-- 303-B: is_read_only column on auth_user
SHOW COLUMNS FROM auth_user LIKE 'is_read_only';
-- Expected if not applied: empty result set
-- Expected if already applied: column definition row

-- ─── MIGRATION 305 checks ─────────────────────────────────────────────────────

-- 305-A: exit_retention_action table
SHOW TABLES LIKE 'exit_retention_action';

-- 305-B: auth_user_id alias column on employees
SHOW COLUMNS FROM employees LIKE 'auth_user_id';

-- 305-C: overall_match_status alias on candidate_name_match_summary
SHOW COLUMNS FROM candidate_name_match_summary LIKE 'overall_match_status';
-- Note: if candidate_name_match_summary doesn't exist yet, skip — dependent migration.

-- 305-D: ats_bgv_verification ENUM extension (must include completed/approved/cleared)
SHOW COLUMNS FROM ats_bgv_verification LIKE 'verification_status';

-- 305-E: pay_month alias on incentive_upload_batch
SHOW COLUMNS FROM incentive_upload_batch LIKE 'pay_month';

-- ─── MIGRATION 306 checks ─────────────────────────────────────────────────────

-- 306-A: payroll_salary_slabs table
SHOW TABLES LIKE 'payroll_salary_slabs';

-- 306-B: salary_proposal table
SHOW TABLES LIKE 'salary_proposal';

-- 306-C: salary_register table
SHOW TABLES LIKE 'salary_register';

-- 306-D: salary_register_audit_log table
SHOW TABLES LIKE 'salary_register_audit_log';

-- 306-E: salary_slab_id column on employee_salary_assignment
SHOW COLUMNS FROM employee_salary_assignment LIKE 'salary_slab_id';

-- 306-F: salary_proposal_id column
SHOW COLUMNS FROM employee_salary_assignment LIKE 'salary_proposal_id';

-- 306-G: governance_mode column
SHOW COLUMNS FROM employee_salary_assignment LIKE 'governance_mode';

-- 306-H: assigned_by column
SHOW COLUMNS FROM employee_salary_assignment LIKE 'assigned_by';
```

---

## Pre-Check Results (to be filled by DBA)

| Check | Object | Expected | Actual Result | Status |
|---|---|---|---|---|
| 303-A | auth_otp_reset table | Not present OR present | _(run query)_ | PENDING |
| 303-B | auth_user.is_read_only | Not present OR present | _(run query)_ | PENDING |
| 305-A | exit_retention_action table | Not present OR present | _(run query)_ | PENDING |
| 305-B | employees.auth_user_id | Not present OR present | _(run query)_ | PENDING |
| 305-C | candidate_name_match_summary.overall_match_status | Not present OR present | _(run query)_ | PENDING |
| 305-D | ats_bgv_verification.verification_status ENUM | Missing completed/approved/cleared | _(run query)_ | PENDING |
| 305-E | incentive_upload_batch.pay_month | Not present OR present | _(run query)_ | PENDING |
| 306-A | payroll_salary_slabs table | Not present | _(run query)_ | PENDING |
| 306-B | salary_proposal table | Not present | _(run query)_ | PENDING |
| 306-C | salary_register table | Not present | _(run query)_ | PENDING |
| 306-D | salary_register_audit_log table | Not present | _(run query)_ | PENDING |
| 306-E | employee_salary_assignment.salary_slab_id | Not present | _(run query)_ | PENDING |
| 306-F | employee_salary_assignment.salary_proposal_id | Not present | _(run query)_ | PENDING |
| 306-G | employee_salary_assignment.governance_mode | Not present | _(run query)_ | PENDING |
| 306-H | employee_salary_assignment.assigned_by | Not present | _(run query)_ | PENDING |

---

## Migration Application Commands

After backup is confirmed and pre-checks are reviewed:

```sql
-- Apply in order:
SOURCE /path/to/backend/sql/303_auth_password_reset_otp.sql;
SOURCE /path/to/backend/sql/305_runtime_blockers_fix.sql;
SOURCE /path/to/backend/sql/306_salary_bypass_control.sql;
```

Or using MySQL CLI:
```bash
mysql -u <user> -p mas_hrms < backend/sql/303_auth_password_reset_otp.sql
mysql -u <user> -p mas_hrms < backend/sql/305_runtime_blockers_fix.sql
mysql -u <user> -p mas_hrms < backend/sql/306_salary_bypass_control.sql
```

All three migrations are safe to re-run (idempotent):
- Migration 303: uses stored procedure with `IF NOT EXISTS` checks
- Migration 305: uses `IF NOT EXISTS` + `CREATE PROCEDURE IF NOT EXISTS` + `CREATE TABLE IF NOT EXISTS`
- Migration 306: uses `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ... ADD COLUMN IF NOT EXISTS` + `INSERT IGNORE`

---

## Post-Application Verification Queries

```sql
-- After migrations applied, run to confirm:

SHOW TABLES LIKE 'auth_otp_reset';                         -- must return 1 row
SHOW COLUMNS FROM auth_user LIKE 'is_read_only';           -- must return column row

SHOW TABLES LIKE 'exit_retention_action';                  -- must return 1 row
SHOW COLUMNS FROM employees LIKE 'auth_user_id';           -- must return column row

SHOW TABLES LIKE 'payroll_salary_slabs';                   -- must return 1 row
SHOW TABLES LIKE 'salary_proposal';                        -- must return 1 row
SHOW TABLES LIKE 'salary_register';                        -- must return 1 row
SHOW TABLES LIKE 'salary_register_audit_log';              -- must return 1 row

SELECT COUNT(*) FROM payroll_salary_slabs;                 -- should be > 0 (seeded from salary_slab_master)
SELECT COUNT(*) FROM salary_proposal;                      -- 0 is expected (no proposals yet)
SELECT COUNT(*) FROM salary_register;                      -- 0 is expected

SHOW COLUMNS FROM employee_salary_assignment LIKE 'salary_slab_id';
SHOW COLUMNS FROM employee_salary_assignment LIKE 'salary_proposal_id';
SHOW COLUMNS FROM employee_salary_assignment LIKE 'governance_mode';
SHOW COLUMNS FROM employee_salary_assignment LIKE 'assigned_by';
```

---

## Post-Application Results (to be filled by DBA)

| Object | Expected | Actual | Status |
|---|---|---|---|
| auth_otp_reset table | Present | _(run)_ | PENDING |
| auth_user.is_read_only | Present | _(run)_ | PENDING |
| exit_retention_action table | Present | _(run)_ | PENDING |
| employees.auth_user_id | Present | _(run)_ | PENDING |
| payroll_salary_slabs table | Present + row count > 0 | _(run)_ | PENDING |
| salary_proposal table | Present | _(run)_ | PENDING |
| salary_register table | Present | _(run)_ | PENDING |
| salary_register_audit_log table | Present | _(run)_ | PENDING |
| employee_salary_assignment.salary_slab_id | Present | _(run)_ | PENDING |
| employee_salary_assignment.salary_proposal_id | Present | _(run)_ | PENDING |
| employee_salary_assignment.governance_mode | Present | _(run)_ | PENDING |
| employee_salary_assignment.assigned_by | Present | _(run)_ | PENDING |

---

## Decision Gate

**Do not restart PM2 or mark migration complete unless all post-application results are PASS.**

If any migration fails with a SQL error:
1. STOP. Do not apply subsequent migrations.
2. Record exact SQL error here.
3. Restore from backup (see `HRMS2_DB_BACKUP_AND_ROLLBACK_PLAN.md`).
4. Investigate and fix SQL file before re-attempting.

**Approver sign-off required:** DBA + Release Manager  
**Date applied:** _(fill on execution)_  
**Applied by:** _(fill on execution)_
