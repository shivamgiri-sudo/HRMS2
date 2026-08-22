/**
 * sync-attendance-legacy.mjs
 *
 * INSERT IGNORE only — never deletes any data.
 *
 * Mirrors db_bill attendance tables → mas_hrms.attendance_legacy_snapshot
 *   Source 1: db_bill.Attandence      (~1.49M rows)
 *   Source 2: db_bill.Attandence_old  (~774K rows)
 *
 * NOTE: attendance_daily_record has UNIQUE(employee_id, record_date) with live
 * HRMS/cosec/APR data. Legacy db_bill attendance goes to its own snapshot table
 * so reports can query historical data without conflicting with live records.
 *
 * Usage:
 *   node backend/scripts/sync-attendance-legacy.mjs --hrms-host=122.184.128.90
 *   node backend/scripts/sync-attendance-legacy.mjs --source=Attandence_old
 *   node backend/scripts/sync-attendance-legacy.mjs --dry-run
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

const HRMS_HOST  = arg('hrms-host', process.env.DB_HOST ?? fromEnvFile('DB_HOST') ?? '122.184.128.90');
const BILL_HOST  = arg('bill-host', '14.97.30.236');
const DB_USER    = process.env.DB_USER     ?? fromEnvFile('DB_USER');
const DB_PASS    = process.env.DB_PASSWORD ?? fromEnvFile('DB_PASSWORD');
const DRY_RUN    = process.argv.includes('--dry-run');
const SOURCE_ARG = arg('source', null); // pass --source=Attandence_old to run just one
const PAGE       = 5000;
const BATCH      = 1000;

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }

async function ensureTable(hrms) {
  await hrms.execute(`
    CREATE TABLE IF NOT EXISTS attendance_legacy_snapshot (
      id             BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
      source_table   VARCHAR(30)     NOT NULL,  -- 'Attandence' or 'Attandence_old'
      source_id      INT UNSIGNED    NOT NULL,  -- original Id from db_bill
      bio_code       VARCHAR(50)     DEFAULT NULL,
      employee_code  VARCHAR(50)     DEFAULT NULL,
      cost_center    VARCHAR(255)    DEFAULT NULL,
      employee_name  VARCHAR(255)    DEFAULT NULL,
      branch_name    VARCHAR(255)    DEFAULT NULL,
      in_time        DATETIME        DEFAULT NULL,
      out_time       DATETIME        DEFAULT NULL,
      status         VARCHAR(20)     DEFAULT NULL,
      old_status     VARCHAR(20)     DEFAULT NULL,
      attend_date    DATE            DEFAULT NULL,
      emp_status     VARCHAR(50)     DEFAULT NULL,
      import_date    DATETIME        DEFAULT NULL,
      pending_status VARCHAR(50)     DEFAULT NULL,
      synced_at      DATETIME        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_src (source_table, source_id),
      KEY idx_emp    (employee_code),
      KEY idx_date   (attend_date),
      KEY idx_branch (branch_name),
      KEY idx_emp_date (employee_code, attend_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `);
}

async function syncTable(bill, hrms, tbl) {
  const [[{total}]] = await bill.execute(`SELECT COUNT(*) total FROM ${tbl}`);
  const [[{existing}]] = await hrms.execute(
    `SELECT COUNT(*) existing FROM attendance_legacy_snapshot WHERE source_table = ?`, [tbl]);
  log(`  ${tbl}: bill=${total}  hrms_existing=${existing}  gap=${total - existing}`);

  if (DRY_RUN) { log('  [DRY-RUN] skipping'); return; }

  let offset = 0, inserted = 0, batchNum = 0;
  while (true) {
    const [rows] = await bill.execute(`
      SELECT Id AS source_id, BioCode AS bio_code, EmpCode AS employee_code,
             CostCenter AS cost_center, EmpName AS employee_name, BranchName AS branch_name,
             Intime AS in_time, OutTime AS out_time, Status AS status,
             OldStatus AS old_status, AttandDate AS attend_date, EmpStatus AS emp_status,
             ImportDate AS import_date, PendingStatus AS pending_status
      FROM ${tbl}
      ORDER BY Id LIMIT ${PAGE} OFFSET ${offset}
    `);
    if (!rows.length) break;

    // Add source_table field
    const mapped = rows.map(r => ({ source_table: tbl, ...r }));

    // Batch INSERT IGNORE
    for (let i = 0; i < mapped.length; i += BATCH) {
      const b = mapped.slice(i, i + BATCH);
      const keys = Object.keys(b[0]);
      const ph = b.map(() => `(${keys.map(() => '?').join(',')})`).join(',');
      const vals = b.flatMap(r => keys.map(k => r[k]));
      const [res] = await hrms.execute(
        `INSERT IGNORE INTO attendance_legacy_snapshot (${keys.join(',')}) VALUES ${ph}`, vals);
      inserted += res.affectedRows;
    }

    batchNum++;
    offset += rows.length;
    if (batchNum % 50 === 0) {
      log(`  ${tbl}: ${offset.toLocaleString()}/${total.toLocaleString()} processed, ${inserted.toLocaleString()} inserted`);
    }
    if (rows.length < PAGE) break;
  }

  log(`  ${tbl} DONE: ${inserted.toLocaleString()} rows inserted.`);
}

async function main() {
  log(`Connecting HRMS=${HRMS_HOST}  db_bill=${BILL_HOST}${DRY_RUN ? ' [DRY-RUN]' : ''}`);
  const hrms = await mysql.createPool({
    host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'mas_hrms',
    connectTimeout: 30000, waitForConnections: true, connectionLimit: 3,
  });
  const bill = await mysql.createPool({
    host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS, database: 'db_bill',
    connectTimeout: 30000, waitForConnections: true, connectionLimit: 3, dateStrings: true,
  });
  log('Connected.\n');

  try {
    await ensureTable(hrms);
    log('attendance_legacy_snapshot table ready.\n');

    const sources = SOURCE_ARG ? [SOURCE_ARG] : ['Attandence', 'Attandence_old'];

    for (const tbl of sources) {
      log(`--- Syncing ${tbl} ---`);
      await syncTable(bill, hrms, tbl);
      log('');
    }

    // Final counts
    const [[{total}]] = await hrms.execute('SELECT COUNT(*) total FROM attendance_legacy_snapshot');
    const [[{att}]]   = await hrms.execute("SELECT COUNT(*) att FROM attendance_legacy_snapshot WHERE source_table='Attandence'");
    const [[{old}]]   = await hrms.execute("SELECT COUNT(*) old FROM attendance_legacy_snapshot WHERE source_table='Attandence_old'");
    log('══════════════════════════════════════════');
    log(`attendance_legacy_snapshot TOTAL : ${total.toLocaleString()}`);
    log(`  from Attandence               : ${att.toLocaleString()}`);
    log(`  from Attandence_old           : ${old.toLocaleString()}`);

    const [[{bTotal}]] = await bill.execute('SELECT COUNT(*) bTotal FROM Attandence');
    const [[{bOld}]]   = await bill.execute('SELECT COUNT(*) bOld FROM Attandence_old');
    log(`db_bill Attandence              : ${bTotal.toLocaleString()}`);
    log(`db_bill Attandence_old          : ${bOld.toLocaleString()}`);

  } finally {
    await hrms.end();
    await bill.end();
  }
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });
