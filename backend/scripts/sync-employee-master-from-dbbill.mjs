/**
 * sync-employee-master-from-dbbill.mjs
 *
 * Migrates db_bill.employee_master supplementary fields → mas_hrms
 *
 * db_bill.employee_master has 35,900+ rows with fields that are missing or NULL
 * in mas_hrms.employees: UAN, EPF number, ESIC number, PAN, Aadhar, official email,
 * bank account details, biometric code, gender, DOB, blood group.
 *
 * This script:
 *   1. employees        — UPDATE SET … WHERE field IS NULL AND employee_code matches
 *   2. employee_statutory_info — INSERT if no row, else UPDATE only NULL fields
 *                               (epf_number, esi_number, uan_number, pan_number,
 *                                aadhaar_id, pf_eligible, esi_eligible, epf_date)
 *   3. employee_bank_detail   — INSERT with account_seq=99 (legacy slot) if no
 *                               existing bank row has the same account_number
 *   4. employee_biometric_enrollment — INSERT with cosec_user_id=BiometricCode
 *                                      if no existing enrollment for the employee
 *
 * Rules:
 *   - Never DELETE anything. INSERT IGNORE / UPDATE WHERE NULL only.
 *   - Skip IDC employees (EmpCode LIKE 'IDC%') — not in mas_hrms by design.
 *   - account_number stored as plain text in this legacy insert (no encryption);
 *     the HRMS encrypt-at-rest path is for new UI entries.
 *     account_number_enc is left NULL for legacy rows — the raw value is in account_number.
 *
 * Usage:
 *   node backend/scripts/sync-employee-master-from-dbbill.mjs
 *   node backend/scripts/sync-employee-master-from-dbbill.mjs --bill-host=14.97.30.236
 *   node backend/scripts/sync-employee-master-from-dbbill.mjs --batch=200
 */

import mysql from 'mysql2/promise';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function arg(name, fallback) {
  return process.argv.find(a => a.startsWith(`--${name}=`))?.split('=')[1] ?? fallback;
}
function fromEnv(key) {
  try {
    const env = fs.readFileSync(path.join(__dirname, '../.env'), 'utf8');
    return env.match(new RegExp(`^${key}=(.*)$`, 'm'))?.[1]?.replace(/^["']|["']$/g, '').trim() ?? null;
  } catch { return null; }
}

const BILL_HOST = arg('bill-host', fromEnv('BILL_DB_HOST') ?? '14.97.30.236');
const HRMS_HOST = arg('hrms-host', fromEnv('DB_HOST')      ?? '192.168.10.6');
const DB_USER   = fromEnv('DB_USER');
const DB_PASS   = fromEnv('DB_PASSWORD');
const BATCH     = Number(arg('batch', '200'));

function log(m) { process.stdout.write(`[${new Date().toLocaleTimeString('en-IN')}] ${m}\n`); }

async function retryDeadlock(fn, retries = 5) {
  for (let i = 0; i < retries; i++) {
    try { return await fn(); }
    catch (e) {
      if ((e.message.includes('Deadlock') || e.message.includes('Lock wait')) && i < retries - 1) {
        await new Promise(r => setTimeout(r, 1000 * (i + 1)));
        continue;
      }
      throw e;
    }
  }
}

function clean(v) { return v && String(v).trim() !== '' ? String(v).trim() : null; }
function cleanNum(v) { const n = clean(v); return n && n !== '0' ? n : null; }

// Normalise gender values to HRMS enum
function mapGender(g) {
  if (!g) return null;
  const u = g.trim().toUpperCase();
  if (u === 'M' || u === 'MALE')   return 'Male';
  if (u === 'F' || u === 'FEMALE') return 'Female';
  return 'Other';
}

// Normalise boolean-like fields (1/0/'1'/'0'/'yes'/'no')
function mapBool(v) {
  if (v === null || v === undefined || v === '') return null;
  const s = String(v).toLowerCase().trim();
  return (s === '1' || s === 'yes' || s === 'true') ? 1 : 0;
}

// Returns a valid YYYY-MM-DD string or null — rejects garbage like 'B', '0000-00-00', etc.
function cleanDate(v) {
  if (!v) return null;
  const s = String(v).trim().substring(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  if (s === '0000-00-00') return null;
  const d = new Date(s);
  if (isNaN(d.getTime())) return null;
  return s;
}

async function main() {
  log(`Connecting — bill=${BILL_HOST}  hrms=${HRMS_HOST}`);

  const bill = await mysql.createPool({
    host: BILL_HOST, port: 3306, user: DB_USER, password: DB_PASS,
    database: 'db_bill', connectTimeout: 30000, waitForConnections: true,
    connectionLimit: 3, dateStrings: true,
  });
  const hrms = await mysql.createPool({
    host: HRMS_HOST, port: 3306, user: DB_USER, password: DB_PASS,
    database: 'mas_hrms', connectTimeout: 30000, waitForConnections: true,
    connectionLimit: 5,
  });

  // Load employee_code → { id, has_bank, has_statutory, has_bio } map
  log('Loading HRMS employee map...');
  const [empRows] = await hrms.execute(
    'SELECT id, employee_code, official_email, pan_number, gender, date_of_birth, uan_number, blood_group FROM employees'
  );
  const empMap = new Map(empRows.map(r => [r.employee_code.trim().toUpperCase(), r]));
  log(`  ${empMap.size} employees loaded.`);

  // Pre-load employee_ids that already have bank / statutory / biometric rows
  const [bankEmpIds]  = await hrms.execute('SELECT DISTINCT employee_id FROM employee_bank_detail');
  const bankSet       = new Set(bankEmpIds.map(r => r.employee_id));
  const [statEmpIds]  = await hrms.execute('SELECT DISTINCT employee_id FROM employee_statutory_info');
  const statSet       = new Set(statEmpIds.map(r => r.employee_id));
  const [bioEmpIds]   = await hrms.execute('SELECT DISTINCT employee_id FROM employee_biometric_enrollment');
  const bioSet        = new Set(bioEmpIds.map(r => r.employee_id));
  log(`  existing bank=${bankSet.size}  statutory=${statSet.size}  biometric=${bioSet.size}`);

  const [[{ total }]] = await bill.execute(
    "SELECT COUNT(*) AS total FROM employee_master WHERE EmpCode NOT LIKE 'IDC%' AND EmpCode IS NOT NULL AND TRIM(EmpCode) != ''"
  );
  log(`Source rows (non-IDC): ${total}`);

  let offset = 0;
  const stats = { empUpdate: 0, statInsert: 0, statUpdate: 0, bankInsert: 0, bioInsert: 0, noEmp: 0 };

  while (offset < total) {
    const [rows] = await bill.execute(
      `SELECT Id, EmpCode, EmpName, Gender, DOB, BloodG,
              OfficialEmailID, EmailId,
              panno, AadharID, UAN,
              EpfNo, NewEpfNo, EsiNo, EsicNo, EpfDate,
              pfelig, esielig,
              AcNo, IFSCCode, AcBank, AcBranch, AccHolder, AccType,
              BiometricCode
       FROM employee_master
       WHERE EmpCode NOT LIKE 'IDC%'
         AND EmpCode IS NOT NULL AND TRIM(EmpCode) != ''
       ORDER BY Id
       LIMIT ? OFFSET ?`,
      [BATCH, offset],
    );
    if (!rows.length) break;

    for (const r of rows) {
      const code = (r.EmpCode || '').trim().toUpperCase();
      const emp  = empMap.get(code);
      if (!emp) { stats.noEmp++; continue; }

      const empId = emp.id;

      // ── 1. employees table: fill NULL fields ──────────────────────────────
      const updates = [];
      const vals    = [];

      const officialEmail = clean(r.OfficialEmailID) || clean(r.EmailId);
      if (!emp.official_email && officialEmail) { updates.push('official_email = ?'); vals.push(officialEmail.substring(0, 100)); }
      if (!emp.pan_number && clean(r.panno))    { updates.push('pan_number = ?'); vals.push(clean(r.panno).substring(0, 10)); }
      if (!emp.gender    && clean(r.Gender))     { updates.push('gender = ?'); vals.push(mapGender(r.Gender)); }
      if (!emp.date_of_birth && cleanDate(r.DOB)) { updates.push('date_of_birth = ?'); vals.push(cleanDate(r.DOB)); }
      if (!emp.uan_number && cleanNum(r.UAN))   { updates.push('uan_number = ?'); vals.push(cleanNum(r.UAN).substring(0, 30)); }
      if (!emp.blood_group && clean(r.BloodG))  { updates.push('blood_group = ?'); vals.push(clean(r.BloodG).substring(0, 10)); }

      if (updates.length) {
        await retryDeadlock(() => hrms.execute(
          `UPDATE employees SET ${updates.join(', ')} WHERE id = ?`,
          [...vals, empId],
        ));
        // Update local cache so second pass of same employee doesn't re-update
        if (officialEmail)       emp.official_email = officialEmail;
        if (clean(r.panno))      emp.pan_number = clean(r.panno);
        if (clean(r.Gender))     emp.gender = mapGender(r.Gender);
        if (cleanDate(r.DOB))    emp.date_of_birth = cleanDate(r.DOB);
        if (cleanNum(r.UAN))     emp.uan_number = cleanNum(r.UAN);
        if (clean(r.BloodG))     emp.blood_group = clean(r.BloodG);
        stats.empUpdate++;
      }

      // ── 2. employee_statutory_info ─────────────────────────────────────────
      const epfNumber  = cleanNum(r.NewEpfNo) || cleanNum(r.EpfNo);
      const esiNumber  = cleanNum(r.EsicNo)   || cleanNum(r.EsiNo);
      const uanNumber  = cleanNum(r.UAN);
      const panNumber  = clean(r.panno);
      const aadhaarId  = cleanNum(r.AadharID);
      const pfEligible = mapBool(r.pfelig);
      const esiEligible= mapBool(r.esielig);
      const epfDate    = cleanDate(r.EpfDate);

      if (!statSet.has(empId)) {
        // No row yet — INSERT
        if (epfNumber || esiNumber || uanNumber || panNumber || aadhaarId) {
          await retryDeadlock(() => hrms.execute(
            `INSERT IGNORE INTO employee_statutory_info
               (id, employee_id, epf_number, esi_number, uan_number,
                pan_number, aadhaar_id, pf_eligible, esi_eligible, epf_date,
                created_at, updated_at)
             VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
            [empId, epfNumber, esiNumber, uanNumber, panNumber, aadhaarId,
             pfEligible, esiEligible, epfDate],
          ));
          statSet.add(empId);
          stats.statInsert++;
        }
      } else {
        // Row exists — UPDATE only NULL fields
        const su = []; const sv = [];
        if (epfNumber)           { su.push('epf_number = COALESCE(epf_number, ?)');   sv.push(epfNumber); }
        if (esiNumber)           { su.push('esi_number = COALESCE(esi_number, ?)');   sv.push(esiNumber); }
        if (uanNumber)           { su.push('uan_number = COALESCE(uan_number, ?)');   sv.push(uanNumber); }
        if (panNumber)           { su.push('pan_number = COALESCE(pan_number, ?)');   sv.push(panNumber); }
        if (aadhaarId)           { su.push('aadhaar_id = COALESCE(aadhaar_id, ?)');   sv.push(aadhaarId); }
        if (pfEligible !== null) { su.push('pf_eligible = COALESCE(pf_eligible, ?)'); sv.push(pfEligible); }
        if (esiEligible !== null){ su.push('esi_eligible = COALESCE(esi_eligible, ?)'); sv.push(esiEligible); }
        if (epfDate)             { su.push('epf_date = COALESCE(epf_date, ?)');       sv.push(epfDate); }
        if (su.length) {
          await retryDeadlock(() => hrms.execute(
            `UPDATE employee_statutory_info SET ${su.join(', ')}, updated_at=NOW() WHERE employee_id = ?`,
            [...sv, empId],
          ));
          stats.statUpdate++;
        }
      }

      // ── 3. employee_bank_detail ────────────────────────────────────────────
      const acNo = cleanNum(r.AcNo);
      if (!bankSet.has(empId) && acNo) {
        await retryDeadlock(() => hrms.execute(
          `INSERT IGNORE INTO employee_bank_detail
             (id, employee_id, is_primary, account_seq,
              bank_name, account_holder_name, bank_branch,
              account_number, ifsc_code, account_type,
              verified, active_status, created_at, updated_at)
           VALUES (UUID(), ?, 1, 1, ?, ?, ?, ?, ?, ?, 0, 1, NOW(), NOW())`,
          [
            empId,
            clean(r.AcBank),
            clean(r.AccHolder) || clean(r.EmpName),
            clean(r.AcBranch),
            acNo,
            clean(r.IFSCCode),
            clean(r.AccType),
          ],
        ));
        bankSet.add(empId);
        stats.bankInsert++;
      }

      // ── 4. employee_biometric_enrollment ──────────────────────────────────
      const bioCode = clean(r.BiometricCode);
      if (!bioSet.has(empId) && bioCode) {
        await retryDeadlock(() => hrms.execute(
          `INSERT IGNORE INTO employee_biometric_enrollment
             (id, employee_id, cosec_user_id, cosec_user_name, is_active, enrolled_at)
           VALUES (UUID(), ?, ?, ?, 1, NOW())`,
          [empId, bioCode, clean(r.EmpName)],
        ));
        bioSet.add(empId);
        stats.bioInsert++;
      }
    }

    offset += rows.length;
    process.stdout.write(
      `\r  Progress: ${offset}/${total}  empUpdate=${stats.empUpdate}  statInsert=${stats.statInsert}  statUpdate=${stats.statUpdate}  bankInsert=${stats.bankInsert}  bioInsert=${stats.bioInsert}  noEmp=${stats.noEmp}   `
    );
  }

  process.stdout.write('\n');
  log('═══════════════════════════════════════════');
  log('EMPLOYEE MASTER SYNC COMPLETE');
  log(`Source rows (non-IDC)            : ${total}`);
  log(`employees updated (NULL fill)    : ${stats.empUpdate}`);
  log(`employee_statutory_info inserted : ${stats.statInsert}`);
  log(`employee_statutory_info updated  : ${stats.statUpdate}`);
  log(`employee_bank_detail inserted    : ${stats.bankInsert}`);
  log(`employee_biometric_enrollment    : ${stats.bioInsert}`);
  log(`Skipped (no HRMS employee)       : ${stats.noEmp}  ← pre-HRMS employees, expected`);

  await bill.end();
  await hrms.end();
}

main().catch(e => { console.error('FATAL:', e.message); process.exit(1); });