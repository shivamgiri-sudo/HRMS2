import { Router } from "express";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { grnLobAttributionService } from "../finance/grn-lob-attribution.service.js";
import { processLobCommercialService } from "./process-lob-commercial.service.js";
import { processLobService } from "./process-lob.service.js";
import { vendorPaymentLobAttributionService } from "./vendor-payment-lob-attribution.service.js";

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const LOB_WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance_head",
  "accounts_head",
] as const;

const ASSIGNMENT_WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance_head",
  "payroll_head",
] as const;

const GRN_ATTRIBUTION_ROLES = [
  "super_admin",
  "admin",
  "finance_head",
  "accounts_head",
  "branch_head",
  "branch_admin",
] as const;

function requiredProcessId(req: AuthenticatedRequest) {
  const processId = String(req.query.processId ?? "").trim();
  if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
  return processId;
}

router.get("/", h(async (req, res) => {
  const data = await processLobService.listLobs({
    processId: req.query.processId ? String(req.query.processId) : undefined,
    includeInactive: String(req.query.includeInactive ?? "false") === "true",
  });
  res.json({ success: true, data });
}));

router.post(
  "/",
  requireWriteAccess,
  requireRole(...LOB_WRITE_ROLES),
  h(async (req, res) => {
    const data = await processLobService.saveLob(req.body ?? {}, req.authUser.id);
    res.status(req.body?.id ? 200 : 201).json({ success: true, data });
  })
);

router.get("/plans", h(async (req, res) => {
  const data = await processLobService.listPlans(
    req.query.period ? String(req.query.period) : undefined,
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.post(
  "/plans",
  requireWriteAccess,
  requireRole(...LOB_WRITE_ROLES),
  h(async (req, res) => {
    const data = await processLobService.savePlan(req.body ?? {}, req.authUser.id);
    res.status(req.body?.id ? 200 : 201).json({ success: true, data });
  })
);

router.get("/commercial", h(async (req, res) => {
  const data = await processLobCommercialService.list(
    requiredProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.post(
  "/revenue-rules",
  requireWriteAccess,
  requireRole(...LOB_WRITE_ROLES),
  h(async (req, res) => {
    const data = await processLobCommercialService.saveRevenueRule(req.body ?? {}, req.authUser.id);
    res.status(req.body?.id ? 200 : 201).json({ success: true, data });
  })
);

router.post(
  "/delivery-actuals",
  requireWriteAccess,
  requireRole(...LOB_WRITE_ROLES),
  h(async (req, res) => {
    const data = await processLobCommercialService.saveDeliveryActual(req.body ?? {}, req.authUser.id);
    res.status(req.body?.id ? 200 : 201).json({ success: true, data });
  })
);

router.get(
  "/vendor-payment-attribution/:paymentId",
  h(async (req, res) => {
    const data = await vendorPaymentLobAttributionService.get(req.params.paymentId);
    res.json({ success: true, data });
  })
);

router.get(
  "/grn-attribution/pending",
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    const data = await grnLobAttributionService.listPending(
      req.query.limit ? Number(req.query.limit) : 100
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/grn-attribution/:grnId",
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    const data = await grnLobAttributionService.getWorkspace(req.params.grnId);
    res.json({ success: true, data });
  })
);

router.put(
  "/grn-attribution/:grnId",
  requireWriteAccess,
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    const data = await grnLobAttributionService.apply(
      req.params.grnId,
      Array.isArray(req.body?.allocations) ? req.body.allocations : [],
      req.authUser.id,
      String(req.authUser.role ?? req.userRoles?.[0] ?? "unknown")
    );
    res.json({ success: true, data });
  })
);

router.get("/assignments", h(async (req, res) => {
  const data = await processLobService.listAssignments(
    requiredProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.post(
  "/assignments",
  requireWriteAccess,
  requireRole(...ASSIGNMENT_WRITE_ROLES),
  h(async (req, res) => {
    const data = await processLobService.saveAssignment(req.body ?? {}, req.authUser.id);
    res.status(req.body?.id ? 200 : 201).json({ success: true, data });
  })
);

router.get("/diagnostics", h(async (req, res) => {
  const data = await processLobService.getDiagnostics(
    requiredProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/summary", h(async (req, res) => {
  const data = await processLobService.getProcessSummary(
    requiredProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/portfolio", h(async (req, res) => {
  const data = await processLobService.getPortfolio({
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: req.query.branchId ? String(req.query.branchId) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    processId: req.query.processId ? String(req.query.processId) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  });
  res.json({ success: true, data });
}));

export { router as processLobRouter };
