import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { Router, type NextFunction, type Response } from "express";
import multer from "multer";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  assertFinanceRecordBranch,
  resolveFinanceBranchScope,
} from "./finance-access-scope.js";
import { vendorPaymentLedgerService } from "./vendor-payment-ledger.service.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

const PAYMENT_WRITE_ROLES = ["accounts_head", "super_admin"] as const;
const PAYMENT_READ_ROLES = [
  ...PAYMENT_WRITE_ROLES,
  "finance_head",
  "branch_admin",
  "branch_head",
  "admin",
  "finance",
] as const;

const router = Router();
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

function actor(req: AuthenticatedRequest) {
  const id = req.authUser?.id;
  if (!id) throw new Error("Authenticated user is required");
  return {
    id,
    role: String(req.authUser?.role ?? req.userRoles?.[0] ?? "unknown"),
    roles: req.userRoles ?? [],
  };
}

function allRoles(req: AuthenticatedRequest) {
  return new Set(
    [req.authUser?.role, ...(req.userRoles ?? [])]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.toLowerCase())
  );
}

function paymentWriteRole(req: AuthenticatedRequest) {
  const roles = allRoles(req);
  if (roles.has("accounts_head")) return "accounts_head";
  if (roles.has("super_admin")) return "super_admin";
  return String(req.authUser?.role ?? "unknown");
}

type ScopedPaymentRequest = AuthenticatedRequest & { financePayment?: any };

async function authorizePaymentBranch(
  req: ScopedPaymentRequest,
  res: Response,
  next: NextFunction
) {
  try {
    const user = actor(req);
    const payment = await vendorPaymentService.getPayment(req.params.id);
    if (!payment) {
      res.status(404).json({ success: false, error: "Record not found" });
      return;
    }
    await assertFinanceRecordBranch({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      recordBranchId: payment.branch_id,
    });
    req.financePayment = payment;
    next();
  } catch (error: unknown) {
    res.status(403).json({
      success: false,
      error: error instanceof Error ? error.message : "Access denied",
    });
  }
}

router.use(requireAuth);

router.get(
  "/vendor-payments/capabilities",
  requireRole(...PAYMENT_READ_ROLES),
  (req: AuthenticatedRequest, res) => {
    const roles = allRoles(req);
    const canWrite = roles.has("accounts_head") || roles.has("super_admin");
    const hasGlobalRead = [
      "accounts_head",
      "super_admin",
      "finance_head",
      "admin",
      "finance",
    ].some((role) => roles.has(role));
    res.json({
      success: true,
      data: {
        canRead: true,
        canWrite,
        readScope: hasGlobalRead ? "organisation" : "branch",
        writeRole: canWrite ? paymentWriteRole(req) : null,
        paymentModel: "installment_ledger",
      },
    });
  }
);

router.get(
  "/banks",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (_req, res) => {
    const data = await vendorPaymentService.listBanks();
    res.json({ success: true, data });
  })
);

router.get(
  "/vendor-payments",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId
        ? String(req.query.branchId)
        : undefined,
    });
    const result = await vendorPaymentService.listPayments({
      financialYear: req.query.financialYear
        ? String(req.query.financialYear)
        : undefined,
      month: req.query.month ? String(req.query.month) : undefined,
      branchId,
      processId: req.query.processId ? String(req.query.processId) : undefined,
      costCentreId: req.query.costCentreId
        ? String(req.query.costCentreId)
        : undefined,
      costClass: req.query.costClass ? String(req.query.costClass) : undefined,
      head: req.query.head ? String(req.query.head) : undefined,
      subHead: req.query.subHead ? String(req.query.subHead) : undefined,
      vendorId: req.query.vendorId ? String(req.query.vendorId) : undefined,
      paymentStatus: req.query.paymentStatus
        ? String(req.query.paymentStatus)
        : undefined,
      dueDateFrom: req.query.dueDateFrom
        ? String(req.query.dueDateFrom)
        : undefined,
      dueDateTo: req.query.dueDateTo ? String(req.query.dueDateTo) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, ...result });
  })
);

router.get(
  "/vendor-payments/export",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const user = actor(req);
    const branchId = await resolveFinanceBranchScope({
      userId: user.id,
      primaryRole: user.role,
      userRoles: user.roles,
      requestedBranchId: req.query.branchId
        ? String(req.query.branchId)
        : undefined,
    });
    const rows = await vendorPaymentService.exportPayments({
      financialYear: req.query.financialYear
        ? String(req.query.financialYear)
        : undefined,
      month: req.query.month ? String(req.query.month) : undefined,
      branchId,
      processId: req.query.processId ? String(req.query.processId) : undefined,
      costCentreId: req.query.costCentreId
        ? String(req.query.costCentreId)
        : undefined,
      costClass: req.query.costClass ? String(req.query.costClass) : undefined,
      head: req.query.head ? String(req.query.head) : undefined,
      subHead: req.query.subHead ? String(req.query.subHead) : undefined,
      vendorId: req.query.vendorId ? String(req.query.vendorId) : undefined,
      paymentStatus: req.query.paymentStatus
        ? String(req.query.paymentStatus)
        : undefined,
      dueDateFrom: req.query.dueDateFrom
        ? String(req.query.dueDateFrom)
        : undefined,
      dueDateTo: req.query.dueDateTo ? String(req.query.dueDateTo) : undefined,
      search: req.query.search ? String(req.query.search) : undefined,
    });

    const columns = [
      "Sr No", "Branch", "Process", "Cost Centre", "Cost Class", "GRN No",
      "Vendor", "Head", "Sub Head", "Amount Without Tax", "Tax Amount",
      "Due Amount With Tax", "Due Date", "Latest Payment Mode",
      "Latest Payment Date", "Latest Bank Name", "Latest Transaction ID",
      "Paid Amount", "Balance Amount", "Payment Status", "Remarks",
    ];
    const escape = (value: unknown) =>
      `"${String(value ?? "").replace(/"/g, '""')}"`;
    const csvRows = [
      columns.map(escape).join(","),
      ...(rows as any[]).map((row, index) =>
        [
          index + 1, row.branch_name ?? row.branch_id, row.process_name ?? "",
          row.cost_centre_name ?? "", row.cost_class ?? "", row.grn_number,
          row.vendor_name, row.head, row.sub_head, row.amount_without_tax,
          row.tax_amount, row.due_amount, row.due_date, row.payment_mode,
          row.payment_date, row.bank_name, row.transaction_id, row.paid_amount,
          row.balance_amount, row.payment_status, row.remarks,
        ].map(escape).join(",")
      ),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="vendor-payments-export.csv"'
    );
    res.send(csvRows.join("\n"));
  })
);

router.get(
  "/vendor-payments/:id/transactions",
  requireRole(...PAYMENT_READ_ROLES),
  authorizePaymentBranch,
  h(async (req, res) => {
    const data = await vendorPaymentLedgerService.listTransactions(req.params.id);
    res.json({ success: true, data });
  })
);

router.get(
  "/vendor-payments/:id",
  requireRole(...PAYMENT_READ_ROLES),
  authorizePaymentBranch,
  async (req: ScopedPaymentRequest, res) => {
    res.json({ success: true, data: req.financePayment });
  }
);

router.post(
  "/vendor-payments/:id/dispatch",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  authorizePaymentBranch,
  h(async (req, res) => {
    const user = actor(req);
    const data = await vendorPaymentLedgerService.dispatch(
      req.params.id,
      req.body,
      user.id,
      paymentWriteRole(req)
    );
    res.json({ success: true, data });
  })
);

router.post(
  "/vendor-payments/:id/hold",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  authorizePaymentBranch,
  h(async (req, res) => {
    const user = actor(req);
    const hold = Boolean(req.body?.hold);
    const data = await vendorPaymentLedgerService.setHold(
      req.params.id,
      hold,
      req.body?.reason ? String(req.body.reason) : undefined,
      user.id,
      paymentWriteRole(req)
    );
    res.json({ success: true, data });
  })
);

router.post(
  "/vendor-payments/:id/update-payment",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  (_req, res) => {
    res.status(410).json({
      success: false,
      error: "Aggregate payment updates are retired. Use /dispatch for installments or /hold for hold/release actions.",
    });
  }
);

router.post(
  "/vendor-payments/bulk-update",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  (_req, res) => {
    res.status(410).json({
      success: false,
      error: "Bulk aggregate updates are retired because each installment requires its own payment reference.",
    });
  }
);

const proofUploadDirectory = path.join(
  process.cwd(),
  "uploads",
  "payment-proofs"
);
if (!fs.existsSync(proofUploadDirectory)) {
  fs.mkdirSync(proofUploadDirectory, { recursive: true });
}

const proofStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, proofUploadDirectory),
  filename: (_req, file, callback) => {
    callback(null, `${randomUUID()}${path.extname(file.originalname).toLowerCase()}`);
  },
});
const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    const allowedMimeTypes = [
      "image/jpeg", "image/png", "image/webp", "application/pdf",
    ];
    const allowedExtensions = [".jpg", ".jpeg", ".png", ".webp", ".pdf"];
    callback(
      null,
      allowedMimeTypes.includes(file.mimetype)
        && allowedExtensions.includes(path.extname(file.originalname).toLowerCase())
    );
  },
});

router.post(
  "/vendor-payments/:id/transactions/:transactionRowId/upload-proof",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  authorizePaymentBranch,
  proofUpload.single("proof"),
  h(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ success: false, error: "PDF or image proof required" });
      return;
    }
    const user = actor(req);
    await vendorPaymentLedgerService.saveTransactionProof(
      req.params.id,
      req.params.transactionRowId,
      req.file.originalname,
      req.file.path,
      req.file.mimetype,
      user.id,
      paymentWriteRole(req)
    );
    res.json({ success: true, message: "Installment proof uploaded" });
  })
);

router.post(
  "/vendor-payments/:id/upload-proof",
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  (_req, res) => {
    res.status(410).json({
      success: false,
      error: "Upload proof against a specific payment installment transaction.",
    });
  }
);

router.get(
  "/vendor-payments/:id/transactions/:transactionRowId/proof",
  requireRole(...PAYMENT_READ_ROLES),
  authorizePaymentBranch,
  h(async (req, res) => {
    const transactions = await vendorPaymentLedgerService.listTransactions(req.params.id) as any[];
    const transaction = transactions.find((item) => String(item.id) === req.params.transactionRowId);
    const filePath = transaction?.proof_file_path as string | undefined;
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: "Installment proof not found" });
      return;
    }
    res.setHeader(
      "Content-Type",
      transaction.proof_file_mime ?? "application/octet-stream"
    );
    res.sendFile(path.resolve(filePath));
  })
);

router.get(
  "/vendor-payments/:id/proof",
  requireRole(...PAYMENT_READ_ROLES),
  authorizePaymentBranch,
  async (req: ScopedPaymentRequest, res) => {
    const record = req.financePayment;
    const filePath = record?.payment_proof_file_path as string | undefined;
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: "Payment proof not found" });
      return;
    }
    res.setHeader(
      "Content-Type",
      record.payment_proof_file_mime ?? "application/octet-stream"
    );
    res.sendFile(path.resolve(filePath));
  }
);

router.get(
  "/vendor-payments/:id/grn-file",
  requireRole(...PAYMENT_READ_ROLES),
  authorizePaymentBranch,
  async (req: ScopedPaymentRequest, res) => {
    const record = req.financePayment;
    const filePath = record?.grn_file_path as string | undefined;
    if (!filePath || !fs.existsSync(filePath)) {
      res.status(404).json({ success: false, error: "GRN file not found" });
      return;
    }
    res.setHeader(
      "Content-Type",
      record.grn_file_mime ?? "application/octet-stream"
    );
    res.sendFile(path.resolve(filePath));
  }
);

export { router as vendorPaymentRouter };
