import { existsSync, mkdirSync } from "fs";
import path from "path";
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import multer from "multer";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { listFinanceApprovalEvents } from "../../shared/financeApprovalEvent.js";
import { budgetCoverageRouter } from "../process-pnl/budget-coverage.routes.js";
import { financeExpenseMasterService } from "../process-pnl/finance-expense-master.service.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScopeSet,
} from "./finance-access-scope.js";
import { resolveFinanceStageRole } from "./finance-workflow-role.js";
import { grnService } from "./grn.service.js";
import { smartGrnRouter } from "./grn-smart.routes.js";
import { vendorExpenseMappingService } from "./vendor-expense-mapping.service.js";
import { vendorApplicabilityService } from "./vendor-applicability.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";
import type { RoleKey } from "../../platform/policy/index.js";

const GRN_WRITE_ROLES: RoleKey[] = [
  "accounts_head",
  "finance_head",
  "super_admin",
  "admin",
  "branch_head",
  "branch_admin",
];
const GRN_READ_ROLES: RoleKey[] = [...GRN_WRITE_ROLES, "finance", "hr", "hr_admin"];
const GRN_REVIEW_ROLES: RoleKey[] = ["branch_head", "finance_head", "accounts_head", "super_admin"];
const GRN_REVERSAL_ROLES: RoleKey[] = ["finance_head", "super_admin"];
const EXPENSE_MASTER_READ_ROLES: RoleKey[] = [
  "super_admin",
  "admin",
  "branch_admin",
  "branch_head",
  "finance",
  "finance_head",
  "accounts_head",
];
const EXPENSE_MASTER_WRITE_ROLES: RoleKey[] = ["super_admin", "finance_head"];
/**
 * Adding a head or sub-head stays with Finance Head. Editing or deleting one that budgets, GRNs
 * and coverage reviews already reference by name is Super Admin only — a rename silently detaches
 * every historical row that still carries the old name.
 */
const EXPENSE_MASTER_EDIT_ROLES: RoleKey[] = ["super_admin"];

function assertSuperAdminForEdit(req: AuthenticatedRequest) {
  if (!req.body?.id) return;
  if (!userHasRole(req, "super_admin")) {
    throw Object.assign(
      new Error("Only a Super Admin can edit an existing expense head or sub-head"),
      { statusCode: 403 }
    );
  }
}

function expenseMasterErrorStatus(error: unknown) {
  const status = (error as { statusCode?: number } | null)?.statusCode;
  return typeof status === "number" ? status : 400;
}

const UPLOAD_DIR = "uploads/grn-attachments";
if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });

const upload = multer({
  dest: UPLOAD_DIR,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter(_req, file, callback) {
    const allowedExtensions = [".pdf", ".jpg", ".jpeg", ".png", ".webp"];
    const allowedMimeTypes = [
      "application/pdf",
      "image/jpeg",
      "image/png",
      "image/webp",
    ];
    const extension = path.extname(file.originalname).toLowerCase();
    callback(
      null,
      allowedExtensions.includes(extension) && allowedMimeTypes.includes(file.mimetype)
    );
  },
});

type ScopedGrnRequest = AuthenticatedRequest & { financeGrn?: any };

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

function userHasRole(req: AuthenticatedRequest, role: string) {
  return [req.authUser?.role, ...(req.userRoles ?? [])]
    .filter((value): value is string => Boolean(value))
    .some((value) => value.toLowerCase() === role.toLowerCase());
}

function errorStatus(error: unknown, fallback: number) {
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  if (
    message.includes("only access")
    || message.includes("cannot access")
    || message.includes("not mapped to an active employee branch")
  ) {
    return 403;
  }
  return fallback;
}

async function authorizeGrnBranch(
  req: ScopedGrnRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const user = actor(req);
    const grn = await grnService.getGrn(req.params.id);
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: grn.branch_id,
    });
    req.financeGrn = grn;
    next();
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "GRN not found";
    res.status(errorStatus(error, 404)).json({ error: message });
  }
}

export const grnRouter = Router();
grNRouterUseAuth(grnRouter);

function grNRouterUseAuth(router: Router) {
  router.use(requireAuth);
}

// Budget save/coverage/submit controls are mounted before the Process P&L router,
// preserving the existing public paths while enforcing 100% Head/Sub-head review.
grNRouterBudgetCoverageRoutes(grnRouter);

function grNRouterBudgetCoverageRoutes(router: Router) {
  router.use(budgetCoverageRouter);
}

// Allocation-aware smart GRNs are handled first. Legacy GRNs fall through to the
// existing handlers below, preserving all historical records and API contracts.
grNRouterSmartRoutes(grnRouter);

function grNRouterSmartRoutes(router: Router) {
  router.use("/grns", smartGrnRouter);
}

// Configurable Head/Sub-Head master used by branch budget, GRN and P&L.
grNExpenseMasterRoutes(grnRouter);

function grNExpenseMasterRoutes(router: Router) {
  router.get(
    "/expense-masters",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const includeInactive =
          (userHasRole(req, "finance_head") || userHasRole(req, "super_admin"))
          && String(req.query.includeInactive ?? "false") === "true";
        const data = await financeExpenseMasterService.list(includeInactive);
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load expense master",
        });
      }
    }
  );

  router.post(
    "/expense-heads",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        assertSuperAdminForEdit(req);
        const data = await financeExpenseMasterService.saveHead(
          req.body,
          req.authUser.id
        );
        res.status(req.body?.id ? 200 : 201).json({ success: true, data });
      } catch (error: unknown) {
        res.status(expenseMasterErrorStatus(error)).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to save expense head",
        });
      }
    }
  );

  router.post(
    "/expense-sub-heads",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        assertSuperAdminForEdit(req);
        const data = await financeExpenseMasterService.saveSubHead(
          req.body,
          req.authUser.id
        );
        res.status(req.body?.id ? 200 : 201).json({ success: true, data });
      } catch (error: unknown) {
        res.status(expenseMasterErrorStatus(error)).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to save expense sub-head",
        });
      }
    }
  );

  router.delete(
    "/expense-heads/:id",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_EDIT_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await financeExpenseMasterService.deleteHead(
          req.params.id,
          req.authUser.id
        );
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(expenseMasterErrorStatus(error)).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to delete expense head",
        });
      }
    }
  );

  router.delete(
    "/expense-sub-heads/:id",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_EDIT_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await financeExpenseMasterService.deleteSubHead(
          req.params.id,
          req.authUser.id
        );
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(expenseMasterErrorStatus(error)).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to delete expense sub-head",
        });
      }
    }
  );

  // ── Vendor → Head/Sub-head mapping (Requirement 2) ──────────────────────────
  // Declared here rather than on /api/erp with the rest of the vendor CRUD, because the
  // thing being restricted is the Finance expense master and the roles that may change it
  // are EXPENSE_MASTER_WRITE_ROLES, not the erp router's admin/hr/finance.

  router.get(
    "/vendors/:vendorId/expense-mappings",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await vendorExpenseMappingService.listForVendor(req.params.vendorId);
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load vendor expense mappings",
        });
      }
    }
  );

  router.put(
    "/vendors/:vendorId/expense-mappings",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const mappings = Array.isArray(req.body?.mappings) ? req.body.mappings : [];
        const data = await vendorExpenseMappingService.saveForVendor(
          req.params.vendorId,
          mappings,
          req.authUser.id
        );
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to save vendor expense mappings",
        });
      }
    }
  );

  /**
   * The legal entities a vendor can be made applicable to.
   *
   * finance_company is the master: MAS, IDC and Pikquick. There is no company_master table in
   * mas_hrms — the three entities were only ever discoverable as free text in
   * cost_centre_master.company_name, which is precisely why this list has to come from a
   * master rather than from a DISTINCT over a varchar.
   */
  router.get(
    "/companies",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (_req: AuthenticatedRequest, res) => {
      try {
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT company_code, company_name, grn_prefix, legacy_comp_id
             FROM finance_company
            WHERE active_status = 1
            ORDER BY company_name`
        );
        res.json({ success: true, data: rows });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load companies",
        });
      }
    }
  );

  /**
   * The approval history of one GRN — every transition, oldest first, with its reason.
   *
   * finance_approval_event had five writers and NO reader wired up. The imprest queue tells a
   * reviewer "the reason is kept on the voucher's history"; until now that was a promise the
   * system could not keep. A returned voucher recorded exactly why and nobody could read it back.
   *
   * Append-only, so a GRN returned twice shows BOTH reasons — which is the entire reason this
   * table exists rather than a reviewed_by/review_note pair that each transition overwrites.
   */
  router.get(
    "/grns/:id/approval-history",
    requireRole(...GRN_READ_ROLES),
    // Branch-guarded, not just role-guarded. The history carries rejection reasons and reviewer
    // commentary — the most candid text in the module — and without this a branch_admin could
    // read another branch's by id. A UUID is not an access control.
    authorizeGrnBranch,
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await listFinanceApprovalEvents("grn", req.params.id);
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load the approval history",
        });
      }
    }
  );

  // ── Vendor applicability: legal entity and branch (Vendor Master, three concepts) ──────
  // Deliberately a separate endpoint from the vendor CRUD on /api/erp. Identity is one thing,
  // and where that identity may be used is another — merging them is what produced 1,829
  // legacy vendor rows for 1,552 real vendors.

  router.get(
    "/vendors/:vendorId/applicability",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const data = await vendorApplicabilityService.getForVendor(req.params.vendorId);
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load vendor applicability",
        });
      }
    }
  );

  router.put(
    "/vendors/:vendorId/applicability",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        // Only the keys actually present are replaced. Sending companies alone must not clear
        // the branch list — they are independent concepts edited on separate tabs.
        const data = await vendorApplicabilityService.replaceForVendor(
          req.params.vendorId,
          {
            companyCodes: Array.isArray(req.body?.companyCodes) ? req.body.companyCodes : undefined,
            branches: Array.isArray(req.body?.branches) ? req.body.branches : undefined,
          },
          req.authUser.id
        );
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to save vendor applicability",
        });
      }
    }
  );

  /** The Ship-To a GRN should print: the vendor/branch override if set, else the branch's own. */
  router.get(
    "/vendors/:vendorId/ship-to",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const branchId = String(req.query.branchId ?? "");
        if (!branchId) {
          return res.status(400).json({ success: false, error: "branchId is required" });
        }
        const data = await vendorApplicabilityService.resolveShipTo(req.params.vendorId, branchId);
        if (!data) return res.status(404).json({ success: false, error: "Branch not found" });
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to resolve the ship-to address",
        });
      }
    }
  );

  // The single server-side authority for what a GRN raiser may classify against:
  // vendor mapping INTERSECT approved budget with headroom. Branch-scoped like every other
  // finance read — a caller cannot ask about a branch they cannot see.
  router.get(
    "/expense-selectable",
    requireRole(...GRN_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const user = actor(req);
        const scope = await resolveFinanceBranchScopeSet({
          userId: user.id,
          primaryRole: user.role,
          userRoles: user.roles,
          requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
        });
        // Needs exactly one branch: budget headroom is per branch, so "which heads can I use"
        // is meaningless across several. Global callers must name one too.
        const branchId =
          scope.mode === "branches" && scope.branchIds.length === 1 ? scope.branchIds[0] : undefined;
        if (!branchId) throw new Error("Select a branch to see which expense heads are available");
        // Headroom is per branch AND per period, so the same argument that rejects a
        // multi-branch scope above rejects an absent period. Without it the SUM ran over every
        // active budget of the branch and HAVING available_amount > 0 passed on the multi-month
        // total, so this endpoint — which its own header calls "the single server-side authority
        // for what a GRN raiser may classify against" — offered a head with three months' worth
        // of headroom, and createDraft then refused the GRN against the one month that mattered.
        const periodCode = req.query.periodCode ? String(req.query.periodCode) : "";
        if (!/^\d{4}-\d{2}$/.test(periodCode)) {
          throw new Error("Select a budget period (YYYY-MM) to see which expense heads are available");
        }

        const data = await vendorExpenseMappingService.selectableClassifications({
          vendorId: req.query.vendorId ? String(req.query.vendorId) : undefined,
          branchId,
          periodCode,
          processId: req.query.processId ? String(req.query.processId) : undefined,
          costCentreId: req.query.costCentreId ? String(req.query.costCentreId) : undefined,
        });
        res.json({ success: true, data });
      } catch (error: unknown) {
        res.status(errorStatus(error, 400)).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to resolve selectable expense heads",
        });
      }
    }
  );
}

grnRouter.get(
  "/grns",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchScope = await resolveFinanceBranchScopeSet({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
      });

      const source = req.query.source ? String(req.query.source) : "new";
      if (!["new", "legacy", "all"].includes(source)) {
        return res.status(400).json({ error: "source must be new, legacy, or all" });
      }

      const num = (v: unknown) =>
        v === undefined || v === "" ? undefined : Number(v);

      const sharedFilters = {
        branchScope,
        processId:        req.query.processId        ? String(req.query.processId)        : undefined,
        costCentreId:     req.query.costCentreId      ? String(req.query.costCentreId)     : undefined,
        status:           req.query.status            ? String(req.query.status)            : undefined,
        grnNumber:        req.query.grnNumber         ? String(req.query.grnNumber)         : undefined,
        head:             req.query.head              ? String(req.query.head)              : undefined,
        subHead:          req.query.subHead           ? String(req.query.subHead)           : undefined,
        accountingPeriod: req.query.accountingPeriod  ? String(req.query.accountingPeriod)  : undefined,
        billDateFrom:     req.query.billDateFrom      ? String(req.query.billDateFrom)      : undefined,
        billDateTo:       req.query.billDateTo        ? String(req.query.billDateTo)        : undefined,
        amountFrom:       num(req.query.amountFrom),
        amountTo:         num(req.query.amountTo),
        search:           req.query.search            ? String(req.query.search)            : undefined,
        page:             req.query.page              ? Number(req.query.page)              : undefined,
        limit:            req.query.limit             ? Number(req.query.limit)             : undefined,
      };

      const newOnlyFilters = {
        invoiceNumber:      req.query.invoiceNumber      ? String(req.query.invoiceNumber)      : undefined,
        vendorId:           req.query.vendorId           ? String(req.query.vendorId)           : undefined,
        billingCycleStatus: req.query.billingCycleStatus ? String(req.query.billingCycleStatus) : undefined,
        createdBy:          req.query.createdBy          ? String(req.query.createdBy)          : undefined,
        multiMonth:
          req.query.multiMonth === undefined
            ? undefined
            : String(req.query.multiMonth) === "true",
        costClass:     req.query.costClass     ? String(req.query.costClass)     : undefined,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
        grnType:       req.query.grnType       ? String(req.query.grnType)       : undefined,
      };

      if (source === "new") {
        const result = await grnService.listGrns({ ...sharedFilters, ...newOnlyFilters });
        return res.json(result);
      }

      if (source === "legacy") {
        const result = await grnService.listLegacyGrns(sharedFilters);
        return res.json(result);
      }

      // source === "all": fetch both, merge by created_at DESC, return top 100
      const [newResult, legResult] = await Promise.all([
        grnService.listGrns({ ...sharedFilters, ...newOnlyFilters, limit: 100 }),
        grnService.listLegacyGrns({ ...sharedFilters, limit: 100 }),
      ]);

      const merged = [...newResult.data, ...legResult.data].sort((a, b) => {
        const ta = a.created_at ? new Date(String(a.created_at)).getTime() : 0;
        const tb = b.created_at ? new Date(String(b.created_at)).getTime() : 0;
        return tb - ta;
      });

      return res.json({
        data:  merged.slice(0, 100),
        total: newResult.total + legResult.total,
        page:  1,
        limit: 100,
      });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to list GRNs";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
  }
);

// Must stay above /grns/:id — Express matches in declaration order, and :id would otherwise
// capture "summary" and go looking for a GRN with that id.
grnRouter.get(
  "/grns/summary",
  requireRole(...GRN_READ_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchScope = await resolveFinanceBranchScopeSet({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
      });
      const result = await grnService.getGrnSummary({
        branchScope,
        financialYear: req.query.financialYear ? String(req.query.financialYear) : undefined,
      });
      res.json({ data: result });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to summarise GRNs";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
  }
);

grnRouter.get(
  "/grns/:id",
  requireRole(...GRN_READ_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    res.json({ data: req.financeGrn });
  }
);

grnRouter.post(
  "/grns",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const branchScope = await resolveFinanceBranchScopeSet({
        userId: user.id,
        primaryRole: user.role,
        userRoles: user.roles,
        requestedBranchId: req.body?.branchId,
      });
      // Creating a GRN needs exactly one branch, and the server must never pick it. A user
      // covering three branches who omits branchId is ambiguous, and silently defaulting to
      // the first would book someone else's spend against the wrong branch — invisible until
      // the P&L is wrong. resolveFinanceBranchScopeSet has already rejected a requested branch
      // outside their set, so reaching here with one branch means it is theirs.
      const branchId =
        branchScope.mode === "branches" && branchScope.branchIds.length === 1
          ? branchScope.branchIds[0]
          : undefined;
      if (!branchId) {
        throw new Error(
          branchScope.mode === "branches"
            ? "Select which branch this GRN belongs to"
            : "Branch is required",
        );
      }
      const result = await grnService.createDraft(
        { ...req.body, branchId },
        user.id,
        user.role
      );
      res.status(201).json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create GRN";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
  }
);

grnRouter.patch(
  "/grns/:id/billing-cycle",
  requireWriteAccess,
  requireRole("finance_head", "accounts_head", "super_admin"),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const raw = req.body?.billingCycleStatus;
      // null clears back to unclassified. Historical rows are NULL because the column
      // postdates them, so "not classified" has to stay reachable rather than forcing a guess.
      const value =
        raw === null || raw === "" || raw === undefined
          ? null
          : (String(raw).toUpperCase() as "OPEN" | "BOOKED" | "CLOSED");
      const data = await grnService.setBillingCycleStatus(req.params.id, value, user.id);
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(errorStatus(error, 400)).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to set billing status",
      });
    }
  }
);

// Declared on grnRouter, not smartGrnRouter: a returned GRN must be reachable for
// allocation-less historical rows too, which onlyWhenSmart would otherwise route away.
grnRouter.post(
  "/grns/:id/return",
  requireWriteAccess,
  requireRole("branch_head", "finance_head", "accounts_head", "super_admin"),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const target = String(req.body?.target ?? "branch_head") === "raiser" ? "raiser" : "branch_head";
      const data = await grnService.returnGrn(
        req.params.id,
        target,
        String(req.body?.reason ?? ""),
        user.id,
        user.role,
      );
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(errorStatus(error, 400)).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to return this GRN",
      });
    }
  }
);

grnRouter.post(
  "/grns/:id/resubmit",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const data = await grnService.resubmitReturnedGrn(
        req.params.id,
        user.id,
        user.role,
        req.body?.note ? String(req.body.note) : undefined,
      );
      res.json({ success: true, data });
    } catch (error: unknown) {
      res.status(errorStatus(error, 400)).json({
        success: false,
        error: error instanceof Error ? error.message : "Unable to resubmit this GRN",
      });
    }
  }
);

grnRouter.post(
  "/grns/:id/submit",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.submitForApproval(
        req.params.id,
        req.body,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to submit GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/review",
  requireWriteAccess,
  requireRole(...GRN_REVIEW_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const effectiveRole = resolveFinanceStageRole({
        primaryRole: user.role,
        userRoles: user.roles,
        currentStatus: String(req.financeGrn?.status ?? ""),
        workflow: "grn",
      });
      const result = await grnService.reviewGrn(
        req.params.id,
        req.body,
        user.id,
        effectiveRole
      );
      if (result.paymentId) {
        await vendorPaymentService
          .auditCreatedPayment(result.paymentId, user.id)
          .catch((error: unknown) => {
            console.error(
              "[finance] vendor payment creation audit failed:",
              error instanceof Error ? error.message : error
            );
          });
      }
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to review GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/cancel",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.cancelGrn(req.params.id, user.id, user.role);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to cancel GRN";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/reverse-consumption",
  requireWriteAccess,
  requireRole(...GRN_REVERSAL_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const reason = typeof req.body?.reason === "string" ? req.body.reason : "";
      const result = await grnService.reverseConsumption(
        req.params.id,
        reason,
        user.id,
        user.role
      );
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to reverse GRN consumption";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.post(
  "/grns/:id/attachment",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  upload.single("file"),
  async (req: ScopedGrnRequest, res) => {
    try {
      if (!req.file) {
        res.status(400).json({ error: "A PDF or supported image file is required" });
        return;
      }
      const user = actor(req);
      await grnService.saveAttachment(
        req.params.id,
        req.file.path,
        req.file.originalname,
        user.id,
        req.file.mimetype
      );
      res.json({ success: true, path: req.file.path });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Attachment upload failed";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.get(
  "/grns/:id/attachment",
  requireRole(...GRN_READ_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    const grn = req.financeGrn;
    const filePath = grn?.attachment_path ?? grn?.attachment_file_path;
    const fileName =
      grn?.attachment_original_name
      ?? grn?.attachment_file_name
      ?? "grn-attachment";
    if (!filePath || !existsSync(filePath)) {
      res.status(404).json({ error: "GRN attachment not found" });
      return;
    }
    res.download(filePath, fileName);
  }
);
