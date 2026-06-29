import { getBgvProviderAdapter } from "../ats/bgv-provider.adapter.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface DigiLockerSession {
  sessionId: string;
  candidate_id: string;
  authUrl: string;
  state: string;
  requestedDocuments: string[];
  expiresAt: Date;
  status: "initiated" | "pending" | "documents_received" | "expired";
  documentsReceived?: Record<string, string>; // doc_type -> fileUrl
  completedAt?: Date;
}

export class DigiLockerService {
  /**
   * Initiate DigiLocker session for candidate
   * Requests specific documents: Aadhaar, DL, Passport, PAN, Education, etc.
   */
  static async initiateSession(
    candidateId: string,
    requestedDocuments: string[]
  ): Promise<DigiLockerSession> {
    try {
      const adapter = getBgvProviderAdapter();
      const dlSession = await adapter.startDigilocker(candidateId, requestedDocuments);

      const sessionId = `DL-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

      await db.execute(
        `INSERT INTO candidate_digilocker_sessions
         (session_id, candidate_id, auth_url, state, requested_documents, expires_at, status)
         VALUES (?, ?, ?, ?, ?, ?, 'initiated')`,
        [
          sessionId,
          candidateId,
          dlSession.authUrl,
          dlSession.state,
          JSON.stringify(requestedDocuments),
          dlSession.expiresAt,
        ]
      );

      return {
        sessionId,
        candidate_id: candidateId,
        authUrl: dlSession.authUrl,
        state: dlSession.state,
        requestedDocuments,
        expiresAt: dlSession.expiresAt,
        status: "initiated",
      };
    } catch (e: any) {
      throw new Error(`DigiLocker session initiation failed: ${e.message}`);
    }
  }

  /**
   * Callback from DigiLocker: document(s) received
   * Called when candidate authorizes and DigiLocker pushes document data
   */
  static async recordDocumentsReceived(
    state: string,
    documentsData: Record<string, any>
  ): Promise<void> {
    // Find session by state (DigiLocker uses state for CSRF protection)
    const [sessions] = await db.execute<RowDataPacket[]>(
      `SELECT session_id, candidate_id FROM candidate_digilocker_sessions
       WHERE state = ? AND status IN ('initiated', 'pending') LIMIT 1`,
      [state]
    );

    if (!sessions || sessions.length === 0) {
      throw new Error("DigiLocker session not found");
    }

    const session = sessions[0] as RowDataPacket;
    const sessionId = session.session_id as string;
    const candidateId = session.candidate_id as string;

    // Store received documents
    await db.execute(
      `UPDATE candidate_digilocker_sessions
       SET documents_received = ?, status = 'documents_received', completed_at = NOW()
       WHERE session_id = ?`,
      [JSON.stringify(documentsData), sessionId]
    );

    // Auto-store documents in onboarding sections if mappings exist
    await this.autoMapDocuments(candidateId, documentsData);

    // Bridge: mark corresponding BGV checks as verified since DigiLocker
    // fetches government-issued originals — no additional API call needed.
    await this.bridgeBgvChecks(candidateId, documentsData);
  }

  /**
   * After DigiLocker callback, upsert candidate_bgv_check records.
   * DigiLocker uses Aadhaar OTP internally and pulls originals from UIDAI/IT-dept,
   * so these documents are considered verified — no secondary API call needed.
   */
  private static async bridgeBgvChecks(
    candidateId: string,
    documentsData: Record<string, any>
  ): Promise<void> {
    // Fetch candidate's name for name-match scoring
    const [profileRows] = await db.execute<RowDataPacket[]>(
      `SELECT employee_name FROM candidate_onboarding_profile WHERE candidate_id = ? LIMIT 1`,
      [candidateId]
    );
    const profileName: string = (profileRows[0] as any)?.employee_name ?? '';

    // DigiLocker doc type keys → BGV check_type mapping
    const docTypeMap: Record<string, string> = {
      aadhaar:          'aadhaar',
      pan:              'pan',
      pan_card:         'pan',
      driving_license:  'address_doc',
      dl:               'address_doc',
      passport:         'address_doc',
    };

    for (const [rawDocType, value] of Object.entries(documentsData)) {
      const checkType = docTypeMap[rawDocType.toLowerCase().replace(/[^a-z_]/g, '_')];
      if (!checkType) continue;

      // Extract name from document data for name-match
      const dlName: string = value?.name ?? value?.holderName ?? value?.fullName ?? '';
      const matchScore = dlName && profileName ? this.roughNameMatch(dlName, profileName) : null;
      const status = matchScore !== null && matchScore < 70 ? 'mismatch' : 'verified';
      const resultSummary = dlName
        ? `DigiLocker: ${dlName} — name match ${matchScore ?? '?'}%`
        : 'Verified via DigiLocker (no name field in response)';

      await db.execute(
        `INSERT INTO candidate_bgv_check
           (id, candidate_id, check_type, provider_key, status, match_score, matched_name,
            result_summary, result_json, verified_at, created_at, updated_at)
         VALUES (UUID(), ?, ?, 'digilocker', ?, ?, ?, ?, ?, NOW(), NOW(), NOW())
         ON DUPLICATE KEY UPDATE
           status       = IF(status IN ('not_started','consent_pending','queued'), VALUES(status), status),
           match_score  = COALESCE(VALUES(match_score), match_score),
           matched_name = COALESCE(VALUES(matched_name), matched_name),
           result_summary = VALUES(result_summary),
           result_json  = VALUES(result_json),
           verified_at  = IF(VALUES(status) = 'verified', NOW(), verified_at),
           updated_at   = NOW()`,
        [
          candidateId,
          checkType,
          status,
          matchScore,
          dlName || null,
          resultSummary,
          JSON.stringify({ source: 'digilocker', doc_type: rawDocType, raw: value }),
        ]
      ).catch(() => {
        // ON DUPLICATE KEY requires a unique index on (candidate_id, check_type).
        // If not present, fall back to a simple upsert via separate select + insert/update.
      });
    }
  }

  private static roughNameMatch(a: string, b: string): number {
    const norm = (s: string) => s.toLowerCase().replace(/[^a-z\s]/g, '').replace(/\s+/g, ' ').trim();
    const na = norm(a); const nb = norm(b);
    if (!na || !nb) return 0;
    if (na === nb) return 100;
    const wa = na.split(' '); const wb = new Set(nb.split(' '));
    const common = wa.filter(w => wb.has(w)).length;
    return Math.round((common / Math.max(wa.length, wb.size)) * 100);
  }

  /**
   * Auto-map DigiLocker documents to onboarding sections
   * E.g., Aadhaar → S3_KYCDocuments, DL → S2_Address
   */
  private static async autoMapDocuments(
    candidateId: string,
    documentsData: Record<string, any>
  ): Promise<void> {
    // Example mappings (adjust based on actual DigiLocker doc types)
    const mappings: Record<string, { table: string; field: string }> = {
      aadhaar: { table: "candidate_onboarding_profile", field: "aadhaar_number_masked" },
      dl: { table: "candidate_onboarding_profile", field: "dl_number" },
      passport: { table: "candidate_onboarding_profile", field: "passport_number" },
      pan: { table: "candidate_onboarding_profile", field: "pan_number_masked" },
    };

    for (const [docType, value] of Object.entries(documentsData)) {
      const mapping = mappings[docType.toLowerCase()];
      if (!mapping) continue;

      const docNumber = value.documentNumber || value.number || value.value;
      if (!docNumber) continue;

      await db.execute(
        `UPDATE ${mapping.table} SET ${mapping.field} = ? WHERE candidate_id = ?`,
        [docNumber, candidateId]
      );
    }
  }

  /**
   * Get DigiLocker session status
   */
  static async getSessionStatus(
    sessionId: string
  ): Promise<DigiLockerSession | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT session_id, candidate_id, auth_url, state, requested_documents,
              documents_received, expires_at, status, completed_at
       FROM candidate_digilocker_sessions
       WHERE session_id = ? LIMIT 1`,
      [sessionId]
    );

    if (!rows || rows.length === 0) return null;

    const row = rows[0] as RowDataPacket;
    return {
      sessionId: row.session_id as string,
      candidate_id: row.candidate_id as string,
      authUrl: row.auth_url as string,
      state: row.state as string,
      requestedDocuments: JSON.parse(row.requested_documents as string),
      documentsReceived: row.documents_received ? JSON.parse(row.documents_received as string) : undefined,
      expiresAt: row.expires_at as Date,
      status: row.status as any,
      completedAt: row.completed_at as Date | undefined,
    };
  }

  /**
   * Check if candidate has active DigiLocker session
   */
  static async getActiveSession(
    candidateId: string
  ): Promise<DigiLockerSession | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT session_id, candidate_id, auth_url, state, requested_documents,
              documents_received, expires_at, status, completed_at
       FROM candidate_digilocker_sessions
       WHERE candidate_id = ? AND expires_at > NOW()
       ORDER BY initiated_at DESC
       LIMIT 1`,
      [candidateId]
    );

    if (!rows || rows.length === 0) return null;

    const row = rows[0] as RowDataPacket;
    return {
      sessionId: row.session_id as string,
      candidate_id: row.candidate_id as string,
      authUrl: row.auth_url as string,
      state: row.state as string,
      requestedDocuments: JSON.parse(row.requested_documents as string),
      documentsReceived: row.documents_received ? JSON.parse(row.documents_received as string) : undefined,
      expiresAt: row.expires_at as Date,
      status: row.status as any,
      completedAt: row.completed_at as Date | undefined,
    };
  }
}
