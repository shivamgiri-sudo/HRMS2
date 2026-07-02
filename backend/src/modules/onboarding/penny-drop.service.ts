import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export interface PennyDropInitiation {
  requestId: string;
  accountNo: string;
  ifscCode: string;
  accountHolderName: string;
  amount: number; // typically ₹1
  transactionId?: string;
  initiatedAt: Date;
}

export interface PennyDropResult {
  requestId: string;
  transactionId: string;
  status: "success" | "pending" | "failed" | "reversed";
  accountName?: string;
  verificationCode?: string;
  responseCode: string;
  message: string;
  verifiedAt?: Date;
  reversedAt?: Date;
}

export class PennyDropService {
  /**
   * Store penny drop request in DB
   * Returns request ID for tracking
   */
  static async initiatePennyDrop(
    candidateId: string,
    accountNo: string,
    ifscCode: string,
    accountHolderName: string
  ): Promise<PennyDropInitiation> {
    const requestId = `PD-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

    await db.execute(
      `INSERT INTO onboarding_penny_drop_requests
       (candidate_id, request_id, account_no, ifsc_code, account_holder_name, status, initiated_at)
       VALUES (?, ?, ?, ?, ?, 'initiated', NOW())`,
      [candidateId, requestId, accountNo, ifscCode, accountHolderName]
    );

    return {
      requestId,
      accountNo,
      ifscCode,
      accountHolderName,
      amount: 1,
      initiatedAt: new Date(),
    };
  }

  /**
   * Record penny drop result (called by Integration Hub webhook)
   * Verifies account name if provided
   */
  static async recordPennyDropResult(
    requestId: string,
    result: {
      transactionId: string;
      status: "success" | "pending" | "failed" | "reversed";
      accountName?: string;
      verificationCode?: string;
      responseCode: string;
      message: string;
    }
  ): Promise<PennyDropResult> {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT candidate_id, account_holder_name FROM onboarding_penny_drop_requests
       WHERE request_id = ? LIMIT 1`,
      [requestId]
    );

    if (!existing || !Array.isArray(existing) || existing.length === 0) {
      throw new Error(`Penny drop request ${requestId} not found`);
    }

    const row = existing[0];
    const candidateId = row.candidate_id as string;
    const accountHolderName = row.account_holder_name as string;

    // Check name match if account name returned
    let nameMatchScore = 100;
    if (result.accountName) {
      nameMatchScore = this.calculateNameMatch(
        accountHolderName,
        result.accountName
      );
    }

    const finalStatus =
      result.status === "success" && nameMatchScore < 60 ? "name_mismatch" : result.status;

    await db.execute(
      `UPDATE onboarding_penny_drop_requests
       SET transaction_id = ?, status = ?, account_name = ?,
           verification_code = ?, response_code = ?, message = ?,
           name_match_score = ?, completed_at = NOW()
       WHERE request_id = ?`,
      [
        result.transactionId,
        finalStatus,
        result.accountName || null,
        result.verificationCode || null,
        result.responseCode,
        result.message,
        nameMatchScore,
        requestId,
      ]
    );

    // If name mismatch, flag for manual review
    if (finalStatus === "name_mismatch") {
      await this.flagForPayrollReview(candidateId, "penny_drop_name_mismatch");
    }

    return {
      requestId,
      transactionId: result.transactionId,
      status: finalStatus as "success" | "pending" | "failed" | "reversed" | any,
      accountName: result.accountName,
      verificationCode: result.verificationCode,
      responseCode: result.responseCode,
      message: result.message,
      verifiedAt: finalStatus === "success" ? new Date() : undefined,
    };
  }

  /**
   * Get penny drop status for candidate
   */
  static async getPennyDropStatus(
    candidateId: string
  ): Promise<PennyDropResult | null> {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT request_id, transaction_id, status, account_name,
              verification_code, response_code, message, name_match_score, completed_at
       FROM onboarding_penny_drop_requests
       WHERE candidate_id = ?
       ORDER BY initiated_at DESC
       LIMIT 1`,
      [candidateId]
    );

    if (!rows || rows.length === 0) return null;

    const row = rows[0];
    return {
      requestId: row.request_id as string,
      transactionId: row.transaction_id as string,
      status: row.status as any,
      accountName: row.account_name as string | undefined,
      verificationCode: row.verification_code as string | undefined,
      responseCode: row.response_code as string,
      message: row.message as string,
      verifiedAt: row.completed_at as Date | undefined,
    };
  }

  /**
   * Simple name match: normalize and compare
   * Returns 0-100 score
   */
  private static calculateNameMatch(name1: string, name2: string): number {
    const norm1 = name1.trim().toLowerCase().replace(/[^a-z\s]/g, "");
    const norm2 = name2.trim().toLowerCase().replace(/[^a-z\s]/g, "");

    if (norm1 === norm2) return 100;

    const words1 = new Set(norm1.split(/\s+/).filter(Boolean));
    const words2 = new Set(norm2.split(/\s+/).filter(Boolean));

    if (words1.size === 0 || words2.size === 0) return 0;

    const common = [...words1].filter((w) => words2.has(w)).length;
    const union = new Set([...words1, ...words2]).size;

    return Math.round((common / union) * 100);
  }

  /**
   * Flag candidate for Payroll HQ manual review
   */
  private static async flagForPayrollReview(
    candidateId: string,
    flagReason: string
  ): Promise<void> {
    await db.execute(
      `INSERT INTO candidate_payroll_review_flags
       (candidate_id, flag_reason, flagged_at, status)
       VALUES (?, ?, NOW(), 'pending')
       ON DUPLICATE KEY UPDATE
       flag_reason = ?, updated_at = NOW()`,
      [candidateId, flagReason, flagReason]
    );
  }
}
