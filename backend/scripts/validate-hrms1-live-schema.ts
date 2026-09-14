import 'dotenv/config';
import mysql from 'mysql2/promise';

type Status = 'ok' | 'warning' | 'error';

type Check = {
  area: string;
  status: Status;
  message: string;
  details?: Record<string, unknown>;
};

const EXPECTED_TABLES = [
  'employees',
  'auth_user',
  'user_roles',
  'attendance_daily_record',
  'attendance_regularization',
  'attendance_rule_config',
  'leave_balance_ledger',
  'leave_request',
  'leave_type_master',
  'salary_prep_run',
  'salary_prep_line',
  'salary_prep_line_component',
  'salary_payslip',
  'payroll_calculation_audit',
  'payroll_register_export_log',
  'integration_config',
  'integration_biometric_daily',
  'employee_documents',
  'employee_document_access_log',
  'approval_request',
  'approval_action_log',
  'access_requests',
  'account_control_log',
];

const PROFILE_PHOTO_COLUMNS = ['avatar_url', 'photo_url'];
const EMPLOYEE_FILTER_COLUMNS = ['branch_id', 'process_id', 'cost_centre_id', 'department_id', 'date_of_joining', 'date_of_exit', 'employment_status', 'active_status'];
const PAYROLL_COMPONENT_COLUMNS = ['prep_line_id', 'component_code', 'component_name', 'component_type', 'amount'];
const ATTENDANCE_COLUMNS = ['employee_id', 'record_date', 'attendance_status', 'first_in_time', 'last_out_time'];
const LEAVE_LEDGER_COLUMNS = ['employee_id', 'leave_code', 'valid_for', 'opening_balance', 'accrued_days', 'used_days'];

function readEnv(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required in backend/.env`);
}

function readNumberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

async function tableExists(conn: mysql.Connection, schema: string, table: string): Promise<boolean> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count FROM information_schema.tables WHERE table_schema = ? AND table_name = ?`,
    [schema, table],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function getColumns(conn: mysql.Connection, schema: string, table: string): Promise<string[]> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT column_name FROM information_schema.columns WHERE table_schema = ? AND table_name = ?`,
    [schema, table],
  );
  return rows.map((row) => String(row.column_name));
}

async function countRows(conn: mysql.Connection, table: string): Promise<number | null> {
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${table}\``);
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

async function checkRequiredTables(conn: mysql.Connection, schema: string): Promise<Check[]> {
  const checks: Check[] = [];
  for (const table of EXPECTED_TABLES) {
    const exists = await tableExists(conn, schema, table);
    checks.push({
      area: `table.${table}`,
      status: exists ? 'ok' : 'warning',
      message: exists ? `${table} exists.` : `${table} missing or named differently.`,
      details: exists ? { rows: await countRows(conn, table) } : undefined,
    });
  }
  return checks;
}

async function checkColumnSet(conn: mysql.Connection, schema: string, table: string, expected: string[], area: string): Promise<Check> {
  if (!(await tableExists(conn, schema, table))) {
    return { area, status: 'error', message: `${table} table is missing.` };
  }
  const columns = await getColumns(conn, schema, table);
  const missing = expected.filter((col) => !columns.includes(col));
  return {
    area,
    status: missing.length ? 'warning' : 'ok',
    message: missing.length ? `${table} is missing expected columns.` : `${table} has expected columns.`,
    details: { expected, missing, found: expected.filter((col) => columns.includes(col)) },
  };
}

async function checkProfilePhoto(conn: mysql.Connection, schema: string): Promise<Check[]> {
  const columns = await getColumns(conn, schema, 'employees');
  const missing = PROFILE_PHOTO_COLUMNS.filter((col) => !columns.includes(col));
  const checks: Check[] = [{
    area: 'profile.photo.columns',
    status: missing.length ? 'warning' : 'ok',
    message: missing.length
      ? 'Profile photo storage is partially mapped. Keep avatar_url and photo_url synchronized.'
      : 'Profile photo columns avatar_url and photo_url are available.',
    details: { expected: PROFILE_PHOTO_COLUMNS, missing },
  }];

  if (columns.includes('avatar_url') && columns.includes('photo_url')) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS mismatch_count
         FROM employees
        WHERE COALESCE(avatar_url, '') <> COALESCE(photo_url, '')
          AND (COALESCE(avatar_url, '') <> '' OR COALESCE(photo_url, '') <> '')`,
    );
    checks.push({
      area: 'profile.photo.sync',
      status: Number(rows[0]?.mismatch_count ?? 0) > 0 ? 'warning' : 'ok',
      message: 'Checked avatar_url/photo_url synchronization.',
      details: { mismatchCount: Number(rows[0]?.mismatch_count ?? 0) },
    });
  }

  return checks;
}

async function checkReports(conn: mysql.Connection): Promise<Check[]> {
  const year = Number(process.env.REPORT_YEAR ?? new Date().getFullYear());
  const start = `${year}-01-01`;
  const [activeRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS active_as_of_year_start
       FROM employees
      WHERE active_status = 1
        AND date_of_joining <= ?
        AND (date_of_exit IS NULL OR date_of_exit >= ?)
        AND LOWER(COALESCE(employment_status, 'active')) NOT IN ('terminated','inactive','offboarded','absconded')`,
    [start, start],
  );

  const [terminationRows] = await conn.query<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS termination_count
       FROM employees
      WHERE (date_of_exit IS NOT NULL OR date_of_leaving IS NOT NULL OR resignation_date IS NOT NULL)`,
  );

  return [
    {
      area: 'reports.start_of_year_active_count',
      status: 'ok',
      message: `Active employee count as of ${start} calculated from employees table.`,
      details: { year, activeAsOfYearStart: Number(activeRows[0]?.active_as_of_year_start ?? 0) },
    },
    {
      area: 'reports.termination_count',
      status: 'ok',
      message: 'Termination/exit count calculated from employee exit fields.',
      details: { terminationCount: Number(terminationRows[0]?.termination_count ?? 0) },
    },
  ];
}

async function main() {
  const database = readEnv('DB_NAME', readEnv('MYSQL_DATABASE', 'mas_hrms'));
  const conn = await mysql.createConnection({
    host: readEnv('DB_HOST', readEnv('MYSQL_HOST', 'localhost')),
    port: readNumberEnv('DB_PORT', readNumberEnv('MYSQL_PORT', 3306)),
    user: readEnv('DB_USER', readEnv('MYSQL_USER', 'root')),
    password: readEnv('DB_PASSWORD', process.env.MYSQL_PASSWORD ?? ''),
    database,
    multipleStatements: false,
  });

  const checks: Check[] = [];
  try {
    checks.push(...await checkRequiredTables(conn, database));
    checks.push(await checkColumnSet(conn, database, 'employees', EMPLOYEE_FILTER_COLUMNS, 'employees.report_filters'));
    checks.push(await checkColumnSet(conn, database, 'attendance_daily_record', ATTENDANCE_COLUMNS, 'attendance.daily_record'));
    checks.push(await checkColumnSet(conn, database, 'leave_balance_ledger', LEAVE_LEDGER_COLUMNS, 'leave.balance_ledger'));
    checks.push(await checkColumnSet(conn, database, 'salary_prep_line_component', PAYROLL_COMPONENT_COLUMNS, 'payroll.component_breakdown'));
    checks.push(...await checkProfilePhoto(conn, database));
    checks.push(...await checkReports(conn));
  } finally {
    await conn.end();
  }

  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    error: checks.filter((check) => check.status === 'error').length,
  };

  console.log(JSON.stringify({ generatedAt: new Date().toISOString(), database, summary, checks }, null, 2));
  if (summary.error > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'error', message: error.message }, null, 2));
  process.exitCode = 1;
});
