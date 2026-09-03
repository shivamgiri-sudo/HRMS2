import type { RowDataPacket, ResultSetHeader } from 'mysql2';
import { db } from '../../db/mysql.js';
import { buildScopeWhereClause } from '../../shared/scopeAccess.js';
import { sendJoiningDocReminderEmail } from './ats.email.service.js';
import { generateJoiningDocumentChecklist, recalculateDocumentProgress } from '../employees/employeeJoiningDocuments.service.js';
// Esign_State_Authority. The eSign counters below are GENERATED from it rather
// than hand-written, so the query cannot drift from `classifyEsignState`.
import { esignBucketCaseSql } from './esignState.js';
// archiver ships a CJS default; @types/archiver only declares named exports so we
// need a type-cast to satisfy the compiler while keeping vi.mock('archiver') working.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
import * as _archiverNs from 'archiver';
import type { ArchiverOptions, Archiver as ArchiverInstance } from 'archiver';
import fs from 'fs';
import path from 'path';
import type { Response } from 'express';

// esModuleInterop wraps the CJS default as .default; fall back to the namespace itself.
const archiverLib = ((_archiverNs as unknown as { default?: unknown }).default ??
  _archiverNs) as (format: string, options?: ArchiverOptions) => ArchiverInstance;

const STORAGE_ROOT = path.resolve(process.cwd(), 'private-storage', 'employee-joining-documents');

/**
 * The roles this page is mounted for, as the scope resolver sees them.
 *
 * Must stay the same list as the requireRole() call in
 * ats.joiningDocumentsTracker.routes.ts: buildScopeWhereClause() only reads
 * user_assignment_scope rows whose role_key is in this list, so a role admitted
 * by the router but missing here would resolve to no scope and an empty page.
 */
export const TRACKER_SCOPE_ROLES = ['admin', 'super_admin', 'hr', 'payroll_hr', 'branch_head'];

/**
 * Who appears on this page at all — anyone who actually has joining documents,
 * plus current staff, plus a recent pre-joiner.
 *
 * Pre-joiners sit at active_status = 0 until their joining date, so filtering on
 * 1 alone hid precisely the population whose documents must be signed before day
 * one. But active_status = 0 is overwhelmingly *left the company*, not *not yet
 * joined* — on live data it covers 57,310 resigned, terminated and inactive
 * records against a handful who genuinely have a checklist. Presence of a
 * checklist is the honest test: it is created when a joiner needs documents, so
 * it admits pre-joiners without admitting leavers.
 *
 * Expressed as a joined candidate set rather than as three ORs in the WHERE
 * because the OR form was unindexable — every branch here uses an index
 * (idx_emp_active, idx_ejdc_employee, idx_emp_empstatus), which took the page
 * query from 6.4s to ~0.3s and the search from 5.6s to ~0.1s on live data. The
 * population is unchanged: both forms return the same 287 employees.
 *
 * `employment_status = 'preboarding'` rather than LOWER(...) = 'preboarding' for
 * the same reason: the column collation is already case-insensitive, and the
 * function call is what stopped the index being used.
 */
const TRACKER_POPULATION_JOIN = `
    JOIN (
      SELECT id FROM employees WHERE active_status = 1
      UNION
      SELECT DISTINCT k.employee_id FROM employee_joining_document_checklist k
      UNION
      SELECT id FROM employees
       WHERE employment_status = 'preboarding'
         AND date_of_joining >= DATE_SUB(NOW(), INTERVAL 120 DAY)
    ) tracker_population ON tracker_population.id = e.id`;

export interface KeyDocumentStatus {
  code: 'APPOINTMENT_LETTER' | 'ID_PROOF' | 'BANK_DETAILS' | 'ADDRESS_PROOF';
  status: string;
  verification_status: string | null;
}

export interface EmployeeDocumentRow {
  id: string;
  employee_id: string;
  employee_code: string;
  full_name: string;
  branch_name: string;
  process_name: string;
  lob_name: string | null;
  date_of_joining: string;
  /**
   * The three process milestones HR reads this page for, alongside the document
   * progress. They come from three different systems and were all absent here,
   * so "has this person's paperwork moved?" could not be answered on the page
   * that exists to answer it.
   *
   * `onboarding_submitted_at` is when the candidate submitted the onboarding
   * form (candidate_onboarding_profile.submitted_at, reached through
   * ats_onboarding_bridge); `salary_assigned_at` is when a salary was last
   * assigned. Both are null for an employee who has not reached that step —
   * null means "not yet", never zero or an epoch date.
   */
  onboarding_submitted_at: string | null;
  salary_assigned_at: string | null;
  joining_document_status: string | null;
  active_status?: number;
  joining_document_completion_pct: number;
  is_pre_joining?: boolean;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  // Null — not 0 — when the employee has no checklist rows at all, so "nothing to
  // sign" cannot be rendered as "everything signed" (Requirement 8, criterion 1).
  // Null is produced in exactly one place, the SQL `CASE WHEN COUNT(c.id) = 0`,
  // and is never coerced afterwards: it was the mapper's `?? 0` that turned an
  // absent denominator into a green 0/0 badge.
  //
  // Every *other* count field on this interface stays non-null. The nullability of
  // each one is pinned against `EmployeeRow` in `JoiningDocumentsTrackerPage.tsx`
  // by a contract test (Requirement 8, criterion 3) — the two builds cannot share
  // a declaration, so the agreement is asserted rather than assumed.
  esign_completed_count: number | null;
  esign_pending_count: number | null;
  last_document_update: string | null;
  assigned_hr_name: string | null;
  key_documents: KeyDocumentStatus[];
}

export interface TrackerSummary {
  total_employees: number;
  /** `classifyEmployeeBucket` === 'completed' */
  completed_count: number;
  /** 'in_progress' — absorbs the former 75-99 `pending_verification` band */
  in_progress_count: number;
  /** 'pending' — 0% */
  pending_count: number;
  // The three buckets above partition the employee set:
  // completed_count + in_progress_count + pending_count === total_employees.
  //
  // The two counts below are *cross-cutting*, not buckets. An employee can be
  // both in_progress and overdue, so they sit outside the partition and must not
  // be added into it. `pending_verification` used to live here as a fourth
  // bucket for 75-99%, which no page rendered — live tiles read Completed 0 /
  // In Progress 0 above rows badged In Progress. It is removed rather than left
  // unrendered: a field nothing reads is how this drifted in the first place.
  overdue_count: number;
  needs_correction: number;
}

export interface TrackerQueryParams {
  branch_id?: string;
  process_id?: string;
  status?: string;
  completion_min?: number;
  completion_max?: number;
  document_code?: string;
  overdue_only?: boolean;
  updated_since?: string;
  search?: string;
  /** 1-based. Clamped to >= 1; anything unparseable falls back to `DEFAULT_PAGE`. */
  page?: number;
  /** Rows per page. Clamped into [1, `MAX_PAGE_LIMIT`]; default `DEFAULT_PAGE_LIMIT`. */
  limit?: number;
}

/** First page when the caller sends nothing, or sends something not a page number. */
export const DEFAULT_PAGE = 1;
/** Rows per page when the caller sends no `limit`. */
export const DEFAULT_PAGE_LIMIT = 50;
/**
 * The abuse ceiling, and the reason the hard-coded `LIMIT 500` could be removed.
 *
 * `LIMIT 500` was doing two jobs: cutting the list off (the bug — employee 501 was
 * unreachable) and bounding the scan. Only the first job goes away. Without a cap
 * here, `?limit=100000` reinstates exactly the unbounded grouped scan the 500 was
 * preventing, so the ceiling has to move rather than be deleted.
 */
export const MAX_PAGE_LIMIT = 200;

/**
 * `page` as a usable integer, whatever arrived.
 *
 * `Number.isFinite` is load-bearing rather than decorative: `Math.max(1, NaN)` is
 * `NaN` and `Math.max(1, Infinity)` is `Infinity`, either of which would reach the
 * OFFSET arithmetic and produce a query that fails instead of a page that is empty.
 */
export function clampPage(page: unknown): number {
  const n = Math.trunc(Number(page));
  return Number.isFinite(n) && n >= 1 ? n : DEFAULT_PAGE;
}

/** `limit` as a usable integer inside [1, `MAX_PAGE_LIMIT`]. */
export function clampLimit(limit: unknown): number {
  const n = Math.trunc(Number(limit));
  if (!Number.isFinite(n) || n < 1) return DEFAULT_PAGE_LIMIT;
  return Math.min(n, MAX_PAGE_LIMIT);
}

export interface TrackerResponse {
  rows: EmployeeDocumentRow[];
  /**
   * Employees matching the active filters — NOT `rows.length`.
   *
   * These are different numbers the moment pagination is real, and conflating them
   * is what made `hasNext` unrepresentable: the old `total: employees.length` could
   * never exceed the page size, so the page after the cut-off could not be known to
   * exist. Sourced from `COUNT(*) OVER ()` on the same statement as the rows, with a
   * wrapped-count fallback for the past-the-end case where that window returns no
   * row to read it from.
   */
  total: number;
  /** Computed over the whole filtered set, not over `rows` — see `queryTrackerSummary`. */
  summary: TrackerSummary;
  /** Echo of the effective (clamped) page, so the caller can see what it actually got. */
  page: number;
  /** Echo of the effective (clamped) limit. */
  limit: number;
  hasNext: boolean;
  hasPrev: boolean;
}

export function parseKeyDocuments(keyDocumentsRaw: string | null): KeyDocumentStatus[] {
  if (!keyDocumentsRaw || keyDocumentsRaw.trim() === '') {
    return [];
  }

  return keyDocumentsRaw
    .split('||')
    .filter(Boolean)
    .map(part => {
      const [code, status, verificationStatus] = part.split(':');
      return {
        code: code as KeyDocumentStatus['code'],
        status,
        verification_status: verificationStatus === 'null' ? null : verificationStatus,
      };
    });
}

/**
 * The buckets the tracker tiles render, and the only buckets the summary produces.
 * One name per tile, so a count cannot exist without somewhere to display it.
 */
export type SummaryBucket = 'completed' | 'in_progress' | 'pending';

/**
 * The single classification the tiles and the row badge both go through.
 *
 * Total and coverage are structural: every real number lands in exactly one
 * bucket, so `calculateTrackerSummary`'s three counts partition its input by
 * construction rather than by assertion. The former 75-99 `pending_verification`
 * band is folded into `in_progress` — a verified Aadhaar eSign *is* the
 * verification, so there is no longer a band that means something different from
 * "in progress".
 */
/**
 * The two completion-percentage boundaries the cascade below splits on.
 *
 * Held as a const because `classifyEmployeeBucket` is no longer the only reader:
 * with real pagination the summary is computed in SQL over the whole filtered set
 * (`summaryBucketCaseSql`), so the same two numbers now appear in a `CASE`
 * expression as well. Typing them twice is how the tiles and the row badges would
 * drift apart again — the SQL is generated from these, not re-written from memory.
 */
const BUCKET_THRESHOLDS = {
  /** `pct >= this` → 'completed' */
  completedMin: 100,
  /** `pct > this` (and short of `completedMin`) → 'in_progress' */
  inProgressMin: 0,
} as const;

export function classifyEmployeeBucket(pct: number): SummaryBucket {
  if (pct >= BUCKET_THRESHOLDS.completedMin) return 'completed';
  if (pct > BUCKET_THRESHOLDS.inProgressMin) return 'in_progress'; // absorbs the former 75-99 pending_verification band
  return 'pending';
}

/** Field on `TrackerSummary` each bucket increments. */
const BUCKET_COUNT_FIELD: Record<SummaryBucket, 'completed_count' | 'in_progress_count' | 'pending_count'> = {
  completed: 'completed_count',
  in_progress: 'in_progress_count',
  pending: 'pending_count',
};

/**
 * `classifyEmployeeBucket` as a SQL `CASE`, from the same thresholds in the same order.
 *
 * Same device as `esignBucketCaseSql`: the expression is generated rather than
 * hand-written, so the aggregate query cannot classify an employee differently from
 * the function the row badge uses. `CASE` gives mutual exclusion and the `ELSE` gives
 * exhaustiveness, so `completed + in_progress + pending = COUNT(*)` holds structurally
 * — which is Requirement 7 criterion 3's sum-to-309 rather than a separate assertion.
 *
 * `COALESCE(…, 0)` mirrors the mapper's `Number(row.joining_document_completion_pct)`:
 * a NULL percentage reads as 0 and lands in 'pending'. Without it every comparison
 * against NULL yields NULL, the row falls out of all three bands, and the partition
 * silently stops summing to the total.
 */
function summaryBucketCaseSql(column: string): string {
  const pct = `COALESCE(${column}, 0)`;
  return `CASE
              WHEN ${pct} >= ${BUCKET_THRESHOLDS.completedMin} THEN 'completed'
              WHEN ${pct} > ${BUCKET_THRESHOLDS.inProgressMin} THEN 'in_progress'
              ELSE 'pending'
            END`;
}

export function calculateTrackerSummary(employees: EmployeeDocumentRow[]): TrackerSummary {
  const summary: TrackerSummary = {
    total_employees: employees.length,
    completed_count: 0,
    in_progress_count: 0,
    pending_count: 0,
    overdue_count: 0,
    needs_correction: 0,
  };

  for (const emp of employees) {
    // Thresholds are not inlined here: the badge on the row and this tile read the
    // same function, so they cannot disagree.
    const bucket = classifyEmployeeBucket(emp.joining_document_completion_pct);
    summary[BUCKET_COUNT_FIELD[bucket]]++;

    if (emp.overdue_count > 0) {
      summary.overdue_count++;
    }

    if (emp.needs_correction_count > 0) {
      summary.needs_correction++;
    }
  }

  return summary;
}

interface TrackerQueryRow extends RowDataPacket {
  id: string;
  employee_code: string;
  full_name: string;
  branch_id: string;
  branch_name: string;
  process_id: string | null;
  process_name: string | null;
  lob_name: string | null;
  date_of_joining: string;
  onboarding_submitted_at: string | null;
  salary_assigned_at: string | null;
  joining_document_status: string | null;
  joining_document_completion_pct: number;
  /** True when the employee has a code but has not reached their joining date yet. */
  is_pre_joining: boolean;
  key_documents_raw: string | null;
  total_documents: number;
  verified_count: number;
  needs_correction_count: number;
  overdue_count: number;
  /** NULL when the employee has no checklist rows — see the SQL `CASE WHEN COUNT(c.id) = 0`. */
  esign_completed_count: number | null;
  esign_pending_count: number | null;
  last_document_update: string | null;
  assigned_hr_name: string | null;
  /**
   * `COUNT(*) OVER ()` — employees left after WHERE, GROUP BY and HAVING, before
   * ORDER BY and LIMIT. Identical on every row of the page. Absent entirely when the
   * page is past the end, because a window function needs a row to be reported on;
   * that case is covered by the wrapped-count fallback, not by reading this as 0.
   */
  total_matching: number;
}

/** One row, always. Shape of the page-independent summary aggregate. */
interface TrackerSummaryRow extends RowDataPacket {
  total_employees: number;
  completed_count: number;
  in_progress_count: number;
  pending_count: number;
  overdue_count: number;
  needs_correction: number;
}

/**
 * Narrow a caller-supplied list of employee ids to the ones inside the actor's
 * branch scope.
 *
 * Every bulk action on this page takes employee ids straight from the request
 * body. Scoping only the list they were selected from is not enough: the ids are
 * visible on other screens, and an id that survives into a bulk body is acted on
 * with no further check. Returns the ids that are genuinely in scope — an empty
 * array means act on nobody, never on everybody.
 */
export async function filterEmployeeIdsToScope(
  actorUserId: string,
  employeeIds: string[]
): Promise<string[]> {
  if (employeeIds.length === 0) return [];
  const scope = await buildScopeWhereClause(actorUserId, TRACKER_SCOPE_ROLES, { branchId: 'e.branch_id' });
  if (scope.sql === '1=1') return employeeIds;
  if (scope.sql === '1=0') return [];
  const [rows] = await db.query<RowDataPacket[]>(
    `SELECT e.id FROM employees e WHERE e.id IN (?) AND (${scope.sql})`,
    [employeeIds, ...scope.params]
  );
  return (rows as Array<{ id: string }>).map((r) => r.id);
}

export async function getJoiningDocumentsTracker(
  actorUserId: string,
  filters: TrackerQueryParams
): Promise<TrackerResponse> {
  // Clamped here as well as at the route, deliberately. The route is one caller and
  // this is the function that builds the OFFSET arithmetic, so it cannot assume its
  // input was already sanitised — a NaN page would otherwise reach the query as
  // `OFFSET NaN`. Every branch below returns these same effective values, so the
  // echo the caller reads back is what was actually applied.
  const page = clampPage(filters.page);
  const limit = clampLimit(filters.limit);
  const offset = (page - 1) * limit;

  // Build WHERE clause filters
  //
  // Scope: anyone who actually has joining documents, plus current staff.
  //
  // Pre-joiners sit at active_status = 0 until their joining date, so filtering
  // on 1 alone hid precisely the population whose documents must be signed
  // before day one. But active_status = 0 is overwhelmingly *left the company*,
  // not *not yet joined* — on live data it covers 57,310 resigned, terminated
  // and inactive records against 9 employees who genuinely have a checklist.
  // Widening to IN (0, 1) therefore buried the tracker under ex-employees.
  //
  // Presence of a checklist is the honest test: it is created when a joiner
  // needs documents, so it admits pre-joiners without admitting leavers, and it
  // needs no interpretation of employment_status.
  const whereClauses: string[] = [
    // The population predicate lives in TRACKER_POPULATION_JOIN above, not here.
    // Written as three ORs in the WHERE it was unindexable: MySQL scanned all
    // 59,356 employee rows and ran the checklist EXISTS once per row, 6.4s per
    // call — and the page issues two of these per keystroke, which is why the
    // search box looked broken rather than slow.
    `(e.employment_status IS NULL OR e.employment_status NOT IN ('resigned', 'terminated'))`,
    'e.employee_code IS NOT NULL',
    // Legacy (db_bill-migrated) employees get a placeholder checklist row from
    // createLegacyJoiningChecklists.ts (mandatory=0, status='verified' — their
    // documents were verified offline pre-HRMS), which satisfies the checklist
    // EXISTS clause above and makes them pass through into this tracker showing
    // "pending" — they were never real joining-document work items. Exclude them
    // outright rather than trying to display a synthetic "verified" status.
    'e.legacy_emp_id IS NULL',
  ];
  const params: (string | number)[] = [];

  // Branch RBAC.
  //
  // Only branch_head used to be scoped, by reading the branch off the actor's own
  // employee row. Every hr and payroll_hr on this page therefore saw all 287
  // employees across all four branches, even though their role grant is a branch
  // grant — the same shape of hole the appointment-letter queue had.
  //
  // buildScopeWhereClause() is the codebase's one scope resolver: it reads
  // user_assignment_scope, so scope_type='all' (head-office hr/admin, payroll
  // heads) still means org-wide, super_admin bypasses inside it, and a user whose
  // roles carry no scope row at all resolves to 1=0 rather than to everything.
  const scope = await buildScopeWhereClause(actorUserId, TRACKER_SCOPE_ROLES, { branchId: 'e.branch_id' });
  whereClauses.push(`(${scope.sql})`);
  params.push(...(scope.params as (string | number)[]));

  // Apply filters
  if (filters.status && filters.status !== 'all') {
    whereClauses.push('e.joining_document_status = ?');
    params.push(filters.status);
  }

  if (filters.branch_id) {
    whereClauses.push('e.branch_id = ?');
    params.push(filters.branch_id);
  }

  if (filters.process_id) {
    whereClauses.push('e.process_id = ?');
    params.push(filters.process_id);
  }

  if (filters.completion_min !== undefined) {
    whereClauses.push('e.joining_document_completion_pct >= ?');
    params.push(filters.completion_min);
  }

  if (filters.completion_max !== undefined) {
    whereClauses.push('e.joining_document_completion_pct <= ?');
    params.push(filters.completion_max);
  }

  if (filters.search && filters.search.trim()) {
    whereClauses.push('(e.employee_code LIKE ? OR e.full_name LIKE ?)');
    // % and _ are LIKE wildcards, so an unescaped box lets a typed "%" match the
    // whole branch rather than nothing.
    const searchPattern = `%${filters.search.trim().replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
    params.push(searchPattern, searchPattern);
  }

  // Subquery for overdue_only filter (need HAVING clause)
  let havingClause = '';
  if (filters.overdue_only) {
    havingClause = 'HAVING overdue_count > 0';
  }

  const whereSQL = whereClauses.join(' AND ');

  /**
   * The eSign bucket expression, GENERATED from Esign_State_Authority.
   *
   * This replaces three hard-coded states (`= 'esign_completed'` for completed,
   * `IN ('esign_initiated','pending_candidate_esign')` for pending). Those two
   * counters did not partition the checklist: a row in `ready_for_esign`,
   * `draft_generated`, `hr_fill_required`, `employee_review_pending`,
   * `correction_requested` or `esign_failed` was in neither, so it left the
   * denominator silently. MAS63411's nine documents read as a green "5/5" with
   * four of them unsigned.
   *
   * Because `ESIGN_STATE_BUCKET` is total, `completed + (not completed)` is
   * exactly `COUNT(c.id)` — the denominator *is* the row count, so no document
   * can leave it (Requirement 6, criteria 1 and 3).
   */
  const esignBucketSQL = esignBucketCaseSql('c.status');

  /**
   * The overdue predicate, extracted for the same reason `fromWhereGroupSQL` is.
   *
   * `havingClause` filters on the `overdue_count` *alias*, so every statement that
   * interpolates `fromWhereGroupSQL` has to define that alias — and if two of them
   * defined it with different expressions, `overdue_only` would filter one population
   * while the count reported another. One expression, three readers.
   */
  const overdueCountSQL = `SUM(CASE WHEN c.due_at < NOW() AND c.verification_status IS NULL THEN 1 ELSE 0 END)`;

  /**
   * Two spellings, one meaning. The HR-side path writes 'needs_correction' (hence the
   * original LIKE), but the public/employee correction path writes
   * 'correction_requested', which the LIKE never matched — so corrections raised from
   * that path were never counted here or in the summary tile. Shared with the summary
   * aggregate so the tile and the row column cannot disagree.
   */
  const needsCorrectionCountSQL = `SUM(CASE WHEN c.status LIKE '%needs_correction%' OR c.status = 'correction_requested' THEN 1 ELSE 0 END)`;

  /**
   * `FROM … WHERE … GROUP BY … HAVING` — built once, interpolated everywhere.
   *
   * Three statements read it: the row query, the page-independent summary aggregate,
   * and the past-the-end count fallback. They must scan an *identical* population or
   * the count and the page disagree, and the tiles describe a different set from the
   * rows under them. Sharing the text makes that structural rather than a convention
   * someone has to remember to honour.
   *
   * Note this fragment ends after `HAVING`, so any SELECT that interpolates it
   * must define an `overdue_count` output alias — `havingClause` filters on it.
   */
  const fromWhereGroupSQL = `
    FROM employees e
    ${TRACKER_POPULATION_JOIN}
    LEFT JOIN branch_master b ON e.branch_id = b.id
    LEFT JOIN process_master p ON e.process_id = p.id
    LEFT JOIN employee_joining_document_checklist c ON e.id = c.employee_id
    LEFT JOIN auth_user u ON c.assigned_hr_user_id = u.id
    LEFT JOIN employees emp_hr ON emp_hr.user_id = u.id

    WHERE ${whereSQL}
    GROUP BY e.id
    ${havingClause}
  `;

  const sql = `
    SELECT
      e.id,
      e.employee_code,
      e.full_name,
      e.branch_id,
      e.process_id,
      e.date_of_joining,

      -- Correlated scalar subqueries, not joins. ats_onboarding_bridge and
      -- salary_component_assignments both hold more than one row per employee, so
      -- joining them would multiply the checklist rows and silently inflate
      -- COUNT(c.id) — the document counter this page is built on.
      (SELECT MAX(op.submitted_at)
         FROM ats_onboarding_bridge ab
         JOIN candidate_onboarding_profile op ON op.candidate_id = ab.candidate_id
        WHERE ab.employee_id = e.id) AS onboarding_submitted_at,
      (SELECT MAX(sca.assigned_at)
         FROM salary_component_assignments sca
        WHERE sca.employee_id = e.id) AS salary_assigned_at,

      e.joining_document_status,
      e.joining_document_completion_pct,
      e.active_status,
      b.branch_name,
      p.process_name,
      p.business_lob AS lob_name,

      GROUP_CONCAT(
        CASE WHEN c.document_code IN ('APPOINTMENT_LETTER', 'ID_PROOF', 'BANK_DETAILS', 'ADDRESS_PROOF')
        THEN CONCAT(c.document_code, ':', c.status, ':', COALESCE(c.verification_status, 'null'))
        END SEPARATOR '||'
      ) AS key_documents_raw,

      COUNT(c.id) AS total_documents,
      SUM(CASE WHEN c.verification_status = 'verified' THEN 1 ELSE 0 END) AS verified_count,
      ${needsCorrectionCountSQL} AS needs_correction_count,
      ${overdueCountSQL} AS overdue_count,

      -- NULL is produced HERE and nowhere else: no checklist rows means there is
      -- no eSign denominator to report, which is not the same statement as "0 of 0
      -- signed". The mapper passes it straight through and the page renders a dash.
      --
      -- SUM() over a LEFT JOIN with no matching row already yields NULL, but the
      -- explicit CASE states the intent and survives a change to the join graph.
      --
      -- The pending counter is "everything not completed" rather than a second
      -- enumerated list, which is what keeps completed + pending = COUNT(c.id).
      CASE WHEN COUNT(c.id) = 0 THEN NULL
           ELSE SUM(${esignBucketSQL} = 'completed') END AS esign_completed_count,
      CASE WHEN COUNT(c.id) = 0 THEN NULL
           ELSE SUM(${esignBucketSQL} <> 'completed') END AS esign_pending_count,
      MAX(c.updated_at) AS last_document_update,
      MAX(emp_hr.full_name) AS assigned_hr_name,

      -- The filtered total, from the same statement as the page.
      --
      -- MySQL evaluates window functions after WHERE/GROUP BY/HAVING and before
      -- ORDER BY/LIMIT, so on this grouped-and-having-filtered result COUNT(*) OVER ()
      -- is exactly the number of matching employees — computed in the same pass, so it
      -- cannot disagree with the rows the way a separately-built count query can when a
      -- filter is added to one and not the other.
      COUNT(*) OVER () AS total_matching
    ${fromWhereGroupSQL}
    -- date_of_joining alone is not a total order: 309 employees over ~26 dispatch days
    -- guarantees ties, and MySQL is free to break a tie differently between the
    -- OFFSET 0 and OFFSET 50 executions — so an employee could appear on two pages or
    -- on none, which is precisely what criterion 5 forbids. employee_code is non-null
    -- by the WHERE above, and e.id closes it as the guaranteed-unique final key.
    ORDER BY e.date_of_joining DESC, e.employee_code ASC, e.id ASC
    LIMIT ? OFFSET ?
  `;

  // db.query, not db.execute, and that is load-bearing.
  //
  // LIMIT and OFFSET are bound rather than interpolated — but the prepared-statement
  // protocol behind db.execute() rejects a bound parameter in LIMIT on this server
  // (MySQL 8.0.42) with ER_WRONG_ARGUMENTS regardless of the JS type, a defect this
  // repo has hit and documented several times over (see backend/src/db/pagination.ts).
  // db.query() uses the text protocol, where mysql2 escapes the values client-side, so
  // the values still never touch the SQL as raw text and the numbers still arrive as
  // numbers. That is the pattern already working in grn.service.ts:1466 and
  // client-billing.routes.ts:168 against this same database.
  const [rows] = await db.query<TrackerQueryRow[]>(sql, [...params, limit, offset]);

  const employees: EmployeeDocumentRow[] = rows.map(row => ({
    id: row.id,
    employee_id: row.id,
    employee_code: row.employee_code,
    full_name: row.full_name,
    branch_name: row.branch_name || '',
    process_name: row.process_name || '',
    lob_name: row.lob_name,
    date_of_joining: row.date_of_joining,
    onboarding_submitted_at: row.onboarding_submitted_at,
    salary_assigned_at: row.salary_assigned_at,
    joining_document_status: row.joining_document_status,
    joining_document_completion_pct: Number(row.joining_document_completion_pct),
    is_pre_joining: Number(row.active_status ?? 1) === 0,
    total_documents: Number(row.total_documents),
    verified_count: Number(row.verified_count),
    needs_correction_count: Number(row.needs_correction_count),
    overdue_count: Number(row.overdue_count),
    // No `?? 0` here, deliberately. The SQL already decided whether there is an
    // eSign denominator at all; coercing its NULL to 0 was the whole defect —
    // the page renders a dash for null and a badge for a number, and it was being
    // handed a number for employees with nothing to sign.
    esign_completed_count: row.esign_completed_count === null ? null : Number(row.esign_completed_count),
    esign_pending_count: row.esign_pending_count === null ? null : Number(row.esign_pending_count),
    last_document_update: row.last_document_update,
    assigned_hr_name: row.assigned_hr_name,
    key_documents: parseKeyDocuments(row.key_documents_raw),
  }));

  /**
   * `total`, resolved in the one case the window function cannot answer.
   *
   * COUNT(*) OVER () needs a row to be reported on, so a page past the end returns
   * nothing at all — not a row saying 0. Reading the absence as `total = 0` would set
   * `hasPrev` false and strand the caller on an empty page with no way back. So when
   * the page came back empty AND it is not page 1, ask for the count directly, over the
   * identical grouped text.
   *
   * On page 1 an empty result genuinely means the filters match nobody, and the second
   * query is skipped — a real 0 costs no extra round trip.
   */
  let total: number;
  if (rows.length > 0) {
    total = Number(rows[0].total_matching);
  } else if (page > DEFAULT_PAGE) {
    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM (
         SELECT e.id, ${overdueCountSQL} AS overdue_count
         ${fromWhereGroupSQL}
       ) t`,
      params
    );
    total = Number((countRows[0] as { total: number } | undefined)?.total ?? 0);
  } else {
    total = 0;
  }

  const summary = await queryTrackerSummary(fromWhereGroupSQL, overdueCountSQL, needsCorrectionCountSQL, params);

  return {
    rows: employees,
    total,
    summary,
    page,
    limit,
    // Derived from `total`, not from `rows.length`. `rows.length === limit` would claim
    // a next page exists whenever the last page happens to be exactly full.
    hasNext: page * limit < total,
    hasPrev: page > DEFAULT_PAGE && total > 0,
  };
}

/**
 * The summary tiles, computed over the whole filtered set rather than over one page.
 *
 * `calculateTrackerSummary` walks the rows it is handed, which was correct while the
 * query returned every match. With real pagination those rows are page 1 of n, so the
 * tiles would describe fifty employees and the list would say there are 309 —
 * Requirement 7 criterion 3 wants the tiles to sum to the whole population. Hence a
 * second aggregate over the *same* `fromWhereGroupSQL`, which is what keeps the tiles
 * and the rows describing one set.
 *
 * `calculateTrackerSummary` stays exported and unchanged: it is still the pure function
 * the unit tests target, and still the shape this returns.
 */
async function queryTrackerSummary(
  fromWhereGroupSQL: string,
  overdueCountSQL: string,
  needsCorrectionCountSQL: string,
  params: (string | number)[]
): Promise<TrackerSummary> {
  // The bucket bands and their output aliases both come from the same two tables
  // `classifyEmployeeBucket` and `calculateTrackerSummary` use, so a fourth bucket
  // cannot be added to `SummaryBucket` without this SELECT gaining a column for it.
  const bucketCountSelects = (Object.entries(BUCKET_COUNT_FIELD) as Array<
    [SummaryBucket, (typeof BUCKET_COUNT_FIELD)[SummaryBucket]]
  >)
    .map(([bucket, field]) => `SUM(${summaryBucketCaseSql('t.pct')} = '${bucket}') AS ${field}`)
    .join(',\n      ');

  const [summaryRows] = await db.execute<TrackerSummaryRow[]>(
    `SELECT
      COUNT(*) AS total_employees,
      ${bucketCountSelects},
      -- Cross-cutting, not buckets: an employee can be both in_progress and overdue,
      -- so these sit outside the three-way partition and must not be added into it.
      SUM(CASE WHEN t.overdue_count > 0 THEN 1 ELSE 0 END) AS overdue_count,
      SUM(CASE WHEN t.needs_correction_count > 0 THEN 1 ELSE 0 END) AS needs_correction
    FROM (
      SELECT
        e.id,
        e.joining_document_completion_pct AS pct,
        ${overdueCountSQL} AS overdue_count,
        ${needsCorrectionCountSQL} AS needs_correction_count
      ${fromWhereGroupSQL}
    ) t`,
    params
  );

  const row = summaryRows[0];
  // An empty filtered set aggregates to one row of NULLs, not to zero rows, so the
  // `?? 0` here is reading an absent SUM rather than papering over a missing row.
  return {
    total_employees: Number(row?.total_employees ?? 0),
    completed_count: Number(row?.completed_count ?? 0),
    in_progress_count: Number(row?.in_progress_count ?? 0),
    pending_count: Number(row?.pending_count ?? 0),
    overdue_count: Number(row?.overdue_count ?? 0),
    needs_correction: Number(row?.needs_correction ?? 0),
  };
}

// ─── Bulk Action Types ────────────────────────────────────────────────────────

export interface BulkRemindResult {
  success: true;
  sent: number;
  failed: number;
  skipped: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

export interface BulkGenerateResult {
  success: true;
  generated: number;
  skipped: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

// ─── sendBulkReminders ────────────────────────────────────────────────────────

export async function sendBulkReminders(
  employeeIds: string[],
  customMessage: string | null,
  actorUserId: string
): Promise<BulkRemindResult> {
  void actorUserId; // reserved for audit logging in future

  const result: BulkRemindResult = {
    success: true,
    sent: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };

  const [employees] = await db.query<RowDataPacket[]>(
    // A leaver must never be chased for joining paperwork, whatever the caller
    // selected — the ids arrive from the client, so the guard belongs here.
    `SELECT id, employee_code, full_name, official_email, personal_email, mobile
     FROM employees
     WHERE id IN (?)
       AND LOWER(COALESCE(employment_status, '')) NOT IN ('resigned', 'terminated')`,
    [employeeIds]
  );

  for (const emp of employees as Array<{
    id: string;
    employee_code: string;
    full_name: string;
    official_email: string | null;
    personal_email: string | null;
    mobile: string | null;
  }>) {
    const toEmail = emp.official_email ?? emp.personal_email;
    if (!toEmail) {
      result.failed++;
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: 'No email address',
      });
      continue;
    }

    try {
      // Fetch names of pending/incomplete documents for this employee
      const [docRows] = await db.execute<RowDataPacket[]>(
        `SELECT document_name FROM employee_joining_document_checklist
         WHERE employee_id = ? AND status NOT IN ('verified','signed','completed')
         ORDER BY created_at ASC`,
        [emp.id]
      );
      const pendingDocs = (docRows as any[]).map((r: any) => String(r.document_name));
      void customMessage; // reserved for future custom message override
      if (pendingDocs.length === 0) {
        // All documents already complete — skip sending a redundant reminder
        result.skipped++;
        continue;
      }
      await sendJoiningDocReminderEmail({
        to: toEmail,
        employeeName: emp.full_name,
        pendingDocuments: pendingDocs,
        employeeId: emp.id,
      });
      result.sent++;
    } catch (error: unknown) {
      result.failed++;
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}

// ─── bulkAssignHR ─────────────────────────────────────────────────────────────

export interface BulkAssignResult {
  success: true;
  updated: number;
}

export async function bulkAssignHR(
  employeeIds: string[],
  assignedHrUserId: string,
  actorUserId: string
): Promise<BulkAssignResult> {
  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = (await connection.query(
      `UPDATE employee_joining_document_checklist
       SET assigned_hr_user_id = ?, updated_at = NOW()
       WHERE employee_id IN (?)`,
      [assignedHrUserId, employeeIds]
    )) as [ResultSetHeader, unknown];

    await connection.query(
      `INSERT INTO employee_joining_document_audit_log
       (employee_id, action_type, actor_user_id, remarks, created_at)
       SELECT DISTINCT employee_id, 'BULK_ASSIGN_HR', ?, ?, NOW()
       FROM employee_joining_document_checklist
       WHERE employee_id IN (?)`,
      [actorUserId, JSON.stringify({ assigned_hr_user_id: assignedHrUserId }), employeeIds]
    );

    await connection.commit();
    return { success: true, updated: result.affectedRows };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ─── bulkSetDueDate ───────────────────────────────────────────────────────────

export interface BulkSetDueDateResult {
  success: true;
  updated: number;
}

export async function bulkSetDueDate(
  employeeIds: string[],
  dueDate: string,
  documentCodes: string[] | null,
  actorUserId: string
): Promise<BulkSetDueDateResult> {
  let sql = `UPDATE employee_joining_document_checklist
             SET due_at = ?, updated_at = NOW()
             WHERE employee_id IN (?)`;
  const params: (string | string[])[] = [dueDate, employeeIds];

  if (documentCodes && documentCodes.length > 0) {
    sql += ` AND document_code IN (?)`;
    params.push(documentCodes);
  }

  const connection = await db.getConnection();
  try {
    await connection.beginTransaction();

    const [result] = (await connection.query(sql, params)) as [ResultSetHeader, unknown];

    await connection.query(
      `INSERT INTO employee_joining_document_audit_log
       (employee_id, action_type, actor_user_id, remarks, created_at)
       SELECT DISTINCT employee_id, 'BULK_SET_DUE_DATE', ?, ?, NOW()
       FROM employee_joining_document_checklist
       WHERE employee_id IN (?)`,
      [actorUserId, JSON.stringify({ due_date: dueDate, document_codes: documentCodes }), employeeIds]
    );

    await connection.commit();
    return { success: true, updated: result.affectedRows };
  } catch (error: unknown) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}

// ─── bulkVerifyDocuments ──────────────────────────────────────────────────────

export interface BulkVerifyResult {
  success: true;
  verified: number;
  errors: Array<{ employee_id: string; employee_code: string; error: string }>;
}

export async function bulkVerifyDocuments(
  employeeIds: string[],
  actorUserId: string
): Promise<BulkVerifyResult> {
  const result: BulkVerifyResult = {
    success: true,
    verified: 0,
    errors: [],
  };

  // Completion is recalculated by the canonical writer once each employee's
  // transaction has committed. This used to compute its own percentage here,
  // over a different denominator (all documents rather than mandatory ones) and
  // writing status strings — 'verified_complete' / 'pending_verification' —
  // that are not in the vocabulary every consumer switches on, and only to
  // `employees`, never `ats_onboarding_bridge`. HR saw 100%, then the next
  // person to open that employee's pack triggered the real recalculation and
  // the number dropped again.
  const recalcNeeded: string[] = [];

  for (const employeeId of employeeIds) {
    const connection = await db.getConnection();
    try {
      await connection.beginTransaction();

      // Two statements, one per provenance. They need different end states and
      // different audit rows, so they cannot be collapsed into one UPDATE.

      // 1. Uploaded rows — a human clicked verify.
      const [uploadedResult] = (await connection.execute(
        // `status` has to move as well. Setting only verification_status left
        // the row at 'uploaded_pending_review', which recalculateDocumentProgress
        // — the canonical writer — still counts as incomplete.
        `UPDATE employee_joining_document_checklist
         SET status = 'verified', verification_status = 'verified',
             verified_at = NOW(), verified_by = ?, due_at = NULL, updated_at = NOW()
         WHERE employee_id = ? AND status = 'uploaded_pending_review'`,
        [actorUserId, employeeId]
      )) as [ResultSetHeader, unknown];

      // 2. eSigned rows — nobody reviewed these, the provider verified the
      //    signature. `status` deliberately stays at 'esign_completed': it is
      //    the accurate account of how the document arrived, and unlike
      //    'uploaded_pending_review' recalculateDocumentProgress already counts
      //    it as complete, so there is nothing to move it for. `verified_by`
      //    stays NULL for the same reason — there is no human verifier.
      //    `verification_status IS NULL` makes a re-run a zero-row no-op.
      const [esignedResult] = (await connection.execute(
        `UPDATE employee_joining_document_checklist
         SET verification_status = 'verified', verified_at = NOW(),
             verification_remarks = 'Verified by Aadhaar eSign (Luckpay)',
             due_at = NULL, updated_at = NOW()
         WHERE employee_id = ? AND status = 'esign_completed'
           AND signature_mode = 'aadhaar_esign_verified'
           AND verification_status IS NULL`,
        [employeeId]
      )) as [ResultSetHeader, unknown];

      if (uploadedResult.affectedRows > 0) {
        result.verified += uploadedResult.affectedRows;

        await connection.execute(
          `INSERT INTO employee_joining_document_audit_log
           (employee_id, action_type, actor_user_id, remarks, created_at)
           VALUES (?, 'BULK_VERIFY', ?, 'Verified all pending documents', NOW())`,
          [employeeId, actorUserId]
        );
      }

      if (esignedResult.affectedRows > 0) {
        result.verified += esignedResult.affectedRows;

        // Distinct action_type so eSign-origin verification is distinguishable
        // from verification of an uploaded document by value, not by timestamp.
        await connection.execute(
          `INSERT INTO employee_joining_document_audit_log
           (employee_id, action_type, actor_user_id, new_value, remarks, created_at)
           VALUES (?, 'BULK_VERIFY_ESIGNED', ?, ?, 'Verified eSigned documents', NOW())`,
          [
            employeeId,
            actorUserId,
            JSON.stringify({
              verificationSource: 'aadhaar_esign',
              signatureMode: 'aadhaar_esign_verified',
              rowsVerified: esignedResult.affectedRows,
            }),
          ]
        );
      }

      if (uploadedResult.affectedRows > 0 || esignedResult.affectedRows > 0) {
        recalcNeeded.push(employeeId);
      }

      await connection.commit();
    } catch (error: unknown) {
      await connection.rollback();
      const [emp] = await db.execute<RowDataPacket[]>(
        `SELECT employee_code FROM employees WHERE id = ? LIMIT 1`,
        [employeeId]
      );
      result.errors.push({
        employee_id: employeeId,
        employee_code: (emp[0] as any)?.employee_code ?? employeeId,
        error: error instanceof Error ? error.message : String(error),
      });
    } finally {
      connection.release();
    }
  }

  for (const employeeId of recalcNeeded) {
    try {
      await recalculateDocumentProgress(employeeId);
    } catch (error: unknown) {
      // The verification itself is committed; a failed recalculation only means
      // the percentage is stale until the pack is next opened, which recomputes
      // it anyway. Do not fail the bulk action for it.
      console.error('[bulkVerifyDocuments] progress recalculation failed', employeeId, error);
    }
  }

  return result;
}

// ─── streamBulkDocumentsZip ───────────────────────────────────────────────────

export async function streamBulkDocumentsZip(
  employeeIds: string[],
  documentCodes: string[] | null,
  res: Response,
  actorUserId?: string
): Promise<void> {
  const archive = archiverLib('zip', { zlib: { level: 9 } });

  // Pipe archive data to Express response
  archive.pipe(res);
  archive.on('error', (err: Error) => {
    console.error('[tracker] Archive error during ZIP creation:', err.message);
  });

  // Branch RBAC — the same resolver getJoiningDocumentsTracker() uses above.
  // Without this, any user on this page could reach every other branch's verified
  // documents by supplying arbitrary employee_ids to this bulk-download endpoint,
  // even though the list-and-select flow now restricts them to their own branch.
  // It used to guard branch_head alone, which left hr and payroll_hr — the roles
  // this page is actually used by — able to download org-wide.
  let scopedEmployeeIds = employeeIds;
  if (actorUserId && employeeIds.length > 0) {
    const ids = await filterEmployeeIdsToScope(actorUserId, employeeIds);
    if (ids.length === 0) {
      // Nothing in scope — finalize an empty archive rather than falling through
      // to an unrestricted query.
      await archive.finalize();
      return;
    }
    scopedEmployeeIds = ids;
  }

  let sql = `
    SELECT
      e.employee_code,
      e.full_name,
      c.document_code,
      f.storage_path,
      f.original_filename
    FROM employees e
    JOIN employee_joining_document_checklist c ON e.id = c.employee_id
    JOIN employee_joining_document_file f ON c.id = f.checklist_id
    WHERE e.id IN (?)
      AND f.file_role IN ('hr_uploaded', 'generated', 'signed')
      AND c.verification_status = 'verified'
  `;

  const params: (string[] | string)[] = [scopedEmployeeIds];

  if (documentCodes && documentCodes.length > 0) {
    sql += ` AND c.document_code IN (?)`;
    params.push(documentCodes);
  }

  sql += ` ORDER BY e.employee_code, c.document_code`;

  const [files] = await db.query<RowDataPacket[]>(sql, params);

  for (const file of files as Array<{
    employee_code: string;
    full_name: string;
    document_code: string;
    storage_path: string;
    original_filename: string;
  }>) {
    const resolvedPath = path.resolve(STORAGE_ROOT, file.storage_path);
    if (!resolvedPath.startsWith(STORAGE_ROOT + path.sep) && resolvedPath !== STORAGE_ROOT) {
      console.warn(`[tracker] Path traversal blocked for storage_path: ${file.storage_path}`);
      continue;
    }

    if (fs.existsSync(resolvedPath)) {
      const safeName = file.full_name.replace(/[^a-zA-Z0-9]/g, '');
      const folderName = `${file.employee_code}-${safeName}`;
      const safeFilename = path.basename(file.original_filename);
      const archivePath = `${folderName}/${file.document_code}-${safeFilename}`;
      archive.file(resolvedPath, { name: archivePath });
    }
  }

  await archive.finalize();
}

// ─── bulkGenerateChecklists ───────────────────────────────────────────────────

export async function bulkGenerateChecklists(
  employeeIds: string[],
  actorUserId: string
): Promise<BulkGenerateResult> {
  const result: BulkGenerateResult = {
    success: true,
    generated: 0,
    skipped: 0,
    errors: [],
  };

  const [employees] = await db.query<RowDataPacket[]>(
    // Generating a joining-document pack for someone who has already left is
    // the worst outcome here: it creates paperwork, emails and audit rows for a
    // person no longer employed. Refuse regardless of what was selected.
    `SELECT id, employee_code, full_name
     FROM employees
     WHERE id IN (?)
       AND LOWER(COALESCE(employment_status, '')) NOT IN ('resigned', 'terminated')`,
    [employeeIds]
  );

  const [existingChecklists] = await db.query<RowDataPacket[]>(
    `SELECT DISTINCT employee_id FROM employee_joining_document_checklist WHERE employee_id IN (?)`,
    [employeeIds]
  );

  const existingEmployeeIds = new Set(
    (existingChecklists as Array<{ employee_id: string }>).map(r => r.employee_id)
  );

  for (const emp of employees as Array<{ id: string; employee_code: string; full_name: string }>) {
    if (existingEmployeeIds.has(emp.id)) {
      result.skipped++;
      continue;
    }

    try {
      await generateJoiningDocumentChecklist(emp.id, actorUserId);
      result.generated++;
    } catch (error: unknown) {
      result.errors.push({
        employee_id: emp.id,
        employee_code: emp.employee_code,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  return result;
}
