import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { publicRegistrationLimiter } from "../../middleware/rateLimiter.js";

/**
 * Public payroll surfaces — no authentication.
 *
 * This router exists separately from payroll.routes.ts because that router calls
 * `router.use(requireAuth)` before registering any route. The QR verification
 * endpoint lived there and was documented "PUBLIC (no auth)", but the router-level
 * guard meant every payslip QR scan got 401 "Missing authorization token" and the
 * verification page rendered "Payslip Not Found".
 *
 * Mounted in app.ts ahead of every other /api/payroll router so it is reached first.
 *
 * Only non-sensitive identity fields are returned. Salary figures are never exposed
 * here — compensation stays behind the authenticated payslip endpoints.
 */
export const payrollPublicRouter = Router();

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

const MONTH_MAP: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04",
  may: "05", june: "06", july: "07", august: "08",
  september: "09", october: "10", november: "11", december: "12",
};

/** "May - 2025" / "May 2025" / "2025-05" → "2025-05"; "" when unparseable. */
export function parseMonthYear(raw: string): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";

  // Already ISO-ish: 2025-05
  const iso = value.match(/^(\d{4})-(\d{1,2})$/);
  if (iso) {
    const month = Number(iso[2]);
    if (month >= 1 && month <= 12) return `${iso[1]}-${String(month).padStart(2, "0")}`;
    return "";
  }

  // "May - 2025", "May-2025", "May 2025"
  const parts = value.split(/\s*-\s*|\s+/).filter(Boolean);
  if (parts.length !== 2) return "";
  const monthNum = MONTH_MAP[parts[0].toLowerCase()];
  const year = parts[1];
  if (!monthNum || !/^\d{4}$/.test(year)) return "";
  return `${year}-${monthNum}`;
}

// GET /api/payroll/verify/payslip/:empCode/:monthYear — PUBLIC — payslip QR verification
//
// Rate-limited HERE, on the specific route, not by mounting the limiter on the whole
// "/api/payroll" prefix in app.ts — that previously throttled every authenticated
// payroll request (payslip/my, running-summary/me, ...) sharing this router's mount
// path, capping the entire office to 15 payroll requests per 10 minutes per IP.
payrollPublicRouter.get("/verify/payslip/:empCode/:monthYear", publicRegistrationLimiter, h(async (req: any, res: Response) => {
  const empCode = String(req.params.empCode ?? "").trim();
  const runMonth = parseMonthYear(String(req.params.monthYear ?? ""));

  if (!empCode || !runMonth) {
    return res.json({ verified: false, message: "Invalid or missing payslip reference" });
  }

  // Primary: look up via salary_payslip (exists for all months after backfill migration).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sp.payslip_ref, sp.generated_at, sp.generated_by,
            spr.run_month,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code
       FROM salary_payslip sp
       JOIN salary_prep_line spl ON spl.id = sp.prep_line_id
       JOIN salary_prep_run spr  ON spr.id = spl.run_id
       JOIN employees e          ON e.id   = sp.employee_id
      WHERE e.employee_code = ?
        AND spr.run_month   = ?
      LIMIT 1`,
    [empCode, runMonth]
  );

  // Fallback: payslip record may not exist yet (race between QR scan and backfill completing).
  // Read directly from salary_prep_line in that case so the scan never hard-fails.
  let rec = (rows as any[])[0];
  if (!rec) {
    const [fallback] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.employee_code
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e         ON e.id   = spl.employee_id
        WHERE e.employee_code = ?
          AND spr.run_month   = ?
        LIMIT 1`,
      [empCode, runMonth]
    );
    rec = (fallback as any[])[0];
  }

  if (!rec) {
    return res.json({ verified: false, message: "Payslip not found for this employee and period" });
  }

  return res.json({
    verified: true,
    employee_name: rec.employee_name,
    employee_code: rec.employee_code,
    run_month: rec.run_month,
    payslip_ref: rec.payslip_ref ?? `PS-${runMonth}-${empCode}`,
    generated_at: rec.generated_at ?? null,
    // NO SALARY FIGURE HERE, DELIBERATELY.
    //
    // This route is mounted at app.ts:380, ahead of every authenticated payroll router,
    // and takes no token: anyone may call it. It previously returned net_salary so the
    // holder could eyeball the amount, but employee codes are sequential (MAS47814,
    // MAS62951, …), so that turned an unauthenticated endpoint into a company-wide
    // salary directory — walk the codes, harvest ~58,000 net pays. CLAUDE.md forbids
    // exposing payroll figures on any non-payroll surface, and the sibling test
    // "never leaks salary figures on the public endpoint" has always encoded that rule;
    // it was failing, not stale.
    //
    // Verification does not need the amount. Name, code, period, payslip ref and
    // generated date already prove the slip in the holder's hand is genuine, and the
    // holder can read the amount off that slip. run_status and is_migrated are dropped
    // for the same reason — internal state is not the public's business.
  });
}));
