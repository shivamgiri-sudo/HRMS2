import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { db } from "../../db/mysql.js";
import type {
  EmployeeCandidate,
  ListMappingsFilters,
  MappingListRow,
  MappingRow,
  MatchResult,
  RawNameRole,
  RawOnfidoName,
  SeedResult,
  UpsertMappingInput,
  VerifyMappingInput,
} from "./onfido-name-mapping.types.js";

/**
 * Pure matching function: no DB access, no side effects. Compares a raw name
 * string against a set of candidate employees and returns a single best match
 * (or a reason it could not produce one).
 */
export function matchNameToEmployees(
  rawName: string,
  candidates: EmployeeCandidate[],
): MatchResult {
  const normalized = rawName.trim().toLowerCase();
  const exactMatches = candidates.filter(
    (c) => c.fullName.trim().toLowerCase() === normalized,
  );

  if (exactMatches.length === 1) {
    return {
      employeeId: exactMatches[0].id,
      confidence: 1.0,
      method: "exact_name",
    };
  }

  if (exactMatches.length > 1) {
    return { employeeId: null, confidence: 0, method: "ambiguous" };
  }

  return { employeeId: null, confidence: 0, method: "unmatched" };
}

/**
 * Distinct raw TL/AM names from onfido_db, tagged with which role column they
 * came from. Reuses the same two sources and non-blank filter as
 * getFilterOptions() in onfido-process-dashboard.service.ts (the Executive
 * Filters dropdown), so this reconciliation feature sees exactly the same
 * name universe the dashboard filters already expose to users.
 */
export async function getDistinctOnfidoNames(): Promise<RawOnfidoName[]> {
  const pool = await getOnfidoPool();

  const [tlRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT tl_name AS name FROM onfido_doc_external_audit_raw WHERE tl_name IS NOT NULL AND TRIM(tl_name) <> ''
     UNION
     SELECT DISTINCT tl_name AS name FROM onfido_agent_daily_raw WHERE tl_name IS NOT NULL AND TRIM(tl_name) <> ''
     ORDER BY name`,
  );
  const [amRows] = await pool.query<RowDataPacket[]>(
    `SELECT DISTINCT am_name AS name FROM onfido_doc_external_audit_raw WHERE am_name IS NOT NULL AND TRIM(am_name) <> ''
     UNION
     SELECT DISTINCT am_name AS name FROM onfido_agent_daily_raw WHERE am_name IS NOT NULL AND TRIM(am_name) <> ''
     ORDER BY name`,
  );

  return [
    ...tlRows.map((r): RawOnfidoName => ({
      rawName: r.name as string,
      rawRole: "tl",
    })),
    ...amRows.map((r): RawOnfidoName => ({
      rawName: r.name as string,
      rawRole: "am",
    })),
  ];
}

/**
 * Active employees eligible to be matched against, from mas_hrms (not onfido_db —
 * there is no cross-database JOIN available, see migration 1869's own comment).
 * active_status = 1 matches this codebase's established convention (see e.g.
 * access.service.ts's own employees lookups) — a terminated employee should
 * never be offered as a match candidate for a live Onfido name.
 */
export async function getEmployeeCandidates(): Promise<EmployeeCandidate[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, full_name, employee_code FROM employees WHERE active_status = 1`,
  );
  return rows.map((r): EmployeeCandidate => ({
    id: r.id as string,
    fullName: r.full_name as string,
    employeeCode: r.employee_code as string,
  }));
}

// onfido_name_employee_map has no FK to employees (migration 1869), so the API
// must confirm an HR-supplied employeeId exists before writing it.
export async function employeeExists(employeeId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT 1 FROM employees WHERE id = ? LIMIT 1`,
    [employeeId],
  );
  return rows.length > 0;
}

/**
 * Writes (or updates) one onfido_name_employee_map row. Per migration 1869's
 * own documented rule: once verified_by_hr = 1, this must never overwrite that
 * row's employee_id — an automated re-match run must not silently undo an HR
 * decision. Checked with a guard SELECT before the write, not relied on at the
 * SQL layer, since ON DUPLICATE KEY UPDATE has no conditional-skip clause.
 */
export async function upsertMapping(input: UpsertMappingInput): Promise<void> {
  const [existingRows] = await db.execute<RowDataPacket[]>(
    `SELECT verified_by_hr FROM onfido_name_employee_map WHERE raw_name = ? AND raw_role = ?`,
    [input.rawName, input.rawRole],
  );
  const existing = existingRows[0];
  if (existing && Number(existing.verified_by_hr) === 1) {
    return;
  }

  await db.execute(
    `INSERT INTO onfido_name_employee_map (raw_name, raw_role, employee_id, match_confidence, match_method)
       VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       employee_id = VALUES(employee_id),
       match_confidence = VALUES(match_confidence),
       match_method = VALUES(match_method)`,
    [
      input.rawName,
      input.rawRole,
      input.employeeId,
      input.matchConfidence,
      input.matchMethod,
    ],
  );
}

/** Reads back one mapping row by its natural key (raw_name, raw_role). */
export async function getMappingByNameAndRole(
  rawName: string,
  rawRole: RawNameRole,
): Promise<MappingRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, raw_name, raw_role, employee_id, match_confidence, match_method, verified_by_hr
       FROM onfido_name_employee_map WHERE raw_name = ? AND raw_role = ?`,
    [rawName, rawRole],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id as string,
    rawName: row.raw_name as string,
    rawRole: row.raw_role as RawNameRole,
    employeeId: (row.employee_id as string | null) ?? null,
    matchConfidence: Number(row.match_confidence),
    matchMethod: row.match_method as MappingRow["matchMethod"],
    verifiedByHr: Number(row.verified_by_hr) === 1,
  };
}

/**
 * Full seeding pass: reads every distinct raw TL/AM name from onfido_db, matches
 * each against the active employee roster, and upserts the result into
 * onfido_name_employee_map. Safe to re-run any number of times (idempotent):
 * - unchanged names re-resolve to the same match and upsertMapping's own
 *   ON DUPLICATE KEY UPDATE is a no-op in effect;
 * - a row an HR reviewer already verified is never overwritten (see
 *   upsertMapping's own guard).
 *
 * One name's failure (e.g. a transient lock on the write) never aborts the run
 * for the remaining names — each is caught individually and reported in
 * result.errors, mirroring seed-question-bank.ts's own
 * { imported, skipped, errors } pattern for backend/scripts/*.ts orchestration
 * scripts in this codebase.
 */
export async function runNameMappingSeed(): Promise<SeedResult> {
  const [rawNames, candidates] = await Promise.all([
    getDistinctOnfidoNames(),
    getEmployeeCandidates(),
  ]);

  const result: SeedResult = { matched: 0, ambiguous: 0, unmatched: 0, errors: [] };

  for (const { rawName, rawRole } of rawNames) {
    const match = matchNameToEmployees(rawName, candidates);

    try {
      await upsertMapping({
        rawName,
        rawRole,
        employeeId: match.employeeId,
        matchConfidence: match.confidence,
        matchMethod: match.method,
      });

      // Only count a name once its result is actually persisted — a name whose
      // write failed is reported solely via result.errors, not double-counted
      // as both a compute result and a failure.
      if (match.method === "exact_name") result.matched += 1;
      else if (match.method === "ambiguous") result.ambiguous += 1;
      else result.unmatched += 1;
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : String(error);
      result.errors.push(`${rawName} (${rawRole}): ${message}`);
    }
  }

  return result;
}

/**
 * One mapping row by its own primary key (distinct from getMappingByNameAndRole,
 * which looks up by the natural key raw_name/raw_role). Used by the PATCH review
 * route to confirm a row exists before writing, and to return the post-write state.
 */
export async function getMappingRowById(id: string): Promise<MappingListRow | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.raw_name, m.raw_role, m.employee_id, m.match_confidence, m.match_method, m.verified_by_hr,
            e.full_name AS employee_name, e.employee_code AS employee_code
       FROM onfido_name_employee_map m
       LEFT JOIN employees e ON e.id = m.employee_id
       WHERE m.id = ?`,
    [id],
  );
  const row = rows[0];
  if (!row) return null;

  return {
    id: row.id as string,
    rawName: row.raw_name as string,
    rawRole: row.raw_role as RawNameRole,
    employeeId: (row.employee_id as string | null) ?? null,
    matchConfidence: Number(row.match_confidence),
    matchMethod: row.match_method as MappingRow["matchMethod"],
    verifiedByHr: Number(row.verified_by_hr) === 1,
    employeeName: (row.employee_name as string | null) ?? null,
    employeeCode: (row.employee_code as string | null) ?? null,
  };
}

/**
 * All mapping rows for the HR review screen, joined with the matched employee's
 * display name/code (a plain LEFT JOIN within mas_hrms — employee_id has no FK,
 * see migration 1869, but the join itself is a same-database, single-query read
 * with no cross-database restriction). Optionally narrowed to only rows HR
 * still needs to review (verified: false) or has already actioned (verified: true).
 */
export async function listMappings(filters: ListMappingsFilters = {}): Promise<MappingListRow[]> {
  const where =
    filters.verified === true
      ? "WHERE m.verified_by_hr = 1"
      : filters.verified === false
        ? "WHERE m.verified_by_hr = 0"
        : "";

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT m.id, m.raw_name, m.raw_role, m.employee_id, m.match_confidence, m.match_method, m.verified_by_hr,
            e.full_name AS employee_name, e.employee_code AS employee_code
       FROM onfido_name_employee_map m
       LEFT JOIN employees e ON e.id = m.employee_id
       ${where}
       ORDER BY m.raw_role, m.raw_name`,
  );

  return rows.map((row): MappingListRow => ({
    id: row.id as string,
    rawName: row.raw_name as string,
    rawRole: row.raw_role as RawNameRole,
    employeeId: (row.employee_id as string | null) ?? null,
    matchConfidence: Number(row.match_confidence),
    matchMethod: row.match_method as MappingRow["matchMethod"],
    verifiedByHr: Number(row.verified_by_hr) === 1,
    employeeName: (row.employee_name as string | null) ?? null,
    employeeCode: (row.employee_code as string | null) ?? null,
  }));
}

/**
 * The HR review action: explicitly sets employee_id, marks the row verified_by_hr = 1,
 * and records who verified it and when. This is the one write path allowed to touch a
 * row after it becomes HR-verified — upsertMapping() (the automated match run) refuses
 * to touch it once this has run, per migration 1869's own documented rule.
 *
 * employeeId: null is a legitimate HR decision — "no employee matches this name" —
 * not an error case, so it is accepted and written as-is.
 */
export async function verifyMapping(mappingId: string, input: VerifyMappingInput): Promise<void> {
  await db.execute(
    `UPDATE onfido_name_employee_map
        SET employee_id = ?, verified_by_hr = 1, verified_by_user_id = ?, verified_at = NOW()
      WHERE id = ?`,
    [input.employeeId, input.verifiedByUserId, mappingId],
  );
}
