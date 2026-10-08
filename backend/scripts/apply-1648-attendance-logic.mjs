/**
 * Applies migration 1648 (apr_eligibility_config.attendance_logic) directly.
 *
 * The .sql file wraps its DDL in DELIMITER-quoted stored procedures so the migration runner
 * can execute it as one statement batch. The mysql2 driver does not understand DELIMITER,
 * so this applier performs the same two guarded changes as plain statements — identical
 * result, idempotent, and safe to run more than once.
 */
import 'dotenv/config';
import mysql from 'mysql2/promise';

const db = await mysql.createConnection({
  host: process.env.DB_HOST, port: Number(process.env.DB_PORT || 3306),
  user: process.env.DB_USER, password: process.env.DB_PASSWORD, database: process.env.DB_NAME,
});
const q = async (s, p = []) => (await db.query(s, p))[0];

const [{ n: hasCol }] = await q(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr_eligibility_config'
      AND COLUMN_NAME = 'attendance_logic'`);
if (hasCol) {
  console.log('column attendance_logic already present - skipped');
} else {
  await q(
    `ALTER TABLE apr_eligibility_config
       ADD COLUMN attendance_logic ENUM('apr','cosec','apr_validated_by_cosec')
         NOT NULL DEFAULT 'apr'
         COMMENT 'How this scope''s attendance is decided. apr = dialler net login alone. cosec = biometric alone (row excluded from APR matching). apr_validated_by_cosec = APR first, biometric compared when APR falls short of a full day.'`);
  console.log('column attendance_logic added');
}

const [{ n: hasIdx }] = await q(
  `SELECT COUNT(*) n FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'apr_eligibility_config'
      AND INDEX_NAME = 'idx_apr_elig_active_logic'`);
if (hasIdx) {
  console.log('index idx_apr_elig_active_logic already present - skipped');
} else {
  await q(`ALTER TABLE apr_eligibility_config
             ADD INDEX idx_apr_elig_active_logic (active_status, attendance_logic)`);
  console.log('index idx_apr_elig_active_logic added');
}

console.log('\nRow distribution after migration (every existing row must read "apr"):');
console.table(await q(
  `SELECT attendance_logic, active_status, COUNT(*) n
     FROM apr_eligibility_config GROUP BY attendance_logic, active_status`));

// Record the file as applied so the runner does not try the DELIMITER version later.
try {
  await q(
    `INSERT IGNORE INTO schema_migrations (filename, applied_at)
     VALUES ('1648_apr_eligibility_attendance_logic.sql', NOW())`);
  console.log('recorded in schema_migrations');
} catch (err) {
  console.log('could not record in schema_migrations:', err.code ?? err.message);
}
await db.end();
