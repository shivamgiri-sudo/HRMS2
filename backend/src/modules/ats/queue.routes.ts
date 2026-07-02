import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  getLiveQueue,
  getQueueMetrics,
  getNextCandidate,
  updateQueueStatus,
  getRecruiterQueue,
  callNextCandidate,
  markNoShow,
  getQueuePosition,
  type QueueFilters,
} from './queue.enhanced.service.js';

export const queueRouter = Router();
export const queuePublicRouter = Router();

// All routes require authentication
queueRouter.use(requireAuth);
queueRouter.use(requireRole('admin', 'hr', 'recruiter', 'manager'));

// ── 1. Get live queue with filters ────────────────────────────────────────────
queueRouter.get('/live', async (req, res) => {
  try {
    const filters: QueueFilters = {
      branch: req.query.branch as string,
      date: req.query.date as string,
      status: req.query.status as string,
      recruiter_id: req.query.recruiter_id as string,
      search: req.query.search as string,
    };

    const queue = await getLiveQueue(filters);
    return res.json({ success: true, data: queue });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 2. Get queue metrics ───────────────────────────────────────────────────────
queueRouter.get('/metrics', async (req, res) => {
  try {
    const branch = req.query.branch as string | undefined;
    const date = req.query.date as string | undefined;

    const metrics = await getQueueMetrics(branch, date);
    return res.json({ success: true, data: metrics });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 3. Get next candidate for recruiter ───────────────────────────────────────
queueRouter.get('/next-candidate', async (req: any, res) => {
  try {
    const recruiterId = req.authUser.id;
    const branch = req.query.branch as string;

    if (!branch) {
      return res.status(400).json({
        success: false,
        message: 'Branch parameter is required',
      });
    }

    const nextCandidate = await getNextCandidate(recruiterId, branch);

    if (!nextCandidate) {
      return res.json({
        success: true,
        data: null,
        message: 'No candidates waiting in queue',
      });
    }

    return res.json({ success: true, data: nextCandidate });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 4. Update queue status ─────────────────────────────────────────────────────
queueRouter.post('/update-status', async (req, res) => {
  try {
    const { queue_id, status } = req.body;

    if (!queue_id || !status) {
      return res.status(400).json({
        success: false,
        message: 'queue_id and status are required',
      });
    }

    const validStatuses = ['waiting', 'called', 'in_interview', 'completed', 'no_show'];
    if (!validStatuses.includes(status)) {
      return res.status(400).json({
        success: false,
        message: `Invalid status. Must be one of: ${validStatuses.join(', ')}`,
      });
    }

    await updateQueueStatus(queue_id, status);

    return res.json({
      success: true,
      message: `Queue status updated to ${status}`,
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 5. Get recruiter's queue ───────────────────────────────────────────────────
queueRouter.get('/my-queue', async (req: any, res) => {
  try {
    const recruiterId = req.authUser.id;
    const queue = await getRecruiterQueue(recruiterId);
    return res.json({ success: true, data: queue });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 6. Call next candidate ─────────────────────────────────────────────────────
queueRouter.post('/call-next', async (req, res) => {
  try {
    const { queue_id } = req.body;

    if (!queue_id) {
      return res.status(400).json({
        success: false,
        message: 'queue_id is required',
      });
    }

    await callNextCandidate(queue_id);

    return res.json({
      success: true,
      message: 'Candidate called successfully',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 7. Mark as no-show ─────────────────────────────────────────────────────────
queueRouter.post('/mark-no-show', async (req, res) => {
  try {
    const { queue_id } = req.body;

    if (!queue_id) {
      return res.status(400).json({
        success: false,
        message: 'queue_id is required',
      });
    }

    await markNoShow(queue_id);

    return res.json({
      success: true,
      message: 'Candidate marked as no-show',
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

// ── 8. Get queue position for candidate ───────────────────────────────────────
queueRouter.get('/position/:candidateId', async (req, res) => {
  try {
    const { candidateId } = req.params;
    const position = await getQueuePosition(candidateId);

    return res.json({
      success: true,
      data: { position },
    });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});
