import { existsSync, mkdirSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
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
import { listFinanceApprovalEvents, recordFinanceApprovalEvent } from "../../shared/financeApprovalEvent.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { budgetCoverageRouter } from "../process-pnl/budget-coverage.routes.js";
import { vendorApprovalRouter } from "./vendor-approval.routes.js";
import { financeExpenseMasterService } from "../process-pnl/finance-expense-master.service.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScopeSet,
} from "./finance-access-scope.js";
import { resolveFinanceStageRole } from "./finance-workflow-role.js";
import { grnService } from "./grn.service.js";
import { grnReportService } from "./grn-report.service.js";
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
/*
 * Who may read the finance reports.
 *
 * Narrower than GRN_READ_ROLES on purpose. That list carries `hr`, `hr_admin` and `finance`
 * because they legitimately open individual GRNs, but a report is a bulk read of a branch's
 * spend with vendor names, invoice numbers, GST and payment dates on every row — a different
 * disclosure entirely. This is the set the reports were asked for: the four finance/branch
 * stage owners plus Super Admin, and `admin` alongside them because branch admins are commonly
 * provisioned carrying it too.
 *
 * Row scope is NOT this list's job: resolveFinanceBranchScopeSet still pins a branch_admin or
 * branch_head to their own branches, so being on this list buys the report, not the company.
 */
const FINANCE_REPORT_ROLES: RoleKey[] = [
  "super_admin",
  "admin",
  "finance_head",
  "accounts_head",
  "branch_head",
  "branch_admin",
];
/*
 * The GRN approval chain is two stages, not three.
 *
 * resolveFinanceStageRole(workflow: "grn") maps submitted -> branch_head and
 * branch_head_approved -> finance_head, and returns nothing else. The BUDGET workflow has a
 * third stage (finance_head_approved -> accounts_head); GRN does not. So accounts_head passed
 * this gate and then met "The current grn stage requires the finance_head role" from the
 * resolver — a grant the workflow could never honour, and a 400 where a 403 was the truth.
 *
 * accounts_head is not shut out of GRN; their authority is the PAYMENT step. A finance_head
 * approval moves a vendor GRN to pending_accounts_payment, and PAYMENT_WRITE_ROLES in
 * vendor-payment.routes.ts is exactly ["accounts_head", "super_admin"]. That is where the role
 * acts, and it is untouched.
 *
 * SMART_REVIEW_ROLES in grn-smart.routes.ts already reads ["branch_head", "finance_head",
 * "super_admin"] — the newer router encodes the correct rule, and this one had not caught up.
 *
 * Nobody loses an ability they had: a user holding accounts_head ALONE could never complete a
 * review, and one who also holds finance_head still passes on that role.
 */
const GRN_REVIEW_ROLES: RoleKey[] = ["branch_head", "finance_head", "super_admin"];
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
  // An explicit statusCode on the thrown error wins. Without this the period-override refusal
  // below built its Error with `{ statusCode: 403 }` and still reached the client as a 400 —
  // the deliberate code was read by nothing, exactly as expenseMasterErrorStatus above reads it.
  const explicit = (error as { statusCode?: number } | null)?.statusCode;
  if (typeof explicit === "number") return explicit;
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

// Vendor approval queue — raise/approve/reject vendor creation requests.
grnRouter.use(vendorApprovalRouter);

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

  // ── finance_config: vendor_expense_mapping_enforced toggle ──────────────────

  router.get(
    "/config/vendor-expense-mapping-enforced",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (_req: AuthenticatedRequest, res) => {
      try {
        const enforced = await vendorExpenseMappingService.isEnforced();
        res.json({ success: true, enforced });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to read enforcement config",
        });
      }
    },
  );

  router.patch(
    "/config/vendor-expense-mapping-enforced",
    requireWriteAccess,
    requireRole(...EXPENSE_MASTER_WRITE_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const enforced = req.body?.enforced === true ? "1" : "0";
        await db.execute(
          `UPDATE finance_config SET config_value = ?, updated_at = NOW()
            WHERE config_key = 'vendor_expense_mapping_enforced'`,
          [enforced],
        );
        await logSensitiveAction({
          actor_user_id: req.authUser.id,
          action_type: "vendor_expense_mapping_enforced_toggled",
          module_key: "finance",
          metadata: { enforced: enforced === "1" },
        });
        res.json({ success: true, enforced: enforced === "1" });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to update enforcement config",
        });
      }
    },
  );

  // ── Bulk vendor mapping summary (mapped vs unmapped counts) ─────────────────

  router.get(
    "/vendors/mapping-summary",
    requireRole(...EXPENSE_MASTER_READ_ROLES),
    async (req: AuthenticatedRequest, res) => {
      try {
        const unmappedOnly = String(req.query.unmappedOnly ?? "0") === "1";
        const [rows] = await db.execute<RowDataPacket[]>(
          `SELECT v.id, v.vendor_code, v.vendor_name, v.vendor_type, v.is_active,
                  COUNT(m.id) AS mapping_count
             FROM vendor_master v
             LEFT JOIN vendor_expense_mapping m ON m.vendor_id = v.id AND m.active_status = 1
            GROUP BY v.id
           ${unmappedOnly ? "HAVING mapping_count = 0" : ""}
            ORDER BY mapping_count ASC, v.vendor_name ASC`,
        );
        res.json({ success: true, data: rows });
      } catch (error: unknown) {
        res.status(400).json({
          success: false,
          error: error instanceof Error ? error.message : "Unable to load vendor mapping summary",
        });
      }
    },
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
        createdBy:          req.query.createdBy
          ? (String(req.query.createdBy) === "me" ? String(user.id) : String(req.query.createdBy))
          : undefined,
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

      // Every legacy row is grn_type='vendor' (listLegacyGrns' SELECT hardcodes it — db_bill
      // never mirrored imprest/salary entries into grn_entry_snapshot). A grnType=imprest filter
      // must exclude legacy rows rather than silently ignore the filter and return them anyway.
      const legacyExcludedByGrnType =
        newOnlyFilters.grnType !== undefined && newOnlyFilters.grnType !== "vendor";

      if (source === "legacy") {
        if (legacyExcludedByGrnType) {
          return res.json({ data: [], total: 0, page: 1, limit: sharedFilters.limit ?? 30 });
        }
        const result = await grnService.listLegacyGrns(sharedFilters);
        return res.json(result);
      }

      // source === "all": fetch both, merge by created_at DESC, return top 100
      const [newResult, legResult] = await Promise.all([
        grnService.listGrns({ ...sharedFilters, ...newOnlyFilters, limit: 100 }),
        legacyExcludedByGrnType
          ? Promise.resolve({ data: [], total: 0, page: 1, limit: 100 })
          : grnService.listLegacyGrns({ ...sharedFilters, limit: 100 }),
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

/*
 * FINANCE REPORTS
 *
 * Mounted at /grn-reports/*, NOT under /grns/*. `grnRouter.get("/grns/:id")` matches any single
 * segment, so a sibling "/grns/reports" would be swallowed by it and answered with "GRN not
 * found" — the router-shadowing failure this module has already been bitten by. A distinct
 * prefix cannot be shadowed by an :id route however the file is later reordered.
 *
 * Every one of these is read-only, role-gated to FINANCE_REPORT_ROLES, and row-scoped by
 * resolveFinanceBranchScopeSet — a branch_admin gets their branches and nothing else, whatever
 * branchId they send, because the requested branch narrows the scope set rather than replacing
 * it.
 */
async function reportScope(req: AuthenticatedRequest) {
  const user = actor(req);
  return grnReportFiltersFrom(
    req,
    await resolveFinanceBranchScopeSet({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId ? String(req.query.branchId) : undefined,
    })
  );
}

function grnReportFiltersFrom(req: AuthenticatedRequest, branchScope: Awaited<ReturnType<typeof resolveFinanceBranchScopeSet>>) {
  const str = (value: unknown) => (value ? String(value) : undefined);
  return {
    branchScope,
    branchId: str(req.query.branchId),
    financialYear: str(req.query.financialYear),
    // `month` is the FINANCE month and filters accounting_period. See grn-report.service.ts.
    month: str(req.query.month),
    head: str(req.query.head),
    subHead: str(req.query.subHead),
    expenseMode: str(req.query.expenseMode),
    grnNumber: str(req.query.grnNumber),
    vendorId: str(req.query.vendorId),
    status: str(req.query.status),
    pendingWith: str(req.query.pendingWith),
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  };
}

grnRouter.get(
  "/grn-reports/register",
  requireRole(...FINANCE_REPORT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await grnReportService.register(await reportScope(req));
      res.json({ success: true, ...data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to build the GRN register";
      res.status(errorStatus(error, 400)).json({ success: false, error: message });
    }
  }
);

grnRouter.get(
  "/grn-reports/audit-trail",
  requireRole(...FINANCE_REPORT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await grnReportService.auditTrail({
        ...(await reportScope(req)),
        entityType: req.query.entityType ? String(req.query.entityType) : undefined,
        action: req.query.action ? String(req.query.action) : undefined,
        from: req.query.from ? String(req.query.from) : undefined,
        to: req.query.to ? String(req.query.to) : undefined,
      });
      res.json({ success: true, ...data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to build the audit trail";
      res.status(errorStatus(error, 400)).json({ success: false, error: message });
    }
  }
);

grnRouter.get(
  "/grn-reports/topups",
  requireRole(...FINANCE_REPORT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await grnReportService.topups(await reportScope(req));
      res.json({ success: true, ...data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to build the top-up report";
      res.status(errorStatus(error, 400)).json({ success: false, error: message });
    }
  }
);

grnRouter.get(
  "/grn-reports/filters",
  requireRole(...FINANCE_REPORT_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const data = await grnReportService.filterOptions(await reportScope(req));
      res.json({ success: true, data });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Unable to load report filters";
      res.status(errorStatus(error, 400)).json({ success: false, error: message });
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

// Hard delete — creator-only (or super_admin), draft-only. See deleteDraftGrn's own comment for
// why this is safe where cancelGrn (status -> 'cancelled') is the right tool everywhere else.
grnRouter.delete(
  "/grns/:id",
  requireWriteAccess,
  requireRole(...GRN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const user = actor(req);
      const result = await grnService.deleteDraftGrn(req.params.id, user.id, user.role);
      res.json(result);
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to delete GRN";
      res.status(errorStatus(error, 400)).json({ error: message });
    }
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
      // Gate period-end cut-off bookings (accounting month ≠ bill date month) to elevated roles.
      //
      // branch_admin added 2026-08-20. 139ee3b7 granted branch_admin the accounting-period
      // override on the client, and 0337e3f3 ("align branch_admin's period override across
      // client and server") widened the server — but only grn-smart.routes.ts's
      // canOverridePeriod, which gates the invoice-components PUT. THIS list, on the CREATE
      // call the same form makes first, was left behind, so the alignment was never complete:
      // a branch_admin saw the period control enabled (BudgetLinkedGrnForm.tsx canOverridePeriod
      // names them), set a different month, and the very first request of the save died 403
      // with "GRN could not be saved" before anything was written.
      //
      // Keep this list identical to grn-smart.routes.ts's canOverridePeriod. It is ONLY the
      // period override; the round-off tolerance (grn-smart.service.ts isElevatedRole) and the
      // late-invoice reason requirement (grn-smart.routes.ts isRestrictedRole, which NAMES
      // branch_admin as restricted) are different money controls and stay on their own lists.
      const requestedPeriod = String(req.body?.accountingPeriod ?? "").trim();
      const billPeriod = String(req.body?.billDate ?? "").slice(0, 7);
      if (requestedPeriod && requestedPeriod !== billPeriod) {
        const periodOverrideRoles = ["finance_head", "accounts_head", "super_admin", "branch_admin"];
        if (!user.roles.some((r: string) => periodOverrideRoles.includes(r))) {
          throw Object.assign(
            new Error(
              "Only Finance Head, Accounts Head, Branch Admin or Super Admin may book an invoice into a different accounting month"
            ),
            { statusCode: 403 }
          );
        }
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

// ─────────────────────────────────────────────────────────────────────────────
// Vendor Debit Note — raised against an approved / paid GRN
// ─────────────────────────────────────────────────────────────────────────────
const DN_WRITE_ROLES: RoleKey[] = ["finance_head", "accounts_head", "super_admin"];
const DN_READ_ROLES: RoleKey[] = [...DN_WRITE_ROLES, "finance", "branch_admin", "branch_head", "admin"];

// P1-8: Statuses that mean Finance Head has approved the GRN and a vendor payment exists
// or is expected — the only statuses where a vendor debit note makes business sense.
const DN_ELIGIBLE_GRN_STATUSES = [
  "pending_accounts_payment", "payment_scheduled", "partially_paid", "paid", "approved",
];

grnRouter.post(
  "/grns/:id/debit-note",
  requireWriteAccess,
  requireRole(...DN_WRITE_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const grn = req.financeGrn!;
      // P1-8: Debit notes are vendor-only and only valid once Finance Head has approved.
      if (String(grn.grn_type) !== "vendor") {
        res.status(400).json({ error: "Debit notes can only be raised against vendor GRNs" });
        return;
      }
      if (!DN_ELIGIBLE_GRN_STATUSES.includes(String(grn.status))) {
        res.status(400).json({
          error: `Debit notes can only be raised against Finance Head-approved GRNs (current status: ${grn.status})`,
        });
        return;
      }
      const { dnDate, reason, amount, gstAmount, remarks } = req.body ?? {};
      if (!dnDate || !/^\d{4}-\d{2}-\d{2}$/.test(String(dnDate))) {
        res.status(400).json({ error: "dnDate is required (YYYY-MM-DD)" });
        return;
      }
      const parsedAmount = Number(amount);
      if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) {
        res.status(400).json({ error: "amount must be greater than zero" });
        return;
      }
      const VALID_REASONS = ["quality_deficiency","short_supply","price_difference","returns","other"];
      const resolvedReason = VALID_REASONS.includes(String(reason)) ? String(reason) : "other";

      const user = actor(req);
      const dnId = randomUUID();
      // Sequential DN number: branch prefix + YYYYMM + sequence
      const [seqRows] = await db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS cnt FROM vendor_debit_note WHERE branch_id = ? AND LEFT(dn_date,7) = ?`,
        [grn.branch_id, String(dnDate).slice(0, 7)]
      );
      const seq = Number((seqRows[0] as RowDataPacket).cnt ?? 0) + 1;
      const dnNumber = `DN-${String(grn.branch_id).slice(-4).toUpperCase()}-${String(dnDate).slice(0,7).replace("-","")}-${String(seq).padStart(4,"0")}`;

      await db.execute(
        `INSERT INTO vendor_debit_note
           (id, dn_number, grn_id, vendor_id, branch_id, dn_date, reason, amount,
            gst_amount, remarks, raised_by, created_by)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`,
        [
          dnId, dnNumber, grn.id, grn.vendor_id, grn.branch_id,
          dnDate, resolvedReason, parsedAmount,
          Number(gstAmount ?? 0), remarks?.trim() || null,
          user.id, user.id,
        ]
      );
      res.status(201).json({ success: true, data: { id: dnId, dn_number: dnNumber } });
    } catch (error: unknown) {
      const message = error instanceof Error ? error.message : "Failed to create debit note";
      res.status(400).json({ error: message });
    }
  }
);

grnRouter.get(
  "/grns/:id/debit-notes",
  requireRole(...DN_READ_ROLES),
  authorizeGrnBranch,
  async (req: ScopedGrnRequest, res) => {
    try {
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT * FROM vendor_debit_note WHERE grn_id = ? ORDER BY created_at DESC`,
        [req.params.id]
      );
      res.json({ success: true, data: rows });
    } catch (error: unknown) {
      res.status(500).json({ error: "Failed to fetch debit notes" });
    }
  }
);

// P1-8: Debit note lifecycle — approve (draft → approved) and cancel (draft/approved → cancelled).
// Settlement (approved → settled) is NOT IMPLEMENTED — requires Finance sign-off on vendor
// account reconciliation and payment adjustment workflow before this can be built.
grnRouter.post(
  "/debit-notes/:id/approve",
  requireWriteAccess,
  requireRole(...DN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const [dnRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM vendor_debit_note WHERE id = ? LIMIT 1",
        [req.params.id]
      );
      const dn = (dnRows as RowDataPacket[])[0];
      if (!dn) { res.status(404).json({ error: "Debit note not found" }); return; }
      if (String(dn.status) !== "draft") {
        res.status(400).json({ error: `Debit note is already ${dn.status} and cannot be approved` });
        return;
      }
      await assertFinanceRecordBranch({
        userId: user.id, primaryRole: user.role, userRoles: user.roles,
        recordBranchId: String(dn.branch_id),
      });
      const [result] = await db.execute<any>(
        `UPDATE vendor_debit_note
            SET status = 'approved', approved_by = ?, approved_at = NOW(), updated_by = ?
          WHERE id = ? AND status = 'draft'`,
        [user.id, user.id, req.params.id]
      );
      if ((result as any).affectedRows !== 1) {
        res.status(409).json({ error: "Debit note status changed; refresh and try again" });
        return;
      }
      await recordFinanceApprovalEvent({
        entityType: "debit_note",
        entityId: req.params.id,
        action: "approve",
        fromStatus: "draft",
        toStatus: "approved",
        decision: "approved",
        actorUserId: user.id,
        actorRole: user.role,
      });
      res.json({ success: true, newStatus: "approved" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to approve debit note";
      res.status(400).json({ error: msg });
    }
  }
);

grnRouter.post(
  "/debit-notes/:id/cancel",
  requireWriteAccess,
  requireRole(...DN_WRITE_ROLES),
  async (req: AuthenticatedRequest, res) => {
    try {
      const user = actor(req);
      const reason = String(req.body?.reason ?? "").trim();
      if (!reason) {
        res.status(400).json({ error: "A reason is required to cancel a debit note" });
        return;
      }
      const [dnRows] = await db.execute<RowDataPacket[]>(
        "SELECT * FROM vendor_debit_note WHERE id = ? LIMIT 1",
        [req.params.id]
      );
      const dn = (dnRows as RowDataPacket[])[0];
      if (!dn) { res.status(404).json({ error: "Debit note not found" }); return; }
      if (String(dn.status) === "cancelled") {
        res.status(400).json({ error: "Debit note is already cancelled" });
        return;
      }
      if (String(dn.status) === "settled") {
        res.status(400).json({ error: "Settled debit notes cannot be cancelled" });
        return;
      }
      await assertFinanceRecordBranch({
        userId: user.id, primaryRole: user.role, userRoles: user.roles,
        recordBranchId: String(dn.branch_id),
      });
      const prevStatus = String(dn.status);
      const [result] = await db.execute<any>(
        `UPDATE vendor_debit_note
            SET status = 'cancelled', updated_by = ?
          WHERE id = ? AND status NOT IN ('cancelled', 'settled')`,
        [user.id, req.params.id]
      );
      if ((result as any).affectedRows !== 1) {
        res.status(409).json({ error: "Debit note status changed; refresh and try again" });
        return;
      }
      await recordFinanceApprovalEvent({
        entityType: "debit_note",
        entityId: req.params.id,
        action: "cancel",
        fromStatus: prevStatus,
        toStatus: "cancelled",
        decision: "cancelled",
        actorUserId: user.id,
        actorRole: user.role,
        remarks: reason,
      });
      res.json({ success: true, newStatus: "cancelled" });
    } catch (error: unknown) {
      const msg = error instanceof Error ? error.message : "Failed to cancel debit note";
      res.status(400).json({ error: msg });
    }
  }
);
