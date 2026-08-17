import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { resolveFinanceBranchScopeSet } from "./finance-access-scope.js";
import { imprestLedgerService } from "./imprest-ledger.service.js";
import { imprestService } from "./imprest.service.js";
import { listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";

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

/**
 * Owner ruling 2026-08-17: raising an imprest allocation is Finance Head and Super Admin ONLY.
 *
 * accounts_head was removed — an allocation is the act of releasing company money into a branch
 * float, and the owner placed that decision with Finance Head. Branch Head has no part in imprest
 * at all: the float is handed by Finance Head directly to the Branch Admin who will spend it.
 */
const IMPREST_WRITE_ROLES = ["finance_head", "super_admin"] as const;
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

/**
 * The allocation's own branch decides who may touch it, not the caller's role alone.
 *
 * Extracted from the approval-history read, which already did this and explained why. The review
 * endpoint next to it addresses the same :id, admits branch_head — a branch-scoped role — and had
 * no branch check at all, so a Branch Head could APPROVE or REJECT another branch's imprest
 * allocation while being correctly refused permission to READ its history. The write was less
 * guarded than the read, and money moves on the write.
 *
 * Returns the allocation's branch so a caller can 404 a missing row before deciding anything.
 */
async function assertAllocationBranch(req: AuthenticatedRequest, allocationId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT branch_id FROM imprest_allocation WHERE id = ? LIMIT 1`,
    [allocationId],
  );
  if (!rows[0]) return { found: false as const };
  const scope = await scopeOf(req);
  if (scope.mode === "branches" && !scope.branchIds.includes(String(rows[0].branch_id))) {
    return { found: true as const, allowed: false as const };
  }
  return { found: true as const, allowed: true as const };
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
    // Every other read here is branch-scoped; fetching one by id must not be the way around it.
    const scope = await scopeOf(req);
    if (scope.mode === "branches"
        && !scope.branchIds.includes(String((data as { branch_id?: unknown }).branch_id ?? ""))) {
      return res.status(403).json({ success: false, error: "You do not have access to this branch" });
    }
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

/**
 * Employees who could hold a branch float.
 *
 * A dedicated endpoint rather than bending the general employees API, for two reasons: the list
 * must be branch-scoped to the caller's entitlement like everything else here, and it must
 * exclude anyone with no `user_id`. An imprest manager is accountable for cash and has to be
 * able to log in and be recorded as the actor on a posting — 119 of 1,123 active employees have
 * no user account, and appointing one would create a float nobody can operate.
 */
imprestRouter.get(
  "/manager-candidates",
  requireRole(...IMPREST_MASTER_ROLES),
  h(async (req, res) => {
    const branchId = String(req.query.branchId ?? "").trim();
    if (!branchId) {
      return res.status(400).json({ success: false, error: "branchId is required" });
    }
    const scope = await scopeOf(req);
    if (scope.mode === "branches" && !scope.branchIds.includes(branchId)) {
      return res.status(403).json({ success: false, error: "You do not have access to this branch" });
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT e.id AS employee_id, e.user_id, e.employee_code, e.full_name
         FROM employees e
        WHERE e.branch_id = ?
          AND e.employment_status = 'active'
          AND e.user_id IS NOT NULL AND e.user_id <> ''
        ORDER BY e.full_name
        LIMIT 500`,
      [branchId],
    );
    res.json({ success: true, data: rows });
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
  // branch_head removed per the same ruling — the branch does not approve its own float.
  requireRole("finance_head", "super_admin"),
  h(async (req, res) => {
    try {
      const access = await assertAllocationBranch(req, req.params.id);
      if (!access.found) {
        return res.status(404).json({ success: false, error: "Imprest allocation not found" });
      }
      if (!access.allowed) {
        return res.status(403).json({ success: false, error: "You do not have access to this branch" });
      }
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

/** Approval history of one allocation — approve/reject, who, when, and the reason. */
imprestRouter.get(
  "/allocations/:id/approval-history",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const access = await assertAllocationBranch(req, req.params.id);
    if (!access.found) {
      return res.status(404).json({ success: false, error: "Imprest allocation not found" });
    }
    if (!access.allowed) {
      return res.status(403).json({ success: false, error: "You do not have access to this branch" });
    }
    const data = await listFinanceApprovalEvents("imprest_allocation", req.params.id);
    res.json({ success: true, data });
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
 * The Imprest Details report, and its CSV.
 *
 * THE COLUMN LIST IS A FORMAT CONTRACT taken from the supplied `Imprest_Details` workbook:
 *
 *   S.No. | Date | GRN | Exp. Head | Exp. SubHead | INFLOW | OUTFLOW | Balance |
 *   Mode | Chq No | Bank | Remarks
 *
 * Nothing here may be renamed, reordered or "improved" — Finance reconciles against this shape,
 * and a helpfully-added column is the kind of change that looks harmless and quietly breaks a
 * downstream sheet. The total row is part of the format too: the word "Total" sits in the
 * Exp. SubHead column, INFLOW and OUTFLOW are summed, and Balance is left BLANK, because the
 * total of a running balance means nothing.
 *
 * Rows resolve through the same scopeOf() as every other read, so the file can never contain a
 * branch the list would not show.
 */
imprestRouter.get(
  "/reports/details",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!from || !to) {
      return res.status(400).json({ success: false, error: "from and to dates are required" });
    }
    const data = await imprestLedgerService.getDetailsReport({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      from,
      to,
    });
    res.json({ success: true, data });
  }),
);

/** The same report as a CSV, in the reference workbook's exact column order. */
const IMPREST_DETAIL_COLUMNS = [
  "S.No.", "Date", "GRN", "Exp. Head", "Exp. SubHead", "INFLOW", "OUTFLOW", "Balance",
  "Mode", "Chq No", "Bank", "Remarks",
] as const;

imprestRouter.get(
  "/reports/details/export",
  requireRole(...IMPREST_READ_ROLES),
  h(async (req, res) => {
    const from = String(req.query.from ?? "");
    const to = String(req.query.to ?? "");
    if (!from || !to) {
      return res.status(400).json({ success: false, error: "from and to dates are required" });
    }
    const report = await imprestLedgerService.getDetailsReport({
      branchScope: await scopeOf(req),
      imprestManagerId: req.query.imprestManagerId ? String(req.query.imprestManagerId) : undefined,
      from,
      to,
    });

    const money = (value: number) => (value === 0 ? "0" : value.toFixed(2));
    const body = report.rows.map((row) => [
      row.serial,
      row.transaction_date,
      row.grn_number ?? "",
      row.expense_head ?? "",
      row.expense_sub_head ?? "",
      money(row.inflow),
      money(row.outflow),
      row.balance.toFixed(2),
      row.payment_mode ?? "",
      row.cheque_no ?? "",
      row.bank_name ?? "",
      row.remarks ?? "",
    ]);
    // "Total" in the Exp. SubHead column and a BLANK Balance, exactly as the reference has it.
    body.push([
      "", "", "", "", "Total",
      money(report.totals.inflow), money(report.totals.outflow),
      "", "", "", "", "",
    ]);

    // Remarks are free text written by whoever raised the voucher and routinely contain commas
    // ("Cash was paid to purchase X, Approved by Y"), so quoting is load-bearing here, not
    // defensive: an unquoted comma shifts every later column by one for that row alone.
    const escape = (value: unknown) => {
      const text = String(value ?? "");
      return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
    };
    const csv = [[...IMPREST_DETAIL_COLUMNS], ...body]
      .map((row) => row.map(escape).join(","))
      .join("\n");
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="Imprest_Details.csv"');
    res.send(csv);
  }),
);

export default imprestRouter;
