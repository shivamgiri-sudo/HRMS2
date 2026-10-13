/**
 * Read-only: find every employee whose employment window start is AFTER its resolved end —
 * salary_start_date (or DOJ) > EMPLOYMENT_END_DATE_SQL for the base window, or a stint's
 * start_date > its effective end. Such a window is permanently empty, so
 * employmentWindow.ts#isWithinWindows rejects every attendance date for that employee, not
 * just out-of-range ones (found live on MAS63669, 2026-10-13).
 *
 * Run: npx tsx scripts/scan-inverted-employment-windows.ts
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

const EMPLOYMENT_END_DATE_SQL = (alias: string) => `
  COALESCE(
    (SELECT COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed)
       FROM exit_request x
      WHERE x.employee_id = ${alias}.id
        AND LOWER(x.status) IN ('accepted','notice_serving','exited')
      ORDER BY COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) DESC
      LIMIT 1),
    ${alias}.date_of_exit,
    ${alias}.date_of_leaving
  )`;

async function main() {
  const conn = await createConnection(DB_CONFIG);

  console.log('=== Base window inverted: COALESCE(salary_start_date, date_of_joining) > resolved_end_date ===');
  const [baseRows] = await conn.execute<RowDataPacket[]>(
    `SELECT e.employee_code, e.employment_status,
            DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
            DATE_FORMAT(e.salary_start_date, '%Y-%m-%d') AS salary_start_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
            DATE_FORMAT(e.date_of_leaving, '%Y-%m-%d') AS date_of_leaving,
            DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL('e')}, '%Y-%m-%d') AS resolved_end_date
       FROM employees e
      WHERE NOT EXISTS (SELECT 1 FROM employment_stint st WHERE st.employee_id = e.id)
        AND ${EMPLOYMENT_END_DATE_SQL('e')} IS NOT NULL
        AND COALESCE(e.salary_start_date, e.date_of_joining) > ${EMPLOYMENT_END_DATE_SQL('e')}
      ORDER BY e.employee_code`,
  );
  console.log(`${baseRows.length} employee(s)`);
  for (const r of baseRows) console.log(JSON.stringify(r));

  console.log('\n=== Stint window inverted: employment_stint.start_date > COALESCE(end_date, resolved_end_date) ===');
  try {
    const [stintRows] = await conn.execute<RowDataPacket[]>(
      `SELECT e.employee_code, st.stint_no,
              DATE_FORMAT(st.start_date, '%Y-%m-%d') AS stint_start,
              DATE_FORMAT(st.end_date, '%Y-%m-%d') AS stint_end,
              DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL('e')}, '%Y-%m-%d') AS resolved_end_date
         FROM employment_stint st
         JOIN employees e ON e.id = st.employee_id
        WHERE st.start_date > COALESCE(st.end_date, ${EMPLOYMENT_END_DATE_SQL('e')})
          AND COALESCE(st.end_date, ${EMPLOYMENT_END_DATE_SQL('e')}) IS NOT NULL
        ORDER BY e.employee_code, st.stint_no`,
    );
    console.log(`${stintRows.length} stint row(s)`);
    for (const r of stintRows) console.log(JSON.stringify(r));
  } catch (err) {
    console.log('employment_stint not queryable in this environment:', err instanceof Error ? err.message : err);
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
