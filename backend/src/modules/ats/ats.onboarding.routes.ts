import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  sendOnboardingToken, validateToken, submitProfile,
  listOnboardingRequests, saveOffer,
  listPendingApprovals, approveOffer, rejectOffer,
} from './ats.onboarding.service.js';
import { calculateSalary } from './salary.calculator.js';
import { buildScopeWhereClause, hasScopedAccess } from '../../shared/scopeAccess.js';
import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2';
import { atsService } from './ats.service.js';
import { resolveRecruiterForActor } from '../ats-full-parity/recruiterInterview.service.js';

const router = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<void>;

const h = (fn: AsyncHandler): RequestHandler =>
  (req: Request, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

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
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const candidateId = req.params!.candidateId;
    const userId = req.authUser!.id;

    // Row-scope: load candidate's branch/process, then verify actor has access
    const cand = await atsService.getCandidate(candidateId);
    if (cand.active_status === 0) {
      res.status(404).json({ ok: false, error: 'Candidate not found' });
      return;
    }
    const allowed = await hasScopedAccess(
      userId,
      ['hr', 'recruiter'],
      { branchId: cand.applied_for_branch, processId: cand.applied_for_process },
      { allowAdminBypass: true },
    );
    const recruiterProfile = await resolveRecruiterForActor(userId);
    const candidateRecord = cand as unknown as Record<string, unknown>;
    const assignedRecruiterIds = [
      candidateRecord.recruiter_id,
      candidateRecord.recruiter_assigned_id,
      candidateRecord.assigned_recruiter_id,
    ].filter(Boolean).map(String);
    const isAssignedRecruiter = recruiterProfile
      ? assignedRecruiterIds.includes(String(recruiterProfile.id))
        || String(candidateRecord.recruiter_assigned_name ?? candidateRecord.recruiter_name ?? '').trim() === recruiterProfile.name
      : false;
    if (!allowed && !isAssignedRecruiter) {
      res.status(403).json({ ok: false, error: 'Access denied' });
      return;
    }

    const result = await sendOnboardingToken(candidateId, userId);
    res.json({ ok: true, ...result });
  }),
);

router.get(
  '/requests',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const scopeFilter = await buildScopeWhereClause(
      req.authUser!.id,
      ['hr', 'recruiter'],
      { branchId: 'r.branch_id' },
      { allowAdminBypass: true },
    );
    const rows = await listOnboardingRequests(scopeFilter);
    res.json({ ok: true, data: rows });
  }),
);

router.post(
  '/calculate-salary',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr'),
  h(async (req, res) => {
    const { ctc, bandCode, isMetro } = req.body;
    if (!ctc || !bandCode) { res.status(400).json({ error: 'ctc and bandCode required' }); return; }
    const [bands] = await db.execute<RowDataPacket[]>(
      `SELECT basic_pct, hra_pct FROM salary_band_master WHERE band_code = ?`, [bandCode],
    ).catch(() => [[] as RowDataPacket[]]);
    const band = (bands as RowDataPacket[])[0] ?? { basic_pct: 40, hra_pct: 40 };
    const components = calculateSalary(Number(ctc), Number(band.basic_pct), Number(band.hra_pct), Boolean(isMetro));
    res.json({ ok: true, components });
  }),
);

router.post(
  '/requests/:id/offer',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const { submit, ...offerData } = req.body;
    const result = await saveOffer(req.params!.id, offerData, req.authUser!.id, Boolean(submit));
    res.json({ ok: true, ...result });
  }),
);

router.patch(
  '/requests/:id/offer',
  requireAuth,
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await saveOffer(req.params!.id, req.body, req.authUser!.id, false);
    res.json({ ok: true, ...result });
  }),
);

// ── Send onboarding link (status=selected gate) ──────────────────────────────

router.post(
  '/candidates/:id/send-onboarding-link',
  requireAuth,
  requireRole('recruiter', 'hr', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const { id } = req.params!;
    const { db: database } = await import('../../db/mysql.js');
    const [rows] = await database.execute<RowDataPacket[]>(
      'SELECT status FROM ats_candidate WHERE id = ? AND active_status = 1 LIMIT 1',
      [id],
    );
    if (!Array.isArray(rows) || !rows.length) {
      res.status(404).json({ success: false, message: 'Candidate not found' });
      return;
    }
    const currentStatus = (rows[0] as RowDataPacket & { status?: string | null }).status;
    if (currentStatus !== 'selected') {
      res.status(400).json({
        success: false,
        message: 'Candidate must be in selected status before sending onboarding link',
        current_status: currentStatus,
      });
      return;
    }
    const { randomUUID } = await import('crypto');
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ');
    await database.execute(
      `UPDATE ats_candidate
          SET onboarding_token = ?,
              onboarding_token_expires = ?,
              status = 'onboarding_link_sent',
              updated_at = NOW()
        WHERE id = ?`,
      [token, expiresAt, id],
    );
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:8085';
    const link = `${baseUrl}/onboard-full?token=${token}`;
    res.json({ success: true, link, token, expires_at: expiresAt });
  }),
);

// ── Branch Head ───────────────────────────────────────────────────────────────

router.get(
  '/pending-approval',
  requireAuth,
  requireRole('branch_head', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const scopeFilter = await buildScopeWhereClause(
      req.authUser!.id,
      ['branch_head'],
      { branchId: 'r.branch_id' },
      { allowAdminBypass: true },
    );
    const rows = await listPendingApprovals(scopeFilter);
    res.json({ ok: true, data: rows });
  }),
);

router.post(
  '/offers/:id/approve',
  requireAuth,
  requireRole('branch_head', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await approveOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/offers/:id/reject',
  requireAuth,
  requireRole('branch_head', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    if (!req.body.remarks) { res.status(400).json({ error: 'remarks required for rejection' }); return; }
    await rejectOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true });
  }),
);

export default router;
