import type { RowDataPacket } from "mysql2";
import { getOnfidoPool } from "../../db/onfidoDb.js";
import { db } from "../../db/mysql.js";
import type {
  EmployeeCandidate,
  MappingRow,
  MatchResult,
  RawNameRole,
  RawOnfidoName,
  UpsertMappingInput,
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
