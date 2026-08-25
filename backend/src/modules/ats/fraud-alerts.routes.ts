import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { detectFaceBbox } from "./face-match.service.js";
import { resolveOnboardingDocumentFile } from "./onboardingDocumentPath.js";
import { recalculateNameMatch } from "./name-consistency.routes.js";

const router = Router();

router.get("/", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (req: AuthenticatedRequest, res: Response) => {
  const status = req.query.status as string || "open";
  const offset = Math.max(0, parseInt(String(req.query.offset ?? "0"), 10) || 0);
  const whereClause = status === "all" ? "" : "WHERE fa.status = ?";
  const params: unknown[] = status === "all" ? [offset] : [status, offset];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT fa.*, c.full_name AS candidate_name, c.applied_for_branch, c.applied_for_process,
            mc.full_name AS matched_candidate_name
       FROM candidate_fraud_alert fa
       JOIN ats_candidate c ON c.id = fa.candidate_id
       LEFT JOIN ats_candidate mc ON mc.id = fa.matched_candidate_id
      ${whereClause}
      ORDER BY fa.created_at DESC
      LIMIT 100 OFFSET ?`,
    params
  );
  res.json({ alerts: rows, offset });
});

router.get("/candidate/:candidateId", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_fraud_alert WHERE candidate_id = ? ORDER BY created_at DESC`,
    [req.params.candidateId]
  );
  res.json({ alerts: rows });
});

router.patch("/:alertId/review", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (req: AuthenticatedRequest, res: Response) => {
  // Clearing an alert is what unblocks employee creation
  // (validateNoOpenFraudAlerts in the creation orchestrator refuses while any
  // critical or high alert is still open), so the reason is not optional. A
  // free-text-only trail cannot be counted, and the whole point of reviewing
  // these is learning which variances are genuine.
  const { status, notes } = req.body;
  const validStatuses = ["under_review", "resolved_fraud", "resolved_false_positive", "dismissed"];
  if (!validStatuses.includes(status)) {
    return res.status(400).json({ error: "Invalid status" });
  }
  if (status !== "under_review" && !String(notes ?? "").trim()) {
    return res.status(400).json({
      error: "A reason is required to resolve or dismiss a fraud alert, because doing so allows the employee record to be created.",
    });
  }
  await db.execute(
    `UPDATE candidate_fraud_alert SET status = ?, review_notes = ?, reviewed_by = ?, reviewed_at = NOW() WHERE id = ?`,
    [status, notes ?? null, req.authUser?.id ?? null, req.params.alertId]
  );
  res.json({ success: true });
});

router.get("/stats", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (_req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT alert_type, status, COUNT(*) as count FROM candidate_fraud_alert GROUP BY alert_type, status`
  );
  res.json({ stats: rows });
});

// Full fraud comparison payload for a single candidate — used in HR Profile Approval
// and the Fraud Alert Review page to show face grid, name table, and document numbers.
router.get("/candidate/:candidateId/comparison", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (req: AuthenticatedRequest, res: Response) => {
  const { candidateId } = req.params;
  try {

  // Trigger a name-match recalculation before reading the summary/detail
  // tables, but only when nothing has run yet — this endpoint is hit on
  // every profile-review page load, and recalculating unconditionally would
  // do real writes (DELETE + re-INSERT of detail rows) on each one. A
  // failure here must not break the rest of the comparison payload, so it is
  // logged and swallowed rather than propagated.
  try {
    const [existingSummary] = await db.execute<RowDataPacket[]>(
      `SELECT last_calculated_at FROM candidate_name_match_summary WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    const row = existingSummary[0];
    if (!row || row.last_calculated_at == null) {
      await recalculateNameMatch(candidateId);
    }
  } catch (recalcErr: unknown) {
    console.error(
      "[fraud-alerts/comparison] name-match recalculation failed for",
      candidateId,
      recalcErr instanceof Error ? recalcErr.message : recalcErr
    );
  }

  const [[alerts], [faceMatches], [docs], [profileRows], [bgvNames], [nameSummaryRows], [nameDetails], [bankPennyRows]] = await Promise.all([
    db.execute<RowDataPacket[]>(
      // matched_candidate_name joined in (same as the GET / list endpoint) so
      // the comparison panel can show which candidate a duplicate-identity
      // alert matched against, not just the raw matched_candidate_id.
      `SELECT fa.*, mc.full_name AS matched_candidate_name
         FROM candidate_fraud_alert fa
         LEFT JOIN ats_candidate mc ON mc.id = fa.matched_candidate_id
        WHERE fa.candidate_id = ?
        ORDER BY fa.created_at DESC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT cfm.*,
              pd.doc_type AS photo_doc_type, pd.file_path AS photo_file_path,
              id_doc.doc_type AS id_doc_type, id_doc.file_path AS id_file_path,
              id_doc.ocr_extracted_name AS id_ocr_name
         FROM candidate_face_match cfm
         LEFT JOIN candidate_onboarding_document pd     ON pd.id     = cfm.photo_document_id
         LEFT JOIN candidate_onboarding_document id_doc ON id_doc.id = cfm.id_document_id
        WHERE cfm.candidate_id = ?
        ORDER BY cfm.created_at DESC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT id, doc_type, document_status, uploaded_at
         FROM candidate_onboarding_document
        WHERE candidate_id = ? AND deleted_at IS NULL
        ORDER BY uploaded_at ASC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      // aadhaar_number_masked on candidate_onboarding_profile is blank whenever
      // the candidate never completed that onboarding step. When it is blank,
      // fall back to the raw Aadhaar captured on ats_candidate at application
      // time, masked here the same way ats.onboarding.service.ts's maskAadhaar()
      // masks it (XXXX-XXXX-<last4>) so no more digits reach the client than the
      // profile's own masked column would ever expose.
      `SELECT p.employee_name, p.pan_number_masked,
              COALESCE(NULLIF(p.aadhaar_number_masked, ''),
                       CASE WHEN c.aadhar_number IS NOT NULL AND c.aadhar_number <> ''
                            THEN CONCAT('XXXX-XXXX-', RIGHT(c.aadhar_number, 4))
                            ELSE NULL END) AS aadhaar_number_masked
         FROM ats_candidate c
         LEFT JOIN candidate_onboarding_profile p ON p.candidate_id = c.id
        WHERE c.id = ? LIMIT 1`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT check_type, matched_name, status, verified_at
         FROM candidate_bgv_check
        WHERE candidate_id = ? AND check_type IN ('aadhaar','aadhaar_offline','pan','bank_account')
        ORDER BY updated_at DESC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT * FROM candidate_name_match_summary WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT source_type, source_name, match_score, is_match, checked_at
         FROM candidate_name_match_detail WHERE candidate_id = ? ORDER BY checked_at DESC`,
      [candidateId]
    ),
    db.execute<RowDataPacket[]>(
      `SELECT account_holder_name AS entered_name, account_name AS bank_name,
              name_match_score, status
         FROM onboarding_penny_drop_requests
        WHERE candidate_id = ? ORDER BY initiated_at DESC LIMIT 1`,
      [candidateId]
    ),
  ]);

  res.json({
    alerts,
    faceMatches,
    docs,
    profile: profileRows[0] ?? null,
    bgvNames,
    nameSummary: nameSummaryRows[0] ?? null,
    nameDetails,
    bankPennyDrop: bankPennyRows[0] ?? null,
  });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[fraud-alerts/comparison]", msg);
    res.status(500).json({ error: "Could not load comparison data", detail: msg });
  }
});

// Returns the detected face bounding box for a document image.
// The frontend uses these coordinates to crop and vertically align faces
// in the comparison grid regardless of document orientation.
router.get("/documents/face-detect/:documentId", requireAuth, requireRole("super_admin", "admin", "hr", "payroll_hr", "payroll_head"), async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { documentId } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT file_path, mime_type FROM candidate_onboarding_document WHERE id = ? LIMIT 1`,
      [documentId]
    );
    const doc = rows[0];
    if (!doc) return res.status(404).json({ error: "Document not found" });

    const resolvedPath = resolveOnboardingDocumentFile(doc.file_path);
    if (!resolvedPath) return res.json({ bbox: null });
    const bbox = await detectFaceBbox(resolvedPath).catch(() => null);
    res.json({ bbox });
  } catch (err: unknown) {
    res.json({ bbox: null });
  }
});

export default router;
