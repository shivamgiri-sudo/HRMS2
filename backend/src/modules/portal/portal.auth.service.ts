import { randomUUID, randomInt } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { PortalTokenPayload, ClientUser } from "./portal.types.js";

/** Format Date as MySQL DATETIME in local timezone (not UTC). */
function toMySQLDatetime(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const portalAuthService = {
  async purgeExpiredOtps(): Promise<void> {
    try {
      await db.execute("DELETE FROM portal_otp WHERE expires_at < NOW() OR used = 1");
    } catch {
      // purge failure must never break auth flows
    }
  },

  generateOtp(): string {
    return randomInt(100000, 1000000).toString();
  },

  /*
   * Every token now carries a jti and gets a row in portal_user_sessions, so an individual
   * session can be revoked without deactivating the account.
   *
   * The session INSERT is awaited before the token is returned. A failure propagates to the
   * caller so a valid token is never issued without a matching session record.
   */
  async issueToken(payload: Omit<PortalTokenPayload, "role" | "jti">): Promise<string> {
    const jti = randomUUID();
    // impersonatedBy passes straight through into the signed payload when the caller
    // supplied one (portal-admin.routes.ts's /impersonate) -- undefined otherwise, so a
    // real client login's token never carries this key at all, not even as a false-y value.
    const sessionLifetimeMs = payload.impersonatedBy ? 2 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000;
    const token = jwt.sign(
      { ...payload, role: "client", jti },
      env.PORTAL_JWT_SECRET,
      { expiresIn: payload.impersonatedBy ? "2h" : "7d" }
    );

    // Must match the JWT's own expiresIn above -- an impersonation session recorded with
    // the real client's 7-day expiry would outlive the 2h token it actually belongs to in
    // portal_user_sessions (harmless on its own since the JWT itself still expires at 2h,
    // but it would misreport how long this session window was really open for).
    const expiresAt = new Date(Date.now() + sessionLifetimeMs);
    await db.execute(
      `INSERT INTO portal_user_sessions (id, client_user_id, jti, expires_at)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), payload.clientUserId, jti, toMySQLDatetime(expiresAt)]
    );

    return token;
  },

  /**
   * Ends one session. Returns false when the jti is unknown, so a caller can tell "revoked" from
   * "no such session" rather than reporting success for a token that was never tracked.
   */
  async revokeSession(jti: string): Promise<boolean> {
    const [result] = await db.execute(
      "UPDATE portal_user_sessions SET revoked_at = NOW() WHERE jti = ? AND revoked_at IS NULL",
      [jti]
    );
    return (result as { affectedRows?: number }).affectedRows ? true : false;
  },

  /** Ends every live session for a client user - the per-user equivalent of a password reset. */
  async revokeAllSessionsForUser(clientUserId: string): Promise<number> {
    const [result] = await db.execute(
      "UPDATE portal_user_sessions SET revoked_at = NOW() WHERE client_user_id = ? AND revoked_at IS NULL",
      [clientUserId]
    );
    return (result as { affectedRows?: number }).affectedRows ?? 0;
  },

  verifyToken(token: string): PortalTokenPayload {
    return jwt.verify(token, env.PORTAL_JWT_SECRET) as PortalTokenPayload;
  },

  async requestOtp(email: string): Promise<void> {
    await portalAuthService.purgeExpiredOtps();
    // Demo bypass only when explicitly enabled in non-production
    if (email === "demo@mascallnet.com" && portalAuthService.isDemoBypassEnabled()) return;
    if (email === "demo@mascallnet.com" && !portalAuthService.isDemoBypassEnabled()) {
      throw new Error("Demo bypass not available in this environment");
    }
    const [users] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    );
    if ((users as RowDataPacket[]).length === 0) return; // silent — don't reveal if email exists

    // Rate limit: max 3 OTPs per email per 15 minutes
    const [recent] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM portal_otp WHERE email = ? AND created_at > DATE_SUB(NOW(), INTERVAL 15 MINUTE)",
      [email]
    );
    if ((recent as RowDataPacket[])[0].cnt >= 3) throw new Error("Too many OTP requests. Try again in 15 minutes.");

    const otp = portalAuthService.generateOtp();
    const hash = await bcrypt.hash(otp, 10);
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

    await db.execute(
      "INSERT INTO portal_otp (id, email, otp_hash, expires_at) VALUES (?, ?, ?, ?)",
      [randomUUID(), email, hash, toMySQLDatetime(expiresAt)]
    );

    try {
      await portalAuthService.sendOtpEmail(email, otp);
    } catch (err) {
      console.error("Failed to send OTP email:", err);
      throw Object.assign(new Error("OTP email delivery failed"), { code: "DELIVERY_FAILED" });
    }
  },

  /**
   * Returns true only when PORTAL_DEMO_BYPASS=true is explicitly set.
   * Production default is false — never issues a token without OTP.
   */
  isDemoBypassEnabled(): boolean {
    return env.PORTAL_DEMO_BYPASS === "true" && env.NODE_ENV !== "production";
  },

  async verifyOtp(email: string, otp: string): Promise<string> {
    await portalAuthService.purgeExpiredOtps();
    // Demo bypass gated by isDemoBypassEnabled — never allowed in production
    if (email === "demo@mascallnet.com") {
      if (!portalAuthService.isDemoBypassEnabled()) {
        throw new Error("Invalid or expired OTP");
      }
      return portalAuthService.issueToken({
        clientUserId: "u-demo-1",
        clientId: "c-demo-1",
        processIds: ["p-demo-1"],
      });
    }

    // Master password bypass removed. Use POST /api/portal/admin/impersonate instead.

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, otp_hash FROM portal_otp
       WHERE email = ? AND used = 0 AND expires_at > NOW()
       ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    const record = (rows as RowDataPacket[])[0];
    if (!record) throw new Error("Invalid or expired OTP");

    const valid = await bcrypt.compare(otp, record.otp_hash);
    if (!valid) throw new Error("Invalid or expired OTP");

    await db.execute("UPDATE portal_otp SET used = 1 WHERE id = ?", [record.id]);

    const [userRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, process_ids FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
      [email]
    );
    const user = (userRows as RowDataPacket[])[0];
    if (!user || !user.id || !user.client_id || !user.process_ids) throw new Error("User not found");

    let processIds: string[];
    try {
      processIds = typeof user.process_ids === "string"
        ? JSON.parse(user.process_ids)
        : (user.process_ids as string[]);
    } catch {
      throw new Error("Invalid process_ids data");
    }

    return portalAuthService.issueToken({
      clientUserId: user.id,
      clientId: user.client_id,
      processIds,
    });
  },

  /**
   * Password-based login (login_id + password), the alternative the client portal offers
   * alongside email OTP above. Deliberately mirrors verifyOtp's shape (same issueToken call,
   * same "not found" behaviour), but keyed on login_id/password_hash instead of email/otp_hash.
   *
   * Returns mustChangePassword alongside the token so the frontend can route straight to a
   * forced change-password screen on first login, without needing a second round trip.
   */
  async loginWithPassword(loginId: string, password: string): Promise<{ token: string; mustChangePassword: boolean }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, client_id, process_ids, password_hash, must_change_password FROM client_user WHERE login_id = ? AND is_active = 1 LIMIT 1",
      [loginId]
    );
    const user = (rows as RowDataPacket[])[0];
    // Same message whether the login_id doesn't exist or the password is wrong -- this
    // must not tell an attacker which half of the pair was incorrect.
    if (!user || !user.password_hash) throw new Error("Invalid login ID or password");

    const valid = await bcrypt.compare(password, user.password_hash);
    if (!valid) throw new Error("Invalid login ID or password");

    let processIds: string[];
    try {
      processIds = typeof user.process_ids === "string" ? JSON.parse(user.process_ids) : (user.process_ids as string[]);
    } catch {
      throw new Error("Invalid process_ids data");
    }

    const token = await portalAuthService.issueToken({
      clientUserId: user.id,
      clientId: user.client_id,
      processIds,
    });

    return { token, mustChangePassword: Number(user.must_change_password) === 1 };
  },

  /**
   * Self-service password change. Mirrors auth.service.ts's changePassword exactly (verify
   * current password at cost 10, hash new one at cost 12, clear must_change_password) --
   * same cost-factor distinction that file's own header comment documents: system-generated
   * passwords hash at 10, a user's deliberate choice hashes at 12.
   */
  async changePassword(clientUserId: string, currentPassword: string, newPassword: string): Promise<void> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT password_hash FROM client_user WHERE id = ? LIMIT 1",
      [clientUserId]
    );
    const user = (rows as RowDataPacket[])[0];
    if (!user || !user.password_hash) throw new Error("Account not found");

    const valid = await bcrypt.compare(currentPassword, user.password_hash);
    if (!valid) throw new Error("Current password is incorrect");

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.execute(
      "UPDATE client_user SET password_hash = ?, must_change_password = 0 WHERE id = ?",
      [newHash, clientUserId]
    );
    // Revoke every other live session -- a password change should not leave an old,
    // possibly-compromised session usable elsewhere. Mirrors
    // auth.service.ts's invalidateSessionsAfterPasswordChange for staff accounts.
    await portalAuthService.revokeAllSessionsForUser(clientUserId);
  },

  async sendOtpEmail(to: string, otp: string): Promise<void> {
    if (!env.SMTP_USER) return; // skip in local dev if SMTP not configured
    const transport = nodemailer.createTransport({
      host: env.SMTP_HOST,
      port: env.SMTP_PORT,
      auth: { user: env.SMTP_USER, pass: env.SMTP_PASS },
    });
    await transport.sendMail({
      from: env.SMTP_FROM,
      to,
      subject: "Your MAS Callnet Portal OTP",
      text: `Your one-time password is: ${otp}\n\nValid for 10 minutes. Do not share this code.`,
    });
    await transport.close();
  },
};
