/**
 * Feedback intake, retrieval and comments.
 *
 * THE INTAKE PATH, IN ORDER, AND WHY THAT ORDER
 *   1. sanitise      neutralise injection patterns before anything is stored
 *   2. redact        classify PII and produce body_redacted alongside body_raw
 *   3. persist       one transaction: the row, its scope, its SLA deadline, its audit event
 *   4. scan          deterministic risk classification, synchronous
 *   5. gate          a deny verdict transitions to scan_blocked and opens no approvals
 *
 * The scan is SYNCHRONOUS and its verdict is returned to the submitter. A payroll request
 * gets an immediate, explained "this needs a human" instead of disappearing into a queue and
 * being rejected days later. That is the difference between a control users understand and
 * one they learn to route around.
 *
 * The scan cannot fail open: if it throws, the item stays in `scanning` with the error
 * recorded, and nothing downstream treats an unscanned item as safe.
 */
import type { PoolConnection } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";
import { prepareFeedbackBody } from "./uat-pii.service.js";
import { computeDueAt, defaultPriorityFor } from "./uat-sla.service.js";
import { persistScan, runStaticScan } from "./uat-static-scan.service.js";
import { requestApproval, requestCapabilityApprovals } from "./uat-approval.service.js";
import {
  loadNotifyContext,
  notifyApprovalRequested,
  notifyFeedbackAssigned,
  notifyFeedbackBlocked,
} from "./uat-notification.service.js";
import { recordEvent, transition } from "./uat-state-machine.js";
import type {
  CreateFeedbackInput,
  Priority,
  StaticScanResult,
  UatStatus,
} from "./uat-pipeline.types.js";

/** Roles that may see feedback beyond their own submissions. */
export const UAT_TRIAGE_ROLES = ["admin", "super_admin", "hr", "it", "it_admin"];

export interface FeedbackRow extends RowDataPacket {
  id: string;
  feedback_code: string;
  submitted_by_employee_id: string;
  submitted_by_user_id: string | null;
  kind: string;
  change_type: string | null;
  severity: string;
  priority: Priority;
  title: string;
  body_raw: string;
  body_redacted: string | null;
  page_route: string | null;
  page_code: string | null;
  module_hint: string | null;
  status: UatStatus;
  status_reason: string | null;
  risk_tier: string | null;
  capability_class: string | null;
  branch_id: string | null;
  process_id: string | null;
  assigned_to: string | null;
  duplicate_of_id: string | null;
  affected_user_count: number;
  due_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

interface EmployeeScopeRow extends RowDataPacket {
  branch_id: string | null;
  process_id: string | null;
}

/**
 * Next feedback code. Retries on the unique-key collision rather than pre-reserving, which
 * keeps the common path to a single insert. Two concurrent submissions racing for the same
 * number is rare and cheap to retry; a separate sequence table would be a second thing to
 * keep in step for no benefit at this volume.
 */
/** The connection type db.getConnection() actually hands back: PoolConnection augmented with
 *  an execute() that accepts the unknown[] param arrays services build dynamically. */
type UatConnection = Awaited<ReturnType<typeof db.getConnection>>;

async function insertWithCode(
  conn: UatConnection,
  build: (code: string) => { sql: string; params: unknown[] }
): Promise<{ id: string; code: string }> {
  for (let attempt = 0; attempt < 5; attempt++) {
    const [maxRows] = await conn.execute<RowDataPacket[]>(
      `SELECT COALESCE(MAX(CAST(SUBSTRING(feedback_code, 5) AS UNSIGNED)), 0) AS n
         FROM uat_feedback WHERE feedback_code LIKE 'UAT-%'`
    );
    const next = Number((maxRows[0] as { n: number }).n) + 1 + attempt;
    const code = `UAT-${String(next).padStart(6, "0")}`;
    const { sql, params } = build(code);
    try {
      await conn.execute(sql, params);
      const [idRows] = await conn.execute<RowDataPacket[]>(
        `SELECT id FROM uat_feedback WHERE feedback_code = ?`,
        [code]
      );
      return { id: String((idRows[0] as { id: string }).id), code };
    } catch (err) {
      const code2 = (err as { code?: string }).code;
      if (code2 !== "ER_DUP_ENTRY") throw err;
      // else: another submission took this number; loop and try the next one
    }
  }
  throw new Error("Could not allocate a UAT feedback code after 5 attempts");
}

export interface CreateResult {
  id: string;
  feedbackCode: string;
  status: UatStatus;
  scan: StaticScanResult | null;
  blockedReason: string | null;
}

export async function createFeedback(
  input: CreateFeedbackInput,
  actor: { userId: string; employeeId: string }
): Promise<CreateResult> {
  const body = prepareFeedbackBody(input.body);
  const title = (input.title ?? "").slice(0, 300).trim();
  if (!title) {
    const e = new Error("A title is required") as Error & { statusCode?: number };
    e.statusCode = 400;
    throw e;
  }
  const priority: Priority = input.priority ?? defaultPriorityFor(input.severity);
  const dueAt = await computeDueAt(input.severity, priority);

  const conn = await db.getConnection();
  let id: string;
  let feedbackCode: string;
  try {
    await conn.beginTransaction();

    // Denormalise the submitter's scope onto the row so list queries filter without a join.
    // The employee record remains the source of truth; this is a copy for query shape only.
    const [empRows] = await conn.execute<EmployeeScopeRow[]>(
      `SELECT branch_id, process_id FROM employees WHERE id = ?`,
      [actor.employeeId]
    );
    const branchId = empRows[0]?.branch_id ?? null;
    const processId = empRows[0]?.process_id ?? null;

    const created = await insertWithCode(conn, (code) => ({
      sql: `INSERT INTO uat_feedback
              (feedback_code, submitted_by_employee_id, submitted_by_user_id,
               kind, severity, priority, title, body_raw, body_redacted, pii_classification_json,
               expected_behaviour, actual_behaviour, steps_to_reproduce,
               page_route, page_code, module_hint, api_path_hint,
               app_version, frontend_sha, backend_sha, environment, browser, device,
               correlation_id, occurred_at, branch_id, process_id, due_at, status)
            VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?, 'submitted')`,
      params: [
        code,
        actor.employeeId,
        actor.userId,
        input.kind,
        input.severity,
        priority,
        title,
        body.raw,
        body.redacted,
        JSON.stringify(body.classification),
        input.expectedBehaviour ?? null,
        input.actualBehaviour ?? null,
        input.stepsToReproduce ?? null,
        input.pageRoute ?? null,
        input.pageCode ?? null,
        input.moduleHint ?? null,
        input.apiPathHint ?? null,
        input.appVersion ?? null,
        input.frontendSha ?? null,
        input.backendSha ?? null,
        input.environment ?? null,
        input.browser ?? null,
        input.device ?? null,
        input.correlationId ?? null,
        input.occurredAt ? new Date(input.occurredAt) : null,
        branchId,
        processId,
        dueAt,
      ],
    }));
    id = created.id;
    feedbackCode = created.code;

    await recordEvent(
      id,
      "submitted",
      {
        actorUserId: actor.userId,
        actorKind: "user",
        message: "feedback submitted",
        // PII-free by construction: counts and flags only, never the prose itself.
        detail: {
          kind: input.kind,
          severity: input.severity,
          priority,
          piiRedactions: body.classification.redactionCount,
          injectionPatternsNeutralised: body.sanitize.neutralised,
          truncated: body.sanitize.truncated,
        },
      },
      conn
    );

    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw err;
  } finally {
    conn.release();
  }

  // ── Scan. Synchronous, and it cannot fail open. ──────────────────────────────
  await transition(id, "scanning", { actorKind: "system" });
  let scan: StaticScanResult;
  try {
    scan = runStaticScan({
      feedbackId: id,
      title,
      text: body.redacted, // never body.raw
      pageRoute: input.pageRoute ?? null,
      pageCode: input.pageCode ?? null,
      moduleHint: input.moduleHint ?? null,
      apiPathHint: input.apiPathHint ?? null,
    });
  } catch (err) {
    // Leave the item in `scanning` deliberately. An unscanned item must not read as safe,
    // and the console shows anything stuck in a non-terminal state as an error.
    await recordEvent(id, "error", {
      actorKind: "system",
      message: `static scan failed: ${(err as Error).message}`,
    });
    throw err;
  }

  await persistScan(id, scan);

  if (scan.effectiveRisk === "deny") {
    await transition(id, "scan_blocked", {
      actorKind: "system",
      reason: scan.blockedReason,
      detail: { riskTier: scan.riskTier, capabilityClass: scan.capabilityClass },
    });
    const nctx = await loadNotifyContext(id);
    if (nctx) await notifyFeedbackBlocked({ ...nctx, reason: scan.blockedReason });
    return { id, feedbackCode, status: "scan_blocked", scan, blockedReason: scan.blockedReason };
  }

  await transition(id, "scan_done", {
    actorKind: "system",
    detail: { riskTier: scan.riskTier, capabilityClass: scan.capabilityClass },
  });

  // A review-tier item opens its gates now, so the console shows what it is waiting on
  // rather than discovering it at dispatch time.
  if (scan.effectiveRisk === "review") {
    await requestApproval(id, "review_tier", "UAT_APPROVER");
    if (scan.requiredApproverRoles.length > 0) {
      await requestCapabilityApprovals(id, scan.requiredApproverRoles);
    }
    const nctx = await loadNotifyContext(id);
    if (nctx) {
      await notifyApprovalRequested({
        ...nctx,
        requiredRole: scan.requiredApproverRoles[0] ?? "UAT_APPROVER",
      });
    }
  }

  return { id, feedbackCode, status: "scan_done", scan, blockedReason: null };
}

// ── Reads ─────────────────────────────────────────────────────────────────────

export interface ListFilters {
  status?: string;
  severity?: string;
  riskTier?: string;
  assignedTo?: string;
  mineOnly?: boolean;
  limit?: number;
  offset?: number;
}

/**
 * Scoped list.
 *
 * Reuses buildScopeWhereClause so UAT row scope means exactly what it means everywhere else
 * in this codebase — a second interpretation of "which branches can this user see" is how
 * two systems end up disagreeing about it. A submitter always sees their own items; beyond
 * that, the shared helper decides, and it fails closed (1=0) for a user with no scope.
 */
export async function listFeedback(
  userId: string,
  employeeId: string,
  filters: ListFilters = {}
): Promise<{ rows: FeedbackRow[]; total: number }> {
  const scoped = await buildScopeWhereClause(userId, UAT_TRIAGE_ROLES, {
    branchId: "f.branch_id",
    processId: "f.process_id",
  });

  const where: string[] = [];
  const params: unknown[] = [];

  if (filters.mineOnly) {
    where.push("f.submitted_by_employee_id = ?");
    params.push(employeeId);
  } else {
    where.push(`(f.submitted_by_employee_id = ? OR (${scoped.sql}))`);
    params.push(employeeId, ...scoped.params);
  }

  if (filters.status) {
    where.push("f.status = ?");
    params.push(filters.status);
  }
  if (filters.severity) {
    where.push("f.severity = ?");
    params.push(filters.severity);
  }
  if (filters.riskTier) {
    where.push("f.risk_tier = ?");
    params.push(filters.riskTier);
  }
  if (filters.assignedTo) {
    where.push("f.assigned_to = ?");
    params.push(filters.assignedTo);
  }

  const whereSql = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const limit = Math.min(Math.max(Number(filters.limit ?? 50), 1), 200);
  const offset = Math.max(Number(filters.offset ?? 0), 0);

  const [countRows] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS n FROM uat_feedback f ${whereSql}`,
    params
  );
  const [rows] = await db.execute<FeedbackRow[]>(
    `SELECT f.* FROM uat_feedback f ${whereSql}
      ORDER BY FIELD(f.priority,'p0','p1','p2','p3'), f.created_at DESC
      LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  return { rows, total: Number((countRows[0] as { n: number }).n) };
}

/** A single item, or null when it exists but is outside the caller's scope. */
export async function getFeedback(
  id: string,
  userId: string,
  employeeId: string
): Promise<FeedbackRow | null> {
  const scoped = await buildScopeWhereClause(userId, UAT_TRIAGE_ROLES, {
    branchId: "f.branch_id",
    processId: "f.process_id",
  });
  const [rows] = await db.execute<FeedbackRow[]>(
    `SELECT f.* FROM uat_feedback f
      WHERE f.id = ? AND (f.submitted_by_employee_id = ? OR (${scoped.sql}))`,
    [id, employeeId, ...scoped.params]
  );
  return rows[0] ?? null;
}

export async function getTimeline(feedbackId: string): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, event_type, from_status, to_status, actor_user_id, actor_kind,
            detail_json, message, created_at
       FROM uat_feedback_event WHERE feedback_id = ? ORDER BY id`,
    [feedbackId]
  );
  return rows;
}

export async function getLatestScan(feedbackId: string): Promise<RowDataPacket | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM uat_static_scan WHERE feedback_id = ? ORDER BY scanned_at DESC LIMIT 1`,
    [feedbackId]
  );
  return rows[0] ?? null;
}

// ── Comments ──────────────────────────────────────────────────────────────────

export async function addComment(
  feedbackId: string,
  body: string,
  actor: { userId: string },
  visibility: "internal" | "reporter_visible" = "internal"
): Promise<void> {
  // Comments are prose from a human and get the same treatment as the feedback body.
  const prepared = prepareFeedbackBody(body);
  await db.execute(
    `INSERT INTO uat_feedback_comment (feedback_id, author_user_id, visibility, body)
     VALUES (?,?,?,?)`,
    [feedbackId, actor.userId, visibility, prepared.raw]
  );
  await recordEvent(feedbackId, "comment", {
    actorUserId: actor.userId,
    actorKind: "user",
    message: `comment added (${visibility})`,
  });
}

export async function listComments(
  feedbackId: string,
  includeInternal: boolean
): Promise<RowDataPacket[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, parent_comment_id, author_user_id, actor_kind, visibility, body, created_at
       FROM uat_feedback_comment
      WHERE feedback_id = ? ${includeInternal ? "" : "AND visibility = 'reporter_visible'"}
      ORDER BY created_at`,
    [feedbackId]
  );
  return rows;
}

// ── Triage mutations ──────────────────────────────────────────────────────────

export async function assignFeedback(
  feedbackId: string,
  assigneeEmployeeId: string | null,
  actorUserId: string
): Promise<void> {
  await db.execute(`UPDATE uat_feedback SET assigned_to = ? WHERE id = ?`, [
    assigneeEmployeeId,
    feedbackId,
  ]);
  await recordEvent(feedbackId, "assignment", {
    actorUserId,
    actorKind: "user",
    message: assigneeEmployeeId ? "assigned" : "unassigned",
    detail: { assigneeEmployeeId },
  });
  if (assigneeEmployeeId) {
    const nctx = await loadNotifyContext(feedbackId);
    if (nctx) await notifyFeedbackAssigned({ ...nctx, assigneeEmployeeId });
  }
}

/**
 * Mark one item as a duplicate of another. Increments the canonical item's affected-user
 * count so "40 people hit this" survives as a number after the duplicates are closed.
 */
export async function markDuplicate(
  feedbackId: string,
  canonicalId: string,
  actorUserId: string
): Promise<void> {
  if (feedbackId === canonicalId) {
    const e = new Error("An item cannot be a duplicate of itself") as Error & { statusCode?: number };
    e.statusCode = 400;
    throw e;
  }
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();
    await conn.execute(
      `UPDATE uat_feedback SET duplicate_of_id = ?, canonical_issue_id = ? WHERE id = ?`,
      [canonicalId, canonicalId, feedbackId]
    );
    await conn.execute(
      `UPDATE uat_feedback SET affected_user_count = affected_user_count + 1 WHERE id = ?`,
      [canonicalId]
    );
    await recordEvent(
      feedbackId,
      "duplicate",
      { actorUserId, actorKind: "user", message: `marked duplicate of ${canonicalId}` },
      conn
    );
    await conn.commit();
  } catch (err) {
    try {
      await conn.rollback();
    } catch {
      /* surface the original */
    }
    throw err;
  } finally {
    conn.release();
  }
}
