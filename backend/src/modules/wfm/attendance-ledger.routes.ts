// backend/src/modules/wfm/attendance-ledger.routes.ts
// Branch Ledger — read-only, per-branch record of every attendance correction decision:
// regularizations, mismatch resolutions, exception resolutions, disputes and manual overrides,
// with WHO RECEIVED it (the employee) and WHO GAVE it (the actor). Powers the "Branch Ledger"
// tab of the Attendance Integrity console. Mounted at /api/wfm/attendance-ledger.
//
// Access: the same view roles as mismatch-review.routes.ts (VIEW_ROLES), with the same row
// scoping — resolveUserBusinessScope + buildEmployeeScopeCondition against the `employees`
// row (alias e) — so a branch-scoped role only ever sees the branches it is assigned to.
// This router has NO write endpoints.
//
// Resilience: each of the five sources is queried on its own and wrapped by `tolerant()`; a
// source that throws contributes nothing and adds a `warnings` entry instead of failing the
// whole response. Windows are bounded (<= MAX_WINDOW_DAYS) so every source stays on its date
// index. Source definitions and the column evidence live in attendance-ledger.sources.ts.

import { Router } from 'express';
import type { RowDataPacket } from 'mysql2';
import { requireAuth } from '../../middleware/authMiddleware.js';
import { requireRole } from '../../middleware/requireRole.js';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';
import { resolveUserBusinessScope, buildEmployeeScopeCondition } from '../../shared/enterpriseScope.js';
import {
  LEDGER_KINDS, SOURCES, isLedgerKind, fetchAggregates, fetchEntries, countEntries,
  fetchDetailRecord, actorFieldsFor,
  type LedgerKind, type AggregateRow, type EntryRow, type SourceFilter,
} from './attendance-ledger.sources.js';
import {
  resolveActors, resolveEmployees, actorLabel, buildTimeline, fetchAuditTrail, fetchRelated,
  type ActorInfo,
} from './attendance-ledger.detail.js';

export const attendanceLedgerRouter = Router();

const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// Identical to VIEW_ROLES in mismatch-review.routes.ts (guarded by a contract test).
const VIEW_ROLES = [
  'wfm', 'branch_wfm', 'hr', 'admin', 'super_admin', 'ceo', 'payroll',
  'manager', 'process_manager', 'branch_head',
] as const;

const MAX_WINDOW_DAYS = 92;
const MAX_PAGE_LIMIT = 200;
const DEFAULT_PAGE_LIMIT = 50;
/** Entries from all sources are merged in memory; cap how deep a page may reach. */
const MAX_MERGE_ROWS = 2000;
const MAX_PEOPLE_ROWS = 1000;
const MS_PER_DAY = 86_400_000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

attendanceLedgerRouter.use(requireAuth);

class HttpError extends Error {
  constructor(public statusCode: number, message: string) { super(message); }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function parseDay(value: string): number | null {
  if (!DAY_RE.test(value)) return null;
  const [y, m, d] = value.split('-').map(Number);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  return back.getUTCFullYear() === y && back.getUTCMonth() === m - 1 && back.getUTCDate() === d ? t : null;
}

async function defaultMonth(): Promise<{ from: string; to: string }> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DATE_FORMAT(CURDATE(), '%Y-%m-01') AS f, DATE_FORMAT(LAST_DAY(CURDATE()), '%Y-%m-%d') AS t`,
    );
    const r = (rows as RowDataPacket[])[0];
    if (r?.f && r?.t) return { from: String(r.f), to: String(r.t) };
  } catch { /* fall through to the process clock */ }
  const now = new Date();
  const first = new Date(Date.UTC(now.getFullYear(), now.getMonth(), 1));
  const last = new Date(Date.UTC(now.getFullYear(), now.getMonth() + 1, 0));
  return { from: first.toISOString().slice(0, 10), to: last.toISOString().slice(0, 10) };
}

/** Default = current calendar month. Both bounds or neither; never wider than MAX_WINDOW_DAYS. */
async function resolveWindow(query: Record<string, unknown>): Promise<{ from: string; to: string }> {
  const from = typeof query.from === 'string' ? query.from : '';
  const to = typeof query.to === 'string' ? query.to : '';
  if (!from && !to) return defaultMonth();
  if (!from || !to) throw new HttpError(400, 'Provide both from and to (YYYY-MM-DD), or neither for the current month.');
  const a = parseDay(from);
  const b = parseDay(to);
  if (a === null || b === null) throw new HttpError(400, 'from and to must be valid dates in YYYY-MM-DD format.');
  if (b < a) throw new HttpError(400, 'to must not be before from.');
  if ((b - a) / MS_PER_DAY + 1 > MAX_WINDOW_DAYS) {
    throw new HttpError(400, `Date window is limited to ${MAX_WINDOW_DAYS} days.`);
  }
  return { from, to };
}

async function loadScope(req: any): Promise<{ sql: string; params: unknown[]; isGlobal: boolean }> {
  const scope = await resolveUserBusinessScope(req.authUser);
  const cond = buildEmployeeScopeCondition(scope, {
    employeeId: 'e.id',
    branchId: 'e.branch_id',
    processId: 'e.process_id',
    departmentId: 'e.department_id',
    managerEmployeeId: 'e.reporting_manager_id',
  });
  const isGlobal = cond.sql === '1=1' || (scope.assignments ?? []).some((a) => a.scopeType === 'all');
  return { sql: cond.sql, params: cond.params, isGlobal };
}

/** One source failing must not fail the ledger: empty result + a warning instead. */
async function tolerant<T>(kind: LedgerKind, warnings: string[], run: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logger.error({ err, source: kind }, '[attendance-ledger] source query failed');
    warnings.push(`${SOURCES[kind].label} data could not be loaded; it is missing from this view.`);
    return empty;
  }
}

function optStr(value: unknown, max = 100): string | undefined {
  if (typeof value !== 'string') return undefined;
  const v = value.trim();
  return v ? v.slice(0, max) : undefined;
}

function requireId(value: unknown, what: string): string {
  if (typeof value !== 'string' || !ID_RE.test(value)) throw new HttpError(400, `Invalid ${what}.`);
  return value;
}

async function baseFilter(req: any, branchId?: string): Promise<{ filter: SourceFilter; isGlobal: boolean }> {
  const [win, scope] = await Promise.all([resolveWindow(req.query), loadScope(req)]);
  const q = req.query;
  const filter: SourceFilter = {
    from: win.from, to: win.to, scopeSql: scope.sql, scopeParams: scope.params,
    branchId, employeeId: optStr(q.employeeId), actorId: optStr(q.actorId), search: optStr(q.search, 60),
  };
  return { filter, isGlobal: scope.isGlobal };
}

async function collectAggregates(filter: SourceFilter, warnings: string[]): Promise<AggregateRow[]> {
  const parts = await Promise.all(
    LEDGER_KINDS.map((k) => tolerant(k, warnings, () => fetchAggregates(k, filter), [] as AggregateRow[])),
  );
  return parts.flat();
}

// ── Summary ───────────────────────────────────────────────────────────────────

interface BranchTally {
  branch_id: string;
  branch_name: string | null;
  regularizations: { total: number; approved: number; rejected: number; pending: number; other: number };
  mismatch_resolutions: number;
  exception_resolutions: number;
  disputes: number;
  manual_overrides: number;
  total_actions: number;
  employees_affected: number;
  actors: number;
}

function emptyTally(branchId: string, name: string | null): BranchTally {
  return {
    branch_id: branchId, branch_name: name,
    regularizations: { total: 0, approved: 0, rejected: 0, pending: 0, other: 0 },
    mismatch_resolutions: 0, exception_resolutions: 0, disputes: 0, manual_overrides: 0,
    total_actions: 0, employees_affected: 0, actors: 0,
  };
}

interface BranchNames { names: Map<string, string | null>; activeIds: Set<string> }

function tallyBranches(rows: AggregateRow[], branches: BranchNames, includeAll: boolean): BranchTally[] {
  const { names, activeIds } = branches;
  const tallies = new Map<string, BranchTally>();
  const people = new Map<string, { emp: Set<string>; act: Set<string> }>();
  if (includeAll) for (const id of activeIds) tallies.set(id, emptyTally(id, names.get(id) ?? null));
  for (const r of rows) {
    if (!r.branch_id) continue; // an employee with no branch cannot be attributed to one
    const t = tallies.get(r.branch_id) ?? emptyTally(r.branch_id, names.get(r.branch_id) ?? null);
    const sets = people.get(r.branch_id) ?? { emp: new Set<string>(), act: new Set<string>() };
    sets.emp.add(r.employee_id);
    if (r.actor_id) sets.act.add(r.actor_id);
    people.set(r.branch_id, sets);
    if (r.kind === 'regularization') {
      t.regularizations.total += r.n;
      const bucket = r.bucket as 'approved' | 'rejected' | 'pending' | 'other';
      t.regularizations[bucket] += r.n;
    } else if (r.kind === 'mismatch_resolution') t.mismatch_resolutions += r.n;
    else if (r.kind === 'exception_resolution') t.exception_resolutions += r.n;
    else if (r.kind === 'dispute') t.disputes += r.n;
    else t.manual_overrides += r.n;
    t.total_actions += r.n;
    tallies.set(r.branch_id, t);
  }
  for (const [id, t] of tallies) {
    t.employees_affected = people.get(id)?.emp.size ?? 0;
    t.actors = people.get(id)?.act.size ?? 0;
  }
  return Array.from(tallies.values()).sort((a, b) => (a.branch_name ?? '').localeCompare(b.branch_name ?? ''));
}

async function loadBranchNames(warnings: string[]): Promise<BranchNames> {
  const out: BranchNames = { names: new Map(), activeIds: new Set() };
  try {
    const [rows] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name, active_status FROM branch_master`);
    for (const r of rows as RowDataPacket[]) {
      out.names.set(String(r.id), r.branch_name ?? null);
      if (Number(r.active_status) === 1) out.activeIds.add(String(r.id));
    }
  } catch (err) {
    logger.error({ err }, '[attendance-ledger] branch names failed');
    warnings.push('Branch names could not be loaded.');
  }
  return out;
}

attendanceLedgerRouter.get(
  '/summary',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const warnings: string[] = [];
    const { filter, isGlobal } = await baseFilter(req, optStr(req.query.branchId));
    const [rows, branchNames] = await Promise.all([collectAggregates(filter, warnings), loadBranchNames(warnings)]);
    // Org-wide viewers also see branches with zero activity (that is information); a scoped
    // viewer only sees branches that produced rows for them.
    const branches = tallyBranches(rows, branchNames, isGlobal && !filter.branchId);
    const distinctEmployees = new Set(rows.map((r) => r.employee_id));
    const distinctActors = new Set(rows.filter((r) => r.actor_id).map((r) => r.actor_id));
    res.json({
      success: true,
      data: {
        window: { from: filter.from, to: filter.to },
        scope_is_global: isGlobal,
        branches,
        totals: {
          total_actions: branches.reduce((s, b) => s + b.total_actions, 0),
          employees_affected: distinctEmployees.size,
          actors: distinctActors.size,
        },
        warnings,
      },
    });
  }),
);

// ── Entries (unified chronological list for one branch) ──────────────────────

function byActedAtDesc(a: EntryRow, b: EntryRow): number {
  const cmp = (b.acted_at ?? '').localeCompare(a.acted_at ?? '');
  return cmp !== 0 ? cmp : b.source_id.localeCompare(a.source_id);
}

attendanceLedgerRouter.get(
  '/branch/:branchId/entries',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const branchId = requireId(req.params.branchId, 'branch id');
    const type = optStr(req.query.type);
    if (type && !isLedgerKind(type)) throw new HttpError(400, `Invalid type: ${type}`);
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(MAX_PAGE_LIMIT, Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_LIMIT));
    const take = page * limit;
    if (take > MAX_MERGE_ROWS) throw new HttpError(400, 'That page is too deep. Narrow the filters or the date range.');

    const warnings: string[] = [];
    const { filter } = await baseFilter(req, branchId);
    const kinds: readonly LedgerKind[] = type && isLedgerKind(type) ? [type] : LEDGER_KINDS;
    const results = await Promise.all(kinds.map((kind) =>
      tolerant(kind, warnings, async () => {
        const [total, rows] = await Promise.all([countEntries(kind, filter), fetchEntries(kind, filter, take)]);
        return { kind, total, rows };
      }, { kind, total: 0, rows: [] as EntryRow[] })));

    const merged = results.flatMap((r) => r.rows).sort(byActedAtDesc);
    const pageRows = merged.slice((page - 1) * limit, page * limit);
    const actors = await resolveActors(pageRows.map((r) => r.actor_id));
    const data = pageRows.map((r) => ({
      ...r,
      given_by: r.actor_id ? actors.get(r.actor_id) ?? null : null,
      given_by_label: actorLabel(r.kind, r.decision, r.actor_id),
    }));
    const countsByKind = Object.fromEntries(results.map((r) => [r.kind, r.total]));
    res.json({
      success: true,
      data,
      total: results.reduce((s, r) => s + r.total, 0),
      counts_by_kind: countsByKind,
      page, limit,
      window: { from: filter.from, to: filter.to },
      warnings,
    });
  }),
);

// ── People matrix: to whom, by whom ──────────────────────────────────────────

attendanceLedgerRouter.get(
  '/branch/:branchId/people',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const branchId = requireId(req.params.branchId, 'branch id');
    const warnings: string[] = [];
    const { filter } = await baseFilter(req, branchId);
    const rows = await collectAggregates({ ...filter, actorId: undefined, employeeId: undefined }, warnings);

    const pairs = new Map<string, { employee_id: string; actor_id: string | null; counts: Record<string, number>; total: number }>();
    const actorTotals = new Map<string, { actor_id: string | null; counts: Record<string, number>; total: number }>();
    for (const r of rows) {
      const key = `${r.employee_id}|${r.actor_id ?? ''}`;
      const p = pairs.get(key) ?? { employee_id: r.employee_id, actor_id: r.actor_id, counts: {}, total: 0 };
      p.counts[r.kind] = (p.counts[r.kind] ?? 0) + r.n;
      p.total += r.n;
      pairs.set(key, p);
      const a = actorTotals.get(r.actor_id ?? '') ?? { actor_id: r.actor_id, counts: {}, total: 0 };
      a.counts[r.kind] = (a.counts[r.kind] ?? 0) + r.n;
      a.total += r.n;
      actorTotals.set(r.actor_id ?? '', a);
    }
    const sorted = Array.from(pairs.values()).sort((a, b) => b.total - a.total);
    const kept = sorted.slice(0, MAX_PEOPLE_ROWS);
    const [actors, employees] = await Promise.all([
      resolveActors(Array.from(actorTotals.values()).map((a) => a.actor_id)),
      resolveEmployees(kept.map((p) => p.employee_id)),
    ]);
    res.json({
      success: true,
      data: {
        window: { from: filter.from, to: filter.to },
        truncated: sorted.length > kept.length,
        rows: kept.map((p) => ({
          employee: employees.get(p.employee_id) ?? { employee_id: p.employee_id, name: null, code: null },
          given_by: p.actor_id ? actors.get(p.actor_id) ?? null : null,
          counts: p.counts,
          total: p.total,
        })),
        actors: Array.from(actorTotals.values())
          .filter((a) => a.actor_id)
          .sort((a, b) => b.total - a.total)
          .map((a) => ({ ...(actors.get(a.actor_id as string) as ActorInfo), counts: a.counts, total: a.total })),
        warnings,
      },
    });
  }),
);

// ── Drawer detail ─────────────────────────────────────────────────────────────

attendanceLedgerRouter.get(
  '/entries/:kind/:id',
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const kind = req.params.kind;
    if (!isLedgerKind(kind)) throw new HttpError(400, `Invalid kind: ${String(kind)}`);
    const id = requireId(req.params.id, 'entry id');
    const scope = await loadScope(req);
    // Out-of-scope and non-existent are both 404: scope must not become an existence oracle.
    const record = await fetchDetailRecord(kind, id, { scopeSql: scope.sql, scopeParams: scope.params });
    if (!record) return res.status(404).json({ success: false, message: 'Entry not found' });

    const warnings: string[] = [];
    const [audit, related] = await Promise.all([fetchAuditTrail(kind, record, warnings), fetchRelated(kind, record)]);
    const fields = actorFieldsFor(kind);
    const actors = await resolveActors([
      ...fields.map((f) => record[f] as string | null | undefined),
      ...audit.map((a) => a.actor_user_id as string | null),
    ]);
    const who = (field: string): ActorInfo | null => {
      const v = record[field];
      return typeof v === 'string' && v ? actors.get(v) ?? null : null;
    };
    const people = Object.fromEntries(fields.map((f) => [f, who(f)]));
    res.json({
      success: true,
      data: {
        kind,
        label: SOURCES[kind].label,
        record,
        employee: {
          id: record.employee_id, name: record.emp_name, code: record.emp_code,
          branch_id: record.emp_branch_id, branch_name: record.emp_branch_name,
        },
        people,
        timeline: buildTimeline(kind, record, who),
        audit: audit.map((a) => ({ ...a, actor: a.actor_user_id ? actors.get(String(a.actor_user_id)) ?? null : null })),
        related,
        warnings,
      },
    });
  }),
);

// ── Error mapping ─────────────────────────────────────────────────────────────

attendanceLedgerRouter.use((err: unknown, _req: any, res: any, next: any) => {
  if (err instanceof HttpError) return res.status(err.statusCode).json({ success: false, message: err.message });
  return next(err);
});
