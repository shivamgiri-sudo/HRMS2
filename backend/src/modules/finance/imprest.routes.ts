import { Router } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveFinanceBranchScopeSet } from "./finance-access-scope.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import { imprestService } from "./imprest.service.js";

/**
 * Imprest API — manager master (Req 8), allocations (Req 6) and reports (Req 7).
 *
 * The services behind this file already existed and were fully tested, but nothing mounted
 * them: no route, no page, no reachable endpoint. That failure mode is invisible from a green
 * test run, and this repo has hit it before — a nonexistent /api/* path 401s exactly like a
 * real one, so probing cannot tell you the difference either.
 *
 * SCOPE IS RESOLVED PER REQUEST, NEVER TRUSTED FROM THE QUERY.
 * Every read resolves the caller's branch entitlement and passes it to the service, which turns
 * it into a predicate. `branchId` in the query narrows within that entitlement; it can never
 * widen it. The export path uses the SAME resolution as its list, so no export can return a row
 * its list would not.
 */

const IMPREST_WRITE_ROLES = ["finance_head", "accounts_head", "super_admin"] as const;
const IMPREST_MASTER_ROLES = ["finance_head", "super_admin"] as const;
const IMPREST_READ_ROLES = [
  ...IMPREST_WRITE_ROLES,
  "branch_admin",
  "branch_head",
  "admin",
  "finance",
] as const;

export const imprestRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

/** One resolution point, so a read and its export cannot drift apart. */
async function scopeOf(req: AuthenticatedRequest) {
  const user = actor(req);
  return resolveFinanceBranchScopeSet({
    userId: user.id,
    primaryRole: user.role,
    userRoles: user.roles,
    requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
  });
}

const fail = (res: any, error: unknown, fallback: string) =>
  res.status(400).json({
    success: false,
    error: error instanceof Error ? error.message : fallback,
  });

imprestRouter.use(requireAuth);

// ── Manager master (Requirement 8) ─────────────────────────────────────────────

imprestRouter.get(
  "/managers",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const data = await imprestService.listManagers({
      branchScope: await scopeOf(req),
      activeOnly: req.query.includeInactive === "1" ? false : undefined,
    });
    res.json({ success: true, data });
  }),
);

imprestRouter.get(
  "/managers/:id",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const data = await imprestService.getManager(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: "Imprest manager not found" });
    res.json({ success: true, data });
  }),
);

imprestRouter.post(
  "/managers",
  requireWriteAccess,
  requireRole(...IMPREST_MASTER_ROLES),
  h(async (req, res) => {
    try {
      const data = await imprestService.saveManager(req.body, actor(req).id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to save the imprest manager");
    }
  }),
);

imprestRouter.put(
  "/managers/:id",
  requireWriteAccess,
  requireRole(...IMPREST_MASTER_ROLES),
  h(async (req, res) => {
    try {
      const data = await imprestService.saveManager(
        { ...req.body, id: req.params.id },
        actor(req).id,
      );
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to save the imprest manager");
    }
  }),
);

// ── Allocations (Requirement 6) ────────────────────────────────────────────────

imprestRouter.get(
  "/allocations",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const data = await imprestService.listAllocations({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      status: req.query.status ? String(req.query.status) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
    });
    res.json({ success: true, data });
  }),
);

imprestRouter.post(
  "/allocations",
  requireWriteAccess,
  requireRole(...IMPREST_WRITE_ROLES),
  h(async (req, res) => {
    try {
      // The branch is taken from the body but validated against the caller's entitlement: an
      // allocation credits a real float, so raising one into a branch you cannot see would move
      // money out of sight.
      const scope = await resolveFinanceBranchScopeSet({
        ...actor(req),
        userId: actor(req).id,
        primaryRole: actor(req).role,
        userRoles: actor(req).roles,
        requestedBranchId: req.body?.branchId ? String(req.body.branchId) : undefined,
      });
      if (scope.mode === "branches" && !scope.branchIds.includes(String(req.body?.branchId ?? ""))) {
        return res.status(403).json({
          success: false,
          error: "You do not have access to this branch",
        });
      }
      const data = await imprestService.createAllocation(req.body, actor(req).id);
      res.status(201).json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to create the imprest allocation");
    }
  }),
);

imprestRouter.post(
  "/allocations/:id/review",
  requireWriteAccess,
  requireRole("branch_head", "finance_head", "super_admin"),
  h(async (req, res) => {
    try {
      const user = actor(req);
      const data = await imprestService.reviewAllocation(
        req.params.id,
        req.body?.decision === "reject" ? "reject" : "approve",
        user.id,
        user.role,
        req.body?.remarks ? String(req.body.remarks) : undefined,
      );
      res.json({ success: true, data });
    } catch (error) {
      fail(res, error, "Unable to review the imprest allocation");
    }
  }),
);

// ── Reports (Requirement 7) ────────────────────────────────────────────────────

imprestRouter.get(
  "/ledger",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const data = await imprestLedgerService.listEntries({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: req.query.limit ? Number(req.query.limit) : undefined,
    });
    res.json({ success: true, data });
  }),
);

imprestRouter.get(
  "/reports/balance",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!from || !to) {
      return res.status(400).json({ success: false, error: "from and to dates are required" });
    }
    const data = await imprestLedgerService.getPeriodSummary({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      from,
      to,
    });
    res.json({ success: true, data });
  }),
);

/**
 * CSV of the float ledger.
 *
 * Resolves rows through the same scopeOf() as GET /ledger — the rule is that no export may
 * return a row its list would not, and the only way to keep that true over time is for both to
 * call one helper.
 */
imprestRouter.get(
  "/ledger/export",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const rows = await imprestLedgerService.listEntries({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      from: req.query.from ? String(req.query.from) : undefined,
      to: req.query.to ? String(req.query.to) : undefined,
      limit: 1000,
    });

    const columns = [
      "Date", "Branch", "Entry Type", "Narration", "Reference",
      "Debit", "Credit", "Running Balance",
    ];
    // Running balance is computed here rather than stored, for the same reason the service
    // derives the closing balance: a stored balance and a summed one eventually disagree.
    let running = 0;
    const body = (rows as Record<string, unknown>[]).map((row) => {
      const debit = String(row.direction) === "debit" ? Number(row.amount ?? 0) : 0;
      const credit = String(row.direction) === "credit" ? Number(row.amount ?? 0) : 0;
      running = Math.round((running + credit - debit) * 100) / 100;
      return [
        String(row.transaction_date ?? "").slice(0, 10),
        row.branch_name ?? "",
        row.entry_type ?? "",
        row.narration ?? "",
        row.reference_id ?? "",
        debit ? debit.toFixed(2) : "",
        credit ? credit.toFixed(2) : "",
        running.toFixed(2),
      ];
    });

    const escape = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [columns, ...body].map((row) => row.map(escape).join(",")).join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="imprest-ledger.csv"');
    res.send(csv);
  }),
);

export default imprestRouter;
