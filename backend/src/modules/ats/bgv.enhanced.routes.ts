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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 2. Get BGV details for a candidate ────────────────────────────────────────
bgvEnhancedRouter.get('/:candidateId', async (req, res) => {
  try {
    const { candidateId } = req.params;
    const details = await getBGVDetails(candidateId);
    return res.json({ success: true, data: details });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
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
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

bgvEnhancedRouter.post('/name-match/run', requireRole('admin', 'hr'), async (req: AuthenticatedRequest, res) => {
  try {
    const result = await runNameMatchCheck(req.body.candidate_id, req.authUser!.id);
    return res.json(result);
  } catch (error: any) {
    return res.status(error.statusCode ?? 500).json({ success: false, message: error.message });
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
  } catch (error: any) {
    return res.status(error.statusCode ?? 500).json({ success: false, message: error.message });
  }
});

// ── 5. Get BGV statistics ─────────────────────────────────────────────────────
bgvEnhancedRouter.get('/stats/overview', requireRole('admin', 'hr'), async (_req, res) => {
  try {
    const stats = await getBGVStatistics();
    return res.json({ success: true, data: stats });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
