/**
 * End-to-end test of the attendance-logic setting: service write -> database -> engine read.
 *
 * Runs against a process that has ZERO active employees, deliberately, so it cannot alter
 * anyone's attendance while a month rebuild is in flight. What it proves is the wiring:
 * that setProcessAttendanceLogic writes what the UI asks for, that resolveAttendanceLogic
 * reads it back as the engine will, and that 'cosec' deactivates rather than deletes.
 *
 * Restores the process to its original state at the end, whether or not the test passes.
 *
 *   npx tsx scripts/test-attendance-logic-roundtrip.ts
 */
import { db } from '../src/db/mysql.js';
import { attendanceEngineService } from '../src/modules/wfm/attendance-engine.service.js';
import type { RowDataPacket } from 'mysql2';

const results: Array<{ step: string; expected: string; actual: string; ok: boolean }> = [];
function check(step: string, expected: unknown, actual: unknown) {
  const ok = String(expected) === String(actual);
  results.push({ step, expected: String(expected), actual: String(actual), ok });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${step}  expected=${expected} actual=${actual}`);
}

// A process nobody is currently assigned to — changing it cannot move an attendance row.
const [procRows] = await db.execute<RowDataPacket[]>(
  `SELECT p.id, p.process_name
     FROM process_master p
     LEFT JOIN employees e ON e.process_id = p.id AND e.employment_status = 'active'
    WHERE p.active_status = 1
    GROUP BY p.id, p.process_name
   HAVING COUNT(e.id) = 0
    ORDER BY p.process_name
    LIMIT 1`);
const proc = (procRows as any[])[0];
if (!proc) {
  console.error('No zero-employee process available to test against safely. Aborting.');
  process.exit(1);
}
console.log(`Test subject: "${proc.process_name}" (${proc.id}) — 0 active employees\n`);

// The scope an Operations executive presents to the engine.
const [scopeRows] = await db.execute<RowDataPacket[]>(
  `SELECT designation_id, department_id FROM apr_eligibility_config
    WHERE designation_id IS NOT NULL AND department_id IS NOT NULL LIMIT 1`);
const scope = (scopeRows as any[])[0];

const [beforeRows] = await db.execute<RowDataPacket[]>(
  `SELECT id, active_status, attendance_logic FROM apr_eligibility_config WHERE process_id = ?`,
  [proc.id]);
const before = beforeRows as any[];
console.log(`Existing rows for this process: ${before.length}\n`);

const resolve = () => attendanceEngineService.resolveAttendanceLogic(
  scope.designation_id, scope.department_id, proc.id, 'operations', 'executive');

try {
  // 1. APR
  await attendanceEngineService.setProcessAttendanceLogic(proc.id, 'apr', 'test-script');
  check('set APR -> engine resolves', 'apr', await resolve());
  const [aprRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM apr_eligibility_config
      WHERE process_id = ? AND active_status = 1 AND attendance_logic = 'apr'`, [proc.id]);
  check('set APR -> active apr rows written', true, Number((aprRows as any[])[0].n) > 0);

  // 2. APR validated by COSEC
  await attendanceEngineService.setProcessAttendanceLogic(proc.id, 'apr_validated_by_cosec', 'test-script');
  check('set tally -> engine resolves', 'apr_validated_by_cosec', await resolve());
  const [tallyRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM apr_eligibility_config
      WHERE process_id = ? AND active_status = 1 AND attendance_logic = 'apr_validated_by_cosec'`,
    [proc.id]);
  check('set tally -> rows updated in place, not duplicated',
    Number((aprRows as any[])[0].n), Number((tallyRows as any[])[0].n));

  // 3. COSEC — deactivates, does not delete
  await attendanceEngineService.setProcessAttendanceLogic(proc.id, 'cosec', 'test-script');
  check('set COSEC -> engine resolves', 'cosec', await resolve());
  const [cosecRows] = await db.execute<RowDataPacket[]>(
    `SELECT SUM(active_status = 1) act, COUNT(*) total
       FROM apr_eligibility_config WHERE process_id = ?`, [proc.id]);
  const c = (cosecRows as any[])[0];
  check('set COSEC -> no active rows left', '0', String(Number(c.act ?? 0)));
  check('set COSEC -> rows deactivated not deleted', true, Number(c.total) > 0);

  // 4. The listing the UI reads must agree with the engine
  const list = await attendanceEngineService.listProcessAttendanceLogic();
  const listed = list.find((r) => r.process_id === proc.id);
  check('listing agrees with engine', 'cosec', listed?.attendance_logic ?? 'MISSING');

  // 5. Other processes untouched — the 9 APR processes must still resolve to APR
  const [otherRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(DISTINCT process_id) n FROM apr_eligibility_config
      WHERE active_status = 1 AND attendance_logic <> 'cosec' AND process_id IS NOT NULL`);
  check('the 9 configured APR processes are unaffected', 9, Number((otherRows as any[])[0].n));
} finally {
  // Restore exactly what was there before, row by row.
  await db.execute(`DELETE FROM apr_eligibility_config WHERE process_id = ? AND id NOT IN (?)`,
    [proc.id, before.length ? before.map((r) => r.id) : ['']]).catch(async () => {
      // No pre-existing rows: remove everything this test created.
      await db.execute(`DELETE FROM apr_eligibility_config WHERE process_id = ?`, [proc.id]);
    });
  for (const r of before) {
    await db.execute(
      `UPDATE apr_eligibility_config SET active_status = ?, attendance_logic = ? WHERE id = ?`,
      [r.active_status, r.attendance_logic, r.id]);
  }
  const [restored] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) n FROM apr_eligibility_config WHERE process_id = ?`, [proc.id]);
  console.log(`\nRestored: process now has ${Number((restored as any[])[0].n)} row(s), was ${before.length}.`);
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
process.exit(failed.length ? 1 : 0);
