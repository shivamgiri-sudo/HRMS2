/**
 * READ-ONLY diagnosis for the 2026-10-15 WFM email "Action required APR Failures and other
 * concern" (Dinesh Singh Mehta, NOIDA-2). Counts and short per-employee-code lines only.
 *
 *   A. 26 analysts: APR present, COSEC punching not shown      -> where the punch chain breaks
 *   B. CC attendance "Access denied"                            -> roles + scope rows of the caller
 *   C. September approvals                                      -> approved leave/regularization vs attendance rows
 *   D. 17 APR-upload rejections                                 -> re-check against the current employee record
 *   E. 3 night-shift analysts                                   -> current Oct rows
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import sql from "mssql";

const env = (n: string) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`${n} required`); return v; };

const A_CODES = "MAS63089 MAS63090 MAS63097 MAS63101 MAS63105 MAS63132 MAS63134 MAS63136 MAS63139 MAS63140 MAS63156 MAS63157 MAS63158 MAS63159 MAS63160 MAS63162 MAS63163 MAS63164 MAS63165 MAS63179 MAS63182 MAS63187 MAS63190 MAS63195 MAS63205 MAS63237".split(" ");
const D_CODES = "MAS63264 MAS63449 MAS63498 MAS63669 MAS63708 MAS63709 MAS63710 MAS63711 MAS63712 MAS63714 MAS63716 MAS63717 MAS63718 MAS63719 MAS63720 MAS63721 MAS63723".split(" ");
const E_CODES = ["MAS57521", "MAS58048", "MAS57097"];

(async () => {
  const c = await createConnection({
    host: env("DB_HOST"), port: Number(process.env.DB_PORT || 3306),
    user: env("DB_USER"), password: env("DB_PASSWORD"), database: env("DB_NAME"),
  });
  const q = async (s: string, p: unknown[] = []) => (await c.query<RowDataPacket[]>(s, p))[0] as any[];
  const safe = async (label: string, fn: () => Promise<void>) => {
    try { await fn(); } catch (e) { console.log(`!! ${label} failed: ${(e as Error).message}`); }
  };

  // ───────────────────────── A ─────────────────────────
  await safe("A", async () => {
    console.log("\n===== A. APR available, punching not showing — 26 analysts =====");
    const emps = await q(
      `SELECT e.id, e.employee_code, e.employment_status, e.active_status, e.biometric_code, e.branch_id,
              DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj, DATE_FORMAT(e.salary_start_date,'%Y-%m-%d') sal_start
         FROM employees e WHERE e.employee_code IN (?)`, [A_CODES]);
    const ids = emps.map((e) => e.id);
    const enr = await q(`SELECT employee_id, cosec_user_id, is_active FROM employee_biometric_enrollment WHERE employee_id IN (?)`, [ids]);
    const bal = await q(`SELECT employee_id, COUNT(*) n, MIN(punch_date) d0, MAX(punch_date) d1
                           FROM biometric_attendance_log WHERE employee_id IN (?) AND punch_date >= '2026-10-01' GROUP BY employee_id`, [ids]);
    const ibd = await q(`SELECT employee_code, COUNT(*) n FROM integration_biometric_daily
                          WHERE employee_code IN (?) AND activity_date >= '2026-10-01' GROUP BY employee_code`, [A_CODES]);
    const ses = await q(`SELECT employee_id, COUNT(*) n FROM wfm_attendance_session
                          WHERE employee_id IN (?) AND session_date >= '2026-10-01' GROUP BY employee_id`, [ids]);
    const adr = await q(`SELECT employee_id, attendance_source src, COUNT(*) n, SUM(clock_in_time IS NOT NULL) with_in
                           FROM attendance_daily_record WHERE employee_id IN (?) AND record_date BETWEEN '2026-10-01' AND '2026-10-14'
                          GROUP BY employee_id, attendance_source`, [ids]);
    const apr = await q(`SELECT UserID, COUNT(*) n FROM apr WHERE UserID IN (?) AND ReportDate >= '2026-10-01' GROUP BY UserID`, [A_CODES]);
    console.log("employees found:", emps.length, "of", A_CODES.length);

    // raw COSEC
    const rawByCode = new Map<string, number>();
    let rawErr = "";
    try {
      const pool = await new sql.ConnectionPool({
        server: env("NCOSEC_DB_HOST"), port: Number(process.env.NCOSEC_DB_PORT || 1433),
        user: env("NCOSEC_DB_USER"), password: env("NCOSEC_DB_PASSWORD"), database: process.env.NCOSEC_DB_NAME || "NCOSEC",
        options: { encrypt: process.env.NCOSEC_DB_ENCRYPT === "true", trustServerCertificate: true, readOnlyIntent: true },
        connectionTimeout: 15000, requestTimeout: 60000,
      }).connect();
      const idsForRaw = new Set<string>();
      for (const e of emps) { idsForRaw.add(String(e.employee_code)); if (e.biometric_code) idsForRaw.add(String(e.biometric_code)); }
      for (const r of enr) idsForRaw.add(String(r.cosec_user_id));
      const list = [...idsForRaw].map((x) => `'${x.replace(/'/g, "''")}'`).join(",");
      const res = await pool.request().query(
        `SELECT UserID, COUNT(*) n FROM dbo.Mx_ATDEventTrn WHERE UserID IN (${list}) AND Edatetime >= '2026-10-01' GROUP BY UserID`);
      for (const r of res.recordset) rawByCode.set(String(r.UserID), Number(r.n));
      await pool.close();
    } catch (e) { rawErr = (e as Error).message; }
    if (rawErr) console.log("raw COSEC probe failed:", rawErr);

    console.log("code | status | biometric_code | enrolled cosec ids | bal rows | ibd rows | sessions | adr(src:n/with_in) | apr rows | raw COSEC punches (by any id)");
    for (const code of A_CODES) {
      const e = emps.find((x) => x.employee_code === code);
      if (!e) { console.log(code, "| NO EMPLOYEE ROW"); continue; }
      const en = enr.filter((x) => x.employee_id === e.id).map((x) => `${x.cosec_user_id}${x.is_active ? "" : "(inactive)"}`).join(",") || "-";
      const raw = new Set<string>([String(code), String(e.biometric_code ?? ""), ...enr.filter((x) => x.employee_id === e.id).map((x) => String(x.cosec_user_id))].filter(Boolean));
      const rawN = [...raw].map((k) => `${k}:${rawByCode.get(k) ?? 0}`).join(" ");
      console.log([
        code, `${e.employment_status}/${e.active_status}`, e.biometric_code ?? "NULL", en,
        bal.find((x) => x.employee_id === e.id)?.n ?? 0,
        ibd.find((x) => x.employee_code === code)?.n ?? 0,
        ses.find((x) => x.employee_id === e.id)?.n ?? 0,
        adr.filter((x) => x.employee_id === e.id).map((x) => `${x.src}:${x.n}/${x.with_in}`).join(",") || "-",
        apr.find((x) => x.UserID === code)?.n ?? 0,
        rawN,
      ].join(" | "));
    }
    const [pop] = await q(
      `SELECT COUNT(*) active_employees,
              SUM(biometric_code IS NULL OR biometric_code = '') no_bio_code,
              SUM(NOT EXISTS (SELECT 1 FROM employee_biometric_enrollment x WHERE x.employee_id = e.id AND x.is_active = 1)) no_enrollment
         FROM employees e WHERE e.active_status = 1 AND e.employment_status = 'active'`);
    console.log("population (active):", JSON.stringify(pop));
  });

  // ───────────────────────── B ─────────────────────────
  await safe("B", async () => {
    console.log("\n===== B. CC attendance access =====");
    const u = await q(
      `SELECT e.id emp_id, e.employee_code, e.user_id, e.branch_id, e.process_id
         FROM employees e WHERE LOWER(e.email) = 'dinesh.mehta@teammas.in' OR LOWER(e.official_email) = 'dinesh.mehta@teammas.in' LIMIT 3`);
    console.log("employee rows:", JSON.stringify(u));
    for (const x of u) {
      if (!x.user_id) continue;
      const roles = await q(`SELECT role_key, active_status FROM user_roles WHERE user_id = ?`, [x.user_id]);
      console.log("roles:", roles.map((r) => `${r.role_key}${r.active_status ? "" : "(off)"}`).join(", "));
      try {
        const sc = await q(`SELECT * FROM user_assignment_scope WHERE user_id = ? LIMIT 20`, [x.user_id]);
        console.log("scope rows:", sc.length, JSON.stringify(sc.slice(0, 6)));
      } catch (e) { console.log("scope table:", (e as Error).message); }
    }
    const holders = await q(
      `SELECT role_key, COUNT(*) n FROM user_roles WHERE active_status = 1
        AND role_key IN ('wfm','branch_wfm','payroll_hr','payroll_branch','process_manager','branch_head','payroll_head') GROUP BY role_key`);
    console.log("holders of the cc-attendance roles:", JSON.stringify(holders));
  });

  // ───────────────────────── C ─────────────────────────
  await safe("C", async () => {
    console.log("\n===== C. September approvals vs attendance rows =====");
    const reg = await q(
      `SELECT ar.status, COUNT(*) n,
              SUM(adr.id IS NULL) no_adr_row,
              SUM(adr.id IS NOT NULL AND adr.regularization_id = ar.id) linked,
              SUM(adr.id IS NOT NULL AND adr.regularization_id IS NULL) not_linked
         FROM attendance_regularization ar
         LEFT JOIN attendance_daily_record adr ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
        WHERE ar.session_date BETWEEN '2026-09-01' AND '2026-09-30' GROUP BY ar.status ORDER BY n DESC`);
    console.log("regularization by status:"); console.table(reg);
    const apprNotApplied = await q(
      `SELECT adr.attendance_status, adr.is_locked, COUNT(*) n
         FROM attendance_regularization ar
         JOIN attendance_daily_record adr ON adr.employee_id = ar.employee_id AND adr.record_date = ar.session_date
        WHERE ar.session_date BETWEEN '2026-09-01' AND '2026-09-30' AND ar.status = 'approved' AND adr.regularization_id IS NULL
        GROUP BY adr.attendance_status, adr.is_locked ORDER BY n DESC`);
    console.log("approved regularizations whose attendance row is NOT linked to them:"); console.table(apprNotApplied);
    const lv = await q(
      `SELECT lr.status, COUNT(*) n FROM leave_request lr
        WHERE lr.from_date <= '2026-09-30' AND lr.to_date >= '2026-09-01' GROUP BY lr.status ORDER BY n DESC`);
    console.log("leave requests touching September by status:"); console.table(lv);
    const lvGap = await q(
      `SELECT adr.attendance_status, COUNT(*) n
         FROM leave_request lr
         JOIN attendance_daily_record adr ON adr.employee_id = lr.employee_id
              AND adr.record_date BETWEEN GREATEST(lr.from_date,'2026-09-01') AND LEAST(lr.to_date,'2026-09-30')
        WHERE lr.status = 'approved' AND lr.from_date <= '2026-09-30' AND lr.to_date >= '2026-09-01'
        GROUP BY adr.attendance_status ORDER BY n DESC`);
    console.log("attendance status on days covered by an APPROVED leave:"); console.table(lvGap);
    const pend = await q(
      `SELECT 'regularization' kind, status, COUNT(*) n FROM attendance_regularization
        WHERE session_date BETWEEN '2026-09-01' AND '2026-09-30' AND status IN ('pending','manager_approved') GROUP BY status
       UNION ALL
       SELECT 'leave', status, COUNT(*) FROM leave_request
        WHERE from_date <= '2026-09-30' AND to_date >= '2026-09-01' AND status IN ('pending','manager_approved') GROUP BY status`);
    console.log("still pending for September:"); console.table(pend);
  });

  // ───────────────────────── D ─────────────────────────
  await safe("D", async () => {
    console.log("\n===== D. 17 APR-upload rejections, current record =====");
    const rows = await q(
      `SELECT e.employee_code, e.employment_status, e.active_status,
              DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj, DATE_FORMAT(e.salary_start_date,'%Y-%m-%d') sal_start,
              DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') exit_d, DATE_FORMAT(e.date_of_leaving,'%Y-%m-%d') leave_d,
              (SELECT DATE_FORMAT(COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed),'%Y-%m-%d') FROM exit_request x
                WHERE x.employee_id = e.id AND LOWER(x.status) IN ('accepted','notice_serving','exited')
                ORDER BY COALESCE(x.last_working_day_confirmed, x.last_working_day_proposed) DESC LIMIT 1) exit_req_lwd,
              (SELECT COUNT(*) FROM apr a WHERE a.UserID = e.employee_code AND a.ReportDate >= '2026-10-01') apr_rows_oct
         FROM employees e WHERE e.employee_code IN (?) ORDER BY e.employee_code`, [D_CODES]);
    console.table(rows);
  });

  // ───────────────────────── E ─────────────────────────
  await safe("E", async () => {
    console.log("\n===== E. night-shift analysts, October rows =====");
    const rows = await q(
      `SELECT e.employee_code, adr.record_date, adr.attendance_status, adr.lwp_value, adr.raw_minutes,
              TIME_FORMAT(adr.clock_in_time,'%H:%i') cin, TIME_FORMAT(adr.clock_out_time,'%H:%i') cout, adr.is_locked, adr.attendance_source
         FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
        WHERE e.employee_code IN (?) AND adr.record_date BETWEEN '2026-10-01' AND '2026-10-12'
        ORDER BY e.employee_code, adr.record_date`, [E_CODES]);
    console.table(rows);
  });

  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
