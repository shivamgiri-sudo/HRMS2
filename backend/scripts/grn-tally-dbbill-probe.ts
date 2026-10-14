/**
 * db_bill GRN -> Tally probe — read-only (billQuery allows SELECT/SHOW only; HRMS side SELECT-guarded).
 *
 *   npx tsx scripts/grn-tally-dbbill-probe.ts
 *
 * Round 2: vendor Tally/TDS fields, TDS master, sub-head TDS, imprest ledgers, legacy imprest GRNs, how
 * HRMS vendors link to db_bill vendors, and which HRMS-raised GRNs are the same bill as a db_bill GRN
 * (already sent to Tally by the legacy import).
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const out = (title: string, rows: any[]) => {
  console.log(`\n## ${title} (${rows.length})`);
  for (const r of rows) console.log(JSON.stringify(r));
};
const bill = async (title: string, sql: string) => {
  try {
    const rows = (await billQuery<any>(sql)) as any[];
    out(title, rows);
    return rows;
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
    return [];
  }
};
const hrms = async (title: string, sql: string, print = true) => {
  if (!/^\s*SELECT\b/i.test(sql)) throw new Error("read-only");
  try {
    const [rows] = await db.query<RowDataPacket[]>(sql);
    if (print) out(title, rows);
    return rows as any[];
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${(e as Error).message}`);
    return [];
  }
};

// Round 3: the HRMS GRNs the duplicate guard lets through — any legacy GRN of the same amount?
await bill("legacy GRNs with the same amount as the remaining HRMS GRNs", `SELECT m.GrnNo, m.ExpenseEntryType, m.bill_no, m.bill_date, m.Amount, m.DownloadStatus, m.BranchId, v.vendor, v.TallyHead
  FROM expense_entry_master m LEFT JOIN tbl_vendormaster v ON v.Id = m.Vendor
 WHERE m.FinanceYear = '2026-27' AND CAST(m.Amount AS DECIMAL(16,2)) IN (47105.60, 47106, 20409, 10999.98, 11000, 10999)`);
await bill("Sri Sanchia legacy GRNs FY 26-27", `SELECT m.GrnNo, m.bill_no, m.bill_date, m.Amount, m.DownloadStatus FROM expense_entry_master m LEFT JOIN tbl_vendormaster v ON v.Id = m.Vendor WHERE m.FinanceYear = '2026-27' AND v.vendor LIKE '%SANCHIA%'`);
await bill("Reliance Jio legacy GRNs Aug-Oct", `SELECT m.GrnNo, m.bill_no, m.bill_date, m.Amount, m.Vendor, v.TallyHead FROM expense_entry_master m LEFT JOIN tbl_vendormaster v ON v.Id = m.Vendor WHERE m.FinanceYear = '2026-27' AND v.vendor LIKE '%JIO%' AND m.createdate >= '2026-08-01'`);
await closeBillPool();
process.exit(0);
