import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

const router = Router();
const h = (fn: Function) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── GET /api/payroll/runs/:runId/disbursal ─────────────────────────────────────
// Returns all disbursal records for a payroll run.
router.get(
  "/runs/:runId/disbursal",
  requireRole("payroll", "super_admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT srd.*, e.first_name, e.last_name
         FROM salary_run_disbursal srd
         LEFT JOIN employees e ON e.id = srd.employee_id
        WHERE srd.run_id = ?
        ORDER BY srd.employee_code`,
      [runId]
    );
    return res.json({ success: true, data: rows });
  })
);

// ── POST /api/payroll/runs/:runId/disbursal-upload ─────────────────────────────
// Payroll Head uploads CSV or JSON array of disbursal records.
// JSON body: { rows: Array<{ employee_code, cheque_no, payment_mode, payment_date, bank_ref, notes }> }
// CSV body (text/plain or text/csv): header row + data rows with same column names.
router.post(
  "/runs/:runId/disbursal-upload",
  requireRole("payroll", "super_admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId } = req.params;
    const actorUserId = req.authUser!.id;

    // Verify run exists
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId]
    );
    if (!(runRows as any[])[0]) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    // Parse input — support JSON body or CSV text body
    let inputRows: Array<{
      employee_code: string;
      cheque_no?: string;
      payment_mode?: string;
      payment_date?: string;
      bank_ref?: string;
      notes?: string;
    }> = [];

    const contentType = req.headers["content-type"] ?? "";
    if (contentType.includes("application/json")) {
      const body = req.body as { rows?: unknown[] };
      if (!Array.isArray(body.rows)) {
        return res.status(400).json({ success: false, message: "body.rows must be an array" });
      }
      inputRows = body.rows as typeof inputRows;
    } else {
      // Parse raw CSV text sent as body string (text/plain or text/csv)
      const raw: string = typeof req.body === "string" ? req.body : "";
      if (!raw.trim()) {
        return res.status(400).json({ success: false, message: "Empty CSV body" });
      }
      const lines = raw.trim().split(/\r?\n/);
      if (lines.length < 2) {
        return res.status(400).json({ success: false, message: "CSV must have header + at least one data row" });
      }
      const headers = lines[0].split(",").map((h) => h.trim().toLowerCase());
      const idx = (col: string) => headers.indexOf(col);
      for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split(",").map((c) => c.trim());
        if (cells.every((c) => !c)) continue;
        inputRows.push({
          employee_code: cells[idx("employee_code")] ?? "",
          cheque_no: cells[idx("cheque_no")] || undefined,
          payment_mode: cells[idx("payment_mode")] || undefined,
          payment_date: cells[idx("payment_date")] || undefined,
          bank_ref: cells[idx("bank_ref")] || undefined,
          notes: cells[idx("notes")] || undefined,
        });
      }
    }

    if (inputRows.length === 0) {
      return res.status(400).json({ success: false, message: "No rows to process" });
    }

    // Validate payment_mode values
    const VALID_MODES = ["NEFT", "IMPS", "Cheque", "Cash", "UPI", "RTGS"];

    let inserted = 0;
    let updated = 0;
    const unmatched: string[] = [];

    for (const row of inputRows) {
      const empCode = (row.employee_code ?? "").trim();
      if (!empCode) continue;

      // Look up employee_id
      const [empRows] = await db.execute<RowDataPacket[]>(
        `SELECT id FROM employees WHERE employee_code = ? LIMIT 1`,
        [empCode]
      );
      const emp = (empRows as any[])[0];
      if (!emp) {
        unmatched.push(empCode);
        continue;
      }

      const paymentMode = row.payment_mode
        ? VALID_MODES.find((m) => m.toLowerCase() === row.payment_mode!.toLowerCase()) ?? row.payment_mode
        : null;

      const [result] = await db.execute<ResultSetHeader>(
        `INSERT INTO salary_run_disbursal
           (run_id, employee_id, employee_code, cheque_no, payment_mode, payment_date, bank_ref, uploaded_by, notes)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
           cheque_no    = VALUES(cheque_no),
           payment_mode = VALUES(payment_mode),
           payment_date = VALUES(payment_date),
           bank_ref     = VALUES(bank_ref),
           uploaded_by  = VALUES(uploaded_by),
           uploaded_at  = CURRENT_TIMESTAMP,
           notes        = VALUES(notes)`,
        [
          runId,
          emp.id,
          empCode,
          row.cheque_no ?? null,
          paymentMode ?? null,
          row.payment_date ?? null,
          row.bank_ref ?? null,
          actorUserId,
          row.notes ?? null,
        ]
      );

      // affectedRows = 1 for insert, 2 for update (MySQL ON DUPLICATE KEY)
      if (result.affectedRows === 1) inserted++;
      else updated++;
    }

    void logSensitiveAction({
      actor_user_id: actorUserId,
      action_type: "DISBURSAL_UPLOAD",
      module_key: "payroll",
      entity_type: "salary_run_disbursal",
      entity_id: runId,
      change_summary: { run_id: runId, inserted, updated, unmatched_count: unmatched.length },
    });

    return res.json({
      success: true,
      message: `Processed ${inserted + updated} records (${inserted} new, ${updated} updated)`,
      inserted,
      updated,
      unmatched,
    });
  })
);

// GET /api/payroll/runs/:runId/bank-export — RETIRED (section 6).
//
// This produced a real bank payment file while enforcing almost none of the controls the
// canonical exporter enforces. It checked that the run existed and that the account and IFSC
// were well-formed, and nothing else. It did NOT require:
//
//   - a closed run status            (canonical: isRunClosed)
//   - validation_status = validated
//   - FINANCE SIGN-OFF               (canonical: finance_approved_by)
//   - payment-population reconciliation against bank readiness
//   - a check for a pending bank-change request
//   - org-wide scope                 (canonical denies a branch-scoped caller outright)
//
// and it recorded no content hash and no export-log row, so a file produced here could not
// afterwards be shown to be the one sent to the bank.
//
// Two payment paths with different gates is the defect, not the formats. Retired rather than
// re-gated because it has never produced a file: salary_run_disbursal, the table it INNER JOINs,
// holds 0 rows across 0 runs (verified live 2026-08-17), so the route has always 404'd. Building
// a second gated exporter to preserve an output nobody has ever generated would add a second
// thing to keep in step with the first.
//
// The disbursal record and CSV upload routes above are untouched — only the payment-file
// generation is withdrawn. If an SBI-specific layout is needed, add it as a format option to the
// canonical exporter, where the gates already live, rather than reviving a parallel path.
router.get(
  "/runs/:runId/bank-export",
  requireRole("payroll_head", "finance", "super_admin"),
  async (_req: AuthenticatedRequest, res: Response) => {
    return res.status(410).json({
      success: false,
      code: "BANK_EXPORT_RETIRED",
      message:
        "This bank export has been withdrawn because it did not enforce Finance sign-off, payment-"
        + "population reconciliation or file-hash recording. Use GET /api/payroll/runs/:id/neft-export, "
        + "which does.",
      canonical: "/api/payroll/runs/:id/neft-export",
    });
  }
);

export { router as disbursalRouter };
