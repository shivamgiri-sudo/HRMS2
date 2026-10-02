// Read-only. Is the db_bill record we take a leaving reason from the SAME stint as the HRMS exit (not an earlier stint
// of someone who was rehired)? Compares joining dates (DOJ) and, where parseable, ResignationDate with the HRMS exit date.
// Prints counts and date-format shapes only: no names, codes or ids. Issues SELECT statements only.
import "dotenv/config";
import mysql from "mysql2/promise";

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const bill = await mysql.createConnection({ host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306), user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000 });
const hrms = await mysql.createConnection({ host: need("DB_HOST"), port: Number(process.env.DB_PORT || 3306), user: need("DB_USER"), password: need("DB_PASSWORD"), database: need("DB_NAME"), connectTimeout: 20000 });
const sel = async (c, sql, p = []) => { if (!/^\s*select\b/i.test(sql)) throw new Error("read-only"); const [r] = await c.query(sql, p); return r; };

const exits = await sel(hrms, `SELECT UPPER(TRIM(e.employee_code)) code, DATE_FORMAT(e.date_of_joining,'%Y-%m-%d') doj, DATE_FORMAT(e.date_of_exit,'%Y-%m-%d') dx
   FROM employees e WHERE e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit > DATE_SUB(CURDATE(), INTERVAL 365 DAY)`);
console.log(`HRMS exits in the last 12 months: ${exits.length}`);
const byCode = new Map(exits.map((e) => [e.code, e]));
const shape = (s) => String(s ?? "").trim().replace(/[0-9]/g, "d").slice(0, 24);
const parse = (raw) => {
  const s = String(raw ?? "").trim(); if (!s || /^0000/.test(s)) return null;
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/); if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  m = s.match(/^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/); if (m) { let d = +m[1], mo = +m[2]; if (mo > 12 && d <= 12) [d, mo] = [mo, d]; return new Date(Date.UTC(+m[3], mo - 1, d)); }
  return null;
};
const day = 86400000;
const codes = [...byCode.keys()];
const stat = { found: 0, dojParsed: 0, dojSame: 0, dojWithin7: 0, dojDiffers: 0, dojMissing: 0, resParsed: 0, resNearExit: 0, resAfterExit: 0, resFarBefore: 0, rowsPerCode2plus: 0 };
const shapes = { DOJ: new Map(), ResignationDate: new Map() }; const gaps = [];
for (let i = 0; i < codes.length; i += 400) {
  const chunk = codes.slice(i, i + 400);
  const rows = await sel(bill, `SELECT UPPER(TRIM(EmpCode)) code, DOJ, ResignationDate FROM masjclrentry WHERE UPPER(TRIM(EmpCode)) IN (${chunk.map(() => "?").join(",")})`, chunk);
  const seen = new Map();
  for (const r of rows) seen.set(r.code, (seen.get(r.code) ?? 0) + 1);
  stat.rowsPerCode2plus += [...seen.values()].filter((n) => n > 1).length;
  const done = new Set();
  for (const r of rows) {
    if (done.has(r.code)) continue; done.add(r.code); stat.found++;
    const h = byCode.get(r.code);
    shapes.DOJ.set(shape(r.DOJ), (shapes.DOJ.get(shape(r.DOJ)) ?? 0) + 1);
    shapes.ResignationDate.set(shape(r.ResignationDate), (shapes.ResignationDate.get(shape(r.ResignationDate)) ?? 0) + 1);
    const bd = parse(r.DOJ); const hd = new Date(`${h.doj}T00:00:00Z`);
    if (!bd) stat.dojMissing++; else { stat.dojParsed++; const gap = Math.abs((bd - hd) / day); if (gap === 0) stat.dojSame++; else if (gap <= 7) stat.dojWithin7++; else { stat.dojDiffers++; gaps.push(Math.round(gap)); } }
    const rd = parse(r.ResignationDate); const xd = new Date(`${h.dx}T00:00:00Z`);
    if (rd) { stat.resParsed++; const delta = (xd - rd) / day; if (Math.abs(delta) <= 7) stat.resNearExit++; else if (delta < -7) stat.resAfterExit++; else stat.resFarBefore++; }
  }
}
console.log("matched by employee code:", stat.found, "| codes with 2+ db_bill rows:", stat.rowsPerCode2plus);
console.log(`joining date (DOJ) vs HRMS date_of_joining -> parsed ${stat.dojParsed}: identical ${stat.dojSame}, within 7 days ${stat.dojWithin7}, DIFFERENT ${stat.dojDiffers}; unparseable/missing ${stat.dojMissing}`);
if (gaps.length) { gaps.sort((a, b) => a - b); console.log(`  differing DOJ gaps in days: median ${gaps[Math.floor(gaps.length / 2)]}, max ${gaps[gaps.length - 1]}, over 180 days: ${gaps.filter((g) => g > 180).length}`); }
console.log(`ResignationDate parsed ${stat.resParsed} -> within 7 days of HRMS exit ${stat.resNearExit}; resignation date well AFTER the HRMS exit ${stat.resAfterExit}; well BEFORE it ${stat.resFarBefore}`);
for (const [k, v] of Object.entries(shapes)) console.log(`${k} formats seen:`, [...v.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([s, n]) => `"${s}"=${n}`).join(", "));
await bill.end(); await hrms.end();
