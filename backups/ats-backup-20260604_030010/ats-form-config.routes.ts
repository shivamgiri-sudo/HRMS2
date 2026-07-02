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

// ADMIN/HR — auth required from here
router.use(requireAuth);

router.get('/form-config', requireRole('admin', 'hr'), h(async (_req: any, res: any) => {
  const configs = await svc.getAllConfigs();
  res.json({ success: true, data: configs });
}));

router.put('/form-config/fields', requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { fields } = req.body;
  if (!Array.isArray(fields)) return res.status(400).json({ error: 'fields must be an array' });
  await svc.updateFieldSchema(fields, req.authUser!.id);
  res.json({ success: true });
}));

router.put('/form-config/:key', requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { key } = req.params;
  const { values } = req.body;
  if (!Array.isArray(values)) return res.status(400).json({ error: 'values must be an array of strings' });
  if (key === 'formFields') return res.status(400).json({ error: 'Use PUT /form-config/fields for field schema' });
  await svc.updateOptionList(key, values, req.authUser!.id);
  res.json({ success: true });
}));

router.get('/recruiters', requireRole('admin', 'hr'), h(async (_req: any, res: any) => {
  const data = await svc.listRecruiters();
  res.json({ success: true, data });
}));

router.post('/recruiters', requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { name } = req.body;
  if (!name?.trim()) return res.status(400).json({ error: 'name is required' });
  const recruiter = await svc.createRecruiter(name);
  res.status(201).json({ success: true, data: recruiter });
}));

router.patch('/recruiters/:id', requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  const { name, active_status, sort_order } = req.body;
  await svc.updateRecruiter(req.params.id, { name, active_status, sort_order });
  res.json({ success: true });
}));

router.delete('/recruiters/:id', requireRole('admin', 'hr'), h(async (req: any, res: any) => {
  await svc.deleteRecruiter(req.params.id);
  res.json({ success: true });
}));

export { router as atsFormConfigRouter };
