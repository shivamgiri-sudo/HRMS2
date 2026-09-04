# Scoped Payroll Runs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let the Payroll Head run payroll for a selected set of cost centres across one or more branches, instead of only for the whole company, and make the salary register show only what has actually been run.

**Architecture:** A run gains a set of cost centres through a new `salary_prep_run_scope` table whose `UNIQUE (run_month, cost_centre_id)` makes double payment a database error. Both places that select a run's employee population — the readiness gate and the calculator — branch on `scope_kind` and, for scoped runs, restrict by cost-centre **id**. Each payroll line is stamped with the branch and cost centre it was paid under, so a closed month's register never changes. Statutory and bank outputs stay monthly, assembled across the month's runs.

**Tech Stack:** Express + TypeScript, MySQL 8 (`mas_hrms`), mysql2/promise, Zod, Vitest, React 18 + shadcn/Radix + TanStack Query.

## Global Constraints

- **Never modify salary calculation.** `running-salary.service.ts` and the arithmetic inside `payrollCalculate.service.ts` are called, never changed. This work changes *which employees* a run selects and *what is recorded*, nothing about how a rupee is computed.
- **Migrations are additive and go in `backend/sql/`.** The runner reads that directory only; `sql/migrations/` is dead. Do not edit an applied migration.
- **Never run a migration or deploy against production without explicit user approval.**
- **Select employees by id, never by name.** `branch_name` is not unique — HYDERABAD, JAIPUR, JAIPUR IDC, KARNAL, MEERUT and MOHALI each name two rows in `branch_master`; several `process_name` values collide too.
- **Legacy runs must not change.** All 104 existing runs are company-wide (`branch_filter`/`process_filter`/`branch_id`/`process_id` all NULL). They get `scope_kind='company'` and must select exactly the same population as before.
- **Closed-set form inputs are dropdowns/checkboxes, never free text** (CLAUDE.md Form Input Rule).
- **Run authority is HO only:** `payroll_head` plus the existing `admin`, `super_admin`, `finance`, `payroll`. No branch role may create or calculate a run.
- **Test commands:** backend `cd backend && npx vitest run <path>`; frontend `./backend/node_modules/.bin/vitest run --config vitest.config.ts <path>` (vitest lives under `backend/node_modules`).
- **Verification target:** HEAD OFFICE — 4 cost centres, 15 payable employees (MANAGEMENT-CORPORATE 7, FINANCE/ACCOUNTS 4, BSS/BLD/CORP/796 3, IT/SYSTEM 1).

---

### Task 1: Migration 1671 — scope table and stamp columns

**Files:**
- Create: `backend/sql/1671_payroll_run_cost_centre_scope.sql`
- Modify: `backend/src/db/migrationManifest.ts` (add the filename in numeric order)

**Interfaces:**
- Produces: table `salary_prep_run_scope`; columns `salary_prep_run.scope_kind`, `salary_prep_line.branch_id`, `salary_prep_line.cost_centre_id`.

- [ ] **Step 1: Write the migration**

Guard every DDL so re-running is safe, and guard columns the migration *reads* as well as ones it writes — an unguarded statement against a column that does not exist takes production down at boot.

```sql
-- 1671_payroll_run_cost_centre_scope.sql
--
-- Lets a payroll run cover a chosen set of cost centres instead of the whole company.
--
-- WHY A TABLE AND NOT A COLUMN. A run covers many cost centres, possibly across branches, so the
-- relationship is many-to-many. Storing it as a JSON list on the run would leave nothing able to
-- enforce that a cost centre belongs to only one run in a month — and the failure that guards
-- against is paying somebody twice. UNIQUE (run_month, cost_centre_id) makes that a constraint
-- violation rather than something application code has to remember to check.
--
-- WHY THE LINE IS STAMPED. employees.cost_centre_id is current-state only; the effective-dated
-- employee_cost_centre_allocation table holds 0 rows. A register that derives cost centre from the
-- employee therefore changes retroactively when somebody transfers. Stamping the line at
-- calculation freezes where each person was actually paid.
--
-- Additive. Existing runs are marked 'company' and behave exactly as before; their lines keep NULL
-- stamps and are never backfilled.
--
-- Rollback:
--   DROP TABLE IF EXISTS salary_prep_run_scope;
--   ALTER TABLE salary_prep_run DROP COLUMN scope_kind;
--   ALTER TABLE salary_prep_line DROP COLUMN branch_id, DROP COLUMN cost_centre_id;

USE mas_hrms;

CREATE TABLE IF NOT EXISTS salary_prep_run_scope (
  id             CHAR(36)    NOT NULL,
  run_id         CHAR(36)    NOT NULL,
  run_month      VARCHAR(7)  NOT NULL,
  branch_id      CHAR(36)    NOT NULL,
  cost_centre_id CHAR(36)    NOT NULL,
  created_at     DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_scope_month_cost_centre (run_month, cost_centre_id),
  KEY idx_scope_run (run_id),
  KEY idx_scope_month_branch (run_month, branch_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_run'
              AND COLUMN_NAME = 'scope_kind');
SET @s := IF(@c = 0,
  "ALTER TABLE salary_prep_run ADD COLUMN scope_kind ENUM('company','scoped') NOT NULL DEFAULT 'company'",
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.COLUMNS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line'
              AND COLUMN_NAME = 'branch_id');
SET @s := IF(@c = 0,
  'ALTER TABLE salary_prep_line ADD COLUMN branch_id CHAR(36) NULL, ADD COLUMN cost_centre_id CHAR(36) NULL',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

SET @c := (SELECT COUNT(*) FROM information_schema.STATISTICS
            WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'salary_prep_line'
              AND INDEX_NAME = 'idx_spl_cost_centre');
SET @s := IF(@c = 0,
  'CREATE INDEX idx_spl_cost_centre ON salary_prep_line (cost_centre_id)',
  'SELECT 1');
PREPARE st FROM @s; EXECUTE st; DEALLOCATE PREPARE st;

-- Verification (run manually, expect scope_kind='company' on all 104 rows):
-- SELECT scope_kind, COUNT(*) FROM salary_prep_run GROUP BY scope_kind;
```

Check the exact collation of `salary_prep_run.id` first and match it — this schema has 58 tables with drifted collation, and a mismatch makes every future join to this table drop its index:

```bash
cd backend && node -e "
require('dotenv').config();const m=require('mysql2/promise');
(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const [r]=await c.execute(\"SELECT TABLE_NAME,COLUMN_NAME,COLLATION_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME IN ('salary_prep_run','salary_prep_line','cost_centre_master','branch_master') AND COLUMN_NAME='id'\");
console.table(r);await c.end();})();"
```

- [ ] **Step 2: Register it in the manifest**

Add `"1671_payroll_run_cost_centre_scope.sql"` to the array in `backend/src/db/migrationManifest.ts`, in numeric order after `1670_user_report_permissions_uuid_user_id.sql`.

- [ ] **Step 3: Apply against a throwaway schema, never production**

Do NOT start the backend dev server to test this — `backend/.env` points at the production database and the boot path runs pending migrations. Apply by hand to a scratch schema:

Run: `mysql -h <scratch-host> -u <user> -p scratch_hrms < backend/sql/1671_payroll_run_cost_centre_scope.sql`
Expected: no errors; re-running it a second time also succeeds (idempotent).

- [ ] **Step 4: Commit**

```bash
git add backend/sql/1671_payroll_run_cost_centre_scope.sql backend/src/db/migrationManifest.ts
git commit -m "feat(payroll): schema for cost-centre scoped runs"
```

---

### Task 2: Run scope service

**Files:**
- Create: `backend/src/modules/payroll/payroll-run-scope.service.ts`
- Test: `backend/src/modules/payroll/__tests__/payroll-run-scope.service.test.ts`

**Interfaces:**
- Produces:
  - `resolveCostCentreScope(costCentreIds: string[]): Promise<Array<{ costCentreId: string; branchId: string }>>` — validates active, resolves branch; throws `ScopeError` with `code` on failure.
  - `assertCostCentresFree(conn, runMonth: string, costCentreIds: string[]): Promise<void>` — throws `ScopeError('CC_ALREADY_IN_RUN')` naming the conflicting run.
  - `insertRunScope(conn, runId: string, runMonth: string, rows: Array<{ costCentreId: string; branchId: string }>): Promise<void>`
  - `getRunScopeCostCentreIds(runId: string): Promise<string[]>`
  - `class ScopeError extends Error { code: string; status: number }`

- [ ] **Step 1: Write the failing tests**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));

const { resolveCostCentreScope, assertCostCentresFree, ScopeError } =
  await import("../payroll-run-scope.service.js");

describe("resolveCostCentreScope", () => {
  it("rejects an empty selection rather than silently meaning 'everyone'", async () => {
    // A scoped run with no cost centres would fall through to an unfiltered population.
    await expect(resolveCostCentreScope([])).rejects.toMatchObject({ code: "CC_REQUIRED" });
  });

  it("rejects a cost centre that is not active", async () => {
    execute.mockResolvedValueOnce([[], []]);
    await expect(resolveCostCentreScope(["cc-1"])).rejects.toMatchObject({ code: "CC_NOT_FOUND" });
  });

  it("returns the branch resolved from the cost centre, never from the client", async () => {
    execute.mockResolvedValueOnce([[{ id: "cc-1", branch_id: "br-1" }], []]);
    await expect(resolveCostCentreScope(["cc-1"])).resolves.toEqual([
      { costCentreId: "cc-1", branchId: "br-1" },
    ]);
  });
});

describe("assertCostCentresFree", () => {
  it("refuses a cost centre already claimed by another run that month", async () => {
    const conn = { execute: vi.fn().mockResolvedValue([[{ cost_centre_id: "cc-1", run_id: "run-9" }], []]) };
    await expect(assertCostCentresFree(conn as never, "2026-08", ["cc-1"]))
      .rejects.toMatchObject({ code: "CC_ALREADY_IN_RUN" });
  });

  it("allows cost centres that no live run holds", async () => {
    const conn = { execute: vi.fn().mockResolvedValue([[], []]) };
    await expect(assertCostCentresFree(conn as never, "2026-08", ["cc-1"])).resolves.toBeUndefined();
  });

  it("ignores cancelled runs, whose scope rows are released", async () => {
    const conn = { execute: vi.fn().mockResolvedValue([[], []]) };
    await assertCostCentresFree(conn as never, "2026-08", ["cc-1"]);
    const sql = String(conn.execute.mock.calls[0][0]);
    expect(sql).toContain("cancelled");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-run-scope.service.test.ts`
Expected: FAIL — cannot resolve `../payroll-run-scope.service.js`.

- [ ] **Step 3: Implement**

```typescript
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "node:crypto";
import { db } from "../../db/mysql.js";

export class ScopeError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "ScopeError";
  }
}

export type ScopeRow = { costCentreId: string; branchId: string };

/**
 * Validate the selected cost centres and resolve each to its branch.
 *
 * The branch is resolved here rather than taken from the request: a client-supplied branch could
 * disagree with the cost centre's real one, and the scope row is what every later query trusts.
 */
export async function resolveCostCentreScope(costCentreIds: string[]): Promise<ScopeRow[]> {
  const ids = [...new Set((costCentreIds ?? []).map((s) => String(s ?? "").trim()).filter(Boolean))];
  if (!ids.length) {
    throw new ScopeError("CC_REQUIRED", "Select at least one cost centre for a scoped run.");
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id, ccm.branch_id
       FROM cost_centre_master ccm
       JOIN branch_master bm ON bm.id = ccm.branch_id AND bm.active_status = 1
      WHERE ccm.active_status = 1
        AND ccm.branch_id IS NOT NULL
        AND ccm.id IN (${ids.map(() => "?").join(",")})`,
    ids,
  );
  if (rows.length !== ids.length) {
    const found = new Set(rows.map((r) => String(r.id)));
    const missing = ids.filter((i) => !found.has(i));
    throw new ScopeError(
      "CC_NOT_FOUND",
      `These cost centres are not active, or their branch is not active: ${missing.join(", ")}`,
    );
  }
  return rows.map((r) => ({ costCentreId: String(r.id), branchId: String(r.branch_id) }));
}

/**
 * Refuse cost centres already covered by a live run for the month.
 *
 * The unique key on (run_month, cost_centre_id) is what actually guarantees this; the check exists
 * so the caller gets a message naming the conflicting run instead of a raw constraint violation.
 * Cancelled runs release their scope rows, so they cannot block a fresh run.
 */
export async function assertCostCentresFree(
  conn: PoolConnection,
  runMonth: string,
  costCentreIds: string[],
): Promise<void> {
  if (!costCentreIds.length) return;
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT s.cost_centre_id, s.run_id, ccm.cost_centre_code
       FROM salary_prep_run_scope s
       JOIN salary_prep_run r ON r.id = s.run_id
       LEFT JOIN cost_centre_master ccm ON ccm.id = s.cost_centre_id
      WHERE s.run_month = ?
        AND LOWER(r.status) <> 'cancelled'
        AND s.cost_centre_id IN (${costCentreIds.map(() => "?").join(",")})`,
    [runMonth, ...costCentreIds],
  );
  if (rows.length) {
    const names = rows.map((r) => String(r.cost_centre_code ?? r.cost_centre_id)).join(", ");
    throw new ScopeError(
      "CC_ALREADY_IN_RUN",
      `Already covered by another payroll run for ${runMonth}: ${names}`,
      409,
    );
  }
}

export async function insertRunScope(
  conn: PoolConnection,
  runId: string,
  runMonth: string,
  rows: ScopeRow[],
): Promise<void> {
  if (!rows.length) return;
  await conn.execute(
    `INSERT INTO salary_prep_run_scope (id, run_id, run_month, branch_id, cost_centre_id)
     VALUES ${rows.map(() => "(?, ?, ?, ?, ?)").join(", ")}`,
    rows.flatMap((r) => [randomUUID(), runId, runMonth, r.branchId, r.costCentreId]),
  );
}

export async function getRunScopeCostCentreIds(runId: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?`,
    [runId],
  );
  return rows.map((r) => String(r.cost_centre_id));
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-run-scope.service.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payroll-run-scope.service.ts backend/src/modules/payroll/__tests__/payroll-run-scope.service.test.ts
git commit -m "feat(payroll): run cost-centre scope service"
```

---

### Task 3: Readiness gate selects by cost-centre id

**Files:**
- Modify: `backend/src/modules/payroll/payroll-governance.service.ts:79-106` (`runEmployeeScopeSql`)
- Test: `backend/src/modules/payroll/__tests__/scoped-run-population.test.ts`

**Interfaces:**
- Consumes: `salary_prep_run.scope_kind`, `salary_prep_run_scope`.
- Produces: `runEmployeeScopeSql(run, restrictToRunLines?)` unchanged in signature; adds a cost-centre subquery when `run.scope_kind === 'scoped'`.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { runEmployeeScopeSql } from "../payroll-governance.service.js";

const scopedRun = { id: "run-1", run_month: "2026-08", scope_kind: "scoped" };
const companyRun = { id: "run-2", run_month: "2026-08", scope_kind: "company", branch_filter: "NOIDA" };

describe("scoped runs select by cost-centre id", () => {
  it("restricts to the run's own cost centres", () => {
    const { where, params } = runEmployeeScopeSql(scopedRun);
    expect(where).toContain("e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)");
    expect(params).toContain("run-1");
  });

  it("never resolves a scoped run through a branch name", () => {
    /*
     * branch_name is not unique — HYDERABAD, JAIPUR, KARNAL, MEERUT and MOHALI each name two rows
     * in branch_master. A name-based filter on a scoped run would pay the wrong branch's staff.
     */
    const { where } = runEmployeeScopeSql(scopedRun);
    expect(where).not.toContain("branch_master WHERE branch_name");
  });

  it("leaves company runs exactly as they were", () => {
    const { where, params } = runEmployeeScopeSql(companyRun);
    expect(where).toContain("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
    expect(where).not.toContain("salary_prep_run_scope");
    expect(params).toContain("NOIDA");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/scoped-run-population.test.ts`
Expected: FAIL — `where` has no `salary_prep_run_scope` clause.

- [ ] **Step 3: Implement**

Insert into `runEmployeeScopeSql`, immediately before the existing `if (run.branch_id)` block, and make the legacy filters apply only to company runs:

```typescript
  /*
   * A scoped run is defined by the cost centres in salary_prep_run_scope, matched by id.
   *
   * Deliberately not by name: branch_name is not unique in branch_master (HYDERABAD, JAIPUR,
   * JAIPUR IDC, KARNAL, MEERUT and MOHALI each name two rows), so the legacy name-based filters
   * below can silently widen a run to a second branch. They are kept only for the 104 historical
   * company runs, which must keep selecting exactly the population they always did.
   */
  if (String(run.scope_kind ?? "company") === "scoped") {
    clauses.push(
      "e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)",
    );
    params.push(run.id);
  } else {
    if (run.branch_id) { clauses.push("e.branch_id = ?"); params.push(run.branch_id); }
    if (run.process_id) { clauses.push("e.process_id = ?"); params.push(run.process_id); }
    if (run.branch_filter) {
      clauses.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
      params.push(run.branch_filter);
    }
    if (run.process_filter) {
      clauses.push("e.process_id IN (SELECT id FROM process_master WHERE process_name = ?)");
      params.push(run.process_filter);
    }
  }
```

Delete the four original `if (run.branch_id) …` through `if (run.process_filter) …` blocks that this replaces, so the filters are not applied twice.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/scoped-run-population.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payroll-governance.service.ts backend/src/modules/payroll/__tests__/scoped-run-population.test.ts
git commit -m "feat(payroll): readiness gate selects scoped runs by cost-centre id"
```

---

### Task 4: Calculator selects the same population

**Files:**
- Modify: `backend/src/modules/payroll/payrollCalculate.service.ts:746-756`
- Test: `backend/src/modules/payroll/__tests__/scoped-run-population.test.ts` (extend)

**Interfaces:**
- Consumes: `salary_prep_run_scope`, `run.scope_kind`.

This is the task where a mistake pays the wrong people. The readiness gate and the calculator must select an identical set: if they diverge, blockers are checked against one population and salaries paid to another.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const calculator = fs.readFileSync(path.resolve(DIR, "../payrollCalculate.service.ts"), "utf8");

describe("the calculator pays exactly the population readiness checked", () => {
  it("applies the same cost-centre subquery the readiness gate applies", () => {
    // Source-text, because the two clauses live in different modules and the defect is that they
    // drift apart. A behavioural test on either one alone cannot see the divergence.
    expect(calculator).toContain(
      "e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)",
    );
  });

  it("applies the legacy name filters only to company runs", () => {
    const scopedGuard = calculator.indexOf('scope_kind ?? "company") === "scoped"');
    expect(scopedGuard, "calculator must branch on scope_kind").toBeGreaterThan(-1);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/scoped-run-population.test.ts`
Expected: FAIL — the calculator contains neither string.

- [ ] **Step 3: Implement**

Replace the existing `if (run.process_filter) { … }` and `if (run.branch_filter) { … }` blocks at `payrollCalculate.service.ts:746-756` with:

```typescript
  /*
   * Scoped runs select by cost-centre id, from salary_prep_run_scope — the identical clause
   * runEmployeeScopeSql() uses in payroll-governance.service.ts. These two must stay in step: the
   * readiness gate decides whether the run may proceed, this decides who gets paid, and if they
   * select different populations a blocker can be cleared for one set of people while a different
   * set is paid.
   *
   * The name-based filters below remain for the 104 legacy company runs only. They cannot be used
   * for scoped runs because branch_name is not unique in branch_master.
   */
  if (String((run as { scope_kind?: string }).scope_kind ?? "company") === "scoped") {
    empConds.push("e.cost_centre_id IN (SELECT cost_centre_id FROM salary_prep_run_scope WHERE run_id = ?)");
    empParams.push(run.id);
  } else {
    if (run.process_filter) {
      empConds.push("(pm.process_name = ? OR e.process_id IN (SELECT id FROM process_master WHERE process_name = ?))");
      empParams.push(run.process_filter, run.process_filter);
    }
    if (run.branch_filter) {
      empConds.push("e.branch_id IN (SELECT id FROM branch_master WHERE branch_name = ?)");
      empParams.push(run.branch_filter);
    }
  }
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/scoped-run-population.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Confirm nothing else in the payroll suite regressed**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__`
Expected: PASS. Baseline before this work was 1067 passing, 0 failing.

- [ ] **Step 6: Commit**

```bash
git add backend/src/modules/payroll/payrollCalculate.service.ts backend/src/modules/payroll/__tests__/scoped-run-population.test.ts
git commit -m "feat(payroll): calculator selects scoped runs by cost-centre id"
```

---

### Task 5: Stamp branch and cost centre on each payroll line

**Files:**
- Modify: `backend/src/modules/payroll/payrollCalculate.service.ts:1885` (the `INSERT INTO salary_prep_line`)
- Test: `backend/src/modules/payroll/__tests__/salary-line-scope-stamp.test.ts`

**Interfaces:**
- Produces: `salary_prep_line.branch_id` and `.cost_centre_id` populated for every line a run writes.

The employee query at line ~804 already selects `e.process_id, e.branch_id`; add `e.cost_centre_id` to that select list so the value is in hand at insert time.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const calculator = fs.readFileSync(path.resolve(DIR, "../payrollCalculate.service.ts"), "utf8");

describe("a payroll line records where it was paid", () => {
  it("selects the employee's cost centre alongside the branch", () => {
    expect(calculator).toContain("e.cost_centre_id");
  });

  it("writes branch_id and cost_centre_id into salary_prep_line", () => {
    /*
     * Without the stamp the salary register derives cost centre from employees.cost_centre_id,
     * which is current-state only — so a transfer silently rewrites a closed month's register and
     * a cost centre that was paid can appear unpaid.
     */
    const insertStart = calculator.indexOf("INSERT INTO salary_prep_line\n");
    expect(insertStart).toBeGreaterThan(-1);
    const insert = calculator.slice(insertStart, insertStart + 2000);
    expect(insert).toContain("branch_id");
    expect(insert).toContain("cost_centre_id");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/salary-line-scope-stamp.test.ts`
Expected: FAIL on the second test — the INSERT names neither column.

- [ ] **Step 3: Implement**

Add `e.cost_centre_id,` to the employee SELECT list (near `e.process_id, e.branch_id,` at ~line 804). Then in the `INSERT INTO salary_prep_line` column list add `branch_id, cost_centre_id,` after `employee_code,`, and add the two matching values to the parameter array in the same position:

```typescript
        emp.branch_id ?? null,
        emp.cost_centre_id ?? null,
```

Add a comment above the two new columns:

```sql
          -- Where this person was paid, frozen at calculation. employees.cost_centre_id is
          -- current-state only, so without this a later transfer rewrites a closed month.
          branch_id, cost_centre_id,
```

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/salary-line-scope-stamp.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payrollCalculate.service.ts backend/src/modules/payroll/__tests__/salary-line-scope-stamp.test.ts
git commit -m "feat(payroll): stamp branch and cost centre on each payroll line"
```

---

### Task 6: Create a scoped run

**Files:**
- Modify: `backend/src/modules/payroll/payroll.validation.ts:71-75` (`createRunSchema`)
- Modify: `backend/src/modules/payroll/payroll.service.ts:355-405` (`createRun`)
- Modify: `backend/src/modules/payroll/payroll.routes.ts:679-688` (roles + scope target)
- Modify: `backend/src/modules/payroll/payroll.routes.ts:767` (add `payroll_head` to calculate)
- Test: `backend/src/modules/payroll/__tests__/create-scoped-run.test.ts`

**Interfaces:**
- Consumes: `resolveCostCentreScope`, `assertCostCentresFree`, `insertRunScope`, `ScopeError` from Task 2.
- Produces: `POST /api/payroll/runs` accepting `{ runMonth, costCentreIds?: string[] }`.

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { createRunSchema } from "../payroll.validation.js";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll.routes.ts"), "utf8");

describe("createRunSchema", () => {
  it("accepts a list of cost centre ids", () => {
    const parsed = createRunSchema.parse({ runMonth: "2026-08", costCentreIds: ["a", "b"] });
    expect(parsed.costCentreIds).toEqual(["a", "b"]);
  });

  it("still accepts a company-wide run with no cost centres", () => {
    expect(createRunSchema.parse({ runMonth: "2026-08" }).costCentreIds).toBeUndefined();
  });
});

describe("run authority", () => {
  it("lets the Payroll Head create a run", () => {
    // payroll_head owns this workflow but was absent from the role list, so the role chosen to run
    // payroll could not create a run at all.
    const create = routes.slice(routes.indexOf('router.post("/runs"'), routes.indexOf('router.get("/runs/:id"'));
    expect(create).toContain('"payroll_head"');
  });

  it("lets the Payroll Head calculate a run", () => {
    const calc = routes.slice(routes.indexOf('router.post("/runs/:id/calculate"'));
    expect(calc.slice(0, 400)).toContain('"payroll_head"');
  });

  it("scopes run creation on the branches derived from the selection, not a client field", () => {
    /*
     * The guard resolved req.body.branch_id, which the API never sends — so the row-scope check
     * saw no branch and could not confine anyone.
     */
    const create = routes.slice(routes.indexOf('router.post("/runs"'), routes.indexOf('router.get("/runs/:id"'));
    expect(create).not.toContain("req.body.branch_id");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/create-scoped-run.test.ts`
Expected: FAIL — schema has no `costCentreIds`, routes have no `payroll_head`.

- [ ] **Step 3: Implement the schema**

```typescript
export const createRunSchema = z.object({
  runMonth: z.string().regex(MONTH_REGEX, "runMonth must be YYYY-MM"),
  // Omit for a company-wide run (the legacy shape). Supplying ids makes the run scoped.
  costCentreIds: z.array(z.string().trim().min(1)).min(1).optional(),
  branchFilter: z.string().trim().nullable().optional(),
  processFilter: z.string().trim().nullable().optional(),
});
```

- [ ] **Step 4: Implement run creation**

In `createRun`, inside the existing `GET_LOCK` block and before the INSERT, add:

```typescript
      const scopeRows = input.costCentreIds?.length
        ? await resolveCostCentreScope(input.costCentreIds)
        : [];
      const isScoped = scopeRows.length > 0;
      if (isScoped) {
        // Readable error naming the clashing run; the unique key is what actually guarantees it.
        await assertCostCentresFree(conn, input.runMonth, scopeRows.map((r) => r.costCentreId));
      }
```

Change the lock key so two scoped creations for different cost centres in the same month do not serialise on each other unnecessarily, while still serialising the same selection:

```typescript
    const lockKey = `payroll_run_create:${input.runMonth}:${input.branchFilter ?? ""}:${input.processFilter ?? ""}:${[...(input.costCentreIds ?? [])].sort().join(",")}`;
```

Extend the INSERT to record `scope_kind`, then write the scope rows in the same transaction:

```typescript
        await conn.execute(
          `INSERT INTO salary_prep_run
             (id, run_month, branch_filter, process_filter, window_close_date, created_by, scope_kind)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
          [id, input.runMonth, input.branchFilter ?? null, input.processFilter ?? null,
           windowCloseDate, userId, isScoped ? "scoped" : "company"],
        );
        if (isScoped) await insertRunScope(conn, id, input.runMonth, scopeRows);
```

The duplicate check above the INSERT must not block a second scoped run for the same month — that check exists to stop two *company* runs. Guard it:

```typescript
        if (!isScoped) {
          const [dup] = await conn.execute(/* existing month/branch/process duplicate query */);
          if ((dup as RowDataPacket[]).length > 0) throw new Error("Payroll run already exists for this month");
        }
```

- [ ] **Step 5: Implement the route changes**

Add `"payroll_head"` to `requireRole` on both `POST /runs` and `POST /runs/:id/calculate`. Replace the scope target on `POST /runs`:

```typescript
  requireScopedRole(["finance", "payroll", "payroll_head"], async (req) => {
    // Branches come from the selected cost centres, resolved server-side. The previous resolver
    // read req.body.branch_id, a field this API never sends, so the target carried no branch and
    // the scope check could not restrict anyone.
    const ids: string[] = req.body?.costCentreIds ?? [];
    if (!ids.length) return { branchId: null };
    const rows = await resolveCostCentreScope(ids);
    return { branchId: rows[0]?.branchId ?? null };
  }),
```

Map `ScopeError` to its status in the route's error handling so `CC_ALREADY_IN_RUN` returns 409 with its message rather than a 500.

- [ ] **Step 6: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/create-scoped-run.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/payroll/payroll.validation.ts backend/src/modules/payroll/payroll.service.ts backend/src/modules/payroll/payroll.routes.ts backend/src/modules/payroll/__tests__/create-scoped-run.test.ts
git commit -m "feat(payroll): create cost-centre scoped runs, with Payroll Head authority"
```

---

### Task 7: Month coverage gate

**Files:**
- Create: `backend/src/modules/payroll/payroll-run-coverage.service.ts`
- Modify: `backend/src/modules/payroll/payroll.routes.ts` (mount `GET /runs/coverage`)
- Test: `backend/src/modules/payroll/__tests__/payroll-run-coverage.test.ts`

**Interfaces:**
- Produces: `getMonthCoverage(month: string): Promise<{ month: string; complete: boolean; costCentres: Array<{ costCentreId: string; costCentreCode: string; branchName: string; staff: number; status: "paid" | "in_run" | "not_started"; runId: string | null }>; uncoveredEmployees: Array<{ employeeId: string; employeeCode: string; reason: string }> }>`
- Produces: `GET /api/payroll/runs/coverage?month=YYYY-MM`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
const { getMonthCoverage } = await import("../payroll-run-coverage.service.js");

describe("month coverage", () => {
  it("is incomplete while any active employee sits outside every run", async () => {
    execute
      .mockResolvedValueOnce([[{ cost_centre_id: "cc-1", cost_centre_code: "IT/SYSTEM", branch_name: "HEAD OFFICE", staff: 1, run_id: "r1", run_status: "finalized" }], []])
      .mockResolvedValueOnce([[{ id: "e-9", employee_code: "MAS9", reason: "no cost centre assigned" }], []]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.complete).toBe(false);
    expect(cov.uncoveredEmployees).toHaveLength(1);
  });

  it("names employees with no cost centre explicitly rather than dropping them", async () => {
    // 2 active employees have no cost_centre_id. Silently excluding them is how somebody goes unpaid.
    execute
      .mockResolvedValueOnce([[], []])
      .mockResolvedValueOnce([[{ id: "e-9", employee_code: "MAS9", reason: "no cost centre assigned" }], []]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.uncoveredEmployees[0].reason).toContain("no cost centre");
  });

  it("is complete only when nothing is uncovered", async () => {
    execute
      .mockResolvedValueOnce([[{ cost_centre_id: "cc-1", cost_centre_code: "IT/SYSTEM", branch_name: "HEAD OFFICE", staff: 1, run_id: "r1", run_status: "finalized" }], []])
      .mockResolvedValueOnce([[], []]);
    const cov = await getMonthCoverage("2026-08");
    expect(cov.complete).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-run-coverage.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { isRunClosed } from "./run-status.js";

export type CoverageStatus = "paid" | "in_run" | "not_started";

/**
 * What the month still owes.
 *
 * "Complete" is deliberately defined against EMPLOYEES, not cost centres: a month where every cost
 * centre has a run can still leave people unpaid, because 2 active employees have no cost centre at
 * all. Those are listed as uncovered with a reason rather than omitted, since an employee who is
 * silently skipped looks identical to one who was correctly excluded.
 */
export async function getMonthCoverage(month: string) {
  const [ccRows] = await db.execute<RowDataPacket[]>(
    `SELECT ccm.id           AS cost_centre_id,
            ccm.cost_centre_code,
            bm.branch_name,
            COUNT(e.id)      AS staff,
            s.run_id,
            r.status         AS run_status
       FROM cost_centre_master ccm
       JOIN branch_master bm ON bm.id = ccm.branch_id AND bm.active_status = 1
       LEFT JOIN employees e
              ON e.cost_centre_id = ccm.id
             AND e.active_status = 1
             AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
       LEFT JOIN salary_prep_run_scope s
              ON s.cost_centre_id = ccm.id AND s.run_month = ?
       LEFT JOIN salary_prep_run r
              ON r.id = s.run_id AND LOWER(r.status) <> 'cancelled'
      WHERE ccm.active_status = 1
      GROUP BY ccm.id, ccm.cost_centre_code, bm.branch_name, s.run_id, r.status
     HAVING staff > 0 OR s.run_id IS NOT NULL
      ORDER BY bm.branch_name, ccm.cost_centre_code`,
    [month],
  );

  const [uncovered] = await db.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code,
            CASE WHEN e.cost_centre_id IS NULL THEN 'no cost centre assigned'
                 ELSE 'cost centre not included in any run this month' END AS reason
       FROM employees e
      WHERE e.active_status = 1
        AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'
        AND (e.cost_centre_id IS NULL
             OR NOT EXISTS (SELECT 1 FROM salary_prep_run_scope s
                              JOIN salary_prep_run r ON r.id = s.run_id AND LOWER(r.status) <> 'cancelled'
                             WHERE s.run_month = ? AND s.cost_centre_id = e.cost_centre_id))
      ORDER BY e.employee_code`,
    [month],
  );

  const costCentres = ccRows.map((r) => ({
    costCentreId: String(r.cost_centre_id),
    costCentreCode: String(r.cost_centre_code ?? ""),
    branchName: String(r.branch_name ?? ""),
    staff: Number(r.staff ?? 0),
    runId: r.run_id ? String(r.run_id) : null,
    status: (!r.run_id ? "not_started" : isRunClosed(r.run_status) ? "paid" : "in_run") as CoverageStatus,
  }));

  return {
    month,
    complete: uncovered.length === 0,
    costCentres,
    uncoveredEmployees: uncovered.map((r) => ({
      employeeId: String(r.id),
      employeeCode: String(r.employee_code ?? ""),
      reason: String(r.reason),
    })),
  };
}
```

Mount the route beside the other run routes, with the same read roles `POST /runs` uses plus the HO readers:

```typescript
router.get("/runs/coverage",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "finance_head"),
  h(async (req, res) => {
    const month = String(req.query.month ?? "").trim();
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "month must be YYYY-MM" });
    }
    return res.json({ success: true, data: await getMonthCoverage(month) });
  }),
);
```

Register it **before** `router.get("/runs/:id")`, or `coverage` is captured as an id.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-run-coverage.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payroll-run-coverage.service.ts backend/src/modules/payroll/payroll.routes.ts backend/src/modules/payroll/__tests__/payroll-run-coverage.test.ts
git commit -m "feat(payroll): month coverage gate for scoped runs"
```

---

### Task 8: Consolidated month-level statutory and bank outputs

**Files:**
- Create: `backend/src/modules/payroll/payroll-month-outputs.service.ts`
- Modify: `backend/src/modules/payroll/payroll.routes.ts` (mount four month endpoints)
- Test: `backend/src/modules/payroll/__tests__/payroll-month-outputs.test.ts`

**Interfaces:**
- Produces: `getMonthRunIds(month: string): Promise<string[]>` and `GET /api/payroll/month/:month/{ecr,esic-challan,tds-summary,neft-export}`.

PF ECR, the ESIC challan, TDS and the NEFT file are filed and paid once per month. Splitting a month into six runs must not produce six challans.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi } from "vitest";

const execute = vi.fn();
vi.mock("../../../db/mysql.js", () => ({ db: { execute } }));
const { getMonthRunIds } = await import("../payroll-month-outputs.service.js");

describe("month outputs span every run in the month", () => {
  it("collects all non-cancelled runs for the month", async () => {
    execute.mockResolvedValue([[{ id: "r1" }, { id: "r2" }], []]);
    await expect(getMonthRunIds("2026-08")).resolves.toEqual(["r1", "r2"]);
  });

  it("excludes cancelled runs, whose lines must not reach a challan", async () => {
    execute.mockResolvedValue([[], []]);
    await getMonthRunIds("2026-08");
    expect(String(execute.mock.calls[0][0])).toContain("cancelled");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-month-outputs.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

```typescript
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * Every run whose lines belong to this month's filing.
 *
 * A month may now be paid in several runs, one per group of cost centres, but PF, ESI, TDS and the
 * bank file are filed and paid once. These endpoints therefore aggregate across runs rather than
 * per run. Cancelled runs are excluded: their lines were never paid.
 */
export async function getMonthRunIds(month: string): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ? AND LOWER(status) <> 'cancelled'
      ORDER BY created_at`,
    [month],
  );
  return rows.map((r) => String(r.id));
}
```

For each of the four existing per-run endpoints (`/runs/:id/ecr`, `/runs/:id/esic-challan`, `/runs/:id/tds-summary`, `/runs/:id/neft-export`), add a month sibling that reuses the same builder over `run_id IN (…)` instead of `run_id = ?`. Extract each builder into a function taking `runIds: string[]` and have the per-run route call it with a single id, so there is one implementation and the two routes cannot drift.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/payroll-month-outputs.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payroll-month-outputs.service.ts backend/src/modules/payroll/payroll.routes.ts backend/src/modules/payroll/__tests__/payroll-month-outputs.test.ts
git commit -m "feat(payroll): consolidate statutory and bank outputs per month"
```

---

### Task 9: Salary register shows only what has been run

**Files:**
- Modify: `backend/src/modules/payroll/payroll-extended.routes.ts:299-340` (`/runs/:id/salary-sheet-export`)
- Test: `backend/src/modules/payroll/__tests__/salary-register-scope.contract.test.ts`

**Interfaces:**
- Consumes: `salary_prep_line.branch_id`, `.cost_centre_id` from Task 5.

- [ ] **Step 1: Write the failing test**

```typescript
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const DIR = path.dirname(fileURLToPath(import.meta.url));
const routes = fs.readFileSync(path.resolve(DIR, "../payroll-extended.routes.ts"), "utf8");

function exportHandler(): string {
  const start = routes.indexOf('"/runs/:id/salary-sheet-export"');
  return routes.slice(start, routes.indexOf("payrollExtendedRouter.", start + 10));
}

describe("the register reflects the run, not the employee's current posting", () => {
  it("reads the cost centre stamped on the line", () => {
    // Deriving from employees.cost_centre_id lets a transfer rewrite a closed month's register.
    expect(exportHandler()).toContain("spl.cost_centre_id");
  });

  it("still applies the caller's own branch/process scope", () => {
    // Two independent limits: what the run covers, and what this viewer may see.
    const handler = exportHandler();
    expect(handler).toContain("buildScopeWhereClause");
    expect(handler).toContain('1=0');
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/salary-register-scope.contract.test.ts`
Expected: FAIL on the first test.

- [ ] **Step 3: Implement**

In the register query, resolve the cost centre from the line stamp with the employee's current cost centre only as a fallback for legacy lines:

```sql
        COALESCE(stamped_cc.cost_centre_code, ccm.cost_centre_code, '')   AS CostCenter,
```

joined as:

```sql
   LEFT JOIN cost_centre_master stamped_cc ON stamped_cc.id = spl.cost_centre_id
```

The `COALESCE` is what keeps the 104 legacy runs readable: their lines have no stamp, so they fall back to the employee's current cost centre exactly as before.

- [ ] **Step 4: Run to verify it passes**

Run: `cd backend && npx vitest run src/modules/payroll/__tests__/salary-register-scope.contract.test.ts`
Expected: PASS, 2 tests.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/payroll/payroll-extended.routes.ts backend/src/modules/payroll/__tests__/salary-register-scope.contract.test.ts
git commit -m "feat(payroll): salary register reads the run's own cost centres"
```

---

### Task 10: Branch and cost-centre picker

**Files:**
- Create: `src/components/payroll/RunScopePicker.tsx`
- Create: `src/components/payroll/__tests__/runScopeSelection.test.ts`
- Create: `src/components/payroll/runScopeSelection.ts`
- Modify: `src/hooks/usePayroll.ts:293` (send `costCentreIds`)

**Interfaces:**
- Produces: `<RunScopePicker value={string[]} onChange={(ids: string[]) => void} month={string} />`
- Produces: `toggleBranch(selected: string[], branchCostCentreIds: string[]): string[]` and `branchState(selected: string[], branchCostCentreIds: string[]): "none" | "some" | "all"` in `runScopeSelection.ts`.

Selection logic goes in a plain module so it can be tested without rendering — the same reason `readinessViewScope.ts` was extracted.

**Design constraints** (from the shadcn guideline set and CLAUDE.md): finance surfaces are blue (`from-blue-600 to-indigo-600` header, blue tone); GlassCard container `rounded-2xl border border-white/60 bg-white/95 backdrop-blur-sm shadow-sm`; controlled `Dialog` via `open`/`onOpenChange`, never `defaultOpen`; Lucide icons, no emoji; `cursor-pointer` on every clickable row; visible focus rings; 150–300ms transitions; `prefers-reduced-motion` respected; responsive at 375/768/1024/1440.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from "vitest";
import { branchState, toggleBranch } from "../runScopeSelection";

const HEAD_OFFICE = ["cc-mgmt", "cc-fin", "cc-bss", "cc-it"];

describe("selecting a whole branch", () => {
  it("adds every cost centre in the branch", () => {
    expect(toggleBranch([], HEAD_OFFICE).sort()).toEqual([...HEAD_OFFICE].sort());
  });

  it("clears the branch when all of it is already selected", () => {
    expect(toggleBranch([...HEAD_OFFICE], HEAD_OFFICE)).toEqual([]);
  });

  it("completes a partial selection rather than clearing it", () => {
    // Clicking a partially-filled branch should finish the job, not undo the user's picks.
    expect(toggleBranch(["cc-it"], HEAD_OFFICE).sort()).toEqual([...HEAD_OFFICE].sort());
  });

  it("leaves other branches' selections untouched", () => {
    expect(toggleBranch(["cc-other"], HEAD_OFFICE)).toContain("cc-other");
  });
});

describe("branch checkbox state", () => {
  it("is none, some or all", () => {
    expect(branchState([], HEAD_OFFICE)).toBe("none");
    expect(branchState(["cc-it"], HEAD_OFFICE)).toBe("some");
    expect(branchState([...HEAD_OFFICE], HEAD_OFFICE)).toBe("all");
  });

  it("reports none for a branch with no cost centres", () => {
    // Delhi Office and NOIDA-DIALDESK are active but hold no staff.
    expect(branchState([], [])).toBe("none");
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `./backend/node_modules/.bin/vitest run --config vitest.config.ts src/components/payroll/__tests__/runScopeSelection.test.ts`
Expected: FAIL — cannot resolve `../runScopeSelection`.

- [ ] **Step 3: Implement the selection logic**

```typescript
/** Selection maths for the run scope picker, kept apart from rendering so it can be tested. */

export type BranchState = "none" | "some" | "all";

export function branchState(selected: readonly string[], branchCostCentreIds: readonly string[]): BranchState {
  if (!branchCostCentreIds.length) return "none";
  const chosen = branchCostCentreIds.filter((id) => selected.includes(id)).length;
  if (chosen === 0) return "none";
  return chosen === branchCostCentreIds.length ? "all" : "some";
}

/**
 * Clicking a branch selects all of its cost centres, or clears them if all were already selected.
 * A partial selection completes rather than clearing — clearing would silently discard picks the
 * user had just made.
 */
export function toggleBranch(selected: readonly string[], branchCostCentreIds: readonly string[]): string[] {
  const state = branchState(selected, branchCostCentreIds);
  if (state === "all") return selected.filter((id) => !branchCostCentreIds.includes(id));
  return [...new Set([...selected, ...branchCostCentreIds])];
}
```

- [ ] **Step 4: Run to verify it passes**

Run: `./backend/node_modules/.bin/vitest run --config vitest.config.ts src/components/payroll/__tests__/runScopeSelection.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Build the picker component**

`RunScopePicker.tsx` renders active branches from `GET /api/payroll/runs/coverage?month=…` (which already returns branch, cost centre, headcount and current run status — no second endpoint needed). Each branch row is a `Checkbox` whose `checked` is `true`/`false` and `indeterminate` when `branchState` is `"some"`, followed by its cost centres. A cost centre whose `status` is not `not_started` renders disabled with the text "already in a run this month". Show a running total: "3 branches · 12 cost centres · 418 employees selected".

- [ ] **Step 6: Send the ids**

`src/hooks/usePayroll.ts:293` currently posts `{ runMonth }`. Change to `{ runMonth, costCentreIds }`, defaulting to omitted when the array is empty so a company-wide run is still possible.

- [ ] **Step 7: Verify the build**

Run: `npm run build`
Expected: built with no TypeScript errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/payroll/RunScopePicker.tsx src/components/payroll/runScopeSelection.ts src/components/payroll/__tests__/runScopeSelection.test.ts src/hooks/usePayroll.ts
git commit -m "feat(payroll): branch and cost-centre picker for run creation"
```

---

### Task 11: Coverage panel

**Files:**
- Create: `src/components/payroll/MonthCoveragePanel.tsx`
- Create: `src/hooks/useMonthCoverage.ts`
- Modify: `src/pages/payroll/PayrollReadinessDashboard.tsx` (render the panel for HO users)

**Interfaces:**
- Consumes: `GET /api/payroll/runs/coverage?month=` from Task 7.

- [ ] **Step 1: Add the hook**

```typescript
import { useQuery } from "@tanstack/react-query";
import { hrmsApi } from "@/lib/hrmsApi";

export function useMonthCoverage(month: string) {
  return useQuery({
    queryKey: ["payroll", "coverage", month],
    queryFn: () => hrmsApi.get<{ data: MonthCoverage }>(`/api/payroll/runs/coverage?month=${month}`).then((r) => r.data),
    enabled: !!month,
    staleTime: 30_000,
  });
}
```

- [ ] **Step 2: Build the panel**

Three counters — paid / in run / not started — then the uncovered-employee list. The uncovered list is the point of the panel, so it is never collapsed away: it names each employee and the reason, and states plainly that the month cannot be closed while it is non-empty. Blue finance tone, GlassCard container, Lucide icons.

- [ ] **Step 3: Verify the build**

Run: `npm run build`
Expected: built with no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/components/payroll/MonthCoveragePanel.tsx src/hooks/useMonthCoverage.ts src/pages/payroll/PayrollReadinessDashboard.tsx
git commit -m "feat(payroll): month coverage panel"
```

---

### Task 12: Live verification on HEAD OFFICE

**Files:** none — verification only.

HEAD OFFICE is the target because it is small enough to check by hand: 4 cost centres, 15 payable employees.

- [ ] **Step 1: Confirm the expected population before running anything**

```bash
cd backend && node -e "
require('dotenv').config();const m=require('mysql2/promise');
(async()=>{const c=await m.createConnection({host:process.env.DB_HOST,user:process.env.DB_USER,password:process.env.DB_PASSWORD,database:process.env.DB_NAME});
const [r]=await c.execute(\`SELECT ccm.cost_centre_code, COUNT(e.id) staff FROM employees e
  JOIN branch_master bm ON bm.id=e.branch_id JOIN cost_centre_master ccm ON ccm.id=e.cost_centre_id
  WHERE e.active_status=1 AND LOWER(COALESCE(e.employment_status,'active'))='active' AND bm.branch_name='HEAD OFFICE'
  GROUP BY ccm.cost_centre_code ORDER BY staff DESC\`);
console.table(r);await c.end();})();"
```
Expected: MANAGEMENT-CORPORATE 7, FINANCE/ACCOUNTS 4, BSS/BLD/CORP/796 3, IT/SYSTEM 1 — 15 total.

- [ ] **Step 2: Create the scoped run** (requires explicit user approval — this writes to production)

`POST /api/payroll/runs` with `{ runMonth: "2026-08", costCentreIds: [the four HEAD OFFICE ids] }`.
Expected: 201 with `scope_kind: "scoped"` and four rows in `salary_prep_run_scope`.

- [ ] **Step 3: Confirm the double-pay guard**

Repeat the same call.
Expected: 409 `CC_ALREADY_IN_RUN`, naming the cost centres and the existing run.

- [ ] **Step 4: Check readiness sees only these 15**

`GET /api/payroll/runs/:id/readiness`.
Expected: blocker counts computed over 15 employees; no employee from NOIDA, NOIDA-2 or AHMEDABAD appears in any sample.

- [ ] **Step 5: Calculate, then verify the line count and stamps**

```sql
SELECT COUNT(*) lines,
       COUNT(DISTINCT cost_centre_id) ccs,
       SUM(branch_id IS NULL) unstamped
  FROM salary_prep_line WHERE run_id = '<run id>';
```
Expected: `lines = 15`, `ccs = 4`, `unstamped = 0`.

- [ ] **Step 6: Verify the register**

Export the salary sheet for the run.
Expected: exactly 15 rows; every `CostCenter` value is one of the four; no other branch appears.

- [ ] **Step 7: Verify coverage refuses to call the month complete**

`GET /api/payroll/runs/coverage?month=2026-08`.
Expected: `complete: false`; NOIDA, NOIDA-2 and AHMEDABAD cost centres listed `not_started`; the 2 employees with no cost centre listed as uncovered with a reason.

- [ ] **Step 8: Record the results**

Write the actual figures — not "as expected" — into the plan file under this task, and report them.

---

## Self-review

**Spec coverage:** data model → Task 1; employee selection → Tasks 3, 4; line stamp → Task 5; run creation, authority and scope-guard fix → Task 6; coverage gate → Task 7; consolidated outputs → Task 8; register → Task 9; picker → Task 10; coverage panel → Task 11; HEAD OFFICE verification → Task 12. Name-collision fix is covered by Tasks 3 and 4 and asserted in both. No spec section is unimplemented.

**Placeholders:** none. Every code step carries the code; every test step carries the test and the exact command.

**Type consistency:** `resolveCostCentreScope`, `assertCostCentresFree`, `insertRunScope`, `ScopeError` (Task 2) are used with those exact names in Task 6. `getMonthCoverage` (Task 7) is consumed by `useMonthCoverage` (Task 11) and by the picker (Task 10). `branchState`/`toggleBranch` (Task 10) match between the test and the implementation. `scope_kind` values `'company'`/`'scoped'` are identical in Tasks 1, 3, 4 and 6.
