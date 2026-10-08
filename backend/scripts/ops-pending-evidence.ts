/**
 * For each Ops Control Tower joiner list, who is still listed although other tables show the step done.
 * READ-ONLY (SELECTs only). Prints employee codes and counts, no personal data.
 *
 *   npx tsx scripts/ops-pending-evidence.ts
 */
import "dotenv/config";
import { db } from "../src/db/mysql.js";
import type { RowDataPacket } from "mysql2";

const W = `e.created_at >= NOW() - INTERVAL 30 DAY AND (e.active_status = 1 OR LOWER(COALESCE(e.employment_status, '')) = 'preboarding')`;
const CLOSED = `'verified','signed_verified','completed','esign_completed','wet_signed_uploaded','waived','not_applicable'`;
const q = async (label: string, sql: string) => {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql);
    console.log(`== ${label}`);
    for (const r of rows as RowDataPacket[]) console.log("ROW\t" + Object.entries(r).map(([k, v]) => `${k}=${v}`).join("\t"));
  } catch (e) { console.log(`== ${label} FAILED: ${(e as Error).message}`); }
};
const PENDING_DOC_PEOPLE = `SELECT DISTINCT e.id FROM employees e JOIN employee_joining_document_checklist c ON c.employee_id = e.id
   WHERE ${W} AND c.mandatory = 1 AND UPPER(COALESCE(c.document_code,'')) NOT IN ('EPF_DECLARATION','EPF_NOMINATION_FORM2')
     AND LOWER(COALESCE(c.status,'')) NOT IN (${CLOSED})`;

(async () => {
  await q("DOCS pending people x kit status", `
    SELECT COALESCE(k.status,'(no kit)') kit, COUNT(*) n FROM (${PENDING_DOC_PEOPLE}) p
      LEFT JOIN employee_joining_esign_kit k ON k.employee_id = p.id GROUP BY kit ORDER BY n DESC`);
  await q("DOCS pending rows: status x document_code x kit signed? (top 40)", `
    SELECT LOWER(COALESCE(c.status,'')) st, c.document_code code, SUM(k.status='signed') kit_signed, COUNT(*) n
      FROM employees e JOIN employee_joining_document_checklist c ON c.employee_id = e.id
      LEFT JOIN employee_joining_esign_kit k ON k.employee_id = e.id
     WHERE ${W} AND c.mandatory = 1 AND UPPER(COALESCE(c.document_code,'')) NOT IN ('EPF_DECLARATION','EPF_NOMINATION_FORM2')
       AND LOWER(COALESCE(c.status,'')) NOT IN (${CLOSED}) GROUP BY st, code ORDER BY n DESC LIMIT 40`);
  await q("DOCS pending people whose kit is signed (codes)", `
    SELECT e.employee_code FROM (${PENDING_DOC_PEOPLE}) p JOIN employees e ON e.id = p.id
      JOIN employee_joining_esign_kit k ON k.employee_id = e.id WHERE k.status = 'signed' LIMIT 100`);
  await q("DOCS pending people with a document uploaded on the checklist row but status not closed (by status)", `
    SELECT LOWER(COALESCE(c.status,'')) st, COUNT(DISTINCT e.id) people FROM employees e JOIN employee_joining_document_checklist c ON c.employee_id = e.id
     WHERE ${W} AND c.mandatory = 1 AND UPPER(COALESCE(c.document_code,'')) NOT IN ('EPF_DECLARATION','EPF_NOMINATION_FORM2')
       AND LOWER(COALESCE(c.status,'')) NOT IN (${CLOSED})
       AND (c.file_url IS NOT NULL OR c.signed_file_url IS NOT NULL) GROUP BY st`);

  await q("BGV pending (not waived): overall_status x checks all verified?", `
    SELECT COALESCE(r.overall_status,'(no report)') st,
           SUM(NOT EXISTS (SELECT 1 FROM candidate_bgv_check c WHERE c.candidate_id=b.candidate_id AND c.check_type IN ('pan','aadhaar','bank','digilocker') AND c.status NOT IN ('verified','waived'))
               AND EXISTS (SELECT 1 FROM candidate_bgv_check c WHERE c.candidate_id=b.candidate_id AND c.check_type IN ('pan','aadhaar'))) core_all_verified,
           COUNT(*) n
      FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id
      LEFT JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
     WHERE ${W} AND (r.overall_status IS NULL OR r.overall_status <> 'clear')
       AND NOT EXISTS (SELECT 1 FROM it_provisioning_request wb WHERE wb.employee_id=e.id AND wb.request_type='join' AND wb.task_code='HR_BGV_INITIATION' AND wb.status='waived')
     GROUP BY st`);
  await q("BGV in_progress with core checks all verified (codes)", `
    SELECT e.employee_code FROM ats_onboarding_bridge b JOIN employees e ON e.id = b.employee_id
      JOIN candidate_bgv_report r ON r.candidate_id = b.candidate_id
     WHERE ${W} AND r.overall_status = 'in_progress'
       AND NOT EXISTS (SELECT 1 FROM candidate_bgv_check c WHERE c.candidate_id=b.candidate_id AND c.check_type IN ('pan','aadhaar','bank','digilocker') AND c.status NOT IN ('verified','waived'))
       AND EXISTS (SELECT 1 FROM candidate_bgv_check c WHERE c.candidate_id=b.candidate_id AND c.check_type IN ('pan','aadhaar'))
       AND NOT EXISTS (SELECT 1 FROM it_provisioning_request wb WHERE wb.employee_id=e.id AND wb.request_type='join' AND wb.task_code='HR_BGV_INITIATION' AND wb.status='waived') LIMIT 100`);

  await q("PROVISIONING pending: role x task x status, oldest days", `
    SELECT ipr.assigned_role role, ipr.task_code task, ipr.status, COUNT(*) n, MAX(DATEDIFF(CURDATE(), e.created_at)) oldest_days
      FROM it_provisioning_request ipr JOIN employees e ON e.id = ipr.employee_id
     WHERE ipr.request_type='join' AND ipr.status IN ('pending','pending_unassigned') AND ${W}
     GROUP BY role, task, ipr.status ORDER BY n DESC LIMIT 40`);
  await q("PROVISIONING pending but employee already has work email / system login evidence", `
    SELECT ipr.task_code task, COUNT(*) n, SUM(COALESCE(e.work_email,'')<>'') has_work_email
      FROM it_provisioning_request ipr JOIN employees e ON e.id = ipr.employee_id
     WHERE ipr.request_type='join' AND ipr.status IN ('pending','pending_unassigned') AND ${W} GROUP BY task ORDER BY n DESC LIMIT 30`);

  await q("APPOINTMENT LETTER listed: letter state", `
    SELECT LOWER(COALESCE(al.employee_esign_status,'(no letter)')) st, COUNT(*) n
      FROM employees e LEFT JOIN appointment_letter_issue al ON al.employee_id = e.id
     WHERE ${W} AND NOT EXISTS (SELECT 1 FROM it_provisioning_request wt WHERE wt.employee_id=e.id AND wt.request_type='join'
            AND wt.task_code='APPOINTMENT_LETTER_ESIGN' AND wt.status IN ('waived','confirmed','actioned'))
       AND LOWER(COALESCE(al.employee_esign_status,'')) NOT IN ('signed','esigned','completed') GROUP BY st ORDER BY n DESC`);
  await q("ESIGN listed (bridge not done) x kit status", `
    SELECT COALESCE(k.status,'(no kit)') kit, COUNT(*) n FROM ats_onboarding_bridge b JOIN employees e ON e.id=b.employee_id
      LEFT JOIN employee_joining_esign_kit k ON k.employee_id=e.id
     WHERE ${W} AND COALESCE(b.joining_document_completion_pct,0) < 100 AND LOWER(COALESCE(b.joining_document_status,'')) NOT IN ('completed','signed','all_signed')
       AND NOT EXISTS (SELECT 1 FROM employee_joining_esign_kit ek WHERE ek.employee_id=e.id AND ek.status='signed') GROUP BY kit ORDER BY n DESC`);
  const cat = (c: string) => `(EXISTS (SELECT 1 FROM candidate_bgv_check k WHERE k.candidate_id=b.candidate_id AND k.check_type='${c}' AND k.status IN ('verified','waived')) OR r.${c}_status = 'passed')`;
  await q("BGV in_progress with core verified: which categories are NOT clear", `
    SELECT r.locked locked,
           NOT ${cat("education")} edu_open, NOT ${cat("address")} addr_open, NOT ${cat("employment")} emp_open, NOT ${cat("criminal")} crim_open, COUNT(*) n
      FROM ats_onboarding_bridge b JOIN employees e ON e.id=b.employee_id JOIN candidate_bgv_report r ON r.candidate_id=b.candidate_id
     WHERE ${W} AND r.overall_status='in_progress'
       AND NOT EXISTS (SELECT 1 FROM candidate_bgv_check c WHERE c.candidate_id=b.candidate_id AND c.check_type IN ('pan','aadhaar','bank','digilocker') AND c.status NOT IN ('verified','waived'))
     GROUP BY locked, edu_open, addr_open, emp_open, crim_open ORDER BY n DESC`);
  await q("BGV in_progress: education/address/employment status values on report", `
    SELECT COALESCE(r.education_status,'-') edu, COALESCE(r.address_status,'-') addr, COUNT(*) n
      FROM ats_onboarding_bridge b JOIN employees e ON e.id=b.employee_id JOIN candidate_bgv_report r ON r.candidate_id=b.candidate_id
     WHERE ${W} AND r.overall_status='in_progress' GROUP BY edu, addr ORDER BY n DESC LIMIT 20`);
  await q("BGV in_progress: candidates whose address check says verified/passed or education passed yet not clear (codes)", `
    SELECT e.employee_code FROM ats_onboarding_bridge b JOIN employees e ON e.id=b.employee_id JOIN candidate_bgv_report r ON r.candidate_id=b.candidate_id
     WHERE ${W} AND r.overall_status='in_progress' AND ${cat("education")} AND ${cat("address")} LIMIT 60`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
