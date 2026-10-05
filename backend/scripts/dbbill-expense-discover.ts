/**
 * db_bill expense / GRN table discovery. READ-ONLY (billQuery = SELECT/SHOW/DESCRIBE only).
 *   EX_TABLES  tables whose name suggests GRN / vendor / expense / payment, with row counts
 *   EX_COLS    column lists of those tables (rows > 0)
 *   EX_SAMPLE  two sample rows of each table with a 2026 date column, newest first
 *   npx tsx scripts/dbbill-expense-discover.ts
 */
import "dotenv/config";
import { billQuery } from "../src/db/billDb.js";

(async () => {
  const tabs = await billQuery<any>(
    `SELECT TABLE_NAME t, TABLE_ROWS r FROM information_schema.TABLES
      WHERE TABLE_SCHEMA = DATABASE() AND (TABLE_NAME LIKE '%grn%' OR TABLE_NAME LIKE '%vendor%' OR TABLE_NAME LIKE '%expense%' OR TABLE_NAME LIKE '%payment%' OR TABLE_NAME LIKE '%bill_pay%' OR TABLE_NAME LIKE '%ledger%' OR TABLE_NAME LIKE '%allocation%' OR TABLE_NAME LIKE '%cost%')
      ORDER BY TABLE_NAME`);
  console.log("EX_TABLES " + JSON.stringify(tabs));
  for (const { t, r } of tabs as any[]) {
    if (Number(r) <= 0) continue;
    const cols = await billQuery<any>(`SELECT COLUMN_NAME c, DATA_TYPE d FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = '${t}' ORDER BY ORDINAL_POSITION`);
    console.log("EX_COLS " + JSON.stringify({ t, rows: r, cols: cols.map((c: any) => `${c.c}:${c.d}`).join(",") }));
  }
  await new Promise((resolve) => process.stdout.write("EX_DONE\n", resolve));
  process.exit(0);
})();
