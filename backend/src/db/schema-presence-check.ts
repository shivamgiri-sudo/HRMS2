import type { RowDataPacket } from "mysql2";

/**
 * Compares tables the application needs against what the database actually has.
 *
 * Exists because production runs with SKIP_MIGRATIONS=true, so a deploy applies no schema at
 * all — a migration only takes effect if a human runs it by hand. Code therefore ships
 * referencing tables nobody created. employee_geofence_alerts logged 167 errors that way
 * before anyone noticed its migration had simply never been run, and the code handled the
 * absence gracefully enough ("insert skipped") that the feature recorded nothing in silence.
 *
 * Reports; never throws. A table missing for one optional feature must not stop the server
 * booting — the point is to name the gap once at startup rather than let it leak out as a
 * slow drip of runtime errors nobody reads.
 */
export async function checkRequiredTables(
  db: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
  required: string[],
): Promise<{ missing: string[] }> {
  if (required.length === 0) return { missing: [] };

  const result = (await db.query(
    `SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE()`,
  )) as [RowDataPacket[], unknown];

  const present = new Set(
    (result[0] ?? []).map((r) => String((r as { TABLE_NAME: string }).TABLE_NAME).toLowerCase()),
  );

  const missing = required
    .map((t) => t.toLowerCase())
    .filter((t) => !present.has(t))
    .sort();

  return { missing };
}

/**
 * Tables whose absence has already broken something, plus those a core flow cannot work
 * without.
 *
 * Deliberately a short curated list rather than every table name the code mentions. A
 * generated list is mostly false positives — CTE names, aliases and column names all look
 * like tables to a regex — and a check that cries wolf is a check nobody reads. Add a table
 * here when its absence has cost someone time.
 */
export const REQUIRED_TABLES: string[] = [
  "employees",
  "branch_master",
  "leave_request",
  "attendance_daily_record",
  "salary_prep_run",
  "notification_event_config",
  "notification_dispatch_claim",
  "communication_template",
  "employee_geofence_alerts",
  "tat_matrix_master",
  "escalation_matrix_master",
  "finance_grn_sequence",
  "grn_request",
  "lms_employee_mapping",
];
