import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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
