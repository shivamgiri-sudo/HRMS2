/**
 * Optional LOB (line of business) filter shared by the Roster Command Center endpoints.
 *
 * Contract: query param `lobId` = lob_master.id (uuid) | `__none__` (employees with no LOB) | absent/empty.
 * Filters on employees.lob_id (alias `e`). Never joins lob_master (mixed collations in prod; unassigned
 * employees must not be dropped) and never uses COLLATE casts (would defeat indexes).
 */
import type { Request, Response } from 'express';

export const LOB_NONE_SENTINEL = '__none__';
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export type LobFilter =
  | { kind: 'none' }
  | { kind: 'unassigned' }
  | { kind: 'lob'; id: string }
  /** Several LOBs picked at once (comma-separated lobId); `withUnassigned` also keeps employees with no LOB. */
  | { kind: 'multi'; ids: string[]; withUnassigned: boolean };

export function parseLobFilterParam(raw: unknown): LobFilter {
  if (raw === undefined || raw === null) return { kind: 'none' };
  if (typeof raw !== 'string') {
    throw Object.assign(new Error('lobId must be a single uuid or "__none__"'), { statusCode: 400 });
  }
  const v = raw.trim();
  if (v === '') return { kind: 'none' };
  if (v.includes(',')) {
    const parts = [...new Set(v.split(',').map((s) => s.trim()).filter(Boolean))];
    const withUnassigned = parts.includes(LOB_NONE_SENTINEL);
    const ids = parts.filter((p) => p !== LOB_NONE_SENTINEL);
    for (const id of ids) {
      if (!UUID_RE.test(id)) throw Object.assign(new Error('lobId must be valid uuids or "__none__"'), { statusCode: 400 });
    }
    if (ids.length === 0) return { kind: 'unassigned' };
    if (ids.length === 1 && !withUnassigned) return { kind: 'lob', id: ids[0] };
    return { kind: 'multi', ids, withUnassigned };
  }
  if (v === LOB_NONE_SENTINEL) return { kind: 'unassigned' };
  if (!UUID_RE.test(v)) {
    throw Object.assign(new Error('lobId must be a valid uuid or "__none__"'), { statusCode: 400 });
  }
  return { kind: 'lob', id: v };
}

/** SQL fragment starting with `AND ` (or '' for no filter). */
export function lobWhere(filter: LobFilter, alias = 'e'): { sql: string; params: string[] } {
  if (filter.kind === 'unassigned') return { sql: `AND ${alias}.lob_id IS NULL`, params: [] };
  if (filter.kind === 'lob') return { sql: `AND ${alias}.lob_id = ?`, params: [filter.id] };
  if (filter.kind === 'multi') {
    const inList = `${alias}.lob_id IN (${filter.ids.map(() => '?').join(',')})`;
    return { sql: filter.withUnassigned ? `AND (${inList} OR ${alias}.lob_id IS NULL)` : `AND ${inList}`, params: [...filter.ids] };
  }
  return { sql: '', params: [] };
}

/** Like lobWhere but with a leading space when non-empty, so `...= 1${lobAnd(f).sql}` stays byte-identical when unfiltered. */
export function lobAnd(filter: LobFilter, alias = 'e'): { sql: string; params: string[] } {
  const w = lobWhere(filter, alias);
  return w.sql ? { sql: ` ${w.sql}`, params: w.params } : w;
}

/** Same condition without the leading `AND ` for callers that build a conditions array. */
export function lobCondition(filter: LobFilter, alias = 'e'): { sql: string; params: string[] } | null {
  const w = lobWhere(filter, alias);
  return w.sql ? { sql: w.sql.replace(/^AND /, ''), params: w.params } : null;
}

/**
 * Route helper: parses req.query.lobId; on a bad value sends a 400 and returns null.
 * Callers: `const lob = readLobFilter(req, res); if (!lob) return;`
 */
export function readLobFilter(req: Request, res: Response): LobFilter | null {
  try {
    return parseLobFilterParam(req.query.lobId);
  } catch (err) {
    res.status(400).json({ error: err instanceof Error ? err.message : 'Invalid lobId' });
    return null;
  }
}
