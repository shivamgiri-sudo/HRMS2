import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';

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
