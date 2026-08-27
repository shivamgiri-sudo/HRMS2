## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

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

