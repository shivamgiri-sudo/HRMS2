/**
 * STRICTLY READ-ONLY. The ATS candidate behind MAS63449 (by candidate id): name, stage, dates, and whether DOB / mobile
 * last-4 / PAN match HRMS employee MAS63401 (Nitin Rana). No identifier values printed, only match flags.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const d10 = (v: unknown) => (v ? (v instanceof Date ? v.toLocaleDateString("en-CA") : String(v).slice(0, 10)) : null);
const cols = async (t: string) => new Set((await q(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t])).map((r) => String(r.c)));

async function main() {
  const [br] = await q(`SELECT candidate_id FROM ats_onboarding_bridge WHERE UPPER(TRIM(employee_code)) = 'MAS63449'`);
  const c = await cols("ats_candidate");
  const want = ["full_name", "candidate_name", "first_name", "last_name", "date_of_birth", "dob", "status", "stage", "current_stage", "employee_code", "created_at", "created_date", "mobile", "phone", "branch_id", "joining_date", "pan_number", "pan"].filter((x) => c.has(x));
  console.log("ats_candidate columns used:", want.join(","));
  const [a] = await q(`SELECT ${want.map((x) => `\`${x}\``).join(",")} FROM ats_candidate WHERE id = ?`, [br.candidate_id]);
  const nm = String(a.full_name ?? a.candidate_name ?? `${a.first_name ?? ""} ${a.last_name ?? ""}`).trim();
  console.log("candidate:", JSON.stringify({ name: nm, status: a.status ?? a.stage ?? a.current_stage, code_on_candidate: a.employee_code ?? null, created: d10(a.created_at ?? a.created_date), joining: d10(a.joining_date), dob: d10(a.date_of_birth ?? a.dob) }));
  const [e] = await q(`SELECT date_of_birth, RIGHT(mobile,4) m4, pan_number, date_of_joining, date_of_exit FROM employees WHERE employee_code = 'MAS63401'`);
  const mob = String(a.mobile ?? a.phone ?? "").replace(/\D/g, "").slice(-4);
  console.log("vs MAS63401 (Nitin Rana):", JSON.stringify({
    same_name: nm.toUpperCase().replace(/\s+/g, " ") === "NITIN RANA",
    dob_match: d10(a.date_of_birth ?? a.dob) === d10(e.date_of_birth),
    mobile_last4_match: !!mob && mob === String(e.m4),
    pan_match: !!(a.pan_number ?? a.pan) && String(a.pan_number ?? a.pan).trim().toUpperCase() === String(e.pan_number ?? "").trim().toUpperCase(),
    employee_doj: d10(e.date_of_joining), employee_exit: d10(e.date_of_exit),
  }));
  const [dup] = await q(`SELECT COUNT(*) n FROM ats_candidate WHERE id <> ? AND UPPER(TRIM(IFNULL(employee_code,''))) IN ('MAS63449','MAS63401')`, [br.candidate_id]).catch(() => [{ n: "n/a" }]);
  console.log("other ATS candidates carrying MAS63449/MAS63401:", JSON.stringify(dup));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
