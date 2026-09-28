import { Router } from 'express'
import { requireAuth } from '../../middleware/authMiddleware.js'
import { requireRole } from '../../middleware/requireRole.js'
import { requireClientAuth } from '../../middleware/requireClientAuth.js'
import { presentationController as c } from './presentation.controller.js'

const router = Router()
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next)

// Combined auth: sets req.portalUser (portal JWT) OR passes through to staff auth
async function requirePortalOrStaffAuth(req: any, res: any, next: any): Promise<void> {
  const header = (req.headers.authorization as string | undefined) ?? ''
  if (header.startsWith('Bearer ')) {
    const token = header.slice(7)
    try {
      const { portalAuthService } = await import('../portal/portal.auth.service.js')
      const payload = (portalAuthService as any).verifyToken(token)
      if (payload?.role === 'client') {
        req.portalUser = payload
        return next()
      }
    } catch { /* fall through to staff auth */ }
  }
  requireAuth(req, res, next)
}

// Admin: staff JWT + role check
router.post('/generate', requireAuth, requireRole('super_admin', 'hr_admin'), h(c.generate))
// Portal: portal JWT only
router.post('/generate/portal', requireClientAuth, h(c.generate))
// Download: accepts portal OR staff JWT (same URL for both)
router.get('/download/:clientId/:filename', requirePortalOrStaffAuth, h(c.download))

export { router as presentationRouter }
