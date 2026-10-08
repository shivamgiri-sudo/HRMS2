import { Router, Request, Response } from 'express';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import {
  listAliases,
  createAlias,
  updateAlias,
  deleteAlias,
  resolveAliases,
} from './shift-alias.service.js';

const router = Router();

/**
 * GET /api/wfm/shift-aliases
 * List all shift aliases, optionally filtered by shiftId
 */
router.get(
  '/',
  requireAuth,
  requireRole('wfm', 'admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const shiftId = req.query.shiftId as string | undefined;
      const aliases = await listAliases(shiftId);
      res.json({ aliases });
    } catch (error) {
      console.error('Error listing shift aliases:', error);
      res.status(500).json({ error: 'Failed to list shift aliases' });
    }
  }
);

/**
 * POST /api/wfm/shift-aliases
 * Create a new shift alias
 */
router.post(
  '/',
  requireAuth,
  requireRole('wfm', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const { shiftId, alias } = req.body;

      if (!shiftId || !alias) {
        return res
          .status(400)
          .json({ error: 'shiftId and alias are required' });
      }

      const userId = (req as any).userId;
      const newAlias = await createAlias(shiftId, alias, userId);
      res.status(201).json({ alias: newAlias });
    } catch (error: any) {
      if (error.statusCode === 409) {
        return res.status(409).json({ error: 'Alias already exists' });
      }
      console.error('Error creating shift alias:', error);
      res.status(500).json({ error: 'Failed to create shift alias' });
    }
  }
);

/**
 * PATCH /api/wfm/shift-aliases/:id
 * Update a shift alias
 */
router.patch(
  '/:id',
  requireAuth,
  requireRole('wfm', 'admin'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);
      const { alias, isActive } = req.body;

      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid alias ID' });
      }

      const updates: { alias?: string; isActive?: boolean } = {};
      if (alias !== undefined) updates.alias = alias;
      if (isActive !== undefined) updates.isActive = isActive;

      const updated = await updateAlias(id, updates);
      res.json({ alias: updated });
    } catch (error) {
      console.error('Error updating shift alias:', error);
      res.status(500).json({ error: 'Failed to update shift alias' });
    }
  }
);

/**
 * DELETE /api/wfm/shift-aliases/:id
 * Delete a shift alias
 */
router.delete(
  '/:id',
  requireAuth,
  requireRole('admin'),
  async (req: Request, res: Response) => {
    try {
      const id = parseInt(req.params.id, 10);

      if (isNaN(id)) {
        return res.status(400).json({ error: 'Invalid alias ID' });
      }

      await deleteAlias(id);
      res.json({ success: true });
    } catch (error) {
      console.error('Error deleting shift alias:', error);
      res.status(500).json({ error: 'Failed to delete shift alias' });
    }
  }
);

/**
 * POST /api/wfm/shift-aliases/resolve
 * Resolve shift aliases - case-insensitive mapping from alias string to shiftId
 */
router.post(
  '/resolve',
  requireAuth,
  requireRole('wfm', 'admin', 'super_admin'),
  async (req: Request, res: Response) => {
    try {
      const { aliases } = req.body;

      if (!Array.isArray(aliases)) {
        return res.status(400).json({ error: 'aliases must be an array' });
      }

      const result = await resolveAliases(aliases);

      // Convert Map to object for JSON response
      const resolved: Record<string, string | null> = {};
      for (const [key, value] of result) {
        resolved[key] = value;
      }

      res.json({ resolved });
    } catch (error) {
      console.error('Error resolving shift aliases:', error);
      res.status(500).json({ error: 'Failed to resolve shift aliases' });
    }
  }
);

export default router;
