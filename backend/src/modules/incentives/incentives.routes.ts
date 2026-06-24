import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { randomUUID } from 'crypto';
import { db } from '../../db/mysql.js';
import type { RowDataPacket } from 'mysql2';

import * as svc from './incentives.service.js';
import {
  CreateIncentiveMasterSchema, UpdateIncentiveMasterSchema,
  CreateBatchSchema, ImportLinesSchema, ApproveRejectSchema, ApplyToRunSchema,
} from './incentives.validation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export const incentivesRouter = Router();
incentivesRouter.use(requireAuth);

// ── MASTERS ───────────────────────────────────────────────────────────────────
incentivesRouter.get('/masters', h(async (_req, res) => {
  res.json({ success: true, data: await svc.listIncentiveMasters() });
}));

incentivesRouter.post('/masters', requireRole('admin', 'hr', 'finance'), h(async (req, res) => {
  const parsed = CreateIncentiveMasterSchema.parse(req.body);
  const data = await svc.createIncentiveMaster(parsed, req.authUser?.id ?? '');
  res.status(201).json({ success: true, data });
}));

incentivesRouter.put('/masters/:id', requireRole('admin', 'hr', 'finance'), h(async (req, res) => {
  const parsed = UpdateIncentiveMasterSchema.parse(req.body);
  const data = await svc.updateIncentiveMaster(req.params.id, parsed);
  res.json({ success: true, data });
}));

incentivesRouter.delete('/masters/:id', requireRole('admin'), h(async (req, res) => {
  await svc.softDeleteIncentiveMaster(req.params.id);
  res.json({ success: true });
}));

// ── BATCHES ───────────────────────────────────────────────────────────────────
incentivesRouter.get('/batches', h(async (req, res) => {
  const { month } = req.query as Record<string, string>;
  res.json({ success: true, data: await svc.listBatches(month) });
}));

incentivesRouter.post('/batches', requireRole('admin', 'hr', 'finance'), h(async (req, res) => {
  const parsed = CreateBatchSchema.parse(req.body);
  const data = await svc.createBatch(parsed, req.authUser?.id ?? '');
  res.status(201).json({ success: true, data });
}));

incentivesRouter.get('/batches/:id', h(async (req, res) => {
  const data = await svc.getBatchById(req.params.id);
  if (!data) return res.status(404).json({ error: 'Batch not found' });
  res.json({ success: true, data });
}));

incentivesRouter.get('/batches/:id/lines', h(async (req, res) => {
  res.json({ success: true, data: await svc.getBatchLines(req.params.id) });
}));

incentivesRouter.post('/batches/:id/lines/import', requireRole('admin', 'hr', 'finance'), h(async (req, res) => {
  const parsed = ImportLinesSchema.parse(req.body);
  const data = await svc.importLines(req.params.id, parsed);
  res.json({ success: true, data });
}));

incentivesRouter.post('/batches/:id/submit', requireRole('admin', 'hr', 'finance'), h(async (req, res) => {
  const data = await svc.submitBatch(req.params.id, req.authUser?.id ?? '');
  res.json({ success: true, data });
}));

incentivesRouter.post('/batches/:id/approve', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = ApproveRejectSchema.parse(req.body);
  const data = await svc.approveBatch(req.params.id, req.authUser?.id ?? '', parsed.remarks);
  res.json({ success: true, data });
}));

incentivesRouter.post('/batches/:id/reject', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = ApproveRejectSchema.parse(req.body);
  const data = await svc.rejectBatch(req.params.id, req.authUser?.id ?? '', parsed.remarks);
  res.json({ success: true, data });
}));

// ── APPLY TO RUN ──────────────────────────────────────────────────────────────
incentivesRouter.post('/apply-to-run', requireRole('admin', 'finance', 'payroll'), h(async (req, res) => {
  const parsed = ApplyToRunSchema.parse(req.body);
  const data = await svc.applyToRun(parsed.run_id, parsed.pay_month, req.authUser?.id ?? '');
  res.json({ success: true, data });
}));

// ── 3-TIER APPROVAL CHAIN ─────────────────────────────────────────────────────
// Flow: WFM uploads → branch_head (step 1) → operations_head (step 2) → finance_head (step 3)
// After finance_head approves → status = 'finance_approved'
// Register action (separate) → status = 'fully_approved'

// Step role mapping: step 1=branch_head, 2=operations_head, 3=finance_head
const APPROVAL_STEPS: Record<number, string> = {
  1: 'branch_head',
  2: 'operations_head',
  3: 'finance_head',
};
const APPROVAL_STEP_COUNT = 3;

// Helper: insert a work_item for the next approver role
async function createApprovalWorkItem(
  batchId: string,
  role: string,
  createdBy: string,
  batchRef?: string
): Promise<void> {
  const title = `Incentive batch approval required${batchRef ? ` — ${batchRef}` : ''}`;
  await db.execute(
    `INSERT INTO work_item
       (id, item_type, title, module_code, entity_type, entity_id,
        assigned_to_role, priority, status, created_by)
     VALUES (UUID(), 'INCENTIVE_APPROVAL', ?, 'INCENTIVES', 'incentive_batch', ?, ?, 'high', 'open', ?)`,
    [title, batchId, role, createdBy]
  );
}

// Helper: write an audit log entry (prefers audit_log, falls back to work_item_audit_log)
async function writeAuditLog(
  userId: string,
  action: string,
  entityId: string,
  meta: Record<string, unknown>
): Promise<void> {
  try {
    await db.execute(
      `INSERT INTO audit_log (id, user_id, action, entity_type, entity_id, meta, created_at)
       VALUES (UUID(), ?, ?, 'incentive_batch', ?, ?, NOW())`,
      [userId, action, entityId, JSON.stringify(meta)]
    );
  } catch {
    // audit_log table may not exist; fall back to work_item_audit_log
    try {
      await db.execute(
        `INSERT INTO work_item_audit_log (id, user_id, action, entity_type, entity_id, meta, created_at)
         VALUES (UUID(), ?, ?, 'incentive_batch', ?, ?, NOW())`,
        [userId, action, entityId, JSON.stringify(meta)]
      );
    } catch {
      // Audit logging is best-effort; swallow if neither table exists
    }
  }
}

// POST /batches/:batchId/approval-chain/init — initialize 3-step approval chain
incentivesRouter.post('/batches/:batchId/approval-chain/init',
  requireRole('admin', 'hr', 'finance', 'wfm'),
  h(async (req: AuthenticatedRequest, res) => {
    const { batchId } = req.params;
    const userId = req.authUser!.id;
    const batch = await svc.getBatchById(batchId);
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });

    // Remove any prior steps for idempotency
    await db.execute('DELETE FROM incentive_approval_step WHERE batch_id = ?', [batchId]);

    for (let step = 1; step <= APPROVAL_STEP_COUNT; step++) {
      await db.execute(
        `INSERT INTO incentive_approval_step (id, batch_id, step_number, required_role, status)
         VALUES (UUID(), ?, ?, ?, ?)`,
        [batchId, step, APPROVAL_STEPS[step], step === 1 ? 'pending' : 'waiting']
      );
    }

    await db.execute(
      `UPDATE incentive_upload_batch SET status = 'approval_chain_active' WHERE id = ?`,
      [batchId]
    );

    // Create work_item for the first approver (branch_head)
    await createApprovalWorkItem(batchId, 'branch_head', userId, (batch as any).batch_ref ?? batchId);

    await writeAuditLog(userId, 'INCENTIVE_APPROVAL_CHAIN_INIT', batchId, {
      batch_ref: (batch as any).batch_ref,
      steps: APPROVAL_STEP_COUNT,
    });

    const [steps] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM incentive_approval_step WHERE batch_id = ? ORDER BY step_number',
      [batchId]
    );
    return res.status(201).json({ success: true, data: steps });
  })
);

// POST /batches/:batchId/step-approve — current approver approves current step
incentivesRouter.post('/batches/:batchId/step-approve',
  h(async (req: AuthenticatedRequest, res) => {
    const { batchId } = req.params;
    const userId = req.authUser!.id;
    const { remarks } = req.body as { remarks?: string };

    // Find the current pending step
    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM incentive_approval_step
       WHERE batch_id = ? AND status = 'pending'
       ORDER BY step_number LIMIT 1`,
      [batchId]
    );
    if (!pendingRows.length) {
      return res.status(400).json({ success: false, message: 'No pending approval step found for this batch' });
    }
    const step = pendingRows[0] as any;

    // Check requesting user has the required role
    const [userRoles] = await db.execute<RowDataPacket[]>(
      `SELECT role FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const userRole = (userRoles[0] as any)?.role ?? '';
    if (userRole !== step.required_role && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: `This step requires role: ${step.required_role}` });
    }

    await db.execute(
      `UPDATE incentive_approval_step
       SET status = 'approved', actioned_by = ?, actioned_at = NOW(), remarks = ?
       WHERE id = ?`,
      [userId, remarks ?? null, step.id]
    );

    // Activate next step if exists, else mark batch finance_approved
    // (register action is a separate step that sets fully_approved)
    const nextStep = step.step_number + 1;
    if (nextStep <= APPROVAL_STEP_COUNT) {
      await db.execute(
        `UPDATE incentive_approval_step SET status = 'pending' WHERE batch_id = ? AND step_number = ?`,
        [batchId, nextStep]
      );
      // Create work_item for the next approver role
      await createApprovalWorkItem(batchId, APPROVAL_STEPS[nextStep], userId);
    } else {
      // All 3 steps approved — finance_head is the last approver
      await db.execute(
        `UPDATE incentive_upload_batch SET status = 'finance_approved' WHERE id = ?`,
        [batchId]
      );
    }

    await writeAuditLog(userId, 'INCENTIVE_STEP_APPROVED', batchId, {
      step_number: step.step_number,
      required_role: step.required_role,
      remarks: remarks ?? null,
    });

    const [steps] = await db.execute<RowDataPacket[]>(
      'SELECT * FROM incentive_approval_step WHERE batch_id = ? ORDER BY step_number',
      [batchId]
    );
    return res.json({ success: true, data: steps });
  })
);

// POST /batches/:batchId/step-reject — current approver rejects with reason
incentivesRouter.post('/batches/:batchId/step-reject',
  h(async (req: AuthenticatedRequest, res) => {
    const { batchId } = req.params;
    const userId = req.authUser!.id;
    const { reason } = req.body as { reason?: string };

    if (!reason?.trim()) {
      return res.status(400).json({ success: false, message: 'reason is required for rejection' });
    }

    const [pendingRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM incentive_approval_step
       WHERE batch_id = ? AND status = 'pending'
       ORDER BY step_number LIMIT 1`,
      [batchId]
    );
    if (!pendingRows.length) {
      return res.status(400).json({ success: false, message: 'No pending approval step found for this batch' });
    }
    const step = pendingRows[0] as any;

    const [userRoles] = await db.execute<RowDataPacket[]>(
      `SELECT role FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const userRole = (userRoles[0] as any)?.role ?? '';
    if (userRole !== step.required_role && userRole !== 'admin') {
      return res.status(403).json({ success: false, message: `This step requires role: ${step.required_role}` });
    }

    await db.execute(
      `UPDATE incentive_approval_step
       SET status = 'rejected', actioned_by = ?, actioned_at = NOW(), remarks = ?
       WHERE id = ?`,
      [userId, reason, step.id]
    );

    await db.execute(
      `UPDATE incentive_upload_batch SET status = 'rejected' WHERE id = ?`,
      [batchId]
    );

    await writeAuditLog(userId, 'INCENTIVE_STEP_REJECTED', batchId, {
      step_number: step.step_number,
      required_role: step.required_role,
      reason,
    });

    return res.json({ success: true, message: 'Step rejected, batch marked as rejected' });
  })
);

// GET /batches/:batchId/approval-steps — get all approval steps for a batch
incentivesRouter.get('/batches/:batchId/approval-steps',
  h(async (req: AuthenticatedRequest, res) => {
    const [steps] = await db.execute<RowDataPacket[]>(
      `SELECT ias.*, u.full_name as actioned_by_name
       FROM incentive_approval_step ias
       LEFT JOIN users u ON u.id = ias.actioned_by
       WHERE ias.batch_id = ?
       ORDER BY ias.step_number`,
      [req.params.batchId]
    );
    return res.json({ success: true, data: steps });
  })
);

// GET /approvals/pending — get batches pending this user's approval
incentivesRouter.get('/approvals/pending',
  h(async (req: AuthenticatedRequest, res) => {
    const userId = req.authUser!.id;
    const [userRoles] = await db.execute<RowDataPacket[]>(
      `SELECT role FROM users WHERE id = ? LIMIT 1`,
      [userId]
    );
    const userRole = (userRoles[0] as any)?.role ?? '';

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT iub.*, ias.step_number as pending_step, ias.required_role,
              im.incentive_name, im.incentive_code
       FROM incentive_approval_step ias
       JOIN incentive_upload_batch iub ON iub.id = ias.batch_id
       JOIN incentive_master im ON im.id = iub.incentive_id
       WHERE ias.status = 'pending' AND ias.required_role = ?
       ORDER BY iub.pay_month DESC`,
      [userRole]
    );
    return res.json({ success: true, data: rows });
  })
);

// POST /batches/:batchId/register — finalize into payroll register (Finance only)
incentivesRouter.post('/batches/:batchId/register',
  requireRole('admin', 'finance'),
  h(async (req: AuthenticatedRequest, res) => {
    const { batchId } = req.params;
    const batch = await svc.getBatchById(batchId);
    if (!batch) return res.status(404).json({ success: false, message: 'Batch not found' });
    if ((batch as any).status !== 'finance_approved') {
      return res.status(400).json({ success: false, message: 'Batch must be finance_approved before registering' });
    }

    const registerId = randomUUID();
    const registerRef = `INCEN-REG-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO incentive_payroll_register
         (id, register_ref, batch_id, pay_month, total_employees, total_amount, finalized_by, finalized_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        registerId,
        registerRef,
        batchId,
        (batch as any).pay_month,
        (batch as any).total_employees ?? 0,
        (batch as any).total_amount ?? 0,
        req.authUser!.id,
      ]
    );

    // Register action completes the workflow — set fully_approved
    await db.execute(
      `UPDATE incentive_upload_batch SET status = 'fully_approved' WHERE id = ?`,
      [batchId]
    );

    await writeAuditLog(req.authUser!.id, 'INCENTIVE_REGISTER_CREATED', batchId, {
      register_id: registerId,
      register_ref: registerRef,
    });

    return res.status(201).json({ success: true, data: { id: registerId, register_ref: registerRef } });
  })
);

// GET /register — list all payroll registers
incentivesRouter.get('/register',
  requireRole('admin', 'finance', 'payroll'),
  h(async (req: AuthenticatedRequest, res) => {
    const { pay_month } = req.query as Record<string, string>;
    const params: unknown[] = [];
    let where = '1=1';
    if (pay_month) { where += ' AND ipr.pay_month = ?'; params.push(pay_month); }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ipr.*, iub.pay_month, im.incentive_name, im.incentive_code,
              u.full_name as finalized_by_name
       FROM incentive_payroll_register ipr
       JOIN incentive_upload_batch iub ON iub.id = ipr.batch_id
       JOIN incentive_master im ON im.id = iub.incentive_id
       LEFT JOIN users u ON u.id = ipr.finalized_by
       WHERE ${where}
       ORDER BY ipr.finalized_at DESC`,
      params
    );
    return res.json({ success: true, data: rows });
  })
);
