import { Router, Request, Response, NextFunction } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  sendOnboardingToken, validateToken, submitProfile,
  listOnboardingRequests, saveOffer,
  listPendingApprovals, approveOffer, rejectOffer,
} from './ats.onboarding.service.js';
import { calculateSalary } from './salary.calculator.js';
import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2';

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) =>
    (fn as (req: Request, res: Response) => Promise<void>)(req, res).catch(next);

// ── Public ────────────────────────────────────────────────────────────────────

router.get('/validate-token', h(async (req, res) => {
  const token = String(req.query.token ?? '');
  if (!token) { res.status(400).json({ error: 'token required' }); return; }
  const data = await validateToken(token);
  res.json({ ok: true, data });
}));

router.post('/submit-profile', h(async (req, res) => {
  const { token, ...profile } = req.body;
  if (!token) { res.status(400).json({ error: 'token required' }); return; }
  const result = await submitProfile(token, profile);
  res.json({ ok: true, ...result });
}));

// ── HR ────────────────────────────────────────────────────────────────────────

router.post(
  '/send-token/:candidateId',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await sendOnboardingToken(req.params!.candidateId, req.authUser!.id);
    res.json({ ok: true, ...result });
  }),
);

router.get(
  '/requests',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    // branch_id filtering can be added once it is exposed on authUser;
    // for now, HR admin sees all requests across branches.
    const rows = await listOnboardingRequests(undefined);
    res.json({ ok: true, data: rows });
  }),
);

router.post(
  '/calculate-salary',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin'),
  h(async (req, res) => {
    const { ctc, bandCode, isMetro } = req.body;
    if (!ctc || !bandCode) { res.status(400).json({ error: 'ctc and bandCode required' }); return; }
    const [bands] = await db.execute<RowDataPacket[]>(
      `SELECT basic_pct, hra_pct FROM salary_band_master WHERE band_code = ?`, [bandCode],
    );
    const band = (bands as RowDataPacket[])[0] ?? { basic_pct: 40, hra_pct: 40 };
    const components = calculateSalary(Number(ctc), Number(band.basic_pct), Number(band.hra_pct), Boolean(isMetro));
    res.json({ ok: true, components });
  }),
);

router.post(
  '/requests/:id/offer',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const { submit, ...offerData } = req.body;
    const result = await saveOffer(req.params!.id, offerData, req.authUser!.id, Boolean(submit));
    res.json({ ok: true, ...result });
  }),
);

router.patch(
  '/requests/:id/offer',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await saveOffer(req.params!.id, req.body, req.authUser!.id, false);
    res.json({ ok: true, ...result });
  }),
);

// ── Branch Head ───────────────────────────────────────────────────────────────

router.get(
  '/pending-approval',
  requireAuth,
  requireRole('branch_head', 'admin'),
  h(async (_req: AuthenticatedRequest, res) => {
    const rows = await listPendingApprovals(undefined);
    res.json({ ok: true, data: rows });
  }),
);

router.post(
  '/offers/:id/approve',
  requireAuth,
  requireRole('branch_head', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await approveOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/offers/:id/reject',
  requireAuth,
  requireRole('branch_head', 'admin'),
  h(async (req: AuthenticatedRequest, res) => {
    if (!req.body.remarks) { res.status(400).json({ error: 'remarks required for rejection' }); return; }
    await rejectOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true });
  }),
);

export default router;
