import { Router } from 'express';
import { authService } from './auth.service.js';
import { requireAuth } from '../../middleware/authMiddleware.js';

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

// POST /api/auth/login — public
router.post('/login', h(async (req: any, res: any) => {
  const { email, password } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  try {
    const tokens = await authService.login(email, password);
    res.json({ data: tokens });
  } catch (err: any) {
    res.status(401).json({ error: err.message || 'Authentication failed' });
  }
}));

// POST /api/auth/refresh — public
router.post('/refresh', h(async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: 'refreshToken required' });
  try {
    const tokens = await authService.refreshAccess(refreshToken);
    res.json({ data: tokens });
  } catch {
    res.status(401).json({ error: 'Invalid or expired refresh token' });
  }
}));

// POST /api/auth/logout — requires auth
router.post('/logout', requireAuth, h(async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (refreshToken) await authService.logout(refreshToken);
  res.json({ success: true });
}));

export { router as authRouter };
