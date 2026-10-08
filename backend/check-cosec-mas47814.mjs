#!/usr/bin/env node
/**
 * Compares COSEC raw punches vs mas_hrms stored data for MAS47814
 */
import sql from 'mssql';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const EMP_CODE = process.argv[2] || 'MAS47814';
const FROM     = process.argv[3] || '2026-07-01';
const TO       = process.argv[4] || '2026-07-14';

// ── MySQL ─────────────────────────────────────────────────────────────────────
const mc = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true,
});

const [[emp]] = await mc.execute(
  'SELECT id, employee_code, full_name, biometric_code FROM employees WHERE employee_code = ? LIMIT 1',
  [EMP_CODE]
);
if (!emp) { console.error('Employee not found:', EMP_CODE); process.exit(1); }

const [[ebe]] = await mc.execute(
  'SELECT cosec_user_id FROM employee_biometric_enrollment WHERE employee_id = ? AND is_active = 1 LIMIT 1',
  [emp.id]
);
const cosecId = ebe?.cosec_user_id || emp.biometric_code || EMP_CODE;

console.log(`Employee : ${emp.employee_code}  ${emp.full_name}`);
console.log(`COSEC ID : ${cosecId}`);
console.log(`Range    : ${FROM} → ${TO}\n`);

// ── COSEC SQL Server ─────────────────────────────────────────────────────────
const pool = await sql.connect({
  server: process.env.NCOSEC_DB_HOST,
  port:   Number(process.env.NCOSEC_DB_PORT) || 1433,
  user:   process.env.NCOSEC_DB_USER,
  password: process.env.NCOSEC_DB_PASSWORD,
  database: process.env.NCOSEC_DB_NAME || 'NCOSEC',
  options: {
    encrypt: false,
    trustServerCertificate: true,
  },
});

// All raw punches
const rawResult = await pool.request()
  .input('uid',  sql.NVarChar(100), cosecId)
  .input('from', sql.DateTime, new Date(FROM + 'T00:00:00'))
  .input('to',   sql.DateTime, new Date(TO   + 'T23:59:59'))
  .query(`
    SELECT
      CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23)  AS punch_date,
      CONVERT(CHAR(19), Edatetime, 120)               AS punch_time,
      UserID
    FROM dbo.Mx_ATDEventTrn
    WHERE UserID = @uid
      AND Edatetime >= @from
      AND Edatetime <= @to
    ORDER BY Edatetime
  `);

// Grouped by day (first/last)
const grouped = new Map();
for (const r of rawResult.recordset) {
  const d = r.punch_date;
  if (!grouped.has(d)) grouped.set(d, { first: r.punch_time, last: r.punch_time, count: 0 });
  const g = grouped.get(d);
  if (r.punch_time < g.first) g.first = r.punch_time;
  if (r.punch_time > g.last)  g.last  = r.punch_time;
  g.count++;
}

console.log('══════════════════════════════════════════════════════════════════════════════════');
console.log('COSEC DATABASE (raw punches grouped by day)');
console.log('──────────────────────────────────────────────────────────────────────────────────');
console.log('Date         Punches  First In              Last Out              Min');
for (const [date, g] of [...grouped.entries()].sort()) {
  const mins = Math.round((new Date(g.last.replace(' ','T')) - new Date(g.first.replace(' ','T'))) / 60000);
  console.log(`${date}    ${String(g.count).padStart(4)}   ${g.first}   ${g.last}   ${String(mins).padStart(4)}`);
}

// ── biometric_attendance_log ──────────────────────────────────────────────────
const [bio] = await mc.execute(
  `SELECT punch_date, first_punch_in, last_punch_out, raw_minutes, source_system
   FROM biometric_attendance_log
   WHERE employee_id = ? AND punch_date >= ? AND punch_date <= ?
   ORDER BY punch_date`,
  [emp.id, FROM, TO]
);

console.log('\n══════════════════════════════════════════════════════════════════════════════════');
console.log('mas_hrms · biometric_attendance_log (what sync saved)');
console.log('──────────────────────────────────────────────────────────────────────────────────');
console.log('punch_date   first_punch_in        last_punch_out        raw_min  source');
for (const r of bio) {
  console.log(`${r.punch_date}   ${String(r.first_punch_in).padEnd(21)} ${String(r.last_punch_out).padEnd(21)} ${String(r.raw_minutes).padStart(6)}   ${r.source_system}`);
}

// ── attendance_daily_record ───────────────────────────────────────────────────
const [att] = await mc.execute(
  `SELECT record_date, clock_in_time, clock_out_time, attendance_status, lwp_value, raw_minutes
   FROM attendance_daily_record
   WHERE employee_id = ? AND record_date >= ? AND record_date <= ?
   ORDER BY record_date`,
  [emp.id, FROM, TO]
);

console.log('\n══════════════════════════════════════════════════════════════════════════════════');
console.log('mas_hrms · attendance_daily_record (final attendance)');
console.log('──────────────────────────────────────────────────────────────────────────────────');
console.log('record_date  clock_in_time         clock_out_time        status         lwp  raw_min');
for (const r of att) {
  console.log(`${r.record_date}   ${String(r.clock_in_time).padEnd(21)} ${String(r.clock_out_time).padEnd(21)} ${String(r.attendance_status).padEnd(14)} ${String(r.lwp_value).padStart(4)} ${String(r.raw_minutes).padStart(6)}`);
}

// ── Side-by-side comparison ───────────────────────────────────────────────────
console.log('\n══════════════════════════════════════════════════════════════════════════════════');
console.log('SIDE-BY-SIDE COMPARISON (COSEC grouped vs attendance_daily_record)');
console.log('──────────────────────────────────────────────────────────────────────────────────');

// Build a full date range
const start = new Date(FROM), end = new Date(TO);
const allDates = [];
for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
  allDates.push(d.toISOString().slice(0, 10));
}

const attMap  = new Map(att.map(r  => [r.record_date, r]));
const bioMap  = new Map(bio.map(r  => [String(r.punch_date).slice(0,10), r]));

let issues = 0;
for (const date of allDates) {
  const cosec = grouped.get(date);
  const adr   = attMap.get(date);
  const b     = bioMap.get(date);

  const cosecFirst = cosec?.first || '—';
  const cosecLast  = cosec?.last  || '—';
  const adrIn      = adr?.clock_in_time  || '—';
  const adrOut     = adr?.clock_out_time || '—';
  const bioIn      = b?.first_punch_in   || '—';
  const bioOut     = b?.last_punch_out   || '—';

  // Check for mismatches
  const timesMatch = cosec && adr
    ? (String(adrIn).slice(0,19) === cosecFirst && String(adrOut).slice(0,19) === cosecLast)
    : true;
  const bioMatch = cosec && b
    ? (String(bioIn).slice(0,19) === cosecFirst)
    : true;

  const flag = (!cosec && adr && adr.attendance_status === 'present') ? ' ⚠ PHANTOM' :
               (cosec && !adr)                                         ? ' ⚠ MISSING' :
               (!timesMatch && cosec && adr)                           ? ' ⚠ TIME MISMATCH' :
               (!bioMatch && cosec && b)                               ? ' ⚠ BIO MISMATCH' : '';

  if (flag) issues++;

  console.log(`\n${date}${flag}`);
  if (cosec) console.log(`  COSEC    : in=${cosecFirst}  out=${cosecLast}  punches=${cosec.count}`);
  else       console.log(`  COSEC    : (no punch)`);
  if (b)     console.log(`  BIO_LOG  : in=${String(bioIn).slice(0,19)}  out=${String(bioOut).slice(0,19)}  raw=${b.raw_minutes}min  src=${b.source_system}`);
  else       console.log(`  BIO_LOG  : (no record)`);
  if (adr)   console.log(`  ATT_REC  : in=${String(adrIn).slice(0,19)}  out=${String(adrOut).slice(0,19)}  status=${adr.attendance_status}  lwp=${adr.lwp_value}  raw=${adr.raw_minutes}min`);
  else       console.log(`  ATT_REC  : (no record)`);
}

console.log(`\n══════════════════════════════════════════════════════════════════════════════════`);
console.log(`Issues flagged: ${issues}`);

await mc.end();
await pool.close();
process.exit(0);
