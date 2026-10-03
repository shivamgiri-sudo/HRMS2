import { Router } from "express";
import { z } from "zod";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { evaluateRehire } from "./rehire/rehireEligibility.js";
import { loadRehireFacts } from "./rehire/rehireFacts.js";
import { isFormerReport } from "./rehire/rehireAccess.js";

export const employeeGovernanceRouter = Router();

employeeGovernanceRouter.use(requireAuth);

const DATE = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD");

// ── GET /:id/rehire-eligibility?proposed_joining_date=YYYY-MM-DD ──────────────
// Read-only. Powers the live eligibility panel on the raise form, so HR or a manager sees
// "blocked: terminated" BEFORE filling the form. Same facts and same rules as initiate and
// as the approval re-check, so the three can never disagree.
employeeGovernanceRouter.get(
  "/:id/rehire-eligibility",
  requireRole("hr", "admin", "super_admin", "manager", "branch_head"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const parsed = DATE.safeParse(req.query.proposed_joining_date);
      if (!parsed.success) {
        return res.status(400).json({ success: false, message: "proposed_joining_date (YYYY-MM-DD) is required" });
      }
      const employeeId = String(req.params.id);
      const userId = req.authUser!.id;

      if (!(await canViewEmployee(userId, employeeId))) {
        return res.status(403).json({ success: false, message: "This employee is outside your branch / assigned scope" });
      }
      if (req.authUser!.role === "manager" && !(await isFormerReport(pool, employeeId, userId))) {
        return res.status(403).json({ success: false, message: "You can look this up only for an employee who reported to you" });
      }

      const loaded = await loadRehireFacts(pool, employeeId, parsed.data);
      if (!loaded) return res.status(404).json({ success: false, message: "Employee not found" });

      return res.json({
        success: true,
        data: {
          employeeId,
          proposedJoiningDate: parsed.data,
          gapDays: loaded.facts.gapDays,
          previousEndDate: loaded.previousEndDate,
          eligibility: evaluateRehire(loaded.facts),
        },
      });
    } catch (err: any) {
      console.error("[Governance] rehire-eligibility failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to check eligibility" });
    }
  },
);
