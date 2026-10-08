/**
 * Are the Ops Control Tower's joiner lists showing people as pending who already finished? READ-ONLY.
 *
 * For each nudged list (the daily WhatsApp reminder reads the same lists), prints the distribution of the
 * status values that keep a joiner on it and the counts with completion evidence elsewhere. Counts only.
 *
 *   npx tsx scripts/ops-pending-audit.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const W = `e.created_at >= NOW() - INTERVAL 30 DAY AND (e.active_status = 1 OR LOWER(COALESCE(e.employment_status, '')) = 'preboarding')`;
const q = async (label: string, sql: string) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    console.log(`== ${label}`);
    for (const r of rows as RowDataPacket[]) console.log("ROW\t" + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("\t"));
  } catch (e) { console.log(`== ${label} FAILED: ${(e as Error).message}`); }
};

(async () => {
  await q("eSign: bridge status x pct among recent joiners", `
    SELECT LOWER(COALESCE(b.joining_document_status,'(null)')) st, CASE WHEN COALESCE(b.joining_document_completion_pct,0) >= 100 THEN '100' WHEN COALESCE(b.joining_document_completion_pct,0) > 0 THEN 'partial' ELSE '0' END pct, COUNT(*) n
      FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id WHERE ${W} GROUP BY st, pct ORDER BY n DESC`);
  await q("eSign: kit status among recent joiners", `
    SELECT COALESCE(k.status,'(no kit)') st, COUNT(DISTINCT e.id) n FROM employees e LEFT JOIN employee_joining_esign_kit k ON k.employee_id = e.id WHERE ${W} GROUP BY st ORDER BY n DESC`);
  await q("eSign: listed pending but every mandatory checklist row closed", `
    SELECT COUNT(*) n FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id
     WHERE ${W} AND COALESCE(b.joining_document_completion_pct,0) < 100
       AND LOWER(COALESCE(b.joining_document_status,'')) NOT IN ('completed','signed','all_signed')
       AND NOT EXISTS (SELECT 1 FROM employee_joining_esign_kit k WHERE k.employee_id = e.id AND k.status = 'signed')
       AND EXISTS (SELECT 1 FROM employee_joining_document_checklist c WHERE c.employee_id = e.id)
       AND NOT EXISTS (SELECT 1 FROM employee_joining_document_checklist c WHERE c.employee_id = e.id AND c.mandatory = 1
                        AND LOWER(COALESCE(c.status,'')) NOT IN ('verified','signed_verified','completed','esign_completed','wet_signed_uploaded','waived','not_applicable'))`);
  await q("Appointment letter: employee_esign_status among recent joiners", `
    SELECT LOWER(COALESCE(al.employee_esign_status,'(no letter)')) st, SUM(al.employee_esign_at IS NOT NULL) with_signed_at, COUNT(*) n
      FROM employees e LEFT JOIN appointment_letter_issue al ON al.employee_id = e.id WHERE ${W} GROUP BY st ORDER BY n DESC`);
  await q("BGV: overall_status among recent joiners (not waived)", `
    SELECT COALESCE(r.overall_status,'(no report)') st, COUNT(*) n FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id
      LEFT JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
     WHERE ${W} AND NOT EXISTS (SELECT 1 FROM it_provisioning_request wb WHERE wb.employee_id = e.id AND wb.request_type='join' AND wb.task_code='HR_BGV_INITIATION' AND wb.status='waived')
     GROUP BY st ORDER BY n DESC`);
  await q("BGV: per check status for joiners not yet clear", `
    SELECT c.check_type, c.status, COUNT(DISTINCT b.employee_id) n FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id
      LEFT JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
      JOIN candidate_bgv_check c ON c.candidate_id = b.candidate_id
     WHERE ${W} AND (r.overall_status IS NULL OR r.overall_status <> 'clear') GROUP BY c.check_type, c.status ORDER BY c.check_type, n DESC`);
  await q("Docs: open mandatory checklist rows by status (EPF forms excluded)", `
    SELECT LOWER(COALESCE(c.status,'(null)')) st, COUNT(*) rows_n, COUNT(DISTINCT e.id) people FROM employees e JOIN employee_joining_document_checklist c ON c.employee_id = e.id
     WHERE ${W} AND c.mandatory = 1 AND UPPER(COALESCE(c.document_code,'')) NOT IN ('EPF_DECLARATION','EPF_NOMINATION_FORM2')
       AND LOWER(COALESCE(c.status,'')) NOT IN ('verified','signed_verified','completed','esign_completed','wet_signed_uploaded','waived','not_applicable')
     GROUP BY st ORDER BY rows_n DESC`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
