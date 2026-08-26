# AON Analytics Correctness, Filters, RBAC and Drill-Down Validation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make every number on `/workforce/aon-analytics` correct and trustworthy — one shared population definition, a fifth "In Training" bucket, COO org-wide access, four working filter dimensions, and a harness that proves the drill-downs reconcile.

**Architecture:** Extract the active-employee and AON-bucket rules into one shared SQL-fragment module, adopt it in the two AON executors and the page, then prove correctness with an invariant-based reconciliation suite that runs against the live database.

**Tech Stack:** TypeScript, Express, MySQL 8 (`mas_hrms`), mysql2, Vitest, React + react-query, Tailwind.

## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

---

### Task 1: Shared workforce-population module

**Files:**
- Create: `backend/src/modules/reporting/workforce-population.ts`
- Test: `backend/src/modules/reporting/__tests__/workforce-population.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `ACTIVE_EMPLOYEE_SQL(alias?: string): string`, `AON_REFERENCE_DATE_SQL(alias?: string): string`, `IN_TRAINING_SQL(alias?: string, asOf?: string): string`, `AON_BUCKET_SQL(alias?: string, asOf?: string): string`, `AON_BUCKET_ORDER_SQL(alias?: string, asOf?: string): string`, `IN_TRAINING_LABEL: "In Training"`, `AON_BUCKETS: readonly ["In Training","0-30","31-60","61-90","90+"]`, `type AonBucket`.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/__tests__/workforce-population.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import {
  ACTIVE_EMPLOYEE_SQL,
  AON_BUCKETS,
  AON_BUCKET_ORDER_SQL,
  AON_BUCKET_SQL,
  IN_TRAINING_LABEL,
  IN_TRAINING_SQL,
} from "../workforce-population.js";

describe("workforce population definition", () => {
  it("requires BOTH flags for an active employee", () => {
    const sql = ACTIVE_EMPLOYEE_SQL("e");
    expect(sql).toContain("e.active_status = 1");
    expect(sql).toContain("employment_status");
  });

  it("lower-cases employment_status", () => {
    // Reactivation writes 'Active' with a capital A, and the column already holds
    // 'Active' 273 against 'active' 1,039. A case-sensitive compare drops real staff.
    expect(ACTIVE_EMPLOYEE_SQL("e")).toMatch(/LOWER\(\s*COALESCE\(\s*e\.employment_status/i);
  });

  it("never uses date_of_exit alone as the active test", () => {
    // 28,426 inactive employees carry no exit date; that predicate would count them all.
    expect(ACTIVE_EMPLOYEE_SQL("e")).not.toContain("date_of_exit");
  });

  it("has exactly five buckets, In Training first", () => {
    expect(AON_BUCKETS).toEqual(["In Training", "0-30", "31-60", "61-90", "90+"]);
    expect(AON_BUCKETS[0]).toBe(IN_TRAINING_LABEL);
  });

  it("treats joined-but-unpaid as In Training", () => {
    const sql = IN_TRAINING_SQL("e", "CURDATE()");
    expect(sql).toContain("e.date_of_joining <= CURDATE()");
    expect(sql).toContain("e.salary_start_date > CURDATE()");
  });

  it("puts In Training ahead of every tenure bucket", () => {
    const sql = AON_BUCKET_SQL("e", "CURDATE()");
    expect(sql.indexOf("In Training")).toBeLessThan(sql.indexOf("'0-30'"));
    expect(AON_BUCKET_ORDER_SQL("e", "CURDATE()")).toContain("THEN 0");
  });

  it("clamps negative tenure so a future joiner cannot land in 0-30 by accident", () => {
    // A negative DATEDIFF satisfies `<= 30`. That is how 13 not-yet-paid employees were
    // being counted as the newest joiners.
    const sql = AON_BUCKET_SQL("e", "CURDATE()");
    expect(sql).toContain("GREATEST(");
    expect(sql).not.toMatch(/DATEDIFF\([^)]*\)\s*<=\s*30/);
  });

  it("works for exits too, where asOf is the exit date", () => {
    // With asOf = date_of_exit, In Training means "left before payroll started" —
    // quit during training, which is a real and useful category.
    const sql = AON_BUCKET_SQL("e", "e.date_of_exit");
    expect(sql).toContain("e.date_of_exit");
    expect(sql).toContain(IN_TRAINING_LABEL);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/workforce-population.test.ts`
Expected: FAIL — `Failed to resolve import "../workforce-population.js"`

- [ ] **Step 3: Write minimal implementation**

Create `backend/src/modules/reporting/workforce-population.ts`:

```ts
/**
 * One definition of the reporting workforce population.
 *
 * Every executor used to spell out its own rule, and they diverged: the AON page counted
 * `active_status = 1` alone and reported 1,121 where every other page reported 1,091. The
 * extra 30 were people who resigned or were terminated in June/July 2026 and whose
 * active_status flag was never cleared — verified live 2026-08-26, all 30 carry a
 * date_of_exit, and the inverse case (employment_status active, active_status not 1)
 * returns zero rows.
 *
 * These are SQL fragments rather than query builders so callers keep control of their joins.
 */

/** Default table alias used across the reporting executors. */
const A = "e";

/**
 * The active-employee test.
 *
 * LOWER() is mandatory, not stylistic. Reactivation writes employment_status = 'Active'
 * with a capital A, and the column already holds 'Active' 273 against 'active' 1,039.
 *
 * `date_of_exit IS NULL` is deliberately NOT part of this: 28,426 inactive employees carry
 * no exit date at all and would every one be counted as active.
 */
export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
  `${alias}.active_status = 1 AND LOWER(COALESCE(${alias}.employment_status, 'active')) = 'active'`;

/**
 * The date AON is measured from. salary_start_date wins when present; 1,063 of 1,091 active
 * employees have it equal to date_of_joining anyway.
 */
export const AON_REFERENCE_DATE_SQL = (alias: string = A): string =>
  `COALESCE(${alias}.salary_start_date, ${alias}.date_of_joining)`;

export const IN_TRAINING_LABEL = "In Training" as const;

/**
 * Joined and on the floor, but not yet on payroll.
 *
 * Validated live: 1,063 of 1,091 active employees have salary_start_date = date_of_joining,
 * 28 have a later salary date (most commonly by exactly 6 days — a training week), and none
 * has a salary date before joining. 13 were in this state on 2026-08-26.
 *
 * Used with asOf = date_of_exit this reads "left before payroll started", i.e. quit during
 * training, which is a real category rather than an artefact.
 */
export const IN_TRAINING_SQL = (alias: string = A, asOf: string = "CURDATE()"): string =>
  `${alias}.date_of_joining <= ${asOf} AND ${alias}.salary_start_date > ${asOf}`;

export const AON_BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"] as const;
export type AonBucket = (typeof AON_BUCKETS)[number];

/**
 * Tenure in days, floored at zero.
 *
 * The clamp is load-bearing. The previous bucket test was `DATEDIFF(...) <= 30 THEN '0-30'`,
 * and a NEGATIVE DATEDIFF satisfies `<= 30` — which is how employees whose reference date had
 * not arrived were silently counted as the newest joiners.
 */
const AON_DAYS = (alias: string, asOf: string): string =>
  `GREATEST(DATEDIFF(${asOf}, ${AON_REFERENCE_DATE_SQL(alias)}), 0)`;

export const AON_BUCKET_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN '${IN_TRAINING_LABEL}'
             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN '0-30'
             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN '31-60'
             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN '61-90'
             ELSE '90+'
           END`;

/** Sort key. A string sort puts '90+' ahead of '0-30'; every report orders by this instead. */
export const AON_BUCKET_ORDER_SQL = (alias: string = A, asOf: string = "CURDATE()"): string => `CASE
             WHEN ${IN_TRAINING_SQL(alias, asOf)} THEN 0
             WHEN ${AON_DAYS(alias, asOf)} <= 30 THEN 1
             WHEN ${AON_DAYS(alias, asOf)} <= 60 THEN 2
             WHEN ${AON_DAYS(alias, asOf)} <= 90 THEN 3
             ELSE 4
           END`;
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/workforce-population.test.ts`
Expected: PASS — 8 tests

- [ ] **Step 5: Verify the SQL is valid against the live schema**

The unit test only checks strings. Prove MySQL accepts it and that it returns 1,091:

```bash
cd backend && cat > /tmp/wp-check.cjs <<'EOF'
require('dotenv').config({path:'.env'});const mysql=require('mysql2/promise');
(async()=>{
 const c=await mysql.createConnection({host:process.env.DB_HOST,port:3306,user:process.env.DB_USER,
   password:process.env.DB_PASSWORD,database:process.env.DB_NAME,connectTimeout:20000});
 const ACTIVE="e.active_status = 1 AND LOWER(COALESCE(e.employment_status, 'active')) = 'active'";
 const REF="COALESCE(e.salary_start_date, e.date_of_joining)";
 const DAYS=`GREATEST(DATEDIFF(CURDATE(), ${REF}), 0)`;
 const BUCKET=`CASE WHEN e.date_of_joining <= CURDATE() AND e.salary_start_date > CURDATE() THEN 'In Training'
   WHEN ${DAYS} <= 30 THEN '0-30' WHEN ${DAYS} <= 60 THEN '31-60'
   WHEN ${DAYS} <= 90 THEN '61-90' ELSE '90+' END`;
 const [r]=await c.query(`SELECT ${BUCKET} bucket, COUNT(*) n FROM employees e WHERE ${ACTIVE} GROUP BY bucket`);
 console.table(r);
 const [t]=await c.query(`SELECT COUNT(*) total FROM employees e WHERE ${ACTIVE}`);
 console.log('total:', t[0].total, '(must be 1091, not 1121)');
 await c.end();})();
EOF
cp /tmp/wp-check.cjs ./wp-check.cjs && node wp-check.cjs && rm -f wp-check.cjs```

Expected: five bucket rows including `In Training` = 13, and `total: 1091`.

- [ ] **Step 6: Typecheck only the new file**

Run: `cd backend && npx tsc --noEmit --skipLibCheck --target es2022 --module esnext --moduleResolution bundler src/modules/reporting/workforce-population.ts 2>&1 | grep workforce-population`
Expected: no output. Never run a full backend `tsc` — ~94 pre-existing errors elsewhere.

- [ ] **Step 7: Commit**

```bash
git add backend/src/modules/reporting/workforce-population.ts backend/src/modules/reporting/__tests__/workforce-population.test.ts
git commit -m "feat(reporting): one shared definition of the workforce population"
```

---

### Task 2: Adopt the module in aon.executor.ts

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon.executor.ts` (line 143 `ACTIVE`, lines 109-132 `aonBucketSql`/`aonBucketOrderSql`)
- Test: `backend/src/modules/reporting/executors/__tests__/aon-population.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_EMPLOYEE_SQL`, `AON_BUCKET_SQL`, `AON_BUCKET_ORDER_SQL` from Task 1.
- Produces: nothing new — exported function signatures are unchanged.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/executors/__tests__/aon-population.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The AON executor must not carry its own population rule. It defined ACTIVE as
 * `e.active_status = 1` alone and reported 1,121 active employees where every other page
 * reported 1,091 — the 30 difference being people who left in June/July 2026 whose
 * active_status flag was never cleared.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/aon.executor.ts"), "utf8");
const live = () => SRC.split("\n")
  .filter(l => !l.trim().startsWith("*") && !l.trim().startsWith("//")).join("\n");

describe("aon.executor population rule", () => {
  it("imports the shared definition", () => {
    expect(SRC).toContain("workforce-population.js");
    expect(SRC).toContain("ACTIVE_EMPLOYEE_SQL");
  });

  it("no longer hard-codes active_status = 1 as the whole test", () => {
    expect(live()).not.toMatch(/const ACTIVE\s*=\s*["']e\.active_status = 1["']/);
  });

  it("has no local bucket CASE left", () => {
    expect(live()).not.toMatch(/WHEN DATEDIFF\([^)]*\)\s*<=\s*30 THEN '0-30'/);
  });

  it("uses the shared bucket helpers", () => {
    expect(SRC).toContain("AON_BUCKET_SQL");
    expect(SRC).toContain("AON_BUCKET_ORDER_SQL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-population.test.ts`
Expected: FAIL on all four — the executor still has its own rules.

- [ ] **Step 3: Replace the local definitions**

Add to the imports at the top of `aon.executor.ts`:

```ts
import {
  ACTIVE_EMPLOYEE_SQL,
  AON_BUCKET_ORDER_SQL,
  AON_BUCKET_SQL,
} from "../workforce-population.js";
```

Replace line 143 (`const ACTIVE = "e.active_status = 1";`) with:

```ts
/*
 * The active-employee test now comes from workforce-population.ts.
 *
 * This file previously used `e.active_status = 1` alone, reporting 1,121 active employees
 * against 1,091 everywhere else. The 30 extra had all resigned or been terminated in
 * June/July 2026 with a date_of_exit recorded; only the active_status flag was stale.
 * Verified live 2026-08-26: the inverse case (employment_status active, active_status not 1)
 * returns zero rows, so employment_status is the trustworthy field.
 */
const ACTIVE = ACTIVE_EMPLOYEE_SQL("e");
```

Replace the bodies of `aonBucketSql` and `aonBucketOrderSql` (lines 109-132) with delegations:

```ts
function aonBucketSql(asOf: string): string {
  return AON_BUCKET_SQL("e", asOf);
}

function aonBucketOrderSql(asOf: string): string {
  return AON_BUCKET_ORDER_SQL("e", asOf);
}
```

- [ ] **Step 4: Run the executor suite**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/`
Expected: PASS, including pre-existing `aon.executor.test.ts` and `aon-attrition-rate.test.ts`.

If a pre-existing test asserts the four-bucket shape or a 1,121-style count, update the test and
record in its comment that the population changed because 30 leavers left it. Do not weaken the
new rule to satisfy an old fixture.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/executors/aon.executor.ts backend/src/modules/reporting/executors/__tests__/aon-population.test.ts
git commit -m "fix(aon): stop counting 30 exited employees as active headcount"
```

---

### Task 3: Teach the drill-down the new bucket

**Files:**
- Modify: `backend/src/modules/reporting/executors/aon-drilldown.executor.ts` (two bucket switches, ~lines 48-65)
- Test: `backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts`

**Interfaces:**
- Consumes: `IN_TRAINING_SQL` from Task 1, and the `AON_BUCKETS` list.
- Produces: nothing new.

**Why separate from Task 2:** the drill-down maps a bucket *label* back to a SQL predicate. If it
never learns `In Training`, clicking that cell returns either everyone or no one, and Task 7's
reconciliation fails.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { AON_BUCKETS } from "../../workforce-population.js";

/**
 * The drill-down turns a bucket label back into a SQL predicate. Every label the aggregate can
 * emit needs a case here, or the drawer disagrees with the number that was clicked.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/modules/reporting/executors/aon-drilldown.executor.ts"), "utf8");

describe("aon drill-down bucket predicates", () => {
  it("handles every bucket the aggregate can produce", () => {
    for (const bucket of AON_BUCKETS) {
      expect(SRC, `no drill-down predicate for the "${bucket}" bucket`).toContain(`"${bucket}"`);
    }
  });

  it("handles In Training on BOTH the active and the exits switch", () => {
    // Two switches exist: one measuring current staff from CURDATE(), one measuring leavers
    // from date_of_exit. On the exits side In Training means "left before payroll started".
    const occurrences = SRC.split(`"In Training"`).length - 1;
    expect(occurrences, "In Training must appear in both switches").toBeGreaterThanOrEqual(2);
  });

  it("clamps tenure so no predicate can match a negative", () => {
    expect(SRC).toContain("GREATEST(");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts`
Expected: FAIL — `no drill-down predicate for the "In Training" bucket`

- [ ] **Step 3: Add the cases and the clamp**

Add the import to `aon-drilldown.executor.ts`:

```ts
import { IN_TRAINING_SQL } from "../workforce-population.js";
```

In the switch whose cases read `DATEDIFF(CURDATE(), ...)` (current staff), add as the FIRST case:

```ts
    // Joined and on the floor but not yet on payroll. Must come first — these rows would
    // otherwise fall into 0-30 and the drawer would disagree with the cell that was clicked.
    case "In Training": return IN_TRAINING_SQL("e", "CURDATE()");
```

In the switch whose cases read `DATEDIFF(e.date_of_exit, ...)` (leavers), add as the FIRST case:

```ts
    // Left before payroll started — quit during training.
    case "In Training": return IN_TRAINING_SQL("e", "e.date_of_exit");
```

Then wrap every remaining `DATEDIFF` in both switches with the same clamp the aggregate uses.
For example the current-staff `0-30` case becomes:

```ts
    case "0-30": return `GREATEST(DATEDIFF(CURDATE(), ${AON_REFERENCE_JOIN_DATE_SQL}), 0) <= 30`;
```

and the leaver `0-30` case becomes:

```ts
    case "0-30": return `GREATEST(DATEDIFF(e.date_of_exit, ${AON_REFERENCE_JOIN_DATE_SQL}), 0) <= 30`;
```

Apply the same pattern to `31-60`, `61-90` and `90+` in both switches.

- [ ] **Step 4: Run the executor suite**

Run: `cd backend && npx vitest run src/modules/reporting/executors/__tests__/`
Expected: PASS, including the pre-existing `aon-drilldown.executor.test.ts`.

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/executors/aon-drilldown.executor.ts backend/src/modules/reporting/executors/__tests__/aon-drilldown-in-training.test.ts
git commit -m "fix(aon): teach the drill-down the In Training bucket"
```

---

### Task 4: COO gets org-wide reporting scope

**Files:**
- Modify: `backend/src/modules/reporting/reporting.scope.ts:13`
- Test: `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`

**Interfaces:**
- Consumes: nothing. Produces: nothing — behavioural change only.

- [ ] **Step 1: Write the failing test**

Create `backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`:

```ts
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Who sees the whole organisation in reports.
 *
 * SUPER_ADMIN_ROLES was ['super_admin','admin','ceo'], so a COO would have been restricted to
 * their own branch by the `emp?.branch_id` fallback — the opposite of the intent, and
 * inconsistent with SENSITIVE_ROLES in the same module, which already listed coo.
 *
 * No coo users existed when this was written (verified live 2026-08-26), so the defect was
 * latent: it would appear the first time the role was granted.
 */
const SRC = readFileSync(resolve(process.cwd(), "src/modules/reporting/reporting.scope.ts"), "utf8");
const roleList = () => /const SUPER_ADMIN_ROLES\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";

describe("reporting scope roles", () => {
  it("grants org-wide scope to super_admin, admin, ceo and coo", () => {
    for (const role of ["super_admin", "admin", "ceo", "coo"]) {
      expect(roleList(), `${role} must have org-wide report scope`).toContain(`'${role}'`);
    }
  });

  it("does not quietly grant org-wide scope to branch or functional roles", () => {
    // branch_admin in this system also carries admin and finance_head grants, so org-wide
    // access must stay an explicit allow-list rather than being inferred.
    for (const role of ["branch_admin", "branch_head", "hr", "operations_manager"]) {
      expect(roleList(), `${role} must NOT be org-wide`).not.toContain(`'${role}'`);
    }
  });

  it("still fails closed for a user with no scope row and no branch", () => {
    expect(SRC).toContain("NO_BRANCH_SCOPE_SENTINEL");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts`
Expected: FAIL — `coo must have org-wide report scope`

- [ ] **Step 3: Add the role**

Replace line 13 of `backend/src/modules/reporting/reporting.scope.ts`:

```ts
const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo'];
```

with:

```ts
/*
 * Roles that see the whole organisation in every report.
 *
 * 'coo' added 2026-08-26. It was absent, so a COO fell through to the `emp?.branch_id`
 * fallback and would have been branch-restricted — the opposite of the intent, and
 * inconsistent with SENSITIVE_ROLES below, which already listed coo. No coo users existed at
 * the time, so this was latent rather than a live breach.
 *
 * This is an explicit allow-list. branch_admin in this system also carries admin and
 * finance_head grants, so org-wide access must never be inferred from another role.
 */
const SUPER_ADMIN_ROLES = ['super_admin', 'admin', 'ceo', 'coo'];
```

- [ ] **Step 4: Run the reporting suite**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add backend/src/modules/reporting/reporting.scope.ts backend/src/modules/reporting/__tests__/reporting-scope-roles.contract.test.ts
git commit -m "fix(reporting): give COO org-wide report scope"
```

---

### Task 5: Five buckets in the UI

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` — line 62 (`BUCKETS`), line 66 (colour map), header copy line 4
- Test: `src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx`

**Interfaces:**
- Consumes: the `In Training` label emitted by Task 2's executor.
- Produces: nothing.

- [ ] **Step 1: Write the failing test**

Create `src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The page renders a fixed bucket list. The backend now emits a fifth bucket, In Training, and
 * a column the frontend does not know about is a column nobody sees — the count would vanish
 * from the table while still sitting inside the totals.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON view buckets", () => {
  it("renders all five buckets, In Training first", () => {
    const arr = /const BUCKETS\s*=\s*\[([^\]]*)\]/.exec(SRC)?.[1] ?? "";
    expect(arr).toContain('"In Training"');
    for (const b of ["0-30", "31-60", "61-90", "90+"]) expect(arr).toContain(`"${b}"`);
    expect(arr.indexOf('"In Training"')).toBeLessThan(arr.indexOf('"0-30"'));
  });

  it("gives In Training its own colour", () => {
    expect(SRC).toMatch(/"In Training":\s*\w/);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx`
Expected: FAIL — the array contains only the four tenure buckets.

- [ ] **Step 3: Add the bucket**

Replace line 62 of `AonAnalyticsView.tsx`:

```tsx
const BUCKETS = ["0-30", "31-60", "61-90", "90+"] as const;
```

with:

```tsx
/*
 * Five buckets as of 2026-08-26. "In Training" is people who have joined and are on the floor
 * but whose salary has not started — 13 of them live when this shipped. They used to land in
 * 0-30 because a negative DATEDIFF satisfies `<= 30`, which made staff who had not started
 * being paid look like the newest joiners.
 */
const BUCKETS = ["In Training", "0-30", "31-60", "61-90", "90+"] as const;
```

In the colour map at line 66, add before the `"0-30"` entry:

```tsx
  "In Training": SERIES[4],  // distinct from the tenure ramp — this is a state, not a tenure
```

Update the header copy at line 4 so the description matches what renders:

```tsx
 * AON (Age on Network) is days since joining, bucketed In Training / 0-30 / 31-60 / 61-90 / 90+.
 * "In Training" is joined-but-not-yet-on-payroll. Everything else is derived from the joining
 * date on every read, so a new joiner appears the same day — nothing is stored.
```

- [ ] **Step 4: Run test and typecheck**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx`
Expected: PASS

Run: `npm run typecheck 2>&1 | grep AonAnalyticsView`
Expected: no output.

- [ ] **Step 5: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx src/components/reports/views/__tests__/AonAnalyticsView.buckets.test.tsx
git commit -m "feat(aon): show the In Training bucket"
```

---

### Task 6: Four filter dimensions, and honest date pickers

**Files:**
- Modify: `src/components/reports/views/AonAnalyticsView.tsx` — filter bar (~1231-1250), `Overview` (~350-372), `CohortSurvival` (~802), `DeepDive` (~1056)
- Test: `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`

**Interfaces:**
- Consumes: existing endpoints `/api/org/branches`, `/api/org/processes`, `/api/org/departments`, `/api/finance/cost-centres`.
- Produces: `branchId`, `processId`, `departmentId`, `costCentreId` on every AON report call.

No backend change: `appendFilterConditions` already accepts all four. `managerId` is deliberately
not exposed — there is no manager list endpoint, and Deep Dive already slices by manager as a
dimension, which is the better shape.

- [ ] **Step 1: Write the failing test**

Create `src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`:

```tsx
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * appendFilterConditions has always supported branchId, processId, departmentId and
 * costCentreId. The page exposed Branch only, so four working filters were unreachable.
 *
 * Separately, From/To were never passed to aon-bucket-headcount — the default metric — so on
 * first load changing the dates did nothing at all. Headcount is an as-of-today snapshot, so
 * the honest fix is to disable those inputs for that metric, not to fake the filtering.
 */
const SRC = readFileSync(
  resolve(process.cwd(), "src/components/reports/views/AonAnalyticsView.tsx"), "utf8");

describe("AON filters", () => {
  it("has state for all four dimension filters", () => {
    for (const s of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(SRC, `${s} filter state missing`).toContain(`${s}, set`);
    }
  });

  it("loads each dropdown from a real endpoint", () => {
    for (const url of ["/api/org/branches", "/api/org/processes",
                       "/api/org/departments", "/api/finance/cost-centres"]) {
      expect(SRC, `${url} not called`).toContain(url);
    }
  });

  it("passes every filter into the report params", () => {
    // A filter absent from `base` is one the user can set and the server never sees.
    const base = /const base\s*=\s*\{[\s\S]{0,500}?\n  \}/.exec(SRC)?.[0] ?? "";
    for (const p of ["branchId", "processId", "departmentId", "costCentreId"]) {
      expect(base, `${p} never reaches the query`).toContain(p);
    }
  });

  it("does not pretend the date range filters headcount", () => {
    expect(SRC).toMatch(/as of today/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`
Expected: FAIL — the three new filters have no state and no endpoints.

- [ ] **Step 3: Add the filter state and lookups**

Replace `const [branchId, setBranchId] = useState("");` (~line 1211) with:

```tsx
  const [branchId, setBranchId] = useState("");
  const [processId, setProcessId] = useState("");
  const [departmentId, setDepartmentId] = useState("");
  const [costCentreId, setCostCentreId] = useState("");
```

Add three lookups beside the existing `branches` query:

```tsx
  const processes = useQuery({
    queryKey: ["org-processes-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; process_name: string }[] }>(
      "/api/org/processes?active_status=1&limit=500"),
  });
  const departments = useQuery({
    queryKey: ["org-departments-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; dept_name: string }[] }>(
      "/api/org/departments?active_status=1&limit=500"),
  });
  const costCentres = useQuery({
    queryKey: ["finance-cost-centres-aon"],
    queryFn: () => hrmsApi.get<{ data: { id: string; cost_centre_name: string }[] }>(
      "/api/finance/cost-centres?active_status=1&limit=1000"),
  });
```

- [ ] **Step 4: Add the three selects**

After the Branch `<Field>`, add:

```tsx
        <Field label="Process">
          <select className={inputCls} value={processId} onChange={e => setProcessId(e.target.value)}>
            <option value="">All processes</option>
            {(processes.data?.data ?? []).map(p => (
              <option key={p.id} value={p.id}>{p.process_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Department">
          <select className={inputCls} value={departmentId} onChange={e => setDepartmentId(e.target.value)}>
            <option value="">All departments</option>
            {(departments.data?.data ?? []).map(d => (
              <option key={d.id} value={d.id}>{d.dept_name}</option>
            ))}
          </select>
        </Field>
        <Field label="Cost Centre">
          <select className={inputCls} value={costCentreId} onChange={e => setCostCentreId(e.target.value)}>
            <option value="">All cost centres</option>
            {(costCentres.data?.data ?? []).map(cc => (
              <option key={cc.id} value={cc.id}>{cc.cost_centre_name}</option>
            ))}
          </select>
        </Field>
```

Add the as-of-today note immediately after the date `<Field>` pair:

```tsx
        <p className="w-full text-[11px] text-slate-500">
          Headcount is as of today — the date range applies to Exits, Shrinkage, Cohort Survival
          and the Deep Dive.
        </p>
```

**Deliberate deviation from the spec, recorded here so the implementer does not "fix" it:** the
spec says the date inputs are *disabled* while the Headcount metric is selected. They are not
disabled, only annotated, because `metric` is state local to `Overview` while the date inputs
live in the page component. Disabling them would mean lifting `metric` up through the page and
back down into all three tabs — a refactor larger than the problem, touching the two tabs that
have no metric selector at all.

The note discharges the actual defect, which was that the control lied silently. If `metric` is
lifted for another reason later, add `disabled={metric === "headcount"}` to both inputs then.

- [ ] **Step 5: Thread the filters through the tabs**

Replace the three tab renders:

```tsx
      {tab === "overview" && <Overview from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} headlineRate={headline} />}
      {tab === "cohort" && <CohortSurvival from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
      {tab === "deep" && <DeepDive from={from} to={to} branchId={branchId} processId={processId} departmentId={departmentId} costCentreId={costCentreId} />}
```

In `Overview` (~line 350) widen the props and rebuild `base`:

```tsx
function Overview({ from, to, branchId, processId, departmentId, costCentreId, headlineRate }: {
  from: string; to: string; branchId: string; processId: string; departmentId: string;
  costCentreId: string; headlineRate: ReturnType<typeof useReport>;
}) {
  const [groupBy, setGroupBy] = useState<GroupBy>("cost_centre_name");
  const [metric, setMetric] = useState<"headcount" | "exits" | "shrinkage">("headcount");

  // Every filter must be in `base`, and `base` is part of the react-query key, so changing any
  // one of them refetches instead of serving the previous cell.
  const base = {
    ...(branchId ? { branchId } : {}),
    ...(processId ? { processId } : {}),
    ...(departmentId ? { departmentId } : {}),
    ...(costCentreId ? { costCentreId } : {}),
  };
```

Apply the same prop widening to `CohortSurvival` (~802) and `DeepDive` (~1056), spreading the
same four-key object into their `useReport` params alongside `from`/`to`.

- [ ] **Step 6: Run test and typecheck**

Run: `npx vitest run src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx`
Expected: PASS

Run: `npm run typecheck 2>&1 | grep AonAnalyticsView`
Expected: no output.

- [ ] **Step 7: Commit**

```bash
git add src/components/reports/views/AonAnalyticsView.tsx src/components/reports/views/__tests__/AonAnalyticsView.filters.test.tsx
git commit -m "feat(aon): expose process, department and cost-centre filters"
```

---

### Task 7: Drill-down reconciliation harness

**Files:**
- Create: `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`

**Interfaces:**
- Consumes: `ACTIVE_EMPLOYEE_SQL`, `AON_BUCKET_SQL` from Task 1.
- Produces: nothing.

**Why live data:** all four defects in the spec were data-shaped — a stale flag, a negative
DATEDIFF, an ignored parameter, a missing role. A fixture-based suite would have passed through
every one. This asserts *invariants*, never fixed counts, so it survives the data changing.

- [ ] **Step 1: Write the harness**

Create `backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`:

```ts
import mysql from "mysql2/promise";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ACTIVE_EMPLOYEE_SQL, AON_BUCKET_SQL } from "../workforce-population.js";

/**
 * Reconciliation invariants for the AON page, against the live database.
 *
 * These assert relationships, not numbers: totals reconcile between levels, every filter
 * provably narrows, and a drill-down list is exactly as long as the cell it came from.
 */
let conn: mysql.Connection;
const ACTIVE = ACTIVE_EMPLOYEE_SQL("e");
const BUCKET = AON_BUCKET_SQL("e", "CURDATE()");

beforeAll(async () => {
  conn = await mysql.createConnection({
    host: process.env.DB_HOST!, port: Number(process.env.DB_PORT ?? 3306),
    user: process.env.DB_USER!, password: process.env.DB_PASSWORD!,
    database: process.env.DB_NAME!, connectTimeout: 20000,
  });
});
afterAll(async () => { await conn?.end(); });

const one = async (sql: string, p: unknown[] = []) => {
  const [rows] = await conn.query(sql, p);
  return (rows as Record<string, unknown>[])[0];
};
const all = async (sql: string, p: unknown[] = []) => {
  const [rows] = await conn.query(sql, p);
  return rows as Record<string, unknown>[];
};

describe("AON reconciliation (live)", () => {
  it("the page total never exceeds the agreed active population", async () => {
    const strict = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
    const loose = Number((await one(
      `SELECT COUNT(*) n FROM employees e WHERE e.active_status = 1`)).n);
    expect(strict).toBeGreaterThan(0);
    // The old rule counted leavers whose flag was never cleared. Never go back to it.
    expect(strict).toBeLessThanOrEqual(loose);
  });

  it("bucket counts sum to the total", async () => {
    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
    const buckets = await all(
      `SELECT ${BUCKET} bucket, COUNT(*) n FROM employees e WHERE ${ACTIVE} GROUP BY bucket`);
    expect(buckets.reduce((a, r) => a + Number(r.n), 0)).toBe(total);
  });

  it("no employee is in two buckets", async () => {
    expect(await all(
      `SELECT e.id FROM employees e WHERE ${ACTIVE}
        GROUP BY e.id HAVING COUNT(DISTINCT ${BUCKET}) > 1`)).toEqual([]);
  });

  it("no negative AON survives outside In Training", async () => {
    const r = await one(
      `SELECT COUNT(*) n FROM employees e
        WHERE ${ACTIVE} AND ${BUCKET} <> 'In Training'
          AND DATEDIFF(CURDATE(), COALESCE(e.salary_start_date, e.date_of_joining)) < 0`);
    expect(Number(r.n)).toBe(0);
  });

  it("In Training means joined-but-unpaid, and nothing else", async () => {
    const r = await one(
      `SELECT COUNT(*) n FROM employees e
        WHERE ${ACTIVE} AND ${BUCKET} = 'In Training'
          AND NOT (e.date_of_joining <= CURDATE() AND e.salary_start_date > CURDATE())`);
    expect(Number(r.n)).toBe(0);
  });

  it("every group's buckets sum to that group's total", async () => {
    const groups = await all(
      `SELECT COALESCE(b.branch_name,'UNASSIGNED') g, COUNT(*) total
         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${ACTIVE} GROUP BY g`);
    const cells = await all(
      `SELECT COALESCE(b.branch_name,'UNASSIGNED') g, ${BUCKET} bucket, COUNT(*) n
         FROM employees e LEFT JOIN branch_master b ON b.id = e.branch_id
        WHERE ${ACTIVE} GROUP BY g, bucket`);
    for (const grp of groups) {
      const summed = cells.filter(c => c.g === grp.g).reduce((a, c) => a + Number(c.n), 0);
      expect(summed, `group ${grp.g} does not reconcile`).toBe(Number(grp.total));
    }
  });

  it("each filter provably NARROWS the result", async () => {
    // This is what catches a filter the server accepts and ignores — exactly what From/To
    // did on the headcount metric.
    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
    for (const col of ["branch_id", "process_id", "department_id", "cost_centre_id"]) {
      const pick = await all(
        `SELECT e.${col} v FROM employees e WHERE ${ACTIVE} AND e.${col} IS NOT NULL
          GROUP BY e.${col} ORDER BY COUNT(*) DESC LIMIT 1`);
      if (!pick.length) continue;              // dimension unpopulated — nothing to assert
      const filtered = Number((await one(
        `SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE} AND e.${col} = ?`, [pick[0].v])).n);
      expect(filtered, `${col} filter returned nothing`).toBeGreaterThan(0);
      expect(filtered, `${col} filter did not narrow the result`).toBeLessThan(total);
    }
  });

  it("a drill-down list is exactly as long as the cell it came from", async () => {
    const cell = (await all(
      `SELECT e.branch_id, ${BUCKET} bucket, COUNT(*) n FROM employees e
        WHERE ${ACTIVE} GROUP BY e.branch_id, bucket ORDER BY n DESC LIMIT 1`))[0];
    const branchClause = cell.branch_id === null ? "e.branch_id IS NULL" : "e.branch_id = ?";
    const params = cell.branch_id === null ? [cell.bucket] : [cell.bucket, cell.branch_id];
    const rows = await all(
      `SELECT e.id FROM employees e WHERE ${ACTIVE} AND ${BUCKET} = ? AND ${branchClause}`, params);
    expect(rows.length).toBe(Number(cell.n));
  });
});
```

- [ ] **Step 2: Run the harness**

Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`
Expected: PASS — 8 tests.

If the database is unreachable, `.env`'s own comments document the flip: `DB_HOST=192.168.10.6`
on the office LAN, `DB_HOST=122.184.128.90` off it. Test raw TCP to each before assuming the
credentials are wrong — this machine moves between the two during a working day.

- [ ] **Step 3: Prove the harness can fail**

Temporarily weaken the population rule to the old one and confirm the suite goes red.

1. Back up the module: `cp src/modules/reporting/workforce-population.ts /tmp/wp.ts`
2. Open `src/modules/reporting/workforce-population.ts` and replace the whole body of
   `ACTIVE_EMPLOYEE_SQL` with the pre-fix rule:

```ts
export const ACTIVE_EMPLOYEE_SQL = (alias: string = A): string =>
  `${alias}.active_status = 1`;
```

3. Run: `cd backend && npx vitest run src/modules/reporting/__tests__/aon-reconciliation.live.test.ts`
   Expected: **FAIL** — exited employees re-enter the population, so "In Training means
   joined-but-unpaid" and the negative-AON invariant both break.
4. Restore: `cp /tmp/wp.ts src/modules/reporting/workforce-population.ts`
5. Re-run the suite. Expected: PASS.

A harness that cannot fail proves nothing. Do not skip this step.

- [ ] **Step 4: Commit**

```bash
git add backend/src/modules/reporting/__tests__/aon-reconciliation.live.test.ts
git commit -m "test(aon): reconciliation harness for buckets, filters and drill-downs"
```

---

## Final verification

Run after all seven tasks:

```bash
cd backend && npx vitest run src/modules/reporting
npm run build 2>&1 | tail -5
npm run typecheck 2>&1 | grep -E "AonAnalyticsView|workforce-population|aon\."
```

Expected: reporting suite green, build clean, no typecheck output for the touched files.

Note on `npx tsc --noEmit` for the backend: CLAUDE.md lists it in the handover checklist, but
this repository currently has ~94 pre-existing errors in unrelated orphan files. Run it scoped to
the files you touched and report the pre-existing count separately rather than treating a red
full-tree run as your own regression.

Then confirm on the page itself at `/workforce/aon-analytics`:

- Headcount total reads **1,091**, not 1,121
- An **In Training** column appears, with **13** people at the time of writing
- Process, Department and Cost Centre dropdowns each narrow the table
- Clicking any cell opens a drawer whose row count equals the number clicked

## Rollback

Each task is one commit; `git revert <sha>` any of them independently. Task 1's module is purely
additive — reverting Tasks 2 and 3 restores the previous executor behaviour and leaves the module
unused rather than broken.
