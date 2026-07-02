import { createHash, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import type { RowDataPacket } from "mysql2/promise";
import { db } from "../../db/mysql.js";
import { emailService } from "../communication/email.service.js";
import { sendOtpSms } from "./sms.helper.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export type TwoFactorChannel = "email" | "sms";

function otpCode(): string {
  return String(randomInt(100000, 1000000));
}

function hashRecipient(value: string): string {
  return createHash("sha256").update(value.trim().toLowerCase()).digest("hex");
}

async function getRecipient(userId: string, channel: TwoFactorChannel): Promise<string> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT au.email AS auth_email,
            e.personal_email,
            e.email AS employee_email,
            e.mobile,
            e.personal_phone
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id
      WHERE au.id = ? AND au.is_blocked = 0
      LIMIT 1`,
    [userId],
  );
  const row = rows[0];
  if (!row) throw Object.assign(new Error("User account not found"), { statusCode: 404 });
  const value = channel === "email"
    ? String(row.personal_email ?? row.employee_email ?? row.auth_email ?? "").trim()
    : String(row.personal_phone ?? row.mobile ?? "").trim();
  if (!value) throw Object.assign(new Error(`No ${channel} recipient is available for this account`), { statusCode: 400 });
  return value;
}

export async function sendTwoFactorChallenge(userId: string, channel: TwoFactorChannel): Promise<void> {
  const recipient = await getRecipient(userId, channel);
  const code = otpCode();
  const otpHash = await bcrypt.hash(code, 10);
  const recipientHash = hashRecipient(recipient);

  await db.execute(
    `UPDATE auth_two_factor_challenge
        SET status = 'expired', updated_at = NOW()
      WHERE user_id = ? AND status = 'pending'`,
    [userId],
  );

  await db.execute(
    `INSERT INTO auth_two_factor_challenge
       (id, user_id, channel, recipient_hash, otp_hash, expires_at, status)
     VALUES (UUID(), ?, ?, ?, ?, DATE_ADD(NOW(), INTERVAL 10 MINUTE), 'pending')`,
    [userId, channel, recipientHash, otpHash],
  );

  if (channel === "email") {
    if (!emailService.isConfigured()) {
      throw Object.assign(new Error("Email delivery is not configured"), { statusCode: 503 });
    }
    await emailService.send({
      to: recipient,
      subject: "Your HRMS verification code",
      html: `<p>Your HRMS verification code is <strong>${code}</strong>.</p><p>This code is valid for 10 minutes.</p>`,
      text: `Your HRMS verification code is ${code}. This code is valid for 10 minutes.`,
    });
  } else {
    const sent = await sendOtpSms(recipient, code);
    if (!sent) throw Object.assign(new Error("SMS delivery failed"), { statusCode: 502 });
  }

  await logSensitiveAction({
    actor_user_id: userId,
    action_type: "auth_2fa_challenge_sent",
    module_key: "auth",
    entity_type: "auth_two_factor_challenge",
    entity_id: userId,
    change_summary: {
      channel,
      recipient_hash: recipientHash,
      expires_in_minutes: 10,
    },
  });
}

export async function verifyTwoFactorChallenge(userId: string, otp: string): Promise<void> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, otp_hash, attempts, max_attempts, expires_at
       FROM auth_two_factor_challenge
      WHERE user_id = ? AND status = 'pending'
      ORDER BY created_at DESC
      LIMIT 1`,
    [userId],
  );
  const challenge = rows[0];
  if (!challenge) throw Object.assign(new Error("No active verification challenge"), { statusCode: 400 });
  if (new Date(challenge.expires_at as string).getTime() < Date.now()) {
    await db.execute(`UPDATE auth_two_factor_challenge SET status = 'expired', updated_at = NOW() WHERE id = ?`, [challenge.id]);
    throw Object.assign(new Error("Verification code expired"), { statusCode: 400 });
  }
  if (Number(challenge.attempts ?? 0) >= Number(challenge.max_attempts ?? 5)) {
    await db.execute(`UPDATE auth_two_factor_challenge SET status = 'locked', updated_at = NOW() WHERE id = ?`, [challenge.id]);
    throw Object.assign(new Error("Verification attempts exceeded"), { statusCode: 429 });
  }

  const valid = await bcrypt.compare(String(otp), String(challenge.otp_hash));
  if (!valid) {
    await db.execute(
      `UPDATE auth_two_factor_challenge SET attempts = attempts + 1, updated_at = NOW() WHERE id = ?`,
      [challenge.id],
    );
    throw Object.assign(new Error("Invalid verification code"), { statusCode: 400 });
  }

  await db.execute(
    `UPDATE auth_two_factor_challenge
        SET status = 'verified', verified_at = NOW(), updated_at = NOW()
      WHERE id = ?`,
    [challenge.id],
  );

  await logSensitiveAction({
    actor_user_id: userId,
    action_type: "auth_2fa_verified",
    module_key: "auth",
    entity_type: "auth_two_factor_challenge",
    entity_id: String(challenge.id),
    change_summary: { verified: true },
  });
}
