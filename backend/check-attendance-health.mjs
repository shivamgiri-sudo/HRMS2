#!/usr/bin/env node
/**
 * check-attendance-health.mjs
 * Usage: node backend/check-attendance-health.mjs 2026-07-01 2026-07-31
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const FROM = process.argv[2] || '2026-07-01';
const TO   = process.argv[3] || '2026-07-31';

const db = await mysql.createConnection({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

console.log(`\n=== Attendance Health Check: ${FROM} → ${TO} ===\n`);

// 1. Active employees
const [[{ total }]] = await db.execute(
  'SELECT COUNT(*) as total FROM employees WHERE active_status = 1'
);
console.log(`Active employees:              ${total}`);

// 2. Employees with attendance records in range
const [[{ withAtt }]] = await db.execute(
  `SELECT COUNT(DISTINCT employee_id) as withAtt FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?`, [FROM, TO]
);
console.log(`With attendance records:        ${withAtt}`);
console.log(`Missing attendance records:     ${total - withAtt}`);

// 3. Employees with biometric data
const [[{ withBio }]] = await db.execute(
  `SELECT COUNT(DISTINCT employee_id) as withBio FROM biometric_attendance_log
   WHERE punch_date >= ? AND punch_date <= ?`, [FROM, TO]
);
console.log(`With biometric data:            ${withBio}`);

// 4. Biometric employees missing attendance records
const [[{ bioNoAtt }]] = await db.execute(
  `SELECT COUNT(DISTINCT b.employee_id) as bioNoAtt
   FROM biometric_attendance_log b
   WHERE b.punch_date >= ? AND b.punch_date <= ?
     AND NOT EXISTS (
       SELECT 1 FROM attendance_daily_record a
       WHERE a.employee_id = b.employee_id
         AND a.record_date = b.punch_date
     )`, [FROM, TO]
);
console.log(`Bio data but NO att record:     ${bioNoAtt}`);

// 5. Date mismatch
const [[{ mismatches }]] = await db.execute(
  `SELECT COUNT(*) as mismatches FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?
     AND clock_in_time IS NOT NULL
     AND DATE(clock_in_time) != record_date`, [FROM, TO]
);
console.log(`\nDate mismatches (clock_in≠date): ${mismatches}`);

// 6. LWP issues
const [[{ lwpWrong }]] = await db.execute(
  `SELECT COUNT(*) as lwpWrong FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?
     AND attendance_status = 'present' AND lwp_value = 1.00`, [FROM, TO]
);
console.log(`Present with LWP=1.00 (wrong):  ${lwpWrong}`);

// 7. Absent with LWP=0
const [[{ absLwpZero }]] = await db.execute(
  `SELECT COUNT(*) as absLwpZero FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?
     AND attendance_status = 'absent' AND lwp_value = 0.00`, [FROM, TO]
);
console.log(`Absent with LWP=0.00 (wrong):   ${absLwpZero}`);

// 8. Total records
const [[{ totalRecords }]] = await db.execute(
  `SELECT COUNT(*) as totalRecords FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?`, [FROM, TO]
);
console.log(`\nTotal attendance records:       ${totalRecords}`);

// 9. Status breakdown
const [statuses] = await db.execute(
  `SELECT attendance_status, COUNT(*) as cnt
   FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?
   GROUP BY attendance_status ORDER BY cnt DESC`, [FROM, TO]
);
console.log('\nStatus breakdown:');
for (const s of statuses) {
  console.log(`  ${String(s.attendance_status).padEnd(20)} ${s.cnt}`);
}

// 10. Daily coverage
const [daily] = await db.execute(
  `SELECT record_date,
     COUNT(*) as total,
     SUM(CASE WHEN attendance_status='present'  THEN 1 ELSE 0 END) as present,
     SUM(CASE WHEN attendance_status='absent'   THEN 1 ELSE 0 END) as absent,
     SUM(CASE WHEN attendance_status='week_off' THEN 1 ELSE 0 END) as weekoff,
     SUM(CASE WHEN attendance_status='leave_approved' THEN 1 ELSE 0 END) as leave
   FROM attendance_daily_record
   WHERE record_date >= ? AND record_date <= ?
   GROUP BY record_date ORDER BY record_date`, [FROM, TO]
);
console.log('\nDaily coverage:');
console.log('  Date         Total  Present  Absent  WeekOff  Leave');
for (const d of daily) {
  const dt = d.record_date instanceof Date
    ? d.record_date.toISOString().slice(0, 10)
    : String(d.record_date).slice(0, 10);
  console.log(
    `  ${dt}   ${String(d.total).padStart(5)}  ${String(d.present).padStart(7)}  ${String(d.absent).padStart(6)}  ${String(d.weekoff).padStart(7)}  ${String(d.leave).padStart(5)}`
  );
}

// 11. Employees with zero records
const [zeroEmp] = await db.execute(
  `SELECT e.employee_code, e.full_name
   FROM employees e
   WHERE e.active_status = 1
     AND NOT EXISTS (
       SELECT 1 FROM attendance_daily_record a
       WHERE a.employee_id = e.id
         AND a.record_date >= ? AND a.record_date <= ?
     )
   ORDER BY e.employee_code
   LIMIT 20`, [FROM, TO]
);
if (zeroEmp.length > 0) {
  console.log(`\nEmployees with ZERO records (first 20 of ${total - withAtt}):`);
  for (const e of zeroEmp) {
    console.log(`  ${e.employee_code}  ${e.full_name}`);
  }
}

console.log('\n=== Summary ===');
const issues = [];
if (total - withAtt > 0)    issues.push(`${total - withAtt} employees missing attendance records`);
if (bioNoAtt > 0)           issues.push(`${bioNoAtt} employees have biometric data but no attendance record`);
if (mismatches > 0)         issues.push(`${mismatches} records with clock_in date mismatch`);
if (lwpWrong > 0)           issues.push(`${lwpWrong} present records with incorrect LWP=1.00`);
if (absLwpZero > 0)         issues.push(`${absLwpZero} absent records with incorrect LWP=0.00`);

if (issues.length === 0) {
  console.log('✅ No issues found.');
} else {
  console.log('Issues found:');
  issues.forEach(i => console.log(`  ❌ ${i}`));
  console.log('\nRun: node backend/fix-attendance-sync-july.mjs --from=<from> --to=<to> --dry-run');
}

await db.end();
process.exit(0);
