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
