import { Router } from "express";
import { authService } from "./auth.service.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { emailService } from "../communication/email.service.js";
import { env } from "../../config/env.js";

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

// POST /api/auth/login — public
// Accepts: { identifier: "email or employee code", password } OR legacy { email, password }
router.post("/login", h(async (req: any, res: any) => {
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
  if (!email || !password || password.length < 6) {
    return res.status(400).json({ error: "email and password (min 6 chars) required" });
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

// POST /api/auth/forgot-password — public
router.post("/forgot-password", h(async (req: any, res: any) => {
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
  if (password.length < 6) return res.status(400).json({ error: "password must be at least 6 characters" });

  try {
    await authService.resetPassword(token, password);
    return res.json({ success: true });
  } catch (error: any) {
    return res.status(400).json({ error: error.message });
  }
}));

export { router as authRouter };
