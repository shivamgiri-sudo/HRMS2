import { Router } from "express";
import path from "path";
import fs from "fs";
import multer from "multer";
import { randomUUID } from "crypto";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { vendorPaymentService } from "./vendor-payment.service.js";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

const PAYMENT_WRITE_ROLES = ["accounts_head", "finance_head", "super_admin"] as const;
const PAYMENT_READ_ROLES  = [...PAYMENT_WRITE_ROLES, "branch_admin", "branch_head", "admin", "finance"] as const;

// ── Bank master ───────────────────────────────────────────────────────────────

// GET /api/finance/banks
router.get("/banks", h(async (_req, res) => {
  const data = await vendorPaymentService.listBanks();
  res.json({ success: true, data });
}));

// ── Vendor payments list ──────────────────────────────────────────────────────

// GET /api/finance/vendor-payments
router.get(
  "/vendor-payments",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const result = await vendorPaymentService.listPayments({
      financialYear: req.query.financialYear as string,
      month:         req.query.month as string,
      branchId:      req.query.branchId as string,
      head:          req.query.head as string,
      subHead:       req.query.subHead as string,
      vendorId:      req.query.vendorId as string,
      paymentStatus: req.query.paymentStatus as string,
      dueDateFrom:   req.query.dueDateFrom as string,
      dueDateTo:     req.query.dueDateTo as string,
      search:        req.query.search as string,
      page:          req.query.page  ? Number(req.query.page)  : 1,
      limit:         req.query.limit ? Number(req.query.limit) : 50,
    });
    res.json({ success: true, ...result });
  })
);

// GET /api/finance/vendor-payments/:id
router.get(
  "/vendor-payments/:id",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const data = await vendorPaymentService.getPayment(req.params.id);
    if (!data) return res.status(404).json({ success: false, error: "Record not found" });
    res.json({ success: true, data });
  })
);

// ── Payment update ────────────────────────────────────────────────────────────

// POST /api/finance/vendor-payments/:id/update-payment
router.post(
  "/vendor-payments/:id/update-payment",
  requireRole(...PAYMENT_WRITE_ROLES),
  h(async (req, res) => {
    const userId   = req.authUser?.id;
    const userRole = req.authUser?.role;
    const data = await vendorPaymentService.updatePayment(
      req.params.id,
      req.body,
      userId,
      userRole
    );
    res.json({ success: true, data });
  })
);

// POST /api/finance/vendor-payments/bulk-update
router.post(
  "/vendor-payments/bulk-update",
  requireRole(...PAYMENT_WRITE_ROLES),
  h(async (req, res) => {
    const userId   = req.authUser?.id;
    const userRole = req.authUser?.role;
    const { updates } = req.body;
    if (!Array.isArray(updates) || updates.length === 0) {
      return res.status(400).json({ success: false, error: "updates array required" });
    }
    const results = await vendorPaymentService.bulkUpdate(updates, userId, userRole);
    res.json({ success: true, results });
  })
);

// ── Proof upload ──────────────────────────────────────────────────────────────

const proofUploadDir = path.join(process.cwd(), "uploads", "payment-proofs");
if (!fs.existsSync(proofUploadDir)) fs.mkdirSync(proofUploadDir, { recursive: true });

const proofStorage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, proofUploadDir),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname);
    cb(null, `${randomUUID()}${ext}`);
  },
});
const proofUpload = multer({
  storage: proofStorage,
  limits: { fileSize: 10 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = ["image/jpeg", "image/png", "image/webp", "application/pdf"];
    cb(null, allowed.includes(file.mimetype));
  },
});

// POST /api/finance/vendor-payments/:id/upload-proof
router.post(
  "/vendor-payments/:id/upload-proof",
  requireRole(...PAYMENT_WRITE_ROLES),
  proofUpload.single("proof"),
  h(async (req, res) => {
    if (!req.file) return res.status(400).json({ success: false, error: "File required" });
    const userId = req.authUser?.id;
    await vendorPaymentService.saveProofPath(
      req.params.id,
      req.file.originalname,
      req.file.path,
      req.file.mimetype,
      userId
    );
    res.json({ success: true, message: "Proof uploaded" });
  })
);

// GET /api/finance/vendor-payments/:id/proof — serve proof file
router.get(
  "/vendor-payments/:id/proof",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const record = await vendorPaymentService.getPayment(req.params.id);
    if (!record?.payment_proof_file_path) {
      return res.status(404).json({ success: false, error: "No proof uploaded" });
    }
    const fp = record.payment_proof_file_path as string;
    if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: "File not found" });
    res.setHeader("Content-Type", record.payment_proof_file_mime ?? "application/octet-stream");
    res.sendFile(path.resolve(fp));
  })
);

// ── Export ────────────────────────────────────────────────────────────────────

// GET /api/finance/vendor-payments/export
router.get(
  "/vendor-payments/export",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const rows = await vendorPaymentService.exportPayments({
      financialYear: req.query.financialYear as string,
      month:         req.query.month as string,
      branchId:      req.query.branchId as string,
      head:          req.query.head as string,
      subHead:       req.query.subHead as string,
      vendorId:      req.query.vendorId as string,
      paymentStatus: req.query.paymentStatus as string,
      dueDateFrom:   req.query.dueDateFrom as string,
      dueDateTo:     req.query.dueDateTo as string,
      search:        req.query.search as string,
    });

    // Build CSV
    const cols = [
      "Sr No", "Branch", "GRN No", "Vendor", "Head", "Sub Head",
      "Due Amount", "Due Date", "Payment Mode", "Payment Date",
      "Bank Name", "Transaction ID", "Paid Amount", "Balance Amount",
      "Payment Status", "Remarks",
    ];
    const escape = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const csvRows = [
      cols.map(escape).join(","),
      ...(rows as any[]).map((r, i) => [
        i + 1, r.branch_name ?? r.branch_id, r.grn_number,
        r.vendor_name, r.head, r.sub_head,
        r.due_amount, r.due_date, r.payment_mode,
        r.payment_date, r.bank_name, r.transaction_id,
        r.paid_amount, r.balance_amount, r.payment_status, r.remarks,
      ].map(escape).join(",")),
    ];

    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="vendor-payments-export.csv"`);
    res.send(csvRows.join("\n"));
  })
);

// ── GRN approval trigger (internal — called from GRN approval endpoint) ───────

// POST /api/finance/vendor-payments/from-grn  (internal, accounts_head/finance_head/super_admin)
router.post(
  "/vendor-payments/from-grn",
  requireRole(...PAYMENT_WRITE_ROLES),
  h(async (req, res) => {
    const { grnId } = req.body;
    if (!grnId) return res.status(400).json({ success: false, error: "grnId required" });
    const id = await vendorPaymentService.createFromGrn(grnId, req.authUser?.id);
    res.json({ success: true, vendorPaymentId: id });
  })
);

// ── GRN file proxy — serve GRN attachment from vendor_payment_tracking ────────

// GET /api/finance/vendor-payments/:id/grn-file
router.get(
  "/vendor-payments/:id/grn-file",
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const record = await vendorPaymentService.getPayment(req.params.id);
    if (!record?.grn_file_path) {
      return res.status(404).json({ success: false, error: "No GRN file attached" });
    }
    const fp = record.grn_file_path as string;
    if (!fs.existsSync(fp)) return res.status(404).json({ success: false, error: "File not found" });
    res.setHeader("Content-Type", record.grn_file_mime ?? "application/octet-stream");
    res.sendFile(path.resolve(fp));
  })
);

export { router as vendorPaymentRouter };
