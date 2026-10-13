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
const LEFT = "TRIM(CAST(Status AS CHAR)) = '0'";
p("Status 0 (left?) vs 1 (active?) — with NOC validation present", await q(bill, `SELECT TRIM(CAST(Status AS CHAR)) st, (NocValidateDate IS NOT NULL) has_noc_date, (NocValidateBy IS NOT NULL AND NocValidateBy <> '') has_noc_by, COUNT(*) n FROM masjclrentry GROUP BY 1,2,3 ORDER BY n DESC LIMIT 12`));
p("left: F&F status x NOC validated", await q(bill, `SELECT FnfStatus f, (NocValidateDate IS NOT NULL) noc, COUNT(*) n FROM masjclrentry WHERE ${LEFT} GROUP BY 1,2 ORDER BY n DESC LIMIT 15`));
p("left: NOC validated by year", await q(bill, `SELECT YEAR(NocValidateDate) y, COUNT(*) n FROM masjclrentry WHERE ${LEFT} AND NocValidateDate IS NOT NULL GROUP BY 1 ORDER BY 1 DESC LIMIT 10`));
p("left: distinct NOC validators and remark kinds", await q(bill, `SELECT COUNT(DISTINCT NocValidateBy) validators, SUM(NocValidateRemarks IS NOT NULL AND NocValidateRemarks <> '') with_remarks, COUNT(*) validated FROM masjclrentry WHERE ${LEFT} AND NocValidateDate IS NOT NULL`));
p("left: ResignationDate/DOL populated", await q(bill, `SELECT (ResignationDate IS NOT NULL AND ResignationDate <> '') has_res, (DOL IS NOT NULL AND DOL <> '' AND DOL <> '0000-00-00') has_dol, COUNT(*) n FROM masjclrentry WHERE ${LEFT} GROUP BY 1,2`));
const rows = await q(bill, `SELECT EmpCode c, FnfStatus f, NocValidateDate nd, (NocValidateBy IS NOT NULL AND NocValidateBy <> '') nb FROM masjclrentry WHERE ${LEFT}`);
const byCode = new Map(rows.map((r) => [String(r.c).trim().toUpperCase(), r]));
const hr = await q(hrms, `SELECT e.id, e.employee_code, LOWER(COALESCE(e.employment_status,'')) st,
  (SELECT nc.status FROM noc_case nc WHERE nc.employee_id = e.id LIMIT 1) noc FROM employees e WHERE LOWER(COALESCE(e.employment_status,'')) <> 'active'`);
const tally = {}; let matched = 0;
for (const l of hr) {
  const b = byCode.get(String(l.employee_code).trim().toUpperCase());
  if (b) matched++;
  const k = `${b ? (b.nd ? "bill:NOC-validated" : "bill:left-no-NOC") : "not-in-bill"} | hrms-noc:${l.noc ?? "none"}`;
  tally[k] = (tally[k] ?? 0) + 1;
}
p(`HRMS non-active (${hr.length}) matched to db_bill left rows: ${matched} of ${rows.length}`, Object.fromEntries(Object.entries(tally).sort((a, b) => b[1] - a[1])));
// code format check, so a mismatch is visible rather than silent
p("code formats (sample prefixes)", { bill: [...new Set(rows.slice(0, 400).map((r) => String(r.c).replace(/[0-9]/g, "9")))].slice(0, 8), hrms: [...new Set(hr.slice(0, 400).map((r) => String(r.employee_code).replace(/[0-9]/g, "9")))].slice(0, 8) });
await bill.end(); await hrms.end();
