/**
 * sync-incentive-deduction-from-dbbill.mjs
 *
 * INSERT IGNORE only — never deletes any data.
 *
 * Syncs three tables from db_bill → mas_hrms:
 *   1. upload_incentive_breakup → incentive_upload_snapshot   (fills 1,718 missing rows)
 *   2. upload_deduction         → upload_deduction_snapshot   (13,175 rows, new table)
 *   3. qual_incentive           → qual_incentive_snapshot     (3,372 rows, new table)
 *
 * Usage:
 *   node backend/scripts/sync-incentive-deduction-from-dbbill.mjs
 *   node backend/scripts/sync-incentive-deduction-from-dbbill.mjs --hrms-host=122.184.128.90
 *   node backend/scripts/sync-incentive-deduction-from-dbbill.mjs --dry-run
 */

import mysql from 'mysql2/promise';
import fs    from 'fs';
import path  from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnvFile(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'));
    return m?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const HRMS_HOST = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '192.168.10.6');
const BILL_HOST = arg('bill-host', process.env.BILL_DB_HOST ?? fromEnvFile('BILL_DB_HOST') ?? '192.168.10.22');
const DB_USER   = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS   = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const DRY_RUN   = process.argv.includes('--dry-run');
const PAGE_SIZE = 2000;
const BATCH     = 500;

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }

async function upsertBatch(hrms, table, rows) {
  if (rows.length === 0 || DRY_RUN) return 0;
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH) {
    const batch = rows.slice(i, i + BATCH);
    const keys = Object.keys(batch[0]);
    const ph = batch.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
    const vals = batch.flatMap(r => keys.map(k => r[k]));
    const [res] = await hrms.execute(
      `INSERT IGNORE INTO ${table} (${keys.join(',')}) VALUES ${ph}`,
      vals
    );
    inserted += res.affectedRows;
  }
  return inserted;
}

// ─── 1. upload_incentive_breakup → incentive_upload_snapshot ─────────────────
async function syncIncentive(bill, hrms) {
  log('Syncing upload_incentive_breakup → incentive_upload_snapshot ...');

  const [total] = await bill.execute('SELECT COUNT(*) as c FROM upload_incentive_breakup');
  const [existing] = await hrms.execute('SELECT COUNT(*) as c FROM incentive_upload_snapshot');
  log(`  db_bill: ${total[0].c}  mas_hrms existing: ${existing[0].c}  expected gap: ${total[0].c - existing[0].c}`);

  if (DRY_RUN) { log('  [DRY-RUN] skipping insert'); return 0; }

  let offset = 0, totalInserted = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, BranchName AS branch_name, CostCenter AS cost_center,
             EmpCode AS employee_code, EmpName AS employee_name,
             IncentiveType AS incentive_type, Amount AS amount,
             SalaryMonth AS salary_month, Remarks AS remarks,
             ApproveStatus AS approve_status, UploadType AS upload_type,
             ImportDate AS import_date
      FROM upload_incentive_breakup
      ORDER BY Id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    if (rows.length === 0) break;
    const inserted = await upsertBatch(hrms, 'incentive_upload_snapshot', rows);
    totalInserted += inserted;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  log(`  Done. Inserted ${totalInserted} new rows (${total[0].c} total in db_bill).`);
  return totalInserted;
}

// ─── 2. upload_deduction → upload_deduction_snapshot ─────────────────────────
async function syncDeduction(bill, hrms) {
  log('Syncing upload_deduction → upload_deduction_snapshot ...');

  const [total] = await bill.execute('SELECT COUNT(*) as c FROM upload_deduction');
  const [existing] = await hrms.execute('SELECT COUNT(*) as c FROM upload_deduction_snapshot');
  log(`  db_bill: ${total[0].c}  mas_hrms existing: ${existing[0].c}  gap: ${total[0].c - existing[0].c}`);

  if (DRY_RUN) { log('  [DRY-RUN] skipping insert'); return 0; }

  let offset = 0, totalInserted = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT Id AS id, BranchName AS branch_name, CostCenter AS cost_center,
             EmpCode AS employee_code, EmpName AS employee_name,
             DATE_FORMAT(SalaryMonth,'%Y-%m') AS salary_month,
             MobileDeduction AS mobile_deduction,
             ShortCollection AS short_collection,
             AssetRecovery AS asset_recovery,
             Insurance AS insurance,
             ProfessionalTax AS professional_tax,
             LeaveDeduction AS leave_deduction,
             OthersDeduction AS others_deduction,
             Remarks AS remarks,
             DeductionRemarks AS deduction_remarks,
             ProcessStatus AS process_status,
             ImportDate AS import_date
      FROM upload_deduction
      ORDER BY Id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    if (rows.length === 0) break;
    const inserted = await upsertBatch(hrms, 'upload_deduction_snapshot', rows);
    totalInserted += inserted;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  log(`  Done. Inserted ${totalInserted} new rows (${total[0].c} total in db_bill).`);
  return totalInserted;
}

// ─── 3. qual_incentive → qual_incentive_snapshot ──────────────────────────────
async function syncQualIncentive(bill, hrms) {
  log('Syncing qual_incentive → qual_incentive_snapshot ...');

  const [total] = await bill.execute('SELECT COUNT(*) as c FROM qual_incentive');
  const [existing] = await hrms.execute('SELECT COUNT(*) as c FROM qual_incentive_snapshot');
  log(`  db_bill: ${total[0].c}  mas_hrms existing: ${existing[0].c}  gap: ${total[0].c - existing[0].c}`);

  if (DRY_RUN) { log('  [DRY-RUN] skipping insert'); return 0; }

  let offset = 0, totalInserted = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT id, EmpCode AS employee_code,
             Salyear AS sal_year, salmonth AS sal_month,
             incamt AS amount, Remarks AS remarks,
             Importdate AS import_date
      FROM qual_incentive
      ORDER BY id
      LIMIT ${PAGE_SIZE} OFFSET ${offset}
    `);
    if (rows.length === 0) break;
    const inserted = await upsertBatch(hrms, 'qual_incentive_snapshot', rows);
    totalInserted += inserted;
    offset += rows.length;
    if (rows.length < PAGE_SIZE) break;
  }
  log(`  Done. Inserted ${totalInserted} new rows (${total[0].c} total in db_bill).`);
  return totalInserted;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  const hrms = await mysql.createPool({ host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms', connectTimeout: 30000, waitForConnections: true, connectionLimit: 3 });
  const bill = await mysql.createPool({ host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',  connectTimeout: 30000, waitForConnections: true, connectionLimit: 3, dateStrings: true });
  log('Connected.\n');

  try {
    // Create new tables if needed (run migration first — or they already exist)
    await hrms.execute(`
      CREATE TABLE IF NOT EXISTS upload_deduction_snapshot (
        id              INT UNSIGNED  NOT NULL,
        branch_name     VARCHAR(255)  DEFAULT NULL,
        cost_center     VARCHAR(255)  DEFAULT NULL,
        employee_code   VARCHAR(50)   DEFAULT NULL,
        employee_name   VARCHAR(255)  DEFAULT NULL,
        salary_month    VARCHAR(20)   DEFAULT NULL,
        mobile_deduction      DECIMAL(12,2) DEFAULT 0,
        short_collection      DECIMAL(12,2) DEFAULT 0,
        asset_recovery        DECIMAL(12,2) DEFAULT 0,
        insurance             DECIMAL(12,2) DEFAULT 0,
        professional_tax      DECIMAL(12,2) DEFAULT 0,
        leave_deduction       DECIMAL(12,2) DEFAULT 0,
        others_deduction      DECIMAL(12,2) DEFAULT 0,
        remarks               VARCHAR(500)  DEFAULT NULL,
        deduction_remarks     VARCHAR(500)  DEFAULT NULL,
        process_status        VARCHAR(50)   DEFAULT NULL,
        import_date           DATETIME      DEFAULT NULL,
        synced_at             DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_emp   (employee_code),
        KEY idx_month (salary_month),
        KEY idx_branch(branch_name)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await hrms.execute(`
      CREATE TABLE IF NOT EXISTS qual_incentive_snapshot (
        id            INT UNSIGNED  NOT NULL,
        employee_code VARCHAR(50)   DEFAULT NULL,
        sal_year      VARCHAR(10)   DEFAULT NULL,
        sal_month     VARCHAR(10)   DEFAULT NULL,
        amount        DECIMAL(12,2) DEFAULT 0,
        remarks       VARCHAR(500)  DEFAULT NULL,
        import_date   DATETIME      DEFAULT NULL,
        synced_at     DATETIME      DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_emp  (employee_code),
        KEY idx_year (sal_year)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
    `);

    await syncIncentive(bill, hrms);
    log('');
    await syncDeduction(bill, hrms);
    log('');
    await syncQualIncentive(bill, hrms);

    log('\n══════════════════════════════════════════════');
    log('FINAL COUNTS in mas_hrms:');
    const [fi] = await hrms.execute('SELECT COUNT(*) as c FROM incentive_upload_snapshot');
    const [fd] = await hrms.execute('SELECT COUNT(*) as c FROM upload_deduction_snapshot');
    const [fq] = await hrms.execute('SELECT COUNT(*) as c FROM qual_incentive_snapshot');
    log(`  incentive_upload_snapshot   : ${fi[0].c}`);
    log(`  upload_deduction_snapshot   : ${fd[0].c}`);
    log(`  qual_incentive_snapshot     : ${fq[0].c}`);

    log('\ndb_bill source counts:');
    const [bi] = await bill.execute('SELECT COUNT(*) as c FROM upload_incentive_breakup');
    const [bd] = await bill.execute('SELECT COUNT(*) as c FROM upload_deduction');
    const [bq] = await bill.execute('SELECT COUNT(*) as c FROM qual_incentive');
    log(`  upload_incentive_breakup    : ${bi[0].c}`);
    log(`  upload_deduction            : ${bd[0].c}`);
    log(`  qual_incentive              : ${bq[0].c}`);

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
