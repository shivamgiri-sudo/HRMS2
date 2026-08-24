# Task 1: Database Migration — salary_dispute table

## Context
This is the first task of the Salary Dispute Module for MAS PeopleOS HRMS.
You are creating the database migration that other tasks depend on.

## Your Job
Create and apply migration file `backend/sql/migrations/434_salary_dispute.sql`.

## Exact SQL to write

```sql
-- backend/sql/migrations/434_salary_dispute.sql
CREATE TABLE IF NOT EXISTS salary_dispute (
  id                        CHAR(36)      NOT NULL DEFAULT (UUID()),
  employee_id               CHAR(36)      NOT NULL,
  employee_code             VARCHAR(50)   NOT NULL,
  run_month                 VARCHAR(7)    NOT NULL COMMENT 'YYYY-MM of disputed payroll',
  dispute_type              ENUM(
    'MISSING_OT','INCORRECT_ATTENDANCE','REGULARIZATION_NOT_APPLIED',
    'LEAVE_NOT_ASSIGNED','INCENTIVE_MISSING','WRONG_DEDUCTION',
    'WRONG_COMPONENT_AMOUNT','SHIFT_ALLOWANCE_MISSING',
    'DOUBLE_DEDUCTION','WRONG_LWP_COUNT','OTHER'
  ) NOT NULL,
  affected_dates            JSON          NOT NULL COMMENT 'Array of YYYY-MM-DD strings',
  description               TEXT          NOT NULL,
  status                    ENUM(
    'draft','pending_wfm','pending_payroll_head','approved','rejected','closed'
  ) NOT NULL DEFAULT 'pending_wfm',
  manager_id                CHAR(36)      NULL COMMENT 'Reporting manager at raise time (view-only)',
  branch_id                 CHAR(36)      NOT NULL,
  process_id                CHAR(36)      NULL,
  wfm_corrective_json       JSON          NULL COMMENT 'Corrective details entered by WFM',
  differential_amount       DECIMAL(10,2) NULL,
  differential_basis        TEXT          NULL COMMENT 'How differential was calculated',
  wfm_remarks               TEXT          NULL,
  wfm_reviewed_at           DATETIME      NULL,
  wfm_reviewed_by           CHAR(36)      NULL,
  payroll_head_remarks      TEXT          NULL,
  payroll_head_reviewed_at  DATETIME      NULL,
  payroll_head_reviewed_by  CHAR(36)      NULL,
  arrear_run_month          VARCHAR(7)    NULL COMMENT 'Month arrear will be/was paid',
  arrear_line_id            CHAR(36)      NULL COMMENT 'FK to salary_prep_line_component.id',
  created_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  PRIMARY KEY (id),
  UNIQUE KEY uq_emp_month_type (employee_id, run_month, dispute_type),
  KEY idx_employee   (employee_id),
  KEY idx_status     (status),
  KEY idx_branch     (branch_id),
  KEY idx_run_month  (run_month),
  KEY idx_manager    (manager_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
```

## Steps

1. Create the file `backend/sql/migrations/434_salary_dispute.sql` with the exact SQL above.

2. Apply it to the dev database:
```bash
cd c:/Users/ADMIN/Desktop/HRMS2-latest/backend
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
const path = require('path');
function fromEnv(k) {
  const e = fs.readFileSync('.env','utf8');
  return e.match(new RegExp('^'+k+'=(.*)$','m'))?.[1]?.replace(/^[\"']|[\"']$/g,'').trim()??null;
}
(async()=>{
  const sql = fs.readFileSync('sql/migrations/434_salary_dispute.sql','utf8');
  const c = await mysql.createConnection({ host: fromEnv('DB_HOST')||'192.168.10.6', port:3306, user: fromEnv('DB_USER'), password: fromEnv('DB_PASSWORD'), database:'mas_hrms', multipleStatements:true });
  await c.query(sql);
  console.log('Migration 434 applied OK');
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
" 2>&1
```
Expected output: `Migration 434 applied OK`

3. Verify the table exists:
```bash
node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
function fromEnv(k) { const e=fs.readFileSync('.env','utf8'); return e.match(new RegExp('^'+k+'=(.*)$','m'))?.[1]?.replace(/^[\"']|[\"']$/g,'').trim()??null; }
(async()=>{
  const c = await mysql.createConnection({ host:fromEnv('DB_HOST')||'192.168.10.6',port:3306,user:fromEnv('DB_USER'),password:fromEnv('DB_PASSWORD'),database:'mas_hrms' });
  const [[r]] = await c.query('SELECT COUNT(*) n FROM information_schema.columns WHERE table_schema=\"mas_hrms\" AND table_name=\"salary_dispute\"');
  console.log('salary_dispute columns:', r.n);
  await c.end();
})().catch(e=>{console.error(e.message);process.exit(1)});
" 2>&1
```
Expected: `salary_dispute columns: 24` (or similar count, just verify > 0)

4. Commit:
```bash
git add backend/sql/migrations/434_salary_dispute.sql
git commit -m "feat(salary-dispute): migration 434 — salary_dispute table"
```

## Report
Write your report to: `c:/Users/ADMIN/Desktop/HRMS2-latest/.superpowers/sdd/briefs/task-1-report.md`
Include: status (DONE/BLOCKED), commit hash, column count from verification.
Return: status, commit hash, one-line summary.
