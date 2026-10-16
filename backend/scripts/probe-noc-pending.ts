/**
 * NOC cases still open for one branch, with the stages each is waiting on, plus the roles of one user. READ-ONLY.
 *
 *   npx tsx scripts/probe-noc-pending.ts NOIDA-2 sheelu.verma@teammas.in
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const BRANCH = String(process.argv[2] ?? "NOIDA-2").trim();
const EMAIL = String(process.argv[3] ?? "").trim();
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0] as RowDataPacket[];

(async () => {
  const [b] = await q(`SELECT id, branch_name FROM branch_master WHERE branch_name = ? LIMIT 1`, [BRANCH]);
  if (!b) { console.log("no such branch"); process.exit(1); }
  console.log(`branch ${b.branch_name} (${b.id})`);

  if (EMAIL) {
    console.log("== user roles ==");
    console.table(await q(
      `SELECT u.email, GROUP_CONCAT(DISTINCT r.role_key) AS roles FROM auth_user u
         LEFT JOIN user_roles r ON r.user_id = u.id AND r.active_status = 1 WHERE u.email = ? GROUP BY u.id`, [EMAIL]));
  }

  // Exactly what the Ops Control Tower NOC drawer counts for this branch: open cases that are not
  // absconders-without-exception, plus completed cases awaiting Payroll Head final approval.
  const all = await q(
    `SELECT c.id, c.employee_code, c.employee_name, c.status, DATE_FORMAT(c.last_working_day,'%Y-%m-%d') AS lwd,
            DATEDIFF(CURDATE(), COALESCE(c.initiated_at, c.employee_submitted_at)) AS days_open,
            DATE_FORMAT(c.payroll_head_approved_at,'%Y-%m-%d') AS ph_approved, c.legacy_source,
            e.employment_status, e.active_status, er.exit_type, er.exit_sub_type, er.status AS exit_status,
            DATE_FORMAT(er.ff_exception_at,'%Y-%m-%d') AS ff_exception_at, (c.exit_request_id IS NULL) AS no_exit_link
       FROM noc_case c
       LEFT JOIN employees e ON e.id = c.employee_id
       LEFT JOIN exit_request er ON er.id = c.exit_request_id
      WHERE c.branch_id = ?
        AND (c.status IN ('invited','employee_submitted','in_progress') OR (c.status = 'completed' AND c.payroll_head_approved_at IS NULL AND c.legacy_source IS NULL))
      ORDER BY c.initiated_at`, [b.id]);
  const open = all.filter((c) => ["invited", "employee_submitted", "in_progress"].includes(String(c.status)));
  console.log(`== NOC cases still counted at ${BRANCH}: ${all.length} (open ${open.length}, completed awaiting Payroll Head ${all.length - open.length}) ==`);
  const stages = open.length
    ? await q(`SELECT noc_case_id, stage_key, status, is_mandatory, role_key FROM noc_signatory WHERE noc_case_id IN (${open.map(() => "?").join(",")}) ORDER BY noc_case_id, display_no`, open.map((o) => o.id))
    : [];
  // db_bill (read-only SELECT): does the old system already show a NOC validation for these people?
  const billByCode = new Map<string, { vdate: string | null; vby: string | null }>();
  try {
    const mysql = (await import("mysql2/promise")).default;
    const bill = await mysql.createConnection({
      host: process.env.BILL_DB_HOST, port: Number(process.env.BILL_DB_PORT || 3306),
      user: process.env.BILL_DB_USER, password: process.env.BILL_DB_PASSWORD, database: process.env.BILL_DB_NAME, connectTimeout: 15000,
    });
    const codes = all.map((c) => String(c.employee_code));
    if (codes.length) {
      const [rows] = await bill.query(`SELECT EmpCode AS code, NocValidateDate AS vdate, NocValidateBy AS vby, TRIM(CAST(Status AS CHAR)) AS st FROM masjclrentry WHERE EmpCode IN (?)`, [codes]) as unknown as [Array<{ code: string; vdate: unknown; vby: string | null; st: string }>];
      for (const r of rows) billByCode.set(String(r.code).trim().toUpperCase(), { vdate: r.vdate ? String(r.vdate).slice(0, 10) : null, vby: r.vby });
    }
    await bill.end();
  } catch (e) { console.log("(db_bill not readable here:", (e as Error).message.slice(0, 80), ")"); }

  const ABS = ["absconding", "abandonment"];
  let absCounted = 0, billClosed = 0;
  for (const o of all) {
    const mine = stages.filter((s) => s.noc_case_id === o.id);
    const waiting = mine.filter((s) => s.status === "pending").map((s) => `${s.stage_key}${Number(s.is_mandatory) ? "*" : ""}[${s.role_key}]`).join(", ");
    const blob = [o.exit_type, o.exit_sub_type, o.employment_status, o.exit_status].map((v) => String(v ?? "")).join("/");
    const looksAbsconder = /abscond|abandon/i.test(blob);
    const bill = billByCode.get(String(o.employee_code).toUpperCase());
    const billOk = !!bill?.vdate && Number(bill.vdate.slice(0, 4)) >= 2000;
    if (looksAbsconder) absCounted++;
    if (billOk) billClosed++;
    console.log(`${o.employee_code} ${o.employee_name} | case ${o.status} | emp ${o.employment_status}/${Number(o.active_status) ? "active" : "inactive"} | exit ${o.exit_type ?? "-"}/${o.exit_sub_type ?? "-"}/${o.exit_status ?? "-"}${Number(o.no_exit_link) ? " (NO exit link)" : ""} | ff_exception ${o.ff_exception_at ?? "none"} | LWD ${o.lwd ?? "-"} | open ${o.days_open}d | waiting: ${waiting || "-"} | db_bill NOC ${billOk ? `CLOSED ${bill!.vdate} by ${bill!.vby}` : bill ? "not validated" : "no row"}${looksAbsconder ? " | LOOKS ABSCONDER" : ""}`);
  }
  console.log(`SUMMARY ${BRANCH}: counted=${all.length}, look-like-absconders-still-counted=${absCounted}, closed-in-db_bill-but-counted=${billClosed}`);
  const closed7 = await q(
    `SELECT COUNT(*) n FROM noc_case WHERE branch_id = ? AND status = 'completed' AND completed_at >= NOW() - INTERVAL 7 DAY`, [b.id]);
  console.log(`completed in the last 7 days at ${BRANCH}: ${closed7[0].n}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
