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

// ─── Public endpoints (no auth required) ─────────────────────────────────────

// GET /grievance-officer — DPDP §13: public disclosure of Grievance Officer
privacyRouter.get(
  "/grievance-officer",
  h(async (_req, res: Response) => {
    const data = await privacyService.getGrievanceOfficer();
    return res.json({ success: true, data });
  })
);

// GET /notice — returns active consent notice text for a given context
privacyRouter.get(
  "/notice",
  h(async (req, res: Response) => {
    const context = (req.query.context as string) ?? "general";
    const purposeCode = context === "candidate" ? "recruitment" : context;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT version_code, title, consent_text, language, activated_at
         FROM consent_text_version
        WHERE purpose_code = ? AND status = 'active'
        ORDER BY activated_at DESC LIMIT 1`,
      [purposeCode]
    );
    const version = (rows as RowDataPacket[])[0] ?? null;
    return res.json({ success: true, data: version });
  })
);

// ─── Nominee Registry ─────────────────────────────────────────────────────────

// POST /nominate — employee nominates a representative (DPDP §14)
privacyRouter.post(
  "/nominate",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { nominee_name, nominee_email, nominee_mobile, nominee_relationship, effective_from } = req.body as {
      nominee_name: string;
      nominee_email: string;
      nominee_mobile?: string;
      nominee_relationship?: string;
      effective_from: string;
    };
    if (!nominee_name || !nominee_email || !effective_from) {
      return res.status(400).json({ success: false, message: "nominee_name, nominee_email, and effective_from are required" });
    }
    const data = await privacyService.nominateAgent(req.authUser!.id, {
      nominee_name, nominee_email, nominee_mobile, nominee_relationship, effective_from,
    });
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DPDP_NOMINEE_REGISTER",
      module_key: "privacy",
      entity_type: "dpdp_nominee_registry",
      entity_id: data.id,
      change_summary: { nominee_email, effective_from },
      req,
    });
    return res.status(201).json({ success: true, data });
  })
);

// GET /nominate/my — get my active nominee
privacyRouter.get(
  "/nominate/my",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.getMyNominee(req.authUser!.id);
    return res.json({ success: true, data });
  })
);

// DELETE /nominate/my — revoke my nominee
privacyRouter.delete(
  "/nominate/my",
  requireAuth,
  h(async (req: AuthenticatedRequest, res: Response) => {
    await privacyService.revokeNomination(req.authUser!.id);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DPDP_NOMINEE_REVOKE",
      module_key: "privacy",
      entity_type: "dpdp_nominee_registry",
      req,
    });
    return res.json({ success: true, message: "Nomination revoked" });
  })
);

// ─── Data Processor Registry ─────────────────────────────────────────────────

// GET /data-processors — admin/dpo only
privacyRouter.get(
  "/data-processors",
  requireAuth,
  requireRole("admin", "dpo"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await privacyService.listProcessors();
    return res.json({ success: true, data });
  })
);

// POST /data-processors — create (admin only)
privacyRouter.post(
  "/data-processors",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { processor_name, processor_type, data_categories_json, processing_purpose, data_location,
            dpa_signed, dpa_signed_date, dpa_document_url, contact_email, notes } = req.body as {
      processor_name: string;
      processor_type: string;
      data_categories_json: unknown;
      processing_purpose: string;
      data_location: string;
      dpa_signed?: number;
      dpa_signed_date?: string;
      dpa_document_url?: string;
      contact_email?: string;
      notes?: string;
    };
    if (!processor_name || !processor_type || !data_categories_json || !processing_purpose || !data_location) {
      return res.status(400).json({ success: false, message: "processor_name, processor_type, data_categories_json, processing_purpose, data_location required" });
    }
    const data = await privacyService.createProcessor({
      processor_name, processor_type, data_categories_json, processing_purpose, data_location,
      dpa_signed, dpa_signed_date, dpa_document_url, contact_email, notes,
    });
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DATA_PROCESSOR_CREATE",
      module_key: "privacy",
      entity_type: "data_processor_registry",
      entity_id: data.id,
      change_summary: { processor_name },
      req,
    });
    return res.status(201).json({ success: true, data });
  })
);

// PATCH /data-processors/:id — update (admin only)
privacyRouter.patch(
  "/data-processors/:id",
  requireAuth,
  requireRole("admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await privacyService.updateProcessor(req.params.id, req.body as Record<string, unknown>);
    await logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "DATA_PROCESSOR_UPDATE",
      module_key: "privacy",
      entity_type: "data_processor_registry",
      entity_id: req.params.id,
      change_summary: req.body as Record<string, unknown>,
      req,
    });
    return res.json({ success: true });
  })
);

// ─── Token-based recruitment consent (candidate onboarding Step 1) ────────────

// POST /consent/recruitment — record recruitment consent via onboarding token (no JWT required)
privacyRouter.post(
  "/consent/recruitment",
  h(async (req, res: Response) => {
    const { token, candidate_id } = req.body as { token?: string; candidate_id?: string };
    if (!token && !candidate_id) {
      return res.status(400).json({ success: false, message: "token or candidate_id required" });
    }
    let cid = candidate_id;
    if (!cid && token) {
      // Resolve candidate_id from onboarding token
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT b.candidate_id FROM ats_onboarding_bridge b
          WHERE b.onboarding_token = ? AND b.onboarding_token_expires_at > NOW()
          LIMIT 1`,
        [token]
      );
      const row = (rows as RowDataPacket[])[0];
      if (!row) return res.status(400).json({ success: false, message: "Invalid or expired onboarding token" });
      cid = row.candidate_id as string;
    }
    await privacyService.recordRecruitmentConsent(cid!, req.ip ?? undefined);
    return res.json({ success: true, message: "Recruitment consent recorded" });
  })
);

// NOTE: DPDP withdrawal workflow endpoints are handled exclusively by
// dpdp-withdrawal.routes.ts (mounted at /api/privacy). The duplicate
// implementation previously here has been removed to prevent divergence.
