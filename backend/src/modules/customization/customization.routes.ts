import { Router } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
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

// ─── Rules Management (Admin/HR Only) ──────────────────────────────────────

router.get('/rules', requireRole('admin', 'hr'), async (req, res, next) => {
  try {
    const filters = getRulesSchema.parse(req.query);
    const result = await customizationService.listRules(filters);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/rules', requireRole('admin'), async (req, res, next) => {
  try {
    const input = createRuleSchema.parse(req.body);
    const userId = (req as any).userId || 'system';
    const rule = await customizationService.createRule(input, userId);
    res.status(201).json(rule);
  } catch (error) {
    next(error);
  }
});

router.get('/rules/:id', requireRole('admin', 'hr'), async (req, res, next) => {
  try {
    const rule = await customizationService.getRule(req.params.id);
    res.json(rule);
  } catch (error) {
    if (error instanceof Error && error.message === 'Rule not found') {
      return res.status(404).json({ error: 'Rule not found' });
    }
    next(error);
  }
});

router.patch('/rules/:id', requireRole('admin'), async (req, res, next) => {
  try {
    const input = updateRuleSchema.parse(req.body);
    const userId = (req as any).userId || 'system';
    const rule = await customizationService.updateRule(req.params.id, input, userId);
    res.json(rule);
  } catch (error) {
    next(error);
  }
});

router.delete('/rules/:id', requireRole('admin'), async (req, res, next) => {
  try {
    await customizationService.deleteRule(req.params.id);
    res.status(204).send();
  } catch (error) {
    next(error);
  }
});

router.post('/rules/:id/toggle', requireRole('admin'), async (req, res, next) => {
  try {
    const rule = await customizationService.toggleRule(req.params.id);
    res.json(rule);
  } catch (error) {
    next(error);
  }
});

// ─── Effective Config (All Roles) ──────────────────────────────────────────

router.get('/effective', async (req, res, next) => {
  try {
    const input = getEffectiveConfigSchema.parse(req.query);
    const result = await customizationService.getEffectiveConfig(input);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.get('/applied/:employeeId', requireRole('admin', 'hr'), async (req, res, next) => {
  try {
    const logs = await customizationService.getAppliedRules(req.params.employeeId);
    res.json(logs);
  } catch (error) {
    next(error);
  }
});

// ─── Preview & Bulk Operations (Admin Only) ────────────────────────────────

router.post('/preview', requireRole('admin'), async (req, res, next) => {
  try {
    const input = previewRuleSchema.parse(req.body);
    const result = await customizationService.previewRule(input);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

router.post('/bulk-apply', requireRole('admin'), async (req, res, next) => {
  try {
    const input = bulkApplySchema.parse(req.body);
    const result = await customizationService.bulkApply(input);
    res.json(result);
  } catch (error) {
    next(error);
  }
});

export default router;
