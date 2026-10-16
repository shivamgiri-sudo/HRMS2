/**
 * sync-grn-expense-master.mjs
 *
 * Syncs db_bill.expense_master (for BranchId IN 3,9,18,19,24) into
 * mas_hrms.grn_expense_master_snapshot.
 *
 * Research snapshot only — does NOT touch grn_entry_snapshot or any P&L service.
 *
 * Usage:
 *   node backend/scripts/sync-grn-expense-master.mjs
 */

import mysql from 'mysql2/promise';

// ── connections ──────────────────────────────────────────────────────────────
const HRMS = { host: '122.184.128.90', user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'mas_hrms' };
const BILL = { host: '192.168.10.22',  user: 'shivam_user', password: 'qwersdfg!@#hjk', database: 'db_bill' };

// ── branch mapping: dbbill BranchId → HRMS uuid + display name ───────────────
const BRANCH_MAP = {
  3:  { hrmsId: 'fea9fdc3-6583-11f1-adb1-00155d0ab410', name: 'HEAD OFFICE' },
  9:  { hrmsId: '77769026-5e88-11f1-adb1-00155d0ab410', name: 'NOIDA' },
  18: { hrmsId: 'fea10538-6583-11f1-adb1-00155d0ab410', name: 'AHMEDABAD-JALDARSHAN' },
  19: { hrmsId: 'febd8777-6583-11f1-adb1-00155d0ab410', name: 'NOIDA-2' },
  24: { hrmsId: 'fea2c991-6583-11f1-adb1-00155d0ab410', name: 'AHMEDABAD-NEELAKANTH' },
};

// ── fiscal month → calendar month number (April = fiscal month 1) ─────────────
const MONTH_NAME_MAP = {
  apr: '04', april: '04',
  may: '05',
  jun: '06', june: '06',
  jul: '07', july: '07',
  aug: '08', august: '08',
  sep: '09', sept: '09', september: '09',
  oct: '10', october: '10',
  nov: '11', november: '11',
  dec: '12', december: '12',
  jan: '01', january: '01',
  feb: '02', february: '02',
  mar: '03', march: '03',
};

/**
 * Converts FinanceYear + FinanceMonth → 'YYYY-MM' period_code.
 * FinanceYear examples: '2026-27', '2025-26'
 * FinanceMonth examples: 'Jun', 'Apr', 'Mar'
 *
 * Rule: months Apr–Dec belong to the first year of the FY pair;
 *       months Jan–Mar belong to the second year.
 */
function toPeriodCode(financeYear, financeMonth) {
  if (!financeYear || !financeMonth) return null;

  const monthKey = financeMonth.toLowerCase().trim();
  const mm = MONTH_NAME_MAP[monthKey];
  if (!mm) return null;

  // Parse the FY pair, e.g. '2026-27' → [2026, 2027]
  const parts = financeYear.split('-');
  if (parts.length < 2) return null;
  const yearStart = parseInt(parts[0], 10);
  const yearEnd   = parseInt(parts[1].length === 2 ? parts[0].slice(0, 2) + parts[1] : parts[1], 10);

  const monthNum = parseInt(mm, 10);
  // Apr(4)–Dec(12) → first calendar year; Jan(1)–Mar(3) → second calendar year
  const yyyy = monthNum >= 4 ? yearStart : yearEnd;
  return `${yyyy}-${mm}`;
}

async function main() {
  const hrmsConn = await mysql.createConnection(HRMS);
  const billConn = await mysql.createConnection(BILL);

  console.log('Connected to both DBs.');

  // ── fetch from db_bill ────────────────────────────────────────────────────
  const branchIds = Object.keys(BRANCH_MAP).join(',');
  const [rows] = await billConn.execute(
    `SELECT Id, BranchId, FinanceYear, FinanceMonth, HeadId, SubHeadId,
            Amount, expense_status, EntryStatus, Methodology
     FROM   expense_master
     WHERE  BranchId IN (${branchIds})
     ORDER  BY Id`
  );

  console.log(`Fetched ${rows.length} rows from db_bill.expense_master`);

  // ── upsert into HRMS ──────────────────────────────────────────────────────
  let inserted = 0, updated = 0, skipped = 0;

  const BATCH = 500;
  for (let i = 0; i < rows.length; i += BATCH) {
    const chunk = rows.slice(i, i + BATCH);

    for (const row of chunk) {
      const branch = BRANCH_MAP[row.BranchId];
      if (!branch) { skipped++; continue; }

      const periodCode = toPeriodCode(row.FinanceYear, row.FinanceMonth);

      // is_rejected: HeadId=19 is a known non-P&L category
      const headIdNum = parseInt(row.HeadId, 10);
      const isRejected = headIdNum === 19 ? 1 : 0;

      await hrmsConn.execute(
        `INSERT INTO grn_expense_master_snapshot
           (id, bill_source_id, branch_source_id, branch_name,
            finance_year, finance_month, period_code,
            head_id, sub_head_id, amount,
            expense_status, entry_status, methodology,
            is_rejected, synced_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())
         ON DUPLICATE KEY UPDATE
           branch_source_id = VALUES(branch_source_id),
           branch_name      = VALUES(branch_name),
           finance_year     = VALUES(finance_year),
           finance_month    = VALUES(finance_month),
           period_code      = VALUES(period_code),
           head_id          = VALUES(head_id),
           sub_head_id      = VALUES(sub_head_id),
           amount           = VALUES(amount),
           expense_status   = VALUES(expense_status),
           entry_status     = VALUES(entry_status),
           methodology      = VALUES(methodology),
           is_rejected      = VALUES(is_rejected),
           synced_at        = NOW()`,
        [
          row.Id,
          branch.hrmsId,
          branch.name,
          row.FinanceYear  ?? '',
          row.FinanceMonth ?? '',
          periodCode,
          row.HeadId    != null ? String(row.HeadId)    : null,
          row.SubHeadId != null ? String(row.SubHeadId) : null,
          row.Amount ?? 0,
          row.expense_status ?? null,
          row.EntryStatus    ?? null,
          row.Methodology    ?? null,
          isRejected,
        ]
      );
      inserted++;
    }

    process.stdout.write(`\r  upserted ${Math.min(i + BATCH, rows.length)} / ${rows.length} …`);
  }

  console.log(`\nDone. upserted=${inserted}  skipped=${skipped}`);

  // ── report: monthly totals for the target branches ────────────────────────
  console.log('\n── Monthly totals (is_rejected=0, all synced branches) ──────────────');
  const [totals] = await hrmsConn.execute(
    `SELECT period_code,
            ROUND(SUM(amount)/100000, 2) AS lakhs,
            COUNT(*)                     AS row_count
     FROM   grn_expense_master_snapshot
     WHERE  branch_name IN ('NOIDA','NOIDA-2','HEAD OFFICE','AHMEDABAD-JALDARSHAN','AHMEDABAD-NEELAKANTH')
       AND  is_rejected = 0
       AND  period_code IS NOT NULL
     GROUP  BY period_code
     ORDER  BY period_code`
  );

  console.log('period_code | lakhs    | rows');
  console.log('------------|----------|------');
  for (const r of totals) {
    console.log(`${String(r.period_code).padEnd(11)} | ${String(r.lakhs).padStart(8)} | ${r.row_count}`);
  }

  // ── report: per-branch monthly breakdown ─────────────────────────────────
  console.log('\n── Per-branch monthly breakdown (is_rejected=0) ────────────────────');
  const [detail] = await hrmsConn.execute(
    `SELECT period_code, branch_name,
            ROUND(SUM(amount)/100000, 2) AS lakhs,
            COUNT(*)                     AS row_count
     FROM   grn_expense_master_snapshot
     WHERE  branch_name IN ('NOIDA','NOIDA-2','HEAD OFFICE','AHMEDABAD-JALDARSHAN','AHMEDABAD-NEELAKANTH')
       AND  is_rejected = 0
       AND  period_code IS NOT NULL
     GROUP  BY period_code, branch_name
     ORDER  BY period_code, branch_name`
  );

  let lastPeriod = '';
  for (const r of detail) {
    if (r.period_code !== lastPeriod) {
      console.log(`\n  ${r.period_code}`);
      lastPeriod = r.period_code;
    }
    console.log(`    ${String(r.branch_name).padEnd(30)} ${String(r.lakhs).padStart(8)} L  (${r.row_count} rows)`);
  }

  // ── report: HeadId=19 breakdown (rejected) ────────────────────────────────
  console.log('\n── HeadId=19 (is_rejected=1) monthly totals ─────────────────────────');
  const [rej] = await hrmsConn.execute(
    `SELECT period_code,
            ROUND(SUM(amount)/100000, 2) AS lakhs,
            COUNT(*)                     AS row_count
     FROM   grn_expense_master_snapshot
     WHERE  branch_name IN ('NOIDA','NOIDA-2','HEAD OFFICE','AHMEDABAD-JALDARSHAN','AHMEDABAD-NEELAKANTH')
       AND  is_rejected = 1
       AND  period_code IS NOT NULL
     GROUP  BY period_code
     ORDER  BY period_code`
  );

  for (const r of rej) {
    console.log(`  ${r.period_code}  ${r.lakhs} L  (${r.row_count} rows)`);
  }

  // ── snapshot size ─────────────────────────────────────────────────────────
  const [[{ total_rows }]] = await hrmsConn.execute(
    `SELECT COUNT(*) AS total_rows FROM grn_expense_master_snapshot`
  );
  console.log(`\nTotal rows in grn_expense_master_snapshot: ${total_rows}`);

  await hrmsConn.end();
  await billConn.end();
}

main().catch(err => { console.error(err); process.exit(1); });
