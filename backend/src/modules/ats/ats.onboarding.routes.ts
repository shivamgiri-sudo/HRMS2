import { Router, type Request, type Response, type NextFunction, type RequestHandler } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  sendOnboardingToken, validateToken, submitProfile,
  listOnboardingRequests, saveOffer,
  listPendingApprovals, approveOffer, rejectOffer,
  sendOnboardingProgressReminder,
  markCandidateNotJoining, clearCandidateNotJoining,
} from './ats.onboarding.service.js';
import { calculateSalary } from './salary.calculator.js';
import { buildScopeWhereClause, hasScopedAccess, hasAnyRole } from '../../shared/scopeAccess.js';
import { db } from '../../db/mysql.js';
import { RowDataPacket } from 'mysql2';
import { atsService } from './ats.service.js';
import { resolveRecruiterForActor } from '../ats-full-parity/recruiterInterview.service.js';
import { z } from 'zod';

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
  // branch_hr and payroll_head added so branch payroll HR can resend an onboarding link for
  // their own branch's candidates, and payroll_head org-wide — previously neither role was
  // listed here even though branch_hr already held the ATS_ONBOARDING_REQUESTS page grant, so
  // the page loaded but every resend attempt 403'd.
  //
  // hr_admin/hr_branch/hr_head/ho_hr/recruitment_hr added 2026-08-24 so every HR-department
  // designation (per the live role matrix, uat/UAT_ROLE_MATRIX.csv) can resend the onboarding
  // link, not just the base 'hr' role — previously an hr_head or hr_admin user, despite being
  // HR, would 403 the same way branch_hr/payroll_head did before the fix above.
  requireRole('hr', 'hr_admin', 'hr_branch', 'hr_head', 'ho_hr', 'recruitment_hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr', 'branch_hr', 'payroll_head'),
  h(async (req: AuthenticatedRequest, res) => {
    const candidateId = req.params!.candidateId;
    const userId = req.authUser!.id;

    // Row-scope: load candidate's branch/process, then verify actor has access
    const cand = await atsService.getCandidate(candidateId);
    if (cand.active_status === 0) {
      res.status(404).json({ ok: false, error: 'Candidate not found' });
      return;
    }
    // Every HR-department designation gets org-wide access to resend onboarding links,
    // regardless of their own branch scope in user_assignment_scope — added 2026-08-24 after
    // sofiya.sultan@teammas.co.in (role 'hr', correctly scoped to her own branch, NOIDA-2)
    // could only resend for the ~15% of candidates in that one branch; the other ~85% span 6+
    // other branches she (like any single-branch HR user) has no scope row for. HR resending a
    // link is treated the same way this file already treats super_admin/admin — an
    // unconditional bypass — not a branch-scoped decision the way most other row-scope checks
    // in this codebase are, because onboarding is a company-wide HR function, not a branch one.
    const isHrDepartment = await hasAnyRole(
      userId, 'hr', 'hr_admin', 'hr_branch', 'hr_head', 'ho_hr', 'recruitment_hr',
    );

    // hasScopedAccess does a raw role_key match (no legacy-alias normalization, unlike
    // requireRole above) — 'branch_hr' must be the literal string here, not 'hr_admin', or a
    // branch_hr user would pass requireRole and then be silently scope-denied anyway.
    // payroll_hr added here too: it already passed requireRole above but was missing from
    // this array, so it was silently 403'd on every resend despite the route accepting the
    // role — its ATS_ONBOARDING_REQUESTS page grant was also found inactive in role_page_access,
    // reactivated in migration 1236.
    //
    // Non-HR-department roles (recruiter/branch_hr/payroll_head/payroll_hr) stay properly
    // branch/process-scoped below — the org-wide bypass above is deliberately narrower than
    // requireRole's full list.
    const allowed = isHrDepartment || await hasScopedAccess(
      userId,
      ['recruiter', 'branch_hr', 'payroll_head', 'payroll_hr'],
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

    const rawEmail = (req.body as Record<string, unknown> | undefined)?.email;
    const overrideEmail = typeof rawEmail === 'string' && rawEmail.trim() ? rawEmail.trim() : undefined;
    if (overrideEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(overrideEmail)) {
      res.status(400).json({ ok: false, error: 'Invalid email address' });
      return;
    }
    const result = await sendOnboardingToken(candidateId, userId, overrideEmail);
    res.json({ ok: true, ...result });
  }),
);

router.get(
  '/requests',
  requireAuth,
  // Same branch_hr/payroll_head addition as POST /send-token above — this is the listing
  // endpoint the Onboarding Requests page calls, so without it here too the page would load
  // (branch_hr already has the page grant) but show an empty/403 list.
  requireRole('hr', 'recruiter', 'admin', 'super_admin', 'payroll_hr', 'branch_hr', 'payroll_head'),
  h(async (req: AuthenticatedRequest, res) => {
    const scopeFilter = await buildScopeWhereClause(
      req.authUser!.id,
      ['hr', 'recruiter', 'branch_hr', 'payroll_head', 'payroll_hr'],
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
    // Require cost_centre when submitting (not just saving draft)
    if (submit && !offerData.cost_centre) {
      res.status(400).json({ ok: false, error: 'Cost Centre is required to submit an offer' });
      return;
    }
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
    // Delegate to the canonical sendOnboardingToken so ats_onboarding_request,
    // ats_onboarding_bridge, and ats_candidate.profile_status are all written correctly.
    const { sendOnboardingToken } = await import('./ats.onboarding.service.js');
    const result = await sendOnboardingToken(id, req.authUser!.id);
    const baseUrl = process.env.FRONTEND_URL ?? 'http://localhost:8085';
    const link = `${baseUrl}/onboard-full?token=${result.token}`;
    res.json({ success: true, link, token: result.token, expires_at: result.expiresAt });
  }),
);

// ── Send Progress Reminder to Candidate ──────────────────────────────────────

router.post(
  '/candidates/:id/send-reminder',
  requireAuth,
  requireRole('recruiter', 'hr', 'admin', 'super_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await sendOnboardingProgressReminder(req.params!.id, req.authUser!.id);
    res.json({ ok: true, ...result });
  }),
);

// ── Mark / clear "candidate dropped out, not joining" ────────────────────────
//
// Narrower role gate than resend/reminder (admin, super_admin, hr only) —
// mirrors the closest precedent, the onboarding-full review endpoint's
// approve/reject/hr_review decision, since this is the same kind of
// decisive, terminal state-change.
router.patch(
  '/candidates/:id/not-joining',
  requireAuth,
  requireRole('admin', 'super_admin', 'hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const reason = String(req.body?.reason ?? '');
    const result = await markCandidateNotJoining(req.params!.id, req.authUser!.id, reason);
    res.json({ ok: true, ...result });
  }),
);

router.patch(
  '/candidates/:id/not-joining/clear',
  requireAuth,
  requireRole('admin', 'super_admin', 'hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await clearCandidateNotJoining(req.params!.id, req.authUser!.id);
    res.json({ ok: true, ...result });
  }),
);

// ── Branch Head ───────────────────────────────────────────────────────────────

router.get(
  '/pending-approval',
  requireAuth,
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
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
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    const result = await approveOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true, ...result });
  }),
);

router.post(
  '/offers/:id/reject',
  requireAuth,
  requireRole('branch_head', 'admin', 'super_admin', 'hr', 'payroll_hr'),
  h(async (req: AuthenticatedRequest, res) => {
    if (!req.body.remarks) { res.status(400).json({ error: 'remarks required for rejection' }); return; }
    await rejectOffer(req.params!.id, req.authUser!.id, req.body.remarks);
    res.json({ ok: true });
  }),
);

export default router;
