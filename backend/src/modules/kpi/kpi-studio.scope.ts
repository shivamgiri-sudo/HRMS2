/**
 * KPI Studio — who may author or compute WHAT.
 *
 * The router's role lists decide who may use the Studio at all. They never decided whose KPIs: a
 * process_manager could save a definition for, or recompute, any process in the company. A formula
 * decides what appears on somebody's appraisal and compute overwrites stored scores, so the target
 * has to be inside the caller's own assignment scope.
 *
 * The decisions are pure (unit-tested); the async helpers only gather the caller's scope, from the
 * same predicate every other surface uses (buildScopeWhereClause via the analytics scope module).
 */
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { isOrgWide, readableProcessIds } from '../analytics-catalogue/scope.js';

export interface StudioViewer {
  orgWide: boolean;
  processIds: ReadonlySet<string>;
  /** Branches where the viewer can read EVERY active process, so a branch-wide change is theirs to make. */
  fullBranchIds: ReadonlySet<string>;
}
export interface ScopeTarget {
  branch_id?: string | null; process_id?: string | null; designation_id?: string | null;
  employee_id?: string | null; employeeProcessId?: string | null;
}
export interface Decision { ok: boolean; message?: string }

export class StudioForbiddenError extends Error {
  constructor(message: string) { super(message); this.name = 'StudioForbiddenError'; }
}

const no = (message: string): Decision => ({ ok: false, message });

export function authorDecision(target: ScopeTarget, viewer: StudioViewer): Decision {
  if (viewer.orgWide) return { ok: true };
  if (target.employee_id) {
    return target.employeeProcessId && viewer.processIds.has(target.employeeProcessId)
      ? { ok: true } : no('That employee is not in one of the processes you manage.');
  }
  if (target.process_id) {
    return viewer.processIds.has(target.process_id)
      ? { ok: true } : no('You can only change KPIs for the processes you manage.');
  }
  if (target.branch_id) {
    return viewer.fullBranchIds.has(target.branch_id)
      ? { ok: true } : no('A branch-wide KPI needs access to every process in that branch. Choose one of your processes instead.');
  }
  return no('A company-wide KPI needs organisation-wide access. Choose one of your processes instead.');
}

export function computeDecision(
  target: { process_id?: string | null; branch_id?: string | null; employee_ids?: string[] },
  viewer: StudioViewer,
): Decision {
  if (viewer.orgWide) return { ok: true };
  if (target.process_id) {
    return viewer.processIds.has(target.process_id) ? { ok: true } : no('You can only compute KPIs for the processes you manage.');
  }
  if (target.branch_id) {
    return viewer.fullBranchIds.has(target.branch_id) ? { ok: true } : no('Computing a whole branch needs access to every process in it. Pick a process you manage.');
  }
  return no('Pick a process you manage: computing for the whole company needs organisation-wide access.');
}

/** WHERE fragment for listDefinitions (aliases d = definition, e = its employee). */
export function definitionVisibilitySql(viewer: StudioViewer): { sql: string; params: unknown[] } {
  if (viewer.orgWide) return { sql: '1=1', params: [] };
  const ids = [...viewer.processIds];
  // Branch / company / designation level definitions are inherited by the viewer's people, so they may read them.
  const inherited = '(d.process_id IS NULL AND d.employee_id IS NULL)';
  if (!ids.length) return { sql: inherited, params: [] };
  const marks = ids.map(() => '?').join(',');
  return { sql: `(d.process_id IN (${marks}) OR e.process_id IN (${marks}) OR ${inherited})`, params: [...ids, ...ids] };
}

export async function studioViewerFor(userId: string): Promise<StudioViewer> {
  if (await isOrgWide(userId)) return { orgWide: true, processIds: new Set(), fullBranchIds: new Set() };
  const processIds = await readableProcessIds(userId);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_id FROM process_master WHERE active_status = 1 AND branch_id IS NOT NULL`,
  );
  const total = new Map<string, number>(); const mine = new Map<string, number>();
  for (const r of rows as any[]) {
    const b = String(r.branch_id);
    total.set(b, (total.get(b) ?? 0) + 1);
    if (processIds.has(String(r.id))) mine.set(b, (mine.get(b) ?? 0) + 1);
  }
  const fullBranchIds = new Set([...total].filter(([b, n]) => mine.get(b) === n).map(([b]) => b));
  return { orgWide: false, processIds, fullBranchIds };
}

async function employeeProcess(employeeId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(`SELECT process_id FROM employees WHERE id = ? LIMIT 1`, [employeeId]);
  const p = (rows as any[])[0]?.process_id;
  return p ? String(p) : null;
}

/** Throws StudioForbiddenError unless the caller may author for this scope. */
export async function assertCanAuthor(userId: string, target: ScopeTarget): Promise<void> {
  const viewer = await studioViewerFor(userId);
  if (viewer.orgWide) return;
  const employeeProcessId = target.employee_id ? await employeeProcess(String(target.employee_id)) : null;
  const d = authorDecision({ ...target, employeeProcessId }, viewer);
  if (!d.ok) throw new StudioForbiddenError(d.message ?? 'Not allowed');
}

export async function assertCanCompute(userId: string, target: { process_id?: string | null; branch_id?: string | null; employee_ids?: string[] }): Promise<void> {
  const d = computeDecision(target, await studioViewerFor(userId));
  if (!d.ok) throw new StudioForbiddenError(d.message ?? 'Not allowed');
}

/** The scope a stored definition targets, for retire checks. */
export async function definitionTarget(id: string): Promise<ScopeTarget | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id, process_id, designation_id, employee_id FROM kpi_studio_definition WHERE id = ? LIMIT 1`, [id]);
  return ((rows as any[])[0] as ScopeTarget | undefined) ?? null;
}
