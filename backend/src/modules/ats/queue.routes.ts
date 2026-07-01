import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
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

// ── Public display router (no auth) ───────────────────────────────────────────
export const queuePublicRouter = Router();

// GET /api/ats/queue/branches?date=YYYY-MM-DD — distinct branches with active queue for date (defaults to today)
queuePublicRouter.get('/branches', async (req, res) => {
  try {
    const targetDate = (req.query.date as string) || new Date().toISOString().split('T')[0];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT branch_name
         FROM ats_queue_token
        WHERE DATE(created_at) = ?
          AND branch_name IS NOT NULL
          AND branch_name != ''
        ORDER BY branch_name`,
      [targetDate]
    );
    const branches = (rows as any[]).map((r) => r.branch_name as string);
    return res.json({ success: true, data: branches });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/ats/queue/public-display?branch=Chennai
queuePublicRouter.get('/public-display', async (req, res) => {
  try {
    const today = new Date().toISOString().split('T')[0];
    const filters: QueueFilters = {
      branch: req.query.branch as string | undefined,
      date: today,
    };
    const [queue, metrics] = await Promise.all([
      getLiveQueue(filters),
      getQueueMetrics(filters.branch, today),
    ]);
    // Strip PII — only send token_number, status, timing, position
    const safeQueue = queue.map(({ token_number, queue_status, estimated_wait_time, position_in_queue, applied_role, branch_name, called_at, interview_started_at }) => ({
      token_number,
      queue_status,
      estimated_wait_time,
      position_in_queue,
      applied_role,
      branch_name,
      called_at,
      interview_started_at,
    }));
    return res.json({ success: true, data: { queue: safeQueue, metrics } });
  } catch (err: any) {
    return res.status(500).json({ success: false, message: err.message });
  }
});

// GET /api/ats/queue/display-stream?branch=Chennai  (SSE)
queuePublicRouter.get('/display-stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.flushHeaders();

  const today = new Date().toISOString().split('T')[0];
  const filters: QueueFilters = {
    branch: req.query.branch as string | undefined,
    date: today,
  };

  const sendSnapshot = async () => {
    try {
      const [queue, metrics] = await Promise.all([
        getLiveQueue(filters),
        getQueueMetrics(filters.branch, today),
      ]);
      const safeQueue = queue.map(({ token_number, queue_status, estimated_wait_time, position_in_queue, applied_role, branch_name, called_at, interview_started_at }) => ({
        token_number, queue_status, estimated_wait_time, position_in_queue, applied_role, branch_name, called_at, interview_started_at,
      }));
      res.write(`data: ${JSON.stringify({ queue: safeQueue, metrics, ts: Date.now() })}\n\n`);
    } catch {
      // Non-fatal — client will retry on next interval
    }
  };

  void sendSnapshot();
  const dataInterval = setInterval(() => void sendSnapshot(), 15_000);
  const heartbeatInterval = setInterval(() => res.write(': heartbeat\n\n'), 30_000);

  req.on('close', () => {
    clearInterval(dataInterval);
    clearInterval(heartbeatInterval);
    res.end();
  });
});

// ── Authenticated queue router ────────────────────────────────────────────────
export const queueRouter = Router();

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
