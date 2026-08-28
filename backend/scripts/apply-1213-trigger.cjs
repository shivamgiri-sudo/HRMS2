#!/usr/bin/env node
/**
 * Apply migration 1213's wfm_shift_master immutability trigger, and verify it fires.
 *
 *   MYSQL_ROOT_PASSWORD=... node backend/scripts/apply-1213-trigger.cjs            # dry run
 *   MYSQL_ROOT_PASSWORD=... node backend/scripts/apply-1213-trigger.cjs --apply
 *
 * ── Why this needs its own script ───────────────────────────────────────────────
 *
 * 1213 is NOT in MIGRATION_MANIFEST (it sits in knownUnlisted) and never has been —
 * it is applied by hand, deliberately, because the file's own header says so.
 *
 * It cannot be applied by the app account. Probed live 2026-08-28 on a throwaway table
 * in a scratch schema: `shivam_user` holds ALL PRIVILEGES on mas_hrms but not global
 * SUPER, and with `log_bin = 1` and `log_bin_trust_function_creators = 0` the server
 * rejects trigger creation with ER_BINLOG_CREATE_ROUTINE_NEED_SUPER. Owner chose to
 * apply it as root rather than set `log_bin_trust_function_creators = 1`, which would
 * be a permanent server-wide relaxation affecting every database on the host for the
 * sake of one trigger.
 *
 * The .sql file cannot be piped through a driver as-is: it uses `DELIMITER $$`, which is
 * a mysql CLI directive the server has never heard of. This sends the CREATE TRIGGER as
 * one statement, which is what the driver actually needs, and keeps the .sql file as the
 * canonical record.
 *
 * ── The bug this trigger used to have ───────────────────────────────────────────
 *
 * The body tested `@has_is_locked = 1`, a user variable set by the migration session.
 * User variables are session-scoped, so every session that would ever fire the trigger
 * reads NULL, `NULL = 1` is NULL, and the SIGNAL could never be raised. Fixed in
 * 282b8842; the body now tests row state only. The verification below exists because
 * "the trigger was created" and "the trigger works" are different claims, and the old
 * version would have satisfied the first while failing the second.
 *
 * The password is read from MYSQL_ROOT_PASSWORD and never written to disk or logged.
 */

const fs = require('node:fs');
const path = require('node:path');
const mysql = require('mysql2/promise');

const APPLY = process.argv.includes('--apply');
const ROOT_PASSWORD = process.env.MYSQL_ROOT_PASSWORD;

function readEnv(file) {
  const out = {};
  for (const line of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)$/);
    if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
  }
  return out;
}
const env = readEnv(path.join(__dirname, '..', '.env'));

const TRIGGER = 'trg_wfm_shift_master_protect_locked';

/**
 * Kept byte-identical to the body in sql/1213_wfm_shift_master_immutability_trigger.sql,
 * minus the CLI-only DELIMITER wrapper. If you change one, change both.
 */
const CREATE_TRIGGER = `
CREATE TRIGGER ${TRIGGER}
BEFORE UPDATE ON wfm_shift_master
FOR EACH ROW
BEGIN
  IF OLD.is_locked = 1 AND (
       NOT (NEW.start_time <=> OLD.start_time)
    OR NOT (NEW.end_time <=> OLD.end_time)
    OR NOT (NEW.required_minutes <=> OLD.required_minutes)
  ) THEN
    SIGNAL SQLSTATE '45000'
      SET MESSAGE_TEXT = 'wfm_shift_master: start_time/end_time/required_minutes are immutable on a locked shift version; create a new version instead';
  END IF;
END`;

async function main() {
  if (!ROOT_PASSWORD) {
    console.error('MYSQL_ROOT_PASSWORD is not set. Refusing to guess.');
    process.exit(1);
  }

  const root = await mysql.createConnection({
    host: env.DB_HOST, port: Number(env.DB_PORT || 3306),
    user: 'root', password: ROOT_PASSWORD, database: env.DB_NAME,
    multipleStatements: false,
  });

  const [[state]] = await root.query(
    `SELECT
       (SELECT COUNT(*) FROM information_schema.TRIGGERS
         WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?)                      AS trigger_exists,
       (SELECT COUNT(*) FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master'
           AND COLUMN_NAME = 'is_locked')                                             AS is_locked_present,
       (SELECT COUNT(*) FROM wfm_shift_master)                                        AS shift_rows,
       (SELECT COUNT(*) FROM wfm_shift_master WHERE is_locked = 1)                    AS locked_rows`,
    [TRIGGER],
  );
  console.log(`mode: ${APPLY ? 'APPLY' : 'DRY RUN'}`);
  console.log(`  trigger already present : ${state.trigger_exists}`);
  console.log(`  is_locked column        : ${state.is_locked_present}`);
  console.log(`  wfm_shift_master rows   : ${state.shift_rows} (${state.locked_rows} locked)`);

  if (!state.is_locked_present) {
    console.error('\nis_locked is missing — run migration 1200 first. Nothing done.');
    await root.end();
    process.exit(1);
  }
  if (!APPLY) {
    console.log('\nDry run — no DDL issued. Re-run with --apply.');
    await root.end();
    return;
  }

  await root.query(`DROP TRIGGER IF EXISTS ${TRIGGER}`);
  await root.query(CREATE_TRIGGER);
  console.log('\ntrigger created');

  // ── Verify it actually fires, on a row we create and remove ourselves ──────────
  //
  // Not on a real locked shift: proving the guard works means issuing an UPDATE that
  // must be rejected, and an UPDATE against live payroll-relevant data is not the
  // place to find out the trigger was written wrong. A dedicated row exercises the
  // exact same trigger.
  const probeId = 'trg-probe-1213';
  let fired = false;
  let blockedRealEdit = null;
  try {
    // shift_code is NOT NULL with no default, as are shift_name/start_time/end_time.
    // The first version of this probe omitted shift_code and died on "Field
    // 'shift_code' doesn't have a default value" AFTER creating the trigger — so the
    // trigger shipped unverified. Supply every NOT NULL column that has no default.
    await root.query(
      `INSERT INTO wfm_shift_master (id, shift_code, shift_name, start_time, end_time, required_minutes, is_locked, active_status)
       VALUES (?, ?, 'TRIGGER PROBE — safe to delete', '09:00:00', '18:00:00', 540, 1, 0)`,
      [probeId, 'TRGPROBE1213'],
    );
    try {
      await root.query(`UPDATE wfm_shift_master SET start_time = '10:00:00' WHERE id = ?`, [probeId]);
    } catch (err) {
      fired = err.sqlState === '45000';
      blockedRealEdit = err.message.slice(0, 80);
    }
    // A non-protected column must still be editable on a locked row.
    await root.query(`UPDATE wfm_shift_master SET shift_name = 'TRIGGER PROBE — renamed' WHERE id = ?`, [probeId]);
  } finally {
    await root.query(`DELETE FROM wfm_shift_master WHERE id = ?`, [probeId]);
  }

  console.log(`  blocks start_time change on a locked row : ${fired ? 'YES' : 'NO'}`);
  if (fired) console.log(`    -> ${blockedRealEdit}`);
  console.log('  still allows shift_name change on locked : YES');

  const [[after]] = await root.query(
    `SELECT COUNT(*) n FROM information_schema.TRIGGERS
      WHERE TRIGGER_SCHEMA = DATABASE() AND TRIGGER_NAME = ?`, [TRIGGER]);
  console.log(`  trigger present after run                : ${after.n}`);
  console.log(`  probe row removed                        : YES`);

  if (!fired) {
    console.error('\nTrigger exists but did NOT block a protected edit. Investigate before trusting it.');
    await root.end();
    process.exit(1);
  }
  console.log('\nRollback: DROP TRIGGER IF EXISTS ' + TRIGGER + ';');
  await root.end();
}

main().catch((err) => { console.error(err.message); process.exit(1); });
