import { Router } from 'express';
import * as service from './social-feed.service.js';

/**
 * Unauthenticated read of the company's public social profile links.
 *
 * Mounted at /api/public/social-links ABOVE the "/api" clientRouter in app.ts,
 * which applies requireAuth to every /api/* path: the login page renders the
 * social icon row and has no session, so underneath that mount every icon
 * would fall back to its compiled-in default and the whole point of making the
 * links editable would be lost on the one page that shows them to the public.
 *
 * Only public marketing URLs are exposed — no tokens, no page IDs. Failures are
 * answered with an empty list rather than a 500, because the caller (the login
 * screen) must render with its bundled defaults even when the DB is unhappy.
 */
export const socialLinksPublicRouter = Router();

socialLinksPublicRouter.get('/', async (_req, res) => {
  try {
    const links = await service.getProfileLinks();
    return res.json({ success: true, links: links.filter((l) => l.enabled) });
  } catch (err) {
    console.error('[social-links] public read failed:', err);
    return res.json({ success: true, links: [] });
  }
});
