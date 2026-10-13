/**
 * Revokes 5 specific exit_request rows found to be false-positive "absconding" exits that
 * permanently emptied the employee's employmentWindow.ts window (diagnose-mislinked-exit-
 * requests.ts, 2026-10-13). All 5 employees are employment_status='Active', active_status=1,
 * and had their salary_start_date pushed later than the exit_request's LWD after the exit
 * request was created -- i.e. they resumed/continued and nobody revoked the flag.
 *
 * Dry-run (default) prints current state and what would change, writes nothing.
 * --apply sets status='revoked' on exactly these 5 rows, guarded by id AND status='exited'
 * so it only touches them if they are still in the state this was diagnosed against, then
 * re-reads each employee's resolved employment window to confirm it is no longer inverted.
 *
 * Run: npx tsx scripts/revoke-false-positive-absconding-exits.ts [--apply]
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const DB_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

const EMPLOYMENT_END_DATE_SQL = `
  COALESCE(
    (SELECT COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed)
       FROM exit_request x
      WHERE x.employee_id = e.id
        AND LOWER(x.status) IN ('accepted','notice_serving','exited')
      ORDER BY COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) DESC
      LIMIT 1),
    e.date_of_exit,
    e.date_of_leaving
  )`;

const TARGETS: Array<{ employeeCode: string; exitRequestId: string }> = [
  { employeeCode: '63467C', exitRequestId: '4b04625b-3283-4aa1-8c9f-3db484b002d7' },
  { employeeCode: 'MAS63432', exitRequestId: '0a667c8e-ad10-11f1-8f5c-00155d0ab410' },
  { employeeCode: 'MAS63514', exitRequestId: '6e3c5733-19bf-4981-bfd4-7149f9e476c1' },
  { employeeCode: 'MAS63532', exitRequestId: '81d17ec9-e8eb-4000-afce-50e9b2cf0bfa' },
  { employeeCode: 'MAS63669', exitRequestId: 'e4a9c619-79b9-41a6-90ee-2c9acb9bae2b' },
];

const REVOKE_REASON =
  'False-positive absconding exit: employee resumed/continued (employment_status stayed Active, ' +
  'salary_start_date set later than this request\'s LWD). Revoked by read-only audit ' +
  '2026-10-13 (diagnose-mislinked-exit-requests.ts) after owner approval; not an actual exit.';

async function windowSnapshot(conn: Awaited<ReturnType<typeof createConnection>>, code: string) {
  const [rows] = await conn.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.employment_status,
            DATE_FORMAT(e.salary_start_date, '%Y-%m-%d') AS salary_start_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
            DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL}, '%Y-%m-%d') AS resolved_end_date
       FROM employees e WHERE e.employee_code = ?`,
    [code],
  );
  return rows[0];
}

async function main() {
  const apply = process.argv.includes('--apply');
  const conn = await createConnection(DB_CONFIG);

  console.log(`=== BEFORE (${apply ? 'APPLY' : 'DRY-RUN'}) ===`);
  for (const t of TARGETS) {
    const [exitRows] = await conn.execute<RowDataPacket[]>(
      `SELECT id, status, exit_sub_type, last_working_day_confirmed FROM exit_request WHERE id = ?`,
      [t.exitRequestId],
    );
    const snap = await windowSnapshot(conn, t.employeeCode);
    console.log(t.employeeCode, 'exit_request:', JSON.stringify(exitRows[0] ?? null), 'window:', JSON.stringify(snap));
  }

  if (!apply) {
    console.log('\nDry run only — no writes made. Re-run with --apply to revoke these 5 rows.');
    await conn.end();
    return;
  }

  console.log('\n=== APPLYING ===');
  for (const t of TARGETS) {
    const [result] = await conn.execute<import('mysql2').ResultSetHeader>(
      `UPDATE exit_request
          SET status = 'revoked', revoked_at = NOW(), revoke_reason = ?
        WHERE id = ? AND status = 'exited'`,
      [REVOKE_REASON, t.exitRequestId],
    );
    console.log(t.employeeCode, t.exitRequestId, 'rows affected:', (result as any).affectedRows);
  }

  console.log('\n=== AFTER ===');
  for (const t of TARGETS) {
    const snap = await windowSnapshot(conn, t.employeeCode);
    console.log(t.employeeCode, 'window:', JSON.stringify(snap));
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
