## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

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

