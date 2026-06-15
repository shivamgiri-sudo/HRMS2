import { Router } from "express";
import rateLimit from "express-rate-limit";
import { authService } from "./auth.service.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { emailService } from "../communication/email.service.js";
import { env } from "../../config/env.js";

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10, // 10 attempts per window per IP
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

  if (token) {
    if (emailService.isConfigured()) {
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
    } else {
      // Never log the reset URL or token. Administrators can check SMTP readiness
      // through the protected launch configuration endpoint.
      console.warn("[HRMS] SMTP is not configured; password reset email was not sent.");
    }
  }

  // Always return success to prevent email enumeration.
  return res.json({ success: true, message: "If that email exists, a reset link has been sent." });
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

// POST /api/auth/change-password — Employee self-service password change
// Employee can only change their own password
router.post("/change-password", requireAuth, h(async (req: any, res: any) => {
  const { currentPassword, newPassword } = req.body;

  if (!currentPassword || !newPassword) {
    return res.status(400).json({
      success: false,
      error: "Current password and new password are required"
    });
  }

  if (currentPassword === newPassword) {
    return res.status(400).json({
      success: false,
      error: "New password must be different from current password"
    });
  }

  // Password strength validation
  if (newPassword.length < 8) {
    return res.status(400).json({
      success: false,
      error: "Password must be at least 8 characters long"
    });
  }

  if (!/[A-Z]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      error: "Password must contain at least one uppercase letter"
    });
  }

  if (!/[a-z]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      error: "Password must contain at least one lowercase letter"
    });
  }

  if (!/\d/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      error: "Password must contain at least one number"
    });
  }

  if (!/[!@#$%^&*(),.?":{}|<>]/.test(newPassword)) {
    return res.status(400).json({
      success: false,
      error: "Password must contain at least one special character"
    });
  }

  const { db } = await import("../../db/mysql.js");
  const bcrypt = await import("bcrypt");

  // Get user's current password hash from auth_user table
  const [userRows] = await db.execute(
    `SELECT id, email, password_hash FROM auth_user WHERE id = ?`,
    [req.authUser.id]
  );

  if (!(userRows as any[]).length) {
    return res.status(404).json({ success: false, error: "User not found" });
  }

  const user = (userRows as any[])[0];

  // Verify current password
  const isValid = await bcrypt.compare(currentPassword, user.password_hash);
  if (!isValid) {
    return res.status(401).json({
      success: false,
      error: "Current password is incorrect"
    });
  }

  // Hash new password
  const hashedPassword = await bcrypt.hash(newPassword, 10);

  // Update password and clear must_change_password flag
  await db.execute(
    `UPDATE auth_user
     SET password_hash = ?,
         must_change_password = 0,
         password_changed_at = NOW()
     WHERE id = ?`,
    [hashedPassword, req.authUser.id]
  );

  // Log password change action (optional - only if audit_log table exists)
  try {
    await db.execute(
      `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
       VALUES (?, 'PASSWORD_CHANGE', 'user', ?, ?, ?)`,
      [
        req.authUser.id,
        req.authUser.id,
        JSON.stringify({ self_service: true }),
        req.ip || req.connection?.remoteAddress
      ]
    );
  } catch (err) {
    // Audit log is optional
    console.warn("[HRMS] Audit log failed (table may not exist):", err);
  }

  // Send confirmation email
  try {
    await emailService.send({
      to: user.email,
      subject: "Password Changed Successfully",
      html: `
        <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
          <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
            <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
              <h2 style="margin:0;font-size:22px">Password Changed</h2>
            </div>
            <div style="padding:26px">
              <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Your HRMS password was successfully changed.</p>
              <div style="background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0">
                <p style="margin:0;font-size:13px;color:#64748b">Changed at: ${new Date().toLocaleString()}</p>
                <p style="margin:8px 0 0;font-size:13px;color:#64748b">IP Address: ${req.ip || req.connection?.remoteAddress || "Unknown"}</p>
              </div>
              <p style="font-size:14px;line-height:1.6;margin:16px 0;color:#dc2626;font-weight:600">⚠️ If you did not make this change, please contact IT support immediately.</p>
              <p style="font-size:13px;line-height:1.6;color:#64748b;margin:16px 0 0">Remember: Never share your password with anyone.</p>
            </div>
          </div>
        </div>
      `,
      text: `Your HRMS password was successfully changed.\n\nChanged at: ${new Date().toLocaleString()}\nIP Address: ${req.ip || "Unknown"}\n\nIf you did not make this change, please contact IT support immediately.\n\nRemember: Never share your password with anyone.`
    });
  } catch (emailError) {
    console.error("Failed to send password change confirmation email:", emailError);
    // Don't fail the request if email fails
  }

  return res.json({
    success: true,
    message: "Password changed successfully"
  });
}));

// POST /api/auth/admin-reset-password — Admin password reset for employees
// Super Admin can reset for positions <= Level 8 (Manager, Team Lead, Staff, etc.)
// WFM Admin can reset for positions <= Level 6 (Assistant Manager and below)
// Cannot reset for: CEO, Directors, VPs, Admin, HR Manager, Payroll Manager, etc.
router.post("/admin-reset-password", requireAuth, h(async (req: any, res: any) => {
  const { userId, employeeId } = req.body;

  if (!userId && !employeeId) {
    return res.status(400).json({
      success: false,
      error: "Either userId or employeeId is required"
    });
  }

  const { db } = await import("../../db/mysql.js");
  const { hasRole, getEmployeeForUser } = await import("../../shared/accessGuard.js");
  const { canResetPassword, generateTemporaryPassword } = await import("../../shared/positionHierarchy.js");
  const bcrypt = await import("bcrypt");

  // Check if requester has admin/wfm role
  const isAdmin = await hasRole(req.authUser.id, "admin", "super_admin");
  const isWFMAdmin = await hasRole(req.authUser.id, "wfm", "wfm_admin");

  if (!isAdmin && !isWFMAdmin) {
    return res.status(403).json({
      success: false,
      error: "Only Admin or WFM Admin can reset employee passwords"
    });
  }

  // Get requester's employee record and designation
  const requesterEmployee = await getEmployeeForUser(req.authUser.id);
  const requesterDesignation = requesterEmployee?.designation || null;
  const requesterRole = isAdmin ? "admin" : "wfm_admin";

  // Get target user and employee info
  let targetUserId = userId;
  let targetEmployee: any = null;

  if (employeeId) {
    const [empRows] = await db.execute(
      `SELECT e.*, u.id AS user_id
       FROM employees e
       LEFT JOIN users u ON u.id = e.user_id
       WHERE e.id = ?`,
      [employeeId]
    );
    if (!(empRows as any[]).length) {
      return res.status(404).json({ success: false, error: "Employee not found" });
    }
    targetEmployee = (empRows as any[])[0];
    targetUserId = targetEmployee.user_id;
  } else {
    const [userRows] = await db.execute(
      `SELECT u.id, e.designation, e.id AS employee_id
       FROM users u
       LEFT JOIN employees e ON e.user_id = u.id
       WHERE u.id = ?`,
      [userId]
    );
    if (!(userRows as any[]).length) {
      return res.status(404).json({ success: false, error: "User not found" });
    }
    const userInfo = (userRows as any[])[0];
    targetEmployee = { designation: userInfo.designation, id: userInfo.employee_id };
    targetUserId = userInfo.id;
  }

  if (!targetUserId) {
    return res.status(400).json({
      success: false,
      error: "Target employee does not have a user account"
    });
  }

  // Check hierarchical permission
  const targetDesignation = targetEmployee?.designation || null;
  const permissionCheck = canResetPassword(
    requesterRole,
    requesterDesignation,
    targetDesignation,
    targetUserId,
    req.authUser.id
  );

  if (!permissionCheck.allowed) {
    return res.status(403).json({
      success: false,
      error: permissionCheck.reason
    });
  }

  // Generate temporary password
  const tempPassword = generateTemporaryPassword();
  const hashedPassword = await bcrypt.hash(tempPassword, 10);

  // Update password and set force_password_change flag
  await db.execute(
    `UPDATE users
     SET password_hash = ?,
         force_password_change = 1,
         updated_at = NOW()
     WHERE id = ?`,
    [hashedPassword, targetUserId]
  );

  // Log password reset action
  await db.execute(
    `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
     VALUES (?, 'ADMIN_PASSWORD_RESET', 'user', ?, ?, ?)`,
    [
      req.authUser.id,
      targetUserId,
      JSON.stringify({
        target_user_id: targetUserId,
        target_designation: targetDesignation,
        requester_role: requesterRole,
        requester_designation: requesterDesignation
      }),
      req.ip || req.connection?.remoteAddress
    ]
  );

  // Get target user email for notification
  const [targetUserRows] = await db.execute(
    `SELECT email FROM users WHERE id = ?`,
    [targetUserId]
  );
  const targetUserEmail = (targetUserRows as any[])[0]?.email;

  // Send email notification with temporary password
  if (targetUserEmail) {
    try {
      await emailService.sendEmail({
        to: targetUserEmail,
        subject: "Your HRMS Password Has Been Reset",
        html: `
          <div style="font-family:Arial,sans-serif;background:#f6f8fc;padding:24px;color:#0f172a">
            <div style="max-width:620px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
              <div style="background:#0f172a;color:#ffffff;padding:22px 26px">
                <h2 style="margin:0;font-size:22px">Password Reset</h2>
              </div>
              <div style="padding:26px">
                <p style="font-size:15px;line-height:1.6;margin:0 0 16px">Your HRMS password has been reset by an administrator.</p>
                <div style="background:#f1f5f9;padding:16px;border-radius:8px;margin:20px 0">
                  <p style="margin:0 0 8px;font-size:13px;color:#64748b;font-weight:600">TEMPORARY PASSWORD</p>
                  <p style="margin:0;font-size:18px;font-family:monospace;font-weight:700;color:#0f172a">${tempPassword}</p>
                </div>
                <p style="font-size:14px;line-height:1.6;margin:16px 0;color:#dc2626;font-weight:600">⚠️ You will be required to change this password on your next login.</p>
                <p style="font-size:13px;line-height:1.6;color:#64748b;margin:16px 0 0">For security reasons, please log in and change your password immediately.</p>
              </div>
            </div>
          </div>
        `,
        text: `Your HRMS password has been reset.\n\nTemporary Password: ${tempPassword}\n\nYou will be required to change this password on your next login.\nFor security, please log in and change your password immediately.`
      });
    } catch (emailError) {
      console.error("Failed to send password reset email:", emailError);
      // Don't fail the request if email fails
    }
  }

  return res.json({
    success: true,
    temporaryPassword: tempPassword,
    message: "Password reset successfully. Temporary password has been sent to the employee's email."
  });
}));

export { router as authRouter };
