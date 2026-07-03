import { Router } from 'express';
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

export const queueRouter = Router();
export const queuePublicRouter = Router();

type PublicQueueEntry = {
  token_number: string;
  queue_status: 'waiting' | 'called' | 'in_interview' | 'completed' | 'no_show';
  estimated_wait_time: number | null;
  position_in_queue: number;
  applied_role: string | null;
  branch_name: string | null;
  called_at: string | null;
  interview_started_at: string | null;
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
  const [rows] = await db.execute<any[]>(
    `SELECT DISTINCT branch_name
       FROM (
         SELECT COALESCE(
                  NULLIF(qt.branch_name, ''),
                  NULLIF(c.branch_display_name, ''),
                  NULLIF(bm.branch_name, ''),
                  NULLIF(c.applied_for_branch, '')
                ) AS branch_name
            FROM ats_queue_token qt
            INNER JOIN ats_candidate c ON c.id = qt.candidate_id
            LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
           WHERE COALESCE(
                   NULLIF(qt.branch_name, ''),
                   NULLIF(c.branch_display_name, ''),
                   NULLIF(bm.branch_name, ''),
                   NULLIF(c.applied_for_branch, '')
                 ) IS NOT NULL
          UNION
         SELECT DISTINCT COALESCE(
                  NULLIF(c.branch_display_name, ''),
                  NULLIF(bm.branch_name, ''),
                  NULLIF(c.applied_for_branch, '')
                ) AS branch_name
            FROM ats_candidate c
            LEFT JOIN branch_master bm ON bm.id = c.applied_for_branch
           WHERE COALESCE(
                   NULLIF(c.branch_display_name, ''),
                   NULLIF(bm.branch_name, ''),
                   NULLIF(c.applied_for_branch, '')
                 ) IS NOT NULL
        ) branches
       ORDER BY branch_name ASC`
  );
  const branches = new Set<string>();
  for (const row of rows) {
    if (row.branch_name) branches.add(String(row.branch_name));
  }
  return Array.from(branches).sort((a, b) => a.localeCompare(b));
}

queuePublicRouter.get('/branches', async (_req, res) => {
  try {
    const data = await loadBranchNames();
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

queuePublicRouter.get('/public-display', async (req, res) => {
  try {
    const branch = req.query.branch as string | undefined;
    const date = req.query.date as string | undefined;
    const data = await loadPublicDisplay(branch, date);
    return res.json({ success: true, data });
  } catch (error: any) {
    return res.status(500).json({ success: false, message: error.message });
  }
});

queuePublicRouter.get('/display-stream', async (req, res) => {
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
    } catch (error: any) {
      res.write(`event: error\ndata: ${JSON.stringify({ success: false, message: error.message })}\n\n`);
    }
  };

  const heartbeat = setInterval(() => {
    if (!closed) res.write(`: keep-alive ${Date.now()}\n\n`);
  }, 25_000);

  await pushSnapshot();
  const poll = setInterval(() => {
    void pushSnapshot();
  }, 15_000);

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
