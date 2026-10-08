/**
 * Bank verification diagnosis for named joiners. READ-ONLY (SELECTs only).
 *
 * For each employee code, prints every place a bank verification is recorded, so
 * "verified but still listed as pending" and "same person but not auto-verified"
 * can be traced to the row that disagrees. Account numbers and raw provider
 * payloads are never printed.
 *
 *   npx tsx scripts/bank-verify-diagnose.ts MAS63576 MAS63671 ...
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const CODES = process.argv.slice(2);
const q = async (sql: string, p: unknown[] = []) => (await db.execute<RowDataPacket[]>(sql, p))[0];
const SENSITIVE = /account_n|account_no|_enc$|blind|raw_|payload|request_json|response_json|token/i;
const clean = (rows: RowDataPacket[]) =>
  rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k]) => !SENSITIVE.test(k))));
const show = async (label: string, sql: string, p: unknown[]) => {
  try { console.log(`-- ${label}`); console.log(JSON.stringify(clean(await q(sql, p)), null, 1)); }
  catch (e) { console.log(`${label} failed:`, (e as Error).message); }
};

(async () => {
  for (const code of CODES) {
    console.log(`\n==================== ${code} ====================`);
    const [emp] = await q(
      `SELECT id, employee_code, full_name, branch_id, created_at, employment_status
         FROM employees WHERE employee_code = ? LIMIT 1`, [code]).catch(async () =>
      q(`SELECT id, employee_code, full_name, branch_id, created_at FROM employees WHERE employee_code = ? LIMIT 1`, [code]));
    if (!emp) { console.log("no employee row"); continue; }
    console.log(JSON.stringify(emp));
    await show("ats_onboarding_bridge", `SELECT * FROM ats_onboarding_bridge WHERE employee_id = ?`, [emp.id]);
    const cands = await q(
      `SELECT DISTINCT candidate_id FROM ats_onboarding_bridge WHERE employee_id = ? AND candidate_id IS NOT NULL
        UNION SELECT id FROM ats_candidate WHERE employee_code = ?`, [emp.id, code]);
    for (const { candidate_id: cid } of cands) {
      await show(`ats_candidate ${cid}`, `SELECT id, full_name, employee_code, bank_ifsc, status FROM ats_candidate WHERE id = ?`, [cid]);
      await show(`candidate_bank_verification ${cid}`,
        `SELECT * FROM candidate_bank_verification WHERE candidate_id = ? ORDER BY created_at`, [cid]);
      await show(`candidate_onboarding_bank_detail ${cid}`,
        `SELECT * FROM candidate_onboarding_bank_detail WHERE candidate_id = ?`, [cid]);
      await show(`onboarding profile name ${cid}`,
        `SELECT employee_name, father_name, updated_at FROM candidate_onboarding_profile WHERE candidate_id = ?`, [cid]);
      await show(`candidate_bgv_check bank/pan ${cid}`,
        `SELECT check_type, status, matched_name, match_score, result_summary, risk_flags, updated_at
           FROM candidate_bgv_check WHERE candidate_id = ? AND check_type IN ('bank','pan')`, [cid]);
    }
    await show("employee_bank_detail", `SELECT * FROM employee_bank_detail WHERE employee_id = ?`, [emp.id]);
    await show("bank_penny_drop_log", `SELECT * FROM bank_penny_drop_log WHERE employee_id = ? ORDER BY initiated_at`, [emp.id]);
    await show("cheque_name_validation", `SELECT match_status, name_on_cheque, name_in_profile, validated_at
        FROM cheque_name_validation WHERE candidate_id IN (SELECT candidate_id FROM ats_onboarding_bridge WHERE employee_id = ?)`, [emp.id]);
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
