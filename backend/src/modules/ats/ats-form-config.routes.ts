import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { atsFormConfigService as svc } from './ats-form-config.service.js';

const router = Router();
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// PUBLIC — no auth required (registration form is public-facing)
router.get('/form-config/bootstrap', h(async (_req: any, res: any) => {
  const data = await svc.getBootstrap();
  res.json({ success: true, data });
}));

// PUBLIC — recruiters filtered by branch (for dynamic dropdown after branch selection)
router.get('/form-config/recruiters-by-branch', h(async (req: any, res: any) => {
  const branchDisplayName = String(req.query.branch || '').trim();
  if (!branchDisplayName) return res.json({ success: true, data: [] });
  const data = await svc.getRecruitersByBranch(branchDisplayName);
  res.json({ success: true, data });
}));

// ADMIN/HR — all routes below require auth (applied per-route, not as catch-all)
router.get('/form-config', requireAuth, requireRole('admin', 'hr'), h(async (_req: any, res: any) => {
  const configs = await svc.getAllConfigs();
  res.json({ success: true, data: configs });
}));

router.put('/form-config/fields', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { fields } = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields must be an array' });
  await svc.updateFieldSchema(fields, req.authUser!.id);
  res.json({ success: true });
}));

router.put('/form-config/:key', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { key } = req.params;
  const { values } = req.body;
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array of strings' });
  if (key === 'formFields') return res.status(400).json({ error: 'Use PUT /form-config/fields for field schema' });
  await svc.updateOptionList(key, values, req.authUser!.id);
  res.json({ success: true });
}));

router.get('/recruiters', requireAuth, requireRole('admin', 'hr'), h(async (_req: any, res: any) => {
  const data = await svc.listRecruiters();
  res.json({ success: true, data });
}));

router.post('/recruiters', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const recruiter = await svc.createRecruiter(name);
  res.status(201).json({ success: true, data: recruiter });
}));

router.patch('/recruiters/:id', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { name, active_status, sort_order } = req.body;
  await svc.updateRecruiter(req.params.id, { name, active_status, sort_order });
  res.json({ success: true });
}));

router.delete('/recruiters/:id', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  await svc.deleteRecruiter(req.params.id);
  res.json({ success: true });
}));

// Branch Alias Management
router.get('/branch-aliases', requireAuth, requireRole('admin', 'hr'), h(async (_req: any, res: any) => {
  const data = await svc.listBranchAliases();
  res.json({ success: true, data });
}));

router.post('/branch-aliases', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { canonical_key, display_name, alias_text } = req.body;
  if (!canonical_key?.trim() || !display_name?.trim()) {
    return res.status(400).json({ error: 'canonical_key and display_name are required' });
  }
  const alias = await svc.createBranchAlias(canonical_key, display_name, alias_text);
  res.status(201).json({ success: true, data: alias });
}));

router.patch('/branch-aliases/:id', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { canonical_key, display_name, alias_text, active_status } = req.body;
  await svc.updateBranchAlias(req.params.id, { canonical_key, display_name, alias_text, active_status });
  res.json({ success: true });
}));

router.delete('/branch-aliases/:id', requireAuth, requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  await svc.deleteBranchAlias(req.params.id);
  res.json({ success: true });
}));

export { router as atsFormConfigRouter };
