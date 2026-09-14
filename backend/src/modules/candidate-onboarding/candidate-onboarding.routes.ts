import { Router, type Request, type Response, type NextFunction } from "express";
import rateLimit from "express-rate-limit";
import {
  logoutCandidateOnboarding,
  refreshCandidateOnboardingSession,
  resumeCandidateOnboarding,
  sendCandidateOnboardingOtp,
  startCandidateOnboarding,
  verifyCandidateOnboardingOtp,
} from "./candidate-onboarding.service.js";

export const candidateOnboardingRouter = Router();

const h = (fn: (req: Request, res: Response) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);

const meta = (req: Request) => ({
  ip: req.ip,
  userAgent: req.get("user-agent") ?? undefined,
});

const otpLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many OTP requests. Please try again later." },
});

function sessionTokenFrom(req: Request): string | undefined {
  return req.get("x-candidate-session-token") ?? req.get("authorization") ?? undefined;
}

candidateOnboardingRouter.post("/start", h(async (req, res) => {
  const token = String(req.body.token ?? req.query.token ?? "");
  const data = await startCandidateOnboarding(token, { mobile: req.body.mobile });
  return res.json({ success: true, data });
}));

candidateOnboardingRouter.post("/send-otp", otpLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  const data = await sendCandidateOnboardingOtp(token, { mobile: req.body.mobile }, meta(req));
  return res.json({ success: true, data });
}));

candidateOnboardingRouter.post("/verify-otp", otpLimiter, h(async (req, res) => {
  const token = String(req.body.token ?? "");
  const data = await verifyCandidateOnboardingOtp(
    token,
    { mobile: req.body.mobile, otp: req.body.otp, deviceId: req.body.deviceId },
    meta(req)
  );
  return res.json({ success: true, data });
}));

candidateOnboardingRouter.get("/resume", h(async (req, res) => {
  const token = String(req.query.token ?? "");
  const data = await resumeCandidateOnboarding(token, sessionTokenFrom(req));
  return res.json({ success: true, data });
}));

candidateOnboardingRouter.post("/refresh-session", h(async (req, res) => {
  const data = await refreshCandidateOnboardingSession(sessionTokenFrom(req));
  return res.json({ success: true, data });
}));

candidateOnboardingRouter.post("/logout", h(async (req, res) => {
  const data = await logoutCandidateOnboarding(sessionTokenFrom(req));
  return res.json({ success: true, data });
}));

export default candidateOnboardingRouter;
