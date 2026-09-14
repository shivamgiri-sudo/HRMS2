#!/usr/bin/env node
/**
 * Fix remaining MAS47814 July 2026 issues:
 * 1. Delete phantom att records for Jul 02, 05, 12, 15 (no COSEC punch)
 * 2. Fix Jul 13 att_rec: clock_out_time was NULL — fill from bio_log
 * 3. Fix Jul 14 bio_log: earlier sync captured only to 15:48; COSEC last punch = 17:33:08 (431 min)
 * 4. Create Jul 14 att_rec (missing)
 *
 * Usage:
 *   node backend/fix-mas47814-phantoms.mjs --dry-run
 *   node backend/fix-mas47814-phantoms.mjs
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
console.log(`\n=== Fix MAS47814 phantom/missing records${DRY_RUN ? ' (DRY RUN)' : ''} ===\n`);

const mc = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME, dateStrings: true,
});

const [[emp]] = await mc.execute(
  'SELECT id, branch_id, process_id FROM employees WHERE employee_code = ? AND active_status = 1 LIMIT 1',
  ['MAS47814']
);
if (!emp) { console.error('Employee MAS47814 not found'); process.exit(1); }

// ── 1. Delete phantom records (no COSEC punch on these dates) ─────────────────
const PHANTOM_DATES = ['2026-07-02', '2026-07-05', '2026-07-12', '2026-07-15'];

for (const date of PHANTOM_DATES) {
  const [[rec]] = await mc.execute(
    'SELECT id, is_locked, attendance_status, clock_in_time FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?',
    [emp.id, date]
  );
  if (!rec) {
    console.log(`  ${date}: no record — skip`);
    continue;
  }
  if (rec.is_locked) {
    console.log(`  ${date}: LOCKED — cannot delete`);
    continue;
  }
  console.log(`  DELETE phantom ${date}: status=${rec.attendance_status}  in=${rec.clock_in_time}`);
  if (!DRY_RUN) {
    await mc.execute(
      'DELETE FROM attendance_daily_record WHERE employee_id = ? AND record_date = ? AND is_locked = 0',
      [emp.id, date]
    );
  }
}

// ── 2. Fix Jul 13: clock_out_time was NULL ────────────────────────────────────
{
  const date = '2026-07-13';
  const [[adr]] = await mc.execute(
    'SELECT id, is_locked, clock_out_time, raw_minutes FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?',
    [emp.id, date]
  );
  if (adr && !adr.is_locked) {
    const correctOut = '2026-07-13 19:20:04';
    const correctMins = 545; // from COSEC: 10:15:42 → 19:20:04
    console.log(`  UPDATE ${date}: clock_out_time NULL → ${correctOut}  raw_minutes → ${correctMins}`);
    if (!DRY_RUN) {
      await mc.execute(
        `UPDATE attendance_daily_record
         SET clock_out_time = ?, raw_minutes = ?, source_system = 'cosec_sqlserver', updated_at = NOW()
         WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
        [correctOut, correctMins, emp.id, date]
      );
    }
  } else if (adr?.is_locked) {
    console.log(`  ${date}: LOCKED — cannot fix`);
  } else {
    console.log(`  ${date}: no att record — skip`);
  }
}

// ── 3. Fix Jul 14 bio_log: update to full COSEC last punch ───────────────────
{
  const date = '2026-07-14';
  const correctIn   = '2026-07-14 10:22:09';
  const correctOut  = '2026-07-14 17:33:08'; // COSEC max punch (11 punches)
  const correctMins = 431;                    // DATEDIFF(MINUTE, 10:22:09, 17:33:08)
  const [[bio]] = await mc.execute(
    'SELECT id, first_punch_in, last_punch_out, raw_minutes FROM biometric_attendance_log WHERE employee_id = ? AND punch_date = ?',
    [emp.id, date]
  );
  if (bio) {
    console.log(`  UPDATE bio_log ${date}: out ${bio.last_punch_out} → ${correctOut}  ${bio.raw_minutes}min → ${correctMins}min`);
    if (!DRY_RUN) {
      await mc.execute(
        `UPDATE biometric_attendance_log
         SET first_punch_in = ?, last_punch_out = ?, raw_minutes = ?, source_system = 'cosec_sqlserver', migrated_at = NOW()
         WHERE employee_id = ? AND punch_date = ?`,
        [correctIn, correctOut, correctMins, emp.id, date]
      );
    }
  } else {
    console.log(`  CREATE bio_log ${date}: in=${correctIn}  out=${correctOut}  ${correctMins}min`);
    if (!DRY_RUN) {
      await mc.execute(
        `INSERT INTO biometric_attendance_log
           (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out,
            total_punches, raw_minutes, source_system, migrated_at)
         VALUES (UUID(), ?, 'MAS47814', ?, ?, ?, 11, ?, 'cosec_sqlserver', NOW())`,
        [emp.id, date, correctIn, correctOut, correctMins]
      );
    }
  }

  // ── 4. Create Jul 14 att_rec ─────────────────────────────────────────────────
  const [[existingAtt]] = await mc.execute(
    'SELECT id FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?',
    [emp.id, date]
  );
  if (existingAtt) {
    console.log(`  Jul 14 att_rec already exists — update times`);
    if (!DRY_RUN) {
      await mc.execute(
        `UPDATE attendance_daily_record
         SET clock_in_time = ?, clock_out_time = ?, raw_minutes = ?,
             attendance_status = 'present', lwp_value = 0,
             source_system = 'cosec_sqlserver', updated_at = NOW()
         WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
        [correctIn, correctOut, correctMins, emp.id, date]
      );
    }
  } else {
    // 431 min >= 360 = present
    console.log(`  CREATE att_rec ${date}: present lwp=0  in=${correctIn}  out=${correctOut}  ${correctMins}min`);
    if (!DRY_RUN) {
      await mc.execute(
        `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, clock_in_time, clock_out_time,
            raw_minutes, biometric_minutes, attendance_status, lwp_value,
            attendance_source, source_system, source_record_date,
            mismatch_flag, late_mark, late_by_minutes, is_locked,
            branch_id, process_id, created_by, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, 'present', 0.00,
                 'biometric', 'cosec_sqlserver', ?,
                 0, 0, 0, 0, ?, ?, 'cosec_patch', NOW(), NOW())`,
        [emp.id, date, correctIn, correctOut, correctMins, correctMins, date, emp.branch_id, emp.process_id]
      );
    }
  }
}

console.log(`\n=== Done${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
if (DRY_RUN) console.log('Run without --dry-run to apply.');

await mc.end();
process.exit(0);
