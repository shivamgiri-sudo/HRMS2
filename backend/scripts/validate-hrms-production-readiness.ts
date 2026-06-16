import 'dotenv/config';
import mysql from 'mysql2/promise';

type Status = 'ok' | 'warning' | 'error';

type Check = {
  area: string;
  status: Status;
  message: string;
  details?: Record<string, unknown>;
};

function env(name: string, fallback?: string): string {
  const value = process.env[name]?.trim();
  if (value) return value;
  if (fallback !== undefined) return fallback;
  throw new Error(`${name} is required in backend/.env`);
}

function numberEnv(name: string, fallback: number): number {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number`);
  return parsed;
}

const REQUIRED_TABLES = [
  'employees',
  'auth_user',
  'user_roles',
  'attendance_daily',
  'leave_balance',
  'salary_prep_run',
  'salary_prep_line',
  'salary_prep_line_component',
  'audit_log',
  'integration_config',
];

const SENSITIVE_COLUMNS = [
  'aadhaar',
  'aadhar',
  'pan',
  'bank',
  'account',
  'ifsc',
  'salary',
  'mobile',
  'phone',
  'address',
];

async function tableExists(conn: mysql.Connection, schema: string, tableName: string): Promise<boolean> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = ? AND table_name = ?`,
    [schema, tableName],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function getColumns(conn: mysql.Connection, schema: string, tableName: string): Promise<string[]> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = ? AND table_name = ?`,
    [schema, tableName],
  );
  return rows.map((row) => String(row.column_name));
}

function pickColumn(columns: string[], candidates: string[]): string | null {
  const lower = new Map(columns.map((column) => [column.toLowerCase(), column]));
  for (const candidate of candidates) {
    const match = lower.get(candidate.toLowerCase());
    if (match) return match;
  }
  return null;
}

async function safeCount(conn: mysql.Connection, tableName: string): Promise<number | null> {
  try {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(`SELECT COUNT(*) AS count FROM \`${tableName}\``);
    return Number(rows[0]?.count ?? 0);
  } catch {
    return null;
  }
}

async function validateTables(conn: mysql.Connection, schema: string): Promise<Check[]> {
  const checks: Check[] = [];
  for (const table of REQUIRED_TABLES) {
    const exists = await tableExists(conn, schema, table);
    if (!exists) {
      checks.push({ area: `table:${table}`, status: 'warning', message: `Expected table ${table} was not found.` });
      continue;
    }
    checks.push({
      area: `table:${table}`,
      status: 'ok',
      message: `Table ${table} exists.`,
      details: { rows: await safeCount(conn, table) },
    });
  }
  return checks;
}

async function validateEmployees(conn: mysql.Connection, schema: string): Promise<Check[]> {
  if (!(await tableExists(conn, schema, 'employees'))) {
    return [{ area: 'employees', status: 'error', message: 'employees table missing. Employee/report logic cannot be validated.' }];
  }

  const columns = await getColumns(conn, schema, 'employees');
  const statusColumn = pickColumn(columns, ['active_status', 'status', 'employee_status', 'employment_status']);
  const joinDateColumn = pickColumn(columns, ['date_of_joining', 'joining_date', 'doj', 'join_date']);
  const exitDateColumn = pickColumn(columns, ['date_of_exit', 'exit_date', 'termination_date', 'last_working_day', 'lwd']);
  const branchColumn = pickColumn(columns, ['branch_id', 'branch', 'location_id', 'work_location']);
  const processColumn = pickColumn(columns, ['process_id', 'process', 'client_process']);
  const costCentreColumn = pickColumn(columns, ['cost_centre', 'cost_center', 'cost_centre_id', 'cost_center_id']);

  const checks: Check[] = [];
  checks.push({
    area: 'employees.columns',
    status: statusColumn && joinDateColumn ? 'ok' : 'warning',
    message: statusColumn && joinDateColumn
      ? 'Employee status and joining date columns found.'
      : 'Employee active-count logic needs status and joining date columns mapped.',
    details: { statusColumn, joinDateColumn, exitDateColumn, branchColumn, processColumn, costCentreColumn },
  });

  if (statusColumn && joinDateColumn) {
    const today = new Date().toISOString().slice(0, 10);
    const yearStart = `${new Date().getFullYear()}-01-01`;
    const exitClause = exitDateColumn ? `AND (\`${exitDateColumn}\` IS NULL OR \`${exitDateColumn}\` > ?)` : '';
    const params = exitDateColumn ? [yearStart, yearStart] : [yearStart];
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT COUNT(*) AS count
         FROM employees
        WHERE \`${joinDateColumn}\` <= ?
          ${exitClause}`,
      params,
    );
    checks.push({
      area: 'reports.start_of_year_active_count',
      status: 'ok',
      message: 'Start-of-year active employee count query can be evaluated from employee dates.',
      details: { asOfDate: yearStart, count: Number(rows[0]?.count ?? 0), today },
    });
  }

  if (!branchColumn || !processColumn || !costCentreColumn) {
    checks.push({
      area: 'reports.filters',
      status: 'warning',
      message: 'Branch, process, and cost-centre filters are not fully mapped in employees table.',
      details: { branchColumn, processColumn, costCentreColumn },
    });
  }

  return checks;
}

async function validateAttendance(conn: mysql.Connection, schema: string): Promise<Check[]> {
  if (!(await tableExists(conn, schema, 'attendance_daily'))) {
    return [{ area: 'attendance', status: 'warning', message: 'attendance_daily table missing. Attendance page/report will not show authoritative daily data.' }];
  }
  const columns = await getColumns(conn, schema, 'attendance_daily');
  const employeeColumn = pickColumn(columns, ['employee_id', 'emp_id', 'employee_code']);
  const dateColumn = pickColumn(columns, ['attendance_date', 'date', 'work_date']);
  const statusColumn = pickColumn(columns, ['status', 'attendance_status', 'day_status']);

  const checks: Check[] = [{
    area: 'attendance.columns',
    status: employeeColumn && dateColumn ? 'ok' : 'warning',
    message: employeeColumn && dateColumn ? 'Attendance employee/date columns found.' : 'Attendance employee/date columns need mapping.',
    details: { employeeColumn, dateColumn, statusColumn },
  }];

  if (dateColumn) {
    const [rows] = await conn.query<mysql.RowDataPacket[]>(
      `SELECT MIN(\`${dateColumn}\`) AS first_date, MAX(\`${dateColumn}\`) AS last_date, COUNT(*) AS rows_count FROM attendance_daily`,
    );
    checks.push({
      area: 'attendance.coverage',
      status: 'ok',
      message: 'Attendance date coverage checked.',
      details: rows[0],
    });
  }

  return checks;
}

async function validatePayroll(conn: mysql.Connection, schema: string): Promise<Check[]> {
  const checks: Check[] = [];
  const hasRun = await tableExists(conn, schema, 'salary_prep_run');
  const hasLine = await tableExists(conn, schema, 'salary_prep_line');
  const hasComponent = await tableExists(conn, schema, 'salary_prep_line_component');

  checks.push({
    area: 'payroll.tables',
    status: hasRun && hasLine && hasComponent ? 'ok' : 'error',
    message: hasRun && hasLine && hasComponent
      ? 'Payroll run, line, and component tables exist.'
      : 'Payroll component tables are incomplete; payslip breakdown and trend logic may be wrong.',
    details: { hasRun, hasLine, hasComponent },
  });

  if (hasComponent) {
    const columns = await getColumns(conn, schema, 'salary_prep_line_component');
    const amountColumn = pickColumn(columns, ['amount', 'component_amount', 'value']);
    const componentColumn = pickColumn(columns, ['component_code', 'component_name', 'salary_component_id']);
    checks.push({
      area: 'payroll.components',
      status: amountColumn && componentColumn ? 'ok' : 'warning',
      message: amountColumn && componentColumn
        ? 'Payroll component amount and component identifier columns found.'
        : 'Payroll component breakdown columns need mapping before payslip validation.',
      details: { amountColumn, componentColumn },
    });
  }

  return checks;
}

async function validateSensitiveColumns(conn: mysql.Connection, schema: string): Promise<Check[]> {
  const [rows] = await conn.execute<mysql.RowDataPacket[]>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = ?`,
    [schema],
  );
  const matches = rows.filter((row) => {
    const column = String(row.column_name).toLowerCase();
    return SENSITIVE_COLUMNS.some((token) => column.includes(token));
  });

  return [{
    area: 'data_security.sensitive_columns',
    status: matches.length > 0 ? 'warning' : 'ok',
    message: matches.length > 0
      ? 'Sensitive columns detected. Confirm masking, scoped access, and export controls.'
      : 'No obvious sensitive column names detected by naming scan.',
    details: { count: matches.length, sample: matches.slice(0, 25) },
  }];
}

async function main() {
  const database = env('DB_NAME', env('MYSQL_DATABASE', 'mas_hrms'));
  const conn = await mysql.createConnection({
    host: env('DB_HOST', env('MYSQL_HOST', 'localhost')),
    port: numberEnv('DB_PORT', numberEnv('MYSQL_PORT', 3306)),
    user: env('DB_USER', env('MYSQL_USER', 'root')),
    password: env('DB_PASSWORD', process.env.MYSQL_PASSWORD ?? ''),
    database,
    multipleStatements: false,
  });

  const checks: Check[] = [];
  try {
    checks.push(...await validateTables(conn, database));
    checks.push(...await validateEmployees(conn, database));
    checks.push(...await validateAttendance(conn, database));
    checks.push(...await validatePayroll(conn, database));
    checks.push(...await validateSensitiveColumns(conn, database));
  } finally {
    await conn.end();
  }

  const summary = {
    ok: checks.filter((check) => check.status === 'ok').length,
    warning: checks.filter((check) => check.status === 'warning').length,
    error: checks.filter((check) => check.status === 'error').length,
  };

  const result = {
    generatedAt: new Date().toISOString(),
    database,
    summary,
    checks,
  };

  console.log(JSON.stringify(result, null, 2));
  if (summary.error > 0) process.exitCode = 1;
}

main().catch((error) => {
  console.error(JSON.stringify({ status: 'error', message: error.message }, null, 2));
  process.exitCode = 1;
});
