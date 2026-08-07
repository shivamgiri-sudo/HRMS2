/**
 * /api/uat — UAT governance routes.
 *
 * Conventions follow helpdesk.routes.ts: a Router, the h() async wrapper, requireAuth at the
 * top, requireRole per endpoint, and { success: true, data } responses.
 *
 * SCOPE IS ENFORCED IN THE QUERY, NOT HERE. Every read goes through listFeedback/getFeedback,
 * which build their WHERE clause with the shared buildScopeWhereClause. A route guard that
 * checked scope itself would be a second interpretation of "which branches can this user
 * see", and the two would eventually disagree.
 */
import { Router } from "express";
import type { Response } from "express";
import multer from "multer";
import { requireAuth } from "../../middleware/authMiddleware.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { getUserRoleKeys } from "../../shared/scopeAccess.js";
import {
  UAT_TRIAGE_ROLES,
  addComment,
  assignFeedback,
  createFeedback,
  getFeedback,
  getLatestScan,
  getTimeline,
  listComments,
  listFeedback,
  markDuplicate,
} from "./uat-feedback.service.js";
import {
  decideApproval,
  gateStatus,
  listApprovals,
  createDelegation,
} from "./uat-approval.service.js";
import {
  completeRollback,
  createRelease,
  listRetests,
  markDeployedToUat,
  markProductionReleased,
  recordRetest,
  requireRollback,
  verifyInProduction,
} from "./uat-release.service.js";
import {
  MAX_ATTACHMENT_BYTES,
  deleteAttachment,
  listAttachments,
  readAttachment,
  storeAttachment,
} from "./uat-attachment.service.js";
import { findSimilar, recordMeToo } from "./uat-dedup.service.js";
import { loadCapabilityRegistry } from "./capability-registry.js";
import { loadProtectedPaths } from "./protected-paths.js";
import { agingFor } from "./uat-sla.service.js";
import { loadChecklist } from "./uat-checklist.repo.js";
import { queueValidation } from "./uat-jobs.handlers.js";
import { jobHealth } from "./uat-job-runner.js";
import { spendTodayMicros } from "./uat-cost.service.js";

const router = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

const APPROVER_ROLES = ["super_admin", "admin"] as const;
const RELEASE_ROLES = ["super_admin", "admin", "hr"] as const;

router.use(requireAuth);

/** Resolve the caller's employee row once; every scoped read needs it. */
async function actorOf(req: AuthenticatedRequest) {
  const userId = req.authUser.id;
  const employee = await getEmployeeForUser(userId);
  if (!employee) {
    const e = new Error(
      "Your login is not linked to an employee record, so UAT feedback cannot be attributed to you."
    ) as Error & { statusCode?: number };
    e.statusCode = 403;
    throw e;
  }
  const roles = await getUserRoleKeys(userId);
  return { userId, employeeId: employee.id, employeeCode: employee.employee_code, roles };
}

// ── Intake ────────────────────────────────────────────────────────────────────

/**
 * Anyone authenticated may submit. The static scan runs synchronously and its verdict comes
 * back in this response, so a blocked request is explained immediately rather than silently
 * queued and rejected days later.
 */
router.post(
  "/feedback",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const result = await createFeedback(req.body, actor);
    return res.status(201).json({
      success: true,
      data: {
        id: result.id,
        feedbackCode: result.feedbackCode,
        status: result.status,
        blocked: result.status === "scan_blocked",
        blockedReason: result.blockedReason,
        risk: result.scan
          ? {
              effectiveRisk: result.scan.effectiveRisk,
              pathTier: result.scan.riskTier,
              capabilityClass: result.scan.capabilityClass,
              capabilities: result.scan.capabilityHits.map((c) => ({
                key: c.capabilityKey,
                name: c.capabilityName,
                class: c.class,
                signal: c.signal,
                matched: c.matchedToken,
              })),
              requiredApproverRoles: result.scan.requiredApproverRoles,
            }
          : null,
      },
    });
  })
);

/**
 * Similar open items, for the "is this already reported?" check the form runs before submit.
 * Titles and statuses only — never a body — so this discloses nothing a scoped read would
 * withhold, which is why it is not scope-filtered: two branches hitting one defect is the
 * normal case, and hiding them from each other gets the same bug fixed twice.
 */
router.get(
  "/feedback/similar",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const q = req.query as Record<string, string | undefined>;
    const title = (q.title ?? "").trim();
    if (title.length < 6) return res.json({ success: true, data: [] });
    const data = await findSimilar(title, q.pageRoute ?? null, q.pageCode ?? null);
    return res.json({ success: true, data });
  })
);

router.post(
  "/feedback/:id/me-too",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const affectedUserCount = await recordMeToo(req.params.id, actor.userId);
    return res.json({ success: true, data: { affectedUserCount } });
  })
);

router.get(
  "/feedback",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const q = req.query as Record<string, string | undefined>;
    const { rows, total } = await listFeedback(actor.userId, actor.employeeId, {
      status: q.status,
      severity: q.severity,
      riskTier: q.riskTier,
      assignedTo: q.assignedTo,
      mineOnly: q.mine === "1" || q.mine === "true",
      limit: q.limit ? Number(q.limit) : undefined,
      offset: q.offset ? Number(q.offset) : undefined,
    });
    const now = new Date();
    return res.json({
      success: true,
      data: rows.map((r) => ({ ...r, aging: agingFor(r.created_at, r.due_at, now) })),
      total,
    });
  })
);

router.get(
  "/feedback/:id",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    // 404 rather than 403 for an out-of-scope item: telling a caller that an item exists but
    // belongs to another branch is itself a disclosure.
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    const isTriage = actor.roles.some((r) => UAT_TRIAGE_ROLES.includes(r));
    return res.json({
      success: true,
      data: {
        ...row,
        // body_raw is restricted: a triager sees it, a bystander does not.
        body_raw: isTriage || row.submitted_by_employee_id === actor.employeeId ? row.body_raw : null,
        aging: agingFor(row.created_at, row.due_at),
      },
    });
  })
);

router.get(
  "/feedback/:id/timeline",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: await getTimeline(req.params.id) });
  })
);

router.get(
  "/feedback/:id/scan",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    return res.json({ success: true, data: await getLatestScan(req.params.id) });
  })
);

// ── Comments ──────────────────────────────────────────────────────────────────

router.get(
  "/feedback/:id/comments",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    const isTriage = actor.roles.some((r) => UAT_TRIAGE_ROLES.includes(r));
    return res.json({ success: true, data: await listComments(req.params.id, isTriage) });
  })
);

router.post(
  "/feedback/:id/comments",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    const isTriage = actor.roles.some((r) => UAT_TRIAGE_ROLES.includes(r));
    // A reporter's own comment is visible to them by definition; only a triager may file an
    // internal note.
    const visibility =
      isTriage && req.body?.visibility === "internal" ? "internal" : "reporter_visible";
    await addComment(req.params.id, String(req.body?.body ?? ""), actor, visibility);
    return res.status(201).json({ success: true });
  })
);

// ── Attachments ───────────────────────────────────────────────────────────────

/**
 * memoryStorage, NOT diskStorage.
 *
 * diskStorage would write the raw upload to the filesystem first and encrypt (or delete) it
 * afterwards, which means a plaintext screenshot of somebody's payslip exists on disk for a
 * window. Holding it in RAM and encrypting before the first write removes that window
 * entirely. The 5 MB cap is what makes buffering safe.
 */
const attachmentUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_ATTACHMENT_BYTES, files: 1 },
});

router.post(
  "/feedback/:id/attachments",
  attachmentUpload.single("file"),
  h(async (req: AuthenticatedRequest & { file?: Express.Multer.File }, res: Response) => {
    const actor = await actorOf(req);
    // Scope check first: the uploader must be able to see the item they are attaching to.
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    if (!req.file) return res.status(400).json({ success: false, error: "No file was uploaded" });

    const stored = await storeAttachment({
      feedbackId: req.params.id,
      uploadedBy: actor.userId,
      originalFilename: req.file.originalname,
      declaredMime: req.file.mimetype,
      buffer: req.file.buffer,
    });
    return res.status(201).json({ success: true, data: stored });
  })
);

router.get(
  "/feedback/:id/attachments",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: await listAttachments(req.params.id) });
  })
);

/**
 * Stream an attachment back.
 *
 * Served through this authenticated route and nowhere else — these files live under
 * private-storage/, which no static handler mounts, precisely so that possessing the URL is
 * never sufficient. Content-Disposition is attachment and nosniff is set so a browser renders
 * nothing inline even if the stored bytes were something other than the image they claim.
 */
router.get(
  "/attachments/:attachmentId/download",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const isTriage = actor.roles.some((r) => UAT_TRIAGE_ROLES.includes(r));
    const file = await readAttachment(req.params.attachmentId, {
      employeeId: actor.employeeId,
      isTriage,
    });
    res.setHeader("Content-Type", file.mimeType);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${file.filename.replace(/[^A-Za-z0-9._-]/g, "_")}"`
    );
    return res.send(file.buffer);
  })
);

router.delete(
  "/attachments/:attachmentId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const isTriage = actor.roles.some((r) => UAT_TRIAGE_ROLES.includes(r));
    await deleteAttachment(req.params.attachmentId, {
      userId: actor.userId,
      employeeId: actor.employeeId,
      isTriage,
    });
    return res.json({ success: true });
  })
);

// ── Triage ────────────────────────────────────────────────────────────────────

router.post(
  "/feedback/:id/assign",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await assignFeedback(req.params.id, req.body?.assigneeEmployeeId ?? null, actor.userId);
    return res.json({ success: true });
  })
);

router.post(
  "/feedback/:id/duplicate",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await markDuplicate(req.params.id, String(req.body?.canonicalId ?? ""), actor.userId);
    return res.json({ success: true });
  })
);

// ── Approvals ─────────────────────────────────────────────────────────────────

router.get(
  "/feedback/:id/approvals",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    return res.json({
      success: true,
      data: { approvals: await listApprovals(req.params.id), gate: await gateStatus(req.params.id) },
    });
  })
);

router.post(
  "/feedback/:id/approvals/decide",
  requireRole(...APPROVER_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await decideApproval({
      feedbackId: req.params.id,
      approvalType: req.body?.approvalType,
      requiredRole: req.body?.requiredRole,
      approverUserId: actor.userId,
      decision: req.body?.decision,
      reason: req.body?.reason ?? null,
      approverRoles: actor.roles,
      // Phase 2 supplies the real editor list from the checklist rule table. Until then the
      // rule set is code-only and file-reviewed, so there is no DB editor to exclude.
      ruleEditorUserIds: [],
    });
    return res.json({ success: true });
  })
);

router.post(
  "/delegations",
  requireRole(...APPROVER_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const id = await createDelegation({
      capabilityKey: req.body?.capabilityKey ?? null,
      requiredRole: String(req.body?.requiredRole ?? ""),
      primaryApproverId: String(req.body?.primaryApproverId ?? ""),
      backupApproverId: String(req.body?.backupApproverId ?? ""),
      validFrom: new Date(req.body?.validFrom),
      validUntil: new Date(req.body?.validUntil),
      delegatedBy: actor.userId,
      reason: req.body?.reason ?? null,
    });
    return res.status(201).json({ success: true, data: { id } });
  })
);

// ── Release lifecycle ─────────────────────────────────────────────────────────

router.post(
  "/releases",
  requireRole(...RELEASE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await createRelease(req.body);
    return res.status(201).json({ success: true });
  })
);

router.post(
  "/feedback/:id/deploy",
  requireRole(...RELEASE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await markDeployedToUat(
      req.params.id,
      { releaseId: req.body?.releaseId ?? null, buildSha: req.body?.buildSha ?? null },
      actor.userId
    );
    return res.json({ success: true });
  })
);

/**
 * Retest. Open to any authenticated caller ON PURPOSE: the person best placed to confirm a
 * fix is the one who reported it, and requiring a privileged role here is how a retest queue
 * becomes a bottleneck that gets bypassed. The evidence requirements in the service are what
 * make the record trustworthy, not the role of the person filing it.
 */
router.post(
  "/feedback/:id/retest",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const out = await recordRetest({ ...req.body, feedbackId: req.params.id }, actor);
    return res.status(201).json({ success: true, data: out });
  })
);

router.get(
  "/feedback/:id/retests",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const row = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!row) return res.status(404).json({ success: false, error: "Not found" });
    return res.json({ success: true, data: await listRetests(req.params.id) });
  })
);

router.post(
  "/feedback/:id/release",
  requireRole(...RELEASE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await markProductionReleased(
      req.params.id,
      {
        releaseId: String(req.body?.releaseId ?? ""),
        version: String(req.body?.version ?? ""),
        approvedReleaseVersion: String(req.body?.approvedReleaseVersion ?? ""),
      },
      actor.userId
    );
    return res.json({ success: true });
  })
);

/** Verification is restricted to the reporter or QA owner inside the service, not by role. */
router.post(
  "/feedback/:id/verify",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await verifyInProduction(
      req.params.id,
      { checklist: req.body?.checklist ?? {}, note: req.body?.note ?? null },
      actor
    );
    return res.json({ success: true });
  })
);

router.post(
  "/feedback/:id/rollback",
  requireRole(...RELEASE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await requireRollback(
      req.params.id,
      { releaseId: String(req.body?.releaseId ?? ""), reason: String(req.body?.reason ?? "") },
      actor.userId
    );
    return res.json({ success: true });
  })
);

router.post(
  "/feedback/:id/rollback/complete",
  requireRole(...RELEASE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    await completeRollback(
      req.params.id,
      {
        rollbackId: String(req.body?.rollbackId ?? ""),
        restoredVersion: String(req.body?.restoredVersion ?? ""),
        verification: req.body?.verification ?? null,
      },
      actor.userId
    );
    return res.json({ success: true });
  })
);

// ── Governance transparency ───────────────────────────────────────────────────

/**
 * The control plane, read-only. Exposed so the checklist admin page can show WHY something
 * is protected rather than presenting a locked toggle with no explanation. There is no write
 * endpoint: these files change through a reviewed PR, which is the point of them.
 */
router.get(
  "/control-plane",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const paths = loadProtectedPaths();
    const registry = loadCapabilityRegistry();
    return res.json({
      success: true,
      data: {
        protectedPaths: { sha256: paths.sha256, rules: paths.rules },
        capabilities: {
          sha256: registry.sha256,
          items: registry.capabilities.map((c) => ({
            key: c.key,
            name: c.name,
            class: c.class,
            requiredApproverRoles: c.requiredApproverRoles,
            mandatoryTests: c.mandatoryTests,
            reason: c.reason,
          })),
        },
        editableInApp: false,
        note:
          "These rules are code, not configuration. They change through a reviewed pull " +
          "request so that the mechanism deciding what the pipeline may edit cannot be " +
          "loosened from inside the application.",
      },
    });
  })
);

/**
 * Health. Reports anything stuck or inconsistent so failures are loud rather than silent —
 * the dominant defect class in this codebase is the one nobody notices.
 */
router.get(
  "/health",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const { db } = await import("../../db/mysql.js");
    const [stuck] = await db.execute(
      `SELECT status, COUNT(*) AS n FROM uat_feedback
        WHERE status IN ('scanning','validating','prompt_writing','build_running')
          AND updated_at < DATE_SUB(NOW(), INTERVAL 10 MINUTE)
        GROUP BY status`
    );
    const [pending] = await db.execute(
      `SELECT COUNT(*) AS n FROM uat_approval WHERE decision = 'pending'`
    );
    const [overdue] = await db.execute(
      `SELECT COUNT(*) AS n FROM uat_feedback
        WHERE due_at IS NOT NULL AND due_at < NOW()
          AND status NOT IN ('closed','rejected','invalid')`
    );
    const [expiredDeleg] = await db.execute(
      `SELECT COUNT(*) AS n FROM uat_approver_delegation
        WHERE revoked_at IS NULL AND valid_until < NOW()`
    );
    return res.json({
      success: true,
      data: {
        stuckItems: stuck,
        pendingApprovals: pending,
        overdueItems: overdue,
        expiredDelegations: expiredDeleg,
        controlPlaneLoaded: true,
        // Queue depth by state. `dead` is the number that matters: a dead job is work that
        // will never be retried, and without it here the only symptom is an item that sits
        // in `validating` forever with nobody aware.
        jobs: await jobHealth(),
        spendTodayUsd: (await spendTodayMicros()) / 1_000_000,
      },
    });
  })
);

// ── Checklist (Phase 2) ───────────────────────────────────────────────────────

/**
 * The active checklist.
 *
 * `isFloor` is returned so the admin page can render those rows locked. There is deliberately
 * no write endpoint in this phase: the seeded rows mirror the JSON control plane, and a form
 * that let someone edit a mirror would imply the mirror is authoritative. Editing a
 * non-floor rule arrives with the admin UI in a later phase, behind its own approval.
 */
router.get(
  "/checklist",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const checklist = await loadChecklist();
    return res.json({
      success: true,
      data: {
        snapshotSha: checklist.snapshotSha,
        items: checklist.rules.map((r) => ({
          ...r,
          blocking: checklist.blockingItemKeys.has(r.itemKey),
          ...(checklist.statements.get(r.itemKey) ?? {}),
        })),
      },
    });
  })
);

/**
 * One item's evaluation, with the rule version and control-plane shas that produced it.
 *
 * Returns the shas rather than hiding them: "which checklist judged this" is the question a
 * six-month-old decision actually raises, and re-running today's rules to answer it would
 * give a confidently wrong answer.
 */
router.get(
  "/feedback/:id/checklist",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    // Scope check by way of the shared reader: a user who cannot see the item cannot see
    // its evaluation either. getFeedback applies the scope WHERE clause, so an out-of-scope
    // id comes back null and is indistinguishable from one that does not exist.
    const fb = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!fb) return res.status(404).json({ success: false, message: "Feedback item not found." });
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute(
      `SELECT item_key, verdict, source, evidence, confidence, rule_version,
              rule_snapshot_sha256, paths_sha, registry_sha, created_at
         FROM uat_checklist_evaluation
        WHERE feedback_id = ?
        ORDER BY item_key`,
      [req.params.id]
    );
    const [hits] = await db.execute(
      `SELECT capability_key, capability_class, match_signal, matched_token
         FROM uat_capability_hit WHERE feedback_id = ? ORDER BY capability_key`,
      [req.params.id]
    );
    return res.json({ success: true, data: { evaluations: rows, capabilityHits: hits } });
  })
);

/**
 * The LLM call log for one item — model version, effort, tokens, cost and stop reason.
 *
 * Excludes response_json and the prompt itself. A reviewer needs to know what it cost and
 * whether it refused; the stored payload was built from the redacted body and there is no
 * reason to widen who can read it.
 */
router.get(
  "/feedback/:id/llm-calls",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const fb = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!fb) return res.status(404).json({ success: false, message: "Feedback item not found." });
    const { db } = await import("../../db/mysql.js");
    const [rows] = await db.execute(
      `SELECT stage, provider_key, model_id, model_version, effort, attempt_no,
              schema_valid, stop_reason, refusal_category, input_tokens, output_tokens,
              cache_read_tokens, cost_usd_micros, latency_ms, error_message,
              prompt_template_version, created_at
         FROM uat_llm_call
        WHERE feedback_id = ?
        ORDER BY created_at`,
      [req.params.id]
    );
    return res.json({ success: true, data: rows });
  })
);

/**
 * Queue an item for automated evaluation.
 *
 * Triage-only, and it queues rather than evaluating inline: the call takes up to a minute,
 * and a request that dies halfway would leave the item in `validating` with no worker aware
 * of it. The state machine rejects an item that is not in a legal source state, so a double
 * click cannot queue twice.
 */
router.post(
  "/feedback/:id/evaluate",
  requireRole(...UAT_TRIAGE_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const actor = await actorOf(req);
    const fb = await getFeedback(req.params.id, actor.userId, actor.employeeId);
    if (!fb) return res.status(404).json({ success: false, message: "Feedback item not found." });
    const { queued } = await queueValidation(req.params.id, actor.userId);
    return res.json({
      success: true,
      data: {
        queued,
        message: queued
          ? "Queued for evaluation. The result appears on this item when the worker completes it."
          : "This item is already queued for evaluation.",
      },
    });
  })
);

export const uatPipelineRouter = router;
export default router;
