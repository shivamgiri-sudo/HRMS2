import { Router, type Request, type Response, type NextFunction } from "express";
import { NameValidationService } from "./name-validation.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/**
 * Validate names across all onboarding sections (token-based)
 * POST /api/onboarding/name-validation/validate
 * Body: { token }
 */
router.post("/validate", h(async (req: any, res: Response) => {
  const { token } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: "token required" });
  }

  try {
    // Get candidate profile data
    const [candidateRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.id, op.employee_name, op.father_husband_name,
              ob.account_holder_name, ob.name_on_cheque
       FROM ats_candidate c
       JOIN ats_onboarding_bridge aob ON aob.candidate_id = c.id
       LEFT JOIN candidate_onboarding_profile op ON op.candidate_id = c.id
       LEFT JOIN candidate_onboarding_bank ob ON ob.candidate_id = c.id
       WHERE aob.onboarding_token = ? LIMIT 1`,
      [token]
    );

    if (!candidateRows || candidateRows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid onboarding token" });
    }

    const row = candidateRows[0] as RowDataPacket;
    const validation = NameValidationService.validateAllNames({
      employee_name: row.employee_name as string | undefined,
      father_husband_name: row.father_husband_name as string | undefined,
      account_holder_name: row.account_holder_name as string | undefined,
      name_on_cheque: row.name_on_cheque as string | undefined,
    });

    // If validation fails, flag for Payroll review
    if (validation.flagForReview) {
      await db.execute(
        `INSERT INTO candidate_payroll_review_flags
         (candidate_id, flag_reason, status)
         VALUES (?, ?, 'pending')
         ON DUPLICATE KEY UPDATE flag_reason = ?, updated_at = NOW()`,
        [row.id, `name_mismatch: ${validation.reviewReason}`, `name_mismatch: ${validation.reviewReason}`]
      );
    }

    res.json({ success: true, data: validation });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

/**
 * Get validation history for candidate (admin view)
 * GET /api/onboarding/name-validation/candidate/:candidateId
 */
router.get("/candidate/:candidateId", h(async (req: any, res: Response) => {
  const { candidateId } = req.params;

  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT flag_reason, status, flagged_at, review_notes, reviewed_by
       FROM candidate_payroll_review_flags
       WHERE candidate_id = ?`,
      [candidateId]
    );

    res.json({ success: true, data: rows || [] });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

export { router as nameValidationRouter };
