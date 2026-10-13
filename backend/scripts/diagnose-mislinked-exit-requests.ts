/**
 * Read-only: for the 5 currently-Active employees found with a permanently-empty employment
 * window (salary_start_date after a resolved exit_request LWD — scan-inverted-employment-
 * windows.ts, 2026-10-13), dump every exit_request row on their employee_id, the approval log,
 * and any audit_action_log entries on that request/employee, to find how/when/who attached an
 * exit_request whose LWD predates the employee's own salary_start_date.
 *
 * Run: npx tsx scripts/diagnose-mislinked-exit-requests.ts
 */
import 'dotenv/config';
import { createConnection } from 'mysql2/promise';
import type { RowDataPacket } from 'mysql2';

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}

const DB_CONFIG = {
  host: requiredEnv('DB_HOST'),
  port: Number(process.env.DB_PORT || 3306),
  user: requiredEnv('DB_USER'),
  password: requiredEnv('DB_PASSWORD'),
  database: requiredEnv('DB_NAME'),
};

const CODES = ['63467C', 'MAS63432', 'MAS63514', 'MAS63532', 'MAS63669'];

async function main() {
  const conn = await createConnection(DB_CONFIG);

  const ph = CODES.map(() => '?').join(',');
  const [emps] = await conn.execute<RowDataPacket[]>(
    `SELECT id, employee_code, employment_status, active_status,
            DATE_FORMAT(date_of_joining,'%Y-%m-%d') AS date_of_joining,
            DATE_FORMAT(salary_start_date,'%Y-%m-%d') AS salary_start_date,
            DATE_FORMAT(date_of_exit,'%Y-%m-%d') AS date_of_exit,
            created_at, updated_at
       FROM employees WHERE employee_code IN (${ph})`,
    CODES,
  );

  for (const emp of emps) {
    console.log('\n========', emp.employee_code, emp.id, '========');
    console.log('employee row:', JSON.stringify(emp));

    const [exits] = await conn.execute<RowDataPacket[]>(
      `SELECT id, initiated_by, initiated_by_user_id, exit_type, exit_sub_type,
              exit_reason_category,
              DATE_FORMAT(last_working_day_proposed,'%Y-%m-%d') AS lwd_proposed,
              DATE_FORMAT(last_working_day_confirmed,'%Y-%m-%d') AS lwd_confirmed,
              status, submitted_at, hr_actioned_at, admin_actioned_at, exit_confirmed_at,
              created_at, updated_at
         FROM exit_request WHERE employee_id = ? ORDER BY created_at`,
      [emp.id],
    );
    console.log(`exit_request rows: ${exits.length}`);
    for (const x of exits) console.log('  ', JSON.stringify(x));

    for (const x of exits) {
      const [logs] = await conn.execute<RowDataPacket[]>(
        `SELECT id, stage, action, action_by, action_by_role, discussion_remarks, internal_notes, created_at
           FROM exit_approval_log WHERE exit_request_id = ? ORDER BY created_at`,
        [x.id],
      ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
      if ((logs as RowDataPacket[]).length) {
        console.log(`  exit_approval_log for ${x.id}:`);
        for (const l of logs as RowDataPacket[]) console.log('    ', JSON.stringify(l));
      }

      const [audit] = await conn.execute<RowDataPacket[]>(
        `SELECT id, actor_user_id, action_type, module_key, entity_type, entity_id, metadata_json, created_at
           FROM audit_action_log WHERE entity_id = ? ORDER BY created_at`,
        [x.id],
      ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
      if ((audit as RowDataPacket[]).length) {
        console.log(`  audit_action_log for exit_request ${x.id}:`);
        for (const a of audit as RowDataPacket[]) console.log('    ', JSON.stringify(a));
      }
    }

    const [empAudit] = await conn.execute<RowDataPacket[]>(
      `SELECT id, actor_user_id, action_type, module_key, entity_type, entity_id, metadata_json, created_at
         FROM audit_action_log WHERE entity_id = ? AND entity_type IN ('employees','employee','exit_request')
         ORDER BY created_at`,
      [emp.id],
    ).catch(() => [[]] as unknown as [RowDataPacket[], unknown]);
    if ((empAudit as RowDataPacket[]).length) {
      console.log('  audit_action_log for employee row:');
      for (const a of empAudit as RowDataPacket[]) console.log('    ', JSON.stringify(a));
    }
  }

  await conn.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
