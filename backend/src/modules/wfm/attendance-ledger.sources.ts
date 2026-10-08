// backend/src/modules/wfm/attendance-ledger.sources.ts
// Source definitions + query builders for the Branch Ledger (attendance-ledger.routes.ts).
//
// The ledger is a read-only, per-branch record of every attendance correction decision:
// who received it (the employee) and who gave it (the actor). It is assembled from five
// SEPARATE stores, each queried on its own so one broken source cannot take the ledger down.
//
// Column evidence (every column below appears in backend/sql/schema-snapshot.json, which is
// generated from the live mas_hrms schema, and in the cited code path):
//
//   attendance_regularization  ar    wfm.service.ts reviewRegularization (status, reviewed_by,
//                                    reviewed_at, reviewer_note); attendance.dispute.routes.ts
//                                    (dispute_type, escalated_*, payroll_head_approved_*);
//                                    migration 237: dispute_type NULL = plain regularization,
//                                    set = formal dispute. reviewed_by holds auth_user.id.
//   attendance_daily_record    adr   mismatch-review.routes.ts PATCH /:id/resolve writes
//                                    mismatch_resolved_at/_by/_resolution_reason (user id).
//                                    attendance.manual-override.routes.ts writes override_by /
//                                    override_reason / status_changed_*.
//   attendance_reconciliation_issue ari  attendance-exceptions.routes.ts /:id/resolve writes
//                                    resolved_at, reviewed_by (user id), reviewed_at, review_notes.
//
// IMPORTANT double-count trap: wfm.service.ts reviewRegularization ALSO stamps
// attendance_daily_record.override_by / override_reason when it applies an approved
// regularization (it sets regularization_id on the same row). A "manual override" is therefore
// only a row with override_by set AND regularization_id NULL — otherwise every approved
// regularization would be counted twice.
//
// Date basis: each source is windowed on the date of the ATTENDANCE DAY it concerns
// (session_date / record_date / issue_date), not the date the decision was made — those are the
// leading columns of the date indexes, and they keep "May's attendance" = "May's ledger".
// The decision timestamp is reported separately as acted_at.
//
// Dates: the main DB pool runs with dateStrings: true (db/mysql.ts), so DATE/DATETIME columns
// arrive as 'YYYY-MM-DD' / 'YYYY-MM-DD HH:mm:ss' strings in IST — never JS Dates.

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';

export type LedgerKind =
  | 'regularization'
  | 'mismatch_resolution'
  | 'exception_resolution'
  | 'dispute'
  | 'manual_override';

export const LEDGER_KINDS: readonly LedgerKind[] = [
  'regularization',
  'mismatch_resolution',
  'exception_resolution',
  'dispute',
  'manual_override',
] as const;

export function isLedgerKind(value: unknown): value is LedgerKind {
  return typeof value === 'string' && (LEDGER_KINDS as readonly string[]).includes(value);
}

export interface SourceFilter {
  from: string;
  to: string;
  scopeSql: string;
  scopeParams: unknown[];
  branchId?: string;
  employeeId?: string;
  actorId?: string;
  search?: string;
}

interface SourceDef {
  kind: LedgerKind;
  label: string;
  alias: string;
  from: string;
  dateCol: string;
  baseWhere: string;
  actorCol: string;
  bucketExpr: string;
  decisionExpr: string;
  reasonExpr: string;
  noteExpr: string;
  actedAtExpr: string;
  /** SELECT fragments aliased meta_* — surfaced to the client as `meta`. */
  metaCols: string;
  /** user-id columns on the source row that resolve to a person in the drawer. */
  actorFields: string[];
}

const EMPLOYEE_NAME_EXPR =
  "COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))))";

const REG_FROM = `
  FROM attendance_regularization ar
  JOIN employees e ON e.id = ar.employee_id
  LEFT JOIN branch_master bm ON bm.id = e.branch_id
  LEFT JOIN attendance_reason_master arm ON arm.code = ar.reason_code`;

const ADR_FROM = `
  FROM attendance_daily_record adr
  JOIN employees e ON e.id = adr.employee_id
  LEFT JOIN branch_master bm ON bm.id = e.branch_id`;

const ARI_FROM = `
  FROM attendance_reconciliation_issue ari
  JOIN employees e ON e.id = ari.employee_id
  LEFT JOIN branch_master bm ON bm.id = e.branch_id`;

const REG_ACTOR_FIELDS = [
  'reviewed_by', 'manager_reviewer_user_id', 'assigned_wfm_spoc_user_id',
  'final_wfm_reviewer_user_id', 'payroll_head_approved_by', 'escalated_by',
];

const REG_BASE: Omit<SourceDef, 'kind' | 'label' | 'baseWhere' | 'metaCols'> = {
  alias: 'ar',
  from: REG_FROM,
  dateCol: 'ar.session_date',
  actorCol: 'ar.reviewed_by',
  bucketExpr:
    "CASE WHEN ar.status = 'approved' THEN 'approved' WHEN ar.status = 'rejected' THEN 'rejected' " +
    "WHEN ar.status IN ('discarded', 'cancelled') THEN 'other' ELSE 'pending' END",
  decisionExpr: 'ar.status',
  reasonExpr: 'ar.reason',
  noteExpr: 'ar.reviewer_note',
  actedAtExpr: 'COALESCE(ar.reviewed_at, ar.created_at)',
  actorFields: REG_ACTOR_FIELDS,
};

export const SOURCES: Record<LedgerKind, SourceDef> = {
  regularization: {
    ...REG_BASE,
    kind: 'regularization',
    label: 'Regularization',
    baseWhere: 'ar.dispute_type IS NULL',
    metaCols:
      'ar.requested_status AS meta_requested_status, ar.reason_code AS meta_reason_code, ' +
      'arm.label AS meta_reason_label, ar.requested_by_type AS meta_requested_by_type',
  },
  dispute: {
    ...REG_BASE,
    kind: 'dispute',
    label: 'Dispute',
    baseWhere: 'ar.dispute_type IS NOT NULL',
    metaCols:
      'ar.dispute_type AS meta_dispute_type, ar.payroll_impact AS meta_payroll_impact, ' +
      'ar.payroll_head_approval_required AS meta_payroll_head_approval_required, ' +
      'ar.escalated_to AS meta_escalated_to',
  },
  mismatch_resolution: {
    kind: 'mismatch_resolution',
    label: 'Mismatch resolution',
    alias: 'adr',
    from: ADR_FROM,
    dateCol: 'adr.record_date',
    baseWhere: 'adr.mismatch_resolved_at IS NOT NULL',
    actorCol: 'adr.mismatch_resolved_by',
    bucketExpr: "'resolved'",
    decisionExpr: 'adr.attendance_status',
    reasonExpr: 'adr.mismatch_resolution_reason',
    noteExpr: 'NULL',
    actedAtExpr: 'adr.mismatch_resolved_at',
    metaCols:
      'adr.lwp_value AS meta_lwp_value, adr.biometric_status AS meta_biometric_status, ' +
      'adr.apr_status AS meta_apr_status, adr.attendance_source AS meta_attendance_source',
    actorFields: ['mismatch_resolved_by', 'status_changed_by'],
  },
  exception_resolution: {
    kind: 'exception_resolution',
    label: 'Exception resolution',
    alias: 'ari',
    from: ARI_FROM,
    dateCol: 'ari.issue_date',
    baseWhere: 'ari.resolved_at IS NOT NULL',
    actorCol: 'ari.reviewed_by',
    bucketExpr: "CASE WHEN ari.reviewed_by IS NULL THEN 'system' ELSE 'manual' END",
    decisionExpr: "'resolved'",
    reasonExpr: 'COALESCE(NULLIF(TRIM(ari.review_notes), \'\'), ari.auto_fix_reason)',
    noteExpr: 'NULL',
    actedAtExpr: 'COALESCE(ari.reviewed_at, ari.resolved_at)',
    metaCols:
      'ari.issue_type AS meta_issue_type, ari.severity AS meta_severity, ' +
      'ari.auto_fix_status AS meta_auto_fix_status',
    actorFields: ['reviewed_by'],
  },
  manual_override: {
    kind: 'manual_override',
    label: 'Manual override',
    alias: 'adr',
    from: ADR_FROM,
    dateCol: 'adr.record_date',
    baseWhere: 'adr.override_by IS NOT NULL AND adr.regularization_id IS NULL',
    actorCol: 'adr.override_by',
    bucketExpr: "'overridden'",
    decisionExpr: 'adr.attendance_status',
    reasonExpr: 'adr.override_reason',
    noteExpr: 'adr.status_change_reason',
    actedAtExpr: 'COALESCE(adr.status_changed_at, adr.processed_at)',
    metaCols:
      'adr.old_attendance_status AS meta_old_attendance_status, adr.old_lwp_value AS meta_old_lwp_value, ' +
      'adr.lwp_value AS meta_lwp_value, adr.is_locked AS meta_is_locked',
    actorFields: ['override_by', 'status_changed_by'],
  },
};

// ── WHERE builder ─────────────────────────────────────────────────────────────

export function buildSourceWhere(def: SourceDef, f: SourceFilter): { sql: string; params: unknown[] } {
  // Bounded window (validated to <= 92 days by the router) on the source's date-index column.
  const conds = [def.baseWhere, `${def.dateCol} >= ?`, `${def.dateCol} <= ?`];
  const params: unknown[] = [f.from, f.to];
  if (f.branchId) { conds.push('e.branch_id = ?'); params.push(f.branchId); }
  if (f.employeeId) { conds.push(`${def.alias}.employee_id = ?`); params.push(f.employeeId); }
  if (f.actorId) { conds.push(`${def.actorCol} = ?`); params.push(f.actorId); }
  if (f.search) {
    const like = `%${f.search}%`;
    conds.push(`(e.employee_code LIKE ? OR ${EMPLOYEE_NAME_EXPR} LIKE ?)`);
    params.push(like, like);
  }
  conds.push(`(${f.scopeSql})`);
  params.push(...f.scopeParams);
  return { sql: `WHERE ${conds.join(' AND ')}`, params };
}

// ── Aggregates (summary + people matrix) ─────────────────────────────────────

export interface AggregateRow {
  kind: LedgerKind;
  branch_id: string | null;
  employee_id: string;
  actor_id: string | null;
  bucket: string;
  n: number;
}

/** One grouped query per source; the same rows feed /summary and /people. */
export async function fetchAggregates(kind: LedgerKind, f: SourceFilter): Promise<AggregateRow[]> {
  const def = SOURCES[kind];
  const where = buildSourceWhere(def, f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT e.branch_id AS branch_id, ${def.alias}.employee_id AS employee_id,
            ${def.actorCol} AS actor_id, ${def.bucketExpr} AS bucket, COUNT(*) AS n
       ${def.from} ${where.sql}
      GROUP BY e.branch_id, ${def.alias}.employee_id, ${def.actorCol}, ${def.bucketExpr}`,
    where.params,
  );
  return (rows as RowDataPacket[]).map((r) => ({
    kind,
    branch_id: r.branch_id ?? null,
    employee_id: String(r.employee_id),
    actor_id: r.actor_id ?? null,
    bucket: String(r.bucket),
    n: Number(r.n ?? 0),
  }));
}

// ── Entries (list) ────────────────────────────────────────────────────────────

export interface EntryRow {
  kind: LedgerKind;
  source_id: string;
  record_date: string | null;
  employee_id: string;
  employee_name: string | null;
  employee_code: string | null;
  branch_id: string | null;
  branch_name: string | null;
  actor_id: string | null;
  decision: string | null;
  reason: string | null;
  note: string | null;
  acted_at: string | null;
  meta: Record<string, unknown>;
}

function toEntry(kind: LedgerKind, r: RowDataPacket): EntryRow {
  const meta: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(r)) {
    if (key.startsWith('meta_')) meta[key.slice(5)] = value;
  }
  return {
    kind,
    source_id: String(r.source_id),
    record_date: r.record_date ?? null,
    employee_id: String(r.employee_id),
    employee_name: r.employee_name ?? null,
    employee_code: r.employee_code ?? null,
    branch_id: r.branch_id ?? null,
    branch_name: r.branch_name ?? null,
    actor_id: r.actor_id ?? null,
    decision: r.decision ?? null,
    reason: r.reason ?? null,
    note: r.note ?? null,
    acted_at: r.acted_at ?? null,
    meta,
  };
}

/** `take` rows, newest decision first; `take` is an already-validated positive integer. */
export async function fetchEntries(kind: LedgerKind, f: SourceFilter, take: number): Promise<EntryRow[]> {
  const def = SOURCES[kind];
  const where = buildSourceWhere(def, f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${def.alias}.id AS source_id, ${def.dateCol} AS record_date,
            ${def.alias}.employee_id AS employee_id, ${EMPLOYEE_NAME_EXPR} AS employee_name,
            e.employee_code AS employee_code, e.branch_id AS branch_id, bm.branch_name AS branch_name,
            ${def.actorCol} AS actor_id, ${def.decisionExpr} AS decision,
            ${def.reasonExpr} AS reason, ${def.noteExpr} AS note, ${def.actedAtExpr} AS acted_at,
            ${def.metaCols}
       ${def.from} ${where.sql}
      ORDER BY ${def.actedAtExpr} DESC, ${def.alias}.id DESC
      LIMIT ${Math.trunc(take)}`,
    where.params,
  );
  return (rows as RowDataPacket[]).map((r) => toEntry(kind, r));
}

export async function countEntries(kind: LedgerKind, f: SourceFilter): Promise<number> {
  const def = SOURCES[kind];
  const where = buildSourceWhere(def, f);
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total ${def.from} ${where.sql}`,
    where.params,
  );
  return Number((rows as RowDataPacket[])[0]?.total ?? 0);
}

// ── Detail (drawer) ───────────────────────────────────────────────────────────

export interface DetailScope { scopeSql: string; scopeParams: unknown[] }

/** Full source row (every stored column) + the employee/branch labels, scope-checked. */
export async function fetchDetailRecord(
  kind: LedgerKind, id: string, s: DetailScope,
): Promise<Record<string, unknown> | null> {
  const def = SOURCES[kind];
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ${def.alias}.*, ${EMPLOYEE_NAME_EXPR} AS emp_name, e.employee_code AS emp_code,
            e.branch_id AS emp_branch_id, bm.branch_name AS emp_branch_name
       ${def.from}
      WHERE ${def.alias}.id = ? AND ${def.baseWhere} AND (${s.scopeSql})
      LIMIT 1`,
    [id, ...s.scopeParams],
  );
  return ((rows as RowDataPacket[])[0] as Record<string, unknown> | undefined) ?? null;
}

export function actorFieldsFor(kind: LedgerKind): string[] {
  return SOURCES[kind].actorFields;
}
