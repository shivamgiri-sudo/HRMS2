#!/usr/bin/env node
/**
 * sync-grn-cost-centre.mjs
 * Syncs db_bill expense_entry_particular → mas_hrms grn_cost_centre_allocation
 *
 * Usage:  node backend/scripts/sync-grn-cost-centre.mjs
 *
 * What it does:
 *  1. Reads expense_entry_particular (BranchId IN 3,9,18,19, company = Mas Callnet)
 *     joined to expense_entry_master for FinanceYear/FinanceMonth
 *  2. Maps each db_bill cost_master.cost_center code → HRMS cost_centre_master.id
 *  3. Batch-upserts into grn_cost_centre_allocation (500 rows per statement)
 *  4. Reports: mapped count, total amount by period, unmapped cost centers
 */

import mysql from 'mysql2/promise';

// ── connection config ──────────────────────────────────────────────────────
const HRMS_CFG = {
  host: '122.184.128.90',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'mas_hrms',
  port: 3306,
  connectTimeout: 20000,
};

const BILL_CFG = {
  host: '192.168.10.22',
  user: 'shivam_user',
  password: 'qwersdfg!@#hjk',
  database: 'db_bill',
  port: 3306,
  connectTimeout: 20000,
};

// Month name → 2-digit month number (fiscal year starts April)
const MONTH_MAP = {
  Apr: '04', May: '05', Jun: '06', Jul: '07', Aug: '08', Sep: '09',
  Oct: '10', Nov: '11', Dec: '12', Jan: '01', Feb: '02', Mar: '03',
};

/**
 * Convert FinanceYear ('2026-27') + FinanceMonth ('Jun') → period_code ('2026-06')
 * April–December belong to the first year of the finance year.
 * January–March belong to the second year.
 */
function toPeriodCode(financeYear, financeMonth) {
  const mm = MONTH_MAP[(financeMonth || '').trim()] || null;
  if (!mm) return null;
  const parts = (financeYear || '').split('-');
  if (parts.length < 2) return null;
  const y1 = parts[0];                               // '2026'
  const y2 = y1.slice(0, 2) + parts[1];             // '2027'
  // Jan(01) Feb(02) Mar(03) → second calendar year of FY
  const year = ['01', '02', '03'].includes(mm) ? y2 : y1;
  return `${year}-${mm}`;
}

const BATCH_SIZE = 500;

async function main() {
  console.log('=== sync-grn-cost-centre ===\n');

  const hrms = await mysql.createConnection(HRMS_CFG);
  const bill = await mysql.createConnection(BILL_CFG);

  try {
    // ── Step 1: load HRMS cost_centre_master (code → id) ────────────────────
    console.log('Loading cost_centre_master from HRMS…');
    const [ccRows] = await hrms.query(
      `SELECT id, cost_centre_code FROM cost_centre_master WHERE cost_centre_code IS NOT NULL`
    );
    const ccByCode = new Map();
    for (const row of ccRows) {
      ccByCode.set(row.cost_centre_code.trim(), row.id);
    }
    console.log(`  ${ccByCode.size} cost centres indexed.\n`);

    // ── Step 2: fetch all particular rows from db_bill ───────────────────────
    console.log('Fetching expense_entry_particular from db_bill…');
    const [particRows] = await bill.query(`
      SELECT
        ep.ExpenseEntry  AS bill_source_id,
        ep.CostCenterId  AS dbbill_cc_id,
        CAST(ep.Amount AS DECIMAL(12,4)) AS amount,
        cm.cost_center   AS cc_code,
        em.FinanceYear   AS finance_year,
        em.FinanceMonth  AS finance_month,
        COALESCE(bm.branch_name, CONCAT('Branch-', ep.BranchId)) AS branch_name
      FROM expense_entry_particular ep
      JOIN cost_master          cm ON cm.id  = ep.CostCenterId
      JOIN expense_entry_master em ON em.Id  = ep.ExpenseEntry
      LEFT JOIN branch_master   bm ON bm.id  = ep.BranchId
      WHERE ep.BranchId IN (3, 9, 18, 19)
        AND cm.company_name = 'Mas Callnet India Pvt Ltd'
    `);
    console.log(`  ${particRows.length} particular rows fetched.\n`);

    // ── Step 3: map rows to upsert payload ───────────────────────────────────
    let skippedNoCC = 0, skippedBadPeriod = 0;
    const unmappedCodes = new Set();
    const periodTotals = new Map();
    const upsertRows = [];

    for (const row of particRows) {
      const ccCode = (row.cc_code || '').trim();
      const hrmsccId = ccByCode.get(ccCode);
      if (!hrmsccId) {
        unmappedCodes.add(ccCode);
        skippedNoCC++;
        continue;
      }

      const periodCode = toPeriodCode(row.finance_year, row.finance_month);
      if (!periodCode) {
        skippedBadPeriod++;
        continue;
      }

      const amount = parseFloat(row.amount) || 0;
      periodTotals.set(periodCode, (periodTotals.get(periodCode) || 0) + amount);

      upsertRows.push([
        row.bill_source_id,
        null,           // grn_snapshot_id — always NULL; join via bill_source_id
        hrmsccId,
        row.dbbill_cc_id,
        amount,
        periodCode,
        row.branch_name || '',
        row.finance_year || '',
        row.finance_month || '',
      ]);
    }

    console.log(`Mapped ${upsertRows.length} rows for upsert.`);
    console.log(`Skipped: ${skippedNoCC} (no HRMS CC match), ${skippedBadPeriod} (bad period).\n`);

    // ── Step 4: batch upsert (500 rows per statement) ───────────────────────
    let totalAffected = 0;
    const totalBatches = Math.ceil(upsertRows.length / BATCH_SIZE);

    for (let i = 0; i < upsertRows.length; i += BATCH_SIZE) {
      const chunk = upsertRows.slice(i, i + BATCH_SIZE);
      const placeholders = chunk.map(() => '(?,?,?,?,?,?,?,?,?,NOW())').join(',');
      const flat = chunk.flat();

      const [result] = await hrms.query(`
        INSERT INTO grn_cost_centre_allocation
          (bill_source_id, grn_snapshot_id, cost_centre_id, dbbill_cc_id,
           amount, period_code, branch_name, finance_year, finance_month, synced_at)
        VALUES ${placeholders}
        ON DUPLICATE KEY UPDATE
          amount        = VALUES(amount),
          dbbill_cc_id  = VALUES(dbbill_cc_id),
          period_code   = VALUES(period_code),
          branch_name   = VALUES(branch_name),
          finance_year  = VALUES(finance_year),
          finance_month = VALUES(finance_month),
          synced_at     = NOW()
      `, flat);

      totalAffected += result.affectedRows;
      const batchNo = Math.floor(i / BATCH_SIZE) + 1;
      process.stdout.write(`  Batch ${batchNo}/${totalBatches} — affectedRows=${result.affectedRows}   \r`);
    }
    console.log(`\n  Total affectedRows across all batches: ${totalAffected}\n`);

    // ── Step 5: sync summary ─────────────────────────────────────────────────
    console.log('=== SYNC RESULTS ===');
    console.log(`  Rows fetched from db_bill:   ${particRows.length}`);
    console.log(`  Rows upserted to HRMS:       ${upsertRows.length}`);
    console.log(`  Skipped (no HRMS CC):        ${skippedNoCC}`);
    console.log(`  Skipped (bad period):        ${skippedBadPeriod}`);
    if (unmappedCodes.size) {
      console.log(`  Unmapped CC codes: ${[...unmappedCodes].sort().join(', ')}`);
    }
    console.log();

    // ── Step 6: totals by period ─────────────────────────────────────────────
    console.log('=== TOTALS BY PERIOD (in-memory, from mapped rows) ===');
    const sortedPeriods = [...periodTotals.entries()].sort((a, b) => a[0].localeCompare(b[0]));
    let grandTotal = 0;
    for (const [period, total] of sortedPeriods) {
      console.log(`  ${period}: ₹${total.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(total/100000).toFixed(2)}L)`);
      grandTotal += total;
    }
    console.log(`  ────────────────────────────────────────`);
    console.log(`  Grand total: ₹${grandTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(grandTotal/100000).toFixed(2)}L)\n`);

    // ── Step 7: June 2026 by cost centre (from DB) ───────────────────────────
    console.log('=== JUNE 2026 (2026-06) — BY COST CENTRE ===');
    const [jun] = await hrms.query(`
      SELECT
        ccm.cost_centre_code,
        ccm.cost_centre_name,
        g.branch_name,
        SUM(g.amount)    AS total_amount,
        COUNT(*)         AS rows_count
      FROM grn_cost_centre_allocation g
      JOIN cost_centre_master ccm ON ccm.id = g.cost_centre_id
      WHERE g.period_code = '2026-06'
      GROUP BY g.cost_centre_id, ccm.cost_centre_code, ccm.cost_centre_name, g.branch_name
      ORDER BY total_amount DESC
    `);

    if (jun.length === 0) {
      console.log('  No rows for 2026-06.\n');
    } else {
      let juneTotal = 0;
      for (const r of jun) {
        const amt = Number(r.total_amount);
        console.log(`  ${(r.cost_centre_code || '').padEnd(32)} ${r.branch_name.padEnd(22)} ₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(amt/100000).toFixed(4)}L)  [${r.rows_count} rows]  ${r.cost_centre_name || ''}`);
        juneTotal += amt;
      }
      console.log(`  ──────────────────────────────────────────────────────────────`);
      console.log(`  Jun 2026 CC total: ₹${juneTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(juneTotal/100000).toFixed(4)}L)`);
      console.log(`  Target from sheet: 82.62L\n`);
    }

    // ── Step 8: June 2026 by branch ──────────────────────────────────────────
    console.log('=== JUNE 2026 — BY BRANCH ===');
    const [junBranch] = await hrms.query(`
      SELECT
        g.branch_name,
        SUM(g.amount)                    AS total_amount,
        COUNT(DISTINCT g.bill_source_id) AS grn_count
      FROM grn_cost_centre_allocation g
      WHERE g.period_code = '2026-06'
      GROUP BY g.branch_name
      ORDER BY total_amount DESC
    `);
    let junBranchTotal = 0;
    for (const r of junBranch) {
      const amt = Number(r.total_amount);
      console.log(`  ${r.branch_name.padEnd(28)} ₹${amt.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(amt/100000).toFixed(4)}L)  [${r.grn_count} GRNs]`);
      junBranchTotal += amt;
    }
    console.log(`  ──────────────────────────────────────────────────`);
    console.log(`  Branch rollup total: ₹${junBranchTotal.toLocaleString('en-IN', { maximumFractionDigits: 2 })}  (${(junBranchTotal/100000).toFixed(4)}L)\n`);

  } finally {
    await hrms.end().catch(() => {});
    await bill.end().catch(() => {});
  }
}

main().catch(err => {
  console.error('FATAL:', err);
  process.exit(1);
});
