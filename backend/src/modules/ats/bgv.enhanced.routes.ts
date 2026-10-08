import { Router } from 'express';
import { requireAuth, AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getPendingBGVRequests,
  getBGVDetails,
  initiateBGVVerification,
  updateVerificationStatus,
  getBGVStatistics,
  runNameMatchCheck,
  overrideNameMatchReview,
} from './bgv.enhanced.service.js';

export const bgvEnhancedRouter = Router();

// All routes require authentication
bgvEnhancedRouter.use(requireAuth);

// ── 1. Get pending BGV requests (HR/Admin) ────────────────────────────────────
bgvEnhancedRouter.get('/pending', requireRole('admin', 'hr'), async (_req, res) => {
  try {
    const requests = await getPendingBGVRequests();
    return res.json({ success: true, data: requests });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, message });
  }
});

// ── 2. Get BGV details for a candidate ────────────────────────────────────────
bgvEnhancedRouter.get('/stats/overview', requireRole('admin', 'hr'), async (_req, res) => {
  try {
    const stats = await getBGVStatistics();
    return res.json({ success: true, data: stats });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, message });
  }
});

bgvEnhancedRouter.get('/:candidateId', requireRole('admin', 'hr', 'recruiter', 'manager', 'super_admin'), async (req, res) => {
  try {
    const { candidateId } = req.params;
    const details = await getBGVDetails(candidateId);
    return res.json({ success: true, data: details });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, message });
  }
});

// ── 3. Initiate BGV verification ──────────────────────────────────────────────
bgvEnhancedRouter.post('/initiate', requireRole('admin', 'hr'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await initiateBGVVerification({
      candidate_id: req.body.candidate_id,
      verification_type: req.body.verification_type,
      document_number: req.body.document_number,
      verification_method: req.body.verification_method || 'manual',
      initiated_by: req.authUser!.id,
      remarks: req.body.remarks,
    });
    return res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, message });
  }
});

// ── 4. Update verification status ─────────────────────────────────────────────
bgvEnhancedRouter.post('/update-status', requireRole('admin', 'hr'), async (req, res) => {
  try {
    const result = await updateVerificationStatus(
      req.body.verification_id,
      req.body.status,
      req.body.remarks
    );
    return res.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ success: false, message });
  }
});

bgvEnhancedRouter.post('/name-match/run', requireRole('admin', 'hr'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await runNameMatchCheck(req.body.candidate_id, req.authUser!.id);
    return res.json(result);
  } catch (error: unknown) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : 500;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(statusCode || 500).json({ success: false, message });
  }
});

bgvEnhancedRouter.post('/name-match/override', requireRole('admin', 'hr'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await overrideNameMatchReview({
      candidateId: req.body.candidate_id,
      actorUserId: req.authUser!.id,
      reason: String(req.body.reason ?? ''),
    });
    return res.json(result);
  } catch (error: unknown) {
    const statusCode = error && typeof error === "object" && "statusCode" in error ? Number((error as { statusCode?: unknown }).statusCode) : 500;
    const message = error instanceof Error ? error.message : String(error);
    return res.status(statusCode || 500).json({ success: false, message });
  }
});

// ── 5. Get BGV statistics ─────────────────────────────────────────────────────
