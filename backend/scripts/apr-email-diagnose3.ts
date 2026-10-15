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

  const ex = await q(`SELECT cosec_user_id, exclusion_reason, created_by, DATE_FORMAT(created_at,'%Y-%m-%d') created
                        FROM attendance_reconciliation_cosec_exclusion WHERE active_status = 1`);
  const ids = ex.map((r) => String(r.cosec_user_id));
  console.log("active exclusions:", ids.length);
  const byCode = ids.length ? await q(`SELECT employee_code, biometric_code, employment_status, active_status, id,
                                              DATE_FORMAT(date_of_joining,'%Y-%m-%d') doj
                                         FROM employees WHERE employee_code IN (?) OR biometric_code IN (?)`, [ids, ids]) : [];
  const enr = ids.length ? await q(`SELECT cosec_user_id, employee_id FROM employee_biometric_enrollment WHERE cosec_user_id IN (?)`, [ids]) : [];
  const empById = ids.length && enr.length
    ? await q(`SELECT id, employee_code, employment_status, active_status, DATE_FORMAT(date_of_joining,'%Y-%m-%d') doj FROM employees WHERE id IN (?)`, [enr.map((r) => r.employee_id)])
    : [];
  const owner = new Map<string, any>();
  for (const e of byCode) { owner.set(String(e.employee_code), e); if (e.biometric_code) owner.set(String(e.biometric_code), e); }
  for (const r of enr) { const e = empById.find((x) => x.id === r.employee_id); if (e) owner.set(String(r.cosec_user_id), e); }
  const real = ex.filter((r) => owner.has(String(r.cosec_user_id))).map((r) => ({ ...r, emp: owner.get(String(r.cosec_user_id)) }));
  console.log("active exclusions that belong to a REAL employee:", real.length);
  console.table(real.map((r) => ({ id: r.cosec_user_id, reason: String(r.exclusion_reason).slice(0, 40), by: r.created_by, created: r.created,
    code: r.emp.employee_code, st: `${r.emp.employment_status}/${r.emp.active_status}`, doj: r.emp.doj })));
  console.log("active exclusions with no employee behind them:", ex.length - real.length);

  // what it costs: Oct attendance of the affected employees
  const codes = real.map((r) => String(r.emp.employee_code));
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
