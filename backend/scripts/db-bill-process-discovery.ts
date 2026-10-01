/**
 * Read-only discovery: how db_bill (legacy billing master, table masjclrentry) assigns employees to Process / ClientName /
 * CostCenter, and how those employees currently sit in HRMS (employees.process_id). Aggregates only - no personal data.
 */
import "dotenv/config";
import { billQuery, closeBillPool } from "../src/db/billDb.js";
import { db } from "../src/db/mysql.js";

const PATTERNS = ["gnc", "ezzy", "housing", "owner", "premium", "reginald", "sbi", "satya", "finnable", "neeman", "clovia", "bella", "apprec", "appric", "eresol", "lawyer", "dalmia", "birla", "du digital", "viega", "exicom", "gs1", "bla"];

async function main() {
  const cols = await billQuery<{ Field: string }>("DESCRIBE masjclrentry");
  const wanted = ["EmpCode", "Process", "ClientName", "CostCenter", "BranchName", "Dept", "DOL", "Stream", "Profile"];
  const have = new Set(cols.map((c) => c.Field));
  console.log("bill columns present:", wanted.filter((w) => have.has(w)).join(", "), "| missing:", wanted.filter((w) => !have.has(w)).join(", ") || "none");

  const active = "(DOL IS NULL OR DOL = '' OR DOL = '0000-00-00' OR DOL = '0000-00-00 00:00:00')";
  const [{ n }] = await billQuery<{ n: number }>(`SELECT COUNT(*) AS n FROM masjclrentry WHERE ${active}`);
  console.log(`bill active employees: ${n}`);

  console.log("\n## top Process values (active)");
  for (const r of await billQuery<{ Process: string; ClientName: string; n: number }>(
    `SELECT Process, ClientName, COUNT(*) AS n FROM masjclrentry WHERE ${active} GROUP BY Process, ClientName ORDER BY n DESC LIMIT 70`)) {
    console.log(`bill | ${String(r.Process ?? "").slice(0, 40)} | ${String(r.ClientName ?? "").slice(0, 40)} | ${r.n}`);
  }

  for (const p of PATTERNS) {
    const like = `%${p}%`;
    const rows = await billQuery<{ Process: string; ClientName: string; CostCenter: string; n: number }>(
      `SELECT Process, ClientName, CostCenter, COUNT(*) AS n FROM masjclrentry
        WHERE ${active} AND (LOWER(Process) LIKE ? OR LOWER(ClientName) LIKE ? OR LOWER(CostCenter) LIKE ?)
        GROUP BY Process, ClientName, CostCenter ORDER BY n DESC LIMIT 8`, [like, like, like]);
    if (!rows.length) continue;
    console.log(`\n## pattern "${p}"`);
    for (const r of rows) console.log(`pat | ${p} | process=${String(r.Process ?? "").slice(0, 36)} | client=${String(r.ClientName ?? "").slice(0, 36)} | cc=${String(r.CostCenter ?? "").slice(0, 28)} | ${r.n}`);
    // how do these employees sit in HRMS?
    const codes = await billQuery<{ EmpCode: string }>(
      `SELECT DISTINCT EmpCode FROM masjclrentry WHERE ${active} AND (LOWER(Process) LIKE ? OR LOWER(ClientName) LIKE ? OR LOWER(CostCenter) LIKE ?) LIMIT 1500`, [like, like, like]);
    const list = codes.map((c) => String(c.EmpCode ?? "").trim().toUpperCase()).filter(Boolean);
    if (!list.length) continue;
    const [hr] = await db.execute(
      `SELECT COALESCE(pm.process_code, '(no process)') AS code, e.active_status AS active, COUNT(*) AS n
         FROM employees e LEFT JOIN process_master pm ON pm.id = e.process_id
        WHERE UPPER(TRIM(e.employee_code)) IN (${list.map(() => "?").join(",")})
        GROUP BY code, e.active_status ORDER BY n DESC LIMIT 8`, list as never[]);
    const inHr = (hr as Array<{ n: number }>).reduce((s, r) => s + Number(r.n), 0);
    console.log(`hrms | ${p} | bill codes ${list.length} | found in HRMS ${inHr} | ${(hr as Array<{ code: string; active: number; n: number }>).map((r) => `${r.code}${r.active ? "" : "(inactive)"}=${r.n}`).join(", ")}`);
  }
}

main().catch((e) => { console.error("discovery failed:", e instanceof Error ? e.message : e); process.exitCode = 1; })
  .finally(async () => { await closeBillPool().catch(() => undefined); await (db as unknown as { end?: () => Promise<void> }).end?.(); process.exit(); });
