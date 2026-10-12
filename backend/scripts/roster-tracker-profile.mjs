/**
 * Roster Upload Tracker - read-only timing + EXPLAIN of each query the grid runs.
 *   node scripts/roster-tracker-profile.mjs
 * READ ONLY session. Mirrors the queries in roster-upload-tracker.service.ts (6-week window).
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const conn = await mysql.createConnection({
  host: process.env.DB_HOST_OVERRIDE || strip(process.env.DB_HOST),
  port: Number(strip(process.env.DB_PORT) || 3306),
  user: strip(process.env.DB_USER), password: strip(process.env.DB_PASSWORD), database: strip(process.env.DB_NAME),
  connectTimeout: 20000, dateStrings: true,
});
const from = "2026-09-21", to = "2026-11-01";
const Q = {
  pairs: [`SELECT e.branch_id, br.branch_name, e.process_id, p.process_name, COUNT(*) AS expected
       FROM employees e JOIN branch_master br ON br.id = e.branch_id JOIN process_master p ON p.id = e.process_id
      WHERE e.employment_status = 'active' AND e.branch_id IS NOT NULL AND e.process_id IS NOT NULL AND p.active_status = 1
        AND LOWER(TRIM(br.branch_name)) NOT IN ('head office')
      GROUP BY e.branch_id, br.branch_name, e.process_id, p.process_name`, []],
  importCoverage: [`SELECT e.branch_id, e.process_id, c.week_start, COUNT(*) AS covered, MIN(c.first_commit) AS a, MAX(c.first_commit) AS z
       FROM (SELECT r.employee_id_raw AS employee_code,
                DATE_FORMAT(DATE_SUB(r.roster_date, INTERVAL WEEKDAY(r.roster_date) DAY), '%Y-%m-%d') AS week_start,
                MIN(UNIX_TIMESTAMP(b.committed_at)) AS first_commit
           FROM wfm_roster_import_batch b JOIN wfm_roster_import_row r ON r.batch_id = b.id
          WHERE b.status = 'COMMITTED' AND b.committed_at IS NOT NULL AND b.date_range_end >= ? AND b.date_range_start <= ?
            AND r.employee_id_raw IS NOT NULL AND r.roster_date BETWEEN ? AND ?
          GROUP BY r.employee_id_raw, week_start) c
       JOIN employees e ON e.employee_code COLLATE utf8mb4_unicode_ci = c.employee_code COLLATE utf8mb4_unicode_ci AND e.employment_status = 'active'
      GROUP BY e.branch_id, e.process_id, c.week_start`, [from, to, from, to]],
  teamCoverage: [`SELECT e.employee_code, e.branch_id, e.process_id,
              DATE_FORMAT(DATE_SUB(tl.roster_date, INTERVAL WEEKDAY(tl.roster_date) DAY), '%Y-%m-%d') AS week_start, MIN(UNIX_TIMESTAMP(ts.applied_at)) AS applied_at
         FROM roster_team_submission ts JOIN roster_team_submission_line tl ON tl.submission_id = ts.id AND tl.line_status = 'applied'
         JOIN employees e ON e.id = tl.employee_id AND e.employment_status = 'active'
        WHERE ts.status IN ('applied', 'partially_applied') AND ts.applied_at IS NOT NULL AND tl.roster_date BETWEEN ? AND ?
        GROUP BY e.id, e.employee_code, e.branch_id, e.process_id, week_start`, [from, to]],
  roleHoldersBranch: [`SELECT DISTINCT uas.branch_id AS scope_id, u.id AS user_id, u.email, e.id AS employee_id, e.full_name
         FROM user_assignment_scope uas JOIN auth_user u ON u.id = uas.user_id AND u.is_blocked = 0 LEFT JOIN employees e ON e.user_id = u.id
        WHERE uas.active_status = 1 AND uas.role_key IN ('wfm','branch_wfm')`, []],
  roleHoldersProcess: [`SELECT DISTINCT uas.process_id AS scope_id, u.id AS user_id, u.email, e.id AS employee_id, e.full_name
         FROM user_assignment_scope uas JOIN auth_user u ON u.id = uas.user_id AND u.is_blocked = 0 LEFT JOIN employees e ON e.user_id = u.id
        WHERE uas.active_status = 1 AND uas.role_key IN ('process_manager')`, []],
  modalManagers: [`SELECT x.branch_id, x.process_id, x.mid, m.user_id, m.full_name, x.c
       FROM (SELECT e.branch_id, e.process_id, COALESCE(e.reporting_manager_id, e.manager_id) AS mid, COUNT(*) AS c
           FROM employees e WHERE e.employment_status = 'active' AND COALESCE(e.reporting_manager_id, e.manager_id) IS NOT NULL
          GROUP BY e.branch_id, e.process_id, mid) x JOIN employees m ON m.id = x.mid ORDER BY x.branch_id, x.process_id, x.c DESC`, []],
};
try {
  await conn.query("SET SESSION TRANSACTION READ ONLY");
  console.log("now", (await conn.query("SELECT NOW() n"))[0][0].n);
  for (const t of ["wfm_roster_import_row", "wfm_roster_import_batch", "employees", "roster_team_submission_line"]) {
    const [r] = await conn.query("SELECT TABLE_ROWS, ROUND(DATA_LENGTH/1048576) data_mb FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?", [t]);
    console.log("table", t, JSON.stringify(r[0]));
  }
  const [idx] = await conn.query("SELECT INDEX_NAME, GROUP_CONCAT(COLUMN_NAME ORDER BY SEQ_IN_INDEX) cols FROM information_schema.STATISTICS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_import_row' GROUP BY INDEX_NAME");
  console.log("import_row indexes", JSON.stringify(idx));
  for (const [name, [sql, params]] of Object.entries(Q)) {
    const t = Date.now();
    try {
      const [rows] = await conn.query(sql, params);
      console.log(`\n## ${name}: ${rows.length} rows in ${Date.now() - t} ms`);
    } catch (e) { console.log(`\n## ${name}: ERROR ${e.message}`); }
    try {
      const [plan] = await conn.query("EXPLAIN " + sql, params);
      for (const p of plan) console.log("  plan", JSON.stringify({ t: p.table, type: p.type, key: p.key, rows: p.rows, extra: p.Extra }));
    } catch (e) { console.log("  explain ERROR", e.message); }
  }
} finally { await conn.end(); }
