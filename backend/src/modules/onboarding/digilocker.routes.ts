/**
 * The older DigiLocker surface, kept mounted and made safe.
 *
 * There are two DigiLocker implementations in this codebase. The live one runs
 * through Luckpay under /api/ats/bgv/digilocker/*, writes
 * `candidate_digilocker_session` (singular, 32 rows) and is confirmed by
 * polling via syncDigilockerStatus. This one writes
 * `candidate_digilocker_sessions` (plural) — a table holding zero rows that
 * nothing else reads.
 *
 * Everything written here was therefore invisible to the BGV report, the
 * onboarding bridge and the candidate's own form. The Settings screen used to
 * advertise this callback as the URL to hand to the provider, so a completed
 * DigiLocker delivered to it would have landed somewhere no report ever looks.
 *
 * The route stays mounted, because it is a public URL and there is no way from
 * here to prove nothing external calls it. What has changed is that it no
 * longer writes to the dead table:
 *
 *   POST /callback  — triggers the real sync, so a provider callback now helps
 *                     instead of vanishing
 *   POST /initiate  — refuses, naming the endpoint that works, rather than
 *                     minting a session nothing will ever read
 *   GET  /status    — reads the table the live flow actually writes
 *
 * Do not reintroduce DigiLockerService here. If this surface is ever retired
 * properly, unmount it in app.ts and delete digilocker.service.ts with it.
 */
import { Router, type Request, type Response, type NextFunction } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";
import { syncDigilockerStatus } from "../integrations/luckpay/luckpay-status.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

/** The live endpoint, named in every response that turns a caller away. */
const LIVE_START_ENDPOINT = "/api/ats/bgv/digilocker/start";

async function candidateIdForToken(token: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT c.id FROM ats_candidate c
       JOIN ats_onboarding_bridge ob ON ob.candidate_id = c.id
      WHERE ob.onboarding_token = ? LIMIT 1`,
    [token],
  );
  return (rows[0]?.id as string) ?? null;
}

/**
 * Resolve the callback's `state` to a candidate.
 *
 * Tried against the provider transaction log first, because that is what
 * syncDigilockerStatus itself reads, then against the live session table.
 */
async function candidateIdForState(state: string): Promise<string | null> {
  const [logRows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id FROM ats_provider_transaction_log
      WHERE client_transaction_id = ? AND service_type = 'digilocker'
      ORDER BY created_at DESC LIMIT 1`,
    [state],
  );
  if (logRows[0]?.candidate_id) return String(logRows[0].candidate_id);

  const [sessionRows] = await db.execute<RowDataPacket[]>(
    `SELECT candidate_id FROM candidate_digilocker_session
      WHERE state_token = ? ORDER BY created_at DESC LIMIT 1`,
    [state],
  );
  return (sessionRows[0]?.candidate_id as string) ?? null;
}

/**
 * POST /api/onboarding/digilocker/initiate
 *
 * Refuses. It used to mint a row in the dead table and hand back an authUrl,
 * so the candidate would complete a DigiLocker journey whose result nothing
 * could see. Failing here is worse for the caller and far better for the
 * candidate.
 */
router.post("/initiate", h(async (_req: any, res: Response) => {
  return res.status(410).json({
    success: false,
    error:
      "This DigiLocker endpoint is retired. It recorded sessions in a table the " +
      "verification flow does not read, so documents fetched through it were never " +
      `visible. Use ${LIVE_START_ENDPOINT} instead.`,
    useInstead: LIVE_START_ENDPOINT,
  });
}));

/**
 * GET /api/onboarding/digilocker/status?token=...
 *
 * Reads the table the live flow writes, so it can no longer report "no session"
 * to a candidate who has in fact already connected.
 */
router.get("/status", h(async (req: any, res: Response) => {
  const token = String(req.query.token ?? "");
  if (!token) return res.status(400).json({ success: false, error: "token required" });

  const candidateId = await candidateIdForToken(token);
  if (!candidateId) return res.status(401).json({ success: false, error: "Invalid onboarding token" });

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id AS sessionId, session_status AS status, auth_url AS authUrl,
            requested_documents_json AS requestedDocuments,
            created_at AS createdAt, expires_at AS expiresAt
       FROM candidate_digilocker_session
      WHERE candidate_id = ? ORDER BY created_at DESC LIMIT 1`,
    [candidateId],
  );

  return res.json({ success: true, data: rows[0] ?? null });
}));

/**
 * POST /api/onboarding/digilocker/callback
 *
 * The provider tells us something happened; we then confirm it ourselves.
 *
 * The body is deliberately not trusted to carry the documents. This route is
 * unauthenticated, and the live flow already establishes state by polling the
 * provider, so the callback's only job is to make that poll happen sooner than
 * the next scheduled one. `documents` is accepted and ignored for
 * compatibility with the previous contract.
 */
router.post("/callback", h(async (req: any, res: Response) => {
  const state = String(req.body?.state ?? "");
  if (!state) return res.status(400).json({ success: false, error: "state required" });

  const candidateId = await candidateIdForState(state);
  if (!candidateId) {
    return res.status(404).json({ success: false, error: "No DigiLocker session matches that state" });
  }

  try {
    const outcome = await syncDigilockerStatus(candidateId);
    return res.json({
      success: true,
      message: "DigiLocker status reconciled with the provider",
      data: { state: outcome.state, changed: outcome.changed ?? false },
    });
  } catch (error) {
    // 502, not 500: the failure is the provider's, and a provider that retries
    // on 5xx is doing the right thing here.
    console.error(`[DigiLocker] callback sync failed for ${candidateId}:`, (error as Error)?.message);
    return res.status(502).json({ success: false, error: "Could not reconcile with the provider" });
  }
}));

/**
 * GET /api/onboarding/digilocker/:sessionId — admin view, live table.
 */
router.get("/:sessionId", h(async (req: any, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id AS sessionId, candidate_id AS candidateId, session_status AS status,
            requested_documents_json AS requestedDocuments,
            returned_documents_json AS returnedDocuments,
            created_at AS createdAt, expires_at AS expiresAt
       FROM candidate_digilocker_session WHERE id = ? LIMIT 1`,
    [req.params.sessionId],
  );

  if (!rows[0]) return res.status(404).json({ success: false, error: "Session not found" });
  return res.json({ success: true, data: rows[0] });
}));

export { router as digiLockerRouter };
