// Read-only: what does db_bill know about NOC / clearance / F&F status for people who have left, and
// how does it line up with HRMS employees and noc_case? SELECT/SHOW/INFORMATION_SCHEMA only.
// Output is column names, categorical values and counts. No names, no codes, no free text.
import "dotenv/config";
import mysql from "mysql2/promise";
const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const bill = await mysql.createConnection({ host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306),
  user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000 });
const hrms = await mysql.createConnection({ host: need("DB_HOST"), port: Number(process.env.DB_PORT || 3306),
  user: need("DB_USER"), password: need("DB_PASSWORD"), database: need("DB_NAME"), connectTimeout: 20000 });
const q = async (c, sql, p = []) => { if (!/^\s*(select|show)\b/i.test(sql)) throw new Error("read-only"); try { const [r] = await c.query(sql, p); return r; } catch (e) { return `ERR ${e.message}`; } };
const p = (l, v) => console.log(`\n== ${l} ==\n${typeof v === "string" ? v : JSON.stringify(v).slice(0, 3000)}`);

p("db_bill columns that look like NOC / clearance / dues", await q(bill, `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE ty FROM INFORMATION_SCHEMA.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND (COLUMN_NAME REGEXP 'noc|clearance|nodue|no_due|dues|cleared|relieving|relieve|exitform|exit_form|handover|handed' OR TABLE_NAME REGEXP 'noc|clearance|nodue|relie')
  ORDER BY TABLE_NAME, ORDINAL_POSITION LIMIT 80`));
p("masjclrentry Status values", await q(bill, `SELECT Status v, COUNT(*) n FROM masjclrentry GROUP BY 1 ORDER BY n DESC LIMIT 12`));
p("masjclrentry: left (DOL set) by FnfStatus", await q(bill, `SELECT FnfStatus v, COUNT(*) n FROM masjclrentry WHERE DOL IS NOT NULL AND DOL <> '' AND DOL <> '0000-00-00' GROUP BY 1 ORDER BY n DESC`));
p("masjclrentry: left, FnfDoc present", await q(bill, `SELECT (FnfDoc IS NOT NULL AND FnfDoc <> '') has_doc, COUNT(*) n FROM masjclrentry WHERE DOL IS NOT NULL AND DOL <> '' AND DOL <> '0000-00-00' GROUP BY 1`));
p("masjclrentry: DOL by year (left)", await q(bill, `SELECT YEAR(DOL) y, COUNT(*) n FROM masjclrentry WHERE DOL IS NOT NULL AND DOL <> '' AND DOL <> '0000-00-00' GROUP BY 1 ORDER BY 1 DESC LIMIT 8`));
// How many HRMS leavers does this cover?
const hr = await q(hrms, `SELECT COUNT(*) n FROM employees WHERE LOWER(COALESCE(employment_status,'')) <> 'active'`);
p("HRMS employees not active", hr);
p("HRMS leavers with a noc_case", await q(hrms, `SELECT nc.status, COUNT(*) n FROM noc_case nc GROUP BY 1`));
// match by employee code
const codes = await q(bill, `SELECT EmpCode c, FnfStatus f, (FnfDoc IS NOT NULL AND FnfDoc <> '') d FROM masjclrentry WHERE DOL IS NOT NULL AND DOL <> '' AND DOL <> '0000-00-00'`);
const byCode = new Map(codes.map((r) => [String(r.c).trim().toUpperCase(), r]));
const leavers = await q(hrms, `SELECT e.id, e.employee_code, LOWER(COALESCE(e.employment_status,'')) st,
  (SELECT nc.status FROM noc_case nc WHERE nc.employee_id = e.id LIMIT 1) noc FROM employees e
  WHERE LOWER(COALESCE(e.employment_status,'')) <> 'active'`);
const tally = {};
for (const l of leavers) {
  const b = byCode.get(String(l.employee_code).trim().toUpperCase());
  const key = `${b ? `bill:${b.f ?? "null"}${b.d ? "+doc" : ""}` : "not-in-bill"} | hrms-noc:${l.noc ?? "none"}`;
  tally[key] = (tally[key] ?? 0) + 1;
}
p("HRMS leavers x db_bill F&F status x HRMS NOC (count)", Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 25)));
await bill.end(); await hrms.end();
