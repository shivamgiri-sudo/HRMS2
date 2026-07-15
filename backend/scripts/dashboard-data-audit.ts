import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const REQUIRED_TABLES = [
  "employees",
  "branch_master",
  "process_master",
  "attendance_daily_record",
  "wfm_attendance_session",
  "wfm_slot_requirement",
  "workforce_mandate",
  "ats_onboarding_bridge",
  "candidate_bgv_check",
  "candidate_name_match_summary",
  "dpdp_consent_withdrawal",
  "exit_request",
  "salary_prep_run",
  "salary_prep_line",
  "statutory_filing_tracker",
  "work_item",
] as const;

async function query(sql: string, params: unknown[] = []): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}

async function tableExists(table: string): Promise<boolean> {
  const rows = await query(
    `SELECT COUNT(*) AS count
       FROM information_schema.tables
      WHERE table_schema = DATABASE() AND table_name = ?`,
    [table],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function columnNames(table: string): Promise<string[]> {
  const rows = await query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = DATABASE() AND table_name = ?
      ORDER BY ordinal_position`,
    [table],
  );
  return rows.map((row) => String(row.column_name));
}

async function safeAggregate(name: string, sql: string): Promise<void> {
  try {
    const rows = await query(sql);
    console.log(`\n[${name}]`);
    console.table(rows);
  } catch (error) {
    console.error(`\n[${name}] FAILED`, error instanceof Error ? error.message : error);
  }
}

async function main(): Promise<void> {
  const databaseRows = await query("SELECT DATABASE() AS databaseName, VERSION() AS mysqlVersion, CURRENT_USER() AS currentUser");
  console.log("Dashboard MySQL audit — read only");
  console.table(databaseRows);

  const checks: Array<{ table: string; exists: boolean; columns: string }> = [];
  for (const table of REQUIRED_TABLES) {
    const exists = await tableExists(table);
    checks.push({ table, exists, columns: exists ? (await columnNames(table)).join(", ") : "" });
  }
  console.log("\nRequired table and column check");
  console.table(checks);

  await safeAggregate("Active employee population", `
    SELECT COUNT(*) AS activeEmployees,
           SUM(CASE WHEN COALESCE(TRIM(bank_account_number),'') = '' THEN 1 ELSE 0 END) AS missingBank,
           SUM(CASE WHEN COALESCE(TRIM(pan_number),'') = '' THEN 1 ELSE 0 END) AS missingPan,
           SUM(CASE WHEN COALESCE(TRIM(uan_number),'') = '' THEN 1 ELSE 0 END) AS missingUan
      FROM employees
     WHERE active_status = 1
       AND LOWER(COALESCE(employment_status,'active')) NOT IN ('inactive','terminated','resigned','exited','absconded')
  `);

  await safeAggregate("Today's finalized attendance", `
    SELECT attendance_status,
           COUNT(DISTINCT employee_id) AS employees,
           SUM(CASE WHEN late_mark = 1 THEN 1 ELSE 0 END) AS lateMarks
      FROM attendance_daily_record
     WHERE record_date = DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))
     GROUP BY attendance_status
     ORDER BY employees DESC
  `);

  await safeAggregate("Today's WFM requirement", `
    SELECT COALESCE(SUM(required_planned_hc),0) AS requiredPlannedHc
      FROM wfm_slot_requirement
     WHERE requirement_date = DATE(CONVERT_TZ(NOW(), '+00:00', '+05:30'))
  `);

  await safeAggregate("Onboarding pipeline", `
    SELECT bridge_status, COUNT(*) AS records
      FROM ats_onboarding_bridge
     GROUP BY bridge_status
     ORDER BY records DESC
  `);

  await safeAggregate("BGV pipeline", `
    SELECT COALESCE(bgv_status,'pending') AS bgvStatus, COUNT(*) AS records
      FROM candidate_bgv_check
     GROUP BY COALESCE(bgv_status,'pending')
     ORDER BY records DESC
  `);

  await safeAggregate("Payroll runs", `
    SELECT run_month, status, COUNT(*) AS runs
      FROM salary_prep_run
     GROUP BY run_month, status
     ORDER BY run_month DESC
     LIMIT 12
  `);

  await safeAggregate("Branch and process mapping completeness", `
    SELECT
      SUM(CASE WHEN branch_id IS NULL THEN 1 ELSE 0 END) AS missingBranch,
      SUM(CASE WHEN process_id IS NULL THEN 1 ELSE 0 END) AS missingProcess,
      SUM(CASE WHEN user_id IS NULL THEN 1 ELSE 0 END) AS missingAuthLink,
      COUNT(*) AS activeEmployees
    FROM employees
    WHERE active_status = 1
  `);

  console.log("\nAudit completed. No INSERT, UPDATE, DELETE, ALTER or DROP statement was executed.");
  process.exit(0);
}

main().catch((error) => {
  console.error("Dashboard data audit failed:", error instanceof Error ? error.message : error);
  process.exit(1);
});
