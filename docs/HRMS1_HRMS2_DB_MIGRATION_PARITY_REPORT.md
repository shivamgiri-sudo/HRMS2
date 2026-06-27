# HRMS1 / HRMS2 DB Migration Parity Report

Audit date: 2026-06-26

## Scope

Only read-only checks were run. No destructive SQL and no data-changing SQL was executed.

## DB Identity

The safe env fingerprint check showed matching `DB_HOST`, `DB_NAME`, and `DB_USER` in `backend/.env`.

Result: HRMS1 and HRMS2 appear configured to use the same DB identity for those keys. Password values were not printed.

## Read-only Schema Check

The read-only DB probe using HRMS2 backend env connected successfully.

Migration-like tables detected: 8.

First detected migration-like tables:

- `expense_migration_staging`
- `ispark_migration_batch`
- `migration_error`
- `migration_error_log`
- `migration_log`

## Critical Table Checks

| Table | Status |
| --- | --- |
| `auth_otp_reset` | present |
| `payroll_salary_slabs` | present |
| `salary_proposal` | present |
| `salary_register` | present |
| `payroll_upload_batch` | missing |
| `payroll_inactive_noc` | missing |
| `finance_budget_plan` | missing |
| `finance_grn_request` | missing |
| `vendor_payment_tracking` | present |

## Critical Migration File Presence

| Migration file | HRMS1 local | HRMS2 local |
| --- | --- | --- |
| `303_auth_password_reset_otp.sql` | present | present |
| `305_runtime_blockers_fix.sql` | present | present |
| `306_salary_bypass_control.sql` | present | present |
| `307_payroll_upload_readiness_noc_export.sql` | missing | missing |
| `308_budget_grn_imprest_vendor_payment.sql` | missing | missing |

## Migration Applied Evidence

The first two migration-like tables sampled did not show the requested migration filenames in the sampled rows. This is not proof that the migrations were never applied, because the detected tables may not be the canonical migration tracking table for these SQL files.

## Conclusion

DB/migration parity does not pass. Several requested schema objects are missing, and the audit did not find applied migration evidence for the listed critical migrations in the sampled migration-like tables.
