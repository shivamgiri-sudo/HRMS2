import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';

import * as svc from './payrollMasters.service.js';
import {
  CreateSlabSchema, UpdateSlabSchema,
  CreatePackageSchema, UpdatePackageSchema,
  CreateMatrixEntrySchema, UpdateMatrixEntrySchema, BulkMatrixUpsertSchema,
  CreateMinWageSchema, UpdateMinWageSchema,
} from './payrollMasters.validation.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

export const payrollMastersRouter = Router();
payrollMastersRouter.use(requireAuth);

// ── SLABS ─────────────────────────────────────────────────────────────────────
payrollMastersRouter.get('/slabs', h(async (_req, res) => {
  const data = await svc.listSlabs();
  res.json({ success: true, data });
}));

payrollMastersRouter.post('/slabs', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = CreateSlabSchema.parse(req.body);
  const data = await svc.createSlab(parsed);
  res.status(201).json({ success: true, data });
}));

payrollMastersRouter.put('/slabs/:id', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = UpdateSlabSchema.parse(req.body);
  const data = await svc.updateSlab(req.params.id, parsed);
  res.json({ success: true, data });
}));

payrollMastersRouter.delete('/slabs/:id', requireRole('admin'), h(async (req, res) => {
  await svc.deleteSlab(req.params.id);
  res.json({ success: true });
}));

// ── PACKAGES ──────────────────────────────────────────────────────────────────
payrollMastersRouter.get('/packages', h(async (req, res) => {
  const { grade_id, slab_id, location_id } = req.query as Record<string, string>;
  const data = await svc.listPackages({ grade_id, slab_id, location_id });
  res.json({ success: true, data });
}));

payrollMastersRouter.get('/packages/:id', h(async (req, res) => {
  const data = await svc.getPackageById(req.params.id);
  if (!data) return res.status(404).json({ error: 'Package not found' });
  res.json({ success: true, data });
}));

payrollMastersRouter.post('/packages', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = CreatePackageSchema.parse(req.body);
  const data = await svc.createPackage(parsed, req.authUser?.id ?? '');
  res.status(201).json({ success: true, data });
}));

payrollMastersRouter.put('/packages/:id', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = UpdatePackageSchema.parse(req.body);
  const data = await svc.updatePackage(req.params.id, parsed);
  res.json({ success: true, data });
}));

payrollMastersRouter.delete('/packages/:id', requireRole('admin'), h(async (req, res) => {
  await svc.deletePackage(req.params.id);
  res.json({ success: true });
}));

// ── MATRIX ────────────────────────────────────────────────────────────────────
// NOTE: static routes BEFORE dynamic :id routes
payrollMastersRouter.get('/matrix/lookup', h(async (req, res) => {
  const { department_id, designation_id } = req.query as Record<string, string>;
  if (!department_id || !designation_id) {
    return res.status(400).json({ error: 'department_id and designation_id are required' });
  }
  const data = await svc.lookupBandForDesignation(department_id, designation_id);
  res.json({ success: true, data });
}));

payrollMastersRouter.post('/matrix/bulk-upsert', requireRole('admin', 'hr'), h(async (req, res) => {
  const parsed = BulkMatrixUpsertSchema.parse(req.body);
  const data = await svc.bulkUpsertMatrix(parsed, req.authUser?.id ?? '');
  res.json({ success: true, data });
}));

payrollMastersRouter.get('/matrix', h(async (req, res) => {
  const { department_id } = req.query as Record<string, string>;
  const data = await svc.listMatrix(department_id);
  res.json({ success: true, data });
}));

payrollMastersRouter.post('/matrix', requireRole('admin', 'hr'), h(async (req, res) => {
  const parsed = CreateMatrixEntrySchema.parse(req.body);
  const data = await svc.createMatrixEntry(parsed, req.authUser?.id ?? '');
  res.status(201).json({ success: true, data });
}));

payrollMastersRouter.put('/matrix/:id', requireRole('admin', 'hr'), h(async (req, res) => {
  const parsed = UpdateMatrixEntrySchema.parse(req.body);
  const data = await svc.updateMatrixEntry(req.params.id, parsed);
  res.json({ success: true, data });
}));

payrollMastersRouter.delete('/matrix/:id', requireRole('admin'), h(async (req, res) => {
  await svc.deleteMatrixEntry(req.params.id);
  res.json({ success: true });
}));

// ── MINIMUM WAGES ─────────────────────────────────────────────────────────────
payrollMastersRouter.get('/minimum-wages', h(async (_req, res) => {
  const data = await svc.listMinWages();
  res.json({ success: true, data });
}));

payrollMastersRouter.post('/minimum-wages', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = CreateMinWageSchema.parse(req.body);
  const data = await svc.createMinWage(parsed);
  res.status(201).json({ success: true, data });
}));

payrollMastersRouter.patch('/minimum-wages/:id', requireRole('admin', 'finance'), h(async (req, res) => {
  const parsed = UpdateMinWageSchema.parse(req.body);
  const data = await svc.updateMinWage(req.params.id, parsed);
  res.json({ success: true, data });
}));

payrollMastersRouter.delete('/minimum-wages/:id', requireRole('admin'), h(async (req, res) => {
  await svc.deleteMinWage(req.params.id);
  res.json({ success: true });
}));
