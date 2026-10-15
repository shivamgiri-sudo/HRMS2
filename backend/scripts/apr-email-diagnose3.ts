/**
 * READ-ONLY round 3: the COSEC exclusion table. Which exclusions point at real employees, who put
 * them there, and what attendance they are costing. Counts and codes only.
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

const env = (n: string) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`${n} required`); return v; };

(async () => {
  const c = await createConnection({ host: env("DB_HOST"), port: Number(process.env.DB_PORT || 3306), user: env("DB_USER"), password: env("DB_PASSWORD"), database: env("DB_NAME") });
  const q = async (s: string, p: unknown[] = []) => (await c.query<RowDataPacket[]>(s, p))[0] as any[];

  console.log("== exclusion table: reasons / authors / dates");
  console.table(await q(`SELECT exclusion_reason, created_by, active_status, COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at
                           FROM attendance_reconciliation_cosec_exclusion GROUP BY exclusion_reason, created_by, active_status ORDER BY n DESC`));

  console.log("== active exclusions that match a REAL employee (by code, biometric code or enrolment)");
  const real = await q(
    `SELECT x.cosec_user_id, x.exclusion_reason, x.created_by, DATE_FORMAT(x.created_at,'%Y-%m-%d') created,
            e.employee_code, e.employment_status, e.active_status,
            DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj
       FROM attendance_reconciliation_cosec_exclusion x
       JOIN employees e ON e.employee_code = x.cosec_user_id OR e.biometric_code = x.cosec_user_id
        OR e.id IN (SELECT employee_id FROM employee_biometric_enrollment WHERE cosec_user_id = x.cosec_user_id)
      WHERE x.active_status = 1 ORDER BY e.employee_code`);
  console.log("count:", real.length);
  console.table(real.map((r) => ({ id: r.cosec_user_id, reason: String(r.exclusion_reason).slice(0, 40), by: r.created_by, created: r.created, code: r.employee_code, st: `${r.employment_status}/${r.active_status}`, doj: r.doj })));

  console.log("== active exclusions with NO employee behind them:",
    (await q(`SELECT COUNT(*) n FROM attendance_reconciliation_cosec_exclusion x WHERE x.active_status = 1
                AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.employee_code = x.cosec_user_id OR e.biometric_code = x.cosec_user_id)
                AND NOT EXISTS (SELECT 1 FROM employee_biometric_enrollment b WHERE b.cosec_user_id = x.cosec_user_id)`))[0].n);

  // what it costs: Oct attendance of the affected employees
  const codes = real.map((r) => r.employee_code);
  if (codes.length) {
    console.log("== Oct attendance rows of affected employees (status x source)");
    console.table(await q(
      `SELECT adr.attendance_source src, adr.attendance_status st, COUNT(*) n, SUM(adr.is_locked) locked
         FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
        WHERE e.employee_code IN (?) AND adr.record_date BETWEEN '2026-10-01' AND '2026-10-15'
        GROUP BY adr.attendance_source, adr.attendance_status ORDER BY n DESC`, [codes]));
    console.log("== Sep rows (payroll month) of affected employees, status x source");
    console.table(await q(
      `SELECT adr.attendance_source src, adr.attendance_status st, COUNT(*) n, SUM(adr.is_locked) locked
         FROM attendance_daily_record adr JOIN employees e ON e.id = adr.employee_id
        WHERE e.employee_code IN (?) AND adr.record_date BETWEEN '2026-09-01' AND '2026-09-30'
        GROUP BY adr.attendance_source, adr.attendance_status ORDER BY n DESC`, [codes]));
    const runs = await q(`SELECT DATE_FORMAT(pay_month,'%Y-%m') m, status, COUNT(*) n FROM payroll_run GROUP BY m, status ORDER BY m DESC LIMIT 6`).catch(() => []);
    console.log("payroll runs:", JSON.stringify(runs));
  }
  await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
