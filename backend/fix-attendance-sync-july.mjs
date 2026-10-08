#!/usr/bin/env node
/**
 * fix-attendance-sync-july.mjs
 * Syncs biometric_attendance_log → attendance_daily_record
 *
 * Usage:
 *   node backend/fix-attendance-sync-july.mjs --from=2026-07-01 --to=2026-07-31 --dry-run
 *   node backend/fix-attendance-sync-july.mjs --from=2026-07-01 --to=2026-07-31
 *   node backend/fix-attendance-sync-july.mjs --from=2026-07-01 --to=2026-07-31 --employee=MAS47814
 */

import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Load .env manually
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

// Parse args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => {
      const [k, ...v] = a.slice(2).split('=');
      return [k, v.length ? v.join('=') : true];
    })
);

const FROM      = args.from     || '2026-07-01';
const TO        = args.to       || '2026-07-31';
const DRY_RUN   = !!args['dry-run'];
const FORCE     = !!args.force;
const EMP_FILTER = args.employee || null;

const HALF_DAY_MIN = 240; // 4 hrs
const PRESENT_MIN  = 360; // 6 hrs

console.log(`\n=== Attendance Sync Fix ===`);
console.log(`Range:    ${FROM} → ${TO}`);
console.log(`Dry run:  ${DRY_RUN}`);
console.log(`Force:    ${FORCE}`);
if (EMP_FILTER) console.log(`Employee: ${EMP_FILTER}`);
console.log('');

const db = await mysql.createConnection({
  host:     process.env.DB_HOST,
  port:     Number(process.env.DB_PORT) || 3306,
  user:     process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
});

const stats = { created: 0, updated: 0, skipped_locked: 0, lwp_fixed: 0, date_mismatch_fixed: 0 };

// --- helpers ---
function classifyStatus(rawMinutes) {
  if (rawMinutes >= PRESENT_MIN)  return { status: 'present',  lwp: 0.00 };
  if (rawMinutes >= HALF_DAY_MIN) return { status: 'half_day', lwp: 0.50 };
  if (rawMinutes > 0)             return { status: 'half_day', lwp: 0.50 };
  return                                 { status: 'absent',   lwp: 1.00 };
}

// --- get employees to process ---
let empQuery = `SELECT e.id, e.employee_code, e.branch_id, e.process_id
                FROM employees e WHERE e.active_status = 1`;
const empParams = [];
if (EMP_FILTER) {
  empQuery += ' AND e.employee_code = ?';
  empParams.push(EMP_FILTER);
}
const [employees] = await db.execute(empQuery, empParams);
console.log(`Processing ${employees.length} employees…\n`);

for (const emp of employees) {
  // Get biometric logs for this employee in range
  const [bioLogs] = await db.execute(
    `SELECT * FROM biometric_attendance_log
     WHERE employee_id = ? AND punch_date >= ? AND punch_date <= ?
     ORDER BY punch_date`,
    [emp.id, FROM, TO]
  );
  if (bioLogs.length === 0) continue;

  for (const bio of bioLogs) {
    const punchDate = bio.punch_date instanceof Date
      ? bio.punch_date.toISOString().slice(0, 10)
      : String(bio.punch_date).slice(0, 10);

    // Check existing attendance record
    const [[existing]] = await db.execute(
      `SELECT * FROM attendance_daily_record
       WHERE employee_id = ? AND record_date = ?`,
      [emp.id, punchDate]
    );

    if (existing) {
      // Skip if locked (unless --force)
      if (existing.is_locked && !FORCE) {
        stats.skipped_locked++;
        continue;
      }

      let needsUpdate = false;
      const updates = {};

      // Fix date mismatch: clock_in_time date doesn't match record_date
      if (bio.first_punch_in && existing.clock_in_time) {
        const clockDate = existing.clock_in_time instanceof Date
          ? existing.clock_in_time.toISOString().slice(0, 10)
          : String(existing.clock_in_time).slice(0, 10);
        if (clockDate !== punchDate) {
          updates.clock_in_time  = bio.first_punch_in;
          updates.clock_out_time = bio.last_punch_out;
          stats.date_mismatch_fixed++;
          needsUpdate = true;
        }
      }

      // Fix missing clock times
      if (!existing.clock_in_time && bio.first_punch_in) {
        updates.clock_in_time  = bio.first_punch_in;
        updates.clock_out_time = bio.last_punch_out;
        needsUpdate = true;
      }

      // Fix LWP: present days should have lwp=0, absent should have lwp=1
      const classified = classifyStatus(bio.raw_minutes || existing.raw_minutes || 0);
      if (existing.attendance_status !== classified.status || Number(existing.lwp_value) !== classified.lwp) {
        updates.attendance_status = classified.status;
        updates.lwp_value         = classified.lwp;
        updates.raw_minutes       = bio.raw_minutes;
        stats.lwp_fixed++;
        needsUpdate = true;
      }

      if (needsUpdate) {
        console.log(`  UPDATE ${emp.employee_code} ${punchDate}: ${existing.attendance_status}→${updates.attendance_status || existing.attendance_status} LWP:${existing.lwp_value}→${updates.lwp_value ?? existing.lwp_value}`);
        if (!DRY_RUN) {
          const setClauses = Object.keys(updates).map(k => `${k} = ?`).join(', ');
          const vals = [...Object.values(updates), emp.id, punchDate];
          await db.execute(
            `UPDATE attendance_daily_record SET ${setClauses}, updated_at = NOW(), source_system = 'sync_fix'
             WHERE employee_id = ? AND record_date = ?`,
            vals
          );
        }
        stats.updated++;
      }
    } else {
      // Create missing record
      const classified = classifyStatus(bio.raw_minutes || 0);
      console.log(`  CREATE ${emp.employee_code} ${punchDate}: ${classified.status} LWP:${classified.lwp} (${bio.raw_minutes}min)`);
      if (!DRY_RUN) {
        await db.execute(
          `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, clock_in_time, clock_out_time,
            raw_minutes, biometric_minutes, attendance_status, lwp_value,
            attendance_source, source_system, source_record_date,
            mismatch_flag, late_mark, late_by_minutes, is_locked,
            branch_id, process_id, created_by, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'biometric', 'sync_fix', ?,
                   0, 0, 0, 0, ?, ?, 'sync_fix', NOW(), NOW())`,
          [
            randomUUID(), emp.id, punchDate,
            bio.first_punch_in || null, bio.last_punch_out || null,
            bio.raw_minutes, bio.raw_minutes,
            classified.status, classified.lwp,
            punchDate,
            emp.branch_id, emp.process_id,
          ]
        );
      }
      stats.created++;
    }
  }
}

console.log(`\n=== Results${DRY_RUN ? ' (DRY RUN - no changes made)' : ''} ===`);
console.log(`  Created:              ${stats.created}`);
console.log(`  Updated:              ${stats.updated}`);
console.log(`  LWP fixed:            ${stats.lwp_fixed}`);
console.log(`  Date mismatches fixed:${stats.date_mismatch_fixed}`);
console.log(`  Skipped (locked):     ${stats.skipped_locked}`);

if (DRY_RUN && (stats.created + stats.updated) > 0) {
  console.log(`\nRun without --dry-run to apply ${stats.created + stats.updated} changes.`);
}

await db.end();
process.exit(0);
