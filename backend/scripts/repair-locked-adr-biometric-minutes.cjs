#!/usr/bin/env node
/* eslint-disable no-console */
/**
 * repair-locked-adr-biometric-minutes.cjs
 *
 * Locked attendance days (APR bulk upload, approved regularization) never had their COSEC
 * hours refreshed, because the engine upsert froze biometric_minutes on is_locked = 1 rows.
 * They show blank hours, or stale 22-23 h values from before the night-shift fix.
 *
 * This script copies the current integration_biometric_daily minutes onto those locked
 * attendance_daily_record rows. It changes ONLY biometric_minutes. attendance_status,
 * raw_minutes, lwp_value and every other pay-relevant column are left untouched.
 *
 * Selects rows where:
 *   adr.is_locked = 1
 *   adr.source_system IN ('apr_bulk','regularization')
 *   adr.record_date BETWEEN <from> AND <to>
 *   integration_biometric_daily minutes > 0 for that employee_code + date
 *   adr.biometric_minutes IS NULL, or differs from COSEC by more than 30 minutes
 *
 * Usage (from backend/):
 *   node scripts/repair-locked-adr-biometric-minutes.cjs 2026-10-01 2026-10-15          # dry run
 *   node scripts/repair-locked-adr-biometric-minutes.cjs 2026-10-01 2026-10-15 --apply  # write
 *
 * --apply first writes a JSON backup (id + old/new biometric_minutes) next to this script,
 * then updates in chunks of 200 with `WHERE id IN (...) AND is_locked = 1`.
 *
 * DB credentials come from backend/.env (override the file path with ENV_FILE=...).
 */
const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");

const CHUNK_SIZE = 200;
const DIFF_THRESHOLD_MINUTES = 30;
const SUSPICIOUS_MINUTES = 900;
const SAMPLE_SIZE = 10;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function readEnv(file) {
  if (!fs.existsSync(file)) {
    throw new Error(`env file not found: ${file}`);
  }
  const out = {};
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2].trim();
    if (v.length >= 2 && v.startsWith('"') && v.endsWith('"')) v = v.slice(1, -1);
    out[m[1]] = v;
  }
  return out;
}

function parseArgs(argv) {
  const positional = argv.filter((a) => !a.startsWith("--"));
  const apply = argv.includes("--apply");
  const [from, to] = positional;
  if (!DATE_RE.test(from || "") || !DATE_RE.test(to || "") || from > to) {
    console.error("Usage: node scripts/repair-locked-adr-biometric-minutes.cjs <from YYYY-MM-DD> <to YYYY-MM-DD> [--apply]");
    process.exit(2);
  }
  return { from, to, apply };
}

const CANDIDATE_SQL = `
  SELECT adr.id,
         e.employee_code,
         DATE_FORMAT(adr.record_date, '%Y-%m-%d') AS record_date,
         adr.source_system,
         adr.attendance_status,
         adr.biometric_minutes AS old_minutes,
         ibd.minutes AS new_minutes
    FROM attendance_daily_record adr
    JOIN employees e ON e.id = adr.employee_id
    JOIN (
      SELECT employee_code, activity_date, MAX(biometric_minutes) AS minutes
        FROM integration_biometric_daily
       WHERE activity_date BETWEEN ? AND ?
         AND biometric_minutes > 0
       GROUP BY employee_code, activity_date
    ) ibd ON ibd.employee_code = e.employee_code AND ibd.activity_date = adr.record_date
   WHERE adr.is_locked = 1
     AND adr.source_system IN ('apr_bulk', 'regularization')
     AND adr.record_date BETWEEN ? AND ?
     AND (adr.biometric_minutes IS NULL
          OR ABS(adr.biometric_minutes - ibd.minutes) > ${DIFF_THRESHOLD_MINUTES})
   ORDER BY adr.record_date, e.employee_code`;

function summarize(rows) {
  const blank = rows.filter((r) => r.old_minutes === null).length;
  const over900 = rows.filter((r) => r.old_minutes !== null && Number(r.old_minutes) > SUSPICIOUS_MINUTES).length;
  console.log(`Candidate locked rows : ${rows.length}`);
  console.log(`  blank (NULL) minutes: ${blank}`);
  console.log(`  stale > ${SUSPICIOUS_MINUTES} min     : ${over900}`);
  console.log(`  other > ${DIFF_THRESHOLD_MINUTES} min diff : ${rows.length - blank - over900}`);
  const bySource = rows.reduce((acc, r) => ({ ...acc, [r.source_system]: (acc[r.source_system] || 0) + 1 }), {});
  console.log("  by source_system    :", JSON.stringify(bySource));
  console.log(`\nSamples (first ${SAMPLE_SIZE}):`);
  console.table(rows.slice(0, SAMPLE_SIZE).map((r) => ({
    employee_code: r.employee_code,
    date: r.record_date,
    source: r.source_system,
    status: r.attendance_status,
    old_minutes: r.old_minutes,
    new_minutes: r.new_minutes,
  })));
}

function writeBackup(rows, from, to) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const file = path.join(__dirname, `repair-locked-adr-biometric-minutes.backup.${from}_${to}.${stamp}.json`);
  const payload = rows.map((r) => ({
    id: r.id,
    employee_code: r.employee_code,
    record_date: r.record_date,
    old_biometric_minutes: r.old_minutes,
    new_biometric_minutes: r.new_minutes,
  }));
  fs.writeFileSync(file, JSON.stringify({ from, to, created_at: new Date().toISOString(), rows: payload }, null, 2));
  return file;
}

async function applyUpdates(conn, rows) {
  let updated = 0;
  for (let i = 0; i < rows.length; i += CHUNK_SIZE) {
    const chunk = rows.slice(i, i + CHUNK_SIZE);
    const cases = chunk.map(() => "WHEN ? THEN ?").join(" ");
    const caseParams = chunk.flatMap((r) => [r.id, Number(r.new_minutes)]);
    const ids = chunk.map((r) => r.id);
    const [res] = await conn.execute(
      `UPDATE attendance_daily_record
          SET biometric_minutes = CASE id ${cases} ELSE biometric_minutes END
        WHERE id IN (${ids.map(() => "?").join(",")}) AND is_locked = 1`,
      [...caseParams, ...ids],
    );
    updated += res.affectedRows;
    console.log(`  chunk ${i / CHUNK_SIZE + 1}: ${res.affectedRows} row(s) updated`);
  }
  return updated;
}

async function main() {
  const { from, to, apply } = parseArgs(process.argv.slice(2));
  const env = readEnv(process.env.ENV_FILE || path.join(__dirname, "..", ".env"));
  const conn = await mysql.createConnection({
    host: env.DB_HOST,
    port: Number(env.DB_PORT || 3306),
    user: env.DB_USER,
    password: env.DB_PASSWORD,
    database: env.DB_NAME,
    dateStrings: true,
  });
  try {
    console.log(`DB ${env.DB_HOST}/${env.DB_NAME}  range ${from}..${to}  mode ${apply ? "APPLY" : "DRY-RUN"}\n`);
    const [rows] = await conn.execute(CANDIDATE_SQL, [from, to, from, to]);
    summarize(rows);
    if (!apply) {
      console.log("\nDry run only. Re-run with --apply to write biometric_minutes.");
      return;
    }
    if (rows.length === 0) {
      console.log("\nNothing to update.");
      return;
    }
    const backup = writeBackup(rows, from, to);
    console.log(`\nBackup written: ${backup}`);
    const updated = await applyUpdates(conn, rows);
    console.log(`\nDone. ${updated} of ${rows.length} row(s) updated (only biometric_minutes).`);
  } finally {
    await conn.end();
  }
}

main().catch((err) => {
  console.error("repair failed:", err && err.message ? err.message : err);
  process.exit(1);
});
