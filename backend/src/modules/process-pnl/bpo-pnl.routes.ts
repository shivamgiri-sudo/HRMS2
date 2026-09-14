import { Router } from "express";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveFinanceBranchScopeSet } from "../finance/finance-access-scope.js";
import { bpoPnlAllocationOverlayService } from "./bpo-pnl-allocation-overlay.service.js";
import { bpoPnlConfigurationService } from "./bpo-pnl.configuration.service.js";
import { isPeriodLocked } from "./finance-period-lock.js";
import { getCachedAllocationSummary } from "./canonical-pnl.service.js";

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

function filters(req: AuthenticatedRequest, scopedBranchId?: string | null) {
  return {
    period: req.query.period ? String(req.query.period) : undefined,
    branchId: scopedBranchId ?? (req.query.branchId ? String(req.query.branchId) : undefined),
    processId: req.query.processId ? String(req.query.processId) : undefined,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    search: req.query.search ? String(req.query.search) : undefined,
  };
}

async function scopedFilters(req: AuthenticatedRequest) {
  const user = req.authUser;
  // The SET, not a single branch. A finance user entitled to three branches used to get an
  // error here telling them to "select a single branch" — the P&L was simply unusable for
  // them. The base query ANDs the entitlement as an IN predicate, and the allocation overlay
  // already groups its cost pools by branch, so N branches need no change to the maths.
  const scope = await resolveFinanceBranchScopeSet({
    userId: user.id,
    primaryRole: user.role,
    userRoles: req.userRoles,
    requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
  });
  const base = filters(req, scope.mode === "branches" && scope.branchIds.length === 1
    ? scope.branchIds[0]
    : undefined);
  return scope.mode === "all" ? base : { ...base, branchIds: scope.branchIds };
}

// isPeriodLocked here is a transparency flag, not (yet) a snapshot substitution: these three
// handlers still recompute live even for a "locked" period. Only /pnl/period-close
// (canonical-pnl.service.ts getPeriodClose) actually serves the frozen pnl_period_snapshot,
// and only for its own unscoped, all-branch summary shape — the snapshot has no branch-filtered
// reconstruction today, so silently substituting it here for a branchId-scoped request would
// return the wrong (unfiltered) total, which is worse than an honestly-live number. Surfacing
// the flag at least makes the drift visible instead of silent; closing it fully is follow-up
// work, not bundled into this phase.
router.get("/summary", h(async (req, res) => {
  const scoped = await scopedFilters(req);
  // Shares the exact 60s cache /pnl/summary and /pnl/period-close already read through
  // (getCachedAllocationSummary, canonical-pnl.service.ts) — previously called
  // bpoPnlAllocationOverlayService.getSummary() directly and uncached, so this endpoint
  // (Process Matrix) and those two could show different operating-profit figures for up to
  // 60s after the same underlying data changed, even though all three compute from the
  // identical rows. See hrms2-pnl-page-architecture-audit memory.
  const [data, periodLocked] = await Promise.all([
    getCachedAllocationSummary(scoped),
    isPeriodLocked(scoped.period),
  ]);
  res.json({ success: true, data, isPeriodLocked: periodLocked });
}));

router.get("/processes/:processId", h(async (req, res) => {
  const scoped = await scopedFilters(req);
  const [data, periodLocked] = await Promise.all([
    bpoPnlAllocationOverlayService.getProcessDetail(req.params.processId, scoped),
    isPeriodLocked(scoped.period),
  ]);
  res.json({ success: true, data, isPeriodLocked: periodLocked });
}));

router.get("/export", h(async (req, res) => {
  const scoped = await scopedFilters(req);
  const [csv, periodLocked] = await Promise.all([
    bpoPnlAllocationOverlayService.exportCsv(scoped),
    isPeriodLocked(scoped.period),
  ]);
  res.setHeader("Content-Type", "text/csv");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename="bpo-process-pnl-${req.query.period ?? "current"}.csv"`
  );
  res.setHeader("X-Period-Locked", periodLocked ? "true" : "false");
  res.send(csv);
}));

router.get("/revenue-rules", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listRevenueRules(
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/delivery-actuals", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listDeliveryActuals(
    req.query.period ? String(req.query.period) : undefined,
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/revenue-components", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listRevenueComponents(
    req.query.period ? String(req.query.period) : undefined,
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/cost-components", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listCostComponents(
    req.query.period ? String(req.query.period) : undefined,
    req.query.processId ? String(req.query.processId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/allocation-policies", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listAllocationPolicies(
    req.query.branchId ? String(req.query.branchId) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/classification-rules", h(async (req, res) => {
  const data = await bpoPnlConfigurationService.listClassificationRules(
    req.query.processId ? String(req.query.processId) : undefined,
    req.query.branchId ? String(req.query.branchId) : undefined
  );
  res.json({ success: true, data });
}));

router.post(
  "/revenue-rules",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveRevenueRule(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/delivery-actuals",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveDeliveryActual(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/revenue-components",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveRevenueComponent(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/cost-components",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveCostComponent(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/allocation-policies",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveAllocationPolicy(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

router.post(
  "/classification-rules",
  requireWriteAccess,
  requireRole(...WRITE_ROLES),
  h(async (req, res) => {
    const data = await bpoPnlConfigurationService.saveClassificationRule(req.body ?? {}, req.authUser.id);
    res.status(201).json({ success: true, data });
  })
);

export { router as bpoPnlRouter };
