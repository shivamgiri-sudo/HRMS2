import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

/**
 * "ESI can still apply to this employee" — the part of the ESI-registration population
 * that the `esi_eligible` flag alone gets wrong.
 *
 * Why the flag is not enough (found 2026-10-08, MAS63459): employee_statutory_info.esi_eligible
 * is written as 1 for EVERY new employee (employee-creation-orchestrator hard-codes it) and the
 * ATS offer defaults it to 1 when the field is omitted. So a joiner on a ₹5.4 lakh CTC, whose own
 * offer carries esic_employee = 0, was queued for ESI registration.
 *
 * Two exclusions, both uses the data payroll itself honours:
 *   1. an APPROVED `esic_opt_out` in employee_statutory_override (same table the payroll
 *      applicability resolver reads);
 *   2. salary clearly above the ESI wage ceiling. Only CTC is reliably stored per employee
 *      (employee_salary_assignment.ctc_annual, else the joining snapshot's ctc_offered), and CTC
 *      exceeds gross by employer PF/ESI/bonus/gratuity (up to roughly a third). So the cut is
 *      ceiling x 1.35 on monthly CTC: above it, gross cannot be under the ceiling; inside the
 *      band the person stays listed rather than being wrongly hidden. Ceiling comes from
 *      statutory_config.esic_wage_limit (default 21000), as payroll reads it.
 *
 * Expects the employees table aliased `e`. No parameters.
 */
export const ESI_STILL_APPLICABLE_SQL = `
  NOT EXISTS (
    SELECT 1 FROM employee_statutory_override eso
     WHERE eso.employee_id = e.id AND eso.override_type = 'esic_opt_out' AND eso.status = 'approved')
  AND COALESCE(
        (SELECT esa.ctc_annual FROM employee_salary_assignment esa
          WHERE esa.employee_id = e.id AND esa.active_status = 1
          ORDER BY esa.effective_from DESC, esa.created_at DESC LIMIT 1),
        (SELECT ss.ctc_offered FROM employee_salary_snapshot ss
          WHERE ss.employee_id = e.id ORDER BY ss.effective_date DESC LIMIT 1),
        0) / 12
      <= 1.35 * (SELECT COALESCE(MAX(sc.config_value), 21000) FROM statutory_config sc
                  WHERE LOWER(sc.config_key) = 'esic_wage_limit' AND sc.is_active = 1)`;

/**
 * The ESI-registration pendency query, shared by the ESI screen and the reminder
 * emails so "missing" means exactly the same thing in both. Rows carry the readiness
 * flags (pan, photo, bank, passbook) the screen renders.
 *
 * `whereClause` and `params` come from the caller (population filter, branch scope,
 * search); limit/offset are coerced to bounded integers by the caller because LIMIT
 * cannot be a bound parameter in a prepared statement.
 */
export async function fetchEsiPendingRows(args: {
  whereClause: string;
  params: unknown[];
  safeLimit: number;
  safeOffset: number;
}): Promise<RowDataPacket[]> {
  const { whereClause, params, safeLimit, safeOffset } = args;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
         e.id                                              AS employee_id,
         e.employee_code,
         e.employee_code                                   AS emp_code,
         CONCAT(e.first_name, ' ', COALESCE(e.last_name,'')) AS name,
         COALESCE(b.branch_name, '')                       AS branch,
         e.esic_number,
         -- PAN is "available" when ANY of three sources has it:
         -- 1. pan_number directly on employees (direct HR entry)
         -- 2. employee_documents with doc_category='pan' (uploaded via profile)
         -- 3. candidate_onboarding_document via ATS bridge (most common path:
         --    38 of 567 ESI-eligible employees have it here, 0 in source 2)
         (
           (e.pan_number IS NOT NULL AND e.pan_number != '')
           OR (SELECT COUNT(*) FROM employee_documents ed
               WHERE ed.employee_id = e.id
                 AND (ed.doc_category = 'pan' OR LOWER(ed.doc_type) IN ('pan','pan card','pan_card'))) > 0
           OR EXISTS (
               SELECT 1 FROM candidate_onboarding_document d
               JOIN ats_onboarding_bridge ab ON ab.candidate_id = d.candidate_id
               WHERE ab.employee_id = e.id AND d.deleted_at IS NULL
                 AND LOWER(d.doc_type) IN ('pan', 'pan card', 'pan_card')
           )
         )                                                AS pan_ready,
         (SELECT id FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_doc_id,
         (SELECT file_url FROM employee_documents ed
          WHERE ed.employee_id = e.id
            AND ed.doc_category = 'pan'
          ORDER BY ed.created_at DESC LIMIT 1)            AS pan_file_url,
         -- Aadhaar is mandatory for ESI registration (it is in the ZIP pack) but was not
         -- tracked on this screen. Sources match the pack's own lookup: a typed employee
         -- document (category 'aadhaar' or an Aadhaar doc_type spelling) or the candidate's
         -- own onboarding upload.
         (
           EXISTS (SELECT 1 FROM employee_documents ed
                    WHERE ed.employee_id = e.id
                      AND (ed.doc_category = 'aadhaar'
                           OR LOWER(ed.doc_type) IN ('aadhaar','aadhaar card','aadhaar_card','aadhar')))
           OR EXISTS (SELECT 1 FROM candidate_onboarding_document d
                        JOIN ats_onboarding_bridge ab ON ab.candidate_id = d.candidate_id
                       WHERE ab.employee_id = e.id AND d.deleted_at IS NULL
                         AND LOWER(d.doc_type) IN ('aadhaar','aadhaar_card','aadhar'))
         )                                                 AS aadhaar_ready,
         (e.photo_url IS NOT NULL OR e.avatar_url IS NOT NULL) AS photo_ready,
         COALESCE(e.photo_url, e.avatar_url)              AS photo_url,
         (SELECT COUNT(*) FROM employee_bank_detail ebd
          WHERE ebd.employee_id = e.id
            AND ebd.ifsc_code IS NOT NULL AND ebd.ifsc_code != '') > 0
                                                          AS bank_ready,
         COALESCE(
           (SELECT file_url FROM employee_documents ed
            WHERE ed.employee_id = e.id
              AND (ed.doc_category = 'bank' AND ed.doc_type = 'bank_passbook'
                   OR LOWER(ed.doc_type) IN ('bank passbook','passbook','cancelled cheque','cancelled_cheque'))
            ORDER BY ed.created_at DESC LIMIT 1),
           (SELECT CONCAT('/api/files/candidate/', d.id)
            FROM candidate_onboarding_document d
            JOIN ats_onboarding_bridge ab ON ab.candidate_id = d.candidate_id
            WHERE ab.employee_id = e.id AND d.deleted_at IS NULL
              AND LOWER(d.doc_type) IN ('bank passbook','cancelled cheque','cancelled_cheque')
            ORDER BY d.uploaded_at DESC LIMIT 1)
         )                                                AS bank_passbook_url
       FROM employees e
       LEFT JOIN employee_statutory_info esi ON esi.employee_id = e.id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       WHERE ${whereClause}
       ORDER BY e.employee_code
       LIMIT ${safeLimit} OFFSET ${safeOffset}`,
    params as any[],
  );
  return rows as RowDataPacket[];
}
