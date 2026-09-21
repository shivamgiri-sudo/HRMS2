// Weekly roster-upload tracker: which branch × process has uploaded the roster for each W/C week.
//
// "Uploaded" means a COMMITTED roster-import batch holds rows for the process's active employees
// in that Monday–Sunday week (wfm_roster_import_row). A batch stuck in PREVIEW does not count.
// The status rules live in roster-upload-tracker.logic.ts; this file only gathers the facts.
//
// Reads never need the alert table (migration 1834): while it is missing the notification trail
// is simply empty and nothing else changes.
import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import { logger } from '../../logger.js';
import {
  addDays,
  classifyCell,
  currentWeekStart,
  deadlineMs,
  weekWindow,
  UPLOAD_STATUSES,
  type EscalationStage,
  type UploadStatus,
} from './roster-upload-tracker.logic.js';

export const DEFAULT_WEEKS = 6;
export const MAX_WEEKS = 12;
/** The default window opens this many weeks before the current one, so history stays visible. */
export const WEEKS_BEFORE_CURRENT = 3;
const MISSING_EMPLOYEE_LIMIT = 200;

const WFM_ROLE_KEYS = ['wfm', 'branch_wfm'] as const;
const PROCESS_MANAGER_ROLE_KEYS = ['process_manager'] as const;
const BRANCH_HEAD_ROLE_KEYS = ['branch_head'] as const;

export interface PersonRef {
  userId: string | null;
  employeeId: string | null;
  name: string;
}

export interface TrackerCell {
  weekStart: string;
  status: UploadStatus;
  expected: number;
  covered: number;
  uploadedAtMs: number | null;
  hoursLate: number | null;
  hoursToDeadline: number | null;
}

export interface TrackerProcessRow {
  branchId: string;
  branchName: string;
  processId: string;
  processName: string;
  managers: PersonRef[];
  cells: TrackerCell[];
}

export interface TrackerBranch {
  branchId: string;
  branchName: string;
  wfm: PersonRef[];
  processes: TrackerProcessRow[];
}

export interface TrackerWeek {
  weekStart: string;
  deadlineAtMs: number;
  isCurrent: boolean;
  counts: Record<UploadStatus, number>;
}

export interface TrackerScope {
  /** null = unrestricted (org-wide viewer). */
  branchIds: string[] | null;
  processIds: string[] | null;
}

export interface TrackerQuery {
  weeks?: number;
  /** Shifts the window by whole weeks (negative = earlier). */
  offset?: number;
  branchId?: string;
  processId?: string;
  /** Employee id or user id of a reporting manager. */
  managerId?: string;
  status?: UploadStatus;
  scope?: TrackerScope;
  nowMs?: number;
}

export interface TrackerResult {
  nowMs: number;
  weeks: TrackerWeek[];
  branches: TrackerBranch[];
  filters: {
    branches: { id: string; name: string }[];
    processes: { id: string; name: string; branchId: string }[];
    managers: { id: string; name: string }[];
  };
  summary: { currentWeek: Record<UploadStatus, number>; nextWeek: Record<UploadStatus, number> };
}

export interface PairRow {
  branchId: string;
  branchName: string;
  processId: string;
  processName: string;
  expected: number;
}

interface CoverageRow {
  covered: number;
  firstCommitMs: number;
  fullCommitMs: number;
}

const emptyCounts = (): Record<UploadStatus, number> =>
  Object.fromEntries(UPLOAD_STATUSES.map((s) => [s, 0])) as Record<UploadStatus, number>;

const pairKey = (branchId: string, processId: string): string => `${branchId}|${processId}`;
const inList = (ids: readonly unknown[]): string => ids.map(() => '?').join(',');

function isMissingObject(err: unknown): boolean {
  const e = err as { code?: string; errno?: number };
  return e?.code === 'ER_NO_SUCH_TABLE' || e?.errno === 1146 || e?.code === 'ER_BAD_FIELD_ERROR' || e?.errno === 1054;
}

async function query<T extends RowDataPacket>(sql: string, params: unknown[]): Promise<T[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
  return rows as T[];
}

/** Every active branch × process that has at least one active employee, with headcount. */
async function loadPairs(filter: { branchId?: string; processId?: string; scope?: TrackerScope }): Promise<PairRow[]> {
  const conds = [
    `e.employment_status = 'active'`,
    'e.branch_id IS NOT NULL',
    'e.process_id IS NOT NULL',
    'p.active_status = 1',
  ];
  const params: unknown[] = [];
  const restrict = (column: string, ids: string[] | null | undefined) => {
    if (ids) {
      conds.push(ids.length ? `${column} IN (${inList(ids)})` : '1 = 0');
      params.push(...ids);
    }
  };
  if (filter.branchId) { conds.push('e.branch_id = ?'); params.push(filter.branchId); }
  if (filter.processId) { conds.push('e.process_id = ?'); params.push(filter.processId); }
  restrict('e.branch_id', filter.scope?.branchIds);
  restrict('e.process_id', filter.scope?.processIds);

  const rows = await query<RowDataPacket>(
    `SELECT e.branch_id, br.branch_name, e.process_id, p.process_name, COUNT(*) AS expected
       FROM employees e
       JOIN branch_master br ON br.id = e.branch_id
       JOIN process_master p ON p.id = e.process_id
      WHERE ${conds.join(' AND ')}
      GROUP BY e.branch_id, br.branch_name, e.process_id, p.process_name
      ORDER BY br.branch_name, p.process_name`,
    params,
  );
  return rows.map((r) => ({
    branchId: String(r.branch_id),
    branchName: String(r.branch_name),
    processId: String(r.process_id),
    processName: String(r.process_name),
    expected: Number(r.expected),
  }));
}

/** Per branch × process × week: employees covered by committed uploads and when. */
async function loadCoverage(weeks: string[]): Promise<Map<string, CoverageRow>> {
  const from = weeks[0];
  const to = addDays(weeks[weeks.length - 1], 6);
  const rows = await query<RowDataPacket>(
    `SELECT e.branch_id, e.process_id, c.week_start,
            COUNT(*) AS covered, MIN(c.first_commit) AS first_commit, MAX(c.first_commit) AS full_commit
       FROM (
         SELECT r.employee_id,
                DATE_FORMAT(DATE_SUB(r.roster_date, INTERVAL WEEKDAY(r.roster_date) DAY), '%Y-%m-%d') AS week_start,
                MIN(UNIX_TIMESTAMP(b.committed_at)) AS first_commit
           FROM wfm_roster_import_batch b
           JOIN wfm_roster_import_row r ON r.batch_id = b.id
          WHERE b.status = 'COMMITTED' AND b.committed_at IS NOT NULL
            AND b.date_range_end >= ? AND b.date_range_start <= ?
            AND r.employee_id IS NOT NULL AND r.roster_date BETWEEN ? AND ?
          GROUP BY r.employee_id, week_start
       ) c
       JOIN employees e ON e.id = c.employee_id AND e.employment_status = 'active'
      GROUP BY e.branch_id, e.process_id, c.week_start`,
    [from, to, from, to],
  );
  const out = new Map<string, CoverageRow>();
  for (const r of rows) {
    out.set(`${pairKey(String(r.branch_id), String(r.process_id))}|${String(r.week_start)}`, {
      covered: Number(r.covered),
      firstCommitMs: Number(r.first_commit) * 1000,
      fullCommitMs: Number(r.full_commit) * 1000,
    });
  }
  return out;
}

const personName = (r: RowDataPacket): string => String(r.full_name ?? r.email ?? 'Unknown').trim();

/** Users holding one of `roleKeys` for each id in `column` (branch_id / process_id). */
async function loadRoleHolders(
  roleKeys: readonly string[],
  column: 'branch_id' | 'process_id',
  ids: string[],
): Promise<Map<string, PersonRef[]>> {
  const out = new Map<string, PersonRef[]>();
  if (ids.length === 0) return out;
  try {
    const rows = await query<RowDataPacket>(
      `SELECT DISTINCT uas.${column} AS scope_id, u.id AS user_id, u.email, e.id AS employee_id, e.full_name
         FROM user_assignment_scope uas
         JOIN auth_user u ON u.id = uas.user_id AND u.is_blocked = 0
         LEFT JOIN employees e ON e.user_id = u.id
        WHERE uas.active_status = 1
          AND uas.role_key IN (${inList(roleKeys)})
          AND uas.${column} IN (${inList(ids)})`,
      [...roleKeys, ...ids],
    );
    for (const r of rows) {
      const list = out.get(String(r.scope_id)) ?? [];
      const userId = String(r.user_id);
      if (!list.some((p) => p.userId === userId)) {
        list.push({ userId, employeeId: r.employee_id ? String(r.employee_id) : null, name: personName(r) });
      }
      out.set(String(r.scope_id), list);
    }
  } catch (err) {
    logger.warn({ err: (err as Error).message, roleKeys }, '[roster-upload-tracker] role-holder lookup failed');
  }
  return out;
}

/**
 * The reporting manager covering the most employees of each branch × process. Used when nobody
 * holds the process_manager role for the process, so the row still names someone.
 */
async function loadModalManagers(pairs: PairRow[]): Promise<Map<string, PersonRef>> {
  const out = new Map<string, PersonRef>();
  if (pairs.length === 0) return out;
  const processIds = [...new Set(pairs.map((p) => p.processId))];
  const rows = await query<RowDataPacket>(
    `SELECT x.branch_id, x.process_id, x.mid, m.user_id, m.full_name, x.c
       FROM (
         SELECT e.branch_id, e.process_id, COALESCE(e.reporting_manager_id, e.manager_id) AS mid, COUNT(*) AS c
           FROM employees e
          WHERE e.employment_status = 'active' AND e.process_id IN (${inList(processIds)})
            AND COALESCE(e.reporting_manager_id, e.manager_id) IS NOT NULL
          GROUP BY e.branch_id, e.process_id, mid
       ) x
       JOIN employees m ON m.id = x.mid
      ORDER BY x.branch_id, x.process_id, x.c DESC`,
    processIds,
  );
  for (const r of rows) {
    const key = pairKey(String(r.branch_id), String(r.process_id));
    if (out.has(key)) continue;
    out.set(key, { userId: r.user_id ? String(r.user_id) : null, employeeId: String(r.mid), name: personName(r) });
  }
  return out;
}

export interface RecipientDirectory {
  wfmByBranch: Map<string, PersonRef[]>;
  managersByPair: Map<string, PersonRef[]>;
}

export async function loadRecipientDirectory(pairs: PairRow[]): Promise<RecipientDirectory> {
  const branchIds = [...new Set(pairs.map((p) => p.branchId))];
  const processIds = [...new Set(pairs.map((p) => p.processId))];
  const [wfmByBranch, holdersByProcess, modal] = await Promise.all([
    loadRoleHolders(WFM_ROLE_KEYS, 'branch_id', branchIds),
    loadRoleHolders(PROCESS_MANAGER_ROLE_KEYS, 'process_id', processIds),
    loadModalManagers(pairs).catch((err) => {
      logger.warn({ err: (err as Error).message }, '[roster-upload-tracker] modal-manager lookup failed');
      return new Map<string, PersonRef>();
    }),
  ]);
  const managersByPair = new Map<string, PersonRef[]>();
  for (const p of pairs) {
    const holders = holdersByProcess.get(p.processId);
    const fallback = modal.get(pairKey(p.branchId, p.processId));
    managersByPair.set(pairKey(p.branchId, p.processId), holders?.length ? holders : fallback ? [fallback] : []);
  }
  return { wfmByBranch, managersByPair };
}

/** Manager's own reporting manager plus the branch head — the Monday 10:00 escalation targets. */
export async function loadSkipLevel(branchId: string, managers: PersonRef[]): Promise<PersonRef[]> {
  const out: PersonRef[] = [];
  const add = (p: PersonRef) => {
    if (p.userId && !out.some((o) => o.userId === p.userId)) out.push(p);
  };
  const employeeIds = managers.map((m) => m.employeeId).filter((id): id is string => Boolean(id));
  if (employeeIds.length) {
    try {
      const rows = await query<RowDataPacket>(
        `SELECT m.id AS employee_id, m.user_id, m.full_name
           FROM employees e
           JOIN employees m ON m.id = COALESCE(e.reporting_manager_id, e.manager_id)
          WHERE e.id IN (${inList(employeeIds)})`,
        employeeIds,
      );
      for (const r of rows) {
        add({ userId: r.user_id ? String(r.user_id) : null, employeeId: String(r.employee_id), name: personName(r) });
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[roster-upload-tracker] skip-level lookup failed');
    }
  }
  const heads = await loadRoleHolders(BRANCH_HEAD_ROLE_KEYS, 'branch_id', [branchId]);
  (heads.get(branchId) ?? []).forEach(add);
  return out;
}

function buildCells(pair: PairRow, weeks: string[], coverage: Map<string, CoverageRow>, nowMs: number): TrackerCell[] {
  return weeks.map((weekStart) => {
    const cov = coverage.get(`${pairKey(pair.branchId, pair.processId)}|${weekStart}`);
    const result = classifyCell({
      expected: pair.expected,
      covered: cov?.covered ?? 0,
      fullCoverageAtMs: cov?.fullCommitMs ?? null,
      firstCommitAtMs: cov?.firstCommitMs ?? null,
      weekStart,
      nowMs,
    });
    return {
      weekStart,
      status: result.status,
      expected: pair.expected,
      covered: Math.min(cov?.covered ?? 0, pair.expected),
      uploadedAtMs: cov ? cov.fullCommitMs : null,
      hoursLate: result.hoursLate,
      hoursToDeadline: result.hoursToDeadline,
    };
  });
}

export function windowFor(opts: Pick<TrackerQuery, "weeks" | "offset">, nowMs: number): string[] {
  const count = Math.min(MAX_WEEKS, Math.max(1, Math.trunc(opts.weeks ?? DEFAULT_WEEKS)));
  const shift = Math.trunc(opts.offset ?? 0);
  const first = addDays(currentWeekStart(nowMs), (shift - WEEKS_BEFORE_CURRENT) * 7);
  return weekWindow(first, count);
}

export interface GridData {
  pairs: PairRow[];
  directory: RecipientDirectory;
  rows: TrackerProcessRow[];
}

/** Rows with cells for the given weeks — shared by the API and the escalation sweep. */
export async function loadGrid(
  weeks: string[],
  nowMs: number,
  filter: { branchId?: string; processId?: string; scope?: TrackerScope } = {},
): Promise<GridData> {
  const pairs = await loadPairs(filter);
  const [coverage, directory] = await Promise.all([loadCoverage(weeks), loadRecipientDirectory(pairs)]);
  const rows = pairs.map((pair) => ({
    branchId: pair.branchId,
    branchName: pair.branchName,
    processId: pair.processId,
    processName: pair.processName,
    managers: directory.managersByPair.get(pairKey(pair.branchId, pair.processId)) ?? [],
    cells: buildCells(pair, weeks, coverage, nowMs),
  }));
  return { pairs, directory, rows };
}

const managerKey = (m: PersonRef): string => m.employeeId ?? m.userId ?? m.name;

function countAt(rows: TrackerProcessRow[], weekStart: string): Record<UploadStatus, number> {
  const counts = emptyCounts();
  for (const row of rows) {
    const cell = row.cells.find((c) => c.weekStart === weekStart);
    if (cell) counts[cell.status] += 1;
  }
  return counts;
}

export async function getTracker(q: TrackerQuery = {}): Promise<TrackerResult> {
  const nowMs = q.nowMs ?? Date.now();
  const weeks = windowFor(q, nowMs);
  const thisWeek = currentWeekStart(nowMs);
  const nextWeek = addDays(thisWeek, 7);
  // Summary always describes this and next week, whatever window the viewer scrolled to.
  const needed = [...new Set([...weeks, thisWeek, nextWeek])].sort();
  const { rows: allRows, directory } = await loadGrid(needed, nowMs, {
    branchId: q.branchId,
    processId: q.processId,
    scope: q.scope,
  });

  const managerFiltered = q.managerId
    ? allRows.filter((r) => r.managers.some((m) => m.employeeId === q.managerId || m.userId === q.managerId))
    : allRows;
  const summaryRows = managerFiltered;
  const visible = q.status
    ? managerFiltered.filter((r) => r.cells.some((c) => weeks.includes(c.weekStart) && c.status === q.status))
    : managerFiltered;

  const byBranch = new Map<string, TrackerBranch>();
  for (const row of visible) {
    const branch = byBranch.get(row.branchId) ?? {
      branchId: row.branchId,
      branchName: row.branchName,
      wfm: directory.wfmByBranch.get(row.branchId) ?? [],
      processes: [],
    };
    branch.processes.push({ ...row, cells: row.cells.filter((c) => weeks.includes(c.weekStart)) });
    byBranch.set(row.branchId, branch);
  }

  const managerOptions = new Map<string, string>();
  for (const row of allRows) for (const m of row.managers) managerOptions.set(managerKey(m), m.name);

  return {
    nowMs,
    weeks: weeks.map((weekStart) => ({
      weekStart,
      deadlineAtMs: deadlineMs(weekStart),
      isCurrent: weekStart === thisWeek,
      counts: countAt(summaryRows, weekStart),
    })),
    branches: [...byBranch.values()],
    filters: {
      branches: [...new Map(allRows.map((r) => [r.branchId, r.branchName])).entries()].map(([id, name]) => ({ id, name })),
      processes: allRows.map((r) => ({ id: r.processId, name: r.processName, branchId: r.branchId })),
      managers: [...managerOptions.entries()].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    summary: { currentWeek: countAt(summaryRows, thisWeek), nextWeek: countAt(summaryRows, nextWeek) },
  };
}

export interface AlertTrailEntry {
  stage: string;
  recipientName: string | null;
  recipientRole: string;
  sentAtMs: number;
}

/** Sent stages per "branch|process|week" for the escalation sweep. Empty until migration 1834. */
export async function loadSentStages(weeks: string[]): Promise<Map<string, Set<EscalationStage>>> {
  const out = new Map<string, Set<EscalationStage>>();
  try {
    const rows = await query<RowDataPacket>(
      `SELECT branch_id, process_id, DATE_FORMAT(week_start, '%Y-%m-%d') AS week_start, stage
         FROM wfm_roster_upload_alert
        WHERE week_start IN (${inList(weeks)}) AND stage <> 'manual'`,
      weeks,
    );
    for (const r of rows) {
      const key = `${pairKey(String(r.branch_id), String(r.process_id))}|${String(r.week_start)}`;
      const set = out.get(key) ?? new Set<EscalationStage>();
      set.add(String(r.stage) as EscalationStage);
      out.set(key, set);
    }
  } catch (err) {
    if (!isMissingObject(err)) throw err;
  }
  return out;
}

async function loadTrail(branchId: string, processId: string, weekStart: string): Promise<AlertTrailEntry[]> {
  try {
    const rows = await query<RowDataPacket>(
      `SELECT a.stage, a.recipient_role, UNIX_TIMESTAMP(a.sent_at) AS sent_at, e.full_name
         FROM wfm_roster_upload_alert a
         LEFT JOIN employees e ON e.user_id = a.recipient_user_id
        WHERE a.branch_id = ? AND a.process_id = ? AND a.week_start = ?
        ORDER BY a.sent_at`,
      [branchId, processId, weekStart],
    );
    return rows.map((r) => ({
      stage: String(r.stage),
      recipientName: r.full_name ? String(r.full_name) : null,
      recipientRole: String(r.recipient_role),
      sentAtMs: Number(r.sent_at) * 1000,
    }));
  } catch (err) {
    if (!isMissingObject(err)) throw err;
    return [];
  }
}

export interface CellDetail {
  branchId: string;
  branchName: string;
  processId: string;
  processName: string;
  weekStart: string;
  deadlineAtMs: number;
  cell: TrackerCell;
  managers: PersonRef[];
  wfm: PersonRef[];
  skipLevel: PersonRef[];
  batches: {
    id: number;
    status: string;
    fileName: string | null;
    scope: 'branch' | 'process';
    uploadedBy: string | null;
    createdAtMs: number;
    committedAtMs: number | null;
    totalRows: number;
  }[];
  uncoveredEmployees: { id: string; code: string; name: string }[];
  uncoveredTotal: number;
  trail: AlertTrailEntry[];
}

export async function getCellDetail(
  branchId: string,
  processId: string,
  weekStart: string,
  nowMs = Date.now(),
  scope?: TrackerScope,
): Promise<CellDetail | null> {
  const { rows, directory } = await loadGrid([weekStart], nowMs, { branchId, processId, scope });
  const row = rows[0];
  if (!row) return null;
  const weekEnd = addDays(weekStart, 6);

  const [batchRows, uncovered, trail, skipLevel] = await Promise.all([
    query<RowDataPacket>(
      `SELECT b.id, b.status, b.file_name, b.process_id, b.total_rows, u.email,
              UNIX_TIMESTAMP(b.created_at) AS created_at, UNIX_TIMESTAMP(b.committed_at) AS committed_at
         FROM wfm_roster_import_batch b
         LEFT JOIN auth_user u ON u.id = b.created_by
        WHERE (b.process_id = ? OR (b.process_id IS NULL AND b.branch_id = ?))
          AND b.status IN ('PARSING','PREVIEW','VALIDATING','READY','COMMITTED')
          AND b.date_range_end >= ? AND b.date_range_start <= ?
        ORDER BY b.created_at DESC LIMIT 20`,
      [processId, branchId, weekStart, weekEnd],
    ),
    query<RowDataPacket>(
      `SELECT e.id, e.employee_code, e.full_name
         FROM employees e
        WHERE e.branch_id = ? AND e.process_id = ? AND e.employment_status = 'active'
          AND NOT EXISTS (
            SELECT 1 FROM wfm_roster_import_row r
              JOIN wfm_roster_import_batch b ON b.id = r.batch_id AND b.status = 'COMMITTED'
             WHERE r.employee_id = e.id AND r.roster_date BETWEEN ? AND ?)
        ORDER BY e.full_name LIMIT ${MISSING_EMPLOYEE_LIMIT}`,
      [branchId, processId, weekStart, weekEnd],
    ),
    loadTrail(branchId, processId, weekStart),
    loadSkipLevel(branchId, row.managers),
  ]);

  return {
    branchId,
    branchName: row.branchName,
    processId,
    processName: row.processName,
    weekStart,
    deadlineAtMs: deadlineMs(weekStart),
    cell: row.cells[0],
    managers: row.managers,
    wfm: directory.wfmByBranch.get(branchId) ?? [],
    skipLevel,
    batches: batchRows.map((b) => ({
      id: Number(b.id),
      status: String(b.status),
      fileName: b.file_name ? String(b.file_name) : null,
      scope: b.process_id ? 'process' : 'branch',
      uploadedBy: b.email ? String(b.email) : null,
      createdAtMs: Number(b.created_at) * 1000,
      committedAtMs: b.committed_at ? Number(b.committed_at) * 1000 : null,
      totalRows: Number(b.total_rows ?? 0),
    })),
    uncoveredEmployees: uncovered.map((e) => ({
      id: String(e.id),
      code: String(e.employee_code ?? ''),
      name: String(e.full_name ?? ''),
    })),
    uncoveredTotal: Math.max(0, row.cells[0].expected - row.cells[0].covered),
    trail,
  };
}
