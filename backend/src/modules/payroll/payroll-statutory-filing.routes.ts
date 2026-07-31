import { Router } from "express";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const payrollStatutoryFilingRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) => fn(req, res).catch(next);

payrollStatutoryFilingRouter.use(requireAuth);

// Ensure the table exists on first use
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS statutory_filing_record (
      id              CHAR(36)      NOT NULL DEFAULT (UUID()),
      filing_month    VARCHAR(7)    NOT NULL,
      filing_type     ENUM('EPF','ESIC','PT','TDS_24Q','LWF') NOT NULL,
      state_code      VARCHAR(10)   NULL,
      due_date        DATE          NOT NULL,
      amount_due      DECIMAL(14,2) NULL,
      challan_number  VARCHAR(100)  NULL,
      challan_date    DATE          NULL,
      filed_at        DATETIME      NULL,
      filed_by        VARCHAR(36)   NULL,
      remarks         TEXT          NULL,
      status          ENUM('pending','filed','overdue') NOT NULL DEFAULT 'pending',
      created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uk_sfr_month_type_state (filing_month, filing_type, COALESCE(state_code, '')),
      KEY idx_sfr_month  (filing_month),
      KEY idx_sfr_status (status),
      KEY idx_sfr_due    (due_date)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// Derive standard due dates for each filing type given a payroll month YYYY-MM
function defaultDueDate(filingMonth: string, type: string): string {
  const [yr, mo] = filingMonth.split("-").map(Number);
  const next = mo === 12 ? `${yr + 1}-01` : `${yr}-${String(mo + 1).padStart(2, "0")}`;
  switch (type) {
    case "EPF":    return `${next}-15`;  // 15th of following month
    case "ESIC":   return `${next}-15`;
    case "TDS_24Q": return `${next}-07`; // 7th of following month
    case "PT":     return `${next}-10`;
    case "LWF":    return `${next}-15`;
    default:       return `${next}-15`;
  }
}

// ─── GET /api/payroll/statutory-filing?month=YYYY-MM ─────────────────────────
payrollStatutoryFilingRouter.get(
  "/",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const month = typeof req.query.month === "string" ? req.query.month : new Date().toISOString().slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, message: "month must be YYYY-MM" });
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM statutory_filing_record WHERE filing_month = ? ORDER BY filing_type ASC, state_code ASC`,
      [month]
    );
    // Auto-update overdue status in the result set (don't mutate DB on every read, compute in memory)
    const today = new Date().toISOString().slice(0, 10);
    const records = (rows as any[]).map(r => ({
      ...r,
      status: r.status === "filed" ? "filed" : r.due_date < today ? "overdue" : "pending",
    }));
    return res.json({ success: true, data: records, month });
  })
);

// ─── GET /api/payroll/statutory-filing/overdue ────────────────────────────────
payrollStatutoryFilingRouter.get(
  "/overdue",
  requireRole("admin", "super_admin", "finance", "payroll", "payroll_head"),
  h(async (_req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const today = new Date().toISOString().slice(0, 10);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT * FROM statutory_filing_record
        WHERE status != 'filed' AND due_date < ?
        ORDER BY due_date ASC`,
      [today]
    );
    return res.json({ success: true, data: rows });
  })
);

// ─── POST /api/payroll/statutory-filing/initialize/:month ────────────────────
// Auto-create the standard 4 filing obligations for a given payroll month
payrollStatutoryFilingRouter.post(
  "/initialize/:month",
  requireRole("admin", "super_admin", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const { month } = req.params;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) {
      return res.status(400).json({ success: false, message: "month must be YYYY-MM" });
    }

    // Derive amount_due from payroll run if exists
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT
         SUM(pf_employee + pf_employer) AS epf_due,
         SUM(esic_employee + esic_employer) AS esic_due,
         SUM(tds) AS tds_due,
         SUM(professional_tax) AS pt_due
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
       WHERE spr.run_month = ?`,
      [month]
    );
    const amounts = (runRows as any[])[0] ?? {};

    const types: Array<{ type: string; amount: number | null }> = [
      { type: "EPF",     amount: Number(amounts.epf_due)  || null },
      { type: "ESIC",    amount: Number(amounts.esic_due) || null },
      { type: "TDS_24Q", amount: Number(amounts.tds_due)  || null },
      { type: "PT",      amount: Number(amounts.pt_due)   || null },
    ];

    let created = 0;
    let skipped = 0;
    for (const { type, amount } of types) {
      const id = randomUUID();
      const due = defaultDueDate(month, type);
      try {
        await db.execute(
          `INSERT IGNORE INTO statutory_filing_record
             (id, filing_month, filing_type, due_date, amount_due, status)
           VALUES (?, ?, ?, ?, ?, 'pending')`,
          [id, month, type, due, amount ?? null]
        );
        created++;
      } catch {
        skipped++;
      }
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "STATUTORY_FILING_INITIALIZED",
      module_key: "payroll",
      entity_type: "statutory_filing_record",
      entity_id: month,
      change_summary: { month, created, skipped },
      req,
    });

    return res.json({ success: true, data: { month, created, skipped } });
  })
);

// ─── PATCH /api/payroll/statutory-filing/:id/mark-filed ──────────────────────
payrollStatutoryFilingRouter.patch(
  "/:id/mark-filed",
  requireRole("admin", "super_admin", "finance", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const { id } = req.params;
    const { challan_number, challan_date, remarks, amount_due } = req.body ?? {};

    if (!challan_number?.trim()) {
      return res.status(400).json({ success: false, message: "challan_number is required" });
    }

    const fields: string[] = [
      "status = 'filed'",
      "filed_at = NOW()",
      "filed_by = ?",
      "challan_number = ?",
    ];
    const params: unknown[] = [req.authUser!.id, challan_number.trim()];

    if (challan_date) { fields.push("challan_date = ?"); params.push(challan_date); }
    if (remarks)      { fields.push("remarks = ?");      params.push(remarks); }
    if (amount_due != null) { fields.push("amount_due = ?"); params.push(Number(amount_due)); }

    params.push(id);
    const [result] = await db.execute(
      `UPDATE statutory_filing_record SET ${fields.join(", ")} WHERE id = ?`,
      params
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Filing record not found" });
    }

    void logSensitiveAction({
      actor_user_id: req.authUser!.id,
      action_type: "STATUTORY_FILING_MARKED_FILED",
      module_key: "payroll",
      entity_type: "statutory_filing_record",
      entity_id: id,
      change_summary: { challan_number, challan_date, remarks },
      req,
    });

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM statutory_filing_record WHERE id = ? LIMIT 1", [id]
    );
    return res.json({ success: true, data: (rows as any[])[0] ?? null });
  })
);

// ─── POST /api/payroll/statutory-filing ──────────────────────────────────────
// Manually add a custom filing record
payrollStatutoryFilingRouter.post(
  "/",
  requireRole("admin", "super_admin", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const { filing_month, filing_type, state_code, due_date, amount_due, remarks } = req.body ?? {};
    if (!filing_month || !filing_type || !due_date) {
      return res.status(400).json({ success: false, message: "filing_month, filing_type, due_date are required" });
    }
    const validTypes = ["EPF", "ESIC", "PT", "TDS_24Q", "LWF"];
    if (!validTypes.includes(filing_type)) {
      return res.status(400).json({ success: false, message: `filing_type must be one of: ${validTypes.join(", ")}` });
    }
    const id = randomUUID();
    await db.execute(
      `INSERT INTO statutory_filing_record
         (id, filing_month, filing_type, state_code, due_date, amount_due, remarks, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')`,
      [id, filing_month, filing_type, state_code ?? null, due_date, amount_due ?? null, remarks ?? null]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM statutory_filing_record WHERE id = ? LIMIT 1", [id]
    );
    return res.status(201).json({ success: true, data: (rows as any[])[0] });
  })
);

// ─── DELETE /api/payroll/statutory-filing/:id ────────────────────────────────
payrollStatutoryFilingRouter.delete(
  "/:id",
  requireRole("super_admin"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    await ensureTable().catch(() => {});
    const [result] = await db.execute(
      "DELETE FROM statutory_filing_record WHERE id = ? AND status = 'pending'",
      [req.params.id]
    );
    if ((result as any).affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Record not found or already filed" });
    }
    return res.json({ success: true });
  })
);
