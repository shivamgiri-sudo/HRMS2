import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, type AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import * as service from './social-feed.service.js';
import { SOCIAL_LINK_PLATFORMS } from './social-feed.types.js';

export const socialFeedRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

socialFeedRouter.use(requireAuth);

// ── Employee endpoints (all authenticated employees) ──────────────────────

socialFeedRouter.get('/posts', h(async (req: AuthenticatedRequest, res) => {
  const { platform = 'all', page = '1', limit = '10' } = req.query as Record<string, string>;
  const platformParsed = z.enum(['all', 'facebook', 'instagram', 'youtube']).parse(platform);
  const pageNum = Math.max(1, Number(page));
  const limitNum = Math.min(50, Math.max(1, Number(limit)));

  const result = await service.getPosts(platformParsed, pageNum, limitNum);
  return res.json({ success: true, ...result });
}));

// ── Admin-only endpoints ──────────────────────────────────────────────────

socialFeedRouter.get(
  '/admin/config',
  requireRole('super_admin', 'hr_admin'),
  h(async (_req, res) => {
    const configs = await service.getAdminConfigs();
    const counts = await service.getPostCounts();
    return res.json({ success: true, configs, counts });
  }),
);

const saveConfigSchema = z.object({
  platform: z.enum(['facebook', 'instagram', 'youtube']),
  page_id: z.string().trim().min(1),
  plain_token: z.string().trim().optional(),
  token_expiry: z.string().datetime({ offset: true }).optional().nullable(),
  enabled: z.boolean().optional(),
});

socialFeedRouter.post(
  '/admin/config',
  requireRole('super_admin', 'hr_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const body = saveConfigSchema.parse(req.body);
    await service.saveAdminConfig({
      platform: body.platform,
      page_id: body.page_id,
      plainToken: body.plain_token,
      token_expiry: body.token_expiry ?? null,
      enabled: body.enabled,
    });
    return res.json({ success: true });
  }),
);

socialFeedRouter.post(
  '/admin/sync',
  requireRole('super_admin', 'hr_admin'),
  h(async (_req, res) => {
    const results = await service.syncAllPlatforms();
    return res.json({ success: true, synced: results });
  }),
);

// ── Public profile links — admin read/write ───────────────────────────────
// The matching read endpoint for unauthenticated callers (the login page)
// lives in social-links.public.routes.ts, mounted above the "/api" catch-all.

socialFeedRouter.get(
  '/admin/profile-links',
  requireRole('super_admin', 'hr_admin'),
  h(async (_req, res) => {
    const links = await service.getProfileLinks();
    return res.json({ success: true, links });
  }),
);

const profileLinkSchema = z.object({
  platform: z.enum(SOCIAL_LINK_PLATFORMS),
  profile_url: z
    .string()
    .trim()
    .min(1)
    .max(500)
    .url()
    .refine((u) => /^https?:\/\//i.test(u), 'URL must start with http:// or https://'),
  handle: z.string().trim().max(120).optional().nullable(),
  enabled: z.boolean().optional(),
});

socialFeedRouter.put(
  '/admin/profile-links',
  requireRole('super_admin', 'hr_admin'),
  h(async (req: AuthenticatedRequest, res) => {
    const body = z.object({ links: z.array(profileLinkSchema).min(1) }).parse(req.body);
    await service.saveProfileLinks(body.links, req.authUser?.id ?? null);
    const links = await service.getProfileLinks();
    return res.json({ success: true, links });
  }),
);
