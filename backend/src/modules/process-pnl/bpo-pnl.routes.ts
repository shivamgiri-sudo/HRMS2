import { Router } from "express";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { bpoPnlService } from "./bpo-pnl.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
  "payroll_head",
] as const;

function filters(req: AuthenticatedRequest) {
  return {
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  };
}

router.get("/summary", h(async (req, res) => {
  const data = await bpoPnlService.getSummary(filters(req));
  res.json({ success: true, data });
}));

router.get("/processes/:processId", h(async (req, res) => {
  const data = await bpoPnlService.getProcessDetail(req.params.processId, filters(req));
  res.json({ success: true, data });
}));

router.get("/export", h(async (req, res) => {
  const csv = await bpoPnlService.exportCsv(filters(req));
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bpo-process-pnl-${req.query.period ?? "current"}.csv"`
  );
  res.send(csv);
}));

router.get("/revenue-rules", h(async (req, res) => {
  const data = await bpoPnlService.listRevenueRules(
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.post(
  "/revenue-rules",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlService.saveRevenueRule(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/delivery-actuals",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlService.saveDeliveryActual(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/revenue-components",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlService.saveRevenueComponent(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/cost-components",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlService.saveCostComponent(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/allocation-policies",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlService.saveAllocationPolicy(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

export { router as bpoPnlRouter };
