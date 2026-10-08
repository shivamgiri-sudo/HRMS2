// backend/src/modules/wfm/attendance-ledger.detail.ts
// Actor (person) resolution and drawer-detail assembly for the Branch Ledger.
//
// Actor identity: every "given by" column in the source tables holds an auth_user.id
// (req.authUser.id is what the writers store). The person is resolved through
// employees.user_id — the same link grn.service.ts / access.routes.ts use — with auth_user.email
// as fallback when no employee row is linked, and user_roles for the role label.
// Resolved in one batched lookup per call (not a JOIN) so a duplicate employees.user_id can
// never multiply ledger rows, and so no cross-table collation comparison is needed.

import type { RowDataPacket } from 'mysql2';
import { db } from '../../db/mysql.js';
import type { LedgerKind } from './attendance-ledger.sources.js';

export interface ActorInfo {
  user_id: string;
  name: string | null;
  code: string | null;
  employee_id: string | null;
  email: string | null;
  role: string | null;
}

const CHUNK = 400;
const NAME_EXPR =
  "COALESCE(NULLIF(TRIM(e.full_name), ''), TRIM(CONCAT(e.first_name, ' ', COALESCE(e.last_name, ''))))";

function chunks<T>(items: T[]): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += CHUNK) out.push(items.slice(i, i + CHUNK));
  return out;
}

const marks = (n: number) => Array.from({ length: n }, () => '?').join(',');

async function loadEmployeesByUser(ids: string[], into: Map<string, ActorInfo>): Promise<void> {
  for (const part of chunks(ids)) {
    // active_status DESC so a current employee wins over a stale duplicate link.
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.user_id AS user_id, e.id AS employee_id, e.employee_code AS code, ${NAME_EXPR} AS name
         FROM employees e WHERE e.user_id IN (${marks(part.length)})
        ORDER BY e.active_status DESC`,
      part,
    );
    for (const r of rows as RowDataPacket[]) {
      const key = String(r.user_id);
      if (into.has(key)) continue;
      into.set(key, {
        user_id: key, name: r.name ?? null, code: r.code ?? null,
        employee_id: r.employee_id ?? null, email: null, role: null,
      });
    }
  }
}

async function loadEmails(ids: string[], into: Map<string, ActorInfo>): Promise<void> {
  for (const part of chunks(ids)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, email FROM auth_user WHERE id IN (${marks(part.length)})`, part,
    );
    for (const r of rows as RowDataPacket[]) {
      const key = String(r.id);
      const cur = into.get(key);
      if (cur) into.set(key, { ...cur, email: r.email ?? null });
      else into.set(key, { user_id: key, name: null, code: null, employee_id: null, email: r.email ?? null, role: null });
    }
  }
}

async function loadRoles(ids: string[], into: Map<string, ActorInfo>): Promise<void> {
  const roles = new Map<string, string[]>();
  for (const part of chunks(ids)) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT user_id, role_key FROM user_roles WHERE active_status = 1 AND user_id IN (${marks(part.length)})`,
      part,
    );
    for (const r of rows as RowDataPacket[]) {
      const key = String(r.user_id);
      roles.set(key, [...(roles.get(key) ?? []), String(r.role_key)]);
    }
  }
  for (const [key, list] of roles) {
    const cur = into.get(key);
    if (cur) into.set(key, { ...cur, role: list.join(', ') });
  }
}

/** Best-effort: a failing lookup degrades to a bare user id, never to a failed ledger. */
export async function resolveActors(userIds: Array<string | null | undefined>): Promise<Map<string, ActorInfo>> {
  const ids = Array.from(new Set(userIds.filter((v): v is string => Boolean(v))));
  const out = new Map<string, ActorInfo>();
  if (ids.length === 0) return out;
  for (const step of [loadEmployeesByUser, loadEmails, loadRoles]) {
    try { await step(ids, out); } catch { /* degrade to whatever resolved so far */ }
  }
  for (const id of ids) {
    if (!out.has(id)) out.set(id, { user_id: id, name: null, code: null, employee_id: null, email: null, role: null });
  }
  return out;
}

export function actorLabel(kind: LedgerKind, decision: string | null, actorId: string | null): string | null {
  if (actorId) return null;
  if (kind === 'exception_resolution') return 'System (auto-fix)';
  if ((kind === 'regularization' || kind === 'dispute') && decision !== 'approved' && decision !== 'rejected') {
    return 'Awaiting review';
  }
  return 'Not recorded';
}

// ── Drawer detail ─────────────────────────────────────────────────────────────

export interface TimelineEvent { label: string; at: string | null; by: ActorInfo | null; note: string | null }

type Rec = Record<string, unknown>;
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v));

function ev(label: string, at: unknown, by: ActorInfo | null, note: unknown = null): TimelineEvent | null {
  return at ? { label, at: String(at), by, note: str(note) } : null;
}

export function buildTimeline(kind: LedgerKind, r: Rec, who: (field: string) => ActorInfo | null): TimelineEvent[] {
  const events: Array<TimelineEvent | null> = [];
  if (kind === 'regularization' || kind === 'dispute') {
    events.push(
      ev('Requested', r.created_at, null, r.reason),
      ev('Assigned to WFM SPOC', r.assigned_wfm_spoc_at, who('assigned_wfm_spoc_user_id')),
      ev(`Escalated${r.escalated_to ? ` to ${String(r.escalated_to)}` : ''}`, r.escalated_at, who('escalated_by')),
      ev('Manager review', r.manager_reviewed_at, who('manager_reviewer_user_id'), r.manager_review_note),
      ev('WFM review', r.final_wfm_reviewed_at, who('final_wfm_reviewer_user_id'), r.final_wfm_review_note),
      ev('Payroll Head approval', r.payroll_head_approved_at, who('payroll_head_approved_by')),
      ev(`Decision: ${String(r.status ?? '')}`, r.reviewed_at, who('reviewed_by'), r.reviewer_note),
    );
  } else if (kind === 'mismatch_resolution') {
    events.push(ev('Mismatch resolved', r.mismatch_resolved_at, who('mismatch_resolved_by'), r.mismatch_resolution_reason));
  } else if (kind === 'exception_resolution') {
    events.push(
      ev('First detected', r.first_detected_at, null, r.issue_type),
      ev('Resolved', r.reviewed_at ?? r.resolved_at, who('reviewed_by'), r.review_notes ?? r.auto_fix_reason),
    );
  } else {
    events.push(ev('Attendance overridden', r.status_changed_at ?? r.processed_at, who('override_by'), r.override_reason));
  }
  return events
    .filter((e): e is TimelineEvent => e !== null)
    .sort((a, b) => String(a.at).localeCompare(String(b.at)));
}

async function safeRows(sql: string, params: unknown[]): Promise<RowDataPacket[]> {
  try {
    const [rows] = await db.execute<RowDataPacket[]>(sql, params);
    return rows as RowDataPacket[];
  } catch {
    return [];
  }
}

const AUDIT_COLS = 'id, actor_user_id, actor_role, action_type, reason, old_value_json, new_value_json, acted_at';

/** sensitive_action_log is the audit table these writers use (logSensitiveAction). */
export async function fetchAuditTrail(kind: LedgerKind, r: Rec, warnings: string[]): Promise<RowDataPacket[]> {
  const id = String(r.id);
  const pairs: Array<[string, string]> = [];
  if (kind === 'regularization' || kind === 'dispute') pairs.push(['attendance_regularization', id]);
  else if (kind === 'mismatch_resolution') pairs.push(['attendance_daily_record', id]);
  else if (kind === 'exception_resolution') pairs.push(['attendance_reconciliation_issue', id]);
  else {
    // manual-override.routes.ts logs the record change under "<employee_id>:<date>" and the
    // request itself under the override id.
    pairs.push(['attendance_daily_record', `${String(r.employee_id)}:${String(r.record_date)}`]);
    const requests = await safeRows(
      `SELECT id FROM attendance_manual_override WHERE employee_id = ? AND attendance_date = ? LIMIT 10`,
      [String(r.employee_id), String(r.record_date)],
    );
    for (const req of requests) pairs.push(['attendance_manual_override', String(req.id)]);
  }
  const collected: RowDataPacket[] = [];
  for (const [entityType, entityId] of pairs) {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT ${AUDIT_COLS} FROM sensitive_action_log WHERE entity_type = ? AND entity_id = ?
          ORDER BY acted_at ASC LIMIT 50`,
        [entityType, entityId],
      );
      collected.push(...(rows as RowDataPacket[]));
    } catch {
      if (!warnings.includes('audit trail unavailable')) warnings.push('audit trail unavailable');
    }
  }
  return collected;
}

/** Sibling records on the same employee/day, so the drawer shows what else touched it. */
export async function fetchRelated(kind: LedgerKind, r: Rec): Promise<Record<string, RowDataPacket[]>> {
  const out: Record<string, RowDataPacket[]> = {};
  if (kind === 'regularization' || kind === 'dispute') {
    out.applied_attendance = await safeRows(
      `SELECT id, record_date, attendance_status, lwp_value, is_locked, clock_in_time, clock_out_time,
              old_attendance_status, old_lwp_value, status_change_reason, status_changed_by, status_changed_at
         FROM attendance_daily_record WHERE regularization_id = ? LIMIT 5`,
      [String(r.id)],
    );
    return out;
  }
  const date = kind === 'exception_resolution' ? r.issue_date : r.record_date;
  out.same_day_regularizations = await safeRows(
    `SELECT id, status, reason, dispute_type, reviewed_by, reviewed_at, reviewer_note
       FROM attendance_regularization WHERE employee_id = ? AND session_date = ? LIMIT 10`,
    [String(r.employee_id), String(date)],
  );
  if (kind === 'manual_override') {
    out.override_requests = await safeRows(
      `SELECT id, old_status, new_status, reason, approval_status, created_by, approved_by, rejected_by,
              rejection_reason, created_at, approved_at, rejected_at, applied_at, applied_by
         FROM attendance_manual_override
        WHERE applied_to_record_id = ? OR (employee_id = ? AND attendance_date = ?) LIMIT 10`,
      [String(r.id), String(r.employee_id), String(r.record_date)],
    );
  }
  return out;
}

export interface PersonInfo { employee_id: string; name: string | null; code: string | null }

/** Employee display names for the people matrix (one batched lookup). */
export async function resolveEmployees(ids: string[]): Promise<Map<string, PersonInfo>> {
  const out = new Map<string, PersonInfo>();
  for (const part of chunks(Array.from(new Set(ids)))) {
    const rows = await safeRows(
      `SELECT e.id AS employee_id, e.employee_code AS code, ${NAME_EXPR} AS name
         FROM employees e WHERE e.id IN (${marks(part.length)})`,
      part,
    );
    for (const r of rows) {
      out.set(String(r.employee_id), { employee_id: String(r.employee_id), name: r.name ?? null, code: r.code ?? null });
    }
  }
  return out;
}
