/**
 * Read-only: for employee codes rejected by the APR bulk attendance upload guard
 * (employmentWindow.ts), print status, salary_start_date/date_of_joining, resolved
 * employment end date, and employment_stint rows, so a "not found or inactive" /
 * "outside employment period" rejection can be checked against the real record.
 *
 * Run: npx tsx scripts/validate-apr-upload-rejections.ts MAS63264 MAS63449 ...
 */
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

async function main() {
  const codes = process.argv.slice(2);
  if (!codes.length) throw new Error('usage: validate-apr-upload-rejections.ts CODE [CODE...]');
  const conn = await createConnection(DB_CONFIG);

  const ph = codes.map(() => '?').join(',');
  const [emps] = await conn.execute<RowDataPacket[]>(
    `SELECT e.id, e.employee_code, e.employment_status,
            DATE_FORMAT(e.date_of_joining, '%Y-%m-%d') AS date_of_joining,
            DATE_FORMAT(e.salary_start_date, '%Y-%m-%d') AS salary_start_date,
            DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') AS date_of_exit,
            DATE_FORMAT(e.date_of_leaving, '%Y-%m-%d') AS date_of_leaving,
            DATE_FORMAT(${EMPLOYMENT_END_DATE_SQL}, '%Y-%m-%d') AS resolved_end_date
       FROM employees e WHERE e.employee_code IN (${ph})`,
    codes,
  );

  const found = new Set(emps.map((e) => String(e.employee_code)));
  for (const code of codes) {
    if (!found.has(code)) console.log(`${code}: NO EMPLOYEE ROW (matches "not found" rejection)`);
  }

  for (const e of emps) {
    console.log('---', e.employee_code, '---');
    console.log(JSON.stringify(e, null, 2));
    try {
      const [stints] = await conn.execute<RowDataPacket[]>(
        `SELECT stint_no, DATE_FORMAT(start_date,'%Y-%m-%d') AS start_date,
                DATE_FORMAT(end_date,'%Y-%m-%d') AS end_date
           FROM employment_stint WHERE employee_id = ? ORDER BY stint_no`,
        [e.id],
      );
      if (stints.length) console.log('stints:', JSON.stringify(stints));
    } catch {
      // employment_stint missing in this environment
    }
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
