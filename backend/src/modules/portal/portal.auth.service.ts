import { randomUUID } from "crypto";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import nodemailer from "nodemailer";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { env } from "../../config/env.js";
import type { PortalTokenPayload, ClientUser } from "./portal.types.js";

export const portalAuthService = {
  generateOtp(): string {
    return String(Math.floor(100000 + Math.random() * 900000));
  },

  issueToken(payload: Omit<PortalTokenPayload, "role">): string {
    return jwt.sign({ ...payload, role: "client" }, env.PORTAL_JWT_SECRET, { expiresIn: "7d" });
  },

  verifyToken(token: string): PortalTokenPayload {
    return jwt.verify(token, env.PORTAL_JWT_SECRET) as PortalTokenPayload;
  },

  async requestOtp(email: string): Promise<void> {
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

  async verifyOtp(email: string, otp: string): Promise<string> {
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
