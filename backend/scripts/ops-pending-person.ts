/**
 * One joiner's state across every Ops Control Tower list, with the underlying evidence. READ-ONLY.
 *   npx tsx scripts/ops-pending-person.ts "name one" "name two"   (words matched against full_name, or an employee code)
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const run = async (label: string, sql: string, params: unknown[]) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
    console.log(`  -- ${label}`);
    if (!(rows as RowDataPacket[]).length) console.log("     (none)");
    for (const r of rows as RowDataPacket[]) console.log("     " + Object.entries(r).map(([k, v]) => `${k}=${v instanceof Date ? v.toISOString() : v}`).join("  "));
  } catch (e) { console.log(`  -- ${label} FAILED: ${(e as Error).message}`); }
};

(async () => {
  const names = process.argv.slice(2).join(" ").split(/[,;\n]/).map((s) => s.trim()).filter(Boolean);
  for (const name of names) {
    const words = name.split(/\s+/);
    const like = words.map(() => "e.full_name LIKE ?").join(" AND ");
    const [emps] = await db.execute<RowDataPacket[]>(
      `SELECT e.id, e.employee_code, e.full_name, e.active_status, e.employment_status, e.created_at, e.branch_id
         FROM employees e WHERE e.employee_code = ? OR (${like}) ORDER BY e.created_at DESC LIMIT 5`,
      [name, ...words.map((w) => `%${w}%`)] as never[],
    );
    console.log(`\n##### ${name}: ${(emps as RowDataPacket[]).length} match(es)`);
    for (const e of emps as RowDataPacket[]) {
      const id = e.id;
      console.log(`\n=== ${e.employee_code} ${e.full_name} active=${e.active_status} emp_status=${e.employment_status} created=${new Date(e.created_at).toISOString()}`);
      await run("bridge", `SELECT candidate_id, digilocker_status, penny_drop_status, joining_document_status, joining_document_completion_pct, digilocker_completed_at, penny_drop_verified_at FROM ats_onboarding_bridge WHERE employee_id = ?`, [id]);
      await run("bgv report", `SELECT r.overall_status, r.locked, r.bgv_score, r.digilocker_status, r.aadhaar_status, r.pan_status, r.bank_status, r.education_status, r.address_status, r.employment_status, r.criminal_status FROM ats_onboarding_bridge b JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id WHERE b.employee_id = ?`, [id]);
      await run("bgv checks", `SELECT c.check_type, c.status, c.provider_key FROM ats_onboarding_bridge b JOIN candidate_bgv_check c ON c.candidate_id = b.candidate_id WHERE b.employee_id = ? ORDER BY c.check_type`, [id]);
      await run("address verification", `SELECT v.status, v.hr_decision, v.gps_distance_m, v.submitted_at FROM ats_onboarding_bridge b JOIN candidate_bgv_address_verification v ON v.candidate_id = b.candidate_id WHERE b.employee_id = ? ORDER BY v.submitted_at DESC LIMIT 3`, [id]);
      await run("luckpay digilocker txns", `SELECT t.status, t.updated_at FROM ats_onboarding_bridge b JOIN ats_provider_transaction_log t ON t.candidate_id = b.candidate_id WHERE b.employee_id = ? AND t.provider='luckpay' AND t.service_type='digilocker' ORDER BY t.updated_at DESC LIMIT 5`, [id]);
      await run("bank: employee_bank_detail", `SELECT verified, created_at FROM employee_bank_detail WHERE employee_id = ?`, [id]);
      await run("bank: candidate verification", `SELECT pv.verification_status, pv.verification_method FROM ats_onboarding_bridge b JOIN candidate_bank_verification pv ON pv.candidate_id = b.candidate_id WHERE b.employee_id = ?`, [id]);
      await run("esign kit", `SELECT status, updated_at FROM employee_joining_esign_kit WHERE employee_id = ?`, [id]);
      await run("docs checklist (mandatory, not closed)", `SELECT document_code, status FROM employee_joining_document_checklist WHERE employee_id = ? AND mandatory = 1 AND LOWER(COALESCE(status,'')) NOT IN ('verified','signed_verified','completed','esign_completed','wet_signed_uploaded','waived','not_applicable')`, [id]);
      await run("appointment letter", `SELECT employee_esign_status, employee_esign_at FROM appointment_letter_issue WHERE employee_id = ?`, [id]);
      await run("provisioning tasks", `SELECT assigned_role, task_code, status FROM it_provisioning_request WHERE employee_id = ? AND request_type='join' ORDER BY task_code`, [id]);
    }
  }
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
