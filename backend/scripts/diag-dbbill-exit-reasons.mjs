// Read-only diagnostic: where does db_bill hold the REASON someone left, and how many of the exits
// that mas_hrms has no reason for could it fill?
//
//   node scripts/diag-dbbill-exit-reasons.mjs        (needs BILL_DB_* and DB_* in the environment)
//
// Writes nothing, to either database. Only SELECT / INFORMATION_SCHEMA statements are issued, and the
// output is aggregate: column names, counts, and the values of SHORT categorical columns (never free
// text, never names or codes).
import "dotenv/config";
import mysql from "mysql2/promise";

const need = (k) => { const v = process.env[k]; if (!v) throw new Error(`${k} is not set`); return v; };
const bill = await mysql.createConnection({
  host: need("BILL_DB_HOST"), port: Number(process.env.BILL_DB_PORT || 3306),
  user: need("BILL_DB_USER"), password: need("BILL_DB_PASSWORD"), database: need("BILL_DB_NAME"), connectTimeout: 20000,
});
const hrms = await mysql.createConnection({
  host: need("DB_HOST"), port: Number(process.env.DB_PORT || 3306),
  user: need("DB_USER"), password: need("DB_PASSWORD"), database: need("DB_NAME"), connectTimeout: 20000,
});
const sel = async (c, sql, p = []) => {
  if (!/^\s*(select|show)\b/i.test(sql)) throw new Error("diagnostic is read-only");
  const [rows] = await c.query(sql, p); return rows;
};
const out = (...a) => console.log(...a);

const [{ v, d }] = await sel(bill, "SELECT VERSION() v, DATABASE() d");
out(`db_bill: ${d} (MySQL ${v})`);

// 1. Everywhere a reason / exit concept might live
const cols = await sel(bill, `SELECT TABLE_NAME t, COLUMN_NAME c, DATA_TYPE ty, CHARACTER_MAXIMUM_LENGTH len
  FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE()
   AND (COLUMN_NAME REGEXP 'reason|resign|leav|left|separat|abscond|terminat|exit|relie|attrit|lwd|notice|dol$'
        OR TABLE_NAME REGEXP 'resign|exit|separat|left|fnf|full_final|relie|attrit|abscond|terminat')
 ORDER BY TABLE_NAME, ORDINAL_POSITION`);
const byTable = new Map();
for (const r of cols) (byTable.get(r.t) ?? byTable.set(r.t, []).get(r.t)).push(`${r.c}:${r.ty}${r.len ? `(${r.len})` : ""}`);
out(`\n== tables with exit/reason-like columns (${byTable.size}) ==`);
for (const [t, cs] of byTable) out(t.padEnd(32), cs.join(", ").slice(0, 400));

// 2. The leaving columns of the legacy employee tables (masjclrentry is the live one, keyed by EmpCode)
const REASON_COLS = ["left_type", "LeftReason", "ReasonofLeaving"];
const filled = (f) => `(\`${f}\` IS NOT NULL AND TRIM(CAST(\`${f}\` AS CHAR)) <> '' AND TRIM(CAST(\`${f}\` AS CHAR)) <> '0')`;
const MIN_SHOW = 5; // a value is only listed when at least this many people share it
async function describe(table) {
  let have;
  try { have = (await sel(bill, `SHOW COLUMNS FROM \`${table}\``)).map((x) => x.Field); } catch { out(`\n(table ${table} not readable)`); return null; }
  const cols = REASON_COLS.filter((c) => have.includes(c));
  const dol = have.includes("DOL") ? "DOL" : null;
  const [t] = await sel(bill, `SELECT COUNT(*) n FROM \`${table}\``);
  const [le] = dol ? await sel(bill, `SELECT COUNT(*) n FROM \`${table}\` WHERE \`${dol}\` IS NOT NULL AND CAST(\`${dol}\` AS CHAR) NOT LIKE '0000%'`) : [{ n: "n/a" }];
  out(`\n== ${table}: ${t.n} rows, ${le.n} with a DOL (date of leaving); reason columns present: ${cols.join(", ") || "none"} ==`);
  for (const f of cols) {
    const [s] = await sel(bill, `SELECT SUM(${filled(f)}) nonempty, COUNT(DISTINCT \`${f}\`) d, AVG(CHAR_LENGTH(CAST(\`${f}\` AS CHAR))) avglen FROM \`${table}\``);
    const [l] = dol ? await sel(bill, `SELECT COUNT(*) leavers, SUM(${filled(f)}) filled FROM \`${table}\` WHERE \`${dol}\` IS NOT NULL AND CAST(\`${dol}\` AS CHAR) NOT LIKE '0000%'`) : [{}];
    out(`-- ${f}: ${s.nonempty} filled, ${s.d} distinct values, avg length ${Number(s.avglen || 0).toFixed(1)}${dol ? `; among people with a DOL: ${l.filled} of ${l.leavers} filled` : ""}`);
    const top = await sel(bill, `SELECT LEFT(TRIM(CAST(\`${f}\` AS CHAR)), 45) v, COUNT(*) n FROM \`${table}\` WHERE ${filled(f)} GROUP BY v HAVING n >= ${MIN_SHOW} ORDER BY n DESC LIMIT 30`);
    out("   values shared by 5+ people:", top.map((r) => `${r.v} (${r.n})`).join("; ") || "none");
  }
  return { cols, dol };
}
const meta = {};
for (const t of ["masjclrentry", "his_masjclrentry", "NewJclrMaster"]) meta[t] = await describe(t);

// 3. How many of HRMS's exits with no recorded reason could db_bill fill?
const noReason = await sel(hrms, `SELECT e.employee_code code, DATE_FORMAT(e.date_of_exit, '%Y-%m-%d') dx
    FROM employees e
    LEFT JOIN (SELECT er.employee_id, MAX(COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))) reason
                 FROM exit_request er GROUP BY er.employee_id) x ON x.employee_id = e.id
   WHERE e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit > DATE_SUB(CURDATE(), INTERVAL 365 DAY)
     AND x.reason IS NULL`);
out(`\n== HRMS exits in the last 12 months with no recorded reason: ${noReason.length} ==`);
const sample = noReason.slice(0, 5).map((r) => String(r.code)); out("sample of HRMS codes (format check):", sample.join(", "));
const codes = noReason.map((r) => String(r.code).trim().toUpperCase()).filter(Boolean);
const dxByCode = new Map(noReason.map((r) => [String(r.code).trim().toUpperCase(), r.dx]));
for (const table of ["masjclrentry", "his_masjclrentry", "NewJclrMaster"]) {
  const m = meta[table]; if (!m || !m.cols.length) continue;
  let found = 0, anyFilled = 0, dateAgrees = 0; const perCol = Object.fromEntries(m.cols.map((c) => [c, 0])); const vals = new Map();
  for (let i = 0; i < codes.length; i += 400) {
    const chunk = codes.slice(i, i + 400);
    const sel2 = m.cols.map((c) => `\`${c}\` AS \`c_${c}\``).join(", ");
    const rows = await sel(bill, `SELECT UPPER(TRIM(EmpCode)) code, ${m.dol ? `DATE_FORMAT(\`${m.dol}\`, '%Y-%m-%d') dol,` : ""} ${sel2} FROM \`${table}\` WHERE UPPER(TRIM(EmpCode)) IN (${chunk.map(() => "?").join(",")})`, chunk);
    const seen = new Set();
    for (const r of rows) {
      if (seen.has(r.code)) continue; seen.add(r.code); found++;
      let any = false;
      for (const c of m.cols) { const v = r[`c_${c}`]; if (v != null && String(v).trim() !== "" && String(v).trim() !== "0") { perCol[c]++; any = true; if (c !== "left_type") vals.set(String(v).trim().slice(0, 45), (vals.get(String(v).trim().slice(0, 45)) ?? 0) + 1); } }
      if (any) anyFilled++;
      if (m.dol && r.dol && dxByCode.get(r.code)) { const dd = Math.abs((new Date(r.dol) - new Date(dxByCode.get(r.code))) / 86400000); if (dd <= 7) dateAgrees++; }
    }
  }
  out(`\n   ${table}: matched ${found} of ${codes.length} by employee code; at least one reason filled for ${anyFilled}; ${Object.entries(perCol).map(([c, n]) => `${c}=${n}`).join(", ")}; leaving date within 7 days of HRMS date_of_exit for ${dateAgrees}`);
  out("   most common reasons among the matched (5+ people):", [...vals.entries()].filter(([, n]) => n >= MIN_SHOW).sort((a, b) => b[1] - a[1]).slice(0, 25).map(([v, n]) => `${v} (${n})`).join("; ") || "none");
}

// 4. What HRMS already holds of this
out("\n== what mas_hrms already stores about leaving reasons ==");
const elm = await sel(hrms, "SHOW COLUMNS FROM employee_legacy_meta");
out("employee_legacy_meta columns:", elm.map((x) => x.Field).join(", "));
const cov = await sel(hrms, `SELECT COUNT(*) exits,
      SUM(l.left_reason IS NOT NULL AND TRIM(l.left_reason) <> '') legacy_meta_reason,
      SUM(e.attrition_reason IS NOT NULL AND TRIM(e.attrition_reason) <> '') attrition_reason_col,
      SUM((l.left_reason IS NOT NULL AND TRIM(l.left_reason) <> '') OR (e.attrition_reason IS NOT NULL AND TRIM(e.attrition_reason) <> '')) either_col,
      SUM(l.employee_id IS NOT NULL) has_legacy_meta_row
    FROM employees e
    LEFT JOIN employee_legacy_meta l ON l.employee_id = e.id
    LEFT JOIN (SELECT er.employee_id, MAX(COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))) reason FROM exit_request er GROUP BY er.employee_id) x ON x.employee_id = e.id
   WHERE e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit > DATE_SUB(CURDATE(), INTERVAL 365 DAY) AND x.reason IS NULL`);
out("among the same exits with no exit_request reason:", JSON.stringify(cov[0]));
const cov2 = await sel(hrms, `SELECT COUNT(*) all_exits_12m, SUM(x.reason IS NULL) no_exit_request_reason,
      SUM(EXISTS(SELECT 1 FROM exit_request er WHERE er.employee_id = e.id)) has_exit_request
    FROM employees e
    LEFT JOIN (SELECT er.employee_id, MAX(COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))) reason FROM exit_request er GROUP BY er.employee_id) x ON x.employee_id = e.id
   WHERE e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit > DATE_SUB(CURDATE(), INTERVAL 365 DAY)`);
out("all exits last 12 months:", JSON.stringify(cov2[0]));
const lt = await sel(hrms, "SELECT LEFT(TRIM(left_reason), 45) v, COUNT(*) n FROM employee_legacy_meta WHERE left_reason IS NOT NULL AND TRIM(left_reason) <> '' GROUP BY v HAVING n >= 5 ORDER BY n DESC LIMIT 15");
out("employee_legacy_meta.left_reason values (5+):", lt.map((r) => `${r.v} (${r.n})`).join("; "));
await bill.end(); await hrms.end();
