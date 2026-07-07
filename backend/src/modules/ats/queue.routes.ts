import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import {
  getLiveQueue,
  getQueueMetrics,
  getNextCandidate,
  updateQueueStatus,
  getRecruiterQueue,
  callNextCandidate,
  markNoShow,
  getQueuePosition,
  cleanupStaleInterviews,
  type QueueFilters,
} from './queue.enhanced.service.js';

export const queueRouter = Router();
export const queuePublicRouter = Router();

type AsyncHandler = (req: Request, res: Response) => Promise<unknown>;

const h = (fn: AsyncHandler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req, res).catch(next);
};

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected error';
}

type PublicQueueEntry = {
  token_number: string;
  queue_status: 'waiting' | 'called' | 'in_interview' | 'completed' | 'no_show';
  estimated_wait_time: number | null;
  position_in_queue: number;
  applied_role: string | null;
  branch_name: string | null;
  called_at: string | null;
  interview_started_at: string | null;
  candidate_name: string | null;
};

function mapPublicQueueEntry(entry: Awaited<ReturnType<typeof getLiveQueue>>[number]): PublicQueueEntry {
  return {
    token_number: entry.token_number,
    queue_status: entry.queue_status,
    estimated_wait_time: entry.estimated_wait_time,
    position_in_queue: entry.position_in_queue,
    applied_role: entry.applied_role,
    branch_name: entry.branch_name,
    called_at: entry.called_at,
    interview_started_at: entry.interview_started_at,
    candidate_name: (entry as any).candidate_name ?? null,
  };
}

async function loadPublicDisplay(branch?: string, date?: string) {
  const [queue, metrics] = await Promise.all([
    getLiveQueue({ branch, date }),
    getQueueMetrics(branch, date),
  ]);

  return {
    queue: queue.map(mapPublicQueueEntry),
    metrics,
  };
}

async function loadBranchNames(): Promise<string[]> {
  interface BranchNameRow extends RowDataPacket {
    branch_name?: string | null;
  }
  const [rows] = await db.execute<BranchNameRow[]>(
    `SELECT branch_name
       FROM branch_master
      WHERE active_status = 1
        AND branch_name IS NOT NULL
        AND branch_name != ''
      ORDER BY branch_name ASC`
  );
  return rows.filter((r) => r.branch_name).map((r) => String(r.branch_name));
}

queuePublicRouter.get('/branches', h(async (_req: Request, res: Response) => {
  try {
    const data = await loadBranchNames();
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

queuePublicRouter.get('/public-display', h(async (req: Request, res: Response) => {
  try {
    const branch = req.query.branch as string | undefined;
    const date = req.query.date as string | undefined;
    const data = await loadPublicDisplay(branch, date);
    return res.json({ success: true, data });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

queuePublicRouter.get('/display-stream', async (req: Request, res: Response) => {
  const branch = req.query.branch as string | undefined;
  const date = req.query.date as string | undefined;

  res.status(200);
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  let closed = false;
  const pushSnapshot = async () => {
    if (closed) return;
    try {
      const data = await loadPublicDisplay(branch, date);
      res.write(`data: ${JSON.stringify({ success: true, data, ts: Date.now() })}\n\n`);
    } catch (error: unknown) {
      res.write(`event: error\ndata: ${JSON.stringify({ success: false, message: getErrorMessage(error) })}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 25_000);

  // Cleanup stale in_interview tokens on connection start
  await cleanupStaleInterviews().catch((err) => {
    console.error('[queue] Stale interview cleanup failed:', err);
  });

  await pushSnapshot();
  const poll = setInterval(() => {
    void pushSnapshot();
  }, 5_000);

  req.on('close', () => {
    closed = true;
    clearInterval(heartbeat);
    clearInterval(poll);
    res.end();
  });
});

// All routes require authentication
queueRouter.use(requireAuth);
queueRouter.use(requireRole('admin', 'hr', 'recruiter', 'manager'));

// ── 1. Get live queue with filters ────────────────────────────────────────────
queueRouter.get('/live', h(async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 2. Get queue metrics ───────────────────────────────────────────────────────
queueRouter.get('/metrics', h(async (req: Request, res: Response) => {
  try {
    const branch = req.query.branch as string | undefined;
    const date = req.query.date as string | undefined;

    const metrics = await getQueueMetrics(branch, date);
    return res.json({ success: true, data: metrics });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 3. Get next candidate for recruiter ───────────────────────────────────────
queueRouter.get('/next-candidate', h(async (req: Request, res: Response) => {
  try {
    const recruiterId = (req as AuthenticatedRequest).authUser!.id;
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
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 4. Update queue status ─────────────────────────────────────────────────────
queueRouter.post('/update-status', h(async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 5. Get recruiter's queue ───────────────────────────────────────────────────
queueRouter.get('/my-queue', h(async (req: Request, res: Response) => {
  try {
    const recruiterId = (req as AuthenticatedRequest).authUser!.id;
    const queue = await getRecruiterQueue(recruiterId);
    return res.json({ success: true, data: queue });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 6. Call next candidate ─────────────────────────────────────────────────────
queueRouter.post('/call-next', h(async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 7. Mark as no-show ─────────────────────────────────────────────────────────
queueRouter.post('/mark-no-show', h(async (req: Request, res: Response) => {
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
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));

// ── 8. Get queue position for candidate ───────────────────────────────────────
queueRouter.get('/position/:candidateId', h(async (req: Request, res: Response) => {
  try {
    const { candidateId } = req.params;
    const position = await getQueuePosition(candidateId);

    return res.json({
      success: true,
      data: { position },
    });
  } catch (error: unknown) {
    return res.status(500).json({ success: false, message: getErrorMessage(error) });
  }
}));
