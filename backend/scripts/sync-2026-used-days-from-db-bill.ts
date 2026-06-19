#!/usr/bin/env tsx
/**
 * Sync 2026 leave used_days from db_bill.leave_management into mas_hrms.leave_balance_ledger.
 * Run from backend/: npx tsx scripts/sync-2026-used-days-from-db-bill.ts
 */

import { db } from '../src/db/mysql.js';
import { getLegacyPool, closeLegacyPool } from '../src/db/legacyDb.js';
import type { RowDataPacket } from 'mysql2';

const YEAR = 2026;

async function main() {
  const legacy = await getLegacyPool();

  console.log(`Syncing ${YEAR} used leave days from db_bill → mas_hrms...\n`);

  // Aggregate approved leave per employee per leave type from db_bill
  const [dbBillRows] = await legacy.execute<RowDataPacket[]>(`
    SELECT
      EmpCode,
      COALESCE(SUM(CL), 0)   AS cl_used,
      COALESCE(SUM(EL), 0)   AS el_used,
      COALESCE(SUM(ML), 0)   AS ml_used,
      COALESCE(SUM(PTRL), 0) AS ptrl_used,
      COALESCE(SUM(MTRL), 0) AS mtrl_used
    FROM leave_management
    WHERE YEAR(LeaveFrom) = ? AND Status = 'Approved'
    GROUP BY EmpCode
  `, [YEAR]);

  console.log(`Found ${dbBillRows.length} employees with approved leaves in ${YEAR} from db_bill.\n`);

  // Load leave_type_master codes → ids from mas_hrms
  const [ltRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, leave_code FROM leave_type_master WHERE active_status = 1`
  );
  const ltMap: Record<string, string> = {};
  for (const lt of ltRows) ltMap[lt.leave_code] = lt.id;

  // Load employee_code → id from mas_hrms
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id, employee_code FROM employees WHERE active_status = 1`
  );
  const empMap: Record<string, string> = {};
  for (const e of empRows) empMap[e.employee_code] = e.id;

  const leaveTypeColumns: Array<{ col: string; code: string }> = [
    { col: 'cl_used',   code: 'CL' },
    { col: 'el_used',   code: 'EL' },
    { col: 'ml_used',   code: 'ML' },
    { col: 'ptrl_used', code: 'PTRL' },
    { col: 'mtrl_used', code: 'MTRL' },
  ];

  let updated = 0;
  let skipped = 0;
  let notFound = 0;

  for (const row of dbBillRows) {
    const empId = empMap[row.EmpCode];
    if (!empId) {
      notFound++;
      continue;
    }

    for (const { col, code } of leaveTypeColumns) {
      const usedDays = Number(row[col] ?? 0);
      if (usedDays <= 0) continue;

      const ltId = ltMap[code];
      if (!ltId) continue;

      // Check existing row
      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT id, used_days FROM leave_balance_ledger
         WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [empId, ltId, YEAR]
      );

      if (!existing.length) {
        skipped++;
        continue;
      }

      const currentUsed = Number(existing[0].used_days ?? 0);
      if (currentUsed >= usedDays) {
        skipped++;
        continue;
      }

      await db.execute(
        `UPDATE leave_balance_ledger
         SET used_days = ?
         WHERE employee_id = ? AND leave_type_id = ? AND balance_year = ?`,
        [usedDays, empId, ltId, YEAR]
      );
      updated++;
      console.log(`  ✓ ${row.EmpCode} ${code}: ${currentUsed} → ${usedDays} days`);
    }
  }

  console.log(`\n--- Sync complete ---`);
  console.log(`Updated: ${updated} rows`);
  console.log(`Skipped (no balance entry or already current): ${skipped}`);
  console.log(`Employee not in mas_hrms: ${notFound}`);

  // Verify MAS47814
  const [verifyEmp] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE employee_code = 'MAS47814'`
  );
  if (verifyEmp.length) {
    const [verify] = await db.execute<RowDataPacket[]>(`
      SELECT lt.leave_code, lbl.allocated_days, lbl.used_days
      FROM leave_balance_ledger lbl
      JOIN leave_type_master lt ON lt.id = lbl.leave_type_id
      WHERE lbl.employee_id = ? AND lbl.balance_year = ?
      ORDER BY lt.leave_code
    `, [verifyEmp[0].id, YEAR]);
    console.log('\nVerification — MAS47814 balances:');
    console.table(verify);
  }

  await closeLegacyPool();
  await db.end();
}

main().catch((err) => {
  console.error('Sync failed:', err);
  process.exit(1);
});
