/* eslint-disable @typescript-eslint/no-unused-vars */
import { Router } from "express";
import type { Response } from "express";
import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { privacyService } from "./privacy.service.js";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
/* eslint-enable @typescript-eslint/no-unused-vars */

export const privacyRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

// ─── Consent ──────────────────────────────────────────────────────────────────

// GET /consent/my-consents — authenticated user's own consents
privacyRouter.get(
  "/consent/my-consents",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getMyConsents(req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// GET /consent/all — admin/hr/dpo view all consents
privacyRouter.get(
  "/consent/all",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getAllConsents({
      purpose_code: req.query.purpose_code as string | undefined,
      principal_type: req.query.principal_type as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

// GET /consent/stats — coverage stats (admin/hr)
privacyRouter.get(
  "/consent/stats",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getConsentCoverageStats();
    return res.json({ success: true, data });
  })
);

// POST /consent — record consent (authenticated for employees; public path for candidates handled by caller supplying principal_type)
privacyRouter.post(
  "/consent",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { principal_type, purpose_code, consent_text_version, consent_text_hash, channel } = req.body as {
      principal_type: string;
      purpose_code: string;
      consent_text_version: string;
      consent_text_hash: string;
      channel: string;
    };

    if (!purpose_code || !consent_text_version || !consent_text_hash) {
      return res.status(400).json({ success: false, message: "purpose_code, consent_text_version, and consent_text_hash are required" });
    }

    const data = await privacyService.recordConsent({
      principalId: req.authUser!.id,
      principalType: (principal_type ?? "employee") as "employee" | "candidate" | "client_user" | "portal_user",
      purposeCode: purpose_code as "employment" | "payroll" | "communication" | "lms" | "portal" | "recruitment" | "health",
      consentTextVersion: consent_text_version,
      consentTextHash: consent_text_hash,
      channel: (channel ?? "web") as "web" | "api" | "import" | "manual",
      ipAddress: req.ip ?? undefined,
    });

    return res.status(201).json({ success: true, data });
  })
);

// POST /consent/withdraw — withdraw a consent by purpose_code
privacyRouter.post(
  "/consent/withdraw",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { purpose_code } = req.body as { purpose_code: string };
    if (!purpose_code) {
      return res.status(400).json({ success: false, message: "purpose_code is required" });
    }
    await privacyService.withdrawConsent(req.authUser!.id, purpose_code);

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "CONSENT_WITHDRAW",
      module_key: "privacy",
      entity_type: "data_consent",
      change_summary: { purpose_code },
      req,
    });

    return res.json({ success: true, message: "Consent withdrawn" });
  })
);

// ─── Data Rights ──────────────────────────────────────────────────────────────

// POST /rights/access — request data export
privacyRouter.post(
  "/rights/access",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const result = await privacyService.createAccessRequest(req.authUser!.id);
    return res.status(201).json({ success: true, data: result });
  })
);

// POST /rights/correction — request correction
privacyRouter.post(
  "/rights/correction",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { field_name, current_value, requested_value, description } = req.body as {
      field_name: string;
      current_value: string;
      requested_value: string;
      description?: string;
    };

    if (!field_name || !current_value || !requested_value) {
      return res.status(400).json({ success: false, message: "field_name, current_value, and requested_value are required" });
    }

    const data = await privacyService.createCorrectionRequest(req.authUser!.id, {
      field_name,
      current_value,
      requested_value,
      description,
    });
    return res.status(201).json({ success: true, data });
  })
);

// POST /rights/erasure — request erasure
privacyRouter.post(
  "/rights/erasure",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { description } = req.body as { description?: string };
    const data = await privacyService.createErasureRequest(
      req.authUser!.id,
      description ?? "Erasure request submitted"
    );

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "ERASURE_REQUEST",
      module_key: "privacy",
      entity_type: "data_rights_request",
      entity_id: data.id,
      req,
    });

    return res.status(201).json({ success: true, data });
  })
);

// GET /rights/my-requests — own requests
privacyRouter.get(
  "/rights/my-requests",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getMyRightsRequests(req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// GET /rights/requests — admin/hr/dpo: all requests
privacyRouter.get(
  "/rights/requests",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getAllRightsRequests({
      status: req.query.status as string | undefined,
      request_type: req.query.request_type as string | undefined,
    });
    return res.json({ success: true, data });
  })
);

// PATCH /rights/requests/:id — resolve/reject (admin/hr/dpo)
privacyRouter.patch(
  "/rights/requests/:id",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, response_notes, assigned_to } = req.body as {
      status: "in_review" | "resolved" | "rejected";
      response_notes?: string;
      assigned_to?: string;
    };

    if (!status) {
      return res.status(400).json({ success: false, message: "status is required" });
    }

    const data = await privacyService.resolveRightsRequest(req.params.id, {
      status,
      response_notes,
      assigned_to,
    });

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "RIGHTS_REQUEST_UPDATE",
      module_key: "privacy",
      entity_type: "data_rights_request",
      entity_id: req.params.id,
      change_summary: { status, response_notes },
      req,
    });

    return res.json({ success: true, data });
  })
);

// ─── Retention Policy ─────────────────────────────────────────────────────────

// GET /retention/policies — admin only
privacyRouter.get(
  "/retention/policies",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.listRetentionPolicies();
    return res.json({ success: true, data });
  })
);

// PUT /retention/policies/:entityType — update (admin only)
privacyRouter.put(
  "/retention/policies/:entityType",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { retention_days, action_on_expiry, legal_basis, is_active } = req.body as {
      retention_days?: number;
      action_on_expiry?: string;
      legal_basis?: string;
      is_active?: number;
    };

    const data = await privacyService.updateRetentionPolicy(req.params.entityType, {
      retention_days,
      action_on_expiry,
      legal_basis,
      is_active,
    });

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "RETENTION_POLICY_UPDATE",
      module_key: "privacy",
      entity_type: "data_retention_policy",
      entity_id: req.params.entityType,
      change_summary: req.body as Record<string, unknown>,
      req,
    });

    return res.json({ success: true, data });
  })
);

// ─── DPDP Config ──────────────────────────────────────────────────────────────

// GET /config — admin/hr
privacyRouter.get(
  "/config",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.listConfig();
    return res.json({ success: true, data });
  })
);

// PUT /config/:key — admin only
privacyRouter.put(
  "/config/:key",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { config_value } = req.body as { config_value: string };
    if (!config_value && config_value !== "") {
      return res.status(400).json({ success: false, message: "config_value is required" });
    }

    const data = await privacyService.updateConfig(req.params.key, config_value);

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DPDP_CONFIG_UPDATE",
      module_key: "privacy",
      entity_type: "dpdp_config",
      entity_id: req.params.key,
      change_summary: { config_value },
      req,
    });

    return res.json({ success: true, data });
  })
);

// ─── Breach Log ───────────────────────────────────────────────────────────────

// GET /breaches — admin/hr only
privacyRouter.get(
  "/breaches",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_breach_log ORDER BY detected_at DESC LIMIT 100"
    );
    res.json({ success: true, data: rows });
  })
);

// POST /breaches — log a new breach (admin/hr only)
privacyRouter.post(
  "/breaches",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      detected_at,
      breach_type,
      affected_records_count,
      affected_data_types,
      severity,
      description,
      immediate_action_taken,
    } = req.body as {
      detected_at: string;
      breach_type?: string;
      affected_records_count?: number;
      affected_data_types?: string[];
      severity?: string;
      description: string;
      immediate_action_taken?: string;
    };

    if (!detected_at || !description) {
      return res.status(400).json({ success: false, message: "detected_at and description are required" });
    }

    const id = randomUUID();
    const ref = `BR-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO data_breach_log (id, breach_ref, detected_at, breach_type, affected_records_count,
         affected_data_types, severity, description, immediate_action_taken, reported_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        ref,
        detected_at,
        breach_type ?? "other",
        affected_records_count ?? 0,
        JSON.stringify(affected_data_types ?? []),
        severity ?? "medium",
        description,
        immediate_action_taken ?? null,
        req.authUser!.id,
      ]
    );
    res.status(201).json({ success: true, data: { id, breach_ref: ref } });
  })
);

// PATCH /breaches/:id — update status/notifications (admin/hr only)
privacyRouter.patch(
  "/breaches/:id",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const {
      status,
      notified_authority_at,
      notified_principals_at,
      authority_ref,
      remediation_notes,
    } = req.body as {
      status?: string;
      notified_authority_at?: string;
      notified_principals_at?: string;
      authority_ref?: string;
      remediation_notes?: string;
    };

    await db.execute(
      `UPDATE data_breach_log SET
         status = COALESCE(?, status),
         notified_authority_at = COALESCE(?, notified_authority_at),
         notified_principals_at = COALESCE(?, notified_principals_at),
         authority_ref = COALESCE(?, authority_ref),
         remediation_notes = COALESCE(?, remediation_notes),
         updated_at = NOW()
       WHERE id = ?`,
      [
        status ?? null,
        notified_authority_at ?? null,
        notified_principals_at ?? null,
        authority_ref ?? null,
        remediation_notes ?? null,
        req.params.id,
      ]
    );
    res.json({ success: true });
  })
);

// ─── Consent Text Versions ────────────────────────────────────────────────────

privacyRouter.get(
  "/consent-versions",
  requireAuth,
  requireRole("admin", "hr"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM consent_text_version ORDER BY purpose_code, version_code"
    );
    res.json({ success: true, data: rows });
  })
);

privacyRouter.post(
  "/consent-versions",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { version_code, purpose_code, title, consent_text, language } = req.body;
    if (!version_code || !purpose_code || !title || !consent_text) {
      return res.status(400).json({ error: "version_code, purpose_code, title, consent_text required" });
    }
    const id = randomUUID();
    const text_hash = createHash("sha256").update(String(consent_text)).digest("hex");
    await db.execute(
      `INSERT INTO consent_text_version (id, version_code, purpose_code, title, consent_text, text_hash, language, status, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
      [id, version_code, purpose_code, title, consent_text, text_hash, language ?? "en", req.authUser!.id]
    );
    res.status(201).json({ success: true, data: { id } });
  })
);

privacyRouter.patch(
  "/consent-versions/:id/review",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { legal_reviewed_by } = req.body;
    if (!legal_reviewed_by) return res.status(400).json({ error: "legal_reviewed_by required" });
    await db.execute(
      "UPDATE consent_text_version SET status = 'legal_review', legal_reviewed_by = ?, legal_reviewed_at = NOW() WHERE id = ?",
      [legal_reviewed_by, req.params.id]
    );
    res.json({ success: true });
  })
);

privacyRouter.patch(
  "/consent-versions/:id/approve",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await db.execute(
      "UPDATE consent_text_version SET status = 'approved' WHERE id = ? AND status = 'legal_review'",
      [req.params.id]
    );
    res.json({ success: true });
  })
);

privacyRouter.patch(
  "/consent-versions/:id/activate",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM consent_text_version WHERE id = ? AND status = 'approved' LIMIT 1",
      [req.params.id]
    );
    const version = (rows as RowDataPacket[])[0];
    if (!version) return res.status(400).json({ error: "Version not found or not in approved status" });
    await db.execute(
      "UPDATE consent_text_version SET status = 'superseded', superseded_at = NOW() WHERE purpose_code = ? AND status = 'active'",
      [version.purpose_code]
    );
    await db.execute(
      "UPDATE consent_text_version SET status = 'active', activated_at = NOW() WHERE id = ?",
      [req.params.id]
    );
    const configKey = `consent_active_version_${version.purpose_code}`;
    await db.execute(
      "INSERT INTO dpdp_config (config_key, config_value, description) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE config_value = VALUES(config_value)",
      [configKey, version.version_code, `Active consent version for ${version.purpose_code}`]
    );
    res.json({ success: true });
  })
);

// ─── DPDP Withdrawal Workflow ──────────────────────────────────────────────────

// POST /dpdp-withdrawal/request — employee submits withdrawal request
privacyRouter.post(
  "/dpdp-withdrawal/request",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { purpose_code, withdrawal_reason, scope_description } = req.body as {
      purpose_code: string;
      withdrawal_reason: string;
      scope_description?: string;
    };
    if (!purpose_code || !withdrawal_reason) {
      return res.status(400).json({ success: false, message: "purpose_code and withdrawal_reason are required" });
    }
    const id = randomUUID();
    const requestRef = `WDRAW-${Date.now().toString(36).toUpperCase()}`;
    await db.execute(
      `INSERT INTO dpdp_consent_withdrawal
         (id, request_ref, principal_id, purpose_code, withdrawal_reason, scope_description, status, submitted_at)
       VALUES (?, ?, ?, ?, ?, ?, 'submitted', NOW())`,
      [id, requestRef, req.authUser!.id, purpose_code, withdrawal_reason, scope_description ?? null]
    );
    await db.execute(
      `INSERT INTO dpdp_withdrawal_audit_log
         (id, withdrawal_id, action, performed_by, remarks)
       VALUES (UUID(), ?, 'submitted', ?, 'Withdrawal request submitted by principal')`,
      [id, req.authUser!.id]
    );
    return res.status(201).json({ success: true, data: { id, request_ref: requestRef } });
  })
);

// GET /dpdp-withdrawal/my-requests — employee sees own requests
privacyRouter.get(
  "/dpdp-withdrawal/my-requests",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM dpdp_consent_withdrawal
       WHERE principal_id = ?
       ORDER BY submitted_at DESC`,
      [req.authUser!.id]
    );
    return res.json({ success: true, data: rows });
  })
);

// GET /dpdp-withdrawal — HR/compliance sees all requests
privacyRouter.get(
  "/dpdp-withdrawal",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, purpose_code } = req.query as Record<string, string>;
    const params: unknown[] = [];
    let where = "1=1";
    if (status) { where += " AND dcw.status = ?"; params.push(status); }
    if (purpose_code) { where += " AND dcw.purpose_code = ?"; params.push(purpose_code); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dcw.*, u.full_name as principal_name
       FROM dpdp_consent_withdrawal dcw
       LEFT JOIN users u ON u.id = dcw.principal_id
       WHERE ${where}
       ORDER BY dcw.submitted_at DESC LIMIT 200`,
      params
    );
    return res.json({ success: true, data: rows });
  })
);

// GET /dpdp-withdrawal/:id — get specific request
privacyRouter.get(
  "/dpdp-withdrawal/:id",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dcw.*, u.full_name as principal_name
       FROM dpdp_consent_withdrawal dcw
       LEFT JOIN users u ON u.id = dcw.principal_id
       WHERE dcw.id = ? LIMIT 1`,
      [req.params.id]
    );
    if (!rows.length) return res.status(404).json({ success: false, message: "Request not found" });
    const record = rows[0] as any;
    // Allow own requests or privileged roles
    if (record.principal_id !== userId) {
      // require hr/admin/dpo check via role in token
      const userRole = (req as any).authUser?.role ?? "";
      if (!["admin", "hr", "dpo"].includes(userRole)) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }
    return res.json({ success: true, data: record });
  })
);

// POST /dpdp-withdrawal/:id/start-review — HR starts review, sets processing hold
privacyRouter.post(
  "/dpdp-withdrawal/:id/start-review",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { reviewer_notes } = req.body as { reviewer_notes?: string };
    await db.execute(
      `UPDATE dpdp_consent_withdrawal
       SET status = 'in_review', reviewed_by = ?, review_started_at = NOW(), reviewer_notes = ?
       WHERE id = ? AND status = 'submitted'`,
      [req.authUser!.id, reviewer_notes ?? null, req.params.id]
    );
    // Insert processing hold
    await db.execute(
      `INSERT INTO dpdp_processing_hold
         (id, withdrawal_id, held_by, hold_reason, held_at)
       VALUES (UUID(), ?, ?, 'Withdrawal review in progress', NOW())`,
      [req.params.id, req.authUser!.id]
    );
    await db.execute(
      `INSERT INTO dpdp_withdrawal_audit_log
         (id, withdrawal_id, action, performed_by, remarks)
       VALUES (UUID(), ?, 'review_started', ?, ?)`,
      [req.params.id, req.authUser!.id, reviewer_notes ?? "Review started, processing hold applied"]
    );
    return res.json({ success: true, message: "Review started and processing hold applied" });
  })
);

// POST /dpdp-withdrawal/:id/approve — HR approves
privacyRouter.post(
  "/dpdp-withdrawal/:id/approve",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { approval_notes, data_action } = req.body as {
      approval_notes?: string;
      data_action?: string;
    };
    await db.execute(
      `UPDATE dpdp_consent_withdrawal
       SET status = 'approved', approved_by = ?, approved_at = NOW(),
           approval_notes = ?, data_action = ?
       WHERE id = ?`,
      [req.authUser!.id, approval_notes ?? null, data_action ?? "hold", req.params.id]
    );
    // Release hold
    await db.execute(
      `UPDATE dpdp_processing_hold
       SET released_at = NOW(), release_reason = 'Withdrawal approved'
       WHERE withdrawal_id = ? AND released_at IS NULL`,
      [req.params.id]
    );
    await db.execute(
      `INSERT INTO dpdp_withdrawal_audit_log
         (id, withdrawal_id, action, performed_by, remarks)
       VALUES (UUID(), ?, 'approved', ?, ?)`,
      [req.params.id, req.authUser!.id, approval_notes ?? "Withdrawal approved"]
    );

    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DPDP_WITHDRAWAL_APPROVED",
      module_key: "privacy",
      entity_type: "dpdp_consent_withdrawal",
      entity_id: req.params.id,
      change_summary: { data_action },
      req,
    });
    return res.json({ success: true, message: "Withdrawal approved" });
  })
);

// POST /dpdp-withdrawal/:id/reject — HR rejects with reason
privacyRouter.post(
  "/dpdp-withdrawal/:id/reject",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { rejection_reason } = req.body as { rejection_reason?: string };
    if (!rejection_reason?.trim()) {
      return res.status(400).json({ success: false, message: "rejection_reason is required" });
    }
    await db.execute(
      `UPDATE dpdp_consent_withdrawal
       SET status = 'rejected', rejected_by = ?, rejected_at = NOW(), rejection_reason = ?
       WHERE id = ?`,
      [req.authUser!.id, rejection_reason, req.params.id]
    );
    // Release any active hold
    await db.execute(
      `UPDATE dpdp_processing_hold
       SET released_at = NOW(), release_reason = 'Withdrawal rejected'
       WHERE withdrawal_id = ? AND released_at IS NULL`,
      [req.params.id]
    );
    await db.execute(
      `INSERT INTO dpdp_withdrawal_audit_log
         (id, withdrawal_id, action, performed_by, remarks)
       VALUES (UUID(), ?, 'rejected', ?, ?)`,
      [req.params.id, req.authUser!.id, rejection_reason]
    );
    return res.json({ success: true, message: "Withdrawal rejected" });
  })
);

// GET /dpdp-withdrawal/:id/audit — audit trail
privacyRouter.get(
  "/dpdp-withdrawal/:id/audit",
  requireAuth,
  requireRole("admin", "hr", "dpo"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT dwal.*, u.full_name as performed_by_name
       FROM dpdp_withdrawal_audit_log dwal
       LEFT JOIN users u ON u.id = dwal.performed_by
       WHERE dwal.withdrawal_id = ?
       ORDER BY dwal.created_at ASC`,
      [req.params.id]
    );
    return res.json({ success: true, data: rows });
  })
);
