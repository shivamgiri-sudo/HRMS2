/**
 * GET /api/wfm/roster-console/lob-coverage?branchId&processId
 *
 * How many active employees in the caller's scope have / lack a LOB, so the Roster Command
 * Center can show "N employees have no LOB yet". One COUNT query; no join to lob_master
 * (mixed collations in prod — employees.lob_id is only tested for NULL).
 */
import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import type { AuthenticatedRequest } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import { resolveLiveMonitoringScope } from './roster-intelligence.routes.js';

const router = Router();
router.use(requireAuth);

// Union of the roles that can already call roster-analytics / team-roster / live-monitoring endpoints.
export const LOB_COVERAGE_ROLES = [
  'super_admin', 'admin', 'hr', 'wfm', 'branch_head', 'branch_wfm', 'manager',
  'operations_manager', 'process_manager', 'ceo', 'coo',
];

export interface LobCoverageScope { branchIds?: string[]; processIds?: string[] }

export function buildLobCoverageQuery(
  scope: LobCoverageScope | undefined,
  branchId?: string,
  processId?: string
): { sql: string; params: string[] } {
  const conds = ["e.active_status = 1", "e.employment_status = 'Active'"];
  const params: string[] = [];
  if (scope?.branchIds) {
    conds.push(`e.branch_id IN (${scope.branchIds.map(() => '?').join(',')})`);
    params.push(...scope.branchIds);
  }
  if (scope?.processIds) {
    conds.push(`e.process_id IN (${scope.processIds.map(() => '?').join(',')})`);
    params.push(...scope.processIds);
  }
  if (branchId) { conds.push('e.branch_id = ?'); params.push(branchId); }
  if (processId) { conds.push('e.process_id = ?'); params.push(processId); }
  const sql =
    `SELECT COUNT(*) AS total_employees,
       SUM(CASE WHEN e.lob_id IS NOT NULL THEN 1 ELSE 0 END) AS with_lob,
       SUM(CASE WHEN e.lob_id IS NULL THEN 1 ELSE 0 END) AS without_lob
     FROM employees e
     WHERE ${conds.join(' AND ')}`;
  return { sql, params };
}

router.get('/lob-coverage', requireRole(...LOB_COVERAGE_ROLES), async (req, res) => {
  try {
    const branchId = req.query.branchId ? String(req.query.branchId) : undefined;
    const processId = req.query.processId ? String(req.query.processId) : undefined;
    const scope = await resolveLiveMonitoringScope(req as AuthenticatedRequest);
    // A scope that resolved to nothing fails closed (zero counts), like the live-monitoring endpoints.
    if (scope?.branchIds?.length === 0 || scope?.processIds?.length === 0) {
      res.json({ totalEmployees: 0, withLob: 0, withoutLob: 0 });
      return;
    }
    const q = buildLobCoverageQuery(scope, branchId, processId);
    const [rows] = await db.execute<RowDataPacket[]>(q.sql, q.params);
    const r = rows[0] ?? {};
    res.json({
      totalEmployees: Number(r.total_employees ?? 0),
      withLob: Number(r.with_lob ?? 0),
      withoutLob: Number(r.without_lob ?? 0),
    });
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Unknown error';
    console.error('[roster-console] lob-coverage error:', msg);
    res.status(500).json({ error: `Failed to get LOB coverage: ${msg}` });
  }
});

export const rosterConsoleLobCoverageRouter = router;
