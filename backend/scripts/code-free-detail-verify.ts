/**
 * STRICTLY READ-ONLY. Who holds MAS63449 in the tables the scan hit: dates and statuses only, no identifiers.
 */
import "dotenv/config";
import type { RowDataPacket } from "mysql2";
import { db } from "../src/db/mysql.js";

const CODE = "MAS63449";
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const say = async (label: string, f: () => Promise<unknown>) => { try { console.log(`${label}:`, JSON.stringify(await f())); } catch (e) { console.log(`${label}: [failed ${(e as Error).message.slice(0, 100)}]`); } };
const colsOf = async (t: string) => (await q(`SELECT COLUMN_NAME c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?`, [t])).map((r) => String(r.c));
const pick = (all: string[], re: RegExp) => all.filter((c) => re.test(c) && !/(name|mobile|phone|email|pan|aadhaar|address|bank|ifsc)/i.test(c));

async function main() {
  for (const [t, col] of [["ats_onboarding_bridge", "employee_code"], ["ats_branch_head_approval", "employee_code_generated"], ["cosec_user_sync_queue", "employee_code"], ["lms_learner_progress", "employee_code"], ["lob_master", "lob_code"]] as const) {
    const all = await colsOf(t);
    const keep = pick(all, /(status|created|updated|date|stage|approved|source|sync|state|lob_name|processed|attempt|error)/i);
    await say(`${t}.${col}`, async () => q(`SELECT ${keep.length ? keep.map((c) => `\`${c}\``).join(",") : "COUNT(*) n"} FROM \`${t}\` WHERE UPPER(TRIM(\`${col}\`)) = ? LIMIT 3`, [CODE]));
  }
  await say("lms_mapping_audit tried_employee_code (first/last/n)", async () => q(`SELECT COUNT(*) n, MIN(created_at) first_at, MAX(created_at) last_at FROM lms_mapping_audit WHERE UPPER(TRIM(tried_employee_code)) = ?`, [CODE]));
  await say("attendance_reconciliation_issue cosec_user_id (n, first, last)", async () => q(`SELECT COUNT(*) n, MIN(issue_date) first_day, MAX(issue_date) last_day FROM attendance_reconciliation_issue WHERE UPPER(TRIM(cosec_user_id)) = ?`, [CODE]));
  await say("employee row for the ATS candidate (by code)", async () => q(`SELECT COUNT(*) n FROM employees WHERE UPPER(TRIM(employee_code)) = ? OR UPPER(TRIM(biometric_code)) = ?`, [CODE, CODE]));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => process.exit(process.exitCode ?? 0));
