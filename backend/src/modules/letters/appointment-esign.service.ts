import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import axios from "axios";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import { emailService } from "../communication/email.service.js";

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

/** Read active BGV provider from org_settings (Super Admin override) or fall back to env */
async function _activeProvider(): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT setting_value FROM org_settings WHERE setting_key = 'bgv_provider' LIMIT 1"
  );
  const dbProvider = (rows as RowDataPacket[])[0]?.setting_value as string | undefined;
  return dbProvider || env.BGV_PROVIDER || "mock";
}

/** Read a single org_settings key */
async function _orgSetting(key: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT setting_value FROM org_settings WHERE setting_key = ? LIMIT 1",
    [key]
  );
  return ((rows as RowDataPacket[])[0]?.setting_value as string | undefined) ?? null;
}

// ── eSign provider implementations ───────────────────────────────────────────

interface EsignInitResult {
  requestId: string;      // provider's own transaction/request ID
  esignUrl: string;       // URL sent to candidate (Aadhaar OTP signing page)
  providerKey: string;
}

/**
 * Call Digio's Aadhaar-based eSign API to create a signing request.
 * Docs: POST /v2/client/esign/create_request
 */
async function _initiateDigioEsign(
  signerName: string,
  signerEmail: string,
  signerMobile: string,
  pdfUrl: string,
  referenceId: string
): Promise<EsignInitResult> {
  const clientId = (await _orgSetting("digio_client_id")) ?? (env as any).DIGIO_CLIENT_ID ?? "";
  const clientSecret = (await _orgSetting("digio_client_secret")) ?? (env as any).DIGIO_CLIENT_SECRET ?? "";
  const apiUrl = (await _orgSetting("digio_api_url")) ?? (env as any).DIGIO_API_URL ?? "https://api.digio.in";

  if (!clientId || !clientSecret) throw new Error("Digio Client ID and Secret not configured in BGV settings.");

  const auth = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const payload = {
    reference_id: referenceId,
    send_sign_link: true,
    signers: [
      {
        identifier: signerEmail,
        name: signerName,
        phone: signerMobile,
        sign_type: "aadhaar",         // Aadhaar OTP-based eSign
        reason: "Appointment Letter Signing",
      },
    ],
    display_on_page: "all",
    expire_in_days: 7,
  };

  const res = await axios.post(`${apiUrl}/v2/client/esign/create_request`, payload, {
    headers: { Authorization: `Basic ${auth}`, "Content-Type": "application/json" },
    timeout: 15_000,
  });

  const data = res.data;
  if (!data?.id) throw new Error(`Digio eSign initiation failed: ${JSON.stringify(data)}`);

  // Digio returns the signing URL inside signer details
  const signerInfo = data.signing_parties?.[0] ?? {};
  const esignUrl: string = signerInfo.sign_link ?? `${apiUrl}/esign/${data.id}`;

  return { requestId: data.id as string, esignUrl, providerKey: "digio" };
}

/**
 * Call Infinity AI's signing API to create an Aadhaar eSign request.
 * Uses their candidate portal flow for document signing.
 */
async function _initiateInfinityEsign(
  signerName: string,
  signerEmail: string,
  signerMobile: string,
  pdfUrl: string,
  referenceId: string
): Promise<EsignInitResult> {
  const apiKey = (await _orgSetting("infinity_ai_api_key")) ?? (env as any).INFINITY_AI_API_KEY ?? "";
  const apiUrl = (await _orgSetting("infinity_ai_api_url")) ?? (env as any).INFINITY_AI_API_URL ?? "https://api.infinityai.in";
  const clientId = (await _orgSetting("infinity_ai_client_id")) ?? (env as any).INFINITY_AI_CLIENT_ID ?? "";

  if (!apiKey) throw new Error("Infinity AI API Key not configured in BGV settings.");

  const payload = {
    reference_id: referenceId,
    document_url: pdfUrl,
    signer: { name: signerName, email: signerEmail, mobile: signerMobile },
    sign_type: "aadhaar_otp",
    validity_days: 7,
    client_id: clientId || undefined,
  };

  const res = await axios.post(`${apiUrl}/v1/esign/create`, payload, {
    headers: { "x-api-key": apiKey, "Content-Type": "application/json" },
    timeout: 15_000,
  });

  const data = res.data;
  if (!data?.request_id) throw new Error(`Infinity AI eSign initiation failed: ${JSON.stringify(data)}`);

  const esignUrl: string = data.sign_url ?? data.esign_url ?? `${apiUrl}/esign/${data.request_id}`;
  return { requestId: data.request_id as string, esignUrl, providerKey: "infinity_ai" };
}

/**
 * Mock eSign — returns a local sign page URL. Used when BGV_PROVIDER=mock or Befisc
 * (Befisc handles Aadhaar OTP auth but not document signing; fall back to Digio for signing
 * or use mock in development).
 */
function _initiateMockEsign(
  requestId: string,
  signerName: string
): EsignInitResult {
  const esignUrl = `/sign/appointment/${requestId}?signer=${encodeURIComponent(signerName)}`;
  return { requestId: `mock-${randomUUID()}`, esignUrl, providerKey: "mock" };
}

/** Send eSign link to candidate via email */
async function _sendEsignEmail(
  signerName: string,
  signerEmail: string,
  esignUrl: string,
  providerKey: string
): Promise<void> {
  if (!emailService.isConfigured()) {
    console.warn("[eSign] SMTP not configured — skipping eSign email notification.");
    return;
  }
  const isAbsolute = esignUrl.startsWith("http");
  const fullUrl = isAbsolute ? esignUrl : `https://mcnhrms.teammas.in${esignUrl}`;
  const providerLabel = providerKey === "digio" ? "Digio (Aadhaar OTP)" : providerKey === "infinity_ai" ? "Infinity AI (Aadhaar OTP)" : "HRMS Sign Page";

  await emailService.send({
    to: signerEmail,
    subject: "Action Required: Sign Your Appointment Letter",
    html: `
      <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;padding:20px">
        <div style="background:#2563EB;padding:20px;border-radius:8px 8px 0 0">
          <h2 style="color:white;margin:0">MAS Callnet — Appointment Letter</h2>
        </div>
        <div style="border:1px solid #e2e8f0;border-top:none;border-radius:0 0 8px 8px;padding:24px">
          <p>Dear <strong>${signerName}</strong>,</p>
          <p>Your appointment letter is ready for signing. Please sign it digitally using your <strong>Aadhaar-linked OTP</strong>.</p>
          <p style="margin:24px 0">
            <a href="${fullUrl}"
               style="background:#2563EB;color:white;padding:12px 28px;text-decoration:none;border-radius:6px;font-weight:600;display:inline-block">
              Sign Appointment Letter →
            </a>
          </p>
          <p style="font-size:13px;color:#64748b">
            Powered by <strong>${providerLabel}</strong>. This link expires in <strong>7 days</strong>.
            If you have questions, contact your HR team.
          </p>
          <hr style="border:none;border-top:1px solid #e2e8f0;margin:16px 0"/>
          <p style="font-size:12px;color:#94a3b8">
            MAS Callnet PeopleOS &nbsp;|&nbsp; This is an automated message. Do not reply.
          </p>
        </div>
      </div>`,
    text: `Dear ${signerName},\n\nPlease sign your appointment letter at:\n${fullUrl}\n\nThis link expires in 7 days.\n\n— MAS Callnet HR`,
  });
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
   * Initiate real Aadhaar-based eSign via the active BGV provider.
   * Looks up candidate contact details from DB, calls provider API,
   * stores transaction ID, and sends email to candidate.
   *
   * Falls back to manual sign page if provider is mock or Befisc
   * (Befisc handles Aadhaar OTP auth but not document signing).
   */
  async initiateCandidateEsign(
    requestId: string,
    pdfUrl?: string
  ): Promise<{ requestId: string; esignUrl: string; providerKey: string }> {
    const prev = await _getState(requestId);
    if (!prev) throw Object.assign(new Error("Request not found"), { statusCode: 404 });

    // Fetch candidate contact info
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT alr.candidate_id, alr.employee_id,
              COALESCE(e.name, c.full_name, op.employee_name) AS signer_name,
              COALESCE(e.official_email, e.personal_email, c.email, op.personal_email_id) AS signer_email,
              COALESCE(e.mobile, c.mobile, op.mobile_number) AS signer_mobile
         FROM appointment_letter_request alr
         LEFT JOIN ats_candidate c ON c.id = alr.candidate_id
         LEFT JOIN candidate_onboarding_profile op ON op.candidate_id = alr.candidate_id
         LEFT JOIN employees e ON e.id = alr.employee_id
        WHERE alr.id = ? LIMIT 1`,
      [requestId]
    );
    const row = (rows as RowDataPacket[])[0];
    if (!row) throw Object.assign(new Error("Request not found"), { statusCode: 404 });

    const signerName: string = (row.signer_name as string) ?? "Candidate";
    const signerEmail: string = row.signer_email as string;
    const signerMobile: string = row.signer_mobile as string;

    if (!signerEmail) throw new Error("Candidate email not found — cannot send eSign link.");
    if (!signerMobile) throw new Error("Candidate mobile not found — Aadhaar OTP requires a registered mobile.");

    const provider = await _activeProvider();
    const effectivePdfUrl = pdfUrl ?? `/api/letters/appointment/${requestId}/pdf`;

    let esignResult: EsignInitResult;

    if (provider === "digio") {
      esignResult = await _initiateDigioEsign(signerName, signerEmail, signerMobile, effectivePdfUrl, requestId);
    } else if (provider === "infinity_ai") {
      esignResult = await _initiateInfinityEsign(signerName, signerEmail, signerMobile, effectivePdfUrl, requestId);
    } else {
      // mock or befisc_luckpay — use local sign page
      esignResult = _initiateMockEsign(requestId, signerName);
    }

    await db.execute(
      `UPDATE appointment_letter_request
          SET current_state          = 'candidate_esign_pending',
              candidate_esign_url    = ?,
              candidate_esign_status = 'pending',
              esign_transaction_id   = ?,
              esign_request_id       = ?,
              esign_signer_name      = ?,
              esign_signer_email     = ?,
              esign_signer_mobile    = ?,
              esign_initiated_at     = NOW(),
              esign_provider_used    = ?
        WHERE id = ?`,
      [
        esignResult.esignUrl,
        esignResult.requestId,
        esignResult.requestId,
        signerName,
        signerEmail,
        signerMobile,
        esignResult.providerKey,
        requestId,
      ]
    );

    await _auditLog(
      requestId,
      "CANDIDATE_ESIGN_INITIATE",
      prev,
      "candidate_esign_pending",
      null,
      `Provider: ${esignResult.providerKey}, TxnId: ${esignResult.requestId}`
    );

    // Send email notification with sign link
    await _sendEsignEmail(signerName, signerEmail, esignResult.esignUrl, esignResult.providerKey).catch((e) => {
      console.warn("[eSign] Email notification failed:", e.message);
    });

    return { requestId: esignResult.requestId, esignUrl: esignResult.esignUrl, providerKey: esignResult.providerKey };
  },

  /**
   * Handle provider webhook callback confirming candidate signed.
   * Called by /api/letters/appointment/esign-webhook (no auth, HMAC-validated).
   */
  async handleEsignWebhook(
    providerRequestId: string,
    status: "signed" | "failed" | "expired",
    rawPayload: Record<string, unknown>
  ): Promise<void> {
    // Find the letter request by provider transaction ID
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, current_state FROM appointment_letter_request
        WHERE esign_request_id = ? OR esign_transaction_id = ?
        LIMIT 1`,
      [providerRequestId, providerRequestId]
    );
    const req = (rows as RowDataPacket[])[0];
    if (!req) {
      console.warn(`[eSign webhook] No appointment_letter_request found for provider ID: ${providerRequestId}`);
      return;
    }

    const letterRequestId = req.id as string;
    const prev = req.current_state as string;

    if (status === "signed") {
      await db.execute(
        `UPDATE appointment_letter_request
            SET current_state          = 'candidate_signed',
                candidate_esign_status = 'signed',
                candidate_esign_at     = NOW()
          WHERE id = ?`,
        [letterRequestId]
      );
      await _auditLog(letterRequestId, "CANDIDATE_ESIGN_COMPLETE", prev, "candidate_signed", "webhook",
        `Signed via provider webhook. Payload keys: ${Object.keys(rawPayload).join(", ")}`);
    } else {
      await db.execute(
        `UPDATE appointment_letter_request
            SET candidate_esign_status = ?
          WHERE id = ?`,
        [status, letterRequestId]
      );
      await _auditLog(letterRequestId, `CANDIDATE_ESIGN_${status.toUpperCase()}`, prev, prev, "webhook",
        `Provider returned status: ${status}`);
    }
  },

  /**
   * Record completion of candidate e-sign (manual/HR override path).
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
    await _auditLog(requestId, "CANDIDATE_ESIGN_COMPLETE", prev, "candidate_signed", signedBy, "Manual completion by HR");
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
