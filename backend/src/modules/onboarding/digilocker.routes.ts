import { Router, type Request, type Response, type NextFunction } from "express";
import { DigiLockerService } from "./digilocker.service.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

// Requested documents in DigiLocker session
const REQUESTED_DOCS = ["aadhaar", "driving_license", "passport", "pan_card"];

/**
 * Initiate DigiLocker session (token-based for onboarding)
 * POST /api/onboarding/digilocker/initiate
 * Body: { token, requestedDocuments? }
 */
router.post("/initiate", h(async (req: any, res: Response) => {
  const { token, requestedDocuments = REQUESTED_DOCS } = req.body;

  if (!token) {
    return res.status(400).json({ success: false, error: "token required" });
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
    const session = await DigiLockerService.initiateSession(
      candidateId,
      requestedDocuments
    );

    res.json({
      success: true,
      data: {
        sessionId: session.sessionId,
        authUrl: session.authUrl,
        requestedDocuments: session.requestedDocuments,
        message: "DigiLocker session initiated. Redirect to authUrl for document authorization.",
      },
    });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

/**
 * Get DigiLocker session status
 * GET /api/onboarding/digilocker/status?token=...
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
    const session = await DigiLockerService.getActiveSession(candidateId);

    res.json({ success: true, data: session });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

/**
 * DigiLocker callback: document(s) authorized and received
 * POST /api/onboarding/digilocker/callback
 * Called by DigiLocker via BGV provider integration
 * Body: { state, documents: {...} }
 */
router.post("/callback", h(async (req: any, res: Response) => {
  const { state, documents } = req.body;

  if (!state || !documents) {
    return res.status(400).json({
      success: false,
      error: "state and documents required",
    });
  }

  try {
    await DigiLockerService.recordDocumentsReceived(state, documents);
    res.json({
      success: true,
      message: "DigiLocker documents recorded",
    });
  } catch (e: any) {
    res.status(400).json({ success: false, error: String(e) });
  }
}));

/**
 * Get DigiLocker session (by session ID, admin view)
 * GET /api/onboarding/digilocker/:sessionId
 */
router.get("/:sessionId", h(async (req: any, res: Response) => {
  const { sessionId } = req.params;

  try {
    const session = await DigiLockerService.getSessionStatus(sessionId);

    if (!session) {
      return res.status(404).json({ success: false, error: "Session not found" });
    }

    res.json({ success: true, data: session });
  } catch (e: any) {
    res.status(500).json({ success: false, error: String(e) });
  }
}));

export { router as digiLockerRouter };
