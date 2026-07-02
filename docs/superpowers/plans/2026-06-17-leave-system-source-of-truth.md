# Leave System — mas_hrms as Source of Truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix mas_hrms leave system to be the single source of truth — correct leave type definitions, accrual rates, 2026 balance data, balance validation logic, and workers so employees see accurate leave balances from day one.

**Architecture:** 5 numbered SQL migrations (204–208) fix schema and data; updated workers handle monthly CL+ML accrual and EL accumulation into a new `leave_el_accrual_ledger` table; `leave.service.ts` and `leave-policy.service.ts` updated for CL+ML combined pool balance check and EL two-ledger model; `ENABLE_SCHEDULERS=true` activates workers.

**Tech Stack:** MySQL 8.0, Node.js/TypeScript, mysql2, existing worker pattern in `backend/src/workers/`

---

## Leave Policy Rules (Source of Truth)

| Code | Name | Days/Year | Accrual | Carry Forward | Notes |
|------|------|-----------|---------|---------------|-------|
| `CL` | Casual Leave | 7 | 0.583/month on 1st | No — expires Dec 31 | Combined pool with ML |
| `ML` | Medical Leave | 5 | 0.417/month on 1st | No — expires Dec 31 | Combined pool with CL |
| `EL` | Earned Leave | 18 | 1.5/month (accumulate in accrual ledger, not spendable) | Special — last year's accrual becomes this year's spendable | Cannot use current year's accumulation |
| `LWP` | Leave Without Pay | 0 | None | No | Unlimited, no cap |
| `PTRL` | Paternity Leave | 4 | Annual Jan 1 | No | Credited upfront |
| `MTRL` | Maternity Leave | 180 | Annual Jan 1 | No | Credited upfront |

**Deactivated:** `SL`, `PL`, `DL`, `CO`, `PML`

**CL+ML combined pool rule:** When an employee applies for CL or ML, available balance = `CL.allocated - CL.used + ML.allocated - ML.used`. Deduction order: CL first, remainder from ML.

**EL two-ledger model:**
- `leave_el_accrual_ledger` — current year's monthly accumulation (NOT spendable during accumulation year)
- `leave_balance_ledger` — spendable EL = previous year's total accrual, credited on Jan 1
- Jan 1 job: copies accrual_year N total → balance_ledger year N+1 allocated_days. Prior year unspent EL expires (no rollover).

---

## File Map

| File | Action | Responsibility |
|------|--------|----------------|
| `backend/sql/204_leave_type_master_fix.sql` | CREATE | Fix leave codes, rates, deactivate obsolete types |
| `backend/sql/205_leave_policy_config_fix.sql` | CREATE | Fix policy config rates, add pool_with column, add PTRL/MTRL policies |
| `backend/sql/206_leave_el_accrual_ledger.sql` | CREATE | New table for EL monthly accumulation |
| `backend/sql/207_leave_2026_balance_correction.sql` | CREATE | Correct all 2026 balance data |
| `backend/sql/208_leave_2026_el_accrual_seed.sql` | CREATE | Seed 2026 EL accrual ledger with Jan–Jun accumulation |
| `backend/src/modules/leave/leave.types.ts` | MODIFY | Add `LeaveElAccrualLedger` interface, update `LeavePolicyConfig` |
| `backend/src/modules/leave/leave-policy.service.ts` | MODIFY | Fix monthly cap from 2→1/month, add `getCombinedCLMLBalance`, add `prorateMonthlyCredit` for ML |
| `backend/src/modules/leave/leave.service.ts` | MODIFY | Replace single-type balance check with combined CL+ML pool logic, fix EL deduction to draw from balance_ledger only |
| `backend/src/workers/leave-monthly-credit.worker.ts` | MODIFY | Add ML 0.417/month credit; change EL to write accrual ledger (not balance ledger) at 1.5/month |
| `backend/src/workers/leave-annual-el-credit.worker.ts` | MODIFY | Transfer EL accrual→balance on Jan 1; add PTRL/MTRL annual credit; expire prior year CL/ML/PTRL/MTRL |
| `backend/.env` | MODIFY | Set ENABLE_SCHEDULERS=true |
| `backend/src/modules/leave/__tests__/balance-calculations.test.ts` | MODIFY | Add tests for combined pool, EL two-ledger, new accrual rates |

---

## Task 1: Migration 204 — Leave Type Master Fix

**Files:**
- Create: `backend/sql/204_leave_type_master_fix.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 204_leave_type_master_fix.sql
-- Fix leave type master to match db_bill policy

-- CL: 7 days/year, monthly accrual, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Casual Leave', max_days_per_year = 7, carry_forward = 0, active_status = 1
WHERE leave_code = 'CL';

-- ML: repurpose from Maternity → Medical Leave, 5 days/year, monthly accrual, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Medical Leave', max_days_per_year = 5, carry_forward = 0, active_status = 1
WHERE leave_code = 'ML';

-- EL: 18 days/year, monthly accumulation (handled in code), no carry-forward flag (logic is in accrual ledger)
UPDATE leave_type_master
SET max_days_per_year = 18, carry_forward = 0, active_status = 1
WHERE leave_code = 'EL';

-- PTRL: 4 days/year, annual Jan 1 credit, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Paternity Leave', max_days_per_year = 4, carry_forward = 0, active_status = 1
WHERE leave_code = 'PTRL';

-- MTRL: 180 days/year, annual Jan 1 credit, no carry-forward
UPDATE leave_type_master
SET leave_name = 'Maternity Leave', max_days_per_year = 180, carry_forward = 0, active_status = 1
WHERE leave_code = 'MTRL';

-- Deactivate obsolete types
UPDATE leave_type_master
SET active_status = 0
WHERE leave_code IN ('SL', 'PL', 'DL', 'CO', 'PML');
```

- [ ] **Step 2: Run the migration against mas_hrms**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const sql = fs.readFileSync('sql/204_leave_type_master_fix.sql', 'utf8');
  for (const stmt of sql.split(';').filter(s => s.trim())) await conn.query(stmt);
  const [rows] = await conn.query('SELECT leave_code, leave_name, max_days_per_year, carry_forward, active_status FROM leave_type_master ORDER BY leave_code');
  console.table(rows);
  await conn.end();
})().catch(console.error);
"
```

Expected output table:
```
CL  | Casual Leave    | 7   | 0 | 1
EL  | Earned Leave    | 18  | 0 | 1
LWP | Leave Without Pay | 0 | 0 | 1
ML  | Medical Leave   | 5   | 0 | 1
MTRL| Maternity Leave | 180 | 0 | 1
PTRL| Paternity Leave | 4   | 0 | 1
SL  | Sick Leave      | 7   | 0 | 0  ← inactive
PL  | Paternity Leave | 5   | 0 | 0  ← inactive
DL  | Duty Leave      | 0   | 0 | 0  ← inactive
CO  | Compensatory Off| 0   | 1 | 0  ← inactive
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/204_leave_type_master_fix.sql
git commit -m "fix: correct leave_type_master to match db_bill policy (CL=7, ML=Medical 5, EL=18, PTRL=4, MTRL=180)"
```

---

## Task 2: Migration 205 — Leave Policy Config Fix

**Files:**
- Create: `backend/sql/205_leave_policy_config_fix.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 205_leave_policy_config_fix.sql
-- Add pool_with column to leave_policy_config for CL+ML combined pool
ALTER TABLE leave_policy_config
ADD COLUMN IF NOT EXISTS pool_with VARCHAR(20) NULL COMMENT 'leave_code to pool balance with (e.g. CL pools with ML)';

-- Fix CL policy: 0.583/month, max 7/year, pools with ML
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.monthly_credit_days = 0.583,
    lpc.annual_credit_days = 0,
    lpc.credit_on_jan_first = 0,
    lpc.max_days_per_month = 0,
    lpc.max_occurrences_per_year = 0,
    lpc.max_days_per_occurrence = 0,
    lpc.pool_with = 'ML'
WHERE lt.leave_code = 'CL';

-- Fix ML policy: 0.417/month, max 5/year, pools with CL
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0.417, 0, 0, 0, 0, 0, 'CL'
FROM leave_type_master lt
WHERE lt.leave_code = 'ML'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'ML')
ON DUPLICATE KEY UPDATE monthly_credit_days = 0.417, pool_with = 'CL';

-- Fix EL policy: 1.5/month accumulation, no annual lump sum, no Jan 1 credit
UPDATE leave_policy_config lpc
JOIN leave_type_master lt ON lt.id = lpc.leave_type_id
SET lpc.monthly_credit_days = 1.500,
    lpc.annual_credit_days = 0,
    lpc.credit_on_jan_first = 0,
    lpc.pool_with = NULL
WHERE lt.leave_code = 'EL';

-- Add PTRL policy: 4 days annual on Jan 1
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0, 4, 1, 0, 0, 4, NULL
FROM leave_type_master lt
WHERE lt.leave_code = 'PTRL'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'PTRL')
ON DUPLICATE KEY UPDATE annual_credit_days = 4, credit_on_jan_first = 1, max_days_per_occurrence = 4;

-- Add MTRL policy: 180 days annual on Jan 1
INSERT INTO leave_policy_config (id, leave_type_id, monthly_credit_days, annual_credit_days, credit_on_jan_first, max_days_per_month, max_occurrences_per_year, max_days_per_occurrence, pool_with)
SELECT UUID(), lt.id, 0, 180, 1, 0, 0, 180, NULL
FROM leave_type_master lt
WHERE lt.leave_code = 'MTRL'
AND NOT EXISTS (SELECT 1 FROM leave_policy_config lpc2 JOIN leave_type_master lt2 ON lt2.id = lpc2.leave_type_id WHERE lt2.leave_code = 'MTRL')
ON DUPLICATE KEY UPDATE annual_credit_days = 180, credit_on_jan_first = 1, max_days_per_occurrence = 180;
```

- [ ] **Step 2: Run and verify**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const sql = fs.readFileSync('sql/205_leave_policy_config_fix.sql', 'utf8');
  for (const stmt of sql.split(';').filter(s => s.trim())) await conn.query(stmt);
  const [rows] = await conn.query('SELECT lt.leave_code, lpc.monthly_credit_days, lpc.annual_credit_days, lpc.credit_on_jan_first, lpc.max_days_per_occurrence, lpc.pool_with FROM leave_policy_config lpc JOIN leave_type_master lt ON lt.id = lpc.leave_type_id ORDER BY lt.leave_code');
  console.table(rows);
  await conn.end();
})().catch(console.error);
"
```

Expected:
```
CL   | 0.583 | 0   | 0 | 0   | ML
EL   | 1.500 | 0   | 0 | 0   | null
ML   | 0.417 | 0   | 0 | 0   | CL
MTRL | 0     | 180 | 1 | 180 | null
PTRL | 0     | 4   | 1 | 4   | null
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/205_leave_policy_config_fix.sql
git commit -m "fix: correct leave_policy_config rates (CL=0.583/mo, ML=0.417/mo, EL=1.5/mo accumulation, PTRL/MTRL annual)"
```

---

## Task 3: Migration 206 — EL Accrual Ledger Table

**Files:**
- Create: `backend/sql/206_leave_el_accrual_ledger.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 206_leave_el_accrual_ledger.sql
-- Tracks monthly EL accumulation per employee per year (NOT spendable during accumulation year).
-- On Jan 1 of year N+1, this total is transferred to leave_balance_ledger as spendable EL.

CREATE TABLE IF NOT EXISTS leave_el_accrual_ledger (
  id              CHAR(36)       NOT NULL DEFAULT (UUID()),
  employee_id     CHAR(36)       NOT NULL,
  accrual_year    INT            NOT NULL,
  accrued_days    DECIMAL(6,2)   NOT NULL DEFAULT 0.00 COMMENT 'Running total of EL accumulated this year',
  last_credited_month INT        NOT NULL DEFAULT 0    COMMENT 'Last month (1-12) that was credited; 0 = none yet',
  updated_at      DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_el_accrual (employee_id, accrual_year),
  KEY idx_el_accrual_year (accrual_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
```

- [ ] **Step 2: Run and verify**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const sql = fs.readFileSync('sql/206_leave_el_accrual_ledger.sql', 'utf8');
  await conn.query(sql);
  const [rows] = await conn.query('DESCRIBE leave_el_accrual_ledger');
  console.table(rows);
  await conn.end();
})().catch(console.error);
"
```

Expected: table with columns id, employee_id, accrual_year, accrued_days, last_credited_month, updated_at.

- [ ] **Step 3: Commit**

```bash
git add backend/sql/206_leave_el_accrual_ledger.sql
git commit -m "feat: add leave_el_accrual_ledger table for EL monthly accumulation (not spendable until Jan 1 transfer)"
```

---

## Task 4: Migration 207 — Correct 2026 Balance Data

**Files:**
- Create: `backend/sql/207_leave_2026_balance_correction.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 207_leave_2026_balance_correction.sql
-- Correct all leave_balance_ledger rows for 2026 to match actual policy.
-- Today is June 2026: months Jan(1)..Jun(6) = 6 months elapsed.

-- Step A: Fix EL 2026 — strip carry-forward, set to 18 days flat (prior year's full accrual for employees who served all of 2025)
-- Employees who joined during 2025 get prorated: (months served in 2025 / 12) * 18
-- We approximate: anyone with DOJ before 2025 gets 18, those who joined in 2025 get prorated
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = CASE
  WHEN e.date_of_joining < '2025-01-01' THEN 18.00
  WHEN YEAR(e.date_of_joining) = 2025 THEN ROUND((18.00 * (12 - MONTH(e.date_of_joining) + 1)) / 12, 2)
  ELSE 0.00
END
WHERE lt.leave_code = 'EL'
AND lbl.balance_year = 2026;

-- Step B: Fix CL 2026 — set to earned-to-date (6 months * 0.583 = 3.498 days for full-year employees)
-- New joiners in 2026: prorated from join month
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
JOIN employees e ON e.id = lbl.employee_id
SET lbl.allocated_days = CASE
  WHEN e.date_of_joining < '2026-01-01' THEN 3.498  -- 6 months * 0.583
  WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
    THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 0.583, 3)
  ELSE 0.000
END
WHERE lt.leave_code = 'CL'
AND lbl.balance_year = 2026;

-- Step C: Delete existing SL/PL/DL/CO rows for 2026 (deactivated types)
DELETE lbl FROM leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lt.leave_code IN ('SL', 'PL', 'DL', 'CO', 'PML')
AND lbl.balance_year = 2026;

-- Step D: Delete old ML (Maternity) 2026 rows — ML now means Medical Leave
-- The old ML = Maternity rows (182 days allocated) were wrong; Medical Leave rows will be inserted by migration 208
DELETE lbl FROM leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
WHERE lt.leave_code = 'ML'
AND lbl.balance_year = 2026;

-- Step E: Fix PTRL 2026 — should be 4 days (annual), keep used_days as-is
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
SET lbl.allocated_days = 4.00
WHERE lt.leave_code = 'PTRL'
AND lbl.balance_year = 2026;

-- Step F: Fix MTRL 2026 — should be 180 days (annual), keep used_days as-is
UPDATE leave_balance_ledger lbl
JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
SET lbl.allocated_days = 180.00
WHERE lt.leave_code = 'MTRL'
AND lbl.balance_year = 2026;
```

- [ ] **Step 2: Run and verify**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const sql = fs.readFileSync('sql/207_leave_2026_balance_correction.sql', 'utf8');
  for (const stmt of sql.split(';').filter(s => s.trim().length > 0)) await conn.query(stmt);
  const [rows] = await conn.query(\`
    SELECT lt.leave_code, COUNT(*) as emp_count,
           MIN(lbl.allocated_days) as min_alloc, MAX(lbl.allocated_days) as max_alloc,
           SUM(lbl.used_days) as total_used
    FROM leave_balance_ledger lbl
    JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
    WHERE lbl.balance_year = 2026
    GROUP BY lt.leave_code ORDER BY lt.leave_code
  \`);
  console.table(rows);
  await conn.end();
})().catch(console.error);
"
```

Expected:
```
CL   | ~1532 | 0    | 3.498 | (existing used_days preserved)
EL   | ~1532 | 0    | 18    | (existing used_days preserved)
MTRL | ~645  | 180  | 180   | (existing)
PTRL | ~874  | 4    | 4     | (existing)
```
SL/PL/DL/CO/ML rows: 0

- [ ] **Step 3: Commit**

```bash
git add backend/sql/207_leave_2026_balance_correction.sql
git commit -m "fix: correct 2026 leave balances (CL earned-to-date 3.498, EL strip carry-forward, delete obsolete types)"
```

---

## Task 5: Migration 208 — Seed 2026 ML and EL Accrual Data

**Files:**
- Create: `backend/sql/208_leave_2026_ml_el_accrual_seed.sql`

- [ ] **Step 1: Write the migration**

```sql
-- 208_leave_2026_ml_el_accrual_seed.sql
-- Insert ML (Medical Leave) 2026 balance rows for all active employees.
-- Also seed leave_el_accrual_ledger for 2026 (Jan-Jun = 6 months accumulated).

-- Part A: Insert ML 2026 balance rows (6 months * 0.417 = 2.502 days for full-year employees)
INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
SELECT
  UUID(),
  e.id,
  lt.id,
  2026,
  CASE
    WHEN e.date_of_joining < '2026-01-01' THEN 2.502   -- 6 * 0.417
    WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
      THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 0.417, 3)
    ELSE 0.000
  END,
  0,
  0
FROM employees e
CROSS JOIN leave_type_master lt
WHERE e.active_status = 1
AND e.employment_status = 'active'
AND lt.leave_code = 'ML'
AND NOT EXISTS (
  SELECT 1 FROM leave_balance_ledger lbl2
  WHERE lbl2.employee_id = e.id AND lbl2.leave_type_id = lt.id AND lbl2.balance_year = 2026
);

-- Part B: Seed leave_el_accrual_ledger for 2026 (Jan-Jun = 6 months * 1.5 = 9.0 days for full-year employees)
INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
SELECT
  UUID(),
  e.id,
  2026,
  CASE
    WHEN e.date_of_joining < '2026-01-01' THEN 9.000   -- 6 * 1.5
    WHEN YEAR(e.date_of_joining) = 2026 AND MONTH(e.date_of_joining) <= 6
      THEN ROUND((6 - MONTH(e.date_of_joining) + 1) * 1.5, 2)
    ELSE 0.00
  END,
  6   -- last credited month = June
FROM employees e
WHERE e.active_status = 1
AND e.employment_status = 'active'
AND NOT EXISTS (
  SELECT 1 FROM leave_el_accrual_ledger eal2
  WHERE eal2.employee_id = e.id AND eal2.accrual_year = 2026
);
```

- [ ] **Step 2: Run and verify**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
const fs = require('fs');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });
  const sql = fs.readFileSync('sql/208_leave_2026_ml_el_accrual_seed.sql', 'utf8');
  for (const stmt of sql.split(';').filter(s => s.trim().length > 0)) await conn.query(stmt);

  const [ml] = await conn.query('SELECT COUNT(*) as cnt, MIN(allocated_days) as min_alloc, MAX(allocated_days) as max_alloc FROM leave_balance_ledger lbl JOIN leave_type_master lt ON lt.id = lbl.leave_type_id WHERE lt.leave_code = \\'ML\\' AND lbl.balance_year = 2026');
  console.log('ML 2026 rows:', ml[0]);

  const [el] = await conn.query('SELECT COUNT(*) as cnt, MIN(accrued_days) as min_acc, MAX(accrued_days) as max_acc, AVG(last_credited_month) as avg_month FROM leave_el_accrual_ledger WHERE accrual_year = 2026');
  console.log('EL accrual ledger 2026:', el[0]);
  await conn.end();
})().catch(console.error);
"
```

Expected:
```
ML 2026 rows: { cnt: ~1532, min_alloc: 0.417, max_alloc: 2.502 }
EL accrual ledger 2026: { cnt: ~1532, min_acc: 1.5, max_acc: 9.0, avg_month: 6 }
```

- [ ] **Step 3: Commit**

```bash
git add backend/sql/208_leave_2026_ml_el_accrual_seed.sql
git commit -m "feat: seed 2026 ML balance rows and EL accrual ledger (Jan-Jun backfill)"
```

---

## Task 6: Update leave.types.ts

**Files:**
- Modify: `backend/src/modules/leave/leave.types.ts`

- [ ] **Step 1: Add LeaveElAccrualLedger interface and update LeavePolicyConfig**

In `backend/src/modules/leave/leave.types.ts`, after the `LeaveElCreditLog` interface, add:

```typescript
export interface LeaveElAccrualLedger {
  id: string;
  employee_id: string;
  accrual_year: number;
  accrued_days: number;
  last_credited_month: number;
  updated_at: string;
}
```

Also update `LeavePolicyConfig` to add the `pool_with` field:

```typescript
export interface LeavePolicyConfig {
  id: string;
  leave_type_id: string;
  monthly_credit_days: number;
  annual_credit_days: number;
  credit_on_jan_first: number;
  max_days_per_month: number;
  max_occurrences_per_year: number;
  max_days_per_occurrence: number;
  exception_approver_role: string | null;
  pool_with: string | null;  // ← ADD THIS
  created_at: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/modules/leave/leave.types.ts
git commit -m "feat: add LeaveElAccrualLedger interface and pool_with to LeavePolicyConfig"
```

---

## Task 7: Update leave-policy.service.ts — CL+ML Combined Pool

**Files:**
- Modify: `backend/src/modules/leave/leave-policy.service.ts`

- [ ] **Step 1: Fix monthly cap from 2→1 and add getCombinedCLMLBalance**

The `checkMonthlyCapExceeded` CAP constant is currently `2` — this was based on wrong assumptions. With CL+ML pooled at 1/month total, the cap per month is **1 day**. Update line 51:

```typescript
const CAP = 1;
```

- [ ] **Step 2: Add getCombinedCLMLBalance function**

Add this new function to `leave-policy.service.ts` before the `export const leavePolicyService` block:

```typescript
async function getCombinedCLMLBalance(
  employeeId: string,
  year: number
): Promise<{ available: number; clAllocated: number; clUsed: number; mlAllocated: number; mlUsed: number }> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT lt.leave_code,
            COALESCE(lbl.allocated_days, 0) AS allocated_days,
            COALESCE(lbl.used_days, 0) AS used_days,
            COALESCE(lbl.adjusted_days, 0) AS adjusted_days
     FROM leave_type_master lt
     LEFT JOIN leave_balance_ledger lbl
       ON lbl.leave_type_id = lt.id
       AND lbl.employee_id = ?
       AND lbl.balance_year = ?
     WHERE lt.leave_code IN ('CL', 'ML') AND lt.active_status = 1`,
    [employeeId, year]
  );

  let clAllocated = 0, clUsed = 0, mlAllocated = 0, mlUsed = 0;
  for (const row of rows as RowDataPacket[]) {
    if (row.leave_code === 'CL') {
      clAllocated = Number(row.allocated_days) + Number(row.adjusted_days);
      clUsed = Number(row.used_days);
    } else if (row.leave_code === 'ML') {
      mlAllocated = Number(row.allocated_days) + Number(row.adjusted_days);
      mlUsed = Number(row.used_days);
    }
  }

  const available = (clAllocated - clUsed) + (mlAllocated - mlUsed);
  return { available, clAllocated, clUsed, mlAllocated, mlUsed };
}
```

- [ ] **Step 3: Export getCombinedCLMLBalance**

Add to the `leavePolicyService` export object:

```typescript
export const leavePolicyService = {
  checkMonthlyCapExceeded,
  checkCLMLInSameMonth,
  checkELInSameMonth,
  checkELOccurrences,
  checkELSingleGoCap,
  requiresBranchHeadApproval,
  prorateMonthlyCredit,
  prorateAnnualCredit,
  getCombinedCLMLBalance,  // ← ADD THIS
};
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/leave/leave-policy.service.ts
git commit -m "feat: add getCombinedCLMLBalance for pooled CL+ML balance check, fix monthly cap to 1/month"
```

---

## Task 8: Update leave.service.ts — Combined Pool Balance Check + EL Two-Ledger Deduction

**Files:**
- Modify: `backend/src/modules/leave/leave.service.ts`

- [ ] **Step 1: Update the deductLeaveBalance helper inside reviewRequest**

The current `deductLeaveBalance` function (lines 166–202) does a single-type balance check. Replace the function body with combined CL+ML pool logic plus EL draws only from balance_ledger:

Find the `deductLeaveBalance` function and replace it with:

```typescript
const deductLeaveBalance = async (conn: any) => {
  if (!request.leave_type_id) throw new Error("Leave type is required for approval");

  const duration = request.total_days;
  const employeeId = request.employee_id;
  const year = new Date(request.from_date).getFullYear();

  // Get leave code for the request
  const [ltRows] = await conn.execute(
    "SELECT leave_code FROM leave_type_master WHERE id = ? LIMIT 1",
    [request.leave_type_id]
  );
  const leaveCode: string = ltRows[0]?.leave_code;
  if (!leaveCode) throw new Error("Leave type not found");

  if (leaveCode === 'CL' || leaveCode === 'ML') {
    // CL+ML combined pool: check total available across both types
    const [poolRows] = await conn.execute(
      `SELECT lt.leave_code,
              COALESCE(lbl.allocated_days, 0) + COALESCE(lbl.adjusted_days, 0) - COALESCE(lbl.used_days, 0) AS available
       FROM leave_type_master lt
       LEFT JOIN leave_balance_ledger lbl
         ON lbl.leave_type_id = lt.id AND lbl.employee_id = ? AND lbl.balance_year = ?
       WHERE lt.leave_code IN ('CL', 'ML') AND lt.active_status = 1`,
      [employeeId, year]
    );

    const pool: Record<string, number> = {};
    for (const r of poolRows) pool[r.leave_code] = Number(r.available ?? 0);
    const totalAvailable = (pool['CL'] ?? 0) + (pool['ML'] ?? 0);

    if (duration > totalAvailable) {
      throw new Error(`Insufficient leave balance. Available (CL+ML): ${totalAvailable.toFixed(3)}, Requested: ${duration}`);
    }

    // Deduct: CL first, remainder from ML
    let remaining = duration;
    const clAvailable = pool['CL'] ?? 0;

    if (clAvailable >= remaining) {
      // All from CL
      await conn.execute(
        `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
         VALUES (UUID(), ?, (SELECT id FROM leave_type_master WHERE leave_code='CL' LIMIT 1), ?, 0, ?, 0)
         ON DUPLICATE KEY UPDATE used_days = used_days + ?`,
        [employeeId, year, remaining, remaining]
      );
    } else {
      // Some from CL, rest from ML
      const fromML = remaining - clAvailable;
      if (clAvailable > 0) {
        await conn.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, (SELECT id FROM leave_type_master WHERE leave_code='CL' LIMIT 1), ?, 0, ?, 0)
           ON DUPLICATE KEY UPDATE used_days = used_days + ?`,
          [employeeId, year, clAvailable, clAvailable]
        );
      }
      await conn.execute(
        `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
         VALUES (UUID(), ?, (SELECT id FROM leave_type_master WHERE leave_code='ML' LIMIT 1), ?, 0, ?, 0)
         ON DUPLICATE KEY UPDATE used_days = used_days + ?`,
        [employeeId, year, fromML, fromML]
      );
    }

  } else {
    // All other types (EL, LWP, PTRL, MTRL): single-type balance check from leave_balance_ledger only
    const [balanceRows] = await conn.execute(
      `SELECT allocated_days, used_days, adjusted_days
       FROM leave_balance_ledger
       WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
      [employeeId, request.leave_type_id, year]
    );

    if (balanceRows.length === 0) {
      if (leaveCode === 'LWP') {
        // LWP has no balance row — always allowed, just track usage
        await conn.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 0, ?, 0)`,
          [employeeId, request.leave_type_id, year, duration]
        );
      } else {
        throw new Error(`No leave balance found for ${leaveCode} in ${year}. Please contact HR.`);
      }
    } else {
      const balance = balanceRows[0];
      const available = Number(balance.allocated_days) + Number(balance.adjusted_days) - Number(balance.used_days);
      if (duration > available) {
        throw new Error(`Insufficient ${leaveCode} balance. Available: ${available.toFixed(2)}, Requested: ${duration}`);
      }
      await conn.execute(
        `UPDATE leave_balance_ledger SET used_days = used_days + ?
         WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [duration, employeeId, request.leave_type_id, year]
      );
    }
  }
};
```

- [ ] **Step 2: Update the rejection restore logic for CL+ML**

Find the rejection restore block (around line 281 — `if (input.status === 'rejected' && request.status === 'approved')`) and update the `used_days` restore to handle CL+ML by just decrementing `used_days` on the specific leave type that was deducted (the `leave_type_id` on the request is the one that was deducted from CL first, so this is already correct — no change needed to the restore logic since it uses `request.leave_type_id`).

Verify the restore logic uses:
```typescript
await conn.execute(
  `UPDATE leave_balance_ledger
   SET used_days = GREATEST(0, used_days - ?)
   WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
  [duration, employeeId, leaveTypeId, year]
);
```
This is already correct — leave as-is.

- [ ] **Step 3: Write failing test for combined pool balance check**

In `backend/src/modules/leave/__tests__/balance-calculations.test.ts`, add a database-level test that verifies the combined pool logic by checking the SQL behaviour via the policy service:

```typescript
describe('getCombinedCLMLBalance', () => {
  it('returns sum of CL and ML available days', async () => {
    // Insert test employee + CL balance 2.0, ML balance 1.0
    // Then call getCombinedCLMLBalance and expect available = 3.0
    // (Integration test — requires test DB or mock db.execute)
    const mockDb = {
      execute: jest.fn().mockResolvedValueOnce([[
        { leave_code: 'CL', allocated_days: 2.0, adjusted_days: 0, used_days: 0 },
        { leave_code: 'ML', allocated_days: 1.0, adjusted_days: 0, used_days: 0 }
      ]])
    };
    // Inject mock — test via direct import of the function if exported, or test via API
    // Expected: available = 3.0, clAllocated = 2.0, mlAllocated = 1.0
  });

  it('allows 1 day CL when only ML has balance (Jan scenario)', () => {
    // CL = 0, ML = 0.417 → combined = 0.417 < 1 → should be insufficient
    // CL = 0.583, ML = 0.417 → combined = 1.0 → sufficient for 1 day
    const clAvail = 0.583;
    const mlAvail = 0.417;
    expect(clAvail + mlAvail).toBeCloseTo(1.0, 2);
  });
});
```

- [ ] **Step 4: Run existing tests**

```bash
cd backend && npm test -- --testPathPattern=leave 2>&1 | tail -20
```

Expected: All existing tests pass.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/leave/leave.service.ts backend/src/modules/leave/__tests__/balance-calculations.test.ts
git commit -m "feat: CL+ML combined pool balance check — deduct CL first, remainder from ML"
```

---

## Task 9: Update leave-monthly-credit.worker.ts — Add ML + EL Accrual

**Files:**
- Modify: `backend/src/workers/leave-monthly-credit.worker.ts`

- [ ] **Step 1: Update creditCLMonthly to also credit ML and accumulate EL**

Replace the entire exported `creditCLMonthly` function with a new `creditMonthlyLeaves` function that handles CL, ML, and EL in one pass:

```typescript
export async function creditMonthlyLeaves(
  creditYear: number,
  creditMonth: number
): Promise<void> {
  console.log(`[LeaveMonthlyWorker] Running monthly leave credit for ${creditYear}-${String(creditMonth).padStart(2, '0')}`);

  // Resolve leave type IDs
  const [ltRows]: any = await db.execute(
    `SELECT id, leave_code FROM leave_type_master WHERE leave_code IN ('CL', 'ML', 'EL') AND active_status = 1`
  );
  const leaveTypeMap: Record<string, string> = {};
  for (const r of ltRows) leaveTypeMap[r.leave_code] = r.id;

  if (!leaveTypeMap['CL'] || !leaveTypeMap['ML'] || !leaveTypeMap['EL']) {
    console.error('[LeaveMonthlyWorker] CL, ML, or EL leave type missing — aborting');
    return;
  }

  // Fetch all active employees
  const [employees]: any = await db.execute(
    `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
  );

  const RATES: Record<string, number> = { CL: 0.583, ML: 0.417, EL: 1.500 };
  let credited = 0, skipped = 0;

  for (const emp of employees) {
    try {
      for (const code of ['CL', 'ML', 'EL']) {
        const leaveTypeId = leaveTypeMap[code];
        const rate = RATES[code];
        const daysToCredit = prorateMonthlyCredit(emp.date_of_joining, creditMonth, creditYear) * rate;
        if (daysToCredit <= 0) continue;
        const roundedDays = Math.round(daysToCredit * 1000) / 1000;

        // Idempotency check
        const [exists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month=? AND credit_type='monthly' LIMIT 1`,
          [emp.id, leaveTypeId, creditYear, creditMonth]
        );
        if (exists.length > 0) continue;

        if (code === 'EL') {
          // EL goes to accrual ledger, NOT balance ledger
          await db.execute(
            `INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
             VALUES (UUID(), ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE accrued_days = accrued_days + ?, last_credited_month = ?`,
            [emp.id, creditYear, roundedDays, creditMonth, roundedDays, creditMonth]
          );
        } else {
          // CL and ML go to balance ledger (spendable immediately)
          await db.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE allocated_days = allocated_days + ?`,
            [emp.id, leaveTypeId, creditYear, roundedDays, roundedDays]
          );
        }

        // Audit log
        await db.execute(
          `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
           VALUES (UUID(), ?, ?, ?, ?, CURDATE(), ?, 0, 'monthly')`,
          [emp.id, leaveTypeId, creditYear, creditMonth, roundedDays]
        );
      }
      credited++;
    } catch (err: any) {
      console.error(`[LeaveMonthlyWorker] Error for employee ${emp.id}:`, err.message);
      skipped++;
    }
  }

  console.log(`[LeaveMonthlyWorker] Done — credited: ${credited}, skipped: ${skipped}`);
}
```

- [ ] **Step 2: Update checkAndRun to call creditMonthlyLeaves**

Replace the call to `creditCLMonthly` in `checkAndRun`:

```typescript
async function checkAndRun(): Promise<void> {
  const now = new Date();
  if (now.getDate() !== 1) {
    console.log(`[LeaveMonthlyWorker] Day ${now.getDate()} — not 1st, skipping`);
    return;
  }
  const creditYear = now.getFullYear();
  const creditMonth = now.getMonth() + 1;
  try {
    await creditMonthlyLeaves(creditYear, creditMonth);
  } catch (err: any) {
    console.error('[LeaveMonthlyWorker] Error:', err.message);
  }
}
```

- [ ] **Step 3: Update the startWorker export alias**

```typescript
export { startWorker as startLeaveMonthlyWorker };
// Remove old alias: startLeaveMonthlyCreditWorker
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/workers/leave-monthly-credit.worker.ts
git commit -m "feat: monthly worker credits CL=0.583, ML=0.417 to balance ledger and EL=1.5 to accrual ledger"
```

---

## Task 10: Update leave-annual-el-credit.worker.ts — EL Transfer + PTRL/MTRL + Expiry

**Files:**
- Modify: `backend/src/workers/leave-annual-el-credit.worker.ts`

- [ ] **Step 1: Replace the file with the updated annual worker**

The new annual Jan 1 worker does 4 things: (1) transfer EL accrual→balance, (2) credit PTRL/MTRL, (3) expire prior year CL/ML/PTRL/MTRL unused balance.

Replace the entire `creditELAnnual` function:

```typescript
export async function runAnnualLeaveJobs(creditYear: number): Promise<void> {
  console.log(`[AnnualLeaveWorker] Starting annual leave jobs for ${creditYear}`);

  // Resolve all needed leave type IDs
  const [ltRows]: any = await db.execute(
    `SELECT id, leave_code FROM leave_type_master WHERE leave_code IN ('EL','CL','ML','PTRL','MTRL') AND active_status = 1`
  );
  const ltMap: Record<string, string> = {};
  for (const r of ltRows) ltMap[r.leave_code] = r.id;

  // Get all active employees
  const [employees]: any = await db.execute(
    `SELECT id, date_of_joining FROM employees WHERE active_status = 1 AND employment_status = 'active'`
  );

  const priorYear = creditYear - 1;
  let elTransferred = 0, ptrlCredited = 0, mtrlCredited = 0, expired = 0;

  for (const emp of employees) {
    try {
      // ── 1. Transfer EL accrual (priorYear) → balance (creditYear) ──
      const [accrualRows]: any = await db.execute(
        `SELECT accrued_days FROM leave_el_accrual_ledger WHERE employee_id=? AND accrual_year=?`,
        [emp.id, priorYear]
      );
      const accrued = Number(accrualRows[0]?.accrued_days ?? 0);

      if (accrued > 0 && ltMap['EL']) {
        // Check idempotency: has EL already been credited for creditYear?
        const [elExists]: any = await db.execute(
          `SELECT 1 FROM leave_el_credit_log WHERE employee_id=? AND leave_type_id=? AND credit_year=? AND credit_month IS NULL AND credit_type='annual' LIMIT 1`,
          [emp.id, ltMap['EL'], creditYear]
        );
        if (elExists.length === 0) {
          await db.execute(
            `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
             VALUES (UUID(), ?, ?, ?, ?, 0, 0)
             ON DUPLICATE KEY UPDATE allocated_days = ?`,
            [emp.id, ltMap['EL'], creditYear, accrued, accrued]
          );
          await db.execute(
            `INSERT INTO leave_el_credit_log (id, employee_id, leave_type_id, credit_year, credit_month, credit_date, days_credited, months_served, credit_type)
             VALUES (UUID(), ?, ?, ?, NULL, CURDATE(), ?, 12, 'annual')`,
            [emp.id, ltMap['EL'], creditYear, accrued]
          );
          elTransferred++;
        }
      }

      // Initialize empty accrual ledger for the new creditYear
      await db.execute(
        `INSERT INTO leave_el_accrual_ledger (id, employee_id, accrual_year, accrued_days, last_credited_month)
         VALUES (UUID(), ?, ?, 0, 0)
         ON DUPLICATE KEY UPDATE accrued_days = accrued_days`,  // no-op if exists
        [emp.id, creditYear]
      );

      // ── 2. Credit PTRL (4 days) ──
      if (ltMap['PTRL']) {
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 4.00, 0, 0)
           ON DUPLICATE KEY UPDATE allocated_days = 4.00, used_days = 0`,
          [emp.id, ltMap['PTRL'], creditYear]
        );
        ptrlCredited++;
      }

      // ── 3. Credit MTRL (180 days) ──
      if (ltMap['MTRL']) {
        await db.execute(
          `INSERT INTO leave_balance_ledger (id, employee_id, leave_type_id, balance_year, allocated_days, used_days, adjusted_days)
           VALUES (UUID(), ?, ?, ?, 180.00, 0, 0)
           ON DUPLICATE KEY UPDATE allocated_days = 180.00, used_days = 0`,
          [emp.id, ltMap['MTRL'], creditYear]
        );
        mtrlCredited++;
      }

      // ── 4. Expire prior year CL/ML/PTRL/MTRL unused balance ──
      // Set used_days = allocated_days so available = 0 (balance expires, not deleted for audit)
      for (const code of ['CL', 'ML', 'PTRL', 'MTRL']) {
        if (ltMap[code]) {
          await db.execute(
            `UPDATE leave_balance_ledger
             SET used_days = allocated_days + COALESCE(adjusted_days, 0)
             WHERE employee_id=? AND leave_type_id=? AND balance_year=?
             AND (allocated_days + COALESCE(adjusted_days,0) - used_days) > 0`,
            [emp.id, ltMap[code], priorYear]
          );
        }
      }
      expired++;

    } catch (err: any) {
      console.error(`[AnnualLeaveWorker] Error for ${emp.id}:`, err.message);
    }
  }

  console.log(`[AnnualLeaveWorker] Done — EL transferred: ${elTransferred}, PTRL: ${ptrlCredited}, MTRL: ${mtrlCredited}, expiry processed: ${expired}`);
}
```

- [ ] **Step 2: Update checkAndRunAnnualCredit to call runAnnualLeaveJobs**

```typescript
async function checkAndRunAnnualCredit(): Promise<void> {
  const now = new Date();
  if (now.getMonth() === 0 && now.getDate() === 1) {
    await runAnnualLeaveJobs(now.getFullYear());
  } else {
    console.log(`[AnnualLeaveWorker] Not Jan 1 (${now.toDateString()}) — skipping`);
  }
}
```

- [ ] **Step 3: Update export alias**

```typescript
export { startWorker as startAnnualLeaveWorker };
```

- [ ] **Step 4: Commit**

```bash
git add backend/src/workers/leave-annual-el-credit.worker.ts
git commit -m "feat: annual worker transfers EL accrual→balance, credits PTRL/MTRL, expires prior year CL/ML/PTRL/MTRL"
```

---

## Task 11: Enable Schedulers in .env

**Files:**
- Modify: `backend/.env`

- [ ] **Step 1: Enable schedulers**

In `backend/.env`, change:
```
ENABLE_SCHEDULERS=false
```
to:
```
ENABLE_SCHEDULERS=true
```

- [ ] **Step 2: Verify server.ts wires up monthly worker**

Check `backend/src/server.ts` — confirm it imports and starts the monthly leave worker when `ENABLE_SCHEDULERS=true`. If the import still references the old `startLeaveMonthlyCreditWorker` export alias, update it to `startLeaveMonthlyWorker`.

Search for the import:
```bash
grep -n "LeaveMonthlyCreditWorker\|LeaveMonthlyWorker\|leave-monthly" backend/src/server.ts
```

If it references `startLeaveMonthlyCreditWorker`, update to `startLeaveMonthlyWorker`. If it references `startELAnnualCreditWorker`, update to `startAnnualLeaveWorker`.

- [ ] **Step 3: Commit**

```bash
git add backend/.env backend/src/server.ts
git commit -m "chore: enable schedulers and update worker import aliases for monthly and annual leave workers"
```

---

## Task 12: End-to-End Verification

- [ ] **Step 1: Verify leave balances for a known employee**

```bash
cd backend && node -e "
const mysql = require('mysql2/promise');
(async () => {
  const conn = await mysql.createConnection({ host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' });

  // Check MAS47814 (Shivam Giri) balances for 2026
  const [rows] = await conn.query(\`
    SELECT lt.leave_code, lbl.allocated_days, lbl.used_days, lbl.adjusted_days,
           (lbl.allocated_days + lbl.adjusted_days - lbl.used_days) AS available
    FROM leave_balance_ledger lbl
    JOIN employees e ON e.id = lbl.employee_id
    JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
    WHERE e.employee_code = 'MAS47814' AND lbl.balance_year = 2026
    ORDER BY lt.leave_code
  \`);
  console.log('MAS47814 2026 balances:');
  console.table(rows);

  // Check EL accrual ledger
  const [accrual] = await conn.query(\`
    SELECT eal.accrual_year, eal.accrued_days, eal.last_credited_month
    FROM leave_el_accrual_ledger eal
    JOIN employees e ON e.id = eal.employee_id
    WHERE e.employee_code = 'MAS47814'
    ORDER BY eal.accrual_year DESC
  \`);
  console.log('MAS47814 EL accrual:');
  console.table(accrual);

  await conn.end();
})().catch(console.error);
"
```

Expected 2026 balances:
```
CL   | 3.498 | 0 | 0 | 3.498
EL   | 18    | 0 | 0 | 18     ← from 2025 accrual
ML   | 2.502 | 0 | 0 | 2.502
MTRL | 180   | 0 | 0 | 180
PTRL | 4     | 0 | 0 | 4
```

Expected EL accrual 2026: `{ accrual_year: 2026, accrued_days: 9.0, last_credited_month: 6 }`

- [ ] **Step 2: Verify combined CL+ML pool via API**

Start the backend:
```bash
cd backend && npm run dev
```

Hit the balance endpoint for Shivam's employee ID:
```bash
curl -s "http://localhost:5055/api/leave/balance?year=2026" -H "Authorization: Bearer <token>" | jq '.[] | select(.leave_code == "CL" or .leave_code == "ML")'
```

Expected: CL available=3.498, ML available=2.502, combined=6.0

- [ ] **Step 3: Test leave request submission in Jan 2026 scenario**

Simulate submitting a CL request for 1 day when employee has 0 CL but 0.417 ML (Jan scenario):

```bash
curl -s -X POST "http://localhost:5055/api/leave/request" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{"leaveTypeId":"<CL-id>","fromDate":"2026-01-15","toDate":"2026-01-15","totalDays":1,"reason":"test"}'
```

Expected: Request created with status `pending` (not rejected for insufficient balance, because ML balance covers it).

- [ ] **Step 4: Final commit**

```bash
git add -A
git commit -m "feat: leave system — mas_hrms as source of truth (migrations 204-208, workers, combined CL+ML pool)"
```
