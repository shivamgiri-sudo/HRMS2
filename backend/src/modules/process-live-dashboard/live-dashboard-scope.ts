/**
 * Role + branch scope for /api/process-live/*.
 *
 * These dashboards open inside Process Operations, whose picker offers a
 * process only to users scoped to it (readableProcessIds: viewer roles, then
 * the user's all / branch / process assignments). Before this guard the API
 * checked only that a caller was logged in, so any employee could read any
 * process's call data, agent names and APR by calling it directly.
 *
 * A request for group G (/api/process-live/G/...) passes when the caller can
 * read at least one process whose live dashboard calls G (LIVE_GROUP_USERS).
 * super_admin, admin and ceo read every group.
 */
import type { NextFunction, Request, Response } from 'express';
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { hasAnyRole } from '../../shared/scopeAccess.js';
import { readableProcessIds } from '../process-operations/process-operations.service.js';
import { detectLiveDashboard, groupsForDashboards, LIVE_GROUP_USERS } from './live-dashboard-keys.js';

const ALL = Symbol('all');
type Grant = Set<string> | typeof ALL;

// A dashboard load fires ~8 requests at once; resolving scope once per user per
// minute keeps that to one round of lookups. Role or assignment changes take
// effect within the minute.
const TTL_MS = 60_000;
const cache = new Map<string, { grant: Grant; at: number }>();

async function resolveGrant(userId: string): Promise<Grant> {
  if (await hasAnyRole(userId, 'super_admin', 'admin', 'ceo')) return ALL;
  const ids = [...await readableProcessIds(userId)];
  if (ids.length === 0) return new Set();
  const [rows] = await db.query<RowDataPacket[]>(
    'SELECT process_name, process_code FROM process_master WHERE id IN (?) AND active_status = 1', [ids]);
  const dashboards = rows
    .map((r) => detectLiveDashboard(String(r.process_name ?? ''), r.process_code == null ? null : String(r.process_code)))
    .filter((d): d is NonNullable<typeof d> => d !== null);
  return groupsForDashboards(dashboards);
}

async function grantFor(userId: string): Promise<Grant> {
  const hit = cache.get(userId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.grant;
  const grant = await resolveGrant(userId);
  if (cache.size > 5000) cache.clear();
  cache.set(userId, { grant, at: Date.now() });
  return grant;
}

export async function requireLiveScope(req: Request, res: Response, next: NextFunction) {
  try {
    const userId = (req as Request & { authUser?: { id: string } }).authUser?.id;
    if (!userId) {
      res.status(401).json({ ok: false, error: 'Not signed in.' });
      return;
    }
    const group = req.path.split('/')[1] ?? '';
    const grant = await grantFor(userId);
    if (grant === ALL || (group in LIVE_GROUP_USERS && grant.has(group))) {
      next();
      return;
    }
    res.status(403).json({ ok: false, error: 'This live dashboard is outside your branch or process scope.' });
  } catch (err) {
    next(err);
  }
}
