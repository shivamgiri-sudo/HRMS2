/**
 * Shared helpers for the Area 4 (shift versioning) roster enterprise-controls
 * program. Extracted out of auto-roster-synced.service.ts so every roster
 * write path — the live engine, bulk upload, manual assignment, shift swap —
 * computes the payroll-reproducibility snapshot fields (scheduled_minutes,
 * shift_version_id) the same way instead of re-deriving cross-midnight math
 * independently in each module.
 */

import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

/** Minutes between start and end, cross-midnight-safe (e.g. 22:00-06:00 = 480). */
export function computeScheduledMinutes(start: string, end: string): number | null {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  if ([sh, sm, eh, em].some((n) => Number.isNaN(n))) return null;
  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60;
  return endMin - startMin;
}

type Executor = { execute<T extends RowDataPacket[] = RowDataPacket[]>(sql: string, params?: unknown[]): Promise<[T, unknown]> };

// Cached at module scope, not per-call: wfm_roster_assignment's columns don't
// change mid-process. Lets every write path degrade gracefully on a DB that
// hasn't had migration 1200_shift_versioning.sql applied yet, rather than
// failing every insert with an unknown-column error.
//
// Accepts an optional executor so callers already inside a transaction (the
// bulk-upload services, which hold a dedicated `conn` for the whole batch) can
// probe through that same connection instead of a separate pool connection —
// this also happens to be what makes the bulk-upload services' existing
// tests (which mock only `conn.execute`, not `db.execute`) work unchanged.
let rosterAssignmentColumnsCache: Set<string> | null = null;
export async function rosterAssignmentColumns(executor: Executor = db): Promise<Set<string>> {
  if (rosterAssignmentColumnsCache) return rosterAssignmentColumnsCache;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_roster_assignment'`
  );
  rosterAssignmentColumnsCache = new Set((rows as RowDataPacket[]).map((r) => String(r.COLUMN_NAME)));
  return rosterAssignmentColumnsCache;
}

// Same pattern, for wfm_shift_master. Before migration 1200, shift_code carried
// a lone UNIQUE index, so "one active row per shift_code" was guaranteed by the
// schema itself. After it, multiple versions can share a shift_code with
// active_status=1 — any join that matches on shift_code alone becomes
// ambiguous (silently picks an arbitrary version) unless it's version-aware.
let shiftMasterColumnsCache: Set<string> | null = null;
export async function shiftMasterColumns(executor: Executor = db): Promise<Set<string>> {
  if (shiftMasterColumnsCache) return shiftMasterColumnsCache;
  const [rows] = await executor.execute<RowDataPacket[]>(
    `SELECT COLUMN_NAME FROM INFORMATION_SCHEMA.COLUMNS WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'wfm_shift_master'`
  );
  shiftMasterColumnsCache = new Set((rows as RowDataPacket[]).map((r) => String(r.COLUMN_NAME)));
  return shiftMasterColumnsCache;
}

/** Test-only: clears both module-scope caches so a test file can simulate a
 *  different schema state (with/without migration 1200) across cases without
 *  process restart. Not used by production code paths. */
export function __resetSchemaCachesForTests(): void {
  rosterAssignmentColumnsCache = null;
  shiftMasterColumnsCache = null;
}
