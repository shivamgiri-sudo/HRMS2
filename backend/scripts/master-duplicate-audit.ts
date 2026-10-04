/**
 * Master duplicate audit. READ-ONLY.
 *
 * For each master table, lists names held by more than one row (case/whitespace-insensitive),
 * with each row's id, active flag and how many employees point at it, so a merge can be planned.
 *
 *   npx tsx scripts/master-duplicate-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const q = async (sql: string) => (await db.execute<RowDataPacket[]>(sql))[0];

// table, name column, employees FK column (null = no direct employees FK)
const MASTERS: Array<[string, string, string | null]> = [
  ["department_master", "dept_name", "department_id"],
  ["branch_master", "branch_name", "branch_id"],
  ["process_master", "process_name", "process_id"],
  ["designation_master", "designation_name", "designation_id"],
  ["cost_centre_master", "cost_centre_name", "cost_centre_id"],
];

(async () => {
  for (const [table, nameCol, fk] of MASTERS) {
    try {
      const empCnt = fk
        ? `(SELECT COUNT(*) FROM employees e WHERE e.${fk} = m.id)`
        : "NULL";
      const rows = (await q(
        `SELECT m.id, m.${nameCol} AS name, UPPER(TRIM(m.${nameCol})) AS norm,
                ${empCnt} AS employees
           FROM ${table} m
          WHERE UPPER(TRIM(m.${nameCol})) IN (
                SELECT UPPER(TRIM(${nameCol})) FROM ${table}
                 GROUP BY UPPER(TRIM(${nameCol})) HAVING COUNT(*) > 1)
          ORDER BY norm, employees DESC`)) as any[];
      const total = (await q(`SELECT COUNT(*) c FROM ${table}`) as any[])[0].c;
      const groups = new Set(rows.map((r) => r.norm)).size;
      console.log(`\n== ${table}: ${total} rows, ${groups} duplicated names (${rows.length} rows) ==`);
      if (rows.length) console.table(rows);
    } catch (e: any) {
      console.log(`\n== ${table}: skipped (${e.code ?? e.message}) ==`);
    }
  }
  process.exit(0);
})();
