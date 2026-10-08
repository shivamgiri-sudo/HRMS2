/**
 * SLA escalation sweep: a pending request whose SLA state is overdue (raised > 48h ago) or urgent
 * (shift within 24h) is escalated ONCE to the next scope level — the branch heads of the
 * employee's branch, falling back to WFM in scope + HR of the branch when the branch has none.
 *
 * Exactly-once: the escalation is claimed with INSERT IGNORE into roster_request_escalation
 * (UNIQUE kind, source_id) BEFORE anyone is notified, and only the run whose insert affected one
 * row notifies. Overlapping runs (two processes, or a slow previous tick) cannot double-notify.
 *
 * The escalation work item uses the same entity_type as the approver items
 * (roster_request_pending:<kind>), so the decide service closes it with the others once the
 * request is decided; its type (ROSTER_REQUEST_ESCALATED) tells the two apart.
 */
import type { RowDataPacket } from "mysql2";
import { db as defaultDb } from "../../db/mysql.js";
import { wfmRecipientUserIds } from "../wfm/team-roster-audit.js";
import { computeSla } from "./roster-requests.sla.js";
import { hubActionUrl, pendingEntityType } from "./roster-requests.notify.js";
import type { RequestKind, SlaState } from "./roster-requests.types.js";

type Exec = { execute: (sql: string, params?: unknown[]) => Promise<any> };

export const ROSTER_REQUEST_ESCALATED_TYPE = "ROSTER_REQUEST_ESCALATED";
const ESCALATE_STATES: readonly SlaState[] = ["overdue", "urgent"];
const PER_KIND_LIMIT = 500;
const MAX_RECIPIENTS = 50;
/**
 * Requests whose shift date is further in the past than this are not escalated: the shift has been
 * worked, and paging a branch head about it is noise (the hub list still shows them as overdue).
 */
const STALE_SHIFT_DAYS = 7;

export interface EscalationCandidate {
  kind: RequestKind;
  sourceId: string;
  employeeId: string;
  branchId: string | null;
  processId: string | null;
  raisedAt: string;
  shiftDate: string;
  escalated: boolean;
}

export interface EscalationPick extends EscalationCandidate {
  slaState: SlaState;
}

/** Pure core: the candidates that must be escalated now. */
export function selectEscalations(rows: EscalationCandidate[], now: Date = new Date()): EscalationPick[] {
  const seen = new Set<string>();
  const out: EscalationPick[] = [];
  for (const r of rows) {
    if (r.escalated) continue;
    const key = `${r.kind}:${r.sourceId}`;
    if (seen.has(key)) continue;
    const { state } = computeSla(r.raisedAt, r.shiftDate, now);
    if (!ESCALATE_STATES.includes(state)) continue;
    seen.add(key);
    out.push({ ...r, slaState: state });
  }
  return out;
}

// Pre-filter in SQL to the rows that can be overdue or urgent; selectEscalations decides exactly.
const DUE = (raised: string, date: string) =>
  `(${raised} < NOW() - INTERVAL 48 HOUR OR ${date} <= CURDATE() + INTERVAL 1 DAY)
   AND ${date} >= CURDATE() - INTERVAL ${STALE_SHIFT_DAYS} DAY`;

/**
 * When a dispute was raised: disputed_at (migration 2074, stamped by the dispute-raise handler),
 * falling back to updated_at for rows raised before it, and on a database the migration has not
 * reached yet (the column check keeps the whole sweep from failing on an unknown column).
 * Week-off rejections use employee_ack_at, the employee's response time, which the reject handler
 * stamps; updated_at is the fallback for older rows.
 */
const DISPUTE_RAISED_AT = "COALESCE(rda.disputed_at, rda.updated_at)";
const DISPUTE_RAISED_AT_LEGACY = "rda.updated_at";

const loaders = (disputeRaisedAt: string): Record<RequestKind, string> => ({
  swap: `SELECT 'swap' AS kind, s.id AS source_id, s.requester_emp_id AS employee_id, e.branch_id, e.process_id,
                s.created_at AS raised_at, DATE_FORMAT(s.swap_date, '%Y-%m-%d') AS shift_date
           FROM wfm_roster_swap_request s
           JOIN employees e ON e.id = s.requester_emp_id
           LEFT JOIN roster_request_escalation x ON x.kind = 'swap' AND x.source_id = s.id
          WHERE s.status = 'pending' AND x.id IS NULL AND ${DUE("s.created_at", "s.swap_date")}
          LIMIT ${PER_KIND_LIMIT}`,
  weekoff_rejection: `SELECT 'weekoff_rejection' AS kind, wra.id AS source_id, wra.employee_id, e.branch_id, e.process_id,
                COALESCE(wra.employee_ack_at, wra.updated_at) AS raised_at, DATE_FORMAT(wra.roster_date, '%Y-%m-%d') AS shift_date
           FROM wfm_roster_assignment wra
           JOIN employees e ON e.id = wra.employee_id
           LEFT JOIN roster_request_escalation x ON x.kind = 'weekoff_rejection' AND x.source_id = wra.id
          WHERE wra.final_roster_status = 'pending_manager_action' AND x.id IS NULL
            AND ${DUE("COALESCE(wra.employee_ack_at, wra.updated_at)", "wra.roster_date")}
          LIMIT ${PER_KIND_LIMIT}`,
  dispute: `SELECT 'dispute' AS kind, rda.id AS source_id, rda.employee_id, e.branch_id, e.process_id,
                ${disputeRaisedAt} AS raised_at, DATE_FORMAT(rda.roster_date, '%Y-%m-%d') AS shift_date
           FROM roster_daily_assignment rda
           JOIN employees e ON e.id = rda.employee_id
           LEFT JOIN roster_request_escalation x ON x.kind = 'dispute' AND x.source_id = rda.id
          WHERE rda.acknowledgement_status = 'disputed' AND rda.dispute_resolved_at IS NULL AND x.id IS NULL
            AND ${DUE(disputeRaisedAt, "rda.roster_date")}
          LIMIT ${PER_KIND_LIMIT}`,
  conflict: `SELECT 'conflict' AS kind, c.id AS source_id, c.employee_id, e.branch_id, e.process_id,
                c.detected_at AS raised_at, DATE_FORMAT(c.conflict_date, '%Y-%m-%d') AS shift_date
           FROM wfm_roster_conflict_log c
           JOIN employees e ON e.id = c.employee_id
           LEFT JOIN roster_request_escalation x ON x.kind = 'conflict' AND x.source_id = c.id
          WHERE c.resolved = 0 AND x.id IS NULL AND ${DUE("c.detected_at", "c.conflict_date")}
          LIMIT ${PER_KIND_LIMIT}`,
});

async function hasDisputedAtColumn(exec: Exec): Promise<boolean> {
  const [rows] = await exec.execute(
    `SELECT COUNT(*) AS n FROM information_schema.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'roster_daily_assignment' AND COLUMN_NAME = 'disputed_at'`,
  );
  return Number((rows as RowDataPacket[])?.[0]?.n ?? 0) > 0;
}

const iso = (v: unknown) => (v instanceof Date ? v.toISOString() : String(v ?? ""));

async function loadCandidates(exec: Exec): Promise<EscalationCandidate[]> {
  const out: EscalationCandidate[] = [];
  const disputeRaisedAt = (await hasDisputedAtColumn(exec)) ? DISPUTE_RAISED_AT : DISPUTE_RAISED_AT_LEGACY;
  for (const sql of Object.values(loaders(disputeRaisedAt))) {
    const [rows] = await exec.execute(sql);
    for (const r of rows as RowDataPacket[]) {
      out.push({
        kind: r.kind as RequestKind,
        sourceId: String(r.source_id),
        employeeId: String(r.employee_id),
        branchId: r.branch_id ? String(r.branch_id) : null,
        processId: r.process_id ? String(r.process_id) : null,
        raisedAt: iso(r.raised_at),
        shiftDate: String(r.shift_date),
        escalated: false,
      });
    }
  }
  return out;
}

async function usersWithBranchRole(role: "branch_head" | "hr", branchId: string, exec: Exec): Promise<string[]> {
  const [rows] = await exec.execute(
    `SELECT DISTINCT ur.user_id FROM user_roles ur
       JOIN user_assignment_scope uas ON uas.user_id = ur.user_id AND uas.active_status = 1
      WHERE ur.active_status = 1 AND ur.role_key = '${role}' AND uas.branch_id = ?
      LIMIT ${MAX_RECIPIENTS}`,
    [branchId],
  );
  return (rows as RowDataPacket[]).map((r) => String(r.user_id));
}

/** Next scope level above the request's approvers. */
export async function escalationRecipientUserIds(branchId: string | null, processId: string | null, exec: Exec = defaultDb as any): Promise<string[]> {
  if (branchId) {
    const heads = await usersWithBranchRole("branch_head", branchId, exec);
    if (heads.length) return [...new Set(heads)];
  }
  const [wfm, hr] = await Promise.all([
    wfmRecipientUserIds(branchId ? [branchId] : [], processId ? [processId] : [], exec),
    branchId ? usersWithBranchRole("hr", branchId, exec) : Promise.resolve([] as string[]),
  ]);
  return [...new Set([...wfm, ...hr])];
}

const KIND_LABEL: Record<RequestKind, string> = {
  swap: "Shift swap",
  weekoff_rejection: "Week-off rejection",
  dispute: "Roster dispute",
  conflict: "Roster conflict",
};

async function escalateOne(p: EscalationPick, exec: Exec): Promise<boolean> {
  const [claim] = await exec.execute(
    "INSERT IGNORE INTO roster_request_escalation (kind, source_id) VALUES (?, ?)",
    [p.kind, p.sourceId],
  );
  if (Number((claim as any)?.affectedRows ?? 0) !== 1) return false;
  try {
    const userIds = await escalationRecipientUserIds(p.branchId, p.processId, exec);
    if (!userIds.length) {
      console.warn("[roster-requests] escalation has no recipients:", { kind: p.kind, id: p.sourceId, branchId: p.branchId });
      return true;
    }
    const why = p.slaState === "urgent" ? "the shift is within 24 hours" : "it has waited more than 48 hours";
    for (const userId of userIds) {
      await exec.execute(
        `INSERT INTO work_inbox_item (id, user_id, type, title, description, entity_type, entity_id, action_url, priority)
         VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          userId,
          ROSTER_REQUEST_ESCALATED_TYPE,
          `${KIND_LABEL[p.kind]} escalated`.slice(0, 255),
          `A ${KIND_LABEL[p.kind].toLowerCase()} for ${p.shiftDate} is still undecided and ${why}.`.slice(0, 1000),
          pendingEntityType(p.kind),
          p.sourceId.slice(0, 36),
          hubActionUrl(p.kind, p.sourceId),
          "high",
        ],
      );
    }
  } catch (err) {
    // The claim stays: a half-delivered escalation is not retried into duplicates.
    console.error("[roster-requests] escalation notify failed:", { kind: p.kind, id: p.sourceId, err: (err as Error)?.message });
  }
  return true;
}

export async function runEscalationSweep(exec: Exec = defaultDb as any, now: Date = new Date()): Promise<{ candidates: number; escalated: number }> {
  const picks = selectEscalations(await loadCandidates(exec), now);
  let escalated = 0;
  for (const p of picks) {
    try {
      if (await escalateOne(p, exec)) escalated++;
    } catch (err) {
      console.error("[roster-requests] escalation claim failed:", { kind: p.kind, id: p.sourceId, err: (err as Error)?.message });
    }
  }
  return { candidates: picks.length, escalated };
}
