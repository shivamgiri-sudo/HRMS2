/**
 * Roster Upload Tracker — read-only production diagnosis of one branch x process cell.
 *   node scripts/roster-upload-diagnose.mjs "<branch> <process> <uploader>"
 *   e.g. "NOIDA-2 GS1 bhavesh"   (all three optional; defaults shown)
 * READ ONLY session. Shows the recent roster-import batches for the cell / uploader, what week their
 * rows fall in, how many row codes match active employees and in which branch/process, and the
 * tracker's own coverage numbers (same rule as roster-upload-tracker.service.ts).
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const [BRANCH = "NOIDA-2", PROCESS = "GS1", UPLOADER = "bhavesh"] = process.argv.slice(2).join(" ").split(/\s+/).filter(Boolean);
const like = (s) => `%${s}%`;

const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER),
  password: strip(process.env.DB_PASSWORD),
  database: strip(process.env.DB_NAME),
  connectTimeout: 20000,
  dateStrings: true,
});
const rowsOf = async (sql, params = []) => (await conn.query(sql, params))[0];
const show = async (title, sql, params = []) => {
  try {
    const rows = await rowsOf(sql, params);
    console.log(`\n## ${title}`);
    for (const r of rows) console.log(JSON.stringify(r));
    if (!rows.length) console.log("(none)");
    return rows;
  } catch (e) {
    console.log(`\n## ${title}\nERROR ${e.code ?? ""} ${e.message}`);
    return [];
  }
};

try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  console.log(`args: branch~${BRANCH} process~${PROCESS} uploader~${UPLOADER}`);
  await show("now (db) + IST deadline for week of Mon 2026-10-12 is 2026-10-11 18:00", "SELECT NOW() now_db");

  const branches = await show("branches", "SELECT id, branch_name FROM branch_master WHERE branch_name LIKE ?", [like(BRANCH)]);
  const processes = await show("processes", "SELECT id, process_name, active_status FROM process_master WHERE process_name LIKE ?", [like(PROCESS)]);
  const uploaders = await show(
    "uploader users",
    `SELECT u.id, u.email, u.is_blocked, e.full_name, e.employee_code, e.branch_id, e.process_id
       FROM auth_user u LEFT JOIN employees e ON e.user_id = u.id
      WHERE u.email LIKE ? OR e.full_name LIKE ?`,
    [like(UPLOADER), like(UPLOADER)],
  );

  const pIds = processes.map((p) => p.id);
  const bIds = branches.map((b) => b.id);
  const uIds = uploaders.map((u) => u.id);

  await show(
    "expected headcount per branch x process (active employees)",
    `SELECT br.branch_name, p.process_name, e.branch_id, e.process_id, COUNT(*) expected
       FROM employees e JOIN branch_master br ON br.id = e.branch_id JOIN process_master p ON p.id = e.process_id
      WHERE e.employment_status = 'active' AND e.branch_id IN (?) AND e.process_id IN (?)
      GROUP BY e.branch_id, e.process_id, br.branch_name, p.process_name`,
    [bIds.length ? bIds : [""], pIds.length ? pIds : [""]],
  );

  const batches = await show(
    "recent batches (last 7 days) for the process OR the uploader",
    `SELECT b.id, b.status, b.file_name, b.process_id, b.import_mode, b.total_rows, b.valid_rows, b.warning_rows,
            b.error_rows, b.needs_mapping_rows, b.date_range_start, b.date_range_end, b.created_by, b.created_at,
            b.committed_by, b.committed_at
       FROM wfm_roster_import_batch b
      WHERE b.created_at >= NOW() - INTERVAL 7 DAY AND (b.process_id IN (?) OR b.created_by IN (?))
      ORDER BY b.created_at DESC LIMIT 15`,
    [pIds.length ? pIds : [""], uIds.length ? uIds : [""]],
  );
  const ids = batches.map((b) => b.id);
  if (!ids.length) throw new Error("no batches found");

  await show(
    "per batch: row count, distinct codes, roster_date span, validation + type mix",
    `SELECT batch_id, COUNT(*) n_rows, COUNT(DISTINCT employee_id_raw) codes, SUM(employee_id_raw IS NULL) null_codes,
            MIN(roster_date) first_date, MAX(roster_date) last_date,
            SUM(validation_state='VALID') valid, SUM(validation_state='WARNING') warn, SUM(validation_state='ERROR') err,
            SUM(normalized_type IN ('HARD_ERROR','NEEDS_MAPPING')) bad_type
       FROM wfm_roster_import_row WHERE batch_id IN (?) GROUP BY batch_id ORDER BY batch_id DESC`,
    [ids],
  );
  await show(
    "per batch x week (Mon): rows + distinct codes",
    `SELECT batch_id, DATE_FORMAT(DATE_SUB(roster_date, INTERVAL WEEKDAY(roster_date) DAY), '%Y-%m-%d') week_start,
            COUNT(*) n_rows, COUNT(DISTINCT employee_id_raw) codes
       FROM wfm_roster_import_row WHERE batch_id IN (?) GROUP BY batch_id, week_start ORDER BY batch_id DESC, week_start`,
    [ids],
  );
  await show(
    "where do the batch's codes land? (employees matched by code; status + branch/process)",
    `SELECT r.batch_id, e.employment_status, br.branch_name, p.process_name, COUNT(DISTINCT r.employee_id_raw) codes
       FROM wfm_roster_import_row r
       LEFT JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = r.employee_id_raw COLLATE utf8mb4_unicode_ci
       LEFT JOIN branch_master br ON br.id = e.branch_id
       LEFT JOIN process_master p ON p.id = e.process_id
      WHERE r.batch_id IN (?) AND r.employee_id_raw IS NOT NULL
      GROUP BY r.batch_id, e.employment_status, br.branch_name, p.process_name
      ORDER BY r.batch_id DESC, codes DESC LIMIT 60`,
    [ids],
  );
  await show(
    "sample codes in the newest batch that match no employee",
    `SELECT DISTINCT r.employee_id_raw, r.employee_name_raw
       FROM wfm_roster_import_row r
       LEFT JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = r.employee_id_raw COLLATE utf8mb4_unicode_ci
      WHERE r.batch_id = ? AND e.id IS NULL LIMIT 15`,
    [ids[0]],
  );
  await show(
    "tracker coverage for the cell: COMMITTED batches only, by week (same rule as the service)",
    `SELECT e.branch_id, e.process_id, c.week_start, COUNT(*) covered, MAX(c.first_commit) full_commit_unix
       FROM (
         SELECT r.employee_id_raw code,
                DATE_FORMAT(DATE_SUB(r.roster_date, INTERVAL WEEKDAY(r.roster_date) DAY), '%Y-%m-%d') week_start,
                MIN(UNIX_TIMESTAMP(b.committed_at)) first_commit
           FROM wfm_roster_import_batch b JOIN wfm_roster_import_row r ON r.batch_id = b.id
          WHERE b.status = 'COMMITTED' AND b.committed_at IS NOT NULL AND r.employee_id_raw IS NOT NULL
            AND r.roster_date >= CURDATE() - INTERVAL 14 DAY
          GROUP BY r.employee_id_raw, week_start) c
       JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = c.code COLLATE utf8mb4_unicode_ci AND e.employment_status = 'active'
      WHERE e.process_id IN (?) AND e.branch_id IN (?)
      GROUP BY e.branch_id, e.process_id, c.week_start ORDER BY c.week_start`,
    [pIds.length ? pIds : [""], bIds.length ? bIds : [""]],
  );
} finally {
  await conn.end();
}
