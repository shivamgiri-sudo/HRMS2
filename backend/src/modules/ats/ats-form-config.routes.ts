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

// PUBLIC — candidate self-registration (no auth, public-facing walk-in form)
router.post('/candidates', h(async (req: any, res: any) => {
  const { db } = await import('../../db/mysql.js');
  const { fullName, mobile, email, gender, appliedForProcess, appliedForBranch, walkInDate, remarks, sourcing_channel } = req.body;
  if (!fullName?.trim() || !mobile?.trim()) {
    return res.status(400).json({ success: false, message: 'Full name and mobile are required' });
  }
  // Generate candidate code
  const candidateCode = 'CND-' + Date.now().toString(36).toUpperCase();
  // Check for duplicate mobile
  const [existing] = await db.execute('SELECT id FROM ats_candidate WHERE mobile = ? LIMIT 1', [mobile.trim()]);
  if ((existing as any[]).length > 0) {
    return res.status(409).json({ success: false, message: 'A candidate with this mobile number is already registered.' });
  }
  const [result] = await db.execute(
    `INSERT INTO ats_candidate (id, candidate_code, full_name, mobile, email, gender, applied_for_process, applied_for_branch, walk_in_date, remarks, sourcing_channel, current_stage, active_status)
     VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Applied', 1)`,
    [candidateCode, fullName.trim(), mobile.trim(), email || null, gender || null, appliedForProcess || null, appliedForBranch || null, walkInDate || new Date().toISOString().slice(0,10), remarks || null, sourcing_channel || 'Walk-In']
  ) as any;
  // Fetch the created row
  const [rows] = await db.execute('SELECT id, candidate_code, applied_for_branch FROM ats_candidate WHERE mobile = ? LIMIT 1', [mobile.trim()]) as any;
  const created = (rows as any[])[0];
  return res.status(201).json({ success: true, data: { id: created.id, candidate_code: created.candidate_code, applied_for_branch: created.applied_for_branch } });
}));

// PUBLIC — update candidate with file URLs after upload (non-sensitive, uses candidate ID)
router.put('/candidates/:id/files', h(async (req: any, res: any) => {
  const { db } = await import('../../db/mysql.js');
  const { remarks } = req.body;
  await db.execute('UPDATE ats_candidate SET remarks = CONCAT(COALESCE(remarks, ""), " | ", ?) WHERE id = ?', [remarks, req.params.id]);
  return res.json({ success: true });
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
