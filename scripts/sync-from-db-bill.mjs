/**
 * db_bill → mas_hrms Full Sync
 *
 * Syncs: branches, departments, designations, cost centres, processes, employees
 * Safe to run repeatedly — uses UPSERT everywhere, never deletes.
 *
 * Usage:
 *   node scripts/sync-from-db-bill.mjs              # full sync
 *   node scripts/sync-from-db-bill.mjs --dry-run    # show counts only
 *   node scripts/sync-from-db-bill.mjs --entity branches   # single entity
 *
 * Auto-sync (cron): add to crontab or Windows Task Scheduler
 *   cron: 0,30 each hour — node /path/to/sync-from-db-bill.mjs >> /var/log/hrms-sync.log 2>&1
 */

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Resolve mysql2 from backend/node_modules regardless of cwd
const require = createRequire(path.resolve(__dirname, '../backend/package.json'));

// ── Load backend .env ─────────────────────────────────────────────────────────
const envPath = path.resolve(process.cwd(), 'backend/.env');
if (fs.existsSync(envPath)) {
  for (const line of fs.readFileSync(envPath, 'utf8').split('\n')) {
    const m = line.match(/^([^#=\s]+)\s*=\s*"?([^"\r\n]*)"?\s*$/);
    if (m) process.env[m[1]] = m[2];
  }
}

const mysql = require('mysql2/promise');

function requiredEnv(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

// ── Config ────────────────────────────────────────────────────────────────────
const SOURCE = {
  host: requiredEnv('BILL_DB_HOST'),
  port: Number(process.env.BILL_DB_PORT || 3306),
  user: requiredEnv('BILL_DB_USER'),
  password: requiredEnv('BILL_DB_PASSWORD'),
  database: requiredEnv('BILL_DB_NAME'),
};
const TARGET = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

const args        = process.argv.slice(2);
const DRY_RUN     = args.includes('--dry-run');
const ONLY_ENTITY = args.find(a => a.startsWith('--entity='))?.split('=')[1]
                 || (args.includes('--entity') ? args[args.indexOf('--entity') + 1] : null);

// ── Counters ──────────────────────────────────────────────────────────────────
const stats = { branches:0, departments:0, designations:0, cost_centres:0, processes:0,
                employees_inserted:0, employees_updated:0, employees_skipped:0, errors:0 };

function log(msg) { console.log(`[${new Date().toISOString()}] ${msg}`); }
function err(msg)  { console.error(`[${new Date().toISOString()}] ERROR: ${msg}`); stats.errors++; }

// ── Step 1: Add missing columns to employees ──────────────────────────────────
async function addMissingColumns(tgt) {
  log('Step 1: Ensuring bank/statutory columns exist on employees...');
  if (DRY_RUN) { log('  [DRY] would ALTER TABLE employees ADD COLUMN bank_account_number, ...'); return; }

  // Check existing columns first (ADD COLUMN IF NOT EXISTS needs MySQL 8.0.29+)
  const [existing] = await tgt.execute("SELECT COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=DATABASE() AND TABLE_NAME='employees'");
  const have = new Set(existing.map(r => r.COLUMN_NAME));

  const toAdd = [
    ['bank_account_number', 'varchar(30)   DEFAULT NULL'],
    ['bank_name',           'varchar(100)  DEFAULT NULL'],
    ['bank_branch',         'varchar(100)  DEFAULT NULL'],
    ['ifsc_code',           'varchar(20)   DEFAULT NULL'],
    ['account_holder_name', 'varchar(150)  DEFAULT NULL'],
    ['account_type',        'varchar(20)   DEFAULT NULL'],
    ['uan_number',          'varchar(30)   DEFAULT NULL'],
    ['epf_number',          'varchar(50)   DEFAULT NULL'],
    ['esic_number',         'varchar(30)   DEFAULT NULL'],
    ['aadhaar_number',      'varchar(20)   DEFAULT NULL'],
    ['date_of_leaving',     'date          DEFAULT NULL'],
    ['resignation_date',    'date          DEFAULT NULL'],
    ['ctc',                 'decimal(12,2) DEFAULT NULL'],
    ['gross_salary',        'decimal(12,2) DEFAULT NULL'],
    ['net_inhand',          'decimal(12,2) DEFAULT NULL'],
    ['blood_group',         'varchar(10)   DEFAULT NULL'],
    ['nominee_name',        'varchar(100)  DEFAULT NULL'],
    ['nominee_relation',    'varchar(50)   DEFAULT NULL'],
    ['address1',            'varchar(500)  DEFAULT NULL'],
    ['address2',            'varchar(500)  DEFAULT NULL'],
    ['city',                'varchar(100)  DEFAULT NULL'],
    ['state',               'varchar(100)  DEFAULT NULL'],
    ['pincode',             'varchar(10)   DEFAULT NULL'],
    ['father_name',         'varchar(100)  DEFAULT NULL'],
    ['office_email',        'varchar(255)  DEFAULT NULL'],
    ['emp_type',            'varchar(50)   DEFAULT NULL'],
    ['billable_status',     'varchar(10)   DEFAULT NULL'],
    ['cost_center_code',    'varchar(100)  DEFAULT NULL'],
    ['legacy_id',           'int           DEFAULT NULL'],
  ];

  let added = 0;
  for (const [col, def] of toAdd) {
    if (!have.has(col)) {
      await tgt.execute(`ALTER TABLE employees ADD COLUMN \`${col}\` ${def}`);
      log(`  Added column: ${col}`);
      added++;
    }
  }
  log(`  ${added} new columns added, ${toAdd.length - added} already existed.`);
}

// ── Step 2: Sync branches ─────────────────────────────────────────────────────
async function syncBranches(src, tgt) {
  log('Step 2: Syncing branches...');
  const [rows] = await src.execute(
    "SELECT id, branch_name, branch_code, state, branch_state, active FROM branch_master ORDER BY branch_name"
  );
  if (DRY_RUN) { log(`  [DRY] would upsert ${rows.length} branches`); return {}; }

  const branchMap = {}; // branch_name (uppercase) → uuid in mas_hrms
  for (const r of rows) {
    const code = (r.branch_code || r.branch_name).replace(/[^A-Z0-9_\-]/gi, '_').toUpperCase().substring(0, 50);
    const name = (r.branch_name || '').trim();
    const active = r.active == 1 ? 1 : 0;
    const state = r.branch_state || r.state || null;

    await tgt.execute(`
      INSERT INTO branch_master (id, branch_code, branch_name, state, active_status, created_at, updated_at)
      VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        branch_name   = VALUES(branch_name),
        state         = VALUES(state),
        active_status = VALUES(active_status),
        updated_at    = NOW()
    `, [code, name, state, active]);

    const [res] = await tgt.execute('SELECT id FROM branch_master WHERE branch_code = ?', [code]);
    if (res[0]) branchMap[name.toUpperCase()] = res[0].id;
    stats.branches++;
  }
  log(`  Upserted ${stats.branches} branches.`);
  return branchMap;
}

// ── Step 3: Sync departments ──────────────────────────────────────────────────
async function syncDepartments(src, tgt) {
  log('Step 3: Syncing departments...');
  const [rows] = await src.execute(
    "SELECT Id, Department, short_code, Status FROM Department_Master ORDER BY Department"
  );
  if (DRY_RUN) { log(`  [DRY] would upsert ${rows.length} departments`); return {}; }

  const deptMap = {}; // dept_name (uppercase) → uuid
  for (const r of rows) {
    const code   = (r.short_code || r.Department).replace(/[^A-Z0-9_]/gi,'_').toUpperCase().substring(0,50);
    const name   = (r.Department || '').trim();
    const active = r.Status == 1 ? 1 : 0;

    await tgt.execute(`
      INSERT INTO department_master (id, dept_code, dept_name, active_status, created_at, updated_at)
      VALUES (UUID(), ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        dept_name     = VALUES(dept_name),
        active_status = VALUES(active_status),
        updated_at    = NOW()
    `, [code, name, active]);

    const [res] = await tgt.execute('SELECT id FROM department_master WHERE dept_code = ?', [code]);
    if (res[0]) deptMap[name.toUpperCase()] = res[0].id;
    stats.departments++;
  }
  log(`  Upserted ${stats.departments} departments.`);
  return deptMap;
}

// ── Step 4: Sync designations ─────────────────────────────────────────────────
async function syncDesignations(src, tgt) {
  log('Step 4: Syncing designations...');
  const [rows] = await src.execute(
    "SELECT DISTINCT Designation, Band FROM Designation_Master WHERE Status='1' ORDER BY Designation"
  );
  if (DRY_RUN) { log(`  [DRY] would upsert ${rows.length} designations`); return {}; }

  const desigMap = {}; // designation_name (uppercase) → uuid
  for (const r of rows) {
    const name = (r.Designation || '').trim();
    const code = name.replace(/[^A-Z0-9_]/gi,'_').toUpperCase().substring(0,50);
    const band = r.Band || null;

    await tgt.execute(`
      INSERT INTO designation_master (id, designation_code, designation_name, grade, active_status, created_at, updated_at)
      VALUES (UUID(), ?, ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        designation_name = VALUES(designation_name),
        grade            = VALUES(grade),
        updated_at       = NOW()
    `, [code, name, band]);

    const [res] = await tgt.execute('SELECT id FROM designation_master WHERE designation_code = ?', [code]);
    if (res[0]) desigMap[name.toUpperCase()] = res[0].id;
    stats.designations++;
  }
  log(`  Upserted ${stats.designations} designations.`);
  return desigMap;
}

// ── Step 5: Sync cost centres ─────────────────────────────────────────────────
async function syncCostCentres(src, tgt, branchMap) {
  log('Step 5: Syncing cost centres...');
  const [rows] = await src.execute(
    "SELECT id, cost_center, CostCenterName, branch, process, active FROM cost_master ORDER BY branch, cost_center"
  );
  if (DRY_RUN) { log(`  [DRY] would upsert ${rows.length} cost centres`); return {}; }

  const ccMap = {}; // cost_center_code (uppercase) → uuid
  for (const r of rows) {
    const code   = (r.cost_center || '').trim().substring(0, 50);
    if (!code) continue;
    const name   = (r.CostCenterName && r.CostCenterName !== 'null' ? r.CostCenterName : r.cost_center).trim().substring(0, 255);
    const active = r.active == 1 ? 1 : 0;
    const bname  = (r.branch || '').toUpperCase();
    const branchId = branchMap[bname] || null;

    await tgt.execute(`
      INSERT INTO cost_centre_master (id, cost_centre_code, cost_centre_name, branch_id, active_status, created_at, updated_at)
      VALUES (UUID(), ?, ?, ?, ?, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        cost_centre_name = VALUES(cost_centre_name),
        branch_id        = COALESCE(VALUES(branch_id), branch_id),
        active_status    = VALUES(active_status),
        updated_at       = NOW()
    `, [code, name, branchId, active]);

    const [res] = await tgt.execute('SELECT id FROM cost_centre_master WHERE cost_centre_code = ?', [code]);
    if (res[0]) ccMap[code.toUpperCase()] = res[0].id;
    stats.cost_centres++;
  }
  log(`  Upserted ${stats.cost_centres} cost centres.`);
  return ccMap;
}

// ── Step 6: Sync processes ────────────────────────────────────────────────────
async function syncProcesses(src, tgt, branchMap) {
  log('Step 6: Syncing processes...');
  // Get distinct processes from masjclrentry (the live data) + process_master
  const [rows] = await src.execute(`
    SELECT DISTINCT Process as process_name FROM masjclrentry
    WHERE Process IS NOT NULL AND Process != '' AND Process != '0'
    UNION
    SELECT process_name FROM process_master WHERE process_name IS NOT NULL
    ORDER BY process_name
  `);
  if (DRY_RUN) { log(`  [DRY] would upsert ${rows.length} processes`); return {}; }

  const procMap = {};
  for (const r of rows) {
    const name = (r.process_name || '').trim();
    if (!name) continue;
    const code = name.replace(/[^A-Z0-9_]/gi,'_').toUpperCase().substring(0,50);

    await tgt.execute(`
      INSERT INTO process_master (id, process_code, process_name, active_status, created_at, updated_at)
      VALUES (UUID(), ?, ?, 1, NOW(), NOW())
      ON DUPLICATE KEY UPDATE
        process_name  = VALUES(process_name),
        updated_at    = NOW()
    `, [code, name]);

    const [res] = await tgt.execute('SELECT id FROM process_master WHERE process_code = ?', [code]);
    if (res[0]) procMap[name.toUpperCase()] = res[0].id;
    stats.processes++;
  }
  log(`  Upserted ${stats.processes} processes.`);
  return procMap;
}

// ── Step 7: Sync all employees ────────────────────────────────────────────────
async function syncEmployees(src, tgt, branchMap, deptMap, desigMap, ccMap, procMap) {
  log('Step 7: Syncing employees (all records)...');

  const BATCH = 500;
  let offset  = 0;
  let total   = 0;

  // Count first
  const [cnt] = await src.execute('SELECT COUNT(*) as c FROM masjclrentry');
  total = cnt[0].c;
  log(`  Total source records: ${total}`);

  if (DRY_RUN) { log(`  [DRY] would upsert ~${total} employees`); return; }

  while (offset < total) {
    const [rows] = await src.execute(`
      SELECT id, EmpType, EmpCode, BranchName, BioCode, Title,
             EmpName, Gendar, BloodGruop, NomineeName, NomineeRelation,
             MaritalStatus, Qualification, DOB, DOJ, DOL, ResignationDate,
             Adrress1, Adrress2, City, City1, State, PinCode,
             Mobile, Mobile1, EmailId, OfficeEmailId,
             PanNo, AdharId, Dept, Desgination, Stream, Process,
             CostCenter, Source, KPI, Band, CTC, EPFNo,
             AcNo, AcBank, AcBranch, IFSCCode, AccHolder, AccType,
             Father, UAN, ESICNo, Gross, NetInhand,
             Reporting_Manager_Name, Billable_Status,
             Status, lastUpdated, EmpFor, Type_Of_Employee
      FROM masjclrentry
      ORDER BY id
      LIMIT ${BATCH} OFFSET ${offset}
    `);
    if (rows.length === 0) break;

    for (const r of rows) {
      try {
        const empCode = (r.EmpCode || '').trim();
        if (!empCode) { stats.employees_skipped++; continue; }

        // Split EmpName into first/last
        const nameParts = (r.EmpName || '').trim().split(/\s+/);
        const firstName = nameParts[0] || empCode;
        const lastName  = nameParts.slice(1).join(' ') || null;

        // Resolve FKs
        const bname    = (r.BranchName || '').toUpperCase();
        const branchId = branchMap[bname] || null;
        const dname    = (r.Dept || '').toUpperCase();
        const deptId   = deptMap[dname] || null;
        const dgname   = (r.Desgination || '').toUpperCase();
        const desigId  = desigMap[dgname] || null;
        const ccCode   = (r.CostCenter || '').toUpperCase();
        const ccId     = ccMap[ccCode] || null;
        const pname    = (r.Process || '').toUpperCase();
        const procId   = procMap[pname] || null;

        // Gender normalize
        const gRaw  = (r.Gendar || '').toUpperCase();
        const gender = gRaw === 'MALE' ? 'Male' : gRaw === 'FEMALE' ? 'Female' : null;

        // Marital status — must match enum('single','married','divorced','widowed')
        const msRaw = (r.MaritalStatus || '').toLowerCase().trim();
        const maritalStatus = ['single','married','divorced','widowed'].includes(msRaw) ? msRaw : null;

        // Status
        const active = r.Status == 1 ? 1 : 0;

        // Employee type → category
        const empTyp  = (r.EmpType || '').toLowerCase();
        const empCat  = empTyp.includes('mgmt') ? 'permanent'
                      : empTyp.includes('contract') ? 'contract'
                      : empTyp.includes('intern') ? 'intern'
                      : 'permanent';
        const empStatus = active === 1 ? 'active' : 'inactive';

        // Dates
        const doj  = r.DOJ  ? new Date(r.DOJ).toISOString().slice(0,10)  : null;
        const dob  = r.DOB  ? new Date(r.DOB).toISOString().slice(0,10)  : null;
        const dol  = r.DOL  ? new Date(r.DOL).toISOString().slice(0,10)  : null;
        const rDate = r.ResignationDate && r.ResignationDate !== '0000-00-00'
                     ? (() => { try { return new Date(r.ResignationDate).toISOString().slice(0,10); } catch { return null; } })()
                     : null;

        // Financial
        const ctc     = parseFloat(r.CTC)      || null;
        const gross   = parseFloat(r.Gross)    || null;
        const netIH   = parseFloat(r.NetInhand) || null;

        // PAN — ensure exactly 10 chars
        const pan = r.PanNo && r.PanNo.trim().length === 10 ? r.PanNo.trim().toUpperCase() : null;

        // Aadhaar — last 4, full truncated to 20 chars
        const aadhaarFull = (r.AdharId || '').replace(/[\s\/]/g,'').substring(0, 20);
        const aadhaarL4   = aadhaarFull.length >= 4 ? aadhaarFull.slice(-4) : null;

        // IFSC — max 20 chars
        const ifscCode = (r.IFSCCode || '').trim().substring(0, 20) || null;

        await tgt.execute(`
          INSERT INTO employees (
            id, employee_code, first_name, last_name,
            email, office_email, mobile,
            gender, marital_status, date_of_birth, date_of_joining,
            date_of_exit, resignation_date,
            employment_type, employee_category, employment_status,
            branch_id, department_id, designation_id, cost_centre_id, process_id,
            active_status, band, stream, source_type, source,
            biometric_code, call_centre_code,
            pan_number, aadhaar_last4, aadhaar_number,
            bank_account_number, bank_name, bank_branch, ifsc_code,
            account_holder_name, account_type,
            uan_number, epf_number, esic_number,
            ctc, gross_salary, net_inhand,
            blood_group, nominee_name, nominee_relation,
            address1, address2, city, state, pincode,
            father_name, reporting_manager_id,
            emp_type, billable_status, cost_center_code,
            legacy_id, legacy_emp_id,
            date_of_leaving,
            created_at, updated_at
          ) VALUES (
            UUID(), ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?, ?,
            ?, NULL,
            ?, ?, ?,
            ?, ?,
            ?,
            NOW(), NOW()
          )
          ON DUPLICATE KEY UPDATE
            first_name          = VALUES(first_name),
            last_name           = VALUES(last_name),
            email               = COALESCE(VALUES(email), email),
            office_email        = COALESCE(VALUES(office_email), office_email),
            mobile              = COALESCE(VALUES(mobile), mobile),
            gender              = COALESCE(VALUES(gender), gender),
            marital_status      = COALESCE(VALUES(marital_status), marital_status),
            date_of_birth       = COALESCE(VALUES(date_of_birth), date_of_birth),
            date_of_joining     = COALESCE(VALUES(date_of_joining), date_of_joining),
            date_of_exit        = COALESCE(VALUES(date_of_exit), date_of_exit),
            resignation_date    = COALESCE(VALUES(resignation_date), resignation_date),
            employment_type     = VALUES(employment_type),
            employee_category   = VALUES(employee_category),
            employment_status   = VALUES(employment_status),
            branch_id           = COALESCE(VALUES(branch_id), branch_id),
            department_id       = COALESCE(VALUES(department_id), department_id),
            designation_id      = COALESCE(VALUES(designation_id), designation_id),
            cost_centre_id      = COALESCE(VALUES(cost_centre_id), cost_centre_id),
            process_id          = COALESCE(VALUES(process_id), process_id),
            active_status       = VALUES(active_status),
            band                = COALESCE(VALUES(band), band),
            stream              = COALESCE(VALUES(stream), stream),
            source_type         = COALESCE(VALUES(source_type), source_type),
            biometric_code      = COALESCE(VALUES(biometric_code), biometric_code),
            pan_number          = COALESCE(VALUES(pan_number), pan_number),
            aadhaar_last4       = COALESCE(VALUES(aadhaar_last4), aadhaar_last4),
            aadhaar_number      = COALESCE(VALUES(aadhaar_number), aadhaar_number),
            bank_account_number = COALESCE(VALUES(bank_account_number), bank_account_number),
            bank_name           = COALESCE(VALUES(bank_name), bank_name),
            bank_branch         = COALESCE(VALUES(bank_branch), bank_branch),
            ifsc_code           = COALESCE(VALUES(ifsc_code), ifsc_code),
            account_holder_name = COALESCE(VALUES(account_holder_name), account_holder_name),
            account_type        = COALESCE(VALUES(account_type), account_type),
            uan_number          = COALESCE(VALUES(uan_number), uan_number),
            epf_number          = COALESCE(VALUES(epf_number), epf_number),
            esic_number         = COALESCE(VALUES(esic_number), esic_number),
            ctc                 = COALESCE(VALUES(ctc), ctc),
            gross_salary        = COALESCE(VALUES(gross_salary), gross_salary),
            net_inhand          = COALESCE(VALUES(net_inhand), net_inhand),
            blood_group         = COALESCE(VALUES(blood_group), blood_group),
            nominee_name        = COALESCE(VALUES(nominee_name), nominee_name),
            nominee_relation    = COALESCE(VALUES(nominee_relation), nominee_relation),
            address1            = COALESCE(VALUES(address1), address1),
            address2            = COALESCE(VALUES(address2), address2),
            city                = COALESCE(VALUES(city), city),
            state               = COALESCE(VALUES(state), state),
            pincode             = COALESCE(VALUES(pincode), pincode),
            father_name         = COALESCE(VALUES(father_name), father_name),
            emp_type            = COALESCE(VALUES(emp_type), emp_type),
            billable_status     = COALESCE(VALUES(billable_status), billable_status),
            cost_center_code    = COALESCE(VALUES(cost_center_code), cost_center_code),
            legacy_emp_id       = COALESCE(VALUES(legacy_emp_id), legacy_emp_id),
            date_of_leaving     = COALESCE(VALUES(date_of_leaving), date_of_leaving),
            updated_at          = NOW()
        `, [
          empCode, firstName, lastName,
          r.EmailId || null, r.OfficeEmailId || null, r.Mobile || null,
          gender, maritalStatus, dob, doj || '2000-01-01',
          dol, rDate,
          r.EmpType || 'ONROLL', empCat, empStatus,
          branchId, deptId, desigId, ccId, procId,
          active, r.Band || null, r.Stream || null, r.Source || null, r.Source || null,
          r.BioCode || empCode, null,
          pan, aadhaarL4, aadhaarFull || null,
          r.AcNo || null, r.AcBank || null, r.AcBranch || null, ifscCode,
          r.AccHolder || null, r.AccType || null,
          r.UAN || null, r.EPFNo || null, r.ESICNo || null,
          ctc, gross, netIH,
          r.BloodGruop || null, r.NomineeName || null, r.NomineeRelation || null,
          r.Adrress1 || null, r.Adrress2 || null, r.City || null, r.State || null, r.PinCode || null,
          r.Father || null,
          r.EmpType || null, r.Billable_Status || null, r.CostCenter || null,
          r.id, r.id,
          dol,
        ]);

        const [chk] = await tgt.execute('SELECT ROW_COUNT() as rc');
        if (Number(chk[0]?.rc) === 1) stats.employees_inserted++;
        else stats.employees_updated++;

      } catch (e) {
        err(`Employee ${r.EmpCode}: ${e.message}`);
      }
    }

    offset += BATCH;
    const done = Math.min(offset, total);
    log(`  Progress: ${done}/${total} (${Math.round(done/total*100)}%)`);
  }
}

// ── Main ──────────────────────────────────────────────────────────────────────
const startMs = Date.now();
log(`=== db_bill → mas_hrms sync started${DRY_RUN ? ' [DRY RUN]' : ''} ===`);

const src = await mysql.createPool({ ...SOURCE, waitForConnections:true, connectionLimit:3 });
const tgt = await mysql.createPool({ ...TARGET, waitForConnections:true, connectionLimit:5 });

try {
  const run = ONLY_ENTITY;

  if (!run || run === 'schema')       await addMissingColumns(tgt);
  const branchMap = (!run || run === 'branches')     ? await syncBranches(src, tgt)                      : await loadMap(tgt, 'branch_master',      'branch_name',       'id');
  const deptMap   = (!run || run === 'departments')  ? await syncDepartments(src, tgt)                   : await loadMap(tgt, 'department_master',   'dept_name',         'id');
  const desigMap  = (!run || run === 'designations') ? await syncDesignations(src, tgt)                  : await loadMap(tgt, 'designation_master',  'designation_name',  'id');
  const ccMap     = (!run || run === 'cost_centres') ? await syncCostCentres(src, tgt, branchMap)        : await loadMap(tgt, 'cost_centre_master',  'cost_centre_code',  'id');
  const procMap   = (!run || run === 'processes')    ? await syncProcesses(src, tgt, branchMap)          : await loadMap(tgt, 'process_master',      'process_name',      'id');
  if (!run || run === 'employees')    await syncEmployees(src, tgt, branchMap, deptMap, desigMap, ccMap, procMap);

} finally {
  await src.end();
  await tgt.end();
}

const elapsed = ((Date.now() - startMs) / 1000).toFixed(1);
console.log(`
╔══════════════════════════════════════════════════╗
║  db_bill → mas_hrms Sync Complete${DRY_RUN ? ' [DRY]      ' : '             '}  ║
╠══════════════════════════════════════════════════╣
║  Branches synced:       ${String(stats.branches).padEnd(24)} ║
║  Departments synced:    ${String(stats.departments).padEnd(24)} ║
║  Designations synced:   ${String(stats.designations).padEnd(24)} ║
║  Cost centres synced:   ${String(stats.cost_centres).padEnd(24)} ║
║  Processes synced:      ${String(stats.processes).padEnd(24)} ║
║  Employees inserted:    ${String(stats.employees_inserted).padEnd(24)} ║
║  Employees updated:     ${String(stats.employees_updated).padEnd(24)} ║
║  Employees skipped:     ${String(stats.employees_skipped).padEnd(24)} ║
║  Errors:                ${String(stats.errors).padEnd(24)} ║
║  Duration:              ${String(elapsed+'s').padEnd(24)} ║
╚══════════════════════════════════════════════════╝
`);
if (stats.errors > 0) process.exit(1);

// ── Helper: load existing map from target ────────────────────────────────────
async function loadMap(tgt, table, nameCol, idCol) {
  const [rows] = await tgt.execute(`SELECT \`${nameCol}\`, \`${idCol}\` FROM \`${table}\``);
  const map = {};
  for (const r of rows) map[String(r[nameCol]).toUpperCase()] = r[idCol];
  return map;
}
