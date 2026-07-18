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

/** 150 req/min per IP — for report generation endpoints */
export const reportLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 150,
  standardHeaders: true,
  legacyHeaders: false,
  message: { success: false, message: "Too many report requests, please slow down" },
});
