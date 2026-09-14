import { Request, Response, NextFunction } from 'express';
import { getPlanningMode } from './planning-mode.service.js';

export async function requireVolumeBased(req: Request, res: Response, next: NextFunction): Promise<void> {
  // Extract processId from query or params
  const processId = (req.query.processId ?? req.params.processId ?? req.params.id) as string | undefined;

  if (!processId) {
    res.status(400).json({ error: 'processId is required for this feature' });
    return;
  }

  try {
    const mode = await getPlanningMode(processId);
    if (mode !== 'VOLUME_BASED') {
      res.status(403).json({ error: 'This feature requires VOLUME_BASED planning mode for the selected process' });
      return;
    }
    next();
  } catch (err) {
    next(err);
  }
}
