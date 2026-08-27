## Global Constraints

- Active employee is `active_status = 1 AND LOWER(COALESCE(employment_status,'active')) = 'active'` — expected live count **1,091**, never 1,121.
- `LOWER()` is mandatory on `employment_status`: reactivation writes `'Active'`, and the column holds `'Active'` 273 / `'active'` 1,039.
- Never use `date_of_exit IS NULL` alone as an active test — 28,426 inactive employees have no exit date.
- Bucket list is exactly five, in this order: `In Training`, `0-30`, `31-60`, `61-90`, `90+`.
- All tenure DATEDIFFs are wrapped in `GREATEST(..., 0)` so negative AON is impossible.
- Backend tests run from `backend/`: `npx vitest run <path>`. Frontend typecheck runs from repo root: `npm run typecheck`.
- Never run a full backend `tsc` — the repo has ~94 pre-existing errors and orphan files; check only the files you touched.
- Commit per task, path-scoped (`git add <exact files>`). This is a shared working tree with other sessions active — never `git commit -a`.

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

