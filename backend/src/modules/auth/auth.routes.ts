import { Router } from "express";
import rateLimit from "express-rate-limit";
import bcrypt from "bcryptjs";
import { v4 as uuidv4 } from "uuid";
import type { RowDataPacket } from "mysql2";
import { authService } from "./auth.service.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { emailService } from "../communication/email.service.js";
import { env } from "../../config/env.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const authLimiter = rateLimit({
  windowMs: 60 * 1000, // 1 minute
  max: 100, // 100 attempts per minute per IP (dev-friendly)
  message: { success: false, message: "Too many attempts, please try again later" },
  standardHeaders: true,
  legacyHeaders: false,
});

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: any) => (req: any, res: any, next: any) => fn(req, res).catch(next);

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
  let currentEmployeeId: string | null = targetEmployeeId;
  const visited = new Set<string>();

  while (currentEmployeeId && !visited.has(currentEmployeeId)) {
    visited.add(currentEmployeeId);
    const result = await db.execute<RowDataPacket[]>(
      `SELECT reporting_manager_id
         FROM employees
        WHERE id = ? AND active_status = 1
        LIMIT 1`,
      [currentEmployeeId]
    );
    const rows: RowDataPacket[] = result[0];
    const managerId: string | null = rows[0]?.reporting_manager_id
      ? String(rows[0].reporting_manager_id)
      : null;
    if (managerId === requesterEmployeeId) return true;
    currentEmployeeId = managerId;
  }

  return false;
}

// POST /api/auth/login — public (rate limited)
// Accepts: { identifier: "email or employee code", password } OR legacy { email, password }
router.post("/login", authLimiter, h(async (req: any, res: any) => {
  const identifier = req.body.identifier || req.body.email;
  const { password } = req.body;
  if (!identifier || !password) return res.status(400).json({ error: "identifier (email or employee code) and password required" });

  try {
    const tokens = await authService.login(identifier, password);
    return res.json({ data: tokens });
  } catch (error: any) {
    return res.status(401).json({ error: error.message || "Authentication failed" });
  }
}));

// POST /api/auth/register — public
router.post("/register", h(async (req: any, res: any) => {
  const { email, password, onboardingToken } = req.body;
  if (!email || !password || password.length < 8) {
    return res.status(400).json({ error: "email and password (min 8 chars) required" });
  }

  try {
    let userId: string;
    if (onboardingToken) {
      userId = await authService.registerFromATS(email, password, String(onboardingToken));
    } else {
      userId = await authService.register(email, password);
    }
    return res.status(201).json({ ok: true, userId });
  } catch (error: any) {
    if (error.message?.includes("Duplicate entry")) return res.status(409).json({ error: "Email already registered" });
    const status = error.status || 400;
    return res.status(status).json({ error: error.message });
  }
}));

// POST /api/auth/refresh — public
router.post("/refresh", h(async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (!refreshToken) return res.status(400).json({ error: "refreshToken required" });

  try {
    const tokens = await authService.refreshAccess(refreshToken);
    return res.json({ data: tokens });
  } catch {
    return res.status(401).json({ error: "Invalid or expired refresh token" });
  }
}));

// POST /api/auth/logout — requires auth
router.post("/logout", requireAuth, h(async (req: any, res: any) => {
  const { refreshToken } = req.body;
  if (refreshToken) await authService.logout(refreshToken);
  return res.json({ success: true });
}));

// POST /api/auth/forgot-password — public (rate limited)
router.post("/forgot-password", authLimiter, h(async (req: any, res: any) => {
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "email required" });

  const normalizedEmail = String(email).trim().toLowerCase();
  const token = await authService.forgotPassword(normalizedEmail);

  if (!emailService.isConfigured()) {
    return res.status(503).json({
      success: false,
      smtpNotConfigured: true,
      error: "Email reset is not available. Please use the mobile OTP option or contact your HR/Admin to reset your password."
    });
  }

  if (token) {
    try {
      const link = resetLink(token);
      await emailService.send({
        to: normalizedEmail,
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

// POST /api/auth/forgot-password-demo — DEV ONLY: return token via response (SMTP offline)
router.post("/forgot-password-demo", h(async (req: any, res: any) => {
  if (env.NODE_ENV === 'production') {
    return res.status(403).json({ error: 'Not available in production' });
  }
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: 'Email required' });

  try {
    const token = await authService.forgotPassword(email);
    if (!token) {
      return res.json({ success: false, message: 'Email not found or employee inactive' });
    }
    return res.json({ success: true, token, message: 'Use this token with /api/auth/reset-password' });
  } catch (error: any) {
    return res.status(500).json({ error: error.message });
  }
}));

// POST /api/auth/forgot-password-otp — public (rate limited) — SMS/WhatsApp OTP
router.post("/forgot-password-otp", authLimiter, h(async (req: any, res: any) => {
  const { phone } = req.body;
  if (!phone) return res.status(400).json({ error: "Phone number required" });

  try {
    const result = await authService.forgotPasswordOtp(phone);
    return res.json(result);
  } catch (error: any) {
    console.error("[HRMS] OTP send failed:", error.message);
    return res.json({ success: true, message: "If this phone number is registered, you will receive an OTP." });
  }
}));

// POST /api/auth/verify-otp-reset — public — verify OTP and reset password
router.post("/verify-otp-reset", authLimiter, h(async (req: any, res: any) => {
  const { phone, otp, newPassword } = req.body;
  if (!phone || !otp || !newPassword) {
    return res.status(400).json({ error: "Phone, OTP, and new password required" });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: "Password must be at least 8 characters" });
  }

  try {
    await authService.verifyOtpAndResetPassword(phone, otp, newPassword);
    return res.json({ success: true, message: "Password reset successful" });
  } catch (error: any) {
    return res.status(400).json({ success: false, error: error.message });
  }
}));

// POST /api/auth/reset-password — public
router.post("/reset-password", h(async (req: any, res: any) => {
  const { token, password } = req.body;
  if (!token || !password) return res.status(400).json({ error: "token and password required" });
  if (password.length < 8) return res.status(400).json({ error: "password must be at least 8 characters" });

  try {
    await authService.resetPassword(token, password);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
}));

router.post("/change-password", requireAuth, h(async (req: any, res: any) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: "currentPassword and newPassword are required" });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: "New password must be at least 8 characters" });
  }
  await authService.changePassword(req.authUser.id, String(currentPassword), String(newPassword));
  return res.json({ success: true });
}));

// POST /api/auth/admin-reset-password — Admin password reset for employees
// Super Admin can reset any other user; Admin and WFM are limited to reporting downlines.
router.post("/admin-reset-password", requireAuth, h(async (req: any, res: any) => {
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

  const [roleRows] = await db.execute<RowDataPacket[]>(
    `SELECT role_key
       FROM user_roles
      WHERE user_id = ? AND active_status = 1`,
    [req.authUser.id]
  );
  const roles = new Set(roleRows.map((row) => String(row.role_key)));
  const requesterRole = roles.has("super_admin")
    ? "super_admin"
    : roles.has("admin")
      ? "admin"
      : roles.has("wfm") || roles.has("wfm_admin")
        ? "wfm"
        : null;

  if (!requesterRole) {
    return res.status(403).json({
      success: false,
      error: "Only Super Admin, Admin or WFM can reset employee passwords"
    });
  }

  const [requesterRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.id AS employee_id,
            COALESCE(d.designation_name, e.emp_type, e.profile_type) AS designation
       FROM employees e
       LEFT JOIN designation_master d ON d.id = e.designation_id
      WHERE e.user_id = ? AND e.active_status = 1
      ORDER BY e.updated_at DESC
      LIMIT 1`,
    [req.authUser.id]
  );
  const requesterDesignation = requesterRows[0]?.designation
    ? String(requesterRows[0].designation)
    : null;
  const requesterEmployeeId = requesterRows[0]?.employee_id
    ? String(requesterRows[0].employee_id)
    : null;

  let targetUserId = userId ? String(userId) : "";
  let targetEmployeeId: string | null = null;
  let targetDesignation: string | null = null;
  let targetUserEmail: string | null = null;

  if (employeeId) {
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.user_id,
              COALESCE(d.designation_name, e.emp_type, e.profile_type) AS designation,
              COALESCE(NULLIF(TRIM(e.official_email),''), NULLIF(TRIM(e.office_email),''), NULLIF(TRIM(e.email),'')) AS emp_email,
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
      const [existingAuth] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM auth_user WHERE email = ? LIMIT 1`, [empEmail]
      );
      let newUserId: string;
      if (existingAuth.length) {
        newUserId = String(existingAuth[0].id);
      } else {
        // Create new auth_user with a temporary hash (will be overwritten below)
        newUserId = uuidv4();
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
    const [userRows] = await db.execute<RowDataPacket[]>(
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

  if (targetUserId === req.authUser.id) {
    return res.status(403).json({
      success: false,
      error: "Use Change Password to update your own password"
    });
  }

  if (requesterRole !== "super_admin") {
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
    actor_user_id: req.authUser.id,
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

export { router as authRouter };
