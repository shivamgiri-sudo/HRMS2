## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

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

