#!/usr/bin/env node
/**
 * resync-cosec-correct.mjs
 * Re-pulls directly from COSEC SQL Server and overwrites biometric_attendance_log
 * + attendance_daily_record with correct times — no tagIST(), stores exactly
 * what COSEC has (COSEC stores IST wall-clock; mysql2 pool timezone=+05:30
 * handles bare strings correctly without double-shift).
 *
 * Usage:
 *   node backend/resync-cosec-correct.mjs --from=2026-07-01 --to=2026-07-14
 *   node backend/resync-cosec-correct.mjs --from=2026-07-01 --to=2026-07-14 --employee=MAS47814
 *   node backend/resync-cosec-correct.mjs --from=2026-07-01 --to=2026-07-14 --dry-run
 */

import sql from 'mssql';
import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { randomUUID } from 'crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
try {
  const env = readFileSync(resolve(__dirname, '.env'), 'utf8');
  for (const line of env.split('\n')) {
    const m = line.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
    if (m) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch {}

const args = Object.fromEntries(
  process.argv.slice(2).filter(a => a.startsWith('--')).map(a => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : true];
  })
);

const FROM       = args.from     || '2026-07-01';
const TO         = args.to       || '2026-07-14';
const DRY_RUN    = !!args['dry-run'];
const EMP_FILTER = args.employee || null;

const HALF_DAY_MIN = 240;
const PRESENT_MIN  = 360;

function classifyStatus(mins) {
  if (mins >= PRESENT_MIN)  return { status: 'present',  lwp: 0.00 };
  if (mins >= HALF_DAY_MIN) return { status: 'half_day', lwp: 0.50 };
  if (mins > 0)             return { status: 'half_day', lwp: 0.50 };
  return                           { status: 'absent',   lwp: 1.00 };
}

console.log(`\n=== COSEC Direct Re-Sync ===`);
console.log(`Range    : ${FROM} → ${TO}`);
console.log(`Dry run  : ${DRY_RUN}`);
if (EMP_FILTER) console.log(`Employee : ${EMP_FILTER}`);
console.log('');

// ── Connections ───────────────────────────────────────────────────────────────
const mc = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT) || 3306,
  user: process.env.DB_USER, password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  // NO dateStrings here — we insert plain strings, pool handles timezone
  timezone: '+05:30',
});

const cosecPool = await sql.connect({
  server:   process.env.NCOSEC_DB_HOST,
  port:     Number(process.env.NCOSEC_DB_PORT) || 1433,
  user:     process.env.NCOSEC_DB_USER,
  password: process.env.NCOSEC_DB_PASSWORD,
  database: process.env.NCOSEC_DB_NAME || 'NCOSEC',
  options:  { encrypt: false, trustServerCertificate: true },
});

// ── Pull COSEC grouped punches ────────────────────────────────────────────────
const cosecReq = cosecPool.request()
  .input('from', sql.DateTime, new Date(FROM + 'T00:00:00'))
  .input('to',   sql.DateTime, new Date(TO   + 'T23:59:59'));

// If single employee, add filter
if (EMP_FILTER) {
  // Resolve COSEC user IDs for this employee
  const [[ebe]] = await mc.execute(
    `SELECT cosec_user_id FROM employee_biometric_enrollment ebe
     JOIN employees e ON e.id = ebe.employee_id
     WHERE e.employee_code = ? AND ebe.is_active = 1 LIMIT 1`,
    [EMP_FILTER]
  );
  const [[empRow]] = await mc.execute(
    `SELECT biometric_code, employee_code FROM employees WHERE employee_code = ? LIMIT 1`,
    [EMP_FILTER]
  );
  const cosecId = ebe?.cosec_user_id || empRow?.biometric_code || EMP_FILTER;
  cosecReq.input('uid', sql.NVarChar(100), cosecId);
  console.log(`COSEC ID : ${cosecId}`);
}

const userFilter = EMP_FILTER ? 'AND UserID = @uid' : '';
const cosecResult = await cosecReq.query(`
  SELECT
    CAST(UserID AS NVARCHAR(100))             AS user_id,
    CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23) AS punch_date,
    CONVERT(CHAR(19), MIN(Edatetime), 120)    AS first_punch,
    CONVERT(CHAR(19), MAX(Edatetime), 120)    AS last_punch,
    COUNT_BIG(*)                              AS total_punches,
    DATEDIFF(MINUTE, MIN(Edatetime), MAX(Edatetime)) AS working_minutes
  FROM dbo.Mx_ATDEventTrn
  WHERE Edatetime >= @from
    AND Edatetime <= @to
    AND UserID IS NOT NULL
    ${userFilter}
  GROUP BY UserID, CAST(Edatetime AS DATE)
  ORDER BY UserID, punch_date
`);

console.log(`Pulled ${cosecResult.recordset.length} punch-day groups from COSEC\n`);

const stats = { migrated: 0, skipped: 0, unmapped: 0 };

for (const row of cosecResult.recordset) {
  const cosecUserId = String(row.user_id).trim();
  const punchDate   = String(row.punch_date).trim();
  const firstPunch  = String(row.first_punch).trim();  // "YYYY-MM-DD HH:mm:ss" — IST from COSEC, store as-is
  const lastPunch   = String(row.last_punch).trim();
  const totalPunches = Number(row.total_punches);
  const workingMins  = Number(row.working_minutes);
  const classified   = classifyStatus(workingMins);

  // Resolve employee
  const [[emp]] = await mc.execute(
    `SELECT e.id, e.employee_code, e.branch_id, e.process_id
     FROM employees e
     LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id AND ebe.is_active = 1
     WHERE (ebe.cosec_user_id = ? OR e.biometric_code = ? OR e.employee_code = ?)
       AND e.active_status = 1
     ORDER BY CASE WHEN ebe.cosec_user_id = ? THEN 0 WHEN e.biometric_code = ? THEN 1 ELSE 2 END
     LIMIT 1`,
    [cosecUserId, cosecUserId, cosecUserId, cosecUserId, cosecUserId]
  );

  if (!emp) {
    console.log(`  UNMAPPED  ${cosecUserId} ${punchDate}`);
    stats.unmapped++;
    continue;
  }

  console.log(`  ${DRY_RUN ? 'WOULD UPDATE' : 'UPDATING'} ${emp.employee_code} ${punchDate} : in=${firstPunch}  out=${lastPunch}  ${workingMins}min → ${classified.status}`);

  if (!DRY_RUN) {
    // 1. biometric_attendance_log — overwrite with exact COSEC times
    await mc.execute(
      `INSERT INTO biometric_attendance_log
         (id, employee_id, cosec_user_id, punch_date, first_punch_in, last_punch_out,
          total_punches, raw_minutes, source_system, migrated_at)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, 'cosec_sqlserver', NOW())
       ON DUPLICATE KEY UPDATE
         cosec_user_id  = VALUES(cosec_user_id),
         first_punch_in = VALUES(first_punch_in),
         last_punch_out = VALUES(last_punch_out),
         total_punches  = VALUES(total_punches),
         raw_minutes    = VALUES(raw_minutes),
         source_system  = 'cosec_sqlserver',
         migrated_at    = NOW()`,
      [emp.id, cosecUserId, punchDate, firstPunch, lastPunch, totalPunches, workingMins]
    );

    // 2. attendance_daily_record — upsert with correct times + status
    const [[existing]] = await mc.execute(
      `SELECT id, is_locked FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?`,
      [emp.id, punchDate]
    );

    if (existing) {
      if (existing.is_locked) {
        console.log(`    SKIPPED (locked)`);
        stats.skipped++;
        continue;
      }
      await mc.execute(
        `UPDATE attendance_daily_record
         SET clock_in_time = ?, clock_out_time = ?,
             raw_minutes = ?, attendance_status = ?, lwp_value = ?,
             source_system = 'cosec_sqlserver', updated_at = NOW()
         WHERE employee_id = ? AND record_date = ? AND is_locked = 0`,
        [firstPunch, lastPunch, workingMins, classified.status, classified.lwp, emp.id, punchDate]
      );
    } else {
      await mc.execute(
        `INSERT INTO attendance_daily_record
           (id, employee_id, record_date, clock_in_time, clock_out_time,
            raw_minutes, biometric_minutes, attendance_status, lwp_value,
            attendance_source, source_system, source_record_date,
            mismatch_flag, late_mark, late_by_minutes, is_locked,
            branch_id, process_id, created_by, created_at, updated_at)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, 'biometric', 'cosec_sqlserver', ?,
                 0, 0, 0, 0, ?, ?, 'cosec_resync', NOW(), NOW())`,
        [emp.id, punchDate, firstPunch, lastPunch,
         workingMins, workingMins, classified.status, classified.lwp,
         punchDate, emp.branch_id, emp.process_id]
      );
    }
  }

  stats.migrated++;
}

console.log(`\n=== Results${DRY_RUN ? ' (DRY RUN)' : ''} ===`);
console.log(`  Migrated : ${stats.migrated}`);
console.log(`  Skipped  : ${stats.skipped} (locked)`);
console.log(`  Unmapped : ${stats.unmapped}`);

await mc.end();
await cosecPool.close();
process.exit(0);
