import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import type { NextFunction, Request, RequestHandler, Response } from "express";
import { authService } from "../modules/auth/auth.service.js";

/*
 * KEY BY SIGNED-IN USER, NOT BY OFFICE IP.
 *
 * Every limiter was keyed by client IP. A whole branch reaches HRMS from one public NAT address, so
 * every employee in an office shared ONE 300-500 req/min bucket: measured live 2026-10-06, the
 * remaining count on one IP fell by ~190/min with nobody on it but colleagues, and ordinary page
 * loads (employees/me, my-pending-count) came back 429 at busy times.
 *
 * An authenticated request is now counted against its own user. The token is VERIFIED (signature +
 * expiry) before its subject is used, so a forged or random token cannot mint fresh buckets — it
 * falls back to the IP key exactly as an anonymous request does.
 */
export function rateLimitKey(req: Request): string {
  const header = req.headers.authorization;
  if (header && header.startsWith("Bearer ")) {
    const token = header.slice(7).trim();
    if (token && !token.startsWith("mock-token")) {
      const user = authService.verifyAccessToken(token);
      if (user?.id) return `user:${user.id}`;
    }
  }
  return `ip:${ipKeyGenerator(req.ip ?? "")}`;
}

/** 500 req/min per signed-in user (per IP when anonymous) — global backstop applied before all routes */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  keyGenerator: rateLimitKey,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: { success: false, message: "Too many requests, please slow down" },
});

/** 300 req/min per user (per IP when anonymous) — for paginated list endpoints (employees, payslips, reports) */
const listEndpointLimiterRaw = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  keyGenerator: rateLimitKey,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});

/** 20 payroll runs per 5 min per user — expensive CPU+DB operation */
const payrollRunLimiterRaw = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  keyGenerator: rateLimitKey,
  legacyHeaders: false,
  message: { success: false, message: "Payroll calculation rate limit exceeded, please wait and retry" },
});

/**
 * 60 POST submissions per 10 min per IP — candidate self-registration.
 *
 * Applied only to POST routes (submit-enhanced, parse-resume), NOT to the GET
 * lookups (branch-aliases, recruiters). Previously the limiter was on the
 * whole router, so 3+ requests per candidate meant ~5 candidates from a shared
 * office IP would exhaust the budget. Now GETs are unlimited; only actual
 * submissions count. 60 covers a busy drive of ~60 candidates per 10-minute
 * window from a shared device/NAT; bots would need thousands of requests to
 * enumerate, so this still stops abuse.
 */
export const publicRegistrationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many registration attempts from this device. Please wait a few minutes and try again.",
  },
});

/** 150 req/min per user (per IP when anonymous) — for report generation endpoints */
const reportLimiterRaw = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  keyGenerator: rateLimitKey,
  legacyHeaders: false,
  message: { success: false, message: "Too many report requests, please slow down" },
});

/**
 * 60 submissions per 10 min per IP — open KPI capture page (/kpi-capture).
 *
 * Deliberately looser than publicRegistrationLimiter (15/10min). This form is one KPI per
 * submission and a whole ops team fills it from one office IP behind NAT: a team leader
 * entering 8 KPIs for 3 designations is 24 legitimate posts in a few minutes, which the
 * registration limit would block halfway through and lose their work. 60 still stops
 * scripted flooding of an unauthenticated write endpoint.
 */
export const kpiCaptureLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 60,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many submissions from this network. Please wait a few minutes and continue.",
  },
});

/**
 * 8 attempts per 15 min per IP — LMS admin self-link (POST /api/lms/admin-link).
 *
 * This endpoint verifies a caller-supplied LMS admin ID + password against the LMS's own
 * login endpoint and, on success, writes an identity mapping. It is a credential-guessing
 * surface even though it sits behind requireAuth, so it gets its own tight limit rather than
 * relying on globalLimiter — mirrors the LMS's own loginLimiter (10/15min).
 */
export const lmsAdminLinkLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 8,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many LMS admin link attempts. Please wait a few minutes and try again.",
  },
});

/*
 * COUNT EACH REQUEST ONCE PER LIMITER.
 *
 * The same limiter instance is mounted in front of many routers on one path —
 * `app.use("/api/employees", listEndpointLimiter, routerA)`, then routerB, routerC… and ~10 on
 * /api/payroll. A request that is not handled by the first router falls through to the next mount
 * and passed the limiter AGAIN, so one GET /api/employees/me was counted ~5 times (measured live:
 * remaining dropped 5-7 per single call) and the real budget was ~60/min, not 300. Ordinary page
 * loads then got 429. The limiter now runs at most once per request; later mounts just pass through.
 */
function oncePerRequest(limiter: RequestHandler, mark: string): RequestHandler {
  return (req: Request, res: Response, next: NextFunction) => {
    const flags = req as unknown as Record<string, boolean>;
    if (flags[mark]) return next();
    flags[mark] = true;
    return limiter(req, res, next);
  };
}

export const listEndpointLimiter = oncePerRequest(listEndpointLimiterRaw, "__rlListCounted");
export const reportLimiter = oncePerRequest(reportLimiterRaw, "__rlReportCounted");
export const payrollRunLimiter = oncePerRequest(payrollRunLimiterRaw, "__rlPayrollRunCounted");
