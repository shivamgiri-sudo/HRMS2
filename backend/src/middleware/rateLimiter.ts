import rateLimit from "express-rate-limit";

/** 500 req/min per IP — global backstop applied before all routes */
export const globalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 500,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === "/api/health",
  message: { success: false, message: "Too many requests, please slow down" },
});

/** 300 req/min per IP — for paginated list endpoints (employees, payslips, reports) */
export const listEndpointLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many requests, please slow down" },
});

/** 20 payroll runs per 5 min per IP — expensive CPU+DB operation */
export const payrollRunLimiter = rateLimit({
  windowMs: 5 * 60 * 1000,
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Payroll calculation rate limit exceeded, please wait and retry" },
});

/**
 * 15 submissions per 10 min per IP — candidate self-registration.
 *
 * These endpoints are deliberately unauthenticated so a walk-in can register
 * from a shared device, which also means anyone on the internet can post to
 * them. A walk-in desk registers a handful of people an hour; anything beyond
 * this is enumeration, not use.
 */
export const publicRegistrationLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 15,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: "Too many registration attempts from this device. Please wait a few minutes and try again.",
  },
});

/** 150 req/min per IP — for report generation endpoints */
export const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
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
