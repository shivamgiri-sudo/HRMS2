#!/usr/bin/env node
/**
 * Patches attendance records using the COSEC data we already verified.
 * Times are taken directly from COSEC (verified in check-cosec-mas47814.mjs output).
 * No COSEC connection needed — writes exact values directly to mas_hrms.
 *
 * Usage:
 *   node backend/patch-attendance-from-cosec-data.mjs --dry-run
 *   node backend/patch-attendance-from-cosec-data.mjs
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

// ── Verified COSEC data (from direct COSEC query on 2026-07-14) ──────────────
// Source: check-cosec-mas47814.mjs output, grouped by punch_date
// Format: { empCode, punchDate, firstIn, lastOut, workMins }
const VERIFIED_COSEC = [
  // MAS47814 — Jul 1-14 (only days with actual punches)
  { empCode:'MAS47814', punchDate:'2026-07-01', firstIn:'2026-07-01 10:21:55', lastOut:'2026-07-01 20:43:36', workMins:622 },
  { empCode:'MAS47814', punchDate:'2026-07-03', firstIn:'2026-07-03 10:24:24', lastOut:'2026-07-03 20:23:44', workMins:599 },
  { empCode:'MAS47814', punchDate:'2026-07-04', firstIn:'2026-07-04 09:51:10', lastOut:'2026-07-04 19:00:17', workMins:549 },
  { empCode:'MAS47814', punchDate:'2026-07-06', firstIn:'2026-07-06 10:27:16', lastOut:'2026-07-06 20:50:30', workMins:623 },
  { empCode:'MAS47814', punchDate:'2026-07-07', firstIn:'2026-07-07 10:31:47', lastOut:'2026-07-07 19:50:19', workMins:559 },
  { empCode:'MAS47814', punchDate:'2026-07-08', firstIn:'2026-07-08 10:30:16', lastOut:'2026-07-08 22:09:38', workMins:699 },
  { empCode:'MAS47814', punchDate:'2026-07-09', firstIn:'2026-07-09 11:15:45', lastOut:'2026-07-09 18:56:46', workMins:461 },
  { empCode:'MAS47814', punchDate:'2026-07-10', firstIn:'2026-07-10 10:34:21', lastOut:'2026-07-10 21:24:40', workMins:650 },
  // Jul 11, 13, 14 are already correct (cosec_sqlserver path)
];

const HALF_DAY_MIN = 240;
const PRESENT_MIN  = 360;
function classify(mins) {
  if (mins >= PRESENT_MIN)  return { status: 'present',  lwp: 0.00 };
  if (mins >= HALF_DAY_MIN) return { status: 'half_day', lwp: 0.50 };
  if (mins > 0)             return { status: 'half_day', lwp: 0.50 };
  return                           { status: 'absent',   lwp: 1.00 };
}

console.log(`\n=== Patch attendance from verified COSEC data${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`);

const mc = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true,
});

const stats = { patched: 0, created: 0, skipped: 0 };

for (const rec of VERIFIED_COSEC) {
  const { empCode, punchDate, firstIn, lastOut, workMins } = rec;
  const cls = classify(workMins);

  // Resolve employee id
  const [[emp]] = await mc.execute(
    'SELECT id, branch_id, process_id FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1',
    [empCode]
  );
  if (!emp) { console.log(`  SKIP ${empCode} — not found`); continue; }

  // 1. Update biometric_attendance_log
  const [[bio]] = await mc.execute(
    'SELECT id FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ? LIMIT 1',
    [emp.id, punchDate]
  );

  if (bio) {
    console.log(`  BIO  UPDATE ${empCode} ${punchDate}: in=${firstIn}  out=${lastOut}  ${workMins}min`);
    if (!DRY_RUN) {
      await mc.execute(
        `UPDATE biometric_attendance_log
         SET first_punch_in=?, last_punch_out=?, raw_minutes=?, source_system='cosec_sqlserver', migrated_at=NOW()
         WHERE employee_id=? AND punch_date=?`,
        [firstIn, lastOut, workMins, emp.id, punchDate]
      );
    }
  } else {
    console.log(`  BIO  CREATE ${empCode} ${punchDate}: in=${firstIn}  out=${lastOut}  ${workMins}min`);
    if (!DRY_RUN) {
      await mc.execute(
        `INSERT INTO biometric_attendance_log
           (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out,
            total_punches, raw_minutes, source_system, migrated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, 2, ?, 'cosec_sqlserver', NOW())`,
        [emp.id, empCode, punchDate, firstIn, lastOut, workMins]
      );
    }
  }

  // 2. Update attendance_daily_record
  const [[adr]] = await mc.execute(
    'SELECT id, is_locked, attendance_status, lwp_value FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? LIMIT 1',
    [emp.id, punchDate]
  );

  if (adr) {
    if (adr.is_locked) {
      console.log(`  ATT  SKIP  ${empCode} ${punchDate}: LOCKED`);
      stats.skipped++;
      continue;
    }
    console.log(`  ATT  UPDATE ${empCode} ${punchDate}: ${adr.attendance_status}(lwp=${adr.lwp_value}) → ${cls.status}(lwp=${cls.lwp})`);
    if (!DRY_RUN) {
      await mc.execute(
        `UPDATE attendance_daily_record
         SET clock_in_time=?, clock_out_time=?, raw_minutes=?,
             attendance_status=?, lwp_value=?,
             source_system='cosec_sqlserver', updated_at=NOW()
         WHERE employee_id=? AND record_date=? AND is_locked=0`,
        [firstIn, lastOut, workMins, cls.status, cls.lwp, emp.id, punchDate]
      );
    }
    stats.patched++;
  } else {
    console.log(`  ATT  CREATE ${empCode} ${punchDate}: ${cls.status} lwp=${cls.lwp}`);
    if (!DRY_RUN) {
      await mc.execute(
        `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, clock_in_time, clock_out_time,
            raw_minutes, biometric_minutes, attendance_status, lwp_value,
            attendance_source, source_system, source_record_date,
            mismatch_flag, late_mark, late_by_minutes, is_locked,
            branch_id, process_id, created_by, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'biometric', 'cosec_sqlserver', ?,
                 0, 0, 0, 0, ?, ?, 'cosec_patch', NOW(), NOW())`,
        [emp.id, punchDate, firstIn, lastOut, workMins, workMins,
         cls.status, cls.lwp, punchDate, emp.branch_id, emp.process_id]
      );
    }
    stats.created++;
  }
}

console.log(`\n=== Done${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`  Patched : ${stats.patched}`);
console.log(`  Created : ${stats.created}`);
console.log(`  Skipped : ${stats.skipped} (locked)`);
if (DRY_RUN) console.log('\nRun without --dry-run to apply.');

await mc.end();
process.exit(0);
