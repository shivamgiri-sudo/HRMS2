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
  async issueToken(payload: Omit<PortalTokenPayload, "role" | "jti">): Promise<{ token: string; jti: string }> {
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

    // jti is returned (not just embedded in the token) so a caller that needs to record
    // it elsewhere -- portal-admin.routes.ts's impersonation audit log, specifically --
    // doesn't have to re-decode the JWT it was just handed to get back a value this
    // function already generated. See migration 1808's jti column on
    // portal_admin_impersonation_log, added for exactly this purpose but never populated
    // until this method started returning it.
    return { token, jti };
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
      const { token } = await portalAuthService.issueToken({
        clientUserId: "u-demo-1",
        clientId: "c-demo-1",
        processIds: ["p-demo-1"],
      });
      return token;
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

    const { token } = await portalAuthService.issueToken({
      clientUserId: user.id,
      clientId: user.client_id,
      processIds,
    });
    return token;
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

    const { token } = await portalAuthService.issueToken({
      clientUserId: user.id,
      clientId: user.client_id,
      processIds,
    });

    return { token, mustChangePassword: Number(user.must_change_password) === 1 };
  },

  /**
   * Self-service password RESET -- for a client who has forgotten their password and has
   * no admin nearby to regenerate one for them. Confirmed as a real, unaddressed gap: the
   * only prior recovery paths were (a) email OTP login, which gets a client back into the
   * dashboard but never restores their login_id/password, leaving them permanently on OTP
   * only, or (b) waiting for an admin to call generatePortalLogin. Neither is self-service.
   *
   * Deliberately does NOT take a current password (unlike changePassword above) -- identity
   * here is already proven by the caller having just completed a real OTP verification
   * (see resetPassword in the controller, reachable only via requireClientAuth on a token
   * that verifyOtp issued). Same cost-12 hashing as a user's own deliberate password
   * choice, must_change_password cleared since they are choosing it themselves right now,
   * and every other live session revoked -- same "a password reset invalidates old
   * sessions" rule changePassword follows.
   *
   * Also mints a login_id when the account does not have one yet -- 27 of 28 live
   * client_user rows predate migration 1814's password-login system and were seeded
   * email-only, so setting ONLY password_hash here (as an earlier version of this method
   * did) left password_hash populated with no login_id to ever pair it with: a client
   * resetting via this flow would still have no way to reach POST /auth/login afterward.
   * Reuses ensureProcessSlug/generateCredentialsFromSlug's login_id half exactly like
   * createClientUser/generatePortalLogin do, retried once on collision with the same
   * disambiguator pattern.
   */
  async resetPasswordAfterOtp(clientUserId: string, newPassword: string): Promise<{ loginId: string }> {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id, login_id, process_ids, password_hash FROM client_user WHERE id = ? AND is_active = 1 LIMIT 1",
      [clientUserId]
    );
    const user = (rows as RowDataPacket[])[0];
    if (!user) throw new Error("Account not found");

    // Same "new password must differ from current" rule changePassword enforces --
    // resetPasswordAfterOtp has no currentPassword param to compare against by design
    // (identity is proven by OTP, not by the old password), but the OLD hash is still
    // available right here whenever one already exists, so there's no reason to skip
    // this check just because the caller didn't have to supply the old value.
    if (user.password_hash && (await bcrypt.compare(newPassword, user.password_hash))) {
      throw new Error("New password must be different from your current password.");
    }

    const newHash = await bcrypt.hash(newPassword, 12);

    if (user.login_id) {
      await db.execute(
        "UPDATE client_user SET password_hash = ?, must_change_password = 0 WHERE id = ?",
        [newHash, clientUserId]
      );
      await portalAuthService.revokeAllSessionsForUser(clientUserId);
      return { loginId: user.login_id as string };
    }

    // Lazy import to avoid a require-cycle at module load time -- portal-credentials.ts
    // does not import portal.auth.service.ts, so this is one-directional and safe, but
    // keeping the import local to this branch (the only one that needs it) avoids adding
    // a top-of-file dependency this file otherwise has no reason to carry.
    const { ensureProcessSlug, generateCredentialsFromSlug, disambiguateLoginId } = await import("./portal-credentials.js");

    let processIds: string[];
    try {
      processIds = typeof user.process_ids === "string" ? JSON.parse(user.process_ids) : (user.process_ids ?? []);
    } catch {
      processIds = [];
    }
    if (!processIds.length) throw new Error("This account has no assigned process — cannot derive a Login ID. Contact your account manager.");

    // ensureProcessSlug throws a raw "process_master row not found for id <uuid>" when
    // processIds[0] is stale/dangling (the process was deleted, or the JSON drifted from
    // reality) -- caught here specifically so a real client's password-reset screen never
    // shows an internal table name and a raw UUID. The empty-array check three lines above
    // only catches a genuinely empty list; a non-empty list pointing at a since-deleted
    // process reaches this line instead, which the empty check alone can't guard against.
    let slug: string;
    try {
      slug = await ensureProcessSlug(processIds[0]);
    } catch {
      throw new Error("Could not set up a Login ID for this account. Contact your account manager.");
    }
    let loginId = generateCredentialsFromSlug(slug).loginId;

    let updated = false;
    for (let attempt = 0; attempt < 2 && !updated; attempt++) {
      try {
        await db.execute(
          "UPDATE client_user SET login_id = ?, password_hash = ?, must_change_password = 0 WHERE id = ?",
          [loginId, newHash, clientUserId]
        );
        updated = true;
      } catch (err) {
        if ((err as { code?: string }).code === "ER_DUP_ENTRY" && attempt === 0) {
          loginId = disambiguateLoginId(loginId);
          continue;
        }
        throw err;
      }
    }
    await portalAuthService.revokeAllSessionsForUser(clientUserId);
    return { loginId };
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

    // Found during an edge-case audit: the length-only validation schema (min 8, no
    // complexity rule) meant a client forced to change their temp password by
    // must_change_password=1 could satisfy that gate by resubmitting the EXACT same
    // password unchanged -- e.g. "Gs1India@2026" already clears min(8), so nothing
    // stopped it being both "current" and "new" in the same request. That defeats the
    // entire point of forcing a change. Checked here (server-side, against the real hash)
    // rather than in the zod schema, since the schema has no access to the current value.
    if (await bcrypt.compare(newPassword, user.password_hash)) {
      throw new Error("New password must be different from your current password.");
    }

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
