import { randomUUID, createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { buildPersonalDataExport } from "./dpdpAccessExport.service.js";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DataConsent {
  id: string;
  data_principal_id: string;
  principal_type: "employee" | "candidate" | "client_user" | "portal_user";
  purpose_code: "employment" | "payroll" | "communication" | "lms" | "portal" | "recruitment" | "health";
  consent_text_version: string;
  consent_text_hash: string;
  consented_at: string;
  withdrawn_at: string | null;
  ip_address: string | null;
  channel: "web" | "api" | "import" | "manual";
}

export interface DataRightsRequest {
  id: string;
  principal_id: string;
  principal_type: "employee" | "candidate" | "client_user";
  request_type: "access" | "correction" | "erasure" | "nomination" | "grievance";
  description: string | null;
  field_name: string | null;
  current_value: string | null;
  requested_value: string | null;
  status: "pending" | "in_review" | "resolved" | "rejected";
  assigned_to: string | null;
  resolved_at: string | null;
  response_notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface RetentionPolicy {
  id: string;
  entity_type: string;
  retention_days: number;
  action_on_expiry: "anonymize" | "delete" | "archive" | "notify_admin";
  legal_basis: string | null;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export interface DpdpConfigEntry {
  config_key: string;
  config_value: string;
  description: string | null;
  updated_at: string;
}

// ─── Consent ──────────────────────────────────────────────────────────────────

export const privacyService = {

  async getMyConsents(principalId: string): Promise<DataConsent[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, data_principal_id, principal_type, purpose_code, consent_text_version,
              consent_text_hash, consented_at, withdrawn_at, ip_address, channel
       FROM data_consent WHERE data_principal_id = ? ORDER BY consented_at DESC`,
      [principalId]
    );
    return rows as DataConsent[];
  },

  async getAllConsents(filters: { purpose_code?: string; principal_type?: string }): Promise<DataConsent[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.purpose_code) { conds.push("purpose_code = ?"); params.push(filters.purpose_code); }
    if (filters.principal_type) { conds.push("principal_type = ?"); params.push(filters.principal_type); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, data_principal_id, principal_type, purpose_code, consent_text_version,
              consent_text_hash, consented_at, withdrawn_at, ip_address, channel
       FROM data_consent ${where} ORDER BY consented_at DESC LIMIT 500`,
      params
    );
    return rows as DataConsent[];
  },

  async getConsentCoverageStats(): Promise<{ purpose_code: string; consented_count: number }[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT purpose_code, COUNT(*) AS consented_count
         FROM data_consent
        WHERE withdrawn_at IS NULL
        GROUP BY purpose_code`
    );
    return rows as { purpose_code: string; consented_count: number }[];
  },

  async recordConsent(input: {
    principalId: string;
    principalType: DataConsent["principal_type"];
    purposeCode: DataConsent["purpose_code"];
    // consentTextVersion and consentTextHash from the client are IGNORED.
    // The server loads the active version and computes the hash authoritatively.
    channel: DataConsent["channel"];
    ipAddress?: string;
  }): Promise<DataConsent> {
    // Load the currently active consent notice version for this purpose
    const [versionRows] = await db.execute<RowDataPacket[]>(
      `SELECT id AS version_id, version_tag, consent_text
       FROM consent_text_version
       WHERE purpose_code = ? AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [input.purposeCode]
    );
    if (!versionRows.length) {
      throw Object.assign(
        new Error(`No active consent version for purpose '${input.purposeCode}'`),
        { statusCode: 422, code: "CONSENT_VERSION_UNAVAILABLE" }
      );
    }
    const version = versionRows[0];
    // Server-authoritative hash — never trust client-submitted hash
    const serverHash = createHash("sha256").update(version.consent_text as string).digest("hex");

    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_consent
         (id, data_principal_id, principal_type, purpose_code, consent_text_version,
          consent_text_hash, channel, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         consent_text_version = VALUES(consent_text_version),
         consent_text_hash = VALUES(consent_text_hash),
         withdrawn_at = NULL,
         ip_address = VALUES(ip_address)`,
      [
        id,
        input.principalId,
        input.principalType,
        input.purposeCode,
        version.version_tag,
        serverHash,
        input.channel,
        input.ipAddress ?? null,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, data_principal_id, principal_type, purpose_code, consent_text_version,
              consent_text_hash, consented_at, withdrawn_at, ip_address, channel
       FROM data_consent WHERE data_principal_id = ? AND purpose_code = ? ORDER BY consented_at DESC LIMIT 1`,
      [input.principalId, input.purposeCode]
    );
    return (rows as DataConsent[])[0];
  },

  async withdrawConsent(principalId: string, purposeCode: string): Promise<void> {
    await db.executeRun(
      `UPDATE data_consent
          SET withdrawn_at = NOW()
        WHERE data_principal_id = ? AND purpose_code = ? AND withdrawn_at IS NULL`,
      [principalId, purposeCode]
    );
  },

  // ─── Data Rights ────────────────────────────────────────────────────────────

  async getMyRightsRequests(principalId: string): Promise<DataRightsRequest[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, principal_id, principal_type, request_type, description,
              field_name, status, assigned_to, resolved_at, response_notes, created_at, updated_at
       FROM data_rights_request WHERE principal_id = ? ORDER BY created_at DESC`,
      [principalId]
    );
    return rows as DataRightsRequest[];
  },

  async getAllRightsRequests(filters: { status?: string; request_type?: string }): Promise<DataRightsRequest[]> {
    const conds: string[] = [];
    const params: unknown[] = [];

    if (filters.status) { conds.push("status = ?"); params.push(filters.status); }
    if (filters.request_type) { conds.push("request_type = ?"); params.push(filters.request_type); }

    const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, principal_id, principal_type, request_type, description,
              field_name, status, assigned_to, resolved_at, response_notes, created_at, updated_at
       FROM data_rights_request ${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    return rows as DataRightsRequest[];
  },

  async createAccessRequest(principalId: string): Promise<{
    request: DataRightsRequest;
    personalDataExport: Awaited<ReturnType<typeof buildPersonalDataExport>>;
  }> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_rights_request
         (id, principal_id, principal_type, request_type, description, status)
       VALUES (?, ?, 'employee', 'access', 'Data access export request', 'pending')`,
      [id, principalId]
    );

    const personalDataExport = await buildPersonalDataExport(principalId);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, principal_id, principal_type, request_type, description,
              field_name, status, assigned_to, resolved_at, response_notes, created_at, updated_at
       FROM data_rights_request WHERE id = ? LIMIT 1`,
      [id]
    );
    return { request: (rows as DataRightsRequest[])[0], personalDataExport };
  },

  async createCorrectionRequest(
    principalId: string,
    input: { field_name: string; current_value: string; requested_value: string; description?: string }
  ): Promise<DataRightsRequest> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_rights_request
         (id, principal_id, principal_type, request_type, description, field_name, current_value, requested_value, status)
       VALUES (?, ?, 'employee', 'correction', ?, ?, ?, ?, 'pending')`,
      [id, principalId, input.description ?? null, input.field_name, input.current_value, input.requested_value]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_rights_request WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as DataRightsRequest[])[0];
  },

  async createErasureRequest(principalId: string, description: string): Promise<DataRightsRequest> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_rights_request
         (id, principal_id, principal_type, request_type, description, status)
       VALUES (?, ?, 'employee', 'erasure', ?, 'pending')`,
      [id, principalId, description]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_rights_request WHERE id = ? LIMIT 1",
      [id]
    );
    return (rows as DataRightsRequest[])[0];
  },

  async resolveRightsRequest(
    id: string,
    update: { status: "in_review" | "resolved" | "rejected"; response_notes?: string; assigned_to?: string }
  ): Promise<DataRightsRequest> {
    const setClauses: string[] = ["status = ?", "updated_at = NOW()"];
    const params: unknown[] = [update.status];

    if (update.response_notes !== undefined) { setClauses.push("response_notes = ?"); params.push(update.response_notes); }
    if (update.assigned_to !== undefined) { setClauses.push("assigned_to = ?"); params.push(update.assigned_to); }
    if (update.status === "resolved" || update.status === "rejected") {
      setClauses.push("resolved_at = NOW()");
    }

    params.push(id);
    await db.executeRun(
      `UPDATE data_rights_request SET ${setClauses.join(", ")} WHERE id = ?`,
      params
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_rights_request WHERE id = ? LIMIT 1",
      [id]
    );
    const rec = (rows as DataRightsRequest[])[0];
    if (!rec) throw new Error("Rights request not found");
    return rec;
  },

  // ─── Retention Policy ───────────────────────────────────────────────────────

  async listRetentionPolicies(): Promise<RetentionPolicy[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, entity_type, retention_days, action_on_expiry, legal_basis, is_active, created_at, updated_at
       FROM data_retention_policy ORDER BY entity_type ASC`
    );
    return rows as RetentionPolicy[];
  },

  async updateRetentionPolicy(
    entityType: string,
    update: { retention_days?: number; action_on_expiry?: string; legal_basis?: string; is_active?: number }
  ): Promise<RetentionPolicy> {
    const setClauses: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];

    if (update.retention_days !== undefined) { setClauses.push("retention_days = ?"); params.push(update.retention_days); }
    if (update.action_on_expiry !== undefined) { setClauses.push("action_on_expiry = ?"); params.push(update.action_on_expiry); }
    if (update.legal_basis !== undefined) { setClauses.push("legal_basis = ?"); params.push(update.legal_basis); }
    if (update.is_active !== undefined) { setClauses.push("is_active = ?"); params.push(update.is_active); }

    params.push(entityType);
    await db.executeRun(
      `UPDATE data_retention_policy SET ${setClauses.join(", ")} WHERE entity_type = ?`,
      params
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_retention_policy WHERE entity_type = ? LIMIT 1",
      [entityType]
    );
    const rec = (rows as RetentionPolicy[])[0];
    if (!rec) throw new Error("Retention policy not found for entity_type: " + entityType);
    return rec;
  },

  // ─── DPDP Config ────────────────────────────────────────────────────────────

  async listConfig(): Promise<DpdpConfigEntry[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT config_key, config_value, description, updated_at FROM dpdp_config ORDER BY config_key ASC"
    );
    return rows as DpdpConfigEntry[];
  },

  async updateConfig(key: string, value: string): Promise<DpdpConfigEntry> {
    await db.executeRun(
      `UPDATE dpdp_config SET config_value = ?, updated_at = NOW() WHERE config_key = ?`,
      [value, key]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM dpdp_config WHERE config_key = ? LIMIT 1",
      [key]
    );
    const rec = (rows as DpdpConfigEntry[])[0];
    if (!rec) throw new Error("Config key not found: " + key);
    return rec;
  },
};
