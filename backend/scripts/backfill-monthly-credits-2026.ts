#!/usr/bin/env tsx
/**
 * One-off backfill: credits any active employee who missed a monthly leave
 * credit for any completed month in 2026 where the worker already ran.
 *
 * Safe to re-run: creditMonthlyLeaves() is fully idempotent — it skips
 * employees that already have a leave_el_credit_log entry for the month.
 *
 * Run from backend/:  npx tsx scripts/backfill-monthly-credits-2026.ts
 */

import { db } from '../src/db/mysql.js';
import { creditMonthlyLeaves } from '../src/workers/leave-monthly-credit.worker.js';
import type { RowDataPacket } from 'mysql2';

const YEAR = 2026;

async function main() {
  const now = new Date();
  // Only back-fill completed months (up to last month; current month runs on the 1st)
  const upToMonth = now.getMonth(); // getMonth() is 0-indexed → gives last complete month

  if (upToMonth < 1) {
    console.log('Nothing to back-fill yet (January not complete).');
    await db.end();
    return;
  }

  console.log(`Backfill: checking 2026 months 1–${upToMonth} for gaps...\n`);

  const [scheduleRows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT month FROM leave_credit_schedule WHERE month <= ? ORDER BY month`,
    [upToMonth]
  );

  for (const row of scheduleRows) {
    const month: number = row.month;

    // Only process months where the worker already ran for some employees
    const [ran] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM leave_el_credit_log l
       JOIN leave_type_master lt ON lt.id = l.leave_type_id
       JOIN leave_credit_schedule lcs ON lcs.leave_code = lt.leave_code AND lcs.month = ?
       WHERE l.credit_year = ? AND l.credit_month = ? AND l.credit_type = 'monthly'`,
      [month, YEAR, month]
    );
    if (Number((ran as any)[0]?.cnt ?? 0) === 0) {
      console.log(`  Month ${month}: no worker records — skipping (seeded or not yet run)`);
      continue;
    }

    const monthStart = `${YEAR}-${String(month).padStart(2, '0')}-01`;
    const [result] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS gap
       FROM employees e
       WHERE e.active_status = 1
         AND e.employment_status = 'active'
         AND e.date_of_joining IS NOT NULL
         AND e.date_of_joining < ?
         AND NOT EXISTS (
           SELECT 1
           FROM leave_el_credit_log l2
           JOIN leave_type_master lt2 ON lt2.id = l2.leave_type_id
           WHERE l2.employee_id = e.id
             AND l2.credit_year  = ?
             AND l2.credit_month = ?
             AND l2.credit_type  = 'monthly'
             AND lt2.leave_code IN (
               SELECT leave_code FROM leave_credit_schedule WHERE month = ?
             )
         )`,
      [monthStart, YEAR, month, month]
    );

    const gap = Number((result as any)[0]?.gap ?? 0);
    if (gap === 0) {
      console.log(`  Month ${month}: all employees credited — OK`);
      continue;
    }

    console.log(`  Month ${month}: ${gap} employees missing credit — running creditMonthlyLeaves(${YEAR}, ${month})...`);
    await creditMonthlyLeaves(YEAR, month);
    console.log(`  Month ${month}: back-fill done\n`);
  }

  // Also check current month (Aug) since its 1st already ran but may have gaps
  const currentMonth = now.getMonth() + 1;
  if (currentMonth !== upToMonth + 1) {
    // shouldn't happen, just guard
  }
  {
    const month = currentMonth;
    const [ran] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS cnt
       FROM leave_el_credit_log l
       JOIN leave_type_master lt ON lt.id = l.leave_type_id
       JOIN leave_credit_schedule lcs ON lcs.leave_code = lt.leave_code AND lcs.month = ?
       WHERE l.credit_year = ? AND l.credit_month = ? AND l.credit_type = 'monthly'`,
      [month, YEAR, month]
    );
    if (Number((ran as any)[0]?.cnt ?? 0) > 0) {
      const monthStart = `${YEAR}-${String(month).padStart(2, '0')}-01`;
      const [result] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS gap
         FROM employees e
         WHERE e.active_status = 1
           AND e.employment_status = 'active'
           AND e.date_of_joining IS NOT NULL
           AND e.date_of_joining < ?
           AND NOT EXISTS (
             SELECT 1
             FROM leave_el_credit_log l2
             JOIN leave_type_master lt2 ON lt2.id = l2.leave_type_id
             WHERE l2.employee_id = e.id
               AND l2.credit_year  = ?
               AND l2.credit_month = ?
               AND l2.credit_type  = 'monthly'
               AND lt2.leave_code IN (
                 SELECT leave_code FROM leave_credit_schedule WHERE month = ?
               )
           )`,
        [monthStart, YEAR, month, month]
      );
      const gap = Number((result as any)[0]?.gap ?? 0);
      if (gap > 0) {
        console.log(`  Month ${month} (current): ${gap} employees missing credit — running back-fill...`);
        await creditMonthlyLeaves(YEAR, month);
        console.log(`  Month ${month}: back-fill done\n`);
      } else {
        console.log(`  Month ${month} (current): all pre-month employees credited — OK`);
      }
    }
  }

  console.log('\nBackfill complete.');
  await db.end();
}

main().catch((err) => {
  console.error('Backfill failed:', err);
  process.exit(1);
});
