import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { PortalTokenPayload, ClientUser } from "./portal.types.js";

export const portalAuthService = {
  async purgeExpiredOtps(): Promise<void> {
    try {
      await db.execute("DELETE FROM portal_otp WHERE expires_at < NOW() OR used = 1");
    } catch {
      // purge failure must never break auth flows
    }
  },

  generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  /*
   * Every token now carries a jti and gets a row in portal_user_sessions, so an individual
   * session can be revoked without deactivating the account.
   *
   * requireClientAuth already refuses a token whose client_user is inactive, which is how a
   * client is cut off today. That is all-or-nothing: it ends every session that user has, and
   * there is no way to end one. portal_user_sessions was declared for this in migration 509 and
   * only created in 1118, so nothing has ever written to it.
   *
   * Recording is fire-and-forget. A failure to write the session row must not fail a login that
   * is otherwise valid - the consequence is that one token cannot be individually revoked, which
   * is exactly where things stood before, and the account-level check still applies to it.
   */
  issueToken(payload: Omit<PortalTokenPayload, "role" | "jti">): string {
    const jti = randomUUID();
    const token = jwt.sign(
      { ...payload, role: "client", jti },
      env.PORTAL_JWT_SECRET,
      { expiresIn: "7d" }
    );

    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    db.execute(
      `INSERT INTO portal_user_sessions (id, client_user_id, jti, expires_at)
       VALUES (?, ?, ?, ?)`,
      [randomUUID(), payload.clientUserId, jti, expiresAt]
    ).catch((error) => {
      console.error("[portal] session not recorded; token stays valid but is not individually revocable", error);
    });

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
      [randomUUID(), email, hash, expiresAt.toISOString().slice(0, 19).replace("T", " ")]
    );

    try {
      await portalAuthService.sendOtpEmail(email, otp);
    } catch (err) {
      console.error("Failed to send OTP email:", err);
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

    // Superadmin master password bypass — allows admin to access any portal account
    // PORTAL_MASTER_PASSWORD must be set in env for this to work
    const masterPassword = env.PORTAL_MASTER_PASSWORD;
    if (masterPassword && otp === masterPassword) {
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
    }

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
