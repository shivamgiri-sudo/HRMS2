import { Router } from "express";
import {
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
  resolveFinanceProcessScope,
} from "../finance/finance-access-scope.js";
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

/**
 * The process this caller may read, from the one they asked for.
 *
 * Was a plain read of req.query.processId. PNL_READ_ROLES admits process_manager explicitly
 * because "resolveFinanceProcessScope pins a process manager to their own process" — but no
 * route in this file called it, so a process manager could name any processId and read another
 * manager's LOB rate cards, monthly plans and delivery actuals. resolveFinanceProcessScope
 * refuses a request for someone else's process rather than silently substituting their own,
 * so a caller is told no instead of being handed the wrong data.
 *
 * A global finance role still gets exactly what it asked for.
 */
async function scopedProcessId(req: AuthenticatedRequest) {
  const requested = String(req.query.processId ?? "").trim();
  if (!requested) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
  const processId = await resolveFinanceProcessScope({
    userId: req.authUser.id,
    primaryRole: req.authUser.role,
    userRoles: req.userRoles,
    requestedProcessId: requested,
  });
  if (!processId) throw Object.assign(new Error("processId is required"), { statusCode: 400 });
  return processId;
}

router.get("/", h(async (req, res) => {
  // Optional here, so it is resolved rather than required: a process manager listing without a
  // processId gets their own process rather than every process's LOB master.
  const scoped = await resolveFinanceProcessScope({
    userId: req.authUser.id,
    primaryRole: req.authUser.role,
    userRoles: req.userRoles,
    requestedProcessId: req.query.processId ? String(req.query.processId) : undefined,
  });
  const data = await processLobService.listLobs({
    processId: scoped,
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
  // Optional, like the LOB list above, so resolved rather than required.
  const data = await processLobService.listPlans(
    req.query.period ? String(req.query.period) : undefined,
    await resolveFinanceProcessScope({
      userId: req.authUser.id,
      primaryRole: req.authUser.role,
      userRoles: req.userRoles,
      requestedProcessId: req.query.processId ? String(req.query.processId) : undefined,
    })
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
    await scopedProcessId(req),
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

// Was the only attribution endpoint in this file with neither a role list nor a branch check —
// its three siblings below all assert the record's branch before returning it. A vendor payment
// carries the branch's spend against a named vendor, so an unscoped read by paymentId let any
// role PNL_READ_ROLES admits (branch_head, process_manager) fetch another branch's attribution
// by guessing or replaying a uuid. Same roles and same assertion as the GRN attribution
// endpoints it sits beside.
router.get(
  "/vendor-payment-attribution/:paymentId",
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    // get() returns { payment, allocations, reconciliation } — the branch is on the payment,
    // not the envelope. The record is fetched first and asserted second, exactly as
    // assertGrnAttributionBranch does: the branch cannot be known until the row is read.
    const data = await vendorPaymentLobAttributionService.get(req.params.paymentId);
    await assertFinanceRecordBranch({
      userId: req.authUser.id,
      primaryRole: req.authUser.role,
      userRoles: req.userRoles,
      recordBranchId: String((data.payment as { branch_id?: unknown }).branch_id ?? ""),
    });
    res.json({ success: true, data });
  })
);

// GRN attribution is branch-scoped data. branch_admin and branch_head are
// allowed here but have no global finance scope, so every one of these
// endpoints resolves or asserts the branch before touching a record.
async function assertGrnAttributionBranch(req: AuthenticatedRequest, grnId: string) {
  await assertFinanceRecordBranch({
    userId: req.authUser.id,
    primaryRole: req.authUser.role,
    userRoles: req.userRoles,
    recordBranchId: await grnLobAttributionService.getBranchId(grnId),
  });
}

router.get(
  "/grn-attribution/pending",
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    // Returns the caller's own branch for branch_admin / branch_head, and
    // undefined (all branches) only for global finance roles.
    const branchId = await resolveFinanceBranchScope({
      userId: req.authUser.id,
      primaryRole: req.authUser.role,
      userRoles: req.userRoles,
      requestedBranchId: typeof req.query.branchId === "string" ? req.query.branchId : undefined,
    });
    const data = await grnLobAttributionService.listPending(
      req.query.limit ? Number(req.query.limit) : 100,
      branchId ?? null
    );
    res.json({ success: true, data });
  })
);

router.get(
  "/grn-attribution/:grnId",
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    await assertGrnAttributionBranch(req, req.params.grnId);
    const data = await grnLobAttributionService.getWorkspace(req.params.grnId);
    res.json({ success: true, data });
  })
);

router.put(
  "/grn-attribution/:grnId",
  requireWriteAccess,
  requireRole(...GRN_ATTRIBUTION_ROLES),
  h(async (req, res) => {
    await assertGrnAttributionBranch(req, req.params.grnId);
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
    await scopedProcessId(req),
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
    await scopedProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

router.get("/summary", h(async (req, res) => {
  const data = await processLobService.getProcessSummary(
    await scopedProcessId(req),
    req.query.period ? String(req.query.period) : undefined
  );
  res.json({ success: true, data });
}));

// branchId and processId are RESOLVED, not taken. PNL_READ_ROLES admits branch_head and
// process_manager on the stated basis that resolveFinanceBranchScope pins a branch head to their
// own branch and resolveFinanceProcessScope pins a process manager to their own process — this
// endpoint honoured neither, so omitting branchId returned every branch's full process P&L
// (revenue, agent salary, EBITDA, PAT) to a caller entitled to one. Both resolvers throw rather
// than quietly dropping a request for someone else's scope, which is why a filter that is
// silently ignored is the failure mode they exist to prevent. Same treatment as
// bpo-pnl.routes.ts's own summary endpoint.
router.get("/portfolio", h(async (req, res) => {
  const [branchId, processId] = await Promise.all([
    resolveFinanceBranchScope({
      userId: req.authUser.id,
      primaryRole: req.authUser.role,
      userRoles: req.userRoles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    }),
    resolveFinanceProcessScope({
      userId: req.authUser.id,
      primaryRole: req.authUser.role,
      userRoles: req.userRoles,
      requestedProcessId: req.query.processId ? String(req.query.processId) : undefined,
    }),
  ]);
  const data = await processLobService.getPortfolio({
    period: req.query.period ? String(req.query.period) : undefined,
    branchId,
    clientId: req.query.clientId ? String(req.query.clientId) : undefined,
    processId,
    search: req.query.search ? String(req.query.search) : undefined,
  });
  res.json({ success: true, data });
}));

export { router as processLobRouter };
