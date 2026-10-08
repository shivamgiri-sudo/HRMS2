import { db } from './src/lib/db.js';
import { RowDataPacket } from 'mysql2';

async function main() {
  try {
    // Check if integration_config has cosec integration
    const [configs] = await db.execute<RowDataPacket[]>(
      `SELECT id, name, enabled, schedule_type, schedule_cron, schedule_interval_ms
       FROM integration_config
       WHERE name LIKE "%cosec%" OR name LIKE "%biometric%"`
    );
    console.log('Integration configs:', JSON.stringify(configs, null, 2));

    // Check recent sync runs
    const [runs] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_id, status, started_at, completed_at, records_processed, error_message
       FROM integration_run_log
       ORDER BY started_at DESC
       LIMIT 10`
    );
    console.log('\nRecent runs:', JSON.stringify(runs, null, 2));

    // Check biometric data count
    const [count] = await db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM biometric_attendance_log'
    );
    console.log('\nBiometric records:', count[0]);

    // Check recent biometric records
    const [recent] = await db.execute<RowDataPacket[]>(
      `SELECT employee_id, punch_date, first_punch_in, last_punch_out, migrated_at
       FROM biometric_attendance_log
       ORDER BY migrated_at DESC
       LIMIT 5`
    );
    console.log('\nRecent biometric records:', JSON.stringify(recent, null, 2));

    // Check integration schedule
    const [schedules] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_id, enabled, cron_expression, next_run_at, last_run_at
       FROM integration_schedule
       WHERE integration_id IN (SELECT id FROM integration_config WHERE name LIKE "%cosec%" OR name LIKE "%biometric%")`
    );
    console.log('\nIntegration schedules:', JSON.stringify(schedules, null, 2));

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

main();
