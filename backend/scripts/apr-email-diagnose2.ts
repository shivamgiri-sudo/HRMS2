/**
 * READ-ONLY round 2: why do 26 analysts with raw COSEC punches have no HRMS punch rows?
 * Uses the sync's own classifier so the answer is what the sync would actually do.
 */
import "dotenv/config";
import { createConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import sql from "mssql";
import { buildSourceUserMaps, classifySourceUser } from "../src/modules/wfm/attendance-reconciliation-mapping.js";

const env = (n: string) => { const v = process.env[n]?.trim(); if (!v) throw new Error(`${n} required`); return v; };
const CODES = "MAS63089 MAS63090 MAS63097 MAS63101 MAS63105 MAS63132 MAS63134 MAS63136 MAS63139 MAS63140 MAS63156 MAS63157 MAS63158 MAS63159 MAS63160 MAS63162 MAS63163 MAS63164 MAS63165 MAS63179 MAS63182 MAS63187 MAS63190 MAS63195 MAS63205 MAS63237".split(" ");

(async () => {
  console.log("NCOSEC_SOURCE_MODE =", JSON.stringify(process.env.NCOSEC_SOURCE_MODE ?? null), "| NCOSEC_EVENT_TABLE =", JSON.stringify(process.env.NCOSEC_EVENT_TABLE ?? null),
    "| lookback days =", JSON.stringify(process.env.NCOSEC_SYNC_LOOKBACK_DAYS ?? null));
  const c = await createConnection({ host: env("DB_HOST"), port: Number(process.env.DB_PORT || 3306), user: env("DB_USER"), password: env("DB_PASSWORD"), database: env("DB_NAME") });
  const q = async (s: string, p: unknown[] = []) => (await c.query<RowDataPacket[]>(s, p))[0] as any[];

  // 1. what the sync's classifier says
  const employeeRows = await q(`SELECT e.id AS employee_id, e.employee_code, e.biometric_code, e.active_status, e.employment_status, ebe.cosec_user_id
                                  FROM employees e LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id`);
  const excluded = await q(`SELECT cosec_user_id FROM attendance_reconciliation_cosec_exclusion WHERE active_status = 1`);
  const maps = buildSourceUserMaps(employeeRows as any[], excluded.map((r) => String(r.cosec_user_id ?? "")));
  console.log("\n== classifier verdict per code (what sync() does with its punches)");
  const verdicts: Record<string, string[]> = {};
  for (const code of CODES) {
    const v = classifySourceUser(code, maps).kind;
    (verdicts[v] ||= []).push(code);
  }
  for (const [k, v] of Object.entries(verdicts)) console.log(k, v.length, v.join(" "));
  console.log("exclusion table holds any of them:", excluded.filter((r) => CODES.includes(String(r.cosec_user_id))).map((r) => r.cosec_user_id).join(",") || "none", "| active exclusions:", excluded.length);

  // 2. duplicates in enrolment
  const dup = await q(`SELECT cosec_user_id, COUNT(DISTINCT employee_id) n FROM employee_biometric_enrollment WHERE cosec_user_id IN (?) GROUP BY cosec_user_id HAVING n > 1`, [CODES]);
  console.log("enrolment ids shared by >1 employee:", dup.length ? JSON.stringify(dup) : "none");
  const resolve = await q(
    `SELECT e.employee_code, COUNT(*) n FROM employees e
       LEFT JOIN employee_biometric_enrollment ebe ON ebe.employee_id = e.id AND ebe.is_active = 1
      WHERE e.employee_code IN (?) AND e.active_status = 1 GROUP BY e.employee_code`, [CODES]);
  console.log("resolveEmployee() would find (active_status=1):", resolve.length, "of", CODES.length);

  // 3. recent sync runs
  const runs = await q(`SELECT integration_key, DATE_FORMAT(started_at,'%m-%d %H:%i') started, status, records_read, records_written, records_failed, LEFT(error_summary, 160) err
                          FROM integration_sync_run WHERE integration_key LIKE '%cosec%' ORDER BY started_at DESC LIMIT 12`);
  console.log("\n== last COSEC sync runs"); console.table(runs);

  // 4. BAL coverage across the whole population this month
  const cov = await q(`SELECT COUNT(DISTINCT employee_id) emp_with_bal FROM biometric_attendance_log WHERE punch_date >= '2026-10-01'`);
  const src = await q(`SELECT source_system, COUNT(*) n, COUNT(DISTINCT employee_id) emps, MAX(punch_date) last_day FROM biometric_attendance_log WHERE punch_date >= '2026-10-01' GROUP BY source_system`);
  console.log("\nemployees with BAL rows in Oct:", JSON.stringify(cov[0])); console.table(src);

  // 5. raw COSEC for the 26: date coverage, and population-wide gap
  const pool = await new sql.ConnectionPool({
    server: env("NCOSEC_DB_HOST"), port: Number(process.env.NCOSEC_DB_PORT || 1433), user: env("NCOSEC_DB_USER"), password: env("NCOSEC_DB_PASSWORD"),
    database: process.env.NCOSEC_DB_NAME || "NCOSEC", options: { encrypt: process.env.NCOSEC_DB_ENCRYPT === "true", trustServerCertificate: true, readOnlyIntent: true },
    connectionTimeout: 15000, requestTimeout: 90000,
  }).connect();
  const list = CODES.map((x) => `'${x}'`).join(",");
  const days = await pool.request().query(
    `SELECT UserID, CONVERT(CHAR(10), CAST(Edatetime AS DATE), 23) d, COUNT(*) n FROM dbo.Mx_ATDEventTrn
      WHERE UserID IN (${list}) AND Edatetime >= '2026-10-01' GROUP BY UserID, CAST(Edatetime AS DATE) ORDER BY UserID, d`);
  const byUser = new Map<string, string[]>();
  for (const r of days.recordset) { const a = byUser.get(r.UserID) ?? []; a.push(`${r.d.slice(8)}:${r.n}`); byUser.set(r.UserID, a); }
  console.log("\n== raw COSEC days (dd:punches) since 1 Oct");
  for (const code of CODES) console.log(code, (byUser.get(code) ?? []).join(" ") || "(none)");

  // population-wide: employees with raw punches in the last 3 days but no BAL row for those days
  const recent = await pool.request().query(
    `SELECT CAST(UserID AS NVARCHAR(50)) UserID, COUNT(*) n FROM dbo.Mx_ATDEventTrn WHERE Edatetime >= DATEADD(DAY,-3,CAST(GETDATE() AS DATE)) GROUP BY UserID`);
  const rawUsers = recent.recordset.map((r: any) => String(r.UserID).trim());
  const have = await q(`SELECT DISTINCT e.employee_code FROM biometric_attendance_log b JOIN employees e ON e.id = b.employee_id WHERE b.punch_date >= DATE_SUB(CURDATE(), INTERVAL 3 DAY)`);
  const haveSet = new Set(have.map((r) => String(r.employee_code)));
  const missing = rawUsers.filter((u: string) => !haveSet.has(u) && !u.toUpperCase().startsWith("IDC"));
  console.log("\nraw COSEC users active in last 3 days:", rawUsers.length, "| without a BAL row in those days:", missing.length);
  console.log("sample missing:", missing.slice(0, 60).join(" "));
  const inMine = missing.filter((u: string) => CODES.includes(u));
  console.log("of which in the 26:", inMine.length);
  await pool.close(); await c.end();
})().catch((e) => { console.error(e); process.exit(1); });
