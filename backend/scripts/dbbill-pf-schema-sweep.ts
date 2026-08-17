/** READ-ONLY. Sweeps db_bill's information_schema for every table/column that might carry PF
 * applicability, opt-out, or exclusion information — not just salary_data.PFELig, which is the
 * only column used so far. Mirrors the "enumerate every table carrying the column" technique
 * that found masjclrentry for the bank-account recovery (a hand-picked-table search missed it). */
import { getBillPool, closeBillPool } from "../src/db/billDb.js";

async function main() {
  const pool = await getBillPool();

  const [cols] = await pool.query<any[]>(
    `SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE
       FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE()
        AND (COLUMN_NAME LIKE '%PF%' OR COLUMN_NAME LIKE '%pf%'
             OR COLUMN_NAME LIKE '%opt%' OR COLUMN_NAME LIKE '%exempt%'
             OR COLUMN_NAME LIKE '%exclu%')
      ORDER BY TABLE_NAME, COLUMN_NAME`,
  );
  console.log(`Columns matching PF/opt/exempt/exclude across all of db_bill: ${cols.length}\n`);
  const byTable = new Map<string, string[]>();
  for (const c of cols as Array<{ TABLE_NAME: string; COLUMN_NAME: string; DATA_TYPE: string }>) {
    const list = byTable.get(c.TABLE_NAME) ?? [];
    list.push(`${c.COLUMN_NAME} (${c.DATA_TYPE})`);
    byTable.set(c.TABLE_NAME, list);
  }
  for (const [table, columns] of byTable) {
    console.log(`${table}: ${columns.join(", ")}`);
  }

  // Row counts for each candidate table, so empty ones can be ruled out fast.
  console.log("\n--- Row counts ---");
  for (const table of byTable.keys()) {
    try {
      const [rows] = await pool.query<any[]>(`SELECT COUNT(*) AS c FROM \`${table}\``);
      console.log(`  ${table}: ${rows[0].c} rows`);
    } catch (err) {
      console.log(`  ${table}: ERROR ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

main()
  .catch((err) => { console.error("FATAL", err); process.exitCode = 1; })
  .finally(async () => { await closeBillPool().catch(() => {}); });
