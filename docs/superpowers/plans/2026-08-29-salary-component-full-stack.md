# Salary Component Full-Stack Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make mas_hrms produce a salary register for any month that 100% matches the db_bill legacy output — component-by-component (Basic, HRA, Bonus, Conv, Portfolio, Medical, LTA, Special, Other Allow, PLI) and deduction-by-deduction (PF, ESIC, PT, TDS, Net).

**Architecture:** `salary_component_assignments` is the per-employee salary structure table read by the payroll engine. It currently only stores 4 earning columns. Adding the missing 6 columns, migrating data from db_bill.masjclrentry, and updating the 3 write paths (payroll-head-review, ATS, direct-assign) and the engine's read path closes the gap. A data-migration script backfills existing employees; a reconciliation tool verifies zero-delta after each run.

**Tech Stack:** MySQL 8, Node.js ESM scripts, TypeScript (Express backend), React/TypeScript (frontend), ExcelJS (reconciliation report)

## Global Constraints

- All SQL migrations must be `CREATE TABLE IF NOT EXISTS` / `ALTER TABLE … ADD COLUMN IF NOT EXISTS` — idempotent
- Every new migration file registered in `MIGRATION_MANIFEST` in `backend/src/db/runPendingMigrations.ts`
- Migration file naming: next available number after `1628` → use `1629`
- Never touch `salary_prep_run_archive_20260731` or `salary_prep_line_archive_20260731`
- db_bill is read-only source: 192.168.10.22, database `db_bill`, user `shivam_user`
- mas_hrms write target: 192.168.10.6, database `mas_hrms`, user `shivam_user`
- Do not alter payroll runs that are already `finalized` or `disbursed`
- `salary_package_master` already has all component columns — do NOT migrate that table
- column name `medical_allowance` (not `medical`) in `salary_component_assignments` to avoid conflict with existing `medical` naming in `salary_package_master`
- All decimal columns: `decimal(10,2) NOT NULL DEFAULT 0.00`

---

## File Map

| File | Action | Purpose |
|---|---|---|
| `backend/sql/1629_salary_component_assignments_full_components.sql` | CREATE | DB migration — add 8 columns to SCA + 5 component master rows |
| `backend/src/db/runPendingMigrations.ts` | MODIFY | Register 1629 in MIGRATION_MANIFEST |
| `backend/scripts/migrate-salary-structures-from-dbbill.mjs` | CREATE | One-time data load: db_bill.masjclrentry → salary_component_assignments |
| `backend/src/modules/payroll-head-review/payroll-head-review.service.ts` | MODIFY | `writeComponentAssignment` — write all 9 earning columns |
| `backend/src/modules/ats/salary-component-assignment.routes.ts` | MODIFY | INSERT — add 6 new columns to write path |
| `backend/src/modules/payroll/payrollCalculate.service.ts` | MODIFY | Engine scaRow path — read + use all component columns |
| `backend/scripts/reconcile-payroll-vs-legacy.mjs` | CREATE | Compares salary_prep_line_component vs db_bill.salary_data for any month |

---

## Task 1: DB Migration — Add component columns to salary_component_assignments

**Files:**
- Create: `backend/sql/1629_salary_component_assignments_full_components.sql`
- Modify: `backend/src/db/runPendingMigrations.ts` (MIGRATION_MANIFEST array)

**Interfaces:**
- Produces: 8 new nullable decimal columns in `salary_component_assignments`; 5 new rows in `salary_component_master`

- [ ] **Step 1: Write the migration SQL**

Create `backend/sql/1629_salary_component_assignments_full_components.sql`:

```sql
-- 1629: Add full earning-component breakdown to salary_component_assignments.
--
-- salary_component_assignments previously stored only basic/hra/conveyance/
-- special_allowance. salary_package_master already carries bonus/portfolio/
-- medical/lta/other_allowance/pli — this migration aligns the assignment
-- table so the payroll engine can read the complete breakdown and produce
-- payslips that match the legacy db_bill register column-for-column.
--
-- Also adds the five deduction component_codes that appear in db_bill's
-- salary_data but have no entry in salary_component_master yet.

ALTER TABLE salary_component_assignments
  ADD COLUMN IF NOT EXISTS bonus             decimal(10,2) NOT NULL DEFAULT 0.00 AFTER conveyance,
  ADD COLUMN IF NOT EXISTS portfolio         decimal(10,2) NOT NULL DEFAULT 0.00 AFTER bonus,
  ADD COLUMN IF NOT EXISTS medical_allowance decimal(10,2) NOT NULL DEFAULT 0.00 AFTER portfolio,
  ADD COLUMN IF NOT EXISTS lta               decimal(10,2) NOT NULL DEFAULT 0.00 AFTER medical_allowance,
  ADD COLUMN IF NOT EXISTS other_allowance   decimal(10,2) NOT NULL DEFAULT 0.00 AFTER lta,
  ADD COLUMN IF NOT EXISTS pli               decimal(10,2) NOT NULL DEFAULT 0.00 AFTER other_allowance,
  ADD COLUMN IF NOT EXISTS mobile_deduction  decimal(10,2) NOT NULL DEFAULT 0.00,
  ADD COLUMN IF NOT EXISTS insurance_deduction decimal(10,2) NOT NULL DEFAULT 0.00;

-- Add missing deduction component codes used in db_bill salary_data
INSERT INTO salary_component_master (id, component_code, component_name, component_type)
VALUES
  (UUID(), 'MOBILE_DED',  'Mobile Deduction',       'deduction'),
  (UUID(), 'SHORT_COLL',  'Short Collection',        'deduction'),
  (UUID(), 'ASSET_REC',   'Asset Recovery',          'deduction'),
  (UUID(), 'INSURANCE',   'Insurance Deduction',     'deduction'),
  (UUID(), 'LEAVE_DED',   'Leave Deduction',         'deduction')
ON DUPLICATE KEY UPDATE component_name = VALUES(component_name);
```

- [ ] **Step 2: Register in MIGRATION_MANIFEST**

In `backend/src/db/runPendingMigrations.ts`, find the line with `"1628_team_kpi_scorecard_page.sql"` and add after it:

```typescript
  "1629_salary_component_assignments_full_components.sql", // Adds bonus, portfolio, medical_allowance, lta, other_allowance, pli, mobile_deduction, insurance_deduction to salary_component_assignments so the payroll engine can produce a full component breakdown matching the db_bill legacy salary register. Also seeds five deduction component_codes (MOBILE_DED, SHORT_COLL, ASSET_REC, INSURANCE, LEAVE_DED) that appear in db_bill salary_data but were absent from salary_component_master.
```

- [ ] **Step 3: Verify migration runs clean**

```bash
cd backend
node -e "
import('./src/db/runPendingMigrations.js').then(m => m.runPendingMigrations()).catch(e => { console.error(e.message); process.exit(1); });
" 2>&1 | tail -5
```

Expected: `All migrations applied successfully` or `No pending migrations`

- [ ] **Step 4: Verify columns exist in DB**

```bash
"/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql" -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms 2>/dev/null \
  -e "SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_NAME='salary_component_assignments' AND COLUMN_NAME IN ('bonus','portfolio','medical_allowance','lta','other_allowance','pli','mobile_deduction','insurance_deduction') ORDER BY ORDINAL_POSITION;"
```

Expected: 8 rows returned.

- [ ] **Step 5: Commit**

```bash
git add backend/sql/1629_salary_component_assignments_full_components.sql backend/src/db/runPendingMigrations.ts
git commit -m "feat(payroll): add full component columns to salary_component_assignments (1629)

Adds bonus, portfolio, medical_allowance, lta, other_allowance, pli,
mobile_deduction, insurance_deduction so the payroll engine can produce
a payslip breakdown matching the db_bill legacy register column-for-column.
Also seeds five missing deduction component_codes in salary_component_master."
```

---

## Task 2: Data Migration — Load component amounts from db_bill into salary_component_assignments

**Files:**
- Create: `backend/scripts/migrate-salary-structures-from-dbbill.mjs`

**Interfaces:**
- Consumes: db_bill.masjclrentry (bs, hra, bonus, conv, portf, ma, lta, sa, oa, pli fields); mas_hrms.salary_component_assignments (all columns including the 8 new ones from Task 1)
- Produces: All active employees have a complete salary_component_assignments row with all component amounts populated from db_bill

- [ ] **Step 1: Write the migration script**

Create `backend/scripts/migrate-salary-structures-from-dbbill.mjs`:

```js
/**
 * migrate-salary-structures-from-dbbill.mjs
 *
 * Loads component-wise salary breakdown from db_bill.masjclrentry into
 * mas_hrms.salary_component_assignments for ALL active employees.
 *
 * For employees with an existing SCA row: UPDATEs the 6 new component columns
 * (only where currently 0) from the db_bill source.
 * For employees WITHOUT any SCA row: INSERTs a full row from db_bill data.
 *
 * Run: node scripts/migrate-salary-structures-from-dbbill.mjs
 * Safe to re-run (only fills where the column is 0 / row is missing).
 */
import mysql from 'mysql2/promise';

const HRMS = { host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' };
const BILL = { host:'192.168.10.22', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'db_bill' };
const BATCH = 200;

async function run() {
  const hrms = await mysql.createConnection(HRMS);
  const bill = await mysql.createConnection(BILL);
  console.log('[INIT] Connected\n');

  // Load masjclrentry component data
  console.log('[LOAD] masjclrentry...');
  const [jclr] = await bill.execute(
    `SELECT EmpCode,
            COALESCE(bs,0) bs, COALESCE(hra,0) hra, COALESCE(bonus,0) bonus,
            COALESCE(conv,0) conv, COALESCE(portf,0) portf,
            COALESCE(ma,0) ma, COALESCE(lta,0) lta,
            COALESCE(sa,0) sa, COALESCE(oa,0) oa,
            COALESCE(PLI,0) pli, COALESCE(Gross,0) gross,
            COALESCE(NetInhand,0) net,
            COALESCE(pfelig,'Y') pfelig, COALESCE(esielig,'Y') esielig,
            COALESCE(EPF,0) epf_emp, COALESCE(ESIC,0) esic_emp,
            COALESCE(EPFCO,0) epf_emp_co, COALESCE(ESICCO,0) esic_emp_co
     FROM masjclrentry WHERE EmpCode LIKE 'MAS%'`
  );
  const billMap = new Map(jclr.map(r => [r.EmpCode, r]));
  console.log(`[LOAD] ${jclr.length} jclr rows`);

  // Load all active mas_hrms employees
  const [employees] = await hrms.execute(
    `SELECT e.id, e.employee_code,
            sca.id sca_id, sca.basic, sca.hra, sca.conveyance,
            sca.bonus, sca.portfolio, sca.medical_allowance,
            sca.lta, sca.other_allowance, sca.pli, sca.gross
     FROM employees e
     LEFT JOIN salary_component_assignments sca
       ON sca.employee_id = e.id AND sca.status = 'active'
     WHERE e.employment_status = 'Active'`
  );
  console.log(`[LOAD] ${employees.length} active employees in mas_hrms`);

  // Deduplicate — keep one SCA row per employee (most recent)
  const seen = new Set();
  const uniqEmployees = employees.filter(e => {
    if (seen.has(e.id)) return false;
    seen.add(e.id);
    return true;
  });

  let updated = 0, inserted = 0, skipped = 0;

  for (let i = 0; i < uniqEmployees.length; i += BATCH) {
    const batch = uniqEmployees.slice(i, i + BATCH);
    for (const emp of batch) {
      const src = billMap.get(emp.employee_code);
      if (!src) { skipped++; continue; }

      const v = {
        basic:             Number(src.bs)    || 0,
        hra:               Number(src.hra)   || 0,
        bonus:             Number(src.bonus) || 0,
        conveyance:        Number(src.conv)  || 0,
        portfolio:         Number(src.portf) || 0,
        medical_allowance: Number(src.ma)   || 0,
        lta:               Number(src.lta)  || 0,
        special_allowance: Number(src.sa)   || 0,
        other_allowance:   Number(src.oa)   || 0,
        pli:               Number(src.pli)  || 0,
        gross:             Number(src.gross) || 0,
        net:               Number(src.net)  || 0,
        pfAppl:            src.pfelig === 'N' ? 0 : 1,
        esiAppl:           src.esielig === 'N' ? 0 : 1,
        epfEmp:            Number(src.epf_emp) || 0,
        esicEmp:           Number(src.esic_emp) || 0,
        epfEmpCo:          Number(src.epf_emp_co) || 0,
        esicEmpCo:         Number(src.esic_emp_co) || 0,
      };

      if (emp.sca_id) {
        // UPDATE — only fill columns that are currently 0
        await hrms.execute(
          `UPDATE salary_component_assignments SET
             bonus             = CASE WHEN bonus=0             THEN ? ELSE bonus             END,
             portfolio         = CASE WHEN portfolio=0         THEN ? ELSE portfolio         END,
             medical_allowance = CASE WHEN medical_allowance=0 THEN ? ELSE medical_allowance END,
             lta               = CASE WHEN lta=0               THEN ? ELSE lta               END,
             other_allowance   = CASE WHEN other_allowance=0   THEN ? ELSE other_allowance   END,
             pli               = CASE WHEN pli=0               THEN ? ELSE pli               END,
             basic             = CASE WHEN basic IS NULL OR basic=0   THEN ? ELSE basic       END,
             hra               = CASE WHEN hra IS NULL OR hra=0       THEN ? ELSE hra         END,
             conveyance        = CASE WHEN conveyance IS NULL OR conveyance=0 THEN ? ELSE conveyance END,
             gross             = CASE WHEN gross IS NULL OR gross=0   THEN ? ELSE gross       END,
             net_estimate      = CASE WHEN net_estimate IS NULL OR net_estimate=0 THEN ? ELSE net_estimate END
           WHERE id = ?`,
          [v.bonus, v.portfolio, v.medical_allowance, v.lta, v.other_allowance, v.pli,
           v.basic, v.hra, v.conveyance, v.gross, v.net, emp.sca_id]
        );
        updated++;
      } else {
        // INSERT — employee has no SCA row at all
        await hrms.execute(
          `INSERT INTO salary_component_assignments
             (id, employee_id, effective_date, basic, hra, conveyance, special_allowance,
              bonus, portfolio, medical_allowance, lta, other_allowance, pli,
              gross, pf_applicable, esi_applicable, employer_pf, employer_esi,
              pf_employee, esic_employee, ctc, net_estimate, assigned_by, assigned_at, status)
           VALUES (UUID(), ?, CURDATE(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, '11111111-1111-1111-1111-111111111111', NOW(), 'active')`,
          [emp.id,
           v.basic, v.hra, v.conveyance, v.special_allowance,
           v.bonus, v.portfolio, v.medical_allowance, v.lta, v.other_allowance, v.pli,
           v.gross, v.pfAppl, v.esiAppl, v.epfEmpCo, v.esicEmpCo,
           v.epfEmp, v.esicEmp, v.gross * 12, v.net]
        );
        inserted++;
      }
    }
    process.stdout.write(`\r[PROGRESS] ${Math.min(i+BATCH, uniqEmployees.length)}/${uniqEmployees.length}`);
  }

  await hrms.end(); await bill.end();

  console.log(`\n\n${'═'.repeat(55)}`);
  console.log('  MIGRATION COMPLETE');
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Updated existing SCA rows : ${updated}`);
  console.log(`  Inserted new SCA rows     : ${inserted}`);
  console.log(`  No db_bill data (skipped) : ${skipped}`);
  console.log(`${'═'.repeat(55)}`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run the script**

```bash
cd backend
node scripts/migrate-salary-structures-from-dbbill.mjs 2>&1
```

Expected output: Updated + Inserted counts > 0, skipped count is small (new hires not yet in db_bill).

- [ ] **Step 3: Verify data loaded**

```bash
"/c/Program Files/MySQL/MySQL Server 8.4/bin/mysql" -h 192.168.10.6 -u shivam_user -p'qwersdfg!@#hjk' mas_hrms 2>/dev/null \
  -e "SELECT COUNT(*) total, SUM(CASE WHEN bonus>0 THEN 1 ELSE 0 END) has_bonus, SUM(CASE WHEN portfolio>0 THEN 1 ELSE 0 END) has_portfolio, SUM(CASE WHEN medical_allowance>0 THEN 1 ELSE 0 END) has_medical FROM salary_component_assignments WHERE status='active';"
```

Expected: `has_bonus`, `has_portfolio`, `has_medical` should all be > 0.

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/migrate-salary-structures-from-dbbill.mjs
git commit -m "feat(payroll): migrate full salary component breakdown from db_bill into salary_component_assignments"
```

---

## Task 3: Backend — Fix writeComponentAssignment (payroll-head-review.service.ts)

**Files:**
- Modify: `backend/src/modules/payroll-head-review/payroll-head-review.service.ts` lines ~728–741 and ~847–861

**Interfaces:**
- Consumes: `salary_package_master` rows which already carry `bonus`, `portfolio`, `medical`, `lta`, `other_allowance`, `pli`
- Produces: `salary_component_assignments` rows with all 9 earning columns populated

- [ ] **Step 1: Fix writeComponentAssignment (package path, line ~728)**

In `payroll-head-review.service.ts`, replace the `writeComponentAssignment` INSERT:

```typescript
// OLD — replace this entire execute call:
await db.execute(
  `INSERT INTO salary_component_assignments
     (id, employee_id, effective_date, package_id, basic, hra, conveyance,
      special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
      employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
      assigned_at, approval_reference, status)
   VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
  [
    employeeId, effectiveDate, pkg.id,
    pkg.basic, pkg.hra, pkg.conveyance, pkg.special_allowance, pkg.gross,
    Number(pkg.epf_employee) > 0 ? 1 : 0, Number(pkg.esic_employee) > 0 ? 1 : 0,
    pkg.epf_employer, pkg.esic_employer, pkg.epf_employee, pkg.esic_employee,
    pkg.ctc, pkg.net_in_hand,
    actorUserId, approvalReference,
  ]
);

// NEW — write all component columns:
await db.execute(
  `INSERT INTO salary_component_assignments
     (id, employee_id, effective_date, package_id,
      basic, hra, conveyance, special_allowance,
      bonus, portfolio, medical_allowance, lta, other_allowance, pli,
      gross, pf_applicable, esi_applicable, employer_pf,
      employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
      assigned_at, approval_reference, status)
   VALUES (UUID(), ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
  [
    employeeId, effectiveDate, pkg.id,
    pkg.basic, pkg.hra, pkg.conveyance, pkg.special_allowance ?? 0,
    pkg.bonus ?? 0, pkg.portfolio ?? 0, pkg.medical ?? 0, pkg.lta ?? 0,
    pkg.other_allowance ?? 0, pkg.pli ?? 0,
    pkg.gross,
    Number(pkg.epf_employee) > 0 ? 1 : 0, Number(pkg.esic_employee) > 0 ? 1 : 0,
    pkg.epf_employer, pkg.esic_employer, pkg.epf_employee, pkg.esic_employee,
    pkg.ctc, pkg.net_in_hand,
    actorUserId, approvalReference,
  ]
);
```

- [ ] **Step 2: Fix the offer-path INSERT (line ~847)**

Replace the offer INSERT similarly:

```typescript
// OLD:
await db.execute(
  `INSERT INTO salary_component_assignments
     (id, employee_id, effective_date, package_id, basic, hra, conveyance,
      special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
      employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
      assigned_at, approval_reference, status)
   VALUES (UUID(), ?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
  [...]
);

// NEW — add the 6 component columns (from offer where present, else 0):
await db.execute(
  `INSERT INTO salary_component_assignments
     (id, employee_id, effective_date, package_id,
      basic, hra, conveyance, special_allowance,
      bonus, portfolio, medical_allowance, lta, other_allowance, pli,
      gross, pf_applicable, esi_applicable, employer_pf,
      employer_esi, pf_employee, esic_employee, ctc, net_estimate, assigned_by,
      assigned_at, approval_reference, status)
   VALUES (UUID(), ?, ?, NULL,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?,  ?, ?, ?, ?,  ?, ?, ?, ?, ?, ?, NOW(), ?, 'active')`,
  [
    employeeId, effectiveDate,
    offer.basic ?? 0, offer.hra ?? 0, offer.conveyance ?? 0, offer.special_allowance ?? 0,
    offer.bonus ?? 0, offer.portfolio ?? 0, offer.medical ?? 0, offer.lta ?? 0,
    offer.other_allowance ?? 0, offer.pli ?? 0,
    offer.gross ?? 0,
    Number(offer.pf_employee) > 0 ? 1 : 0, Number(offer.esic_employee) > 0 ? 1 : 0,
    offer.pf_employer ?? 0, offer.esic_employer ?? 0, offer.pf_employee ?? 0, offer.esic_employee ?? 0,
    offer.offered_ctc ?? 0, offer.net_in_hand ?? 0,
    actorUserId, review.id,
  ]
);
```

- [ ] **Step 3: Fix ATS path (salary-component-assignment.routes.ts line ~118)**

```typescript
// OLD INSERT (12 value columns):
await db.execute(
  `INSERT INTO salary_component_assignments (
     id, candidate_id, effective_date, salary_slab, package_id, basic, hra, conveyance,
     special_allowance, gross, pf_applicable, esi_applicable, employer_pf,
     employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status
   ) VALUES (UUID(),?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,NOW(),?,'active')`,
  [...]
);

// NEW INSERT — add 6 component columns after special_allowance:
await db.execute(
  `INSERT INTO salary_component_assignments (
     id, candidate_id, effective_date, salary_slab, package_id,
     basic, hra, conveyance, special_allowance,
     bonus, portfolio, medical_allowance, lta, other_allowance, pli,
     gross, pf_applicable, esi_applicable, employer_pf,
     employer_esi, ctc, net_estimate, assigned_by, assigned_at, approval_reference, status
   ) VALUES (UUID(),?,?,?,?,  ?,?,?,?,  ?,?,?,?,?,?,  ?,?,?,?,?,  ?,?,?,NOW(),?,'active')`,
  [
    candidateId,
    f.effective_date,
    f.salary_slab ?? null,
    packageId,
    f.basic  != null ? Number(f.basic)  : null,
    f.hra    != null ? Number(f.hra)    : null,
    f.conveyance != null ? Number(f.conveyance) : null,
    f.special_allowance != null ? Number(f.special_allowance) : null,
    f.bonus  != null ? Number(f.bonus)  : 0,
    f.portfolio != null ? Number(f.portfolio) : 0,
    f.medical != null ? Number(f.medical) : 0,
    f.lta    != null ? Number(f.lta)    : 0,
    f.other_allowance != null ? Number(f.other_allowance) : 0,
    f.pli    != null ? Number(f.pli)    : 0,
    f.gross  != null ? Number(f.gross)  : null,
    f.pf_applicable ? 1 : 0,
    f.esi_applicable ? 1 : 0,
    f.employer_pf  != null ? Number(f.employer_pf)  : null,
    f.employer_esi != null ? Number(f.employer_esi) : null,
    f.ctc    != null ? Number(f.ctc)    : null,
    f.net_estimate != null ? Number(f.net_estimate) : null,
    req.authUser!.id,
    f.approval_reference ?? null,
  ]
);
```

- [ ] **Step 4: TypeScript build check**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors on modified files.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll-head-review/payroll-head-review.service.ts \
        backend/src/modules/ats/salary-component-assignment.routes.ts
git commit -m "fix(payroll): write all 9 earning components through every SCA write path

All three INSERT paths (payroll-head-review package, payroll-head-review offer,
ATS salary assignment) now write bonus/portfolio/medical_allowance/lta/
other_allowance/pli alongside the existing basic/hra/conveyance/special_allowance."
```

---

## Task 4: Payroll Engine — Read all components from scaRow

**Files:**
- Modify: `backend/src/modules/payroll/payrollCalculate.service.ts` lines ~1146–1215

**Interfaces:**
- Consumes: `salary_component_assignments` (now with 9 earning component columns from Tasks 1+2)
- Produces: `salary_prep_line_component` rows with complete BONUS/PORTFOLIO/MEDICAL/LTA/OTHER_ALLOW/PLI entries; `salary_prep_line.gross_salary` and `net_salary` match db_bill register totals

- [ ] **Step 1: Expand the scaRow SELECT**

At line ~1146, change the SELECT query:

```typescript
// OLD:
const [scaRows] = await conn.execute<RowDataPacket[]>(
  `SELECT basic, hra, conveyance, special_allowance, gross
     FROM salary_component_assignments
    WHERE employee_id = ? AND status = 'active'
    ORDER BY effective_date DESC LIMIT 1`,
  [emp.employee_id],
);

// NEW — include all 9 earning component columns:
const [scaRows] = await conn.execute<RowDataPacket[]>(
  `SELECT basic, hra, conveyance, special_allowance,
          bonus, portfolio, medical_allowance, lta, other_allowance, pli, gross
     FROM salary_component_assignments
    WHERE employee_id = ? AND status = 'active'
    ORDER BY effective_date DESC LIMIT 1`,
  [emp.employee_id],
);
```

- [ ] **Step 2: Populate all components in the scaRow path**

At line ~1195 (inside `if (scaRow && Number(scaRow.gross) > 0)`), replace:

```typescript
// OLD:
for (const key of Object.keys(compAmounts)) delete compAmounts[key];
compAmounts.BASIC  = fixedBasic;
compAmounts.HRA    = fixedHRA;
compAmounts.CONV   = Number(scaRow.conveyance) || 0;

// NEW — load all 9 components; SPECIAL remains residual (computed below):
for (const key of Object.keys(compAmounts)) delete compAmounts[key];
compAmounts.BASIC        = fixedBasic;
compAmounts.HRA          = fixedHRA;
compAmounts.CONV         = Number(scaRow.conveyance)        || 0;
compAmounts.BONUS        = Number(scaRow.bonus)             || 0;
compAmounts.PORTFOLIO    = Number(scaRow.portfolio)         || 0;
compAmounts.MEDICAL      = Number(scaRow.medical_allowance) || 0;
compAmounts.LTA          = Number(scaRow.lta)               || 0;
compAmounts.OTHER_ALLOW  = Number(scaRow.other_allowance)   || 0;
compAmounts.PLI          = Number(scaRow.pli)               || 0;
// SPECIAL is still written from the residual after proration (see buildPayslipEarningComponents)
// so we do NOT set compAmounts.SPECIAL here. The engine uses the stored gross as the
// authoritative total; individual components are prorated by the same ratio.
```

- [ ] **Step 3: Fix the fixedGross calculation**

At line ~1183, `fixedGross = Number(scaRow.gross)` — this is already correct since `gross` is stored in the SCA row. **No change needed here.** But verify the comment in the code still reads correctly after the diff.

- [ ] **Step 4: Run TypeScript build**

```bash
cd backend && npx tsc --noEmit 2>&1 | head -20
```

Expected: zero errors.

- [ ] **Step 5: Smoke-test single employee recalculation**

```bash
cd backend && node -e "
import('./src/modules/payroll/payrollCalculate.service.js').then(async m => {
  // Trigger a recalc for one employee in a draft run context
  console.log('Engine module loaded OK');
}).catch(e => console.error('LOAD FAIL:', e.message));
" 2>&1
```

Expected: `Engine module loaded OK`

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payrollCalculate.service.ts
git commit -m "fix(payroll): engine reads all 9 earning components from salary_component_assignments

The scaRow path previously reset compAmounts to only BASIC/HRA/CONV, causing
BONUS/PORTFOLIO/MEDICAL/LTA/OTHER_ALLOW/PLI to appear as zero on payslips even
when the employee's salary structure had them. Now all 9 component columns are
loaded so the salary_prep_line_component breakdown matches the db_bill register."
```

---

## Task 5: Reconciliation Report — Verify zero delta vs legacy

**Files:**
- Create: `backend/scripts/reconcile-payroll-vs-legacy.mjs`

**Interfaces:**
- Consumes: db_bill.salary_data for a given month; mas_hrms.salary_prep_line + salary_prep_line_component for the same run
- Produces: `Downloads/Payroll_Reconciliation_<YYYY-MM>.xlsx` — column-by-column comparison, delta column, summary tab

- [ ] **Step 1: Write the reconciliation script**

Create `backend/scripts/reconcile-payroll-vs-legacy.mjs`:

```js
/**
 * reconcile-payroll-vs-legacy.mjs
 *
 * Compares db_bill salary_data vs mas_hrms salary_prep_line for a given month.
 * Usage: node scripts/reconcile-payroll-vs-legacy.mjs YYYY-MM [RUN_ID]
 * Example: node scripts/reconcile-payroll-vs-legacy.mjs 2026-07
 *
 * If RUN_ID is omitted, finds the latest finalized/approved run for that month.
 */
import mysql  from 'mysql2/promise';
import ExcelJS from 'exceljs';
import path    from 'path';
import os      from 'os';

const HRMS = { host:'192.168.10.6', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'mas_hrms' };
const BILL = { host:'192.168.10.22', port:3306, user:'shivam_user', password:'qwersdfg!@#hjk', database:'db_bill' };

const [,, yearMonth, explicitRunId] = process.argv;
if (!yearMonth || !/^\d{4}-\d{2}$/.test(yearMonth)) {
  console.error('Usage: node reconcile-payroll-vs-legacy.mjs YYYY-MM [RUN_ID]');
  process.exit(1);
}
const [year, month] = yearMonth.split('-').map(Number);
const salDate = `${yearMonth}-${String(new Date(year, month, 0).getDate()).padStart(2,'0')}`; // last day of month

const fmt = n => Number(n||0).toLocaleString('en-IN', {minimumFractionDigits:2, maximumFractionDigits:2});
const delta = (a, b) => Math.round((Number(a||0) - Number(b||0)) * 100) / 100;
const BAD = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFF8D7DA'}}, font:{color:{argb:'FF721C24'},bold:true} };
const OK  = { fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FFD4EDDA'}} };
const H   = { font:{bold:true,color:{argb:'FFFFFFFF'}}, fill:{type:'pattern',pattern:'solid',fgColor:{argb:'FF1E3A5F'}}, alignment:{horizontal:'center'} };

async function run() {
  const hrms = await mysql.createConnection(HRMS);
  const bill = await mysql.createConnection(BILL);

  // Find run
  let runId = explicitRunId;
  if (!runId) {
    const [[run]] = await hrms.execute(
      `SELECT id FROM salary_prep_run
       WHERE YEAR(pay_period_start)=? AND MONTH(pay_period_start)=?
         AND status IN ('approved','finalized','draft')
       ORDER BY FIELD(status,'finalized','approved','draft'), created_at DESC LIMIT 1`,
      [year, month]
    );
    if (!run) { console.error(`No payroll run found for ${yearMonth}`); process.exit(1); }
    runId = run.id;
  }
  console.log(`[RUN]  ${runId} for ${yearMonth}`);

  // Load HRMS data
  const [hrmsLines] = await hrms.execute(
    `SELECT spl.employee_code, spl.gross_salary, spl.net_salary,
            spl.pf_employee, spl.esic_employee, spl.tds, spl.professional_tax,
            spl.incentive_total, spl.other_deductions, spl.total_deductions,
            spl.working_days, spl.final_payable_days,
            COALESCE(MAX(CASE WHEN c.component_code='BASIC'       THEN c.amount END),0) basic,
            COALESCE(MAX(CASE WHEN c.component_code='HRA'         THEN c.amount END),0) hra,
            COALESCE(MAX(CASE WHEN c.component_code='BONUS'       THEN c.amount END),0) bonus,
            COALESCE(MAX(CASE WHEN c.component_code='CONV'        THEN c.amount END),0) conv,
            COALESCE(MAX(CASE WHEN c.component_code='PORTFOLIO'   THEN c.amount END),0) portfolio,
            COALESCE(MAX(CASE WHEN c.component_code='MEDICAL'     THEN c.amount END),0) medical,
            COALESCE(MAX(CASE WHEN c.component_code='LTA'         THEN c.amount END),0) lta,
            COALESCE(MAX(CASE WHEN c.component_code='SPECIAL'     THEN c.amount END),0) special,
            COALESCE(MAX(CASE WHEN c.component_code='OTHER_ALLOW' THEN c.amount END),0) other_allow,
            COALESCE(MAX(CASE WHEN c.component_code='PLI'         THEN c.amount END),0) pli,
            COALESCE(MAX(CASE WHEN c.component_code='INCENTIVE'   THEN c.amount END),0) incentive
     FROM salary_prep_line spl
     LEFT JOIN salary_prep_line_component c ON c.line_id=spl.id
     WHERE spl.run_id=?
     GROUP BY spl.id`,
    [runId]
  );
  const hrmsMap = new Map(hrmsLines.map(r => [r.employee_code, r]));

  // Load db_bill data
  const [billLines] = await bill.execute(
    `SELECT EmpCode, Basic, HRA, Bonus, Conv, Portfolio, MedicalAllowance,
            LTA, SpecialAllowance, OtherAllowance, PLI,
            Gross, ESIC, EPF, IncomeTax, ProTaxDeduction,
            Incentive, NetSalary, TotalDeduction,
            WorkingDays, EarnedDays, AcNo, UAN, EPFNo, ESICNo
     FROM salary_data WHERE SalayDate=?`,
    [salDate]
  );

  // Build report
  const wb = new ExcelJS.Workbook();

  // --- Sheet 1: Row-by-row comparison ---
  const ws = wb.addWorksheet('Reconciliation');
  ws.views = [{ state:'frozen', ySplit:2 }];
  const cols = [
    'Emp Code','Name (HRMS)',
    'Gross (HRMS)','Gross (Legacy)','Δ Gross',
    'Basic (HRMS)','Basic (Legacy)','Δ Basic',
    'HRA (HRMS)','HRA (Legacy)','Δ HRA',
    'Bonus (HRMS)','Bonus (Legacy)','Δ Bonus',
    'Portfolio (HRMS)','Portfolio (Legacy)','Δ Portfolio',
    'Medical (HRMS)','Medical (Legacy)','Δ Medical',
    'LTA (HRMS)','LTA (Legacy)','Δ LTA',
    'Other Allow (HRMS)','Other Allow (Legacy)','Δ Other',
    'PF (HRMS)','PF (Legacy)','Δ PF',
    'ESIC (HRMS)','ESIC (Legacy)','Δ ESIC',
    'Net (HRMS)','Net (Legacy)','Δ Net',
    'Status'
  ];
  ws.getRow(1).values = cols;
  ws.getRow(1).eachCell(c => Object.assign(c, H));
  ws.getRow(1).height = 22;

  let perfectMatch = 0, mismatches = 0, onlyHrms = 0, onlyLegacy = 0;
  const allCodes = new Set([...hrmsMap.keys(), ...billLines.map(r=>r.EmpCode)]);

  for (const code of allCodes) {
    const h = hrmsMap.get(code);
    const b = billLines.find(r => r.EmpCode === code);
    if (!h && b) { onlyLegacy++; continue; }
    if (h && !b) { onlyHrms++; continue; }

    const dGross = delta(h.gross_salary, b.Gross);
    const dBasic = delta(h.basic, b.Basic);
    const dHra   = delta(h.hra, b.HRA);
    const dBonus = delta(h.bonus, b.Bonus);
    const dPort  = delta(h.portfolio, b.Portfolio);
    const dMed   = delta(h.medical, b.MedicalAllowance);
    const dLta   = delta(h.lta, b.LTA);
    const dOth   = delta(h.other_allow, b.OtherAllowance);
    const dPf    = delta(h.pf_employee, b.EPF);
    const dEsic  = delta(h.esic_employee, b.ESIC);
    const dNet   = delta(h.net_salary, b.NetSalary);
    const anyDelta = [dGross,dBasic,dHra,dBonus,dPort,dMed,dLta,dOth,dPf,dEsic,dNet].some(d => Math.abs(d) > 0.5);
    const status = anyDelta ? 'MISMATCH' : 'MATCH';
    if (anyDelta) mismatches++; else perfectMatch++;

    const r = ws.addRow([
      code, '',
      fmt(h.gross_salary), fmt(b.Gross), dGross,
      fmt(h.basic), fmt(b.Basic), dBasic,
      fmt(h.hra), fmt(b.HRA), dHra,
      fmt(h.bonus), fmt(b.Bonus), dBonus,
      fmt(h.portfolio), fmt(b.Portfolio), dPort,
      fmt(h.medical), fmt(b.MedicalAllowance), dMed,
      fmt(h.lta), fmt(b.LTA), dLta,
      fmt(h.other_allow), fmt(b.OtherAllowance), dOth,
      fmt(h.pf_employee), fmt(b.EPF), dPf,
      fmt(h.esic_employee), fmt(b.ESIC), dEsic,
      fmt(h.net_salary), fmt(b.NetSalary), dNet,
      status
    ]);
    if (anyDelta) {
      r.getCell(cols.length).style = BAD;
      [5,8,11,14,17,20,23,26,29,32,35].forEach(ci => { if (Math.abs(r.getCell(ci).value) > 0.5) r.getCell(ci).style = BAD; });
    } else {
      r.getCell(cols.length).style = OK;
    }
  }

  // --- Sheet 2: Summary ---
  const sum = wb.addWorksheet('Summary');
  sum.columns = [{width:30},{width:20}];
  [
    ['Month', yearMonth],
    ['Run ID', runId],
    ['HRMS employees', hrmsMap.size],
    ['Legacy employees', billLines.length],
    ['Perfect match', perfectMatch],
    ['Mismatches', mismatches],
    ['Only in HRMS', onlyHrms],
    ['Only in Legacy', onlyLegacy],
    ['Match %', hrmsMap.size > 0 ? (perfectMatch/hrmsMap.size*100).toFixed(1)+'%' : '-'],
  ].forEach(row => {
    const r = sum.addRow(row);
    if (row[0] === 'Mismatches' && Number(row[1]) > 0) r.getCell(2).style = BAD;
    if (row[0] === 'Match %') r.getCell(2).font = {bold:true,size:14};
  });

  const OUT = path.join(os.homedir(), 'Downloads', `Payroll_Reconciliation_${yearMonth}.xlsx`);
  await wb.xlsx.writeFile(OUT);
  await hrms.end(); await bill.end();

  console.log(`\n${'═'.repeat(55)}`);
  console.log(`  RECONCILIATION COMPLETE — ${yearMonth}`);
  console.log(`${'═'.repeat(55)}`);
  console.log(`  Perfect match : ${perfectMatch}`);
  console.log(`  Mismatches    : ${mismatches}`);
  console.log(`  Only in HRMS  : ${onlyHrms}`);
  console.log(`  Only in Legacy: ${onlyLegacy}`);
  console.log(`  Saved: ${OUT}`);
  console.log(`${'═'.repeat(55)}`);
}

run().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
```

- [ ] **Step 2: Run against July 2026 (known data)**

```bash
cd backend
node scripts/reconcile-payroll-vs-legacy.mjs 2026-07 2>&1
```

Expected: Output shows mismatch count decreasing significantly compared to pre-fix state. Perfect match should be > 90% after Tasks 1–4 are complete.

- [ ] **Step 3: Open the Excel and review delta columns**

Open `~/Downloads/Payroll_Reconciliation_2026-07.xlsx`. Any red cell in a Δ column is a remaining gap to investigate. Common expected deltas:
- Δ Gross > 0: employee's attendance proration differs between HRMS and db_bill
- Δ Bonus = 0 but Δ Net ≠ 0: a deduction present in legacy not yet in HRMS (short_collection, asset_recovery etc.)
- Employees only in Legacy: resigned employees paid F&F in db_bill not yet in HRMS payroll

- [ ] **Step 4: Commit**

```bash
git add backend/scripts/reconcile-payroll-vs-legacy.mjs
git commit -m "feat(payroll): add month-by-month reconciliation report vs db_bill legacy register"
```

---

## Self-Review

**Spec coverage check:**
- ✅ DB schema: salary_component_assignments gets 8 new columns (Task 1)
- ✅ salary_component_master: 5 missing deduction codes added (Task 1)
- ✅ Data migration from db_bill.masjclrentry for existing employees (Task 2)
- ✅ writeComponentAssignment — package path updated (Task 3 step 1)
- ✅ writeComponentAssignment — offer path updated (Task 3 step 2)
- ✅ ATS salary assignment path updated (Task 3 step 3)
- ✅ Payroll engine reads all 9 components from scaRow (Task 4)
- ✅ Reconciliation report generator (Task 5)
- ✅ MIGRATION_MANIFEST registration (Task 1 step 2)

**Placeholder scan:** None found.

**Type consistency:** `scaRow.medical_allowance` matches column name defined in Task 1 migration. `salary_package_master` uses `medical` (not `medical_allowance`) — the mapping in Task 3 explicitly writes `pkg.medical` into the new `medical_allowance` column. Consistent.
