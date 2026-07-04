import mysql from 'mysql2/promise';

const DB_CONFIG = {
  host: process.env.E2E_DB_HOST ?? 'localhost',
  port: Number(process.env.E2E_DB_PORT ?? 3306),
  user: process.env.E2E_DB_USER ?? 'root',
  password: process.env.E2E_DB_PASSWORD ?? '',
  database: process.env.E2E_DB_NAME ?? 'mas_hrms',
};

let pool: mysql.Pool | null = null;

async function getPool(): Promise<mysql.Pool> {
  if (!pool) {
    pool = mysql.createPool({
      ...DB_CONFIG,
      waitForConnections: true,
      connectionLimit: 2,
      enableKeepAlive: true,
    });
  }
  return pool;
}

export async function query(sql: string, params?: any[]): Promise<any[]> {
  const p = await getPool();
  const [rows] = await p.execute(sql, params || []);
  return rows as any[];
}

export async function queryOne(sql: string, params?: any[]): Promise<any | null> {
  const rows = await query(sql, params);
  return rows.length > 0 ? rows[0] : null;
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

const VERIFY_TABLES = [
  'ats_candidate',
  'ats_onboarding_request',
  'candidate_onboarding_profile',
  'candidate_onboarding_document',
  'ats_employment_offer',
  'ats_onboarding_bridge',
  'employees',
  'employee_joining_document_checklist',
  'employee_joining_document_file',
  'employee_document_esign_transaction',
  'employee_joining_document_public_token',
  'employee_joining_document_audit_log',
  'employee_epf_compliance_profile',
  'employee_epf_form_instance',
  'employee_epf_nominee',
  'employee_epf_validation_result',
  'employee_epf_consent_receipt',
  'employee_epf_audit_log',
];

export async function verifyRecord(table: string, condition: string, params: any[]): Promise<any | null> {
  try {
    return await queryOne(`SELECT * FROM \`${table}\` WHERE ${condition} LIMIT 1`, params);
  } catch (err: any) {
    console.warn(`DB verify failed for ${table}: ${err.message}`);
    return null;
  }
}

export { VERIFY_TABLES };
