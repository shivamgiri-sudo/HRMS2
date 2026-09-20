/**
 * quality-gap.service.ts
 *
 * QA-triggered training auto-assignment (Quality-Learning Governance, Epic 2 / US2.1).
 *
 * Detects skill gaps from db_audit.call_quality_assessment against qa_trigger_rule,
 * creates a training_assignment with full evidence, and hands TAT/escalation off to the
 * EXISTING governance engine (createTatInstance) rather than tracking a deadline here.
 *
 * DATABASE BOUNDARY: db_audit.call_quality_assessment is an upstream, read-only source —
 * see call-master.service.ts's own boundary comment. Read via querySource() (same MySQL
 * host as mas_hrms, unpinned default database — see db/sourceDb.ts), never written to.
 *
 * IDENTITY BRIDGE: call_quality_assessment.User is the dialer login (8-char, NOT
 * employees.employee_code). Shivamgiri.employee_source_alias bridges it to employee_code,
 * resolving ~90.5% of assessments (verified in quality-dashboard.routes.ts). A User with no
 * alias row is simply invisible to this detector — that is a known, accepted gap, not a bug
 * to route around here.
 */
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { querySource } from "../../db/sourceDb.js";
import { createTatInstance } from "../governance/tat.service.js";
import { provisionLmsForAssignment } from "./lms-provisioning.service.js";

export interface TriggerEvidenceCall {
  source: "db_audit.call_quality_assessment";
  dialer_user: string;
  call_date: string;
  score: number;
}

export interface QaTriggerRuleRow extends RowDataPacket {
  id: string;
  skill_category_id: string;
  trigger_pattern: "consecutive" | "average" | "single_critical";
  threshold_score: number;
  threshold_count: number | null;
  threshold_period_days: number | null;
  severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
  tat_hours: number;
  block_dialer: number;
  process_id: string | null;
}

export interface GapDetectionResult {
  employeeCode: string;
  employeeId: string | null;
  skillCategoryId: string;
  ruleId: string;
  triggered: boolean;
  reason: string;
  assignmentId?: string;
  assignmentCreated: boolean;
  contentMissing?: boolean;
}

/** Active trigger rules, most recently updated first (stable order for deterministic tests). */
export async function listActiveTriggerRules(): Promise<QaTriggerRuleRow[]> {
  const [rows] = await db.execute<QaTriggerRuleRow[]>(
    `SELECT id, skill_category_id, trigger_pattern, threshold_score, threshold_count,
            threshold_period_days, severity, tat_hours, block_dialer, process_id
       FROM qa_trigger_rule
      WHERE active_status = 1
      ORDER BY updated_at DESC`
  );
  return rows;
}

/**
 * Resolves a dialer login (call_quality_assessment.User) to an HRMS employee.
 * Returns null when no alias row exists — the accepted ~9.5% gap, not an error.
 */
async function resolveEmployeeForDialerUser(
  dialerUser: string
): Promise<{ employeeId: string; employeeCode: string; userId: string | null } | null> {
  const rows = await querySource<{
    employee_id: string;
    employee_code: string;
    user_id: string | null;
  }>(
    `SELECT e.id AS employee_id, e.employee_code AS employee_code, e.user_id AS user_id
       FROM Shivamgiri.employee_source_alias a
       JOIN mas_hrms.employees e ON e.employee_code = a.employee_code
      WHERE a.source_agent_name = ? COLLATE utf8mb4_unicode_ci
        AND a.source_system = 'db_audit'
        AND e.active_status = 1
      LIMIT 1`,
    [dialerUser]
  );
  if (!rows.length) return null;
  return { employeeId: rows[0].employee_id, employeeCode: rows[0].employee_code, userId: rows[0].user_id };
}

/**
 * Calls matching a dialer user within the rule's lookback window, most recent first.
 * `threshold_period_days` bounds an 'average' rule's window; 'consecutive' rules only need
 * the most recent `threshold_count` calls, so a generous 30-day cap keeps the scan bounded
 * even when an agent hasn't been audited in a while.
 */
async function fetchRecentScores(
  dialerUser: string,
  lookbackDays: number
): Promise<Array<{ CallDate: string; quality_percentage: number }>> {
  return querySource<{ CallDate: string; quality_percentage: number }>(
    `SELECT CallDate, quality_percentage
       FROM db_audit.call_quality_assessment
      WHERE User = ?
        AND CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)
      ORDER BY CallDate DESC
      LIMIT 50`,
    [dialerUser, lookbackDays]
  );
}

/** Whether a rule's pattern is met by the given score history (newest first). */
function evaluateRule(
  rule: QaTriggerRuleRow,
  scores: Array<{ CallDate: string; quality_percentage: number }>
): { triggered: boolean; evidence: TriggerEvidenceCall[] } {
  if (rule.trigger_pattern === "single_critical") {
    const hit = scores[0];
    if (hit && Number(hit.quality_percentage) <= Number(rule.threshold_score)) {
      return {
        triggered: true,
        evidence: [{ source: "db_audit.call_quality_assessment", dialer_user: "", call_date: hit.CallDate, score: Number(hit.quality_percentage) }],
      };
    }
    return { triggered: false, evidence: [] };
  }

  if (rule.trigger_pattern === "consecutive") {
    const count = rule.threshold_count ?? 2;
    if (scores.length < count) return { triggered: false, evidence: [] };
    const window = scores.slice(0, count);
    const allBelow = window.every((s) => Number(s.quality_percentage) < Number(rule.threshold_score));
    if (!allBelow) return { triggered: false, evidence: [] };
    return {
      triggered: true,
      evidence: window.map((s) => ({ source: "db_audit.call_quality_assessment", dialer_user: "", call_date: s.CallDate, score: Number(s.quality_percentage) })),
    };
  }

  // 'average'
  const periodDays = rule.threshold_period_days ?? 7;
  const cutoff = Date.now() - periodDays * 24 * 60 * 60 * 1000;
  const inWindow = scores.filter((s) => new Date(s.CallDate).getTime() >= cutoff);
  if (!inWindow.length) return { triggered: false, evidence: [] };
  const avg = inWindow.reduce((sum, s) => sum + Number(s.quality_percentage), 0) / inWindow.length;
  if (avg >= Number(rule.threshold_score)) return { triggered: false, evidence: [] };
  return {
    triggered: true,
    evidence: inWindow.map((s) => ({ source: "db_audit.call_quality_assessment", dialer_user: "", call_date: s.CallDate, score: Number(s.quality_percentage) })),
  };
}

/**
 * Whether the employee already has a pending (not-yet-completed) assignment for this
 * skill category. "Pending" here means the assignment either has no tat_instance_id yet
 * (content-missing limbo) or its task_tat_instance.status is not completed/cancelled —
 * status is looked up via the FK rather than duplicated on training_assignment (US2.1
 * scenario 2: "no duplicate assignment is created ... deadline is NOT extended").
 */
async function hasPendingAssignment(employeeId: string, skillCategoryId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id
       FROM training_assignment ta
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ta.employee_id = ?
        AND ta.skill_category_id = ?
        AND (ta.tat_instance_id IS NULL OR t.status NOT IN ('completed', 'cancelled'))
      LIMIT 1`,
    [employeeId, skillCategoryId]
  );
  return rows.length > 0;
}

/** Appends a note to an existing pending assignment rather than creating a duplicate. */
async function annotateExistingAssignment(employeeId: string, skillCategoryId: string, note: string): Promise<void> {
  await db.execute(
    `UPDATE training_assignment
        SET notes = TRIM(CONCAT(COALESCE(notes, ''), '\n', ?)),
            updated_at = NOW()
      WHERE employee_id = ? AND skill_category_id = ?
      ORDER BY created_at DESC
      LIMIT 1`,
    [note, employeeId, skillCategoryId]
  );
}

/** Active content mapped to a skill category, in assignment order. */
async function fetchMappedContent(
  skillCategoryId: string
): Promise<Array<{ id: string; lms_content_id: string; lms_content_name: string | null }>> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, lms_content_id, lms_content_name
       FROM skill_content_mapping
      WHERE skill_category_id = ? AND active_status = 1
      ORDER BY sequence_order ASC`,
    [skillCategoryId]
  );
  return rows as Array<{ id: string; lms_content_id: string; lms_content_name: string | null }>;
}

/**
 * Raises the "no content mapped for this skill" alert (FR2/US2.1 scenario 3) as a
 * training_assignment row with tat_instance_id = NULL — visible to a training admin as
 * unresolved without a TAT clock running against nobody's actual deadline.
 */
async function recordContentMissingGap(
  employeeId: string,
  skillCategoryId: string,
  triggerRuleId: string,
  severity: QaTriggerRuleRow["severity"],
  evidence: TriggerEvidenceCall[]
): Promise<string> {
  const id = randomUUID();
  await db.execute(
    `INSERT INTO training_assignment
       (id, employee_id, skill_category_id, trigger_rule_id, trigger_type, trigger_evidence,
        severity, assigned_content, tat_instance_id, assigned_by, notes, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'QA_SKILL_GAP', ?, ?, NULL, NULL, 'SYSTEM',
             'No active LMS content mapped for this skill category at detection time. Needs manual training-admin action.',
             NOW(), NOW())`,
    [id, employeeId, skillCategoryId, triggerRuleId, JSON.stringify(evidence), severity]
  );
  return id;
}

/**
 * Creates the training_assignment plus its TAT instance, via the EXISTING governance
 * engine (createTatInstance). `assignedTo` for the work item must be an auth_user id
 * (employees.user_id), not employees.id — work_item.assigned_to_user_id is compared
 * against the caller's auth user id everywhere else in this codebase (see
 * work-inbox.triggers.ts). Falls back to role-based assignment being handled by the
 * escalation ladder itself when the employee has no linked auth user.
 */
async function createAssignmentWithTat(params: {
  employeeId: string;
  employeeCode: string;
  userId: string | null;
  skillCategoryId: string;
  ruleId: string;
  severity: QaTriggerRuleRow["severity"];
  evidence: TriggerEvidenceCall[];
  content: Array<{ id: string; lms_content_id: string; lms_content_name: string | null }>;
}): Promise<string> {
  const assignmentId = randomUUID();
  await db.execute(
    `INSERT INTO training_assignment
       (id, employee_id, skill_category_id, trigger_rule_id, trigger_type, trigger_evidence,
        severity, assigned_content, assigned_by, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'QA_SKILL_GAP', ?, ?, ?, 'SYSTEM', NOW(), NOW())`,
    [
      assignmentId,
      params.employeeId,
      params.skillCategoryId,
      params.ruleId,
      JSON.stringify(params.evidence),
      params.severity,
      JSON.stringify(params.content.map((c) => c.id)),
    ]
  );

  // Reuses the existing TAT/escalation engine end to end: due_at from tat_matrix_master,
  // work_item creation, and every downstream escalation level via tat-escalation.worker.ts.
  // assignedTo falls back to the employeeId itself when there is no linked auth user —
  // createTatInstance stores it verbatim on task_tat_instance.assigned_to/owner_user_id and
  // the escalation ladder notifies by ROLE (team_leader/manager/qa), not by this value, so a
  // missing auth user does not block the assignment from being TAT-tracked and escalated.
  const tatInstanceId = await createTatInstance(
    "quality_coaching_required",
    "training_assignment",
    assignmentId,
    params.userId ?? params.employeeId
  );

  await db.execute(
    `UPDATE training_assignment SET tat_instance_id = ?, updated_at = NOW() WHERE id = ?`,
    [tatInstanceId, assignmentId]
  );

  // Best-effort LMS learner-identity confirmation. Must never block or roll back the
  // assignment/TAT instance above — the assignment (evidence + TAT tracking) is what HRMS
  // owns; the LMS side is a best-effort courtesy, same discipline as
  // provisionLmsIdentityForEmployee() itself already applies. A failure here just leaves
  // lms_provisioning_status at 'provisioning_failed' for a training admin to see and retry.
  try {
    await provisionLmsForAssignment({ assignmentId, employeeCode: params.employeeCode });
  } catch (err) {
    console.error(`[quality-gap] LMS provisioning failed for assignment ${assignmentId}:`, (err as Error).message);
  }

  return assignmentId;
}

/**
 * Evaluates one active rule against one dialer user's recent scores and, on a genuine new
 * gap, creates the training_assignment (+ TAT instance) or the content-missing alert row.
 * Idempotent per (employee, skill category, pending) — a second detector run before the
 * first assignment is resolved annotates rather than duplicates (US2.1 scenario 2).
 */
export async function evaluateRuleForDialerUser(
  rule: QaTriggerRuleRow,
  dialerUser: string
): Promise<GapDetectionResult> {
  const identity = await resolveEmployeeForDialerUser(dialerUser);
  if (!identity) {
    return {
      employeeCode: dialerUser,
      employeeId: null,
      skillCategoryId: rule.skill_category_id,
      ruleId: rule.id,
      triggered: false,
      reason: "no employee_source_alias mapping for this dialer user",
      assignmentCreated: false,
    };
  }

  const lookbackDays = rule.trigger_pattern === "average" ? (rule.threshold_period_days ?? 7) : 30;
  const scores = await fetchRecentScores(dialerUser, lookbackDays);
  const { triggered, evidence } = evaluateRule(rule, scores);
  const evidenceWithUser = evidence.map((e) => ({ ...e, dialer_user: dialerUser }));

  if (!triggered) {
    return {
      employeeCode: identity.employeeCode,
      employeeId: identity.employeeId,
      skillCategoryId: rule.skill_category_id,
      ruleId: rule.id,
      triggered: false,
      reason: "pattern not met",
      assignmentCreated: false,
    };
  }

  const alreadyPending = await hasPendingAssignment(identity.employeeId, rule.skill_category_id);
  if (alreadyPending) {
    await annotateExistingAssignment(
      identity.employeeId,
      rule.skill_category_id,
      `Additional gap detected ${new Date().toISOString().slice(0, 10)} (rule ${rule.id}) — deadline not extended.`
    );
    return {
      employeeCode: identity.employeeCode,
      employeeId: identity.employeeId,
      skillCategoryId: rule.skill_category_id,
      ruleId: rule.id,
      triggered: true,
      reason: "gap detected but a pending assignment for this skill already exists — annotated, not duplicated",
      assignmentCreated: false,
    };
  }

  const content = await fetchMappedContent(rule.skill_category_id);
  if (!content.length) {
    const assignmentId = await recordContentMissingGap(
      identity.employeeId,
      rule.skill_category_id,
      rule.id,
      rule.severity,
      evidenceWithUser
    );
    return {
      employeeCode: identity.employeeCode,
      employeeId: identity.employeeId,
      skillCategoryId: rule.skill_category_id,
      ruleId: rule.id,
      triggered: true,
      reason: "no active content mapped for this skill category",
      assignmentId,
      assignmentCreated: false,
      contentMissing: true,
    };
  }

  const assignmentId = await createAssignmentWithTat({
    employeeId: identity.employeeId,
    employeeCode: identity.employeeCode,
    userId: identity.userId,
    skillCategoryId: rule.skill_category_id,
    ruleId: rule.id,
    severity: rule.severity,
    evidence: evidenceWithUser,
    content,
  });

  return {
    employeeCode: identity.employeeCode,
    employeeId: identity.employeeId,
    skillCategoryId: rule.skill_category_id,
    ruleId: rule.id,
    triggered: true,
    reason: "gap detected, training assigned",
    assignmentId,
    assignmentCreated: true,
  };
}

/**
 * Dialer users with at least one call in the given lookback window — the candidate pool the
 * detector sweeps per rule, so it never scans the full historical User set on every poll.
 */
export async function listRecentDialerUsers(lookbackDays: number): Promise<string[]> {
  const rows = await querySource<{ User: string }>(
    `SELECT DISTINCT User
       FROM db_audit.call_quality_assessment
      WHERE User IS NOT NULL AND User <> ''
        AND CallDate >= DATE_SUB(NOW(), INTERVAL ? DAY)`,
    [lookbackDays]
  );
  return rows.map((r) => r.User);
}
