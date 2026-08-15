import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { resolveAccountNumber } from "../../shared/fieldEncryption.js";

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

// GET /api/payroll/runs/:runId/bank-export?format=generic|sbi
router.get(
  "/runs/:runId/bank-export",
  requireRole("payroll_head", "finance", "super_admin"),
  async (req: AuthenticatedRequest, res: Response) => {
    try {
      const { runId } = req.params;
      const format = (req.query.format as string) || "generic";

      if (!["generic", "sbi"].includes(format)) {
        return res.status(400).json({ success: false, error: "format must be generic or sbi" });
      }

      // Verify run exists and get month for narration
      const [runRows] = await db.query<any[]>(
        `SELECT id, run_month FROM salary_prep_run WHERE id = ?`,
        [runId]
      );
      if (!runRows.length) {
        return res.status(404).json({ success: false, error: "Run not found" });
      }
      const runMonth = runRows[0].run_month as string; // YYYY-MM
      const [yr, mo] = runMonth.split("-");
      const monthNames = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
      const monthLabel = `${monthNames[parseInt(mo, 10) - 1]} ${yr}`;

      // Fetch employees: must have disbursal record with NEFT/IMPS/RTGS, a salary line, and a primary bank account.
      // account_number_status classifies the same way payrollCompliance.routes.ts already
      // does — a garbled account number must never silently end up in a real bank file.
      const [rows] = await db.query<any[]>(
        `SELECT
           e.full_name,
           e.employee_code,
           srd.payment_mode,
           spl.net_salary,
           ebd.account_number_enc, ebd.account_number AS account_number_legacy,
           ebd.ifsc_code,
           ebd.bank_name
         FROM salary_run_disbursal srd
         JOIN salary_prep_line spl
           ON spl.run_id = srd.run_id AND spl.employee_id = srd.employee_id
         JOIN employees e ON e.id = srd.employee_id
         INNER JOIN employee_bank_detail ebd
           ON ebd.employee_id = srd.employee_id
          AND ebd.is_primary = 1
          AND ebd.active_status = 1
         WHERE srd.run_id = ?
           AND UPPER(srd.payment_mode) IN ('NEFT','IMPS','RTGS')
         ORDER BY e.employee_code`,
        [runId]
      );

      if (!rows.length) {
        return res.status(404).json({
          success: false,
          error: "No NEFT/IMPS/RTGS disbursal records found for this run",
        });
      }

      // Resolve encrypted account numbers and classify in JS (col moved from SQL)
      const VALID_ACCOUNT_RE_D = /^[0-9]{6,20}$/;
      const SCIENTIFIC_RE_D = /[Ee][+-]/;
      /**
       * RBI IFSC: 4 letters, a literal ZERO, then 6 alphanumerics. Same expression the
       * canonical exporter uses (payroll.routes.ts /runs/:id/neft-export) — the two must
       * agree on who is payable or they produce different answers for the same run.
       */
      const IFSC_RE_D = /^[A-Z]{4}0[A-Z0-9]{6}$/;
      rows.forEach((r: any) => {
        const acct = resolveAccountNumber({ account_number_enc: r.account_number_enc, account_number: r.account_number_legacy });
        r.account_number = acct ?? "";
        if (!acct || acct === "") r.account_number_status = "missing";
        else if (SCIENTIFIC_RE_D.test(acct)) r.account_number_status = "corrupt_scientific_notation";
        else if (!VALID_ACCOUNT_RE_D.test(acct)) r.account_number_status = "unrecognised_format";
        else r.account_number_status = "ok";

        // IFSC was never validated here at all — only the account number was. An employee
        // with a good account and a missing or malformed IFSC was written straight into the
        // bank file, where the bank rejects the row and the file's declared total stops
        // matching what actually moved. Verified live 2026-08-14 against active primary
        // bank rows: 188 have no IFSC and 874 fail this format, out of 12,858 — so the two
        // exporters disagreed about ~1,062 employees.
        //
        // The reason is classified rather than lumped into one bucket because the classes
        // need different remediation, and 514 of the 874 are a single recoverable typo:
        // 'looks_like_letter_O_for_zero' is position 5 carrying the letter O where RBI
        // mandates a zero (BARBOSFSMAN for BARB0SFSMAN — one bad import, by the shape of
        // it). Those are almost certainly fixable in the data; 'wrong_length' ones
        // (20437, PUNB079700) are not.
        //
        // Deliberately NOT auto-corrected here. Rewriting a bank routing code at export
        // time is a money-path transformation with no audit trail, however obvious the
        // correction looks. The exporter refuses what it cannot verify and names the
        // reason; repairing employee_bank_detail is a separate, approved data change.
        const ifscRaw = String(r.ifsc_code ?? "").trim().toUpperCase();
        r.ifsc_code_normalised = ifscRaw;
        if (!ifscRaw) r.ifsc_status = "missing";
        else if (IFSC_RE_D.test(ifscRaw)) r.ifsc_status = "ok";
        else if (ifscRaw.length === 11 && ifscRaw[4] === "O" && IFSC_RE_D.test(ifscRaw.slice(0, 4) + "0" + ifscRaw.slice(5))) {
          r.ifsc_status = "looks_like_letter_O_for_zero";
        } else if (ifscRaw.length !== 11) r.ifsc_status = "wrong_length";
        else r.ifsc_status = "unrecognised_format";

        r.payability_reason =
          r.account_number_status !== "ok" ? `account:${r.account_number_status}`
          : r.ifsc_status !== "ok" ? `ifsc:${r.ifsc_status}`
          : null;
      });
      // Never write a corrupt/unreadable account number into a real bank file — exclude
      // and surface it instead. The digits behind 'corrupt_scientific_notation' are
      // genuinely gone (Excel precision loss upstream), not recoverable from this data.
      const payableRows = rows.filter((r) => r.payability_reason === null);
      const unpayableRows = rows.filter((r) => r.payability_reason !== null);

      if (!payableRows.length) {
        return res.status(422).json({
          success: false,
          error: "No employees in this run have both a payable account number and a valid IFSC.",
          unpayableCount: unpayableRows.length,
          unpayableEmployeeCodes: unpayableRows.map((r) => r.employee_code),
        });
      }

      // Build CSV
      const csvLines: string[] = [];

      if (format === "sbi") {
        csvLines.push("TransactionType,BeneficiaryName,BeneficiaryAccountNumber,IFSCCode,Amount,Narration");
        for (const r of payableRows) {
          const name    = String(r.full_name).toUpperCase().replace(/,/g, " ");
          const acct    = String(r.account_number ?? "").replace(/,/g, "");
          const ifsc    = String(r.ifsc_code_normalised ?? "").replace(/,/g, "");
          const amount  = Number(r.net_salary).toFixed(2);
          const narr    = `Salary ${monthLabel}`;
          csvLines.push(`P,${name},${acct},${ifsc},${amount},${narr}`);
        }
      } else {
        // Generic format
        csvLines.push("Serial,Employee Name,Account Number,IFSC Code,Bank Name,Amount,Purpose,Narration");
        payableRows.forEach((r, i) => {
          const name    = `"${String(r.full_name).toUpperCase().replace(/"/g, "'")}"`;
          const acct    = String(r.account_number ?? "").replace(/,/g, "");
          const ifsc    = String(r.ifsc_code_normalised ?? "").replace(/,/g, "");
          const bank    = `"${String(r.bank_name ?? "").replace(/"/g, "'")}"`;
          const amount  = Number(r.net_salary).toFixed(2);
          const narr    = `Salary ${monthLabel} - ${r.employee_code}`;
          csvLines.push(`${i + 1},${name},${acct},${ifsc},${bank},${amount},Salary,${narr}`);
        });
      }

      // Trailing comment block so Finance sees exclusions when the file is opened, since
      // this download is a plain link today (no pre-download UI to show them first).
      if (unpayableRows.length) {
        csvLines.push("");
        csvLines.push(`# ${unpayableRows.length} employee(s) EXCLUDED from this file — unusable account number or IFSC:`);
        for (const r of unpayableRows) {
          csvLines.push(`# ${r.employee_code},${String(r.full_name ?? "").replace(/,/g, " ")},${r.payability_reason}`);
        }
      }

      const csvContent  = csvLines.join("\r\n");

      void logSensitiveAction({
        actor_user_id: (req as any).authUser?.id ?? (req as any).user?.id ?? "unknown",
        action_type: "BANK_EXPORT_DOWNLOAD",
        module_key: "payroll",
        entity_type: "salary_prep_run",
        entity_id: runId,
        change_summary: {
          format, row_count: payableRows.length, run_month: runMonth,
          unpayable_count: unpayableRows.length,
          unpayable_employee_codes: unpayableRows.map((r) => r.employee_code),
        },
      });

      const formatLabel = format === "sbi" ? "SBI" : "Generic";
      const filename    = `BankBatch_${formatLabel}_${runMonth.replace("-", "")}_${runId.substring(0, 8)}.csv`;

      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
      // BOM for Excel UTF-8 compatibility
      res.send("﻿" + csvContent);
    } catch (err: any) {
      res.status(500).json({ success: false, error: err.message });
    }
  }
);

export { router as disbursalRouter };
