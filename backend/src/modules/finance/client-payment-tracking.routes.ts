import { Router } from "express";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  getClientInvoices,
  getClientPaymentTrends,
  getPaymentHistory,
  getSeatRatesFromDbBill,
  getPredictiveRevenue,
  getClientSummary,
  type PaymentFilters,
} from "./client-payment-tracking.service.js";

const router = Router();

export const CLIENT_PAYMENTS_RETIRED_MESSAGE = "Record client money in Client Billing → Receipts";
const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) => fn(req, res).catch(next);

const PAYMENT_READ_ROLES = [
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
  "ceo",
  "coo",
] as const;

const PAYMENT_WRITE_ROLES = [
  "super_admin",
  "admin",
  "finance",
  "finance_head",
  "accounts_head",
] as const;

router.get(
  "/invoices",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const filters: PaymentFilters = {
      clientName: req.query.clientName as string,
      branchName: req.query.branchName as string,
      financeYear: req.query.financeYear as string,
      month: req.query.month as string,
      status: req.query.status as string,
      page: req.query.page ? Number(req.query.page) : 1,
      limit: req.query.limit ? Number(req.query.limit) : 50,
    };
    const result = await getClientInvoices(filters);
    res.json(result);
  })
);

router.get(
  "/trends",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const { clientName, branchName, months } = req.query;
    const trends = await getClientPaymentTrends(
      clientName as string,
      branchName as string,
      months ? Number(months) : 12
    );
    res.json({ trends });
  })
);

router.get(
  "/clients",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const clients = await getClientSummary();
    res.json({ clients });
  })
);

router.get(
  "/seat-rates",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const { financeYear, month, branchName } = req.query;
    if (!financeYear || !month) {
      return res.status(400).json({ error: "financeYear and month are required" });
    }
    const rates = await getSeatRatesFromDbBill(
      financeYear as string,
      month as string,
      branchName as string
    );
    res.json({ rates });
  })
);

router.get(
  "/predictive-revenue",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const { financeYear, month } = req.query;
    if (!financeYear || !month) {
      return res.status(400).json({ error: "financeYear and month are required" });
    }
    const prediction = await getPredictiveRevenue(
      financeYear as string,
      month as string
    );
    res.json(prediction);
  })
);

router.get(
  "/history/:invoiceRefId",
  requireAuth,
  requireRole(...PAYMENT_READ_ROLES),
  h(async (req, res) => {
    const invoiceRefId = Number(req.params.invoiceRefId);
    if (isNaN(invoiceRefId)) {
      return res.status(400).json({ error: "Invalid invoice reference ID" });
    }
    const history = await getPaymentHistory(invoiceRefId);
    res.json({ history });
  })
);

/**
 * Retired write path. Client money is recorded once, as a receipt in Client Billing -> Receipts,
 * which settles the bills (SETTLEMENT_SQL), raises the bank voucher and keeps
 * client_invoice_payment_status in step. Marking a bill paid here bypassed all of that and left
 * Money Flow / Finance Analytics showing money that never reached a receipt or the bank. The
 * route stays so an old browser tab gets a clear answer instead of a 404.
 */
router.post(
  "/update",
  requireAuth,
  requireWriteAccess,
  requireRole(...PAYMENT_WRITE_ROLES),
  (_req: AuthenticatedRequest, res: any) => {
    res.status(409).json({
      success: false,
      error: CLIENT_PAYMENTS_RETIRED_MESSAGE,
      message: CLIENT_PAYMENTS_RETIRED_MESSAGE,
      redirectTo: "/finance/client-billing?tab=receipts",
    });
  }
);

export const clientPaymentTrackingRouter = router;
