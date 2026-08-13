/**
 * Payroll Readiness Categories Routes
 * Mounted at: /api/payroll/readiness-categories
 *
 *   GET /:runId            — full layered result for one payroll run
 *   GET /month/:month      — the same, resolved from the month's non-synthetic run
 *
 * WHY THESE ARE READ-ONLY
 *   Every endpoint here is a governance control. Nothing in this router mutates payroll,
 *   employee, bank, attendance or settlement data — deliberately, because a readiness gate that
 *   can also change the thing it measures is not a gate.
 *
 * SAMPLE REDACTION
 *   The service already refuses to select bank account numbers, PAN or UAN values into its
 *   samples. This router applies a second, independent pass (redactSamples) so that adding a
 *   sensitive column to a check's SELECT later cannot leak it onto a dashboard by accident.
 *   Defence in depth is warranted: this data reaches a page that branch-level roles can open.
 */
import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import {
  evaluateReadinessCategories,
  type CategoryCheckResult,
  type ReadinessCategoriesResult,
} from "./payroll-readiness-categories.service.js";

export const payrollReadinessCategoriesRouter = Router();

/**
 * Roles allowed to see per-employee drill-down samples.
 *
 * Everyone else who can reach the page still gets counts, states and layer summaries — enough
 * to act on — but no employee list. A readiness dashboard has no business handing a branch-level
 * account a roster of who has no bank account.
 */
const DRILLDOWN_ROLES = ["super_admin", "payroll_head", "finance_head", "admin"];

/** Same synthetic-run exclusion the two readiness pages use, so all three resolve the same run. */
const SYNTHETIC_RUN_CREATORS = ["test-auto-gen", "codex-e2e", "smoke-test", "demo-seed"];

/**
 * Keys that must never leave this router, regardless of what a check selects.
 *
 * Matched on substring, lowercased, so `account_number_enc`, `bankAccountNumber` and
 * `pan_number` are all caught without needing an exact list.
 */
const FORBIDDEN_SAMPLE_KEY_FRAGMENTS = [
  "account_number",
  "accountnumber",
  "acno",
  "ifsc",
  "pan",
  "uan",
  "aadhaar",
  "aadhar",
];

function isForbiddenKey(key: string): boolean {
  const k = key.toLowerCase();
  return FORBIDDEN_SAMPLE_KEY_FRAGMENTS.some((fragment) => k.includes(fragment));
}

function redactSamples(check: CategoryCheckResult, allowDrilldown: boolean): CategoryCheckResult {
  if (!check.sample) return check;
  if (!allowDrilldown) {
    const { sample: _sample, ...rest } = check;
    return { ...rest, detail: { ...(check.detail ?? {}), sample_withheld: "insufficient_role" } };
  }
  return {
    ...check,
    sample: check.sample.map((row) => {
      const clean: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(row)) {
        clean[key] = isForbiddenKey(key) ? "[redacted]" : value;
      }
      return clean;
    }),
  };
}

function shape(result: ReadinessCategoriesResult, allowDrilldown: boolean): ReadinessCategoriesResult {
  return { ...result, checks: result.checks.map((c) => redactSamples(c, allowDrilldown)) };
}

async function resolveRunForMonth(month: string): Promise<string | null> {
  const placeholders = SYNTHETIC_RUN_CREATORS.map(() => "?").join(", ");
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM salary_prep_run
      WHERE run_month = ?
        AND LOWER(COALESCE(created_by, '')) NOT IN (${placeholders})
      ORDER BY created_at DESC LIMIT 1`,
    [month, ...SYNTHETIC_RUN_CREATORS],
  );
  return ((rows[0] as RowDataPacket | undefined)?.id as string | undefined) ?? null;
}

payrollReadinessCategoriesRouter.get(
  "/month/:month",
  requireAuth,
  requireRole("super_admin", "payroll_head", "finance_head", "admin", "payroll", "branch_head", "process_manager"),
  async (req: AuthenticatedRequest, res: Response) => {
    const month = String(req.params.month ?? "");
    if (!/^\d{4}-\d{2}$/.test(month)) {
      return res.status(400).json({ success: false, message: "month must be YYYY-MM" });
    }
    try {
      const runId = await resolveRunForMonth(month);
      if (!runId) {
        return res.json({ success: true, month, status: "not_created", data: null });
      }
      const result = await evaluateReadinessCategories(runId);
      const allow = DRILLDOWN_ROLES.includes(String(req.authUser?.role ?? ""));
      return res.json({ success: true, month, status: "checked", data: shape(result, allow) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ReadinessCategories] month evaluation failed:", message);
      // Never a 200 with an empty-but-green body: an unevaluated gate must read as blocked.
      return res.status(503).json({
        success: false,
        status: "CHECK_ERROR",
        canPay: false,
        message: `Readiness categories could not be evaluated: ${message}`,
      });
    }
  },
);

payrollReadinessCategoriesRouter.get(
  "/:runId",
  requireAuth,
  requireRole("super_admin", "payroll_head", "finance_head", "admin", "payroll", "branch_head", "process_manager"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const result = await evaluateReadinessCategories(String(req.params.runId));
      const allow = DRILLDOWN_ROLES.includes(String(req.authUser?.role ?? ""));
      return res.json({ success: true, data: shape(result, allow) });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error("[ReadinessCategories] run evaluation failed:", message);
      return res.status(503).json({
        success: false,
        status: "CHECK_ERROR",
        canPay: false,
        message: `Readiness categories could not be evaluated: ${message}`,
      });
    }
  },
);

/** Test seam. */
export const __testables = { isForbiddenKey, redactSamples, shape };
