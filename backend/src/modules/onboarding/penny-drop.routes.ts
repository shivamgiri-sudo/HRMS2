import { Router, type Request, type Response, type NextFunction } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { PennyDropService } from "./penny-drop.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// ── Candidate endpoints (token-based for onboarding flow) ──

/**
 * Initiate penny drop for candidate bank account
 * POST /api/onboarding/penny-drop/initiate
 * Body: { token, accountNo, ifscCode, accountHolderName }
 */
router.post("/initiate", h(async (req: any, res: Response) => {
  const { token, accountNo, ifscCode, accountHolderName } = req.body;

  if (!token || !accountNo || !ifscCode || !accountHolderName) {
    return res.status(400).json({
      success: false,
      error: "token, accountNo, ifscCode, accountHolderName required",
    });
  }

  try {
    // Get candidate from token
    const [candidateRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.id FROM ats_candidate c
       JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       WHERE ob.onboarding_token = ? LIMIT 1`,
      [token]
    );

    if (!candidateRows || candidateRows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid onboarding token" });
    }

    const candidateId = (candidateRows[0] as RowDataPacket).id as string;
    const result = await PennyDropService.initiatePennyDrop(
      candidateId,
      accountNo.replace(/\s/g, ""),
      ifscCode.trim().toUpperCase(),
      accountHolderName
    );

    res.json({
      success: true,
      data: {
        requestId: result.requestId,
        message: "Penny drop initiated. Check your bank account for ₹1 debit + verification code.",
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

/**
 * Get penny drop status for candidate
 * GET /api/onboarding/penny-drop/status?token=...
 */
router.get("/status", h(async (req: any, res: Response) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).json({ success: false, error: "token required" });
  }

  try {
    const [candidateRows] = await db.execute<RowDataPacket[]>(
      `SELECT c.id FROM ats_candidate c
       JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
       WHERE ob.onboarding_token = ? LIMIT 1`,
      [token]
    );

    if (!candidateRows || candidateRows.length === 0) {
      return res.status(401).json({ success: false, error: "Invalid onboarding token" });
    }

    const candidateId = (candidateRows[0] as RowDataPacket).id as string;
    const status = await PennyDropService.getPennyDropStatus(candidateId);

    res.json({ success: true, data: status });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

// ── Integration Hub webhook callback ──

/**
 * Webhook: penny drop result from external provider
 * POST /api/onboarding/penny-drop/webhook
 * Body: { requestId, transactionId, status, accountName, verificationCode, responseCode, message }
 * Auth: Signature verification (HMAC-SHA256 with integration secret)
 */
router.post("/webhook", h(async (req: any, res: Response) => {
  const { requestId, transactionId, status, accountName, verificationCode, responseCode, message } = req.body;

  // TODO: Verify HMAC signature from Integration Hub
  // const signature = req.get("X-Penny-Drop-Signature");
  // if (!verifySignature(JSON.stringify(req.body), signature, PENNY_DROP_SECRET)) {
  //   return res.status(401).json({ success: false, error: "Invalid signature" });
  // }

  if (!requestId || !transactionId || !status || !responseCode) {
    return res.status(400).json({
      success: false,
      error: "requestId, transactionId, status, responseCode required",
    });
  }

  try {
    const result = await PennyDropService.recordPennyDropResult(requestId, {
      transactionId,
      status: status as any,
      accountName,
      verificationCode,
      responseCode,
      message,
    });

    res.json({
      success: true,
      data: result,
      message: "Penny drop result recorded",
    });
  } catch (e: any) {
    res.status(400).json({ success: false, error: String(e) });
  }
}));

// ── HR/Admin endpoints ──

/**
 * Get penny drop history for candidate (admin view)
 * GET /api/onboarding/penny-drop/candidate/:candidateId
 */
router.get(
  "/candidate/:candidateId",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { candidateId } = req.params;

    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT request_id, transaction_id, status, account_no, ifsc_code,
                account_holder_name, account_name, name_match_score, response_code,
                message, initiated_at, completed_at
         FROM onboarding_penny_drop_requests
         WHERE candidate_id = ?
         ORDER BY initiated_at DESC
         LIMIT 10`,
        [candidateId]
      );

      res.json({ success: true, data: rows || [] });
    } catch (e: any) {
      res.status(500).json({ success: false, error: String(e) });
    }
  })
);

export { router as pennyDropRouter };
