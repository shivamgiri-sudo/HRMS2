/**
 * quality-learning.routes.ts
 *
 * Admin CRUD for the Quality-Learning Governance configuration surfaces:
 * skill categories, QA trigger rules, and skill-to-LMS-content mappings.
 *
 * Follows the same conventions as governance/tat.routes.ts (requireAuth on the router,
 * requireRole("admin","hr") on writes, soft-delete via active_status rather than DELETE).
 * TAT/escalation configuration itself is NOT duplicated here — that stays in
 * /api/governance/tat/matrix and /api/governance/tat/escalation-matrix, reused as-is for
 * the 'quality_coaching_required' task_type seeded by backend/sql/1820_quality_learning_governance.sql.
 */
import { Router, type Response } from "express";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { logger } from "../../logger.js";
import { listActiveDialerHolds, markDialerHoldApplied, liftDialerHold } from "./dialer-hold.service.js";
import { confirmLmsContentAdded, listPendingLmsContentActions } from "./lms-provisioning.service.js";
import {
  createContentBuilderRequest,
  listContentBuilderRequests,
  listActiveContentBuilderRequests,
  markContentBuilderInProgress,
  markContentBuilderBuilt,
  markContentBuilderMapped,
  cancelContentBuilderRequest,
} from "./content-builder.service.js";
import { extendTatDeadline } from "../governance/tat.service.js";
import { notificationGateway } from "../communication/notification.gateway.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

/**
 * Admits a listed manager-shaped role OR anyone who actually has direct reports —
 * same rationale and same query shape as quality-manager.routes.ts's allowRolesOrManagers:
 * requireRole alone would tell a manager holding only the `employee` role that she cannot
 * see her own team.
 */
function allowRolesOrManagers(...roles: string[]) {
  const roleGate = requireRole(...roles);
  return async (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void) => {
    const userId = req.authUser?.id;
    if (userId) {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT 1 AS has_reports
             FROM employees mgr
            WHERE mgr.user_id = ?
              AND EXISTS (SELECT 1 FROM employees r
                           WHERE (r.reporting_manager_id = mgr.id OR r.manager_id = mgr.id)
                             AND r.active_status = 1)
            LIMIT 1`,
          [userId],
        );
        if (rows.length > 0) return next();
      } catch (error) {
        logger.error("Error checking direct reports for quality-learning access:", error);
      }
    }
    return (roleGate as unknown as (rq: unknown, rs: unknown, nx: unknown) => void)(req, res, next);
  };
}

/** Resolves the calling user's own employees.id (not employee_code), for scoping "my team". */
async function getOwnEmployeeId(userId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [userId]
  );
  return (rows as RowDataPacket[])[0]?.id ?? null;
}

// ── Skill Categories ──────────────────────────────────────────────────────────

router.get("/skill-categories", h(async (_req: any, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM skill_category WHERE active_status = 1 ORDER BY category_name`
  );
  return res.json({ success: true, data: rows });
}));

router.post("/skill-categories", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { categoryCode, categoryName, description, processId } = req.body as {
    categoryCode: string;
    categoryName: string;
    description?: string;
    processId?: string;
  };
  if (!categoryCode || !categoryName) {
    return res.status(400).json({ success: false, message: "categoryCode and categoryName are required" });
  }
  const id = randomUUID();
  await db.execute(
    `INSERT INTO skill_category (id, category_code, category_name, description, process_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       category_name = VALUES(category_name),
       description = VALUES(description),
       process_id = VALUES(process_id),
       updated_at = NOW()`,
    [id, categoryCode, categoryName, description ?? null, processId ?? null, req.authUser!.id]
  );
  return res.status(201).json({ success: true, id });
}));

router.put("/skill-categories/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { categoryName, description, isActive } = req.body as {
    categoryName?: string;
    description?: string;
    isActive?: number;
  };
  await db.execute(
    `UPDATE skill_category
        SET category_name = COALESCE(?, category_name),
            description = COALESCE(?, description),
            active_status = COALESCE(?, active_status),
            updated_at = NOW()
      WHERE id = ?`,
    [categoryName ?? null, description ?? null, isActive ?? null, req.params.id]
  );
  return res.json({ success: true });
}));

router.delete("/skill-categories/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  // Soft delete only — skill_category is FK-referenced by qa_trigger_rule (ON DELETE
  // RESTRICT), skill_content_mapping (ON DELETE CASCADE) and training_assignment
  // (ON DELETE RESTRICT), so a hard delete would either fail loudly or, worse for
  // content_mapping, silently cascade away historical mappings.
  await db.execute("UPDATE skill_category SET active_status = 0 WHERE id = ?", [req.params.id]);
  return res.json({ success: true });
}));

// ── QA Trigger Rules ──────────────────────────────────────────────────────────

router.get("/trigger-rules", h(async (req: any, res: any) => {
  const { skillCategoryId } = req.query as Record<string, string>;
  const params: unknown[] = [];
  let where = "active_status = 1";
  if (skillCategoryId) { where += " AND skill_category_id = ?"; params.push(skillCategoryId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM qa_trigger_rule WHERE ${where} ORDER BY updated_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

router.post("/trigger-rules", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const {
    skillCategoryId, triggerPattern, thresholdScore, thresholdCount, thresholdPeriodDays,
    severity, tatHours, blockDialer, processId,
  } = req.body as {
    skillCategoryId: string;
    triggerPattern: "consecutive" | "average" | "single_critical";
    thresholdScore: number;
    thresholdCount?: number;
    thresholdPeriodDays?: number;
    severity: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
    tatHours?: number;
    blockDialer?: boolean;
    processId?: string;
  };
  if (!skillCategoryId || !triggerPattern || thresholdScore === undefined || !severity) {
    return res.status(400).json({
      success: false,
      message: "skillCategoryId, triggerPattern, thresholdScore and severity are required",
    });
  }
  if (thresholdScore < 0 || thresholdScore > 100) {
    return res.status(400).json({ success: false, message: "thresholdScore must be between 0 and 100" });
  }
  const id = randomUUID();
  await db.execute(
    `INSERT INTO qa_trigger_rule
       (id, skill_category_id, trigger_pattern, threshold_score, threshold_count,
        threshold_period_days, severity, tat_hours, block_dialer, process_id, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      id, skillCategoryId, triggerPattern, thresholdScore, thresholdCount ?? null,
      thresholdPeriodDays ?? null, severity, tatHours ?? 24, blockDialer ? 1 : 0,
      processId ?? null, req.authUser!.id,
    ]
  );
  return res.status(201).json({ success: true, id });
}));

router.put("/trigger-rules/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const {
    thresholdScore, thresholdCount, thresholdPeriodDays, severity, tatHours, blockDialer, isActive,
  } = req.body as {
    thresholdScore?: number;
    thresholdCount?: number;
    thresholdPeriodDays?: number;
    severity?: string;
    tatHours?: number;
    blockDialer?: boolean;
    isActive?: number;
  };

  if (thresholdScore !== undefined && (thresholdScore < 0 || thresholdScore > 100)) {
    return res.status(400).json({ success: false, message: "thresholdScore must be between 0 and 100" });
  }

  const sets: string[] = [];
  const params: unknown[] = [];
  const push = (col: string, val: unknown) => { sets.push(`${col} = ?`); params.push(val); };

  if (thresholdScore !== undefined) push("threshold_score", thresholdScore);
  if (thresholdCount !== undefined) push("threshold_count", thresholdCount);
  if (thresholdPeriodDays !== undefined) push("threshold_period_days", thresholdPeriodDays);
  if (severity !== undefined) push("severity", severity);
  if (tatHours !== undefined) push("tat_hours", tatHours);
  if (blockDialer !== undefined) push("block_dialer", blockDialer ? 1 : 0);
  if (isActive !== undefined) push("active_status", isActive);

  if (!sets.length) {
    return res.status(400).json({ success: false, message: "No fields to update" });
  }

  params.push(req.params.id);
  await db.execute(
    `UPDATE qa_trigger_rule SET ${sets.join(", ")}, updated_at = NOW() WHERE id = ?`,
    params
  );
  return res.json({ success: true });
}));

router.delete("/trigger-rules/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  await db.execute("UPDATE qa_trigger_rule SET active_status = 0 WHERE id = ?", [req.params.id]);
  return res.json({ success: true });
}));

// ── Skill → Content Mapping ───────────────────────────────────────────────────

router.get("/content-mappings", h(async (req: any, res: any) => {
  const { skillCategoryId } = req.query as Record<string, string>;
  const params: unknown[] = [];
  let where = "active_status = 1";
  if (skillCategoryId) { where += " AND skill_category_id = ?"; params.push(skillCategoryId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM skill_content_mapping WHERE ${where} ORDER BY skill_category_id, sequence_order`,
    params
  );
  return res.json({ success: true, data: rows });
}));

router.post("/content-mappings", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { skillCategoryId, lmsContentId, lmsContentName, sequenceOrder, mandatory } = req.body as {
    skillCategoryId: string;
    lmsContentId: string;
    lmsContentName?: string;
    sequenceOrder?: number;
    mandatory?: boolean;
  };
  if (!skillCategoryId || !lmsContentId) {
    return res.status(400).json({ success: false, message: "skillCategoryId and lmsContentId are required" });
  }
  const id = randomUUID();
  await db.execute(
    `INSERT INTO skill_content_mapping
       (id, skill_category_id, lms_content_id, lms_content_name, sequence_order, mandatory, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE
       lms_content_name = VALUES(lms_content_name),
       sequence_order = VALUES(sequence_order),
       mandatory = VALUES(mandatory),
       active_status = 1,
       updated_at = NOW()`,
    [id, skillCategoryId, lmsContentId, lmsContentName ?? null, sequenceOrder ?? 1, mandatory === false ? 0 : 1, req.authUser!.id]
  );
  return res.status(201).json({ success: true, id });
}));

router.put("/content-mappings/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { lmsContentName, sequenceOrder, mandatory, isActive } = req.body as {
    lmsContentName?: string;
    sequenceOrder?: number;
    mandatory?: boolean;
    isActive?: number;
  };
  await db.execute(
    `UPDATE skill_content_mapping
        SET lms_content_name = COALESCE(?, lms_content_name),
            sequence_order = COALESCE(?, sequence_order),
            mandatory = COALESCE(?, mandatory),
            active_status = COALESCE(?, active_status),
            updated_at = NOW()
      WHERE id = ?`,
    [
      lmsContentName ?? null,
      sequenceOrder ?? null,
      mandatory === undefined ? null : (mandatory ? 1 : 0),
      isActive ?? null,
      req.params.id,
    ]
  );
  return res.json({ success: true });
}));

router.delete("/content-mappings/:id", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  await db.execute("UPDATE skill_content_mapping SET active_status = 0 WHERE id = ?", [req.params.id]);
  return res.json({ success: true });
}));

// ── MCN Content Builder (OpenMAIC tooling-link worklist) ─────────────────────
//
// Tracks a coordinator's request to author LMS content via OpenMAIC (a standalone external
// app — see 1825_mcn_content_builder_request.sql). Never calls out to OpenMAIC or mcn_lms.

// GET/POST use allowRolesOrManagers, not a fixed role list — a manager who can see a
// content-missing gap on their own team's manager-dashboard must be able to flag it too,
// same access shape as the dashboard itself. Linking a mapping (below) stays stricter.
router.get(
  "/content-builder-requests",
  allowRolesOrManagers("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: any, res: any) => {
    const { skillCategoryId, activeOnly } = req.query as Record<string, string>;
    const rows = activeOnly === "true"
      ? await listActiveContentBuilderRequests()
      : await listContentBuilderRequests(skillCategoryId || undefined);
    return res.json({ success: true, data: rows });
  })
);

router.post(
  "/content-builder-requests",
  allowRolesOrManagers("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { skillCategoryId, brief } = req.body as { skillCategoryId: string; brief?: string };
    if (!skillCategoryId) {
      return res.status(400).json({ success: false, message: "skillCategoryId is required" });
    }
    const id = await createContentBuilderRequest({
      skillCategoryId,
      requestedBy: req.authUser!.id,
      brief: brief?.trim() || null,
    });
    return res.status(201).json({ success: true, id });
  })
);

router.post(
  "/content-builder-requests/:id/start",
  requireRole("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: any, res: any) => {
    await markContentBuilderInProgress(req.params.id);
    return res.json({ success: true });
  })
);

router.post(
  "/content-builder-requests/:id/built",
  requireRole("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: any, res: any) => {
    const { builderUrl, exportReference } = req.body as { builderUrl?: string; exportReference?: string };
    await markContentBuilderBuilt({
      id: req.params.id,
      builderUrl: builderUrl?.trim() || null,
      exportReference: exportReference?.trim() || null,
    });
    return res.json({ success: true });
  })
);

router.post(
  "/content-builder-requests/:id/mapped",
  requireRole("admin", "hr"),
  h(async (req: any, res: any) => {
    const { contentMappingId } = req.body as { contentMappingId: string };
    if (!contentMappingId) {
      return res.status(400).json({ success: false, message: "contentMappingId is required" });
    }
    await markContentBuilderMapped({ id: req.params.id, contentMappingId });
    return res.json({ success: true });
  })
);

router.post(
  "/content-builder-requests/:id/cancel",
  requireRole("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: any, res: any) => {
    const { reason } = req.body as { reason?: string };
    await cancelContentBuilderRequest(req.params.id, reason?.trim() || null);
    return res.json({ success: true });
  })
);

// ── Training Assignments (admin/broad read; evidence/dashboard views) ────────

router.get("/assignments", requireRole("admin", "hr"), h(async (req: AuthenticatedRequest, res: any) => {
  const { employeeId, skillCategoryId } = req.query as Record<string, string>;
  const params: unknown[] = [];
  let where = "1=1";
  if (employeeId) { where += " AND ta.employee_id = ?"; params.push(employeeId); }
  if (skillCategoryId) { where += " AND ta.skill_category_id = ?"; params.push(skillCategoryId); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.*, sc.category_name, sc.category_code,
            t.status AS tat_status, t.due_at, t.completed_at, t.current_escalation_level
       FROM training_assignment ta
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ${where}
      ORDER BY ta.created_at DESC
      LIMIT 200`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ── Manager Dashboard — FR6 / US4.1 ───────────────────────────────────────────

/**
 * GET /api/quality-learning/manager-dashboard
 *
 * Team training-assignment governance view: alert counts by urgency (US4.1 "critical /
 * pending / approaching / OK" summary cards) plus the full per-assignment list with TAT
 * status, escalation level and evidence summary — everything ManagerTeamQuality.tsx /
 * the "My Team > Quality & Learning" tab needs in one call.
 *
 * Scope: admin/hr/ceo/branch_head/operations_head see the whole org (managerEmployeeId is
 * NULL, matching quality-manager.routes.ts's '__ALL__' convention); everyone else with
 * direct reports sees only their own team.
 */
router.get(
  "/manager-dashboard",
  allowRolesOrManagers("admin", "hr", "ceo", "process_manager", "team_leader", "manager", "branch_head", "assistant_manager", "operations_head"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const userId = req.authUser!.id;
    const ctx = req.authUser!;
    const wideRoles = ["admin", "hr", "ceo", "super_admin", "operations_head"];
    const isWide = (ctx.roles ?? []).some((r: string) => wideRoles.includes(r));

    const params: unknown[] = [];
    let scopeWhere = "1=1";
    if (!isWide) {
      const ownEmployeeId = await getOwnEmployeeId(userId);
      if (!ownEmployeeId) {
        return res.json({
          success: true,
          data: { summary: { critical: 0, pending: 0, approaching: 0, compliant: 0 }, assignments: [] },
        });
      }
      scopeWhere = "(e.reporting_manager_id = ? OR e.manager_id = ?)";
      params.push(ownEmployeeId, ownEmployeeId);
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         ta.id, ta.employee_id, ta.skill_category_id, ta.trigger_type, ta.severity,
         ta.assigned_content, ta.acknowledged_at, ta.completion_score, ta.created_at,
         ta.lms_learner_id, ta.lms_provisioning_status, ta.lms_provisioning_note,
         sc.category_name, sc.category_code,
         e.employee_code, e.full_name AS employee_name,
         d.designation_name,
         t.status AS tat_status, t.due_at, t.completed_at, t.current_escalation_level,
         TIMESTAMPDIFF(HOUR, NOW(), t.due_at) AS hours_to_due,
         CASE WHEN t.due_at < NOW() AND t.status IN ('open','in_progress','sla_breached') THEN 1 ELSE 0 END AS is_breached
       FROM training_assignment ta
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       JOIN employees e ON e.id = ta.employee_id
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ${scopeWhere}
      ORDER BY
        -- breached first, then soonest due, then content-missing alerts (no TAT instance) last
        (t.due_at IS NOT NULL AND t.due_at < NOW() AND t.status IN ('open','in_progress','sla_breached')) DESC,
        t.due_at ASC,
        ta.created_at DESC
      LIMIT 300`,
      params
    );

    const assignments = (rows as RowDataPacket[]).map((r) => ({
      id: r.id,
      employee: { code: r.employee_code, name: r.employee_name, designation: r.designation_name },
      skillCategory: { id: r.skill_category_id, code: r.category_code, name: r.category_name },
      triggerType: r.trigger_type,
      severity: r.severity,
      assignedContent: r.assigned_content,
      status: r.tat_status ?? (r.completed_at ? "completed" : "content_missing"),
      dueAt: r.due_at,
      completedAt: r.completed_at,
      escalationLevel: r.current_escalation_level ?? 0,
      hoursToDue: r.hours_to_due === null ? null : Number(r.hours_to_due),
      isBreached: Number(r.is_breached) === 1,
      acknowledgedAt: r.acknowledged_at,
      completionScore: r.completion_score,
      createdAt: r.created_at,
      lmsProvisioning: {
        learnerId: r.lms_learner_id,
        status: r.lms_provisioning_status,
        note: r.lms_provisioning_note,
      },
    }));

    // Summary bands match US4.1's "Critical / Pending / Approaching TAT / OK" cards.
    const summary = { critical: 0, pending: 0, approaching: 0, compliant: 0 };
    for (const a of assignments) {
      if (a.status === "completed") { summary.compliant++; continue; }
      if (a.isBreached || a.status === "content_missing") { summary.critical++; continue; }
      if (a.hoursToDue !== null && a.hoursToDue <= 6) { summary.approaching++; continue; }
      summary.pending++;
    }

    return res.json({ success: true, data: { summary, assignments } });
  })
);

/**
 * GET /api/quality-learning/assignments/:id/evidence
 *
 * Drill-down for a single assignment: the QA evidence that triggered it (call refs,
 * scores, dates from trigger_evidence JSON), the resolved skill/content, and the full
 * escalation history from task_escalation_log — the "evidence chain" FR6.9/US4.2 needs.
 * Access follows the same manager-or-role gate as the dashboard; an employee may also view
 * their own assignment's evidence (US5.2 "see why I was assigned training").
 */
router.get("/assignments/:id/evidence", h(async (req: AuthenticatedRequest, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.*, sc.category_name, sc.category_code,
            e.employee_code, e.full_name AS employee_name, e.user_id AS employee_user_id,
            t.status AS tat_status, t.due_at, t.started_at, t.completed_at, t.current_escalation_level
       FROM training_assignment ta
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       JOIN employees e ON e.id = ta.employee_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ta.id = ?
      LIMIT 1`,
    [req.params.id]
  );
  const assignment = (rows as RowDataPacket[])[0];
  if (!assignment) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }

  // Access: the assignment's own employee, or a manager/admin-shaped role. Mirrors
  // assertTatTaskAccess's ownership-or-privilege pattern in governance/tat.service.ts.
  const isOwnRecord = assignment.employee_user_id && assignment.employee_user_id === req.authUser!.id;
  if (!isOwnRecord) {
    const ownEmployeeId = await getOwnEmployeeId(req.authUser!.id);
    let isManagerOfEmployee = false;
    if (ownEmployeeId) {
      const [mgrRows] = await db.execute<RowDataPacket[]>(
        `SELECT 1 FROM employees WHERE id = ? AND (reporting_manager_id = ? OR manager_id = ?) LIMIT 1`,
        [assignment.employee_id, ownEmployeeId, ownEmployeeId]
      );
      isManagerOfEmployee = mgrRows.length > 0;
    }
    const roleKeys: string[] = req.authUser!.roles ?? [];
    const isPrivileged = roleKeys.some((r) => ["admin", "hr", "ceo", "super_admin", "operations_head", "qa"].includes(r));
    if (!isManagerOfEmployee && !isPrivileged) {
      return res.status(403).json({ success: false, message: "Not authorized to view this assignment" });
    }
  }

  const [escalationRows] = await db.execute<RowDataPacket[]>(
    `SELECT escalation_level, triggered_at, notified_user_id, notify_role, action_taken, resolved_at
       FROM task_escalation_log
      WHERE tat_instance_id = ?
      ORDER BY escalation_level ASC, triggered_at ASC`,
    [assignment.tat_instance_id ?? ""]
  );

  return res.json({
    success: true,
    data: {
      assignment: {
        id: assignment.id,
        employeeCode: assignment.employee_code,
        employeeName: assignment.employee_name,
        skillCategory: { code: assignment.category_code, name: assignment.category_name },
        severity: assignment.severity,
        triggerType: assignment.trigger_type,
        assignedContent: assignment.assigned_content,
        status: assignment.tat_status ?? (assignment.completed_at ? "completed" : "content_missing"),
        dueAt: assignment.due_at,
        startedAt: assignment.started_at,
        completedAt: assignment.completed_at,
        acknowledgedAt: assignment.acknowledged_at,
        notes: assignment.notes,
      },
      triggerEvidence: assignment.trigger_evidence,
      escalationHistory: escalationRows,
    },
  });
}));

// ── Bulk Manager Operations — FR6.7 / US4.6 / US4.7 ───────────────────────────
//
// Modelled on ats.joiningDocumentsTracker.service.ts's sendBulkReminders: per-item
// try/catch, a { sent, failed, skipped, errors[] } result shape, and — critically — the
// posted id list is RE-VALIDATED against the caller's own scope server-side rather than
// trusted, the same discipline that module's scopeBulkEmployeeIds middleware enforces.

interface BulkActionResult {
  requested: number;
  succeeded: number;
  failed: number;
  skipped: number;
  errors: Array<{ assignmentId: string; error: string }>;
}

/**
 * Narrows a caller-submitted list of training_assignment ids down to only those belonging
 * to an employee under the caller's own team (or all of them, for a privileged role) —
 * mirrors the manager-dashboard route's own scoping, but re-checked per-id here because a
 * bulk action is a WRITE, not a read: trusting a client-submitted id list for a mutation
 * would let a manager act on another manager's team by editing the request body.
 */
async function scopeAssignmentIdsToCaller(
  req: AuthenticatedRequest,
  assignmentIds: string[]
): Promise<{ allowed: string[]; denied: string[] }> {
  if (!assignmentIds.length) return { allowed: [], denied: [] };

  const wideRoles = ["admin", "hr", "ceo", "super_admin", "operations_head"];
  const isWide = (req.authUser!.roles ?? []).some((r: string) => wideRoles.includes(r));
  if (isWide) return { allowed: assignmentIds, denied: [] };

  const ownEmployeeId = await getOwnEmployeeId(req.authUser!.id);
  if (!ownEmployeeId) return { allowed: [], denied: assignmentIds };

  const placeholders = assignmentIds.map(() => "?").join(",");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id
       FROM training_assignment ta
       JOIN employees e ON e.id = ta.employee_id
      WHERE ta.id IN (${placeholders})
        AND (e.reporting_manager_id = ? OR e.manager_id = ?)`,
    [...assignmentIds, ownEmployeeId, ownEmployeeId]
  );
  const allowed = new Set((rows as RowDataPacket[]).map((r) => r.id as string));
  return {
    allowed: assignmentIds.filter((id) => allowed.has(id)),
    denied: assignmentIds.filter((id) => !allowed.has(id)),
  };
}

/**
 * POST /api/quality-learning/assignments/bulk-remind
 * Sends an on-demand reminder nudge to each selected assignment's employee, via the
 * training_reminder_nudge event (30-minute cooldown per assignment — see
 * 1823_training_reminder_nudge_event.sql for why it is short, not the 1440-minute default).
 */
router.post(
  "/assignments/bulk-remind",
  allowRolesOrManagers("admin", "hr", "ceo", "process_manager", "team_leader", "manager", "branch_head", "assistant_manager", "operations_head"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { assignmentIds } = req.body as { assignmentIds: string[] };
    if (!Array.isArray(assignmentIds) || !assignmentIds.length) {
      return res.status(400).json({ success: false, message: "assignmentIds is required" });
    }

    const { allowed, denied } = await scopeAssignmentIdsToCaller(req, assignmentIds);
    if (!allowed.length) {
      return res.status(403).json({ success: false, message: "None of the selected assignments belong to your team" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ta.id, ta.employee_id, e.user_id AS employee_user_id, sc.category_name
         FROM training_assignment ta
         JOIN employees e ON e.id = ta.employee_id
         JOIN skill_category sc ON sc.id = ta.skill_category_id
        WHERE ta.id IN (${allowed.map(() => "?").join(",")})`,
      allowed
    );

    const result: BulkActionResult = { requested: assignmentIds.length, succeeded: 0, failed: 0, skipped: denied.length, errors: [] };

    for (const row of rows as RowDataPacket[]) {
      try {
        const notifyResult = await notificationGateway.notify({
          eventCode: "training_reminder_nudge",
          // Includes a timestamp so a manager's second nudge is a distinct claim row rather
          // than colliding with the first on the unique dedupe key — the 30-minute COOLDOWN
          // (keyed on entity, not on this) is what actually throttles repeat nudges, not this.
          dedupeKey: `training_assignment:${row.id}:manual_nudge:${Date.now()}`,
          context: { employeeId: row.employee_id, userId: row.employee_user_id ?? undefined },
          entityType: "training_assignment",
          entityId: row.id,
          data: { skill_category: row.category_name },
          correlationId: `training-nudge:${row.id}`,
        });
        if (notifyResult.outcome === "sent" || notifyResult.outcome === "shadow") {
          result.succeeded++;
        } else if (notifyResult.outcome === "cooldown") {
          result.skipped++;
        } else {
          result.failed++;
          result.errors.push({ assignmentId: row.id, error: notifyResult.reason ?? notifyResult.outcome });
        }
      } catch (err) {
        result.failed++;
        result.errors.push({ assignmentId: row.id, error: (err as Error).message });
      }
    }

    return res.json({ success: true, data: result });
  })
);

/**
 * POST /api/quality-learning/assignments/bulk-extend-deadline
 * Extends the TAT deadline for each selected assignment, with a required justification
 * appended to each assignment's notes (task_escalation_log has no reason column — see
 * governance/tat.service.ts's extendTatDeadline for why the justification lives here instead).
 */
router.post(
  "/assignments/bulk-extend-deadline",
  allowRolesOrManagers("admin", "hr", "ceo", "process_manager", "team_leader", "manager", "branch_head", "assistant_manager", "operations_head"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { assignmentIds, newDueAt, justification } = req.body as {
      assignmentIds: string[];
      newDueAt: string;
      justification: string;
    };
    if (!Array.isArray(assignmentIds) || !assignmentIds.length) {
      return res.status(400).json({ success: false, message: "assignmentIds is required" });
    }
    if (!newDueAt || Number.isNaN(new Date(newDueAt).getTime())) {
      return res.status(400).json({ success: false, message: "A valid newDueAt is required" });
    }
    if (!justification?.trim()) {
      return res.status(400).json({ success: false, message: "A justification is required to extend a deadline" });
    }

    const { allowed, denied } = await scopeAssignmentIdsToCaller(req, assignmentIds);
    if (!allowed.length) {
      return res.status(403).json({ success: false, message: "None of the selected assignments belong to your team" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, tat_instance_id FROM training_assignment WHERE id IN (${allowed.map(() => "?").join(",")})`,
      allowed
    );

    const result: BulkActionResult = { requested: assignmentIds.length, succeeded: 0, failed: 0, skipped: denied.length, errors: [] };
    const actorLabel = req.authUser!.email ?? req.authUser!.id;
    const note = `Deadline extended to ${newDueAt} by ${actorLabel}: ${justification.trim()}`;

    for (const row of rows as RowDataPacket[]) {
      if (!row.tat_instance_id) {
        result.failed++;
        result.errors.push({ assignmentId: row.id, error: "No TAT instance on this assignment (content not yet mapped)" });
        continue;
      }
      try {
        await extendTatDeadline(row.tat_instance_id, newDueAt, req.authUser!.id);
        await db.execute(
          `UPDATE training_assignment SET notes = TRIM(CONCAT(COALESCE(notes, ''), '\n', ?)), updated_at = NOW() WHERE id = ?`,
          [note, row.id]
        );
        result.succeeded++;
      } catch (err) {
        result.failed++;
        result.errors.push({ assignmentId: row.id, error: (err as Error).message });
      }
    }

    return res.json({ success: true, data: result });
  })
);

// ── LMS Provisioning — coordinator worklist ───────────────────────────────────
//
// mcn_lms has no per-trainee content-assignment table (see lms-provisioning.service.ts's
// header), so adding the mapped content to a trainee's classroom curriculum is a manual
// step. These two routes are that worklist and its completion action — not a real LMS
// write, an honest handoff.

/**
 * GET /api/quality-learning/lms-content-actions
 * Assignments whose LMS learner identity exists (or provisioning failed) but the mapped
 * content still needs a coordinator to add it to the trainee's classroom curriculum.
 */
router.get(
  "/lms-content-actions",
  requireRole("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (_req: any, res: any) => {
    const rows = await listPendingLmsContentActions();
    return res.json({ success: true, data: rows });
  })
);

/**
 * POST /api/quality-learning/assignments/:id/confirm-lms-content
 * A training coordinator confirming they manually added the mapped content to the
 * employee's classroom curriculum in the LMS.
 */
router.post(
  "/assignments/:id/confirm-lms-content",
  requireRole("admin", "hr", "trainer", "training", "quality", "lms_admin"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { note } = req.body as { note?: string };
    await confirmLmsContentAdded(req.params.id, req.authUser!.id, note);
    return res.json({ success: true });
  })
);

// ── Employee Self-Service — FR7 / US5 ─────────────────────────────────────────

/**
 * GET /api/quality-learning/my-assignments
 *
 * The logged-in employee's own pending mandatory training (US5.1/FR7.1 — feeds the HRMS
 * login/dashboard popup). Only assignments not yet completed, oldest deadline first, so the
 * most urgent one is what the popup leads with.
 */
router.get("/my-assignments", h(async (req: AuthenticatedRequest, res: any) => {
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
    [req.authUser!.id]
  );
  const employeeId = (empRows as RowDataPacket[])[0]?.id;
  if (!employeeId) {
    return res.json({ success: true, data: [] });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id, ta.skill_category_id, ta.severity, ta.assigned_content, ta.acknowledged_at,
            ta.trigger_evidence, ta.created_at,
            sc.category_name, sc.category_code,
            t.status AS tat_status, t.due_at
       FROM training_assignment ta
       JOIN skill_category sc ON sc.id = ta.skill_category_id
       LEFT JOIN task_tat_instance t ON t.id = ta.tat_instance_id
      WHERE ta.employee_id = ?
        AND (t.status IS NULL OR t.status NOT IN ('completed', 'cancelled'))
      ORDER BY (t.due_at IS NULL) ASC, t.due_at ASC, ta.created_at DESC
      LIMIT 50`,
    [employeeId]
  );

  const data = (rows as RowDataPacket[]).map((r) => ({
    id: r.id,
    skillCategory: { code: r.category_code, name: r.category_name },
    severity: r.severity,
    assignedContent: r.assigned_content,
    status: r.tat_status ?? "content_missing",
    dueAt: r.due_at,
    acknowledgedAt: r.acknowledged_at,
    createdAt: r.created_at,
  }));

  return res.json({ success: true, data });
}));

/**
 * POST /api/quality-learning/my-assignments/:id/acknowledge
 *
 * Records the employee's acknowledgment before they can start training (US5.3/FR7.3-7.4).
 * Idempotent — acknowledging twice does not overwrite the original timestamp, since the
 * first acknowledgment is the legally/procedurally meaningful one.
 */
router.post("/my-assignments/:id/acknowledge", h(async (req: AuthenticatedRequest, res: any) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ta.id, e.user_id AS employee_user_id
       FROM training_assignment ta
       JOIN employees e ON e.id = ta.employee_id
      WHERE ta.id = ?
      LIMIT 1`,
    [req.params.id]
  );
  const assignment = (rows as RowDataPacket[])[0];
  if (!assignment) {
    return res.status(404).json({ success: false, message: "Assignment not found" });
  }
  if (assignment.employee_user_id !== req.authUser!.id) {
    return res.status(403).json({ success: false, message: "Not authorized to acknowledge this assignment" });
  }

  await db.execute(
    `UPDATE training_assignment SET acknowledged_at = COALESCE(acknowledged_at, NOW()), updated_at = NOW() WHERE id = ?`,
    [req.params.id]
  );

  return res.json({ success: true });
}));

// ── Dialer Holds — FR5 / US3.3 (manual enforcement, see dialer-hold.service.ts) ──────

/**
 * GET /api/quality-learning/dialer-holds
 * Active (requested/applied) holds — WFM/Ops's "who is currently supposed to be paused"
 * worklist, driven from the Work Inbox TRAINING_DIALER_HOLD items.
 */
router.get(
  "/dialer-holds",
  requireRole("admin", "hr", "wfm", "operations_head", "branch_head"),
  h(async (_req: any, res: any) => {
    const rows = await listActiveDialerHolds();
    return res.json({ success: true, data: rows });
  })
);

/**
 * POST /api/quality-learning/dialer-holds/:id/apply
 * WFM/Ops confirming they have manually paused the agent in Vicidial. This endpoint does
 * NOT touch Vicidial — see dialer-hold.service.ts's header for why.
 */
router.post(
  "/dialer-holds/:id/apply",
  requireRole("admin", "hr", "wfm", "operations_head", "branch_head"),
  h(async (req: AuthenticatedRequest, res: any) => {
    await markDialerHoldApplied(req.params.id, req.authUser!.id);
    return res.json({ success: true });
  })
);

/**
 * POST /api/quality-learning/dialer-holds/:id/lift
 * Clears a hold once training is completed (or otherwise resolved). Does NOT touch
 * Vicidial — WFM/Ops must separately unpause the agent there.
 */
router.post(
  "/dialer-holds/:id/lift",
  requireRole("admin", "hr", "wfm", "operations_head", "branch_head"),
  h(async (req: AuthenticatedRequest, res: any) => {
    const { notes } = req.body as { notes?: string };
    await liftDialerHold(req.params.id, req.authUser!.id, notes);
    return res.json({ success: true });
  })
);

export { router as qualityLearningRouter };
