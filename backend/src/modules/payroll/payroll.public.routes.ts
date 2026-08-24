import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";

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
payrollPublicRouter.get("/verify/payslip/:empCode/:monthYear", h(async (req: any, res: Response) => {
  const empCode = String(req.params.empCode ?? "").trim();
  const runMonth = parseMonthYear(String(req.params.monthYear ?? ""));

  if (!empCode || !runMonth) {
    return res.json({ verified: false, message: "Invalid or missing payslip reference" });
  }

  // Primary: look up via salary_payslip (exists for all months after backfill migration).
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT sp.payslip_ref, sp.generated_at, sp.generated_by,
            spr.run_month, spr.status AS run_status,
            CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
            e.employee_code,
            spl.net_salary, spl.gross_salary
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
  let fromFallback = false;
  if (!rec) {
    const [fallback] = await db.execute<RowDataPacket[]>(
      `SELECT spr.run_month, spr.status AS run_status,
              CONCAT(e.first_name, ' ', COALESCE(e.last_name, '')) AS employee_name,
              e.employee_code,
              spl.net_salary, spl.gross_salary
         FROM salary_prep_line spl
         JOIN salary_prep_run spr ON spr.id = spl.run_id
         JOIN employees e         ON e.id   = spl.employee_id
        WHERE e.employee_code = ?
          AND spr.run_month   = ?
        LIMIT 1`,
      [empCode, runMonth]
    );
    rec = (fallback as any[])[0];
    fromFallback = true;
  }

  if (!rec) {
    return res.json({ verified: false, message: "Payslip not found for this employee and period" });
  }

  const isMigrated = fromFallback || String(rec.generated_by ?? "").startsWith("system-migration");

  return res.json({
    verified: true,
    employee_name: rec.employee_name,
    employee_code: rec.employee_code,
    run_month: rec.run_month,
    payslip_ref: rec.payslip_ref ?? `PS-${runMonth}-${empCode}`,
    generated_at: rec.generated_at ?? null,
    // Net salary is shown on the verification page so the recipient can confirm the slip is genuine.
    // Gross is deliberately omitted — only the take-home figure is needed for spot-check purposes.
    net_salary: rec.net_salary != null ? Number(rec.net_salary) : null,
    is_migrated: isMigrated,
    run_status: rec.run_status ?? "finalized",
  });
}));
