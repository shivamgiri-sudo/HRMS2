import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { customizationService } from './customization.service.js';
import {
  createRuleSchema,
  updateRuleSchema,
  getRulesSchema,
  getEffectiveConfigSchema,
  previewRuleSchema,
  bulkApplySchema,
} from './customization.validation.js';
import { requireRole } from '../../middleware/requireRole.js';

const router = Router();

// Apply auth middleware to all routes
router.use(requireAuth);

type CustomizationHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h = (fn: CustomizationHandler) => (req: Request, res: Response, next: NextFunction) => {
  void fn(req as AuthenticatedRequest, res).catch(next);
};

// ─── Rules Management (Admin/HR Only) ────────────────────────────────────────

router.get('/rules', requireRole('admin', 'hr'), h(async (req, res) => {
  const filters = getRulesSchema.parse(req.query);
  const result = await customizationService.listRules(filters);
  res.json(result);
}));

router.post('/rules', requireRole('admin'), h(async (req, res) => {
  const input = createRuleSchema.parse(req.body);
  const userId = req.authUser?.id || 'system';
  const rule = await customizationService.createRule(input, userId);
  res.status(201).json(rule);
}));

router.get('/rules/:id', requireRole('admin', 'hr'), h(async (req, res) => {
  const rule = await customizationService.getRule(req.params.id);
  res.json(rule);
}));

router.patch('/rules/:id', requireRole('admin'), h(async (req, res) => {
  const input = updateRuleSchema.parse(req.body);
  const userId = req.authUser?.id || 'system';
  const rule = await customizationService.updateRule(req.params.id, input, userId);
  res.json(rule);
}));

router.delete('/rules/:id', requireRole('admin'), h(async (req, res) => {
  await customizationService.deleteRule(req.params.id);
  res.status(204).send();
}));

router.post('/rules/:id/toggle', requireRole('admin'), h(async (req, res) => {
  const rule = await customizationService.toggleRule(req.params.id);
  res.json(rule);
}));

// ─── Effective Config (All Roles) ─────────────────────────────────────────────

router.get('/effective', h(async (req, res) => {
  const input = getEffectiveConfigSchema.parse(req.query);
  const result = await customizationService.getEffectiveConfig(input);
  res.json(result);
}));

router.get('/applied/:employeeId', requireRole('admin', 'hr'), h(async (req, res) => {
  const logs = await customizationService.getAppliedRules(req.params.employeeId);
  res.json(logs);
}));

// ─── Preview & Bulk Operations (Admin Only) ───────────────────────────────────

router.post('/preview', requireRole('admin'), h(async (req, res) => {
  const input = previewRuleSchema.parse(req.body);
  const result = await customizationService.previewRule(input);
  res.json(result);
}));

router.post('/bulk-apply', requireRole('admin'), h(async (req, res) => {
  const input = bulkApplySchema.parse(req.body);
  const result = await customizationService.bulkApply(input);
  res.json(result);
}));

export default router;
