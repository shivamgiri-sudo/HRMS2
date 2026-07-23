import { Router, type NextFunction, type Request, type RequestHandler, type Response } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import crypto from "crypto";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { authService } from "./auth.service.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { emailService } from "../communication/email.service.js";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { sendTwoFactorChallenge, verifyTwoFactorChallenge, type TwoFactorChannel } from "./twoFactor.service.js";
import {
  setRefreshTokenCookie,
  clearRefreshTokenCookie,
  getRefreshTokenFromRequest,
} from "./auth-cookie.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100,                  // 100 attempts per IP — multiple users share office NAT
  message: { success: false, message: "Too many login attempts. Please try again in 15 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const otpRequestLimiter = rateLimit({
  windowMs: 10 * 60 * 1000, // 10 minutes
  max: 5,                    // 5 OTP requests per IP per window
  message: { success: false, message: "Too many OTP requests. Please try again after 10 minutes." },
  standardHeaders: true,
  legacyHeaders: false,
});

const twoFactorLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 5,
  message: { success: false, message: "Too many verification attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();
type AnyRequest = Request & { authUser?: AuthenticatedRequest["authUser"] };

const h = (fn: (req: AnyRequest, res: Response) => Promise<unknown>) =>
  ((req: Request, res: Response, next: NextFunction) => fn(req as AnyRequest, res).catch(next)) as RequestHandler;

interface ReportingRow extends RowDataPacket {
  reporting_manager_id: string | null;
}

interface IdRow extends RowDataPacket {
  id: string;
}

interface RoleRow extends RowDataPacket {
  role_key: string;
}

interface RequesterRow extends RowDataPacket {
  employee_id: string;
  branch_id: string | null;
  designation: string | null;
}

interface EmployeeLookupRow extends RowDataPacket {
  employee_id: string;
  user_id: string | null;
  branch_id: string | null;
  designation: string | null;
  emp_email: string | null;
  auth_email: string | null;
}

interface UserLookupRow extends RowDataPacket {
  user_id: string;
  email: string;
  employee_id: string | null;
  designation: string | null;
}

interface OnboardingTokenRow extends RowDataPacket {
  candidate_id: string;
  onboarding_token_expires_at: string;
  candidate_email: string | null;
}

interface OtpRateRow extends RowDataPacket {
  cnt: number;
}

interface OtpIdRow extends RowDataPacket {
  id: string;
}

function resetLink(token: string): string {
  return `${env.FRONTEND_URL.replace(/\/$/, "")}/reset-password?token=${encodeURIComponent(token)}`;
}

function resetEmailHtml(link: string) {
  return `
  <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
    <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
      <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
        <h2 style="margin:0;font-size:22px">Reset your MAS Callnet HRMS password</h2>
        <p style="margin:6px 0 0;color:#cbd5e1;font-size:13px">Use the secure link below to create a new password.</p>
      </div>
      <div style="padding:26px">
        <p style="font-size:15px;line-height:1.6;margin:0 0 16px">We received a request to reset your HRMS password.</p>
        <p style="margin:24px 0"><a href="${link}" style="background:#2563eb;color:#ffffff;text-decoration:none;padding:12px 18px;border-radius:12px;font-weight:700;display:inline-block">Reset Password</a></p>
        <p style="font-size:13px;line-height:1.6;color:#64748b;margin:0">This link is valid for 1 hour. If you did not request this, you can safely ignore this email.</p>
      </div>
    </div>
  </div>`;
}

function resetEmailText(link: string) {
  return `Reset your MAS Callnet HRMS password\n\nUse this secure link to reset your password: ${link}\n\nThis link is valid for 1 hour. If you did not request this, ignore this email.`;
}

function validateTemporaryPassword(password: string): string | null {
  if (password.length < 10) return "Temporary password must be at least 10 characters";
  if (!/[A-Z]/.test(password)) return "Temporary password must include an uppercase letter";
  if (!/[a-z]/.test(password)) return "Temporary password must include a lowercase letter";
  if (!/\d/.test(password)) return "Temporary password must include a number";
  if (!/[^A-Za-z0-9]/.test(password)) return "Temporary password must include a special character";
  return null;
}

async function isReportingDownline(requesterEmployeeId: string, targetEmployeeId: string): Promise<boolean> {
  const [rows] = await db.execute<RowDataPacket[]>(
    `WITH RECURSIVE chain AS (
       SELECT id, reporting_manager_id FROM employees WHERE id = ? AND active_status = 1
       UNION ALL
       SELECT e.id, e.reporting_manager_id
         FROM employees e JOIN chain c ON e.id = c.reporting_manager_id
        WHERE e.active_status = 1
     )
     SELECT 1 FROM chain WHERE id = ? LIMIT 1`,
    [targetEmployeeId, requesterEmployeeId]
  );
  return rows.length > 0;
}

// POST /api/auth/login — public (rate limited)
// Accepts: { identifier: "email or employee code", password } OR legacy { email, password }
// SECURITY: Refresh token is set as httpOnly cookie, NOT returned in response body
router.post("/login", authLimiter, h(async (req, res) => {
  const identifier = req.body.identifier || req.body.email;
  const { password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: "identifier (email or employee code) and password required" });

  try {
    const tokens = await authService.login(identifier, password, req);

    // SECURITY: Set refresh token as httpOnly cookie (if provided - not provided for 2FA pending)
    if (tokens.refreshToken) {
      setRefreshTokenCookie(res, tokens.refreshToken);
    }

    // Return response WITHOUT refresh token in body (security improvement)
    // The refresh token is only accessible via httpOnly cookie
    return res.json({
      data: {
        accessToken: tokens.accessToken,
        // refreshToken intentionally omitted from response body
        user: tokens.user,
      }
    });
  } catch (error: unknown) {
    return res.status(401).json({ error: error instanceof Error ? error.message : "Authentication failed" });
  }
}));

// POST /api/auth/register — requires a valid invitation/onboarding token
// SECURITY: Registration is NOT open. Users must have one of:
// - A valid ATS onboarding token (from candidate flow)
// - A valid HR invitation token
// - A valid employee activation token
// This prevents arbitrary account creation.
router.post("/register", authLimiter, h(async (req, res) => {
  const { email, password, onboardingToken, invitationToken, activationToken } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "email and password (min 8 chars) required" });
  }

  // SECURITY: At least one valid token is required
  const hasToken = onboardingToken || invitationToken || activationToken;
  if (!hasToken) {
    return res.status(403).json({
      error: "Registration requires a valid invitation or onboarding token. Please contact HR.",
      code: "INVITATION_REQUIRED",
    });
  }

  try {
    let userId: string;

    if (onboardingToken) {
      // ATS candidate onboarding flow
      userId = await authService.registerFromATS(email, password, String(onboardingToken));
    } else if (invitationToken) {
      // HR invitation flow - validate invitation token
      const tokenHash = crypto.createHash('sha256').update(String(invitationToken)).digest('hex');
      const [inviteRows] = await db.execute<RowDataPacket[]>(
        `SELECT id, email, consumed_at FROM auth_invitation
         WHERE token_hash = ? AND expires_at > NOW()`,
        [tokenHash]
      );
      if (!inviteRows.length) {
        return res.status(403).json({ error: "Invalid or expired invitation token", code: "INVITATION_INVALID" });
      }
      if (inviteRows[0].consumed_at) {
        return res.status(403).json({ error: "Invitation has already been used", code: "INVITATION_CONSUMED" });
      }
      // Verify email matches invitation (case-insensitive)
      if (String(inviteRows[0].email).toLowerCase() !== String(email).toLowerCase()) {
        return res.status(403).json({ error: "Email does not match invitation", code: "EMAIL_MISMATCH" });
      }
      // Mark invitation as consumed
      await db.execute('UPDATE auth_invitation SET consumed_at = NOW() WHERE id = ?', [inviteRows[0].id]);
      userId = await authService.register(email, password);
    } else if (activationToken) {
      // Employee activation flow - validate against employee_activation_tokens
      const tokenHash = crypto.createHash('sha256').update(String(activationToken)).digest('hex');
      const [activationRows] = await db.execute<RowDataPacket[]>(
        `SELECT t.id, t.employee_id, t.consumed_at, e.email AS employee_email
         FROM employee_activation_tokens t
         JOIN employees e ON e.id = t.employee_id
         WHERE t.token_hash = ? AND t.expires_at > NOW()`,
        [tokenHash]
      );
      if (!activationRows.length) {
        return res.status(403).json({ error: "Invalid or expired activation token", code: "ACTIVATION_INVALID" });
      }
      if (activationRows[0].consumed_at) {
        return res.status(403).json({ error: "Activation token has already been used", code: "ACTIVATION_CONSUMED" });
      }
      // Verify email matches employee (case-insensitive)
      if (String(activationRows[0].employee_email).toLowerCase() !== String(email).toLowerCase()) {
        return res.status(403).json({ error: "Email does not match employee record", code: "EMAIL_MISMATCH" });
      }
      // Mark activation as consumed
      await db.execute('UPDATE employee_activation_tokens SET consumed_at = NOW() WHERE id = ?', [activationRows[0].id]);
      userId = await authService.register(email, password);
      // Link user to employee
      await db.execute('UPDATE employees SET user_id = ? WHERE id = ?', [userId, activationRows[0].employee_id]);
    } else {
      // Should not reach here due to hasToken check above
      return res.status(403).json({ error: "Registration requires a valid token", code: "INVITATION_REQUIRED" });
    }

    return res.status(201).json({ ok: true, userId });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Registration failed";
    if (message.includes("Duplicate entry")) return res.status(409).json({ error: "Email already registered" });
    const status = typeof error === "object" && error !== null && "status" in error && typeof (error as { status?: unknown }).status === "number"
      ? (error as { status: number }).status
      : 400;
    return res.status(status).json({ error: message });
  }
}));

// POST /api/auth/invite-user — protected invite/reset-token flow, no raw password exposure
router.post("/invite-user", requireAuth, requireRole("admin", "hr", "super_admin"), h(async (req, res) => {
  const email = String(req.body.email ?? "").trim().toLowerCase();
  const employeeId = String(req.body.employeeId ?? "").trim();
  if (!email) return res.status(400).json({ success: false, error: "email required" });

  const randomPasswordHash = await bcrypt.hash(crypto.randomBytes(32).toString("hex"), 12);
  let userId = "";

  const [existing] = await db.execute<RowDataPacket[]>(
    "SELECT id FROM auth_user WHERE LOWER(email) = LOWER(?) LIMIT 1",
    [email],
  );

  if (existing[0]) {
    userId = String(existing[0].id);
    await db.execute(
      "UPDATE auth_user SET must_change_password = 1, updated_at = NOW() WHERE id = ?",
      [userId],
    );
  } else {
    userId = crypto.randomUUID();
    await db.execute(
      "INSERT INTO auth_user (id, email, password_hash, must_change_password) VALUES (?, ?, ?, 1)",
      [userId, email, randomPasswordHash],
    );
  }

  if (employeeId) {
    await db.execute(
      "UPDATE employees SET user_id = ? WHERE id = ? AND (user_id IS NULL OR user_id = ?)",
      [userId, employeeId, userId],
    );
  }

  const token = await authService.createPasswordResetTokenByUserId(userId, 24);
  const link = resetLink(token);
  let inviteSent = false;
  if (emailService.isConfigured()) {
    await emailService.send({
      to: email,
      subject: "Set your MAS Callnet HRMS password",
      html: resetEmailHtml(link),
      text: resetEmailText(link),
    });
    inviteSent = true;
  }

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "AUTH_USER_INVITED",
    module_key: "auth",
    entity_type: "auth_user",
    entity_id: userId,
    change_summary: { email, employee_id: employeeId || null, invite_sent: inviteSent },
  });

  return res.status(201).json({ success: true, userId, inviteSent });
}));

// POST /api/auth/refresh — public
// SECURITY: Implements token rotation - each refresh returns a NEW refresh token.
// The old token is marked as rotated (not deleted) for reuse detection.
// If a rotated token is reused, the entire token family is revoked.
// SECURITY: Refresh token is read from httpOnly cookie, NOT request body
router.post("/refresh", h(async (req, res) => {
  // SECURITY: Read refresh token from httpOnly cookie (with legacy body fallback)
  const refreshToken = getRefreshTokenFromRequest(req);
  if (!refreshToken) {
    return res.status(400).json({ error: "Refresh token required (via cookie)" });
  }

  try {
    const tokens = await authService.refreshAccess(refreshToken);

    // SECURITY: Set rotated refresh token as httpOnly cookie
    setRefreshTokenCookie(res, tokens.refreshToken);

    // Return response WITHOUT refresh token in body
    return res.json({
      data: {
        accessToken: tokens.accessToken,
        // refreshToken intentionally omitted from response body
      }
    });
  } catch (error: unknown) {
    const err = error as { code?: string; message?: string };

    // Clear cookie on auth failure
    clearRefreshTokenCookie(res);

    // Return specific error codes for client-side handling
    if (err.code === 'TOKEN_REUSED') {
      return res.status(401).json({
        error: "Security: Token reuse detected. All sessions have been revoked.",
        code: 'TOKEN_REUSED',
        logoutRequired: true,
      });
    }
    if (err.code === 'PASSWORD_CHANGED') {
      return res.status(401).json({
        error: "Session expired due to password change. Please log in again.",
        code: 'PASSWORD_CHANGED',
        logoutRequired: true,
      });
    }
    if (err.code === 'USER_BLOCKED' || err.code === 'EMPLOYEE_INACTIVE') {
      return res.status(401).json({
        error: "Account is not active. Please contact HR.",
        code: err.code,
        logoutRequired: true,
      });
    }
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}));

// POST /api/auth/logout — requires auth
// SECURITY: Clears httpOnly refresh token cookie
router.post("/logout", requireAuth, h(async (req, res) => {
  // SECURITY: Read refresh token from httpOnly cookie (with legacy body fallback)
  const refreshToken = getRefreshTokenFromRequest(req);
  if (refreshToken) {
    await authService.logout(refreshToken, req);
  }

  // Always clear the refresh token cookie
  clearRefreshTokenCookie(res);

  return res.json({ success: true });
}));

// POST /api/auth/forgot-password — public (rate limited)
router.post("/forgot-password", authLimiter, h(async (req, res) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  if (!emailService.isConfigured()) {
    return res.status(503).json({
      success: false,
      smtpNotConfigured: true,
      error: "Email reset is not available. Please use the mobile OTP option or contact your HR/Admin to reset your password."
    });
  }

  const normalizedEmail = String(email).trim().toLowerCase();
  const result = await authService.forgotPassword(normalizedEmail);

  if (result) {
    try {
      const link = resetLink(result.token);
      await emailService.send({
        to: result.deliverTo,
        subject: "Reset your MAS Callnet HRMS password",
        html: resetEmailHtml(link),
        text: resetEmailText(link),
      });
    } catch (error) {
      console.error("[HRMS] Password reset email delivery failed:", error instanceof Error ? error.message : "unknown error");
    }
  }

  // Always return success to prevent email enumeration.
  return res.json({ success: true, message: "If that email exists, a reset link has been sent." });
}));

// POST /api/auth/forgot-password-otp — public (rate limited) — SMS/WhatsApp OTP
router.post("/forgot-password-otp", otpRequestLimiter, h(async (req, res) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });

  try {
    const result = await authService.forgotPasswordOtp(phone);
    return res.json(result);
  } catch (error: unknown) {
    console.error("[HRMS] OTP send failed:", error instanceof Error ? error.message : "unknown");
    return res.json({ success: true, message: "If this phone number is registered, you will receive an OTP." });
  }
}));

// POST /api/auth/verify-otp-reset — public — verify OTP and reset password
const verifyOtpAndReset = async (phone: string, otp: string, newPassword: string) =>
  authService.verifyOtpAndResetPassword(phone, otp, newPassword);

router.post("/verify-otp-reset", authLimiter, h(async (req, res) => {
  const { phone, otp, newPassword } = req.body;
  if (!phone || !otp || !newPassword) {
    return res.status(400).json({ error: "Phone, OTP, and new password required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    await verifyOtpAndReset(phone, otp, newPassword);
    return res.json({ success: true, message: "Password reset successful" });
  } catch (error: unknown) {
    return res.status(400).json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
}));

// POST /api/auth/reset-password — public
// SECURITY: Clears httpOnly cookie as password reset invalidates all sessions
router.post("/reset-password", h(async (req, res) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  try {
    await authService.resetPassword(token, password);

    // SECURITY: Clear any existing refresh token cookie
    // Password reset invalidates all existing sessions
    clearRefreshTokenCookie(res);

    return res.json({ success: true });
  } catch (error: unknown) {
    return res.status(400).json({ error: error instanceof Error ? error.message : "Unknown error" });
  }
}));

// POST /api/auth/change-password — requires auth
// SECURITY: Clears httpOnly cookie as password change invalidates all sessions
router.post("/change-password", requireAuth, authLimiter, h(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  await authService.changePassword(req.authUser!.id, String(currentPassword), String(newPassword));

  // SECURITY: Clear refresh token cookie as password change invalidates all sessions
  clearRefreshTokenCookie(res);

  return res.json({ success: true });
}));

router.post("/2fa/send", requireAuth, twoFactorLimiter, h(async (req, res) => {
  const channel = String(req.body.channel ?? "email").toLowerCase() as TwoFactorChannel;
  if (!["email", "sms"].includes(channel)) {
    return res.status(400).json({ success: false, error: "channel must be email or sms" });
  }
  await sendTwoFactorChallenge(req.authUser!.id, channel);
  return res.json({ success: true, message: "Verification code sent" });
}));

router.post("/2fa/verify", requireAuth, twoFactorLimiter, h(async (req, res) => {
  const otp = String(req.body.otp ?? "").trim();
  if (!/^\d{6}$/.test(otp)) {
    return res.status(400).json({ success: false, error: "A valid 6 digit code is required" });
  }
  await verifyTwoFactorChallenge(req.authUser!.id, otp);

  // Exchange the pre_auth token for full session (access + refresh tokens).
  // SECURITY: Refresh token is ONLY created here, after 2FA verification.
  const preAuthToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  let accessToken: string | null = null;
  try {
    const exchanged = await authService.exchangePreAuthToken(preAuthToken, req);
    accessToken = exchanged.accessToken;

    // SECURITY: Set refresh token as httpOnly cookie
    if (exchanged.refreshToken) {
      setRefreshTokenCookie(res, exchanged.refreshToken);
    }
  } catch {
    // If exchange fails (e.g. already-verified challenge, race), the client will
    // need to call POST /api/auth/2fa/exchange explicitly.
  }

  // Return response WITHOUT refresh token in body
  return res.json({
    success: true,
    twoFactorVerified: true,
    ...(accessToken ? { accessToken } : {}),
    // refreshToken intentionally omitted - set as httpOnly cookie
  });
}));

// POST /api/auth/2fa/exchange — exchange a verified pre_auth token for full session
// Separated out so clients can call this independently if /2fa/verify didn't return the tokens.
// SECURITY: Refresh token is set as httpOnly cookie, NOT returned in response body
router.post("/2fa/exchange", requireAuth, h(async (req, res) => {
  const preAuthToken = (req.headers.authorization ?? '').replace('Bearer ', '').trim();
  try {
    const { accessToken, refreshToken } = await authService.exchangePreAuthToken(preAuthToken, req);

    // SECURITY: Set refresh token as httpOnly cookie
    if (refreshToken) {
      setRefreshTokenCookie(res, refreshToken);
    }

    // Return response WITHOUT refresh token in body
    return res.json({ success: true, accessToken });
  } catch (error: unknown) {
    const status = typeof error === "object" && error !== null && "statusCode" in error && typeof (error as { statusCode?: unknown }).statusCode === "number"
      ? (error as { statusCode: number }).statusCode
      : 401;
    return res.status(status).json({ success: false, error: error instanceof Error ? error.message : "Unknown error" });
  }
}));

// POST /api/auth/admin-reset-password — Admin password reset for employees
// Super Admin can reset any other user; Admin and WFM are limited to reporting downlines.
router.post("/admin-reset-password", requireAuth, h(async (req, res) => {
  const { userId, employeeId, temporaryPassword } = req.body;

  if (!userId && !employeeId) {
    return res.status(400).json({
      success: false,
      error: "Either userId or employeeId is required"
    });
  }
  if (!temporaryPassword || typeof temporaryPassword !== "string") {
    return res.status(400).json({
      success: false,
      error: "temporaryPassword is required"
    });
  }
  const passwordError = validateTemporaryPassword(temporaryPassword);
  if (passwordError) {
    return res.status(400).json({ success: false, error: passwordError });
  }

  const [roleRows] = await db.execute<RoleRow[]>(
    `SELECT role_key
       FROM user_roles
      WHERE user_id = ? AND active_status = 1`,
    [req.authUser!.id]
  );
  const roles = new Set(roleRows.map((row) => String(row.role_key)));
  const requesterRole = roles.has("super_admin")
    ? "super_admin"
    : roles.has("admin")
      ? "admin"
      : roles.has("hr")
        ? "hr"
        : roles.has("wfm") || roles.has("wfm_admin")
          ? "wfm"
          : null;

  if (!requesterRole) {
    return res.status(403).json({
      success: false,
      error: "Only Super Admin, Admin, HR or WFM can reset employee passwords"
    });
  }

  const [requesterRows] = await db.execute<RequesterRow[]>(
    `SELECT e.id AS employee_id, e.branch_id,
            COALESCE(d.designation_name, e.emp_type, e.profile_type) AS designation
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.user_id = ? AND e.active_status = 1
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [req.authUser!.id]
  );
  const requesterDesignation = requesterRows[0]?.designation
    ? String(requesterRows[0].designation)
    : null;
  const requesterEmployeeId = requesterRows[0]?.employee_id
    ? String(requesterRows[0].employee_id)
    : null;
  const requesterBranchId = requesterRows[0]?.branch_id
    ? String(requesterRows[0].branch_id)
    : null;

  let targetUserId = userId ? String(userId) : "";
  let targetEmployeeId: string | null = null;
  let targetDesignation: string | null = null;
  let targetUserEmail: string | null = null;
  let targetBranchId: string | null = null;

  if (employeeId) {
    const [empRows] = await db.execute<EmployeeLookupRow[]>(
      `SELECT e.id AS employee_id, e.user_id, e.branch_id,
              COALESCE(d.designation_name, e.emp_type, e.profile_type) AS designation,
              COALESCE(NULLIF(TRIM(e.official_email),''), NULLIF(TRIM(e.email),'')) AS emp_email,
              au.email AS auth_email
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
       LEFT JOIN auth_user au ON au.id = e.user_id
       WHERE e.id = ?
       LIMIT 1`,
      [employeeId]
    );
    if (!empRows.length) {
      return res.status(404).json({ success: false, error: "Employee not found" });
    }
    targetEmployeeId = String(empRows[0].employee_id);
    targetDesignation = empRows[0].designation ? String(empRows[0].designation) : null;
    targetBranchId = empRows[0].branch_id ? String(empRows[0].branch_id) : null;

    if (empRows[0].user_id) {
      targetUserId = String(empRows[0].user_id);
      targetUserEmail = empRows[0].auth_email ? String(empRows[0].auth_email) : null;
    } else {
      // No auth_user yet — auto-provision if employee has an email address
      const empEmail = empRows[0].emp_email ? String(empRows[0].emp_email).trim().toLowerCase() : null;
      if (!empEmail) {
        return res.status(400).json({
          success: false,
          error: "Employee has no email address on record. Add an official email before creating their account."
        });
      }
      // Check if an auth_user with this email already exists (orphaned)
      const [existingAuth] = await db.execute<IdRow[]>(
        `SELECT id FROM auth_user WHERE email = ? LIMIT 1`, [empEmail]
      );
      let newUserId: string;
      if (existingAuth.length) {
        newUserId = String(existingAuth[0].id);
      } else {
        // Create new auth_user with a temporary hash (will be overwritten below)
        newUserId = crypto.randomUUID();
        await db.execute(
          `INSERT INTO auth_user (id, email, password_hash, must_change_password)
           VALUES (?, ?, '', 1)`,
          [newUserId, empEmail]
        );
      }
      // Link auth_user to employee
      await db.execute(
        `UPDATE employees SET user_id = ? WHERE id = ?`,
        [newUserId, employeeId]
      );
      // Grant default employee role if not already assigned
      await db.execute(
        `INSERT IGNORE INTO user_roles (id, user_id, role_key, active_status)
         VALUES (UUID(), ?, 'employee', 1)`,
        [newUserId]
      );
      targetUserId = newUserId;
      targetUserEmail = empEmail;
    }
  } else {
    const [userRows] = await db.execute<UserLookupRow[]>(
      `SELECT au.id AS user_id, au.email, e.id AS employee_id,
              COALESCE(d.designation_name, e.emp_type, e.profile_type) AS designation
       FROM auth_user au
       LEFT JOIN employees e ON e.user_id = au.id AND e.active_status = 1
       LEFT JOIN designation_master d ON d.id = e.designation_id
       WHERE au.id = ?
       ORDER BY e.updated_at DESC
       LIMIT 1`,
      [userId]
    );
    if (!userRows.length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    targetUserId = String(userRows[0].user_id);
    targetEmployeeId = userRows[0].employee_id ? String(userRows[0].employee_id) : null;
    targetDesignation = userRows[0].designation ? String(userRows[0].designation) : null;
    targetUserEmail = userRows[0].email ? String(userRows[0].email) : null;
  }

  if (!targetUserId) {
    return res.status(400).json({
      success: false,
      error: "Could not resolve user account for this employee"
    });
  }

  if (targetUserId === req.authUser!.id) {
    return res.status(403).json({
      success: false,
      error: "Use Change Password to update your own password"
    });
  }

  if (requesterRole === "hr") {
    // HR can reset passwords for employees in their own branch only
    if (!requesterBranchId) {
      return res.status(403).json({
        success: false,
        error: "Your employee profile does not have a branch assigned"
      });
    }
    const resolvedTargetBranchId = employeeId ? (targetBranchId ?? null) : await (async () => {
      const [r] = await db.execute<RowDataPacket[]>(
        `SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1`,
        [targetUserId]
      );
      return r[0]?.branch_id ? String(r[0].branch_id) : null;
    })();
    if (resolvedTargetBranchId !== requesterBranchId) {
      return res.status(403).json({
        success: false,
        error: "You can only reset passwords for employees in your own branch"
      });
    }
  } else if (requesterRole !== "super_admin") {
    // admin / wfm: restricted to reporting downline
    if (!requesterEmployeeId || !targetEmployeeId) {
      return res.status(403).json({
        success: false,
        error: "Your employee profile and the target employee profile must be linked"
      });
    }
    if (!(await isReportingDownline(requesterEmployeeId, targetEmployeeId))) {
      return res.status(403).json({
        success: false,
        error: "You can reset passwords only for employees in your reporting downline"
      });
    }
  }

  const hashedPassword = await bcrypt.hash(temporaryPassword, 12);
  await db.execute(
    `UPDATE auth_user
     SET password_hash = ?,
         must_change_password = 1,
         updated_at = NOW()
     WHERE id = ?`,
    [hashedPassword, targetUserId]
  );
  await db.execute(
    `UPDATE auth_refresh_token
        SET revoked = 1
      WHERE user_id = ? AND revoked = 0`,
    [targetUserId]
  );

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "ADMIN_PASSWORD_RESET",
    module_key: "AUTH",
    entity_type: "auth_user",
    entity_id: targetUserId,
    change_summary: {
      target_employee_id: targetEmployeeId,
      target_designation: targetDesignation,
      requester_role: requesterRole,
      requester_designation: requesterDesignation,
      reporting_scope_enforced: requesterRole !== "super_admin",
      force_change_on_next_login: true,
      refresh_sessions_revoked: true,
    },
    req,
  });

  if (targetUserEmail) {
    try {
      await emailService.send({
        to: targetUserEmail,
        subject: "Your HRMS Password Has Been Reset",
        html: `
          <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
              <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
                <h2 style="margin:0;font-size:22px">Password Reset</h2>
              </div>
              <div style="padding:26px">
                <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Your HRMS password has been reset by an authorised administrator.</p>
                <p style="font-size:14px;line-height:1.6;margin:16px 0;color:#dc2626;font-weight:600">Contact the administrator through the approved secure channel for your temporary password. You must change it immediately after login.</p>
                <p style="font-size:13px;line-height:1.6;color:#64748b;margin:16px 0 0">All existing HRMS refresh sessions have been revoked for your security.</p>
              </div>
            </div>
          </div>
        `,
        text: "Your HRMS password has been reset by an authorised administrator. Contact the administrator through the approved secure channel for the temporary password. You must change it immediately after login. Existing HRMS refresh sessions have been revoked."
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
    }
  }

  return res.json({
    success: true,
    mustChangePassword: true,
    message: "Temporary password set. Share it securely with the employee; they must change it after login."
  });
}));

// ═══════════════════════════════════════════════════════════════
// SESSION MANAGEMENT ENDPOINTS
// ═══════════════════════════════════════════════════════════════

// GET /api/auth/sessions — List active sessions for current user
// Pass current refresh token via header (x-refresh-token) or query param (?token=...) to mark isCurrent
router.get("/sessions", requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  const currentRefreshToken = req.headers['x-refresh-token'] || req.query.token;
  const currentTokenHash = currentRefreshToken
    ? crypto.createHash('sha256').update(String(currentRefreshToken)).digest('hex')
    : null;

  interface SessionRow extends RowDataPacket {
    id: string;
    device_name: string | null;
    device_fingerprint: string | null;
    ip_address: string | null;
    location_city: string | null;
    location_country: string | null;
    created_at: string;
    last_active_at: string;
    expires_at: string;
    refresh_token_hash: string;
  }

  const [rows] = await db.execute<SessionRow[]>(
    `SELECT id, device_name, device_fingerprint, ip_address, location_city, location_country,
            created_at, last_active_at, expires_at, refresh_token_hash
       FROM user_device_sessions
      WHERE user_id = ?
        AND revoked_at IS NULL
        AND expires_at > NOW()
      ORDER BY last_active_at DESC`,
    [userId]
  );

  const sessions = rows.map((row) => ({
    id: row.id,
    deviceName: row.device_name || 'Unknown Device',
    deviceFingerprint: row.device_fingerprint,
    ipAddress: row.ip_address,
    locationCity: row.location_city,
    locationCountry: row.location_country,
    createdAt: row.created_at,
    lastActiveAt: row.last_active_at,
    expiresAt: row.expires_at,
    isCurrent: currentTokenHash ? row.refresh_token_hash === currentTokenHash : false
  }));

  return res.json({ success: true, data: sessions });
}));

// DELETE /api/auth/sessions/:sessionId — Revoke specific session
router.delete("/sessions/:sessionId", requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;
  const { sessionId } = req.params;

  // Verify session belongs to current user
  interface SessionOwnerRow extends RowDataPacket {
    user_id: string;
    refresh_token_hash: string;
  }

  const [rows] = await db.execute<SessionOwnerRow[]>(
    'SELECT user_id, refresh_token_hash FROM user_device_sessions WHERE id = ? LIMIT 1',
    [sessionId]
  );

  if (!rows[0]) {
    return res.status(404).json({ success: false, message: "Session not found" });
  }

  if (rows[0].user_id !== userId) {
    return res.status(403).json({ success: false, message: "Not your session" });
  }

  const tokenHash = rows[0].refresh_token_hash;

  // Revoke refresh token
  await db.execute(
    'UPDATE auth_refresh_token SET revoked = 1 WHERE token_hash = ?',
    [tokenHash]
  );

  // Revoke device session
  await db.execute(
    'UPDATE user_device_sessions SET revoked_at = NOW() WHERE id = ?',
    [sessionId]
  );

  // Log revocation
  await logSensitiveAction({
    actor_user_id: userId,
    action_type: "SESSION_REVOKED",
    module_key: "AUTH",
    entity_type: "user_device_session",
    entity_id: sessionId,
    change_summary: { reason: "User manually revoked session" },
    req
  }).catch(() => {});

  return res.json({ success: true, message: "Session revoked successfully" });
}));

// DELETE /api/auth/sessions/all/others — Logout all other devices
// DELETE /api/auth/sessions/all/others — logout all other devices
// SECURITY: Reads current refresh token from httpOnly cookie
router.delete("/sessions/all/others", requireAuth, h(async (req, res) => {
  const userId = req.authUser!.id;

  // SECURITY: Read current refresh token from httpOnly cookie (with legacy fallback)
  const currentRefreshToken = getRefreshTokenFromRequest(req) || req.headers['x-refresh-token'];

  if (!currentRefreshToken) {
    return res.status(400).json({
      success: false,
      message: "Current refresh token required (via cookie) to identify this session"
    });
  }

  const currentTokenHash = crypto.createHash('sha256').update(String(currentRefreshToken)).digest('hex');

  // Revoke all other refresh tokens
  const [result] = await db.execute<ResultSetHeader>(
    `UPDATE auth_refresh_token
        SET revoked = 1
      WHERE user_id = ?
        AND token_hash != ?
        AND revoked = 0`,
    [userId, currentTokenHash]
  );

  // Revoke all other device sessions
  await db.execute(
    `UPDATE user_device_sessions
        SET revoked_at = NOW()
      WHERE user_id = ?
        AND refresh_token_hash != ?
        AND revoked_at IS NULL`,
    [userId, currentTokenHash]
  );

  const revokedCount = result.affectedRows || 0;

  // Log revocation
  await logSensitiveAction({
    actor_user_id: userId,
    action_type: "ALL_OTHER_SESSIONS_REVOKED",
    module_key: "AUTH",
    change_summary: { revoked_count: revokedCount, reason: "User requested logout from all other devices" },
    req
  }).catch(() => {});

  return res.json({
    success: true,
    message: `${revokedCount} other session(s) revoked successfully`,
    revokedCount
  });
}));

export { router as authRouter };
