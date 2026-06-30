import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// Safe allowlist for correction execution — maps field_name → table + column
const CORRECTION_ALLOWLIST: Record<string, { table: string; column: string }> = {
  "first_name":              { table: "employees", column: "first_name" },
  "last_name":               { table: "employees", column: "last_name" },
  "personal_email":          { table: "employees", column: "personal_email" },
  "mobile":                  { table: "employees", column: "mobile" },
  "alternate_mobile":        { table: "employees", column: "alternate_mobile" },
  "address_line1":           { table: "employees", column: "address_line1" },
  "address_line2":           { table: "employees", column: "address_line2" },
  "city":                    { table: "employees", column: "city" },
  "state":                   { table: "employees", column: "state" },
  "pincode":                 { table: "employees", column: "pincode" },
  "emergency_contact_name":  { table: "employee_emergency_contact", column: "name" },
  "emergency_contact_mobile":{ table: "employee_emergency_contact", column: "mobile" },
  "emergency_contact_address":{ table: "employee_emergency_contact", column: "address" },
};

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
      `SELECT * FROM data_consent WHERE data_principal_id = ? ORDER BY consented_at DESC`,
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
      `SELECT * FROM data_consent ${where} ORDER BY consented_at DESC LIMIT 500`,
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
    consentTextVersion: string;
    consentTextHash: string;
    channel: DataConsent["channel"];
    ipAddress?: string;
  }): Promise<DataConsent> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_consent
         (id, data_principal_id, principal_type, purpose_code, consent_text_version,
          consent_text_hash, channel, ip_address)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.principalId,
        input.principalType,
        input.purposeCode,
        input.consentTextVersion,
        input.consentTextHash,
        input.channel,
        input.ipAddress ?? null,
      ]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_consent WHERE id = ? LIMIT 1",
      [id]
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
      `SELECT * FROM data_rights_request WHERE principal_id = ? ORDER BY created_at DESC`,
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
      `SELECT * FROM data_rights_request ${where} ORDER BY created_at DESC LIMIT 500`,
      params
    );
    return rows as DataRightsRequest[];
  },

  async createAccessRequest(principalId: string): Promise<{
    request: DataRightsRequest;
    personalDataSummary: Record<string, string>;
  }> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_rights_request
         (id, principal_id, principal_type, request_type, description, status)
       VALUES (?, ?, 'employee', 'access', 'Data access export request', 'pending')`,
      [id, principalId]
    );

    // Return a summary of field categories stored for this principal
    const personalDataSummary: Record<string, string> = {
      identity: "Name, DOB, gender, national ID, Aadhaar/PAN (masked)",
      contact: "Phone, email, address",
      employment: "Employee code, designation, department, joining date, employment type",
      payroll: "Salary structure, bank account (masked), PF/ESIC numbers",
      attendance: "Attendance sessions, leave records",
      documents: "Uploaded documents (contract, certificates)",
      consent: "Consent records and versions",
    };

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_rights_request WHERE id = ? LIMIT 1",
      [id]
    );
    return { request: (rows as DataRightsRequest[])[0], personalDataSummary };
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
    // Fetch the request first so we can execute corrections when resolving
    const [existing] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_rights_request WHERE id = ? LIMIT 1",
      [id]
    );
    const req = (existing as RowDataPacket[])[0];
    if (!req) throw new Error("Rights request not found");

    // DPDP §12 — execute correction when resolving a correction request
    if (update.status === "resolved" && req.request_type === "correction" && req.field_name && req.requested_value) {
      const mapping = CORRECTION_ALLOWLIST[req.field_name as string];
      if (!mapping) {
        throw Object.assign(
          new Error(`Correction field '${req.field_name}' is not in the approved allowlist and cannot be auto-executed. Update manually and resolve.`),
          { statusCode: 422 }
        );
      }
      // employee_emergency_contact joins on employee_id (principal_id maps to auth_user.id → employees.user_id)
      if (mapping.table === "employee_emergency_contact") {
        await db.executeRun(
          `UPDATE ${mapping.table} SET ${mapping.column} = ?
            WHERE employee_id = (SELECT id FROM employees WHERE user_id = ? LIMIT 1)`,
          [req.requested_value, req.principal_id]
        );
      } else {
        await db.executeRun(
          `UPDATE ${mapping.table} SET ${mapping.column} = ? WHERE user_id = ?`,
          [req.requested_value, req.principal_id]
        );
      }
      // Audit the correction execution — matches actual dpdp_withdrawal_audit_log schema
      await db.execute(
        `INSERT INTO dpdp_withdrawal_audit_log
           (id, withdrawal_id, action, performed_by, from_status, to_status, remarks)
         VALUES (?, ?, 'correction_executed', 'system', ?, ?, ?)`,
        [
          randomUUID(),
          id,
          String(req.current_value ?? ""),
          String(req.requested_value),
          `Field: ${req.field_name}, Table: ${mapping.table}`,
        ]
      ).catch(() => { /* audit table may not exist in all envs — non-fatal */ });
    }

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
      "SELECT * FROM data_retention_policy ORDER BY entity_type ASC"
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
      "SELECT * FROM dpdp_config ORDER BY config_key ASC"
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

  // ─── Grievance Officer (public) ─────────────────────────────────────────────

  async getGrievanceOfficer(): Promise<{
    name: string; email: string; designation: string; sla_days: number;
  }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT config_key, config_value FROM dpdp_config
        WHERE config_key IN ('grievance_officer_name','grievance_officer_email','grievance_officer_designation','grievance_response_sla_days')`,
    );
    const map: Record<string, string> = {};
    for (const r of rows as RowDataPacket[]) map[r.config_key as string] = r.config_value as string;
    return {
      name:        map["grievance_officer_name"] ?? "",
      email:       map["grievance_officer_email"] ?? "",
      designation: map["grievance_officer_designation"] ?? "HR Compliance",
      sla_days:    parseInt(map["grievance_response_sla_days"] ?? "30", 10),
    };
  },

  // ─── Nominee Registry ────────────────────────────────────────────────────────

  async nominateAgent(principalId: string, input: {
    nominee_name: string;
    nominee_email: string;
    nominee_mobile?: string;
    nominee_relationship?: string;
    effective_from: string;
  }): Promise<{ id: string }> {
    // Revoke any existing active nomination
    await db.executeRun(
      `UPDATE dpdp_nominee_registry SET is_active = 0, revoked_at = NOW(), revoked_by = ?
        WHERE principal_id = ? AND is_active = 1`,
      [principalId, principalId]
    );
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO dpdp_nominee_registry
         (id, principal_id, principal_type, nominee_name, nominee_email, nominee_mobile, nominee_relationship, is_active, effective_from)
       VALUES (?, ?, 'employee', ?, ?, ?, ?, 1, ?)`,
      [id, principalId, input.nominee_name, input.nominee_email, input.nominee_mobile ?? null, input.nominee_relationship ?? null, input.effective_from]
    );
    // Create audit trail via data_rights_request
    const reqId = randomUUID();
    await db.executeRun(
      `INSERT INTO data_rights_request
         (id, principal_id, principal_type, request_type, description, status)
       VALUES (?, ?, 'employee', 'nomination', ?, 'resolved')`,
      [reqId, principalId, `Nominated ${input.nominee_name} <${input.nominee_email}> as DPDP representative, effective ${input.effective_from}`]
    );
    return { id };
  },

  async getMyNominee(principalId: string): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM dpdp_nominee_registry WHERE principal_id = ? AND is_active = 1 ORDER BY created_at DESC LIMIT 1`,
      [principalId]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async revokeNomination(principalId: string): Promise<void> {
    await db.executeRun(
      `UPDATE dpdp_nominee_registry SET is_active = 0, revoked_at = NOW(), revoked_by = ?
        WHERE principal_id = ? AND is_active = 1`,
      [principalId, principalId]
    );
  },

  // ─── Data Processor Registry ─────────────────────────────────────────────────

  async listProcessors(): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM data_processor_registry ORDER BY is_active DESC, processor_name ASC"
    );
    return rows as RowDataPacket[];
  },

  async createProcessor(input: {
    processor_name: string;
    processor_type: string;
    data_categories_json: unknown;
    processing_purpose: string;
    data_location: string;
    dpa_signed?: number;
    dpa_signed_date?: string | null;
    dpa_document_url?: string | null;
    contact_email?: string | null;
    notes?: string | null;
  }): Promise<{ id: string }> {
    const id = randomUUID();
    await db.executeRun(
      `INSERT INTO data_processor_registry
         (id, processor_name, processor_type, data_categories_json, processing_purpose, data_location,
          dpa_signed, dpa_signed_date, dpa_document_url, contact_email, notes)
       VALUES (?, ?, ?, CAST(? AS JSON), ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        input.processor_name,
        input.processor_type,
        JSON.stringify(input.data_categories_json),
        input.processing_purpose,
        input.data_location,
        input.dpa_signed ?? 0,
        input.dpa_signed_date ?? null,
        input.dpa_document_url ?? null,
        input.contact_email ?? null,
        input.notes ?? null,
      ]
    );
    return { id };
  },

  async updateProcessor(id: string, input: Partial<{
    processor_name: string;
    processor_type: string;
    data_categories_json: unknown;
    processing_purpose: string;
    data_location: string;
    dpa_signed: number;
    dpa_signed_date: string | null;
    dpa_document_url: string | null;
    contact_email: string | null;
    is_active: number;
    notes: string | null;
  }>): Promise<void> {
    const sets: string[] = ["updated_at = NOW()"];
    const params: unknown[] = [];
    if (input.processor_name !== undefined) { sets.push("processor_name = ?"); params.push(input.processor_name); }
    if (input.processor_type !== undefined) { sets.push("processor_type = ?"); params.push(input.processor_type); }
    if (input.data_categories_json !== undefined) { sets.push("data_categories_json = CAST(? AS JSON)"); params.push(JSON.stringify(input.data_categories_json)); }
    if (input.processing_purpose !== undefined) { sets.push("processing_purpose = ?"); params.push(input.processing_purpose); }
    if (input.data_location !== undefined) { sets.push("data_location = ?"); params.push(input.data_location); }
    if (input.dpa_signed !== undefined) { sets.push("dpa_signed = ?"); params.push(input.dpa_signed); }
    if (input.dpa_signed_date !== undefined) { sets.push("dpa_signed_date = ?"); params.push(input.dpa_signed_date); }
    if (input.dpa_document_url !== undefined) { sets.push("dpa_document_url = ?"); params.push(input.dpa_document_url); }
    if (input.contact_email !== undefined) { sets.push("contact_email = ?"); params.push(input.contact_email); }
    if (input.is_active !== undefined) { sets.push("is_active = ?"); params.push(input.is_active); }
    if (input.notes !== undefined) { sets.push("notes = ?"); params.push(input.notes); }
    params.push(id);
    await db.executeRun(`UPDATE data_processor_registry SET ${sets.join(", ")} WHERE id = ?`, params);
  },

  // ─── Recruitment Consent (token-based, for candidate onboarding Step 1) ──────

  async recordRecruitmentConsent(candidateId: string, ip?: string): Promise<void> {
    const id = randomUUID();
    // Get active recruitment consent version
    const [vrows] = await db.execute<RowDataPacket[]>(
      `SELECT version_code, text_hash FROM consent_text_version
        WHERE purpose_code = 'recruitment' AND status = 'active'
        ORDER BY activated_at DESC LIMIT 1`
    );
    const version = (vrows as RowDataPacket[])[0];
    const vCode = (version?.version_code as string) ?? "v1.0";
    const vHash = (version?.text_hash as string) ?? "no-active-version";

    await db.executeRun(
      `INSERT INTO data_consent
         (id, data_principal_id, principal_type, purpose_code, consent_text_version, consent_text_hash, channel, ip_address)
       VALUES (?, ?, 'candidate', 'recruitment', ?, ?, 'web', ?)
       ON DUPLICATE KEY UPDATE consent_text_version = VALUES(consent_text_version), consent_text_hash = VALUES(consent_text_hash)`,
      [id, candidateId, vCode, vHash, ip ?? null]
    );
  },
};
