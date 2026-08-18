import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { clientBillingService } from "./client-billing.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) =>
  fn(req, res).catch(next);

router.use(requireAuth);

const ALLOWED_ROLES = ["admin", "finance", "finance_head", "accounts_head"];

router.post(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const body = req.body as {
      costCentreId?: string; category?: string; financeYear?: string; monthLabel?: string;
      invoiceDate?: string; description?: string; applyGst?: boolean;
      lines?: Array<{ particulars: string; qty: number; rate: number; lineType?: "charge" | "deduction" }>;
    };
    if (!body.costCentreId || !body.category || !body.financeYear || !body.monthLabel || !body.invoiceDate) {
      return res.status(400).json({ error: "costCentreId, category, financeYear, monthLabel, and invoiceDate are required" });
    }
    const data = await clientBillingService.createProforma({
      costCentreId: body.costCentreId,
      category: body.category,
      financeYear: body.financeYear,
      monthLabel: body.monthLabel,
      invoiceDate: body.invoiceDate,
      description: body.description,
      applyGst: body.applyGst,
      lines: body.lines ?? [],
      createdBy: req.authUser!.id,
    });
    res.status(201).json({ success: true, data });
  })
);

router.get(
  "/proformas",
  requireRole(...ALLOWED_ROLES),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice ORDER BY created_at DESC`
    );
    res.json({ success: true, data: rows });
  })
);

router.get(
  "/proformas/:id",
  requireRole(...ALLOWED_ROLES),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [invoiceRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice WHERE id = ? LIMIT 1`,
      [req.params.id]
    );
    const invoice = invoiceRows[0];
    if (!invoice) return res.status(404).json({ error: "Invoice not found" });

    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM client_invoice_line WHERE invoice_id = ?`,
      [req.params.id]
    );
    res.json({ success: true, data: { ...invoice, lines: lineRows } });
  })
);

export { router as clientBillingRouter };
