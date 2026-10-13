/**
 * September attendance correction upload — read-only production diagnosis.
 *   LEAVE_ROWS="CODE:from:to:LEAVECODE:days;..." REG_ROWS="CODE:date:status;..." node scripts/sep-correction-diagnose.mjs
 * READ ONLY session. For every leave row of the uploaded file: the leave requests that already cover
 * that date (type, days, status) and the employee's CL/ML usage that month; for every regularization
 * row: existing regularization requests and the attendance record that day. Also prints the recent
 * leave / regularization upload batches and the payroll-run freeze state for the month.
 */
import { createRequire } from "node:module";

await import("dotenv/config");
const require = createRequire(import.meta.url);
const mysql = require("mysql2/promise");
const strip = (v) => String(v ?? "").trim().replace(/^["']|["']$/g, "");
const MONTH = process.env.MONTH || "2026-09";
const parse = (s) => String(s ?? "").split(";").map((x) => x.trim()).filter(Boolean).map((x) => x.split(":"));
const leaveRows = parse(process.env.LEAVE_ROWS);
const regRows = parse(process.env.REG_ROWS);

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
  console.log(`month=${MONTH} leaveRows=${leaveRows.length} regRows=${regRows.length}`);

  await show(
    `payroll runs for ${MONTH} (freeze state)`,
    `SELECT id, run_kind, status, attendance_snapshot_locked, branch_id, branch_filter, process_filter, scope_kind, created_at
       FROM salary_prep_run WHERE run_month = ? ORDER BY created_at`,
    [MONTH],
  );
  await show(
    `locked attendance rows in ${MONTH}`,
    `SELECT COUNT(*) locked_rows, COUNT(DISTINCT employee_id) employees FROM attendance_daily_record
      WHERE record_date >= CONCAT(?, '-01') AND record_date < CONCAT(?, '-01') + INTERVAL 1 MONTH AND is_locked = 1`,
    [MONTH, MONTH],
  );
  await show(
    "leave / regularization upload batches (last 5 days)",
    `SELECT b.upload_batch_no, b.upload_type_code, b.original_file_name, b.total_rows, b.valid_rows, b.error_rows,
            b.imported_rows, b.batch_status, b.approval_status, b.branch_id, b.uploaded_by, b.created_at, b.error_summary
       FROM upload_batch b
      WHERE b.created_at >= NOW() - INTERVAL 5 DAY
        AND (b.upload_type_code LIKE '%LEAVE%' OR b.upload_type_code LIKE '%REGULAR%')
      ORDER BY b.created_at DESC LIMIT 30`,
  );
  await show(
    "row status per recent leave / regularization batch",
    `SELECT b.upload_batch_no, b.upload_type_code, r.row_status, COUNT(*) n
       FROM upload_batch b JOIN upload_batch_row r ON r.upload_batch_id = b.id
      WHERE b.created_at >= NOW() - INTERVAL 5 DAY
        AND (b.upload_type_code LIKE '%LEAVE%' OR b.upload_type_code LIKE '%REGULAR%')
      GROUP BY b.upload_batch_no, b.upload_type_code, r.row_status ORDER BY b.upload_batch_no DESC`,
  );
  await show(
    "regularization batch row errors (last 5 days), grouped",
    `SELECT LEFT(r.error_messages, 220) err, COUNT(*) n
       FROM upload_batch b JOIN upload_batch_row r ON r.upload_batch_id = b.id
      WHERE b.created_at >= NOW() - INTERVAL 5 DAY AND b.upload_type_code LIKE '%REGULAR%' AND r.row_status <> 'imported'
      GROUP BY err ORDER BY n DESC LIMIT 30`,
  );

  const codes = [...new Set([...leaveRows, ...regRows].map((r) => r[0]))];
  const emps = codes.length
    ? await rowsOf(
        `SELECT e.id, e.employee_code, e.employment_status, br.branch_name FROM employees e
           LEFT JOIN branch_master br ON br.id = e.branch_id WHERE e.employee_code IN (?)`,
        [codes],
      )
    : [];
  const byCode = new Map(emps.map((e) => [String(e.employee_code), e]));
  console.log(`\n## employees: ${emps.length}/${codes.length} codes found; branches ${JSON.stringify([...new Set(emps.map((e) => e.branch_name))])}`);
  console.log(`missing codes: ${JSON.stringify(codes.filter((c) => !byCode.has(c)))}`);

  console.log("\n## LEAVE rows: file row -> existing requests covering the date | CL/ML used in month");
  const verdicts = {};
  for (const [i, [code, from, to, lc, days]] of leaveRows.entries()) {
    const e = byCode.get(code);
    if (!e) { console.log(`L${i + 1} ${code} ${from} ${lc} ${days}: NO EMPLOYEE`); continue; }
    const existing = await rowsOf(
      `SELECT lt.leave_code, lr.from_date, lr.to_date, lr.total_days, lr.status, lr.created_at
         FROM leave_request lr LEFT JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lr.employee_id = ? AND lr.from_date <= ? AND lr.to_date >= ? ORDER BY lr.created_at`,
      [e.id, to, from],
    );
    const used = await rowsOf(
      `SELECT COALESCE(SUM(lr.total_days), 0) used FROM leave_request lr JOIN leave_type_master lt ON lt.id = lr.leave_type_id
        WHERE lr.employee_id = ? AND lt.leave_code IN ('CL','ML') AND lr.status IN ('approved','pending','pending_branch_head')
          AND lr.from_date >= CONCAT(?, '-01') AND lr.from_date < CONCAT(?, '-01') + INTERVAL 1 MONTH`,
      [e.id, from.slice(0, 7), from.slice(0, 7)],
    );
    const att = await rowsOf(
      `SELECT attendance_status, is_locked FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?`,
      [e.id, from],
    );
    const live = existing.filter((x) => ["approved", "pending", "pending_branch_head"].includes(x.status));
    const same = live.find((x) => x.leave_code === lc && Number(x.total_days) === Number(days) && x.from_date === from && x.to_date === to);
    const verdict = same ? `SAME_${same.status}` : live.length ? "DIFFERENT_LIVE" : existing.length ? "ONLY_DEAD" : "NONE";
    verdicts[verdict] = (verdicts[verdict] ?? 0) + 1;
    console.log(
      `L${i + 1} ${code} ${from}${to !== from ? ".." + to : ""} ${lc} ${days} [${verdict}] used=${used[0].used} ` +
        `att=${att.map((a) => a.attendance_status + (a.is_locked ? "/L" : "")).join(",") || "-"} ` +
        `existing=${existing.map((x) => `${x.leave_code}:${x.from_date}..${x.to_date}:${x.total_days}:${x.status}:${String(x.created_at).slice(0, 16)}`).join(" | ")}`,
    );
  }
  console.log(`\n## leave verdicts ${JSON.stringify(verdicts)}`);

  console.log("\n## REG rows: file row -> existing regularization requests | attendance that day");
  const rv = {};
  for (const [i, [code, date, status]] of regRows.entries()) {
    const e = byCode.get(code);
    if (!e) { console.log(`R${i + 1} ${code} ${date}: NO EMPLOYEE`); continue; }
    const regs = await rowsOf(
      `SELECT requested_status, status, created_at FROM attendance_regularization
        WHERE employee_id = ? AND session_date = ? ORDER BY created_at`,
      [e.id, date],
    );
    const att = await rowsOf(
      `SELECT attendance_status, is_locked FROM attendance_daily_record WHERE employee_id = ? AND record_date = ?`,
      [e.id, date],
    );
    const want = status.toLowerCase().replace(/\s|_/g, "");
    const cur = String(att[0]?.attendance_status ?? "").replace(/_/g, "");
    const verdict = cur === want ? "ALREADY_MATCHES" : regs.length ? `REQ_${regs[regs.length - 1].status}` : "NO_REQUEST";
    rv[verdict] = (rv[verdict] ?? 0) + 1;
    console.log(
      `R${i + 1} ${code} ${date} want=${status} [${verdict}] att=${att.map((a) => a.attendance_status + (a.is_locked ? "/L" : "")).join(",") || "-"} ` +
        `regs=${regs.map((r) => `${r.requested_status}:${r.status}:${String(r.created_at).slice(0, 16)}`).join(" | ")}`,
    );
  }
  console.log(`\n## reg verdicts ${JSON.stringify(rv)}`);
} finally {
  await conn.end();
}
