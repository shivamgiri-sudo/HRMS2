import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);
router.use(requireAuth);

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Normalize a name: uppercase, strip common titles, collapse whitespace */
function normalizeName(name: string): string {
  return (name || "")
    .toUpperCase()
    .replace(/\b(MR|MRS|MS|DR|SHRI|SMT)\.?\s*/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Token-overlap Jaccard similarity as a 0–100 score */
function nameMatchScore(a: string, b: string): number {
  if (!a || !b) return 0;
  const na = normalizeName(a);
  const nb = normalizeName(b);
  if (na === nb) return 100;
  const ta = new Set(na.split(" "));
  const tb = new Set(nb.split(" "));
  const intersect = [...ta].filter((w) => tb.has(w)).length;
  const union = new Set([...ta, ...tb]).size;
  return Math.round((intersect / union) * 100);
}

// ── Routes ────────────────────────────────────────────────────────────────────

// POST /:candidateId/recalculate — recalculate name match for a candidate
router.post("/:candidateId/recalculate", h(async (req: AuthenticatedRequest, res: any) => {
  const { candidateId } = req.params;

  const [profile] = await db.execute<RowDataPacket[]>(
    `SELECT cop.employee_name,
            ac.full_name AS ats_name, ac.aadhar_name, ac.pan_name
     FROM candidate_onboarding_profile cop
     LEFT JOIN ats_candidate ac ON ac.id = cop.candidate_id
     WHERE cop.candidate_id = ?
     LIMIT 1`,
    [candidateId]
  );

  const [bank] = await db.execute<RowDataPacket[]>(
    `SELECT account_holder_name
     FROM candidate_onboarding_bank_detail
     WHERE candidate_id = ?
     LIMIT 1`,
    [candidateId]
  );

  if (!profile.length) {
    return res.status(404).json({ success: false, message: "Candidate not found" });
  }

  const p = profile[0] as any;
  const b = bank[0] as any;
  const formName = p.employee_name || p.ats_name || "";

  const sources = [
    { type: "form", name: formName },
    { type: "aadhaar", name: p.aadhar_name || "" },
    { type: "pan", name: p.pan_name || "" },
    { type: "bank", name: b?.account_holder_name || "" },
  ].filter((s) => s.name);

  // Delete existing detail rows, then recalculate fresh
  await db.execute(
    `DELETE FROM candidate_name_match_detail WHERE candidate_id = ?`,
    [candidateId]
  );

  const mismatches: string[] = [];
  for (const src of sources) {
    const score = nameMatchScore(formName, src.name);
    const isMatch = score >= 80;
    if (!isMatch && src.type !== "form") mismatches.push(src.type);
    await db.execute(
      `INSERT INTO candidate_name_match_detail
         (id, candidate_id, source_type, source_name, normalized_name, match_score, is_match)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?)`,
      [candidateId, src.type, src.name, normalizeName(src.name), score, isMatch ? 1 : 0]
    );
  }

  const overallStatus =
    mismatches.length === 0 ? "matched"
    : mismatches.length <= 1 ? "partial"
    : "mismatch";

  await db.execute(
    `INSERT INTO candidate_name_match_summary
       (id, candidate_id, overall_status, mismatch_sources, last_calculated_at, blocks_employee_code)
     VALUES (UUID(), ?, ?, ?, NOW(), ?)
     ON DUPLICATE KEY UPDATE
       overall_status = VALUES(overall_status),
       mismatch_sources = VALUES(mismatch_sources),
       last_calculated_at = NOW(),
       blocks_employee_code = VALUES(blocks_employee_code)`,
    [candidateId, overallStatus, JSON.stringify(mismatches), mismatches.length > 0 ? 1 : 0]
  );

  return res.json({
    success: true,
    data: { candidateId, overallStatus, mismatches, sourcesChecked: sources.length },
  });
}));

// GET / — list all candidates with name mismatches
router.get(
  "/",
  requireRole("admin", "hr", "recruiter"),
  h(async (_req: any, res: any) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cnms.*, ac.full_name, ac.candidate_code
       FROM candidate_name_match_summary cnms
       JOIN ats_candidate ac ON ac.id = cnms.candidate_id
       WHERE cnms.overall_status != 'matched'
       ORDER BY cnms.last_calculated_at DESC
       LIMIT 200`
    );
    return res.json({ success: true, data: rows });
  })
);

// GET /:candidateId — get name match summary and detail for a candidate
router.get("/:candidateId", h(async (req: AuthenticatedRequest, res: any) => {
  const [summary] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_name_match_summary WHERE candidate_id = ? LIMIT 1`,
    [req.params.candidateId]
  );
  const [details] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM candidate_name_match_detail WHERE candidate_id = ? ORDER BY checked_at DESC`,
    [req.params.candidateId]
  );
  return res.json({ success: true, data: { summary: summary[0] ?? null, details } });
}));

// POST /:candidateId/override-request — HR approves a name mismatch override
router.post(
  "/:candidateId/override-request",
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { reason } = req.body as { reason?: string };
    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: "reason is required" });
    }

    await db.execute(
      `UPDATE candidate_name_match_summary
       SET is_override_approved = 1,
           override_reason = ?,
           override_by = ?,
           override_at = NOW(),
           blocks_employee_code = 0
       WHERE candidate_id = ?`,
      [reason, req.authUser!.id, req.params.candidateId]
    );

    await db.execute(
      `INSERT INTO candidate_name_override_audit
         (id, candidate_id, override_type, reason, approved_by, previous_status, new_status)
       SELECT UUID(), candidate_id, 'hr_override', ?, ?, overall_status, 'override_approved'
       FROM candidate_name_match_summary
       WHERE candidate_id = ?`,
      [reason, req.authUser!.id, req.params.candidateId]
    );

    return res.json({ success: true });
  })
);

export { router as nameConsistencyRouter };
