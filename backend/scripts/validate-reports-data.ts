import 'dotenv/config';
import mysql from 'mysql2/promise';

function env(name: string, fallback?: string) {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required`);
}

function numEnv(name: string, fallback: number) {
  const value = Number(process.env[name] ?? fallback);
  return Number.isFinite(value) ? value : fallback;
}

async function scalar(conn: mysql.Connection, sql: string, params: unknown[] = []) {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(sql, params);
  return rows[0] ?? {};
}

async function main() {
  const database = env('DB_NAME', env('MYSQL_DATABASE', 'mas_hrms'));
  const year = Number(process.env.REPORT_YEAR ?? new Date().getFullYear());
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const conn = await mysql.createConnection({
    host: env('DB_HOST', env('MYSQL_HOST', 'localhost')),
    port: numEnv('DB_PORT', numEnv('MYSQL_PORT', 3306)),
    user: env('DB_USER', env('MYSQL_USER', 'root')),
    password: env('DB_PASSWORD', process.env.MYSQL_PASSWORD ?? ''),
    database,
  });

  try {
    const startOfYear = await scalar(conn,
      `SELECT COUNT(*) AS count
         FROM employees
        WHERE (date_of_joining IS NULL OR date_of_joining <= ?)
          AND (COALESCE(date_of_exit, date_of_leaving, resignation_date) IS NULL
               OR COALESCE(date_of_exit, date_of_leaving, resignation_date) >= ?)
          AND NOT (COALESCE(date_of_exit, date_of_leaving, resignation_date) IS NULL
                   AND LOWER(COALESCE(employment_status, 'active')) IN ('terminated','inactive','offboarded','absconded','resigned','left','separated'))`,
      [yearStart, yearStart],
    );

    const terminations = await scalar(conn,
      `SELECT COUNT(*) AS count
         FROM employees
        WHERE COALESCE(date_of_exit, date_of_leaving, resignation_date) BETWEEN ? AND ?`,
      [yearStart, yearEnd],
    );

    const payroll = await scalar(conn,
      `SELECT COUNT(DISTINCT spr.run_month) AS months,
              COUNT(DISTINCT spl.employee_id) AS employees,
              SUM(COALESCE(spl.net_salary, 0)) AS net_salary
         FROM salary_prep_run spr
         JOIN salary_prep_line spl ON spl.run_id = spr.id
        WHERE LEFT(spr.run_month, 4) = ?
          AND LOWER(spr.status) IN ('approved','disbursed','finalized')`,
      [String(year)],
    );

    const leave = await scalar(conn,
      `SELECT COUNT(*) AS rows_count,
              SUM(COALESCE(allocated_days,0) + COALESCE(adjusted_days,0) - COALESCE(used_days,0)) AS remaining_days
         FROM leave_balance_ledger
        WHERE balance_year = ?`,
      [year],
    );

    const attendance = await scalar(conn,
      `SELECT COUNT(*) AS rows_count,
              COUNT(DISTINCT employee_id) AS employees,
              MIN(record_date) AS min_date,
              MAX(record_date) AS max_date
         FROM attendance_daily_record
        WHERE YEAR(record_date) = ?`,
      [year],
    );

    console.log(JSON.stringify({
      generatedAt: new Date().toISOString(),
      database,
      year,
      checks: {
        startOfYearActiveCount: startOfYear,
        terminationCount: terminations,
        payrollTrendSource: payroll,
        leaveBalanceLedger: leave,
        attendanceDailyRecord: attendance,
      },
    }, null, 2));
  } finally {
    await conn.end();
  }
}

main().catch((error) => {
  console.error(JSON.stringify({ success: false, error: error.message }, null, 2));
  process.exitCode = 1;
});
