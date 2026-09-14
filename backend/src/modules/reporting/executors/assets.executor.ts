/**
 * Assets executor
 *
 * Codes: asset-inventory, asset-allocation-register, asset-movement-log, document-expiry-tracker
 *
 * Tenant isolation: asset_master carries its own company_id column (a.company_id).
 * For allocation/movement tables that may lack company_id, the join to asset_master
 * provides the tenant guard via a.company_id = :companyId.
 *
 * Branch scope for asset_master is applied directly on a.branch_id.
 * Branch scope for allocation/movement is applied via the employee join.
 */
import type { RowDataPacket } from "mysql2";
import { db } from "../../../db/mysql.js";
import type { ExecFilters, ExecScope, ExecOptions, ExecResult } from "./types.js";
import {
  appendScopeConditions,
  appendFilterConditions,
  dateParam,
  monthParam,
  applyPagination,
  fetchPageWithTotal,
  ReportScopeAccessDeniedError,
  ReportSourceUnavailableError,
} from "./types.js";

async function query(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return rows;
}
async function count(baseSql: string, params: unknown[]): Promise<number> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM (${baseSql}) AS _cnt`,
    params
  );
  return Number((rows as Array<{ total?: number }>)[0]?.total ?? 0);
}

// ---------------------------------------------------------------------------
// asset-inventory
// ---------------------------------------------------------------------------
export async function assetInventory(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope applied directly on asset_master
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`a.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }

  if (filters.branchId) {
    clauses.push("a.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.status) {
    clauses.push("a.status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("a.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT a.id AS _cursor,
           a.asset_code,
           a.asset_name,
           a.asset_category AS category_name,
           a.status AS asset_status,
           a.purchase_date,
           a.purchase_cost AS purchase_value,
           a.serial_number,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name
      FROM asset_master a
      LEFT JOIN branch_master b      ON b.id  = a.branch_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY a.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// asset-allocation-register
// ---------------------------------------------------------------------------
export async function assetAllocationRegister(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope through employee join
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    clauses.push(`e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.branchScope.ids);
  }
  if (scope.processScope.mode === "none") throw new ReportScopeAccessDeniedError("processScope");
  if (scope.processScope.mode === "restricted" && scope.processScope.ids.length > 0) {
    clauses.push(`e.process_id IN (${scope.processScope.ids.map(() => "?").join(",")})`);
    params.push(...scope.processScope.ids);
  }

  if (filters.branchId) {
    clauses.push("e.branch_id = ?");
    params.push(String(filters.branchId));
  }
  if (filters.employeeCode) {
    clauses.push("e.employee_code = ?");
    params.push(String(filters.employeeCode));
  }
  if (filters.from || filters.to) {
    clauses.push("aa.assigned_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("aa.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT aa.id AS _cursor,
           a.asset_code,
           a.asset_name,
           a.asset_category AS category_name,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           aa.assigned_date AS allocation_date,
           aa.returned_date AS return_date,
           CASE WHEN aa.returned_date IS NULL THEN 'assigned' ELSE 'returned' END AS allocation_status,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM asset_assignment aa
      JOIN asset_master a            ON a.id  = aa.asset_id
      JOIN employees e               ON e.id  = aa.employee_id
      LEFT JOIN branch_master b      ON b.id  = e.branch_id
      LEFT JOIN process_master p     ON p.id  = e.process_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY aa.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// asset-movement-log
// ---------------------------------------------------------------------------
export async function assetMovementLog(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const from  = dateParam(filters.from, `${new Date().getFullYear()}-01-01`);
  const to    = dateParam(filters.to, today);

  const clauses: string[] = ["a.id IS NOT NULL"];
  const params: unknown[]  = [];

  // Branch scope through employee join (employee may be null for location-only moves)
  if (scope.branchScope.mode === "none") throw new ReportScopeAccessDeniedError("branchScope");
  if (scope.branchScope.mode === "restricted" && scope.branchScope.ids.length > 0) {
    // Apply via asset branch_id (movement tied to the asset's home branch) or employee
    clauses.push(
      `(a.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")}) ` +
      `OR e.branch_id IN (${scope.branchScope.ids.map(() => "?").join(",")}))`
    );
    params.push(...scope.branchScope.ids, ...scope.branchScope.ids);
  }

  if (filters.branchId) {
    clauses.push("(a.branch_id = ? OR e.branch_id = ?)");
    params.push(String(filters.branchId), String(filters.branchId));
  }
  if (filters.from || filters.to) {
    clauses.push("aml.movement_date BETWEEN ? AND ?");
    params.push(from, to);
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("aml.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT aml.id AS _cursor,
           a.asset_code,
           a.asset_name,
           aml.movement_type,
           aml.movement_date,
           aml.from_location,
           aml.to_location,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           aml.moved_by,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name
      FROM asset_movement_log aml
      JOIN asset_master a            ON a.id  = aml.asset_id
      LEFT JOIN employees e          ON e.id  = aml.employee_id
      LEFT JOIN branch_master b      ON b.id  = COALESCE(e.branch_id, a.branch_id)
     WHERE ${clauses.join(" AND ")}
     ORDER BY aml.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    if ((err as Record<string, unknown>)?.["code"] === "ER_NO_SUCH_TABLE") {
      // asset_movement_log does not exist in mas_hrms and has no equivalent —
      // asset_service_log records servicing, not custody transfers (verified 2026-08-07).
      // Returning an empty result here made the report read "no asset movements ever",
      // which for an audit trail is worse than admitting the source is missing.
      throw new ReportSourceUnavailableError(
        "asset-movement-log",
        "asset_movement_log",
        "Asset custody movements are not recorded in this database; the report is marked blocked in the catalog."
      );
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// document-expiry-tracker
// Requires migration 415 (adds expiry_date to employee_documents).
// Returns gracefully if column not yet added.
// ---------------------------------------------------------------------------
/**
 * Document expiry tracker.
 *
 * Structurally empty against live data. Measured 2026-08-07: employee_documents holds
 * 207,616 rows across 22,672 employees and **not one** has expiry_date set, so the
 * `ed.expiry_date IS NOT NULL` filter below matches nothing and this report returns zero
 * rows no matter what is asked of it.
 *
 * The query is correct — the column is simply never populated on ingest. Recorded here so
 * the empty grid reads as a known data gap rather than a broken report, and so nobody
 * re-debugs the SQL looking for a fault that is not in it. Fixing this means populating
 * expiry_date upstream, not changing anything below.
 */
export async function documentExpiryTracker(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const today = new Date().toISOString().slice(0, 10);
  const daysAhead = Number(filters["daysAhead"] ?? 90);
  const lookaheadDate = new Date(new Date().getTime() + daysAhead * 86400000).toISOString().slice(0, 10);

  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[]  = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);
  // This predicate is correct and currently fatal: employee_documents.expiry_date is NULL on ALL
  // 207,616 rows (measured live 2026-08-10), so the report returns zero rows and will until
  // expiry dates are captured at upload time. Left as-is on purpose — the SQL is right, the data
  // is absent, and loosening it would invent expiries. The catalogue description now states the
  // precondition so an empty grid is not misread as "nothing is expiring".
  clauses.push("ed.expiry_date IS NOT NULL");
  clauses.push("ed.expiry_date BETWEEN ? AND ?");
  params.push(today, lookaheadDate);

  if (filters.status) {
    if (filters.status === "expired") {
      clauses.pop(); clauses.pop(); params.pop(); params.pop();
      clauses.push("ed.expiry_date < ?");
      params.push(today);
    } else if (filters.status === "expiring_soon") {
      // already set above
    }
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ed.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ed.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           ed.doc_type,
           ed.doc_name,
           -- document_number and issuing_authority were selected here and exist nowhere on
           -- employee_documents, which is the file store: doc_type, doc_category, doc_name,
           -- file_url, verified, expiry_date and the verification fields. So the query threw
           -- ER_BAD_FIELD_ERROR on every run. Dropped rather than invented — there is no column
           -- holding either fact, and emitting a hardcoded NULL under those names would state
           -- that the document has no number, which is a different and unfounded claim.
           ed.expiry_date,
           DATEDIFF(ed.expiry_date, CURDATE()) AS days_until_expiry,
           CASE WHEN ed.expiry_date < CURDATE() THEN 'expired'
                WHEN ed.expiry_date <= DATE_ADD(CURDATE(), INTERVAL 30 DAY) THEN 'critical'
                ELSE 'expiring_soon' END AS expiry_status,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name
      FROM employee_documents ed
      JOIN employees e           ON e.id = ed.employee_id
      LEFT JOIN branch_master b  ON b.id = e.branch_id
      LEFT JOIN process_master p ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ed.expiry_date ASC, ed.id ASC`;

  try {
    const total = options.includeTotal ? await count(base, params) : 0;
    const sql   = options.mode === "worker" ? `${base} LIMIT ${options.limit}` : applyPagination(base, options);
    const rows  = await query(sql, params) as Record<string, unknown>[];
    const nextCursor = (options.mode === "worker" && rows.length > 0)
      ? (rows[rows.length - 1]._cursor as number) : null;
    const out = rows.map(({ _cursor: _, ...rest }) => rest);
    return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
  } catch (err: unknown) {
    // Narrowed to the column it was written for. It previously swallowed EVERY
    // ER_BAD_FIELD_ERROR and returned an empty result, so the two columns above — which do not
    // exist on employee_documents — turned this report into a silent blank for every caller.
    // "No documents expiring" and "the query is broken" looked identical, and document-expiry-tracker
    // is dispatched in executors/index.ts and listed in both the frontend and backend catalogues,
    // so it is reachable.
    //
    // The blanket catch also would not have healed itself: with 0 documents currently carrying an
    // expiry_date the report is empty either way today, but the moment expiry dates are populated
    // it would still have returned nothing, because the throw was hidden rather than fixed.
    //
    // expiry_date exists in mas_hrms — migration 415 is applied — so this branch is now dead here
    // and kept only for an environment that has not run it yet. Anything else is rethrown.
    const code = (err as Record<string, unknown>)?.["code"];
    const message = String((err as Record<string, unknown>)?.["sqlMessage"] ?? "");
    if (code === "ER_BAD_FIELD_ERROR" && /expiry_date/.test(message)) {
      return { rows: [], rowCount: 0, isTruncated: false };
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// document-verification-status
//
// Was a stub. The code has a catalog entry and appears in the documents-identity-privacy
// deep-report pack, so it is reachable from the UI, but it had neither an executor nor an
// inline block — every request fell through to fallbackReport() and returned one row
// reading "PENDING_DATA_BUILDER … its dedicated backend data builder is not configured
// yet". A navigable report that has never returned data.
//
// The data was there the whole time. Measured against live 2026-08-07: employee_documents
// holds 207,616 rows across 22,672 employees, of which 11,124 are verified and 196,492
// are not — which is exactly the backlog this report exists to show.
// ---------------------------------------------------------------------------
export async function documentVerificationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (filters.status === "verified")   clauses.push("ed.verified = 1");
  if (filters.status === "unverified") clauses.push("COALESCE(ed.verified, 0) = 0");
  if (typeof filters["docType"] === "string" && filters["docType"]) {
    clauses.push("ed.doc_type = ?");
    params.push(String(filters["docType"]));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("ed.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT ed.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           ed.doc_type,
           ed.doc_name,
           ed.created_at AS submitted_date,
           CASE WHEN ed.verified = 1 THEN 'VERIFIED' ELSE 'PENDING_VERIFICATION' END AS verification_status,
           COALESCE(NULLIF(v.full_name,''), CONCAT(v.first_name,' ',COALESCE(v.last_name,''))) AS verified_by,
           ed.verification_date AS verified_date,
           ed.verification_remarks
      FROM employee_documents ed
      JOIN employees e            ON e.id = ed.employee_id
      LEFT JOIN employees v       ON v.id = ed.verified_by
      LEFT JOIN branch_master b   ON b.id = e.branch_id
      LEFT JOIN process_master p  ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY ed.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}

// ---------------------------------------------------------------------------
// certification-status
//
// Also a stub before this, and also reachable — it appears in four perspectives of the
// training-lms deep-report pack.
//
// lms_certification_snapshot is the right source and exists, but holds 0 rows against
// live on 2026-08-07: the deployed LMS is the system of record for certification and
// nothing has been synced into this snapshot yet. So this returns an empty result today
// and will fill in when the sync runs — which is a materially different statement from
// "no data builder is configured", and one a user can act on.
// ---------------------------------------------------------------------------
export async function certificationStatus(
  filters: ExecFilters,
  scope: ExecScope,
  options: ExecOptions
): Promise<ExecResult> {
  const clauses: string[] = ["e.id IS NOT NULL"];
  const params: unknown[] = [];
  appendScopeConditions(scope, clauses, params);
  appendFilterConditions(filters, clauses, params);

  if (typeof filters.status === "string" && filters.status) {
    clauses.push("lcs.status = ?");
    params.push(String(filters.status));
  }

  if (options.mode === "worker" && options.cursor != null) {
    clauses.push("lcs.id > ?");
    params.push(options.cursor);
  }

  const base = `
    SELECT lcs.id AS _cursor,
           e.employee_code,
           COALESCE(NULLIF(e.full_name,''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
           COALESCE(sp_cc.cost_centre_code, 'UNASSIGNED') AS cost_centre_code,
           COALESCE(sp_cc.cost_centre_name, 'UNASSIGNED') AS cost_centre_name,
           COALESCE(b.branch_name, 'UNASSIGNED') AS branch_name,
           COALESCE(p.process_name, 'UNASSIGNED') AS process_name,
           lcs.certification_name,
           lcs.issued_date AS certified_date,
           lcs.expiry_date,
           lcs.status AS certification_status,
           DATEDIFF(lcs.expiry_date, CURDATE()) AS days_to_expiry,
           lcs.synced_at,
           CASE WHEN e.active_status = 1 THEN 'Active' ELSE 'Inactive' END AS employee_status
      FROM lms_certification_snapshot lcs
      JOIN employees e            ON e.id = lcs.employee_id
      LEFT JOIN branch_master b   ON b.id = e.branch_id
      LEFT JOIN process_master p  ON p.id = e.process_id
      LEFT JOIN cost_centre_master sp_cc ON sp_cc.id = e.cost_centre_id
     WHERE ${clauses.join(" AND ")}
     ORDER BY lcs.id ASC`;

  // One execution, not two: the page and its total come from the same fetch wherever the result
  // fits the probe. See fetchPageWithTotal — the COUNT wrapper it replaces re-ran the entire
  // statement to learn a number the first run already knew.
  const paged = await fetchPageWithTotal(base, params, options, query, count);
  const total = paged.total;
  const rows  = paged.rows as Record<string, unknown>[];
  const nextCursor = (options.mode === "worker" && rows.length > 0)
    ? (rows[rows.length - 1]._cursor as number) : null;
  const out = rows.map(({ _cursor: _, ...rest }) => rest);
  return { rows: out, rowCount: options.includeTotal ? total : rows.length, isTruncated: total > out.length, nextCursor };
}
