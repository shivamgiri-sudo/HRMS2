import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

// ── helpers ───────────────────────────────────────────────────────────────────

async function _auditLog(
  letterRequestId: string,
  action: string,
  fromState: string | null,
  toState: string | null,
  performedBy: string | null,
  remarks?: string
): Promise<void> {
  await db.execute(
    `INSERT INTO appointment_letter_audit
       (id, letter_request_id, action, from_state, to_state, performed_by, remarks, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
    [randomUUID(), letterRequestId, action, fromState ?? null, toState ?? null, performedBy ?? null, remarks ?? null]
  );
}

async function _getState(requestId: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT current_state FROM appointment_letter_request WHERE id = ? LIMIT 1",
    [requestId]
  );
  const row = (rows as RowDataPacket[])[0];
  return row ? (row.current_state as string) : null;
}

// ── service ───────────────────────────────────────────────────────────────────

export const appointmentEsignService = {

  /**
   * Create a new appointment letter request for a candidate.
   */
  async createRequest(candidateId: string, createdBy: string): Promise<string> {
    const id = randomUUID();
    await db.execute(
      `INSERT INTO appointment_letter_request
         (id, candidate_id, created_by, current_state, esign_provider,
          candidate_esign_status, company_sign_status,
          pdf_locked, manual_override_approved, created_at)
       VALUES (?, ?, ?, 'draft', 'manual', 'pending', 'pending', 0, 0, NOW())`,
      [id, candidateId, createdBy]
    );
    await _auditLog(id, "CREATE", null, "draft", createdBy, "Request created");
    return id;
  },

  /**
   * Mark letter as generated (after PDF build step).
   */
  async generateLetter(
    requestId: string,
    templateData: Record<string, unknown>,
    generatedBy: string
  ): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state = 'generated',
              generated_at  = NOW(),
              generated_by  = ?,
              template_data = ?
        WHERE id = ?`,
      [generatedBy, JSON.stringify(templateData), requestId]
    );
    await _auditLog(requestId, "GENERATE", prev, "generated", generatedBy);
  },

  /**
   * Initiate candidate e-sign step (mock — no real provider).
   * Returns a mock sign page URL.
   */
  async initiateCandidateEsign(requestId: string): Promise<{ requestId: string; esignUrl: string }> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    const esignUrl = `/api/letters/appointment/${requestId}/candidate-sign-page`;
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state        = 'candidate_esign_pending',
              candidate_esign_url  = ?,
              candidate_esign_status = 'pending'
        WHERE id = ?`,
      [esignUrl, requestId]
    );
    await _auditLog(requestId, "CANDIDATE_ESIGN_INITIATE", prev, "candidate_esign_pending", null);
    return { requestId, esignUrl };
  },

  /**
   * Record completion of candidate e-sign.
   */
  async completeCandidateEsign(requestId: string, signedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state          = 'candidate_signed',
              candidate_esign_status = 'signed',
              candidate_esign_at     = NOW()
        WHERE id = ?`,
      [requestId]
    );
    await _auditLog(requestId, "CANDIDATE_ESIGN_COMPLETE", prev, "candidate_signed", signedBy);
  },

  /**
   * Move to company sign pending.
   */
  async initiateCompanySign(requestId: string, initiatedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state = 'company_sign_pending'
        WHERE id = ?`,
      [requestId]
    );
    await _auditLog(requestId, "COMPANY_SIGN_INITIATE", prev, "company_sign_pending", initiatedBy);
  },

  /**
   * Complete company sign step.
   */
  async completeCompanySign(requestId: string, signedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state       = 'company_signed',
              company_sign_status = 'signed',
              company_sign_at     = NOW(),
              company_signed_by   = ?
        WHERE id = ?`,
      [signedBy, requestId]
    );
    await _auditLog(requestId, "COMPANY_SIGN_COMPLETE", prev, "company_signed", signedBy);
  },

  /**
   * Finalize letter: lock PDF, insert vault row, mark completed.
   */
  async finalizeLetter(requestId: string, finalizedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });

    // Fetch candidate_id for vault row
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT candidate_id FROM appointment_letter_request WHERE id = ? LIMIT 1",
      [requestId]
    );
    const req = (rows as RowDataPacket[])[0];
    if (!req) throw Object.assign(new Error("Request not found"), { statusCode: 404 });

    const vaultPath = `/vault/appointment-letters/${requestId}/signed_appointment_letter.pdf`;

    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state = 'completed',
              pdf_locked    = 1,
              pdf_locked_at = NOW(),
              vault_path    = ?
        WHERE id = ?`,
      [vaultPath, requestId]
    );

    // Insert into employee_document_vault
    const vaultId = randomUUID();
    await db.execute(
      `INSERT INTO employee_document_vault
         (id, candidate_id, document_type, document_name, file_path,
          is_locked, locked_at, locked_by, source_module, source_entity_id, uploaded_at, uploaded_by)
       VALUES (?, ?, 'APPOINTMENT_LETTER', 'Signed Appointment Letter', ?,
               1, NOW(), ?, 'letters', ?, NOW(), ?)`,
      [vaultId, req.candidate_id ?? null, vaultPath, finalizedBy, requestId, finalizedBy]
    );

    await _auditLog(requestId, "FINALIZE", prev, "completed", finalizedBy, `Vault row: ${vaultId}`);
  },

  /**
   * Request manual override (candidate cannot/will not e-sign digitally).
   */
  async requestManualOverride(requestId: string, reason: string, requestedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state          = 'override_requested',
              manual_override_reason = ?
        WHERE id = ?`,
      [reason, requestId]
    );
    await _auditLog(requestId, "OVERRIDE_REQUEST", prev, "override_requested", requestedBy, reason);
  },

  /**
   * Approve manual override — skip candidate e-sign, move to company sign pending.
   */
  async approveManualOverride(requestId: string, approvedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state              = 'company_sign_pending',
              manual_override_approved   = 1,
              manual_override_by         = ?,
              manual_override_at         = NOW(),
              candidate_esign_status     = 'override'
        WHERE id = ?`,
      [approvedBy, requestId]
    );
    await _auditLog(requestId, "OVERRIDE_APPROVE", prev, "company_sign_pending", approvedBy, "Manual override approved; skipping candidate e-sign");
  },

  /**
   * Reject manual override — revert to candidate_esign_pending.
   */
  async rejectManualOverride(requestId: string, reason: string, rejectedBy: string): Promise<void> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });
    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state          = 'candidate_esign_pending',
              manual_override_reason = NULL
        WHERE id = ?`,
      [requestId]
    );
    await _auditLog(requestId, "OVERRIDE_REJECT", prev, "candidate_esign_pending", rejectedBy, reason);
  },

  /**
   * Fetch full request row.
   */
  async getRequest(requestId: string): Promise<RowDataPacket | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM appointment_letter_request WHERE id = ? LIMIT 1",
      [requestId]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  /**
   * Fetch full audit trail for a request.
   */
  async getAuditTrail(requestId: string): Promise<RowDataPacket[]> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM appointment_letter_audit
        WHERE letter_request_id = ?
        ORDER BY created_at ASC`,
      [requestId]
    );
    return rows as RowDataPacket[];
  },
};
