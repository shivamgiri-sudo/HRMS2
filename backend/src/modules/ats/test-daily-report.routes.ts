/**
 * Manual trigger for the daily recruiter productivity report.
 *
 * This was a PUBLIC endpoint marked "REMOVE AFTER TESTING" that never was. It took an
 * arbitrary `email` in the body and mailed the full branch/recruiter hiring report to it,
 * with no authentication — so anyone who could reach the host could have the company's
 * recruitment numbers delivered to an address of their choosing. Two matching backdoors
 * on the unauthenticated health router were removed at the same time.
 *
 * The capability is worth keeping: the scheduled 6 PM run (ats-daily-report.cron.ts) is
 * gated on ATS_DAILY_REPORT_ENABLED, and being able to send today's report on demand is
 * how you check the numbers before turning that on. It just has to be an authenticated,
 * authorised person doing it, sending to a known address.
 */
import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";

const testDailyReportRouter = Router();

/** Who may see recruitment performance across branches. */
const REPORT_ROLES = ["super_admin", "admin", "hr", "recruitment_hr", "branch_head"] as const;

/** Only company addresses — the original accepted any address at all. */
const ALLOWED_RECIPIENT = /@teammas\.(in|co\.in)$/i;

testDailyReportRouter.use(requireAuth);

testDailyReportRouter.post(
  "/trigger",
  requireRole(...REPORT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    const { date, email, preview } = (req.body ?? {}) as {
      date?: string;
      email?: string;
      preview?: boolean;
    };

    // A date is optional; when absent the report covers today. The old default was a
    // hardcoded '2026-08-24', which quietly returned a fixed historical day to anyone
    // who omitted it — the report looked like it worked and described the wrong date.
    if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ success: false, message: "date must be YYYY-MM-DD" });
    }

    try {
      const { runDailyHiringReport } = await import("./ats-reminders.cron.js");

      if (preview) {
        const result = await runDailyHiringReport(date, "preview");
        return res.json({ success: true, preview: true, data: result });
      }

      // Default to the caller's own address rather than a hardcoded personal one, so an
      // on-demand send goes to whoever asked for it.
      const target = (email ?? (req as any).user?.email ?? "").trim();
      if (!ALLOWED_RECIPIENT.test(target)) {
        return res.status(400).json({
          success: false,
          message: "Recipient must be a teammas.in / teammas.co.in address.",
        });
      }

      const result = await runDailyHiringReport(date, target);
      return res.json(result);
    } catch (error: any) {
      return res.status(500).json({ success: false, error: error?.message ?? "send failed" });
    }
  },
);

export default testDailyReportRouter;
