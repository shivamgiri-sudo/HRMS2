import { Router } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { bpoPnlConfigurationService } from "./bpo-pnl.configuration.service.js";
import { processPnlGovernanceService } from "./process-pnl.governance.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const PNL_WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
] as const;

type UploadType =
  | "monthly_plan"
  | "revenue_rules"
  | "contracts"
  | "rate_cards"
  | "delivery_actuals"
  | "revenue_components"
  | "cost_components"
  | "classification_rules";

const VALID_TYPES = new Set<string>([
  "monthly_plan",
  "revenue_rules",
  "contracts",
  "rate_cards",
  "delivery_actuals",
  "revenue_components",
  "cost_components",
  "classification_rules",
]);

router.use(requireAuth);

router.post(
  "/pnl/bulk-upload",
  requireWriteAccess,
  requireRole(...PNL_WRITE_ROLES),
  h(async (req, res) => {
    const { type, rows } = req.body as { type: string; rows: Record<string, unknown>[] };
    const userId = req.authUser.id;

    if (!type || !VALID_TYPES.has(type)) {
      return res.status(400).json({
        success: false,
        error: `Invalid upload type. Must be one of: ${[...VALID_TYPES].join(", ")}`,
      });
    }

    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, error: "rows must be a non-empty array" });
    }

    if (rows.length > 500) {
      return res.status(400).json({ success: false, error: "Maximum 500 rows per upload" });
    }

    const uploadType = type as UploadType;
    const errors: Array<{ row: number; message: string }> = [];
    let imported = 0;

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const r = row as any;
        switch (uploadType) {
          case "monthly_plan":
            await processPnlGovernanceService.saveMonthlyPlan(r, userId);
            break;
          case "revenue_rules":
            await bpoPnlConfigurationService.saveRevenueRule(r, userId);
            break;
          case "contracts":
            await processPnlGovernanceService.saveContract(r, userId);
            break;
          case "rate_cards":
            await processPnlGovernanceService.saveRate(r, userId);
            break;
          case "delivery_actuals":
            await bpoPnlConfigurationService.saveDeliveryActual(r, userId);
            break;
          case "revenue_components":
            await bpoPnlConfigurationService.saveRevenueComponent(r, userId);
            break;
          case "cost_components":
            await bpoPnlConfigurationService.saveCostComponent(r, userId);
            break;
          case "classification_rules":
            await bpoPnlConfigurationService.saveClassificationRule(r, userId);
            break;
        }
        imported++;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        errors.push({ row: i + 2, message }); // +2: 1-indexed + header row
      }
    }

    const status = errors.length > 0 && imported === 0 ? 422 : 200;
    res.status(status).json({ success: true, imported, errors });
  })
);

export { router as pnlBulkUploadRouter };
