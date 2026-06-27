import { describe, it, expect, beforeAll } from 'vitest';
import { db } from '../src/db/mysql.js';
import type { RowDataPacket } from 'mysql2';

describe('Biometric Sync Investigation', () => {
  beforeAll(async () => {
    console.log('\n=== BIOMETRIC SYNC INVESTIGATION ===\n');
  }, 30000);

  it('checks integration_config for cosec_biometric', async () => {
    const [configs] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_key, integration_name, integration_type, active_status,
              config_json, created_at, updated_at
       FROM integration_config
       WHERE integration_key = 'cosec_biometric'`
    );

    console.log('\n1. Integration Config:');
    console.log(JSON.stringify(configs, null, 2));

    if (configs.length === 0) {
      console.log('❌ cosec_biometric integration NOT REGISTERED');
    } else {
      console.log(`✓ cosec_biometric integration found, active_status=${configs[0].active_status}`);
    }

    expect(configs.length).toBeGreaterThan(0);
  });

  it('checks integration_schedule for cosec_biometric', async () => {
    const [schedules] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_key, cron_expression, enabled,
              next_run_at, last_run_at, created_at, updated_at
       FROM integration_schedule
       WHERE integration_key = 'cosec_biometric'`
    );

    console.log('\n2. Integration Schedule:');
    console.log(JSON.stringify(schedules, null, 2));

    if (schedules.length === 0) {
      console.log('❌ cosec_biometric schedule NOT FOUND');
    } else {
      const sched = schedules[0];
      console.log(`✓ Schedule found:`);
      console.log(`  - enabled: ${sched.enabled}`);
      console.log(`  - cron: ${sched.cron_expression}`);
      console.log(`  - next_run_at: ${sched.next_run_at}`);
      console.log(`  - last_run_at: ${sched.last_run_at || 'NEVER RUN'}`);
    }
  });

  it('checks integration_connector_run for recent cosec sync runs', async () => {
    const [runs] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_key, status, started_at, completed_at,
              records_in, records_out, records_error, error_summary
       FROM integration_connector_run
       WHERE integration_key = 'cosec_biometric'
       ORDER BY started_at DESC
       LIMIT 10`
    );

    console.log('\n3. Recent Sync Runs (last 10):');
    if (runs.length === 0) {
      console.log('❌ NO SYNC RUNS FOUND - scheduler may not be executing');
    } else {
      runs.forEach((run, i) => {
        console.log(`\nRun ${i + 1}:`);
        console.log(`  - status: ${run.status}`);
        console.log(`  - started_at: ${run.started_at}`);
        console.log(`  - completed_at: ${run.completed_at}`);
        console.log(`  - records_in: ${run.records_in}`);
        console.log(`  - records_out: ${run.records_out}`);
        console.log(`  - records_error: ${run.records_error}`);
        if (run.error_summary) {
          console.log(`  - error: ${run.error_summary}`);
        }
      });
    }
  }, 15000);

  it('checks biometric_attendance_log table for data', async () => {
    // First check if table exists
    const [tables] = await db.execute<RowDataPacket[]>(
      "SHOW TABLES LIKE 'biometric_attendance_log'"
    );

    if (tables.length === 0) {
      console.log('\n4. Biometric Attendance Log:');
      console.log('❌ biometric_attendance_log table DOES NOT EXIST');
      return;
    }

    const [count] = await db.execute<RowDataPacket[]>(
      'SELECT COUNT(*) as total FROM biometric_attendance_log'
    );

    console.log('\n4. Biometric Attendance Log:');
    console.log(`Total records: ${count[0].total}`);

    if (count[0].total === 0) {
      console.log('❌ biometric_attendance_log is EMPTY - no data synced yet');
    } else {
      const [recent] = await db.execute<RowDataPacket[]>(
        `SELECT employee_id, punch_date, first_punch_in, last_punch_out,
                total_punches, migrated_at
         FROM biometric_attendance_log
         ORDER BY migrated_at DESC
         LIMIT 5`
      );
      console.log('\nMost recent 5 records:');
      console.log(JSON.stringify(recent, null, 2));
    }
  }, 20000);

  it('checks integration_event_log for errors', async () => {
    const [events] = await db.execute<RowDataPacket[]>(
      `SELECT id, integration_key, event_type, description, metadata, created_at
       FROM integration_event_log
       WHERE integration_key = 'cosec_biometric'
       ORDER BY created_at DESC
       LIMIT 10`
    );

    console.log('\n5. Recent Integration Events (last 10):');
    if (events.length === 0) {
      console.log('No events logged');
    } else {
      events.forEach((evt, i) => {
        console.log(`\nEvent ${i + 1}:`);
        console.log(`  - type: ${evt.event_type}`);
        console.log(`  - description: ${evt.description}`);
        console.log(`  - created_at: ${evt.created_at}`);
        if (evt.metadata) {
          console.log(`  - metadata: ${evt.metadata}`);
        }
      });
    }
  }, 15000);

  it('summarizes findings', () => {
    console.log('\n=== DIAGNOSIS ===');
    console.log('Check the output above to identify the issue:');
    console.log('1. If integration_config is missing → bootstrapCosecIntegration() never ran');
    console.log('2. If integration_schedule is disabled → schedule needs to be enabled');
    console.log('3. If last_run_at is NULL → scheduler is not triggering');
    console.log('4. If run_log shows errors → check error_message for root cause');
    console.log('5. If run_log is empty → integration-scheduler.worker is not polling');
    console.log('6. If biometric_attendance_log is empty → sync ran but found no data');
    console.log('\n');
  });
});
