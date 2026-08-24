import { randomUUID, randomBytes } from "crypto";
import { createHash } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { sendSMS } from "../communication/sms.helper.js";
import { emailService } from "../communication/email.service.js";

const FRONTEND_URL = process.env.FRONTEND_URL ?? "https://mcnhrms.teammas.in";
const PENNY_DROP_TOKEN_TTL_HOURS = 48;

/**
 * A pending row for this employee + request_type, if one already exists.
 *
 * profile_update_approval's only unique key is its own `id` PK — a fresh
 * randomUUID() on every submit call. The INSERT below is followed by
 * `ON DUPLICATE KEY UPDATE`, which was clearly meant to replace an existing
 * pending request in place (the UI tells the employee exactly that: "New
 * requests will replace the pending one"), but a fresh id can never collide
 * with anything, so that clause could never actually fire — conflicting
 * pending requests for the same employee stacked up unbounded. Reusing the
 * existing pending row's id when one exists makes the ON DUPLICATE clause
 * do real work.
 */
async function findPendingApprovalId(employeeId: string, requestType: string): Promise<string | null> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM profile_update_approval
     WHERE employee_id = ? AND request_type = ? AND status = 'pending'
     LIMIT 1`,
    [employeeId, requestType]
  );
  return (rows[0] as any)?.id ?? null;
}

/** Fetch emails of all active payroll/payroll_hr/payroll_head users. */
async function getPayrollEmails(): Promise<string[]> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT DISTINCT au.email
     FROM user_roles ur
     JOIN auth_user au ON au.id = ur.user_id
     WHERE ur.role_key IN ('payroll', 'payroll_hr', 'payroll_head')
       AND ur.active_status = 1
       AND au.email IS NOT NULL
       AND au.email != ''`
  );
  return (rows as any[]).map((r) => String(r.email)).filter(Boolean);
}

function buildPennyDropEmailHtml(opts: {
  employeeName: string;
  employeeCode: string;
  bankName: string;
  ifscCode: string;
  accountType: string;
  maskedAccount: string;
  verifyUrl: string;
  expiresAt: string;
}): string {
  return `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="font-family:Arial,sans-serif;background:#f4f6fb;margin:0;padding:24px">
  <div style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:12px;padding:32px;border:1px solid #e2e8f0">
    <div style="text-align:center;margin-bottom:24px">
      <div style="background:#073f78;color:#fff;display:inline-block;padding:10px 20px;border-radius:8px;font-size:13px;font-weight:700;letter-spacing:0.5px">
        MAS Callnet HRMS
      </div>
    </div>
    <h2 style="color:#073f78;font-size:17px;margin:0 0 6px">Bank Account Change Request</h2>
    <p style="color:#64748b;font-size:13px;margin:0 0 20px">
      An employee has submitted a bank account update request that requires penny drop verification.
    </p>
    <table style="width:100%;border-collapse:collapse;font-size:13px;margin-bottom:20px">
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;border:1px solid #e2e8f0;font-weight:600">Employee</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;font-weight:700;color:#0f172a">${opts.employeeName} (${opts.employeeCode})</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#64748b;border:1px solid #e2e8f0;font-weight:600">Bank</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0">${opts.bankName}</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;border:1px solid #e2e8f0;font-weight:600">IFSC</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;font-family:monospace">${opts.ifscCode}</td>
      </tr>
      <tr>
        <td style="padding:8px 12px;color:#64748b;border:1px solid #e2e8f0;font-weight:600">Account (masked)</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0;font-family:monospace">${opts.maskedAccount}</td>
      </tr>
      <tr style="background:#f8fafc">
        <td style="padding:8px 12px;color:#64748b;border:1px solid #e2e8f0;font-weight:600">Type</td>
        <td style="padding:8px 12px;border:1px solid #e2e8f0">${opts.accountType}</td>
      </tr>
    </table>
    <p style="color:#475569;font-size:13px;margin-bottom:20px">
      Click the button below to run a live penny drop verification. The system will fetch the
      account holder's name from the bank and compare it against the employee's registered name
      to verify ownership and prevent fraud.
    </p>
    <div style="text-align:center;margin-bottom:24px">
      <a href="${opts.verifyUrl}"
         style="display:inline-block;background:#073f78;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:8px;font-weight:700;font-size:14px;letter-spacing:0.3px">
        Verify via Penny Drop
      </a>
    </div>
    <p style="color:#94a3b8;font-size:11px;text-align:center;margin:0">
      This link expires in ${PENNY_DROP_TOKEN_TTL_HOURS} hours (${opts.expiresAt} IST).<br>
      Do not share this link. Verification must be completed before approval.
    </p>
  </div>
</body>
</html>`;
}

export const profileApprovalService = {
  async submitBankDetailsForApproval(
    userId: string,
    employeeId: string,
    newValues: Record<string, any>,
    oldValues?: Record<string, any>
  ) {
    const [existing] = await db.execute<RowDataPacket[]>(
      `SELECT id, old_values FROM profile_update_approval
       WHERE employee_id = ? AND request_type = 'bank_details' AND status = 'pending'
       LIMIT 1`,
      [employeeId]
    );
    const existingPendingId = (existing[0] as any)?.id ?? null;

    const oldVals = oldValues || (existing[0] as any)?.old_values || {};

    // Fetch employee details for email and name-match snapshot
    const [empRow] = await db.execute<RowDataPacket[]>(
      `SELECT full_name, employee_code, mobile FROM employees WHERE id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRow[0] as any) ?? {};
    const employeeName: string = emp.full_name ?? '';
    const employeeCode: string = emp.employee_code ?? '';
    const employeeMobile: string | null = emp.mobile ?? null;

    // Generate a secure one-time verification token for Payroll Branch
    const verificationToken = randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + PENNY_DROP_TOKEN_TTL_HOURS * 60 * 60 * 1000);

    const pennyDropId = randomUUID();
    const acctRaw = String(newValues.account_number ?? newValues.accountNumber ?? '').replace(/\s/g, '');
    const acctHash = acctRaw
      ? createHash('sha256').update(acctRaw.toUpperCase()).digest('hex')
      : 'unknown';

    await db.execute(
      `INSERT INTO bank_penny_drop_log
         (id, employee_id, account_number_hash, ifsc_code, penny_drop_status,
          verification_token, verification_token_expires_at, employee_name_at_request)
       VALUES (?, ?, ?, ?, 'initiated', ?, ?, ?)`,
      [
        pennyDropId,
        employeeId,
        acctHash,
        newValues.ifsc_code ?? newValues.ifscCode ?? '',
        verificationToken,
        expiresAt,
        employeeName,
      ]
    );

    const id = existingPendingId ?? randomUUID();
    await db.execute(
      `INSERT INTO profile_update_approval
         (id, employee_id, request_type, old_values, new_values, status, requested_by_role,
          penny_drop_log_id, routed_to_role, reviewed_by)
       VALUES (?, ?, 'bank_details', ?, ?, 'pending', 'employee', ?, 'payroll', NULL)
       ON DUPLICATE KEY UPDATE
         new_values = VALUES(new_values), penny_drop_log_id = VALUES(penny_drop_log_id),
         routed_to_role = 'payroll', requested_at = NOW()`,
      [id, employeeId, JSON.stringify(oldVals), JSON.stringify(newValues), pennyDropId]
    );

    await logSensitiveAction({
      actor_user_id: userId,
      action_type: "BANK_DETAILS_APPROVAL_REQUESTED",
      module_key: "EMPLOYEE_PROFILE",
      entity_type: "profile_update_approval",
      entity_id: id,
      change_summary: { fields: Object.keys(newValues), routed_to: 'payroll' },
    });

    // SMS to employee (fire-and-forget)
    if (employeeMobile) {
      sendSMS(employeeMobile, 'bank_update_submitted', { name: employeeName }).catch(() => {});
    }

    // Email to all Payroll Branch users with the penny drop verification link
    const verifyUrl = `${FRONTEND_URL}/payroll/bank-verify/${verificationToken}`;
    const expiresAtStr = expiresAt.toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', hour12: false });
    const maskedAccount = acctRaw ? `****${acctRaw.slice(-4)}` : '****';

    const payrollEmails = await getPayrollEmails().catch(() => [] as string[]);
    if (payrollEmails.length > 0) {
      emailService.send({
        to: payrollEmails.join(', '),
        subject: `[Action Required] Bank Change Verification — ${employeeName} (${employeeCode})`,
        html: buildPennyDropEmailHtml({
          employeeName,
          employeeCode,
          bankName: newValues.bank_name ?? newValues.bankName ?? '—',
          ifscCode: (newValues.ifsc_code ?? newValues.ifscCode ?? '').toUpperCase(),
          accountType: newValues.account_type ?? newValues.accountType ?? 'savings',
          maskedAccount,
          verifyUrl,
          expiresAt: expiresAtStr,
        }),
        text: `Bank Account Change Request\n\nEmployee: ${employeeName} (${employeeCode})\nBank: ${newValues.bank_name ?? '—'}\nIFSC: ${newValues.ifsc_code ?? '—'}\n\nVerify via penny drop: ${verifyUrl}\n\nThis link expires in ${PENNY_DROP_TOKEN_TTL_HOURS} hours.`,
      }).catch((err) => {
        console.error('[bank-change] penny drop email failed:', err instanceof Error ? err.message : String(err));
      });
    }

    return { id, status: "pending", routed_to: "payroll" };
  },

  // getPendingBankDetailsApprovals / approveBankDetailsUpdate used to live here. Removed:
  // their only caller was profile-approval.routes.ts, which was never mounted in app.ts —
  // confirmed via profile-trust-audit (2026-08-13) and re-verified unreferenced anywhere
  // before deletion. The live bank-approval review path is
  // PATCH /api/payroll/bank-change-requests/:id (payroll-window.routes.ts), fixed
  // separately to persist account_number_enc, compute account_seq correctly and write
  // this same audit trail — see that file for the reviewer that actually runs.
};

export async function submitStatutoryDetailsForApproval(
  userId: string,
  employeeId: string,
  newValues: Record<string, unknown>
): Promise<{ id: string; message: string }> {
  // Same fix as submitBankDetailsForApproval above: reuse an existing pending
  // request's id so ON DUPLICATE KEY UPDATE actually replaces it, instead of
  // stacking a fresh conflicting request every time this is called.
  const existingPendingId = await findPendingApprovalId(employeeId, 'statutory_details');
  const id = existingPendingId ?? randomUUID();

  // Read current values before insert, same read-before-write pattern as
  // PUT /me/emergency-contact (employee.routes.ts) — old_values was previously
  // hardcoded to the literal string '{}', so the review UI's before/after
  // comparison never had anything to show. Only plaintext PAN/Aadhaar are
  // captured here, never ciphertext — useless in a JSON diff anyway.
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT pan_number, uan_number, epf_number, esic_number, aadhaar_number, aadhaar_last4
       FROM employees WHERE id = ? LIMIT 1`,
    [employeeId]
  );
  const [statRows] = await db.execute<RowDataPacket[]>(
    `SELECT epf_number, esi_number, uan_number, pan_number, aadhaar_id, pf_eligible, esi_eligible, epf_date
       FROM employee_statutory_info WHERE employee_id = ? LIMIT 1`,
    [employeeId]
  );
  const oldValues = { employees: empRows[0] ?? null, employee_statutory_info: statRows[0] ?? null };

  await db.execute(
    `INSERT INTO profile_update_approval
       (id, employee_id, request_type, old_values, new_values, status,
        requested_by_role, routed_to_role, reviewed_by)
     VALUES (?, ?, 'statutory_details', ?, ?, 'pending', 'employee', 'hr', NULL)
     ON DUPLICATE KEY UPDATE
       new_values = VALUES(new_values),
       old_values = VALUES(old_values),
       routed_to_role = 'hr',
       requested_at = NOW()`,
    [id, employeeId, JSON.stringify(oldValues), JSON.stringify(newValues)]
  );

  await logSensitiveAction({
    actor_user_id: userId,
    action_type: 'STATUTORY_DETAILS_APPROVAL_REQUESTED',
    module_key: 'EMPLOYEE_PROFILE',
    entity_type: 'profile_update_approval',
    entity_id: id,
    change_summary: { fields: Object.keys(newValues), routed_to: 'hr' },
  });

  return { id, message: 'Statutory details submitted for HR approval' };
}