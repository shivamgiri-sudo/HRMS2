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
  it("the active population is non-empty", async () => {
    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
    expect(total).toBeGreaterThan(0);
  });

  // The previous version of this test compared the strict ACTIVE_EMPLOYEE_SQL count against
  // a hard-coded `active_status = 1` baseline with `toBeLessThanOrEqual`. That baseline IS the
  // pre-fix rule, so weakening ACTIVE_EMPLOYEE_SQL back to it collapses the assertion to
  // `x <= x` — always true, regardless of how wrong the rule is. Proven live 2026-08-26: with
  // the rule weakened, the suite stayed green at 8/8.
  //
  // The two invariants below replace it. They don't compare the rule against itself; they
  // assert a property the correct rule must have and the weakened rule provably violates: the
  // 30 employees the weakened rule re-admits are people who already resigned or were
  // terminated, so "active" and "already left" can never overlap.
  // Verified live 2026-08-27: even under the CORRECT rule, a handful of employees carry a
  // stale-but-unrelated date_of_exit despite a legitimate employment_status = 'active' (their
  // employment_status was correctly reset, but date_of_exit was not cleared alongside it — a
  // separate, already-tracked data-quality defect, not the ACTIVE_EMPLOYEE_SQL regression this
  // harness targets). A hard `toBe(0)` here would make this test permanently red for a reason
  // that has nothing to do with the rule under test, so this asserts a RATIO instead: the
  // weakened rule doesn't add a handful, it dumps back in every recent leaver whose flag was
  // never cleared, which moves this count by multiples, not by one or two more strays.
  it("almost nobody in the active population has already left", async () => {
    const total = Number((await one(`SELECT COUNT(*) n FROM employees e WHERE ${ACTIVE}`)).n);
    const left = Number((await one(
      `SELECT COUNT(*) n FROM employees e
        WHERE ${ACTIVE} AND e.date_of_exit IS NOT NULL AND e.date_of_exit < CURDATE()`)).n);
    expect(left, "recent-leavers-still-marked-active grew far past the known baseline noise")
      .toBeLessThan(total * 0.02);
  });

  it("no employee in the active population has a non-active employment_status", async () => {
    const r = await one(
      `SELECT COUNT(*) n FROM employees e
        WHERE ${ACTIVE} AND e.employment_status IS NOT NULL
          AND LOWER(e.employment_status) <> 'active'`);
    expect(Number(r.n)).toBe(0);
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
