#!/usr/bin/env node
// One-shot: apply 1906 attendance data fixes with retry on lock contention.
// Run: node backend/scripts/apply-1906-attendance-fixes.mjs

import mysql from "mysql2/promise";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";

const __dir = dirname(fileURLToPath(import.meta.url));
const envPath = resolve(__dir, "../.env");

const env = {};
for (const line of readFileSync(envPath, "utf8").split("\n")) {
  const raw = line.trim();
  if (!raw || raw.startsWith("#")) continue;
  const eq = raw.indexOf("=");
  if (eq < 0) continue;
  const key = raw.slice(0, eq).trim();
  let val = raw.slice(eq + 1).trim();
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  env[key] = val;
}

const pool = await mysql.createPool({
  host: env.DB_HOST, port: Number(env.DB_PORT) || 3306,
  user: env.DB_USER, password: env.DB_PASSWORD, database: env.DB_NAME,
  waitForConnections: true, connectionLimit: 1,
});

const SYSTEM_UUID = "00000000-0000-0000-0000-000000000001";

// Each step is independent — run them one at a time with individual retries.
const STEPS = [
  {
    label: "Fix process_id for mis-mapped employees",
    sql: `UPDATE employees e
          JOIN cost_centre_master ccm ON ccm.id = e.cost_centre_id
          SET e.process_id = ccm.process_id
          WHERE e.employee_code IN ('MAS62122','MAS62918','MAS62921','MAS63343','MAS63085','MAS62917')
            AND ccm.process_id IS NOT NULL
            AND (e.process_id IS NULL OR e.process_id != ccm.process_id)`,
  },
  {
    label: "Exception bucket INSERT for MAS07279 (525-min threshold)",
    sql: `INSERT INTO employee_attendance_exception_bucket
            (id, employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason, active_status, created_by)
          SELECT UUID(), e.id, 0, 525,
            'Owner ruling 2026-09-28: MAS07279 Parveen — full-day threshold corrected to 525 min (8h45m)',
            1, '${SYSTEM_UUID}'
          FROM employees e
          WHERE e.employee_code = 'MAS07279'
            AND NOT EXISTS (SELECT 1 FROM employee_attendance_exception_bucket x WHERE x.employee_id = e.id AND x.active_status = 1)`,
  },
  {
    label: "Exception bucket UPDATE for MAS07279 if row exists",
    sql: `UPDATE employee_attendance_exception_bucket eaeb
          JOIN employees e ON e.id = eaeb.employee_id
          SET eaeb.full_day_threshold_minutes = 525,
              eaeb.reason = 'Owner ruling 2026-09-28: MAS07279 Parveen — full-day threshold corrected to 525 min (8h45m)'
          WHERE e.employee_code = 'MAS07279' AND eaeb.active_status = 1 AND eaeb.full_day_threshold_minutes != 525`,
  },
  {
    label: "Exception bucket INSERT for MAS01963 (single punch = present)",
    sql: `INSERT INTO employee_attendance_exception_bucket
            (id, employee_id, single_punch_counts_as_present, full_day_threshold_minutes, reason, active_status, created_by)
          SELECT UUID(), e.id, 1, NULL,
            'Owner ruling 2026-09-28: MAS01963 Sudeep Negi — single punch counts as present',
            1, '${SYSTEM_UUID}'
          FROM employees e
          WHERE e.employee_code = 'MAS01963'
            AND NOT EXISTS (SELECT 1 FROM employee_attendance_exception_bucket x WHERE x.employee_id = e.id AND x.active_status = 1)`,
  },
  {
    label: "Exception bucket UPDATE for MAS01963 if row exists",
    sql: `UPDATE employee_attendance_exception_bucket eaeb
          JOIN employees e ON e.id = eaeb.employee_id
          SET eaeb.single_punch_counts_as_present = 1,
              eaeb.reason = 'Owner ruling 2026-09-28: MAS01963 Sudeep Negi — single punch counts as present'
          WHERE e.employee_code = 'MAS01963' AND eaeb.active_status = 1 AND eaeb.single_punch_counts_as_present != 1`,
  },
  {
    label: "Deactivate MAS52717 (left Aug-2023)",
    sql: `UPDATE employees
          SET date_of_leaving = COALESCE(date_of_leaving, '2023-08-31'),
              employment_status = IF(employment_status IN ('Active','active'), 'Inactive', employment_status),
              active_status = 0
          WHERE employee_code = 'MAS52717'
            AND (date_of_leaving IS NULL OR employment_status IN ('Active','active'))`,
  },
];

const MAX_RETRIES = 8;
const RETRY_DELAY_MS = 10_000;

for (const step of STEPS) {
  let done = false;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    const conn = await pool.getConnection();
    try {
      await conn.query("SET SESSION innodb_lock_wait_timeout = 60");
      const [result] = await conn.query(step.sql);
      console.log(`✓ ${step.label} (affected: ${result.affectedRows})`);
      done = true;
      break;
    } catch (err) {
      if (err.code === "ER_LOCK_WAIT_TIMEOUT" && attempt < MAX_RETRIES) {
        console.log(`  [${step.label}] lock timeout — retry ${attempt}/${MAX_RETRIES} in ${RETRY_DELAY_MS/1000}s`);
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS));
      } else {
        console.error(`✗ ${step.label}: ${err.message}`);
        process.exit(1);
      }
    } finally {
      conn.release();
    }
  }
  if (!done) { console.error(`✗ ${step.label}: exhausted retries`); process.exit(1); }
}

await pool.end();
console.log("All steps complete.");
