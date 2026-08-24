/**
 * Token-authenticated penny drop verification for employee bank changes.
 *
 * Flow:
 *   1. Employee submits bank change → profile-approval.service.ts generates a secure
 *      token, stores it in bank_penny_drop_log, and emails Payroll Branch.
 *   2. Payroll Branch clicks the link → frontend loads /payroll/bank-verify/:token
 *      which calls GET /api/payroll/bank-penny-drop/:token to show employee + bank details.
 *   3. Payroll Branch clicks "Run Penny Drop" →
 *      POST /api/payroll/bank-penny-drop/:token/execute
 *      → calls Luckpay, runs classifyNameMatch(), stores result.
 *   4. Result is surfaced in the Payroll HO approval queue alongside the approve/reject decision.
 *
 * Auth model: token replaces session auth for this narrow read+execute path — Payroll
 * Branch can click the email link without logging in. The token is single-use: once
 * penny drop executes (success, failed, or name_mismatch) the token is nulled out and
 * cannot be re-used.
 */

import { Router, type Request, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { classifyNameMatch } from "../ats/indian-name-match.js";
import { resolveLuckpayConfig } from "../integrations/luckpay/luckpay.config.js";
import { luckpayPostJson } from "../integrations/luckpay/luckpay.transport.js";
import { compactProviderReference } from "../ats/luckpay-reference.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const bankPennyDropVerifyRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response) => fn(req, res).catch((err: unknown) => {
    console.error('[bank-penny-drop-verify]', err);
    res.status(500).json({ success: false, message: 'Internal error' });
  });

// ── GET /api/payroll/bank-penny-drop/:token ───────────────────────────────────
// Returns employee + bank detail summary for the verification page.
// No session auth required — the token itself is the credential.
bankPennyDropVerifyRouter.get('/:token', h(async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length !== 64) {
    return res.status(400).json({ success: false, message: 'Invalid token' });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT bpdl.id AS penny_drop_id,
            bpdl.penny_drop_status,
            bpdl.employee_name_at_request,
            bpdl.ifsc_code,
            bpdl.beneficiary_name_returned,
            bpdl.name_match_tier,
            bpdl.name_match_score,
            bpdl.verification_token_expires_at,
            pua.id AS approval_id,
            pua.new_values,
            e.employee_code,
            e.full_name
     FROM bank_penny_drop_log bpdl
     JOIN profile_update_approval pua ON pua.penny_drop_log_id = bpdl.id
     JOIN employees e ON e.id = bpdl.employee_id
     WHERE bpdl.verification_token = ?
       AND pua.status = 'pending'
     LIMIT 1`,
    [token]
  );

  if (!rows.length) {
    return res.status(404).json({
      success: false,
      message: 'Verification link is invalid, already used, or the request has been resolved.',
    });
  }

  const row = rows[0] as any;

  // Check expiry
  if (row.verification_token_expires_at && new Date(row.verification_token_expires_at) < new Date()) {
    return res.status(410).json({
      success: false,
      message: 'This verification link has expired. Ask the employee to resubmit the request.',
    });
  }

  const newVals = typeof row.new_values === 'string' ? JSON.parse(row.new_values) : (row.new_values ?? {});
  const accountRaw: string = String(newVals.account_number ?? '');
  const maskedAccount = accountRaw ? `****${accountRaw.slice(-4)}` : '****';

  return res.json({
    success: true,
    data: {
      approval_id: row.approval_id,
      penny_drop_id: row.penny_drop_id,
      penny_drop_status: row.penny_drop_status,
      employee_name: row.full_name ?? row.employee_name_at_request,
      employee_code: row.employee_code,
      bank_name: newVals.bank_name ?? null,
      ifsc_code: row.ifsc_code,
      account_type: newVals.account_type ?? 'savings',
      account_holder_name: newVals.account_holder_name ?? null,
      masked_account: maskedAccount,
      // Show results if already verified
      beneficiary_name_returned: row.beneficiary_name_returned ?? null,
      name_match_tier: row.name_match_tier ?? null,
      name_match_score: row.name_match_score ?? null,
    },
  });
}));

// ── POST /api/payroll/bank-penny-drop/:token/execute ─────────────────────────
// Triggers Luckpay penny drop, runs name match, stores result. Single-use.
bankPennyDropVerifyRouter.post('/:token/execute', h(async (req: Request, res: Response) => {
  const { token } = req.params;
  if (!token || token.length !== 64) {
    return res.status(400).json({ success: false, message: 'Invalid token' });
  }

  // Re-fetch with a FOR UPDATE to prevent double-execution races
  const conn = await db.getConnection();
  try {
    await conn.beginTransaction();

    const [rows] = await conn.execute<RowDataPacket[]>(
      `SELECT bpdl.id AS penny_drop_id,
              bpdl.penny_drop_status,
              bpdl.employee_id,
              bpdl.employee_name_at_request,
              bpdl.ifsc_code,
              bpdl.verification_token_expires_at,
              pua.id AS approval_id,
              pua.new_values
       FROM bank_penny_drop_log bpdl
       JOIN profile_update_approval pua ON pua.penny_drop_log_id = bpdl.id
       WHERE bpdl.verification_token = ?
         AND pua.status = 'pending'
       LIMIT 1
       FOR UPDATE`,
      [token]
    );

    if (!rows.length) {
      await conn.rollback();
      return res.status(404).json({
        success: false,
        message: 'Verification link is invalid, already used, or the request has been resolved.',
      });
    }

    const row = rows[0] as any;

    if (row.verification_token_expires_at && new Date(row.verification_token_expires_at) < new Date()) {
      await conn.rollback();
      return res.status(410).json({ success: false, message: 'Verification link has expired.' });
    }

    // Only 'initiated' can be executed — prevents re-run
    if (row.penny_drop_status !== 'initiated') {
      await conn.rollback();
      return res.status(409).json({
        success: false,
        message: `Penny drop already ${row.penny_drop_status}. Check the approval queue for results.`,
      });
    }

    const newVals = typeof row.new_values === 'string' ? JSON.parse(row.new_values) : (row.new_values ?? {});
    const accountNumber: string = String(newVals.account_number ?? '').replace(/\s/g, '');
    const ifscCode: string = String(row.ifsc_code ?? newVals.ifsc_code ?? '').trim().toUpperCase();
    const accountHolderName: string = String(newVals.account_holder_name ?? '').trim();
    const employeeName: string = String(row.employee_name_at_request ?? '').trim();

    if (!accountNumber || !ifscCode) {
      await conn.rollback();
      return res.status(400).json({ success: false, message: 'Account number or IFSC missing from original request.' });
    }

    // Null the token immediately — one-use regardless of outcome
    await conn.execute(
      `UPDATE bank_penny_drop_log SET verification_token = NULL WHERE id = ?`,
      [row.penny_drop_id]
    );

    let finalStatus: 'success' | 'failed' | 'name_mismatch' = 'failed';
    let beneficiaryName: string | null = null;
    let nameMatchTier: string | null = null;
    let nameMatchScore: number | null = null;
    let providerRef: string | null = null;
    let providerResponseJson: unknown = null;

    try {
      const cfg = await resolveLuckpayConfig('core');
      const requestId = compactProviderReference('PD');
      const response = await luckpayPostJson(cfg, '/verifyPennyDrop', {
        clientTransactionId: requestId,
        customerAccountNumber: accountNumber,
        customerAccountName: accountHolderName || employeeName,
        customerIfscCode: ifscCode,
        verificationMode: 'PENNY_DROP',
      });

      providerRef = requestId;
      // response.data is the provider's data node; response.envelope is the raw wrapper
      const d = response.data as Record<string, unknown>;
      providerResponseJson = response.sanitized;

      const details = (d['details'] && typeof d['details'] === 'object' ? d['details'] : {}) as Record<string, unknown>;
      const apiStatus = String(d['status'] ?? d['result'] ?? '').toLowerCase();
      const detailsVerified = Boolean(details['verified'] ?? details['status']);
      beneficiaryName = String(
        details['beneficiaryNameWithBank'] ??
        details['beneficiaryName'] ??
        d['registered_name'] ?? d['account_holder_name'] ?? d['name'] ?? ''
      ).trim() || null;

      const providerVerified = detailsVerified || ['valid', 'verified', 'success', 'active'].includes(apiStatus);

      if (providerVerified && beneficiaryName) {
        // Compare bank's returned name against employee's registered name
        const matchResult = classifyNameMatch(employeeName, beneficiaryName);
        nameMatchTier = matchResult.tier;
        nameMatchScore = matchResult.score;

        // 'none' or 'unknown' tier = name mismatch; 'weak' and above = pass
        finalStatus = (matchResult.tier === 'none' || matchResult.tier === 'unknown' || matchResult.suspicious)
          ? 'name_mismatch'
          : 'success';
      } else {
        finalStatus = 'failed';
      }
    } catch (luckpayErr) {
      console.error('[bank-penny-drop-verify] Luckpay call failed:', luckpayErr instanceof Error ? luckpayErr.message : luckpayErr);
      finalStatus = 'failed';
    }

    await conn.execute(
      `UPDATE bank_penny_drop_log
          SET penny_drop_status = ?,
              beneficiary_name_returned = ?,
              name_match_tier = ?,
              name_match_score = ?,
              penny_drop_ref = ?,
              settled_at = NOW(),
              provider_response_json = ?
        WHERE id = ?`,
      [
        finalStatus,
        beneficiaryName,
        nameMatchTier,
        nameMatchScore,
        providerRef,
        providerResponseJson ? JSON.stringify(providerResponseJson) : null,
        row.penny_drop_id,
      ]
    );

    await logSensitiveAction({
      actor_user_id: null as any,
      action_type: 'BANK_PENNY_DROP_EXECUTED',
      module_key: 'PAYROLL',
      entity_type: 'bank_penny_drop_log',
      entity_id: row.penny_drop_id,
      employee_id: row.employee_id,
      change_summary: {
        status: finalStatus,
        name_match_tier: nameMatchTier,
        name_match_score: nameMatchScore,
        beneficiary_name: beneficiaryName ? `****${beneficiaryName.slice(-4)}` : null,
      },
    });

    await conn.commit();

    return res.json({
      success: true,
      data: {
        penny_drop_status: finalStatus,
        name_match_tier: nameMatchTier,
        name_match_score: nameMatchScore,
        beneficiary_name_returned: beneficiaryName,
        employee_name: employeeName,
        message: finalStatus === 'success'
          ? 'Penny drop verified. Name matches employee record. You may now approve in the Payroll queue.'
          : finalStatus === 'name_mismatch'
          ? `Name mismatch detected. Bank returned "${beneficiaryName}" but employee is "${employeeName}". Flag for review before approving.`
          : 'Penny drop could not be completed. Please retry or approve manually with a note.',
      },
    });
  } catch (err) {
    await conn.rollback();
    throw err;
  } finally {
    conn.release();
  }
}));