import type { RowDataPacket, ResultSetHeader } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { logger } from "../../lib/logger.js";
import { getCurrentDateIST } from "../../shared/istDate.js";
import { inboxService } from "../inbox/inbox.service.js";
import {
  addDays,
  approachingStage,
  expiryAction,
  isValidExtension,
  KEEP_OPEN_REVIEW_DAYS,
  lowFillStage,
  nextCycleNo,
  percentFilled,
  percentTimeElapsed,
  type DecisionRow,
  type RequisitionSnapshot,
} from "./job-requisition-deadline.rules.js";

/** Every existing HR role. Anyone holding one of these sees and can act on expiry decisions. */
export const HR_TEAM_ROLES = [
  "hr",
  "hr_admin",
  "hr_head",
  "ho_hr",
  "hr_manager",
  "recruitment_hr",
];

const ACTION_URL = "/recruitment/job-requisition";
const ENTITY_TYPE = "job_requisition";
const DECISION_INBOX_TYPE = "requisition_expiry_decision";

interface Audience {
  hr: boolean;
  branchHead: boolean;
  processManager: boolean;
}

interface OpenRequisition {
  id: string;
  code: string;
  designation: string;
  branchId: string | null;
  branchName: string;
  processId: string | null;
  processName: string | null;
  snapshot: RequisitionSnapshot;
}

// ── Recipients ──────────────────────────────────────────────────────────────

async function userIds(sql: string, params: unknown[]): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(sql, params as never[]);
  return rows.map((r) => String(r.user_id));
}

export function resolveHrTeam(): Promise<string[]> {
  return userIds(
    `SELECT DISTINCT ur.user_id AS user_id
       FROM user_roles ur
       LEFT JOIN employees e ON e.user_id = ur.user_id
      WHERE ur.active_status = 1
        AND ur.role_key IN (${HR_TEAM_ROLES.map(() => "?").join(",")})
        AND (e.id IS NULL OR e.active_status = 1)`,
    HR_TEAM_ROLES,
  );
}

async function resolveBranchHeads(branchName: string): Promise<string[]> {
  return userIds(
    `SELECT DISTINCT e.user_id AS user_id
       FROM employees e
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN user_roles ur ON ur.user_id = e.user_id AND ur.active_status = 1 AND ur.role_key = 'branch_head'
       LEFT JOIN branch_head_assignments bha ON bha.branch_head_id = e.id AND bha.is_active = 1
      WHERE e.active_status = 1 AND e.user_id IS NOT NULL
        AND ((ur.user_id IS NOT NULL AND (b.branch_name = ? OR b.branch_code = ?))
             OR bha.branch_name = ?)`,
    [branchName, branchName, branchName],
  );
}

async function resolveProcessManagers(
  processId: string | null,
): Promise<string[]> {
  if (!processId) return [];
  return userIds(
    `SELECT DISTINCT uas.user_id AS user_id
       FROM user_assignment_scope uas
      WHERE uas.role_key = 'process_manager' AND uas.active_status = 1 AND uas.process_id = ?`,
    [processId],
  );
}

async function resolveAudience(
  r: OpenRequisition,
  a: Audience,
): Promise<string[]> {
  const [hr, bh, pm] = await Promise.all([
    a.hr ? resolveHrTeam() : Promise.resolve([]),
    a.branchHead ? resolveBranchHeads(r.branchName) : Promise.resolve([]),
    a.processManager
      ? resolveProcessManagers(r.processId)
      : Promise.resolve([]),
  ]);
  return [...new Set([...hr, ...bh, ...pm])];
}

// ── Alert delivery (claim first, so concurrent schedulers cannot double-send) ─

async function sendAlert(
  r: OpenRequisition,
  alertType: string,
  stageKey: string,
  audience: Audience,
  content: {
    title: string;
    description: string;
    priority: string;
    inboxType?: string;
  },
): Promise<boolean> {
  const [claim] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO job_requisition_alert_log (requisition_id, alert_type, stage_key) VALUES (?, ?, ?)`,
    [r.id, alertType, stageKey],
  );
  if (claim.affectedRows === 0) return false;

  const users = await resolveAudience(r, audience);
  const results = await Promise.allSettled(
    users.map((userId) =>
      inboxService.createItem({
        user_id: userId,
        type: content.inboxType ?? `requisition_${alertType}`,
        title: content.title,
        description: content.description,
        entity_type: ENTITY_TYPE,
        entity_id: r.id,
        action_url: ACTION_URL,
        priority: content.priority,
      }),
    ),
  );
  results.forEach((res) => {
    if (res.status === "rejected")
      logger.warn(
        { err: res.reason, requisition: r.id, alertType },
        "requisition alert delivery failed",
      );
  });
  await db.execute(
    `UPDATE job_requisition_alert_log SET recipient_count = ? WHERE requisition_id = ? AND alert_type = ? AND stage_key = ?`,
    [users.length, r.id, alertType, stageKey],
  );
  return true;
}

// ── Data ────────────────────────────────────────────────────────────────────

async function loadOpenRequisitions(): Promise<OpenRequisition[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, requisition_code, designation_name, branch_id, branch_name, process_id, process_name,
            requested_headcount, fulfilled_headcount,
            DATE_FORMAT(requisition_validity, '%Y-%m-%d') AS validity,
            DATE_FORMAT(training_start_date, '%Y-%m-%d') AS batch_end,
            DATE_FORMAT(target_joining_date, '%Y-%m-%d') AS target_joining,
            DATE_FORMAT(COALESCE(demand_raised_date, created_at), '%Y-%m-%d') AS start_date
       FROM job_requisition
      WHERE approval_status = 'approved' AND active_status = 1 AND closed_at IS NULL
        AND fulfilled_headcount < requested_headcount`,
  );
  return rows.map((r) => ({
    id: String(r.id),
    code: String(r.requisition_code),
    designation: String(r.designation_name ?? ""),
    branchId: r.branch_id ? String(r.branch_id) : null,
    branchName: String(r.branch_name ?? ""),
    processId: r.process_id ? String(r.process_id) : null,
    processName: r.process_name ? String(r.process_name) : null,
    snapshot: {
      requested: Number(r.requested_headcount),
      fulfilled: Number(r.fulfilled_headcount),
      validity: r.validity ?? null,
      batchEnd: r.batch_end ?? null,
      targetJoining: r.target_joining ?? null,
      startDate: String(r.start_date),
    },
  }));
}

async function latestDecision(requisitionId: string): Promise<DecisionRow> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT status, cycle_no, DATE_FORMAT(review_after, '%Y-%m-%d') AS review_after
       FROM job_requisition_expiry_decision WHERE requisition_id = ? ORDER BY cycle_no DESC LIMIT 1`,
    [requisitionId],
  );
  const r = rows[0];
  return r
    ? {
        status: r.status,
        cycleNo: Number(r.cycle_no),
        reviewAfter: r.review_after ?? null,
      }
    : null;
}

const label = (r: OpenRequisition) =>
  `${r.code} · ${r.designation} · ${r.branchName}${r.processName ? ` · ${r.processName}` : ""}`;
const fillText = (r: OpenRequisition) =>
  `${r.snapshot.fulfilled} of ${r.snapshot.requested} filled`;

// ── Sweep ───────────────────────────────────────────────────────────────────

export interface SweepSummary {
  autoClosed: number;
  decisionsRaised: number;
  alertsSent: number;
}

async function handleExpiry(
  r: OpenRequisition,
  today: string,
  summary: SweepSummary,
): Promise<boolean> {
  const latest = await latestDecision(r.id);
  const action = expiryAction(r.snapshot, today, latest);
  if (action === "none") return false;

  if (action === "auto_close") {
    const [res] = await db.execute<ResultSetHeader>(
      `UPDATE job_requisition
          SET approval_status = 'closed', closed_at = NOW(),
              closed_reason = ?, updated_at = NOW()
        WHERE id = ? AND approval_status = 'approved' AND closed_at IS NULL AND fulfilled_headcount = 0`,
      [
        `Auto-closed: validity ${r.snapshot.validity} passed with 0 of ${r.snapshot.requested} filled`,
        r.id,
      ],
    );
    if (res.affectedRows === 0) return true;
    summary.autoClosed += 1;
    const sent = await sendAlert(
      r,
      "non_delivery",
      `closed:${r.snapshot.validity}`,
      { hr: true, branchHead: true, processManager: true },
      {
        title: `Requisition auto-closed with no hires: ${r.code}`,
        description: `${label(r)} passed its validity (${r.snapshot.validity}) with 0 of ${r.snapshot.requested} filled and was closed automatically.`,
        priority: "urgent",
      },
    );
    if (sent) summary.alertsSent += 1;
    return true;
  }

  const cycleNo = nextCycleNo(latest);
  const [ins] = await db.execute<ResultSetHeader>(
    `INSERT IGNORE INTO job_requisition_expiry_decision
       (requisition_id, cycle_no, validity_at_detection, requested_headcount, fulfilled_at_detection)
     VALUES (?, ?, ?, ?, ?)`,
    [
      r.id,
      cycleNo,
      r.snapshot.validity,
      r.snapshot.requested,
      r.snapshot.fulfilled,
    ],
  );
  if (ins.affectedRows === 0) return true;
  summary.decisionsRaised += 1;

  const missing = r.snapshot.requested - r.snapshot.fulfilled;
  const decisionSent = await sendAlert(
    r,
    "expiry_decision",
    `x${cycleNo}`,
    { hr: true, branchHead: false, processManager: false },
    {
      title: `Decision needed: ${r.code} passed its deadline`,
      description: `${label(r)} — validity ${r.snapshot.validity} has passed with ${fillText(r)} (${missing} short). Close it, extend the validity, or keep it open.`,
      priority: "urgent",
      inboxType: DECISION_INBOX_TYPE,
    },
  );
  const nonDeliverySent = await sendAlert(
    r,
    "non_delivery",
    `expired:${r.snapshot.validity}`,
    { hr: true, branchHead: true, processManager: true },
    {
      title: `Requisition missed its deadline: ${r.code}`,
      description: `${label(r)} passed its validity (${r.snapshot.validity}) with ${fillText(r)}. HR is deciding whether to close, extend or keep it open.`,
      priority: "high",
    },
  );
  summary.alertsSent += Number(decisionSent) + Number(nonDeliverySent);
  return true;
}

async function handleProgressAlerts(
  r: OpenRequisition,
  today: string,
  summary: SweepSummary,
): Promise<void> {
  const s = r.snapshot;
  const missing = s.requested - s.fulfilled;

  const validityDays = approachingStage(s.validity, today);
  if (validityDays !== null) {
    const sent = await sendAlert(
      r,
      "deadline_approaching",
      `d${validityDays}:${s.validity}`,
      {
        hr: true,
        branchHead: validityDays === 1,
        processManager: validityDays === 1,
      },
      {
        title: `Deadline in ${validityDays} day${validityDays === 1 ? "" : "s"}: ${r.code}`,
        description: `${label(r)} — validity ${s.validity}, ${fillText(r)}, ${missing} still needed.`,
        priority: validityDays === 1 ? "urgent" : "high",
      },
    );
    if (sent) summary.alertsSent += 1;
  }

  const batchDays = approachingStage(s.batchEnd, today);
  if (batchDays !== null) {
    const sent = await sendAlert(
      r,
      "batch_closing",
      `b${batchDays}:${s.batchEnd}`,
      {
        hr: true,
        branchHead: batchDays === 1,
        processManager: batchDays === 1,
      },
      {
        title: `Batch closes in ${batchDays} day${batchDays === 1 ? "" : "s"}: ${r.code}`,
        description: `${label(r)} — batch starts ${s.batchEnd}, ${fillText(r)} (${Math.round(percentFilled(s))}%), ${missing} still needed.`,
        priority: batchDays === 1 ? "urgent" : "high",
      },
    );
    if (sent) summary.alertsSent += 1;
  }

  const stage = lowFillStage(s, today);
  if (stage !== null) {
    const elapsed = Math.round(percentTimeElapsed(s, today) ?? 0);
    const escalate = stage >= 75;
    const sent = await sendAlert(
      r,
      "low_fill",
      `p${stage}:${s.batchEnd ?? s.validity ?? s.targetJoining}`,
      { hr: true, branchHead: escalate, processManager: escalate },
      {
        title: `Hiring behind schedule: ${r.code}`,
        description: `${label(r)} — ${elapsed}% of the time is used but only ${Math.round(percentFilled(s))}% is filled (${fillText(r)}, ${missing} short).`,
        priority: escalate ? "urgent" : "high",
      },
    );
    if (sent) summary.alertsSent += 1;
  }
}

/** Idempotent: alerts are claimed in job_requisition_alert_log and decisions keyed by cycle. */
export async function runRequisitionDeadlineSweep(
  today: string = getCurrentDateIST(),
): Promise<SweepSummary> {
  const summary: SweepSummary = {
    autoClosed: 0,
    decisionsRaised: 0,
    alertsSent: 0,
  };
  const open = await loadOpenRequisitions();
  for (const r of open) {
    try {
      const expired = await handleExpiry(r, today, summary);
      if (!expired) await handleProgressAlerts(r, today, summary);
    } catch (err) {
      logger.error(
        { err, requisition: r.id },
        "requisition deadline sweep failed for one requisition",
      );
    }
  }
  logger.info(summary, "requisition deadline sweep complete");
  return summary;
}

// ── HR decisions ────────────────────────────────────────────────────────────

export async function listPendingExpiryDecisions() {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT d.id, d.requisition_id, d.cycle_no, DATE_FORMAT(d.validity_at_detection, '%Y-%m-%d') AS validity,
            d.requested_headcount, jr.fulfilled_headcount, d.created_at,
            jr.requisition_code, jr.designation_name, jr.branch_name, jr.process_name,
            DATE_FORMAT(jr.target_joining_date, '%Y-%m-%d') AS target_joining_date
       FROM job_requisition_expiry_decision d
       JOIN job_requisition jr ON jr.id = d.requisition_id
      WHERE d.status = 'pending' AND jr.approval_status = 'approved' AND jr.active_status = 1
      ORDER BY d.validity_at_detection ASC`,
  );
  return rows;
}

export type ExpiryDecisionInput =
  | { action: "close"; reason: string }
  | { action: "extend"; reason: string; newValidity: string }
  | { action: "keep_open"; reason: string };

export class ExpiryDecisionError extends Error {
  constructor(
    message: string,
    readonly statusCode: number,
  ) {
    super(message);
  }
}

export async function decideExpiry(
  decisionId: string,
  actor: { id: string; name: string | null },
  input: ExpiryDecisionInput,
  today: string = getCurrentDateIST(),
): Promise<void> {
  const reason = input.reason?.trim();
  if (!reason) throw new ExpiryDecisionError("A reason is required", 400);
  if (
    input.action === "extend" &&
    !isValidExtension(input.newValidity, today)
  ) {
    throw new ExpiryDecisionError(
      "New validity must be a future date within 90 days",
      400,
    );
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT requisition_id FROM job_requisition_expiry_decision WHERE id = ? AND status = 'pending' LIMIT 1`,
    [decisionId],
  );
  const requisitionId = rows[0]?.requisition_id
    ? String(rows[0].requisition_id)
    : null;
  if (!requisitionId)
    throw new ExpiryDecisionError(
      "This decision was already made by someone else",
      409,
    );

  const status =
    input.action === "close"
      ? "closed"
      : input.action === "extend"
        ? "extended"
        : "kept_open";
  const newValidity = input.action === "extend" ? input.newValidity : null;
  const reviewAfter =
    input.action === "keep_open" ? addDays(today, KEEP_OPEN_REVIEW_DAYS) : null;

  const [claim] = await db.execute<ResultSetHeader>(
    `UPDATE job_requisition_expiry_decision
        SET status = ?, decided_by = ?, decided_by_name = ?, decided_at = NOW(), reason = ?, new_validity = ?, review_after = ?
      WHERE id = ? AND status = 'pending'`,
    [
      status,
      actor.id,
      actor.name,
      reason,
      newValidity,
      reviewAfter,
      decisionId,
    ],
  );
  if (claim.affectedRows === 0)
    throw new ExpiryDecisionError(
      "This decision was already made by someone else",
      409,
    );

  if (input.action === "close") {
    await db.execute(
      `UPDATE job_requisition
          SET approval_status = 'closed', closed_at = NOW(), closed_reason = ?, updated_at = NOW()
        WHERE id = ? AND approval_status = 'approved' AND closed_at IS NULL`,
      [`Closed by HR after validity expiry: ${reason}`, requisitionId],
    );
  } else if (input.action === "extend") {
    await db.execute(
      `UPDATE job_requisition SET requisition_validity = ?, updated_at = NOW() WHERE id = ?`,
      [input.newValidity, requisitionId],
    );
  }

  await inboxService.resolveItems({
    entity_type: ENTITY_TYPE,
    entity_id: requisitionId,
    types: [DECISION_INBOX_TYPE],
  });
}
