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

// 2. employee_master: the table HRMS already syncs from
const em = await sel(bill, "SHOW COLUMNS FROM employee_master");
out(`\n== employee_master has ${em.length} columns ==`);
out(em.map((x) => `${x.Field}:${x.Type}`).join(", ").slice(0, 3000));

const candidates = em.filter((x) => /reason|resign|leav|separat|abscond|terminat|remark/i.test(x.Field) && !/date|dt$/i.test(x.Field) && /char|text|int|enum/i.test(x.Type));
out(`\n== candidate reason columns in employee_master: ${candidates.map((c) => c.Field).join(", ") || "none"} ==`);
const [{ n: total }] = await sel(bill, "SELECT COUNT(*) n FROM employee_master");
out(`employee_master rows: ${total}`);
const statusCol = em.find((x) => x.Field === "Status") ? "Status" : null;
if (statusCol) {
  const st = await sel(bill, "SELECT `Status` s, COUNT(*) n FROM employee_master GROUP BY `Status` ORDER BY n DESC LIMIT 10");
  out("Status values:", st.map((r) => `${r.s}=${r.n}`).join(", "));
}
const leftOk = em.find((x) => x.Field === "LeftDate") ? "LeftDate" : (em.find((x) => x.Field === "DOL") ? "DOL" : null);

for (const c of candidates) {
  const f = c.Field;
  const [s] = await sel(bill, `SELECT COUNT(*) total, SUM(\`${f}\` IS NOT NULL AND TRIM(CAST(\`${f}\` AS CHAR)) <> '' AND TRIM(CAST(\`${f}\` AS CHAR)) <> '0') nonempty,
      COUNT(DISTINCT \`${f}\`) distinct_n, MAX(CHAR_LENGTH(CAST(\`${f}\` AS CHAR))) maxlen, AVG(CHAR_LENGTH(CAST(\`${f}\` AS CHAR))) avglen FROM employee_master`);
  out(`\n-- ${f} (${c.Type}): non-empty ${s.nonempty} of ${s.total}, ${s.distinct_n} distinct, avg length ${Number(s.avglen || 0).toFixed(1)}, max ${s.maxlen}`);
  if (leftOk) {
    const [l] = await sel(bill, `SELECT COUNT(*) leavers, SUM(\`${f}\` IS NOT NULL AND TRIM(CAST(\`${f}\` AS CHAR)) <> '' AND TRIM(CAST(\`${f}\` AS CHAR)) <> '0') with_reason
        FROM employee_master WHERE \`${leftOk}\` IS NOT NULL AND CAST(\`${leftOk}\` AS CHAR) NOT LIKE '0000%'`);
    out(`   among people with a ${leftOk}: ${l.leavers}, of whom ${l.with_reason} have this filled`);
  }
  if (Number(s.distinct_n) <= 80 && Number(s.maxlen || 0) <= 60) {
    const top = await sel(bill, `SELECT CAST(\`${f}\` AS CHAR) v, COUNT(*) n FROM employee_master WHERE \`${f}\` IS NOT NULL AND TRIM(CAST(\`${f}\` AS CHAR)) <> '' GROUP BY v ORDER BY n DESC LIMIT 25`);
    out("   values:", top.map((r) => `${r.v} (${r.n})`).join("; "));
  } else out("   (free text or too many values - not listed)");
}

// 3. How many of HRMS's exits with no recorded reason could db_bill fill?
const noReason = await sel(hrms, `SELECT e.employee_code code
    FROM employees e
    LEFT JOIN (SELECT er.employee_id, MAX(COALESCE(NULLIF(TRIM(er.exit_reason_category),''), NULLIF(TRIM(er.resignation_reason),''))) reason
                 FROM exit_request er GROUP BY er.employee_id) x ON x.employee_id = e.id
   WHERE e.date_of_exit IS NOT NULL AND e.date_of_exit >= e.date_of_joining AND e.date_of_exit > DATE_SUB(CURDATE(), INTERVAL 365 DAY)
     AND x.reason IS NULL`);
out(`\n== HRMS exits in the last 12 months with no recorded reason: ${noReason.length} ==`);
const codes = noReason.map((r) => String(r.code).trim()).filter(Boolean);
for (const c of candidates) {
  let found = 0, filled = 0;
  for (let i = 0; i < codes.length; i += 400) {
    const chunk = codes.slice(i, i + 400);
    const rows = await sel(bill, `SELECT COUNT(*) found, SUM(\`${c.Field}\` IS NOT NULL AND TRIM(CAST(\`${c.Field}\` AS CHAR)) <> '' AND TRIM(CAST(\`${c.Field}\` AS CHAR)) <> '0') filled
        FROM employee_master WHERE EmpCode IN (${chunk.map(() => "?").join(",")})`, chunk);
    found += Number(rows[0].found); filled += Number(rows[0].filled || 0);
  }
  out(`   via employee_master.${c.Field}: matched ${found} of ${codes.length} by employee code; ${filled} of those have a value`);
}
await bill.end(); await hrms.end();
