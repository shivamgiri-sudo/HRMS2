#!/usr/bin/env node
/**
 * Bulk fix for tagIST() double-shift bug — ALL employees, Apr 2026 onwards.
 *
 * The ncosec sync path appended +05:30 to already-IST strings, causing mysql2 to
 * store times 5h30m ahead of actual COSEC wall-clock times.
 *
 * Fix: subtract 330 minutes from first_punch_in / last_punch_out in biometric_attendance_log
 * where source_system = 'ncosec', then propagate corrected times to attendance_daily_record.
 *
 * raw_minutes is unchanged (duration = last - first, same after equal subtraction).
 * attendance_status / lwp_value are recomputed from the corrected raw_minutes.
 *
 * Usage:
 *   node backend/fix-all-ncosec-shift.mjs --dry-run
 *   node backend/fix-all-ncosec-shift.mjs
 *   node backend/fix-all-ncosec-shift.mjs --from=2026-04-01 --to=2026-07-14
 */
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

const DRY_RUN = process.argv.includes('--dry-run');
const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  })
);
const FROM = args.from || '2026-04-01';
const TO   = args.to   || '2026-07-14';

console.log(`\n=== Bulk fix: ncosec +5:30 double-shift${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`Range: ${FROM} → ${TO}\n`);

const mc = await mysql.createPool({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true,
  waitForConnections: true, connectionLimit: 5,
});

// ── Step 1: Count scope ────────────────────────────────────────────────────────
const [[scope]] = await mc.execute(`
  SELECT
    COUNT(*) AS bio_rows,
    COUNT(DISTINCT employee_id) AS employees
  FROM biometric_attendance_log
  WHERE source_system = 'ncosec'
    AND punch_date >= ? AND punch_date <= ?
`, [FROM, TO]);

console.log(`Scope: ${scope.bio_rows} bio_log records for ${scope.employees} employees`);

if (!DRY_RUN) {
  // ── Step 2: Fix biometric_attendance_log (subtract 330 min) ──────────────────
  console.log('\nStep 1/3: Fixing biometric_attendance_log times...');
  const [bioResult] = await mc.execute(`
    UPDATE biometric_attendance_log
    SET
      first_punch_in  = DATE_SUB(first_punch_in,  INTERVAL 330 MINUTE),
      last_punch_out  = DATE_SUB(last_punch_out,   INTERVAL 330 MINUTE),
      source_system   = 'ncosec_fixed',
      migrated_at     = NOW()
    WHERE source_system = 'ncosec'
      AND punch_date >= ? AND punch_date <= ?
  `, [FROM, TO]);
  console.log(`  Updated ${bioResult.affectedRows} biometric_attendance_log rows`);

  // ── Step 3: Fix attendance_daily_record by joining to corrected bio_log ───────
  console.log('\nStep 2/3: Propagating corrected times to attendance_daily_record...');

  // Update clock_in_time / clock_out_time from corrected bio_log
  // Recompute raw_minutes = TIMESTAMPDIFF from corrected times
  // Recompute status/lwp from corrected raw_minutes
  const [attTimeResult] = await mc.execute(`
    UPDATE attendance_daily_record adr
    JOIN biometric_attendance_log bio
      ON bio.employee_id = adr.employee_id
     AND bio.punch_date  = adr.record_date
     AND bio.source_system = 'ncosec_fixed'
    SET
      adr.clock_in_time  = bio.first_punch_in,
      adr.clock_out_time = bio.last_punch_out,
      adr.raw_minutes    = COALESCE(TIMESTAMPDIFF(MINUTE, bio.first_punch_in, bio.last_punch_out), bio.raw_minutes, 0),
      adr.source_system  = 'ncosec_fixed',
      adr.updated_at     = NOW()
    WHERE adr.is_locked = 0
      AND adr.record_date >= ? AND adr.record_date <= ?
  `, [FROM, TO]);
  console.log(`  Updated ${attTimeResult.affectedRows} attendance_daily_record times`);

  // ── Step 4: Recompute attendance_status and lwp_value ────────────────────────
  console.log('\nStep 3/3: Recomputing attendance_status and lwp_value...');

  // present: >= 360 min | half_day: >= 240 min | absent: < 240 min
  const [attStatusResult] = await mc.execute(`
    UPDATE attendance_daily_record
    SET
      attendance_status = CASE
        WHEN raw_minutes >= 360 THEN 'present'
        WHEN raw_minutes >= 240 THEN 'half_day'
        ELSE 'absent'
      END,
      lwp_value = CASE
        WHEN raw_minutes >= 360 THEN 0.00
        WHEN raw_minutes >= 240 THEN 0.50
        ELSE 1.00
      END,
      updated_at = NOW()
    WHERE source_system = 'ncosec_fixed'
      AND is_locked = 0
      AND record_date >= ? AND record_date <= ?
      AND attendance_source = 'biometric'
  `, [FROM, TO]);
  console.log(`  Recomputed status/lwp for ${attStatusResult.affectedRows} rows`);

} else {
  // Dry run: show sample of what would change
  const [sample] = await mc.execute(`
    SELECT
      e.employee_code,
      bio.punch_date,
      bio.first_punch_in                               AS current_in,
      DATE_SUB(bio.first_punch_in, INTERVAL 330 MINUTE) AS corrected_in,
      bio.last_punch_out                               AS current_out,
      DATE_SUB(bio.last_punch_out, INTERVAL 330 MINUTE) AS corrected_out,
      bio.raw_minutes
    FROM biometric_attendance_log bio
    JOIN employees e ON e.id = bio.employee_id
    WHERE bio.source_system = 'ncosec'
      AND bio.punch_date >= ? AND bio.punch_date <= ?
    ORDER BY bio.punch_date, e.employee_code
    LIMIT 10
  `, [FROM, TO]);

  console.log('\nSample of records that WOULD be corrected:');
  console.log('emp_code    punch_date   current_in           corrected_in         min');
  for (const r of sample) {
    console.log(`${String(r.employee_code).padEnd(11)} ${r.punch_date}   ${String(r.current_in).padEnd(20)} ${String(r.corrected_in).padEnd(20)} ${r.raw_minutes}`);
  }
  console.log('\nRun without --dry-run to apply all ' + scope.bio_rows + ' records.');
}

// ── Final count check ─────────────────────────────────────────────────────────
const [[remaining]] = await mc.execute(`
  SELECT COUNT(*) AS still_shifted
  FROM biometric_attendance_log
  WHERE source_system = 'ncosec'
    AND punch_date >= ? AND punch_date <= ?
`, [FROM, TO]);
console.log(`\nRemaining unfix'd ncosec records: ${remaining.still_shifted}`);

const [[attShifted]] = await mc.execute(`
  SELECT COUNT(*) AS shifted_att
  FROM attendance_daily_record
  WHERE record_date >= ? AND record_date <= ?
    AND is_locked = 0
    AND HOUR(clock_in_time) >= 14
    AND clock_in_time IS NOT NULL
`, [FROM, TO]);
console.log(`Attendance records still with HOUR(clock_in) >= 14: ${attShifted.shifted_att}`);

console.log(`\n=== Done${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
await mc.end();
process.exit(0);
