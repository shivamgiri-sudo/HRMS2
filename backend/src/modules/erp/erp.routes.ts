import { Router } from "express";
import type { Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import {
  vendorService, contractService, expenseService, procurementService,
  billingUnitService, billingInvoiceService, expensePolicyService,
} from "./erp.service.js";
import { syncVendorsFromDbBill } from "./vendor-sync.service.js";
import { vendorApprovalService } from "../finance/vendor-approval.service.js";
import { getUserBranchId } from "../finance/finance-access-scope.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

router.use(requireAuth);

// ─── Vendors ────────────────────────────────────────────────────────────────

router.get(
  "/vendors",
  requireRole("admin", "hr", "finance", "finance_head", "accounts_head", "branch_head", "branch_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const query = req.query as {
      is_active?: string;
      vendor_type?: string;
      q?: string;
      limit?: string;
      offset?: string;
      companyCode?: string;
      branchId?: string;
    };
    const listFilters = {
      ...query,
      // Applicability narrows the list only when the caller asks for a company or branch. A
      // plain /vendors call is unchanged, which is what every existing screen sends.
      companyCode: query.companyCode?.trim() || undefined,
      branchId: query.branchId?.trim() || undefined,
    };
    const data = await vendorService.list(listFilters);
    // `total` is how many vendors the filters match irrespective of limit/offset, so a capped
    // page can say so instead of presenting its own length as the whole population. Purely
    // additive — every existing caller reads `data` and is unaffected. Counted only when the
    // caller actually paginates; an unbounded call already has the full set in `data`.
    const total = listFilters.limit !== undefined && String(listFilters.limit).trim() !== ""
      ? await vendorService.count(listFilters)
      : data.length;
    res.json({ success: true, data, total });
  })
);

router.post(
  "/vendors/sync-from-ispark",
  requireRole("admin", "finance"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const result = await syncVendorsFromDbBill();
    res.json({ success: true, data: result });
  })
);

router.post(
  "/vendors",
  requireRole("admin", "hr", "finance", "finance_head", "super_admin", "branch_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.body.vendor_name?.trim()) {
      return res.status(400).json({ error: "vendor_name is required" });
    }

    // Duplicate name check — case-insensitive
    const existing = await vendorService.findByName(req.body.vendor_name);
    if (existing) {
      return res.status(409).json({
        error: `A vendor with this name already exists (code: ${existing.vendor_code})`,
        conflict: { vendor_code: existing.vendor_code },
      });
    }

    // Auto-generate vendor_code when the caller does not supply one
    if (!req.body.vendor_code?.trim()) {
      req.body.vendor_code = await vendorService.generateNextCode();
    }

    // Branch admin without an elevated finance role → approval workflow
    const userRoles: string[] = (req as any).userRoles ?? [];
    const elevatedRoles = new Set(["finance_head", "super_admin", "admin", "hr", "finance"]);
    const isOnlyBranchAdmin =
      userRoles.includes("branch_admin") && !userRoles.some(r => elevatedRoles.has(r));

    if (isOnlyBranchAdmin) {
      const branchId = await getUserBranchId(req.authUser!.id);
      const request = await vendorApprovalService.raise({
        requestType: "create",
        vendorId: null,
        payload: req.body,
        raisedBy: req.authUser!.id,
        branchId: branchId ?? "",
      });
      return res.status(202).json({ success: true, approval: true, data: request });
    }

    const data = await vendorService.create(req.body);
    res.status(201).json({ success: true, data });
  })
);

router.get(
  "/vendors/:id",
  requireRole("admin", "hr", "finance", "finance_head", "accounts_head", "branch_head", "branch_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await vendorService.getById(req.params.id);
    if (!data) return res.status(404).json({ error: "Vendor not found" });
    res.json({ success: true, data });
  })
);

router.put(
  "/vendors/:id",
  requireRole("admin", "hr", "finance", "finance_head", "super_admin", "branch_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    // Duplicate name check — skip if name unchanged
    if (req.body.vendor_name?.trim()) {
      const existing = await vendorService.findByName(req.body.vendor_name, req.params.id);
      if (existing) {
        return res.status(409).json({
          error: `A vendor with this name already exists (code: ${existing.vendor_code})`,
          conflict: { vendor_code: existing.vendor_code },
        });
      }
    }

    // Branch admin without elevated role → approval workflow
    const userRoles: string[] = (req as any).userRoles ?? [];
    const elevatedRoles = new Set(["finance_head", "super_admin", "admin", "hr", "finance"]);
    const isOnlyBranchAdmin =
      userRoles.includes("branch_admin") && !userRoles.some(r => elevatedRoles.has(r));

    if (isOnlyBranchAdmin) {
      const branchId = await getUserBranchId(req.authUser!.id);
      const request = await vendorApprovalService.raise({
        requestType: "update",
        vendorId: req.params.id,
        payload: req.body,
        raisedBy: req.authUser!.id,
        branchId: branchId ?? "",
      });
      return res.status(202).json({ success: true, approval: true, data: request });
    }

    const data = await vendorService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ error: "Vendor not found" });
    res.json({ success: true, data });
  })
);

// ─── Contracts ──────────────────────────────────────────────────────────────

router.get(
  "/contracts",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await contractService.list(req.query as { status?: string; vendor_id?: string });
    res.json({ success: true, data });
  })
);

router.post(
  "/contracts",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.body.contract_code?.trim() || !req.body.title?.trim() || !req.body.start_date) {
      return res.status(400).json({ error: "contract_code, title, and start_date are required" });
    }
    const data = await contractService.create(req.body, req.authUser!.id);
    res.status(201).json({ success: true, data });
  })
);

router.get(
  "/contracts/:id",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await contractService.getById(req.params.id);
    if (!data) return res.status(404).json({ error: "Contract not found" });
    res.json({ success: true, data });
  })
);

router.patch(
  "/contracts/:id",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, notes } = req.body as { status?: string; notes?: string };
    if (!status) return res.status(400).json({ error: "status is required" });
    const data = await contractService.updateStatus(req.params.id, status, notes);
    if (!data) return res.status(404).json({ error: "Contract not found" });
    res.json({ success: true, data });
  })
);

// ─── Expenses ────────────────────────────────────────────────────────────────

router.get(
  "/expenses",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const isPrivileged = await hasRole(userId, "admin", "hr", "finance");

    if (isPrivileged) {
      const data = await expenseService.list(req.query as { employee_id?: string; status?: string });
      return res.json({ success: true, data });
    }

    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ error: "No employee record found" });

    const data = await expenseService.list({ employee_id: emp.id, status: (req.query as Record<string, string>).status });
    res.json({ success: true, data });
  })
);

router.post(
  "/expenses",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (!req.body.expense_date || !req.body.amount) {
      return res.status(400).json({ error: "expense_date and amount are required" });
    }

    // admin/hr/finance can submit on behalf; otherwise derive from session
    let employeeId: string;
    if (req.body.employee_id && (await hasRole(userId, "admin", "hr", "finance"))) {
      employeeId = req.body.employee_id as string;
    } else {
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ error: "No employee record found" });
      employeeId = emp.id;
    }

    const data = await expenseService.create(req.body, employeeId);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  "/expenses/:id/review",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { action, remarks } = req.body as { action?: string; remarks?: string };
    if (action !== "approved" && action !== "rejected") {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }
    const data = await expenseService.review(req.params.id, action, req.authUser!.id, remarks);
    if (!data) return res.status(404).json({ error: "Expense claim not found" });
    res.json({ success: true, data });
  })
);

// ─── Procurement ─────────────────────────────────────────────────────────────

router.get(
  "/procurement",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    const isPrivileged = await hasRole(userId, "admin", "hr", "finance");

    if (isPrivileged) {
      const data = await procurementService.list(
        req.query as { requested_by?: string; status?: string; department_id?: string }
      );
      return res.json({ success: true, data });
    }

    const emp = await getEmployeeForUser(userId);
    if (!emp) return res.status(403).json({ error: "No employee record found" });

    const data = await procurementService.list({ requested_by: emp.id });
    res.json({ success: true, data });
  })
);

router.post(
  "/procurement",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const userId = req.authUser!.id;
    if (!req.body.item_name) {
      return res.status(400).json({ error: "item_name is required" });
    }

    let requestedBy: string;
    if (req.body.requested_by && (await hasRole(userId, "admin", "hr", "finance"))) {
      requestedBy = req.body.requested_by as string;
    } else {
      const emp = await getEmployeeForUser(userId);
      if (!emp) return res.status(403).json({ error: "No employee record found" });
      requestedBy = emp.id;
    }

    const data = await procurementService.create(req.body, requestedBy);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  "/procurement/:id/approve",
  requireRole("admin", "hr", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { action, remarks } = req.body as { action?: string; remarks?: string };
    if (action !== "approved" && action !== "rejected") {
      return res.status(400).json({ error: "action must be 'approved' or 'rejected'" });
    }
    const data = await procurementService.approve(req.params.id, action, req.authUser!.id, remarks);
    if (!data) return res.status(404).json({ error: "Procurement request not found" });
    res.json({ success: true, data });
  })
);

// ─── Billing Units ────────────────────────────────────────────────────────────

router.get(
  "/billing-units",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await billingUnitService.list(req.query as { process_id?: string });
    res.json({ success: true, data });
  })
);

router.post(
  "/billing-units",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.body.process_id || !req.body.effective_from) {
      return res.status(400).json({ error: "process_id and effective_from are required" });
    }
    const data = await billingUnitService.create(req.body);
    res.status(201).json({ success: true, data });
  })
);

// ─── Billing Invoices ─────────────────────────────────────────────────────────

router.get(
  "/invoices",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await billingInvoiceService.list(req.query as { process_id?: string; status?: string });
    res.json({ success: true, data });
  })
);

router.post(
  "/invoices/generate",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { process_id, period_from, period_to } = req.body as {
      process_id?: string; period_from?: string; period_to?: string;
    };
    if (!process_id || !period_from || !period_to) {
      return res.status(400).json({ error: "process_id, period_from, and period_to are required" });
    }
    const data = await billingInvoiceService.generate({ process_id, period_from, period_to }, req.authUser!.id);
    res.status(201).json({ success: true, data });
  })
);

router.patch(
  "/invoices/:id",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const data = await billingInvoiceService.update(req.params.id, req.body);
    if (!data) return res.status(404).json({ error: "Invoice not found" });
    res.json({ success: true, data });
  })
);

// ─── Expense Policies ────────────────────────────────────────────────────────

router.get(
  "/expense-policies",
  requireAuth,
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const data = await expensePolicyService.list();
    res.json({ success: true, data });
  })
);

router.put(
  "/expense-policies/:category",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const allowed = ["travel","accommodation","meals","transport","communication","office","other"];
    if (!allowed.includes(req.params.category)) {
      return res.status(400).json({ error: "Invalid category" });
    }
    const data = await expensePolicyService.upsert(req.params.category, req.body);
    if (!data) return res.status(404).json({ error: "Policy not found" });
    res.json({ success: true, data });
  })
);

export { router as erpRouter };
