import { Router } from "express";
import multer from "multer";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

function parseCsvSimple(text: string): Record<string, string>[] {
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.trim() !== "");
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map((h) => h.trim().toLowerCase().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    const values = line.split(",").map((v) => v.trim().replace(/^"|"$/g, ""));
    const obj: Record<string, string> = {};
    headers.forEach((h, i) => { obj[h] = values[i] ?? ""; });
    return obj;
  });
}

export const goldenMonthReconciliationRouter = Router();

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 }, // 2 MB
  fileFilter: (_req, file, cb) => {
    const ok = file.mimetype === "text/csv" || file.originalname.endsWith(".csv");
    cb(null, ok);
  },
});

/**
 * POST /api/payroll/reconciliation/upload
 *
 * Finance uploads their external control file (CSV) with expected totals per employee.
 * The endpoint stores the upload, then computes a diff against salary_prep_line.
 *
 * CSV columns (case-insensitive, whitespace-trimmed):
 *   employee_code, expected_gross, expected_net, expected_tds, expected_pf_employee
 *
 * Query params:
 *   run_id  — the payroll run to compare against
 */
goldenMonthReconciliationRouter.post(
  "/upload",
  requireAuth,
  requireRole("Super Admin", "Finance/Payroll", "HR Admin"),
  upload.single("control_file"),
  async (req: any, res: any) => {
    const { run_id } = req.body as { run_id?: string };
    if (!run_id) {
      return res.status(400).json({ success: false, error: "run_id is required" });
    }
    if (!req.file) {
      return res.status(400).json({ success: false, error: "CSV file is required" });
    }

    // Validate the run exists and is in a comparable state
    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [run_id],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, error: "Payroll run not found" });
    }

    // Parse CSV
    let rows: Record<string, string>[];
    try {
      rows = parseCsvSimple(req.file.buffer.toString("utf-8"));
    } catch (e: any) {
      return res.status(400).json({ success: false, error: `CSV parse error: ${e.message}` });
    }

    if (rows.length === 0) {
      return res.status(400).json({ success: false, error: "CSV file is empty" });
    }

    const requiredCols = ["employee_code", "expected_gross", "expected_net"];
    const header = Object.keys(rows[0]);
    const missing = requiredCols.filter((c) => !header.includes(c));
    if (missing.length > 0) {
      return res.status(400).json({
        success: false,
        error: `CSV missing required columns: ${missing.join(", ")}`,
      });
    }

    // Build a map from control file: employee_code → expected values
    const controlMap = new Map<string, {
      expected_gross: number;
      expected_net: number;
      expected_tds: number;
      expected_pf_employee: number;
    }>();
    for (const row of rows) {
      const code = row.employee_code?.trim().toUpperCase();
      if (!code) continue;
      controlMap.set(code, {
        expected_gross:       parseFloat(row.expected_gross)       || 0,
        expected_net:         parseFloat(row.expected_net)         || 0,
        expected_tds:         parseFloat(row.expected_tds)         || 0,
        expected_pf_employee: parseFloat(row.expected_pf_employee) || 0,
      });
    }

    // Pull computed lines from salary_prep_line
    const [prepRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.employee_code,
              spl.gross_salary   AS computed_gross,
              spl.net_salary     AS computed_net,
              spl.tds            AS computed_tds,
              spl.pf_employee    AS computed_pf_employee
         FROM salary_prep_line spl
        WHERE spl.run_id = ?`,
      [run_id],
    );

    // Build computed map
    const computedMap = new Map<string, {
      computed_gross: number;
      computed_net: number;
      computed_tds: number;
      computed_pf_employee: number;
    }>();
    for (const r of prepRows as RowDataPacket[]) {
      computedMap.set((r.employee_code as string).toUpperCase(), {
        computed_gross:       Number(r.computed_gross),
        computed_net:         Number(r.computed_net),
        computed_tds:         Number(r.computed_tds),
        computed_pf_employee: Number(r.computed_pf_employee),
      });
    }

    // Compute diffs
    const discrepancies: Array<{
      employee_code: string;
      field: string;
      expected: number;
      computed: number;
      delta: number;
    }> = [];

    const allCodes = new Set([...controlMap.keys(), ...computedMap.keys()]);
    const missingInControl: string[] = [];
    const missingInRun: string[] = [];

    for (const code of allCodes) {
      const ctrl = controlMap.get(code);
      const comp = computedMap.get(code);

      if (!ctrl) {
        missingInControl.push(code);
        continue;
      }
      if (!comp) {
        missingInRun.push(code);
        continue;
      }

      const checks: Array<[string, number, number]> = [
        ["gross_salary",   ctrl.expected_gross,       comp.computed_gross],
        ["net_salary",     ctrl.expected_net,         comp.computed_net],
        ["tds",            ctrl.expected_tds,         comp.computed_tds],
        ["pf_employee",    ctrl.expected_pf_employee, comp.computed_pf_employee],
      ];

      for (const [field, expected, computed] of checks) {
        const delta = Math.round((computed - expected) * 100) / 100;
        if (Math.abs(delta) > 0.01) {
          discrepancies.push({ employee_code: code, field, expected, computed, delta });
        }
      }
    }

    // Aggregate summary
    let totalExpectedGross = 0;
    let totalComputedGross = 0;
    let totalExpectedNet   = 0;
    let totalComputedNet   = 0;
    for (const code of allCodes) {
      totalExpectedGross += controlMap.get(code)?.expected_gross       ?? 0;
      totalComputedGross += computedMap.get(code)?.computed_gross      ?? 0;
      totalExpectedNet   += controlMap.get(code)?.expected_net         ?? 0;
      totalComputedNet   += computedMap.get(code)?.computed_net        ?? 0;
    }

    const reconciliationId = randomUUID();
    const isClean = discrepancies.length === 0 && missingInControl.length === 0 && missingInRun.length === 0;

    // Persist reconciliation result to audit log
    void logSensitiveAction({
      actor_user_id: req.user?.id ?? "system",
      action_type: "GOLDEN_MONTH_RECONCILIATION",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: run_id,
      change_summary: {
        reconciliation_id: reconciliationId,
        run_month: run.run_month,
        control_rows: controlMap.size,
        computed_rows: computedMap.size,
        discrepancy_count: discrepancies.length,
        missing_in_control: missingInControl.length,
        missing_in_run: missingInRun.length,
        is_clean: isClean,
      },
      req,
    });

    return res.json({
      success: true,
      reconciliation_id: reconciliationId,
      run_id,
      run_month: run.run_month,
      is_clean: isClean,
      summary: {
        control_rows:        controlMap.size,
        computed_rows:       computedMap.size,
        discrepancy_count:   discrepancies.length,
        missing_in_control:  missingInControl.length,
        missing_in_run:      missingInRun.length,
        total_expected_gross: Math.round(totalExpectedGross * 100) / 100,
        total_computed_gross: Math.round(totalComputedGross * 100) / 100,
        gross_delta:          Math.round((totalComputedGross - totalExpectedGross) * 100) / 100,
        total_expected_net:   Math.round(totalExpectedNet * 100) / 100,
        total_computed_net:   Math.round(totalComputedNet * 100) / 100,
        net_delta:            Math.round((totalComputedNet - totalExpectedNet) * 100) / 100,
      },
      discrepancies,
      missing_in_control: missingInControl,
      missing_in_run:     missingInRun,
    });
  },
);

/**
 * GET /api/payroll/reconciliation/runs/:runId/summary
 *
 * Returns aggregate totals for a run from salary_prep_line without requiring
 * an external file upload — used by Finance to get the system side of the ledger.
 */
goldenMonthReconciliationRouter.get(
  "/runs/:runId/summary",
  requireAuth,
  requireRole("Super Admin", "Finance/Payroll", "HR Admin"),
  async (req: any, res: any) => {
    const { runId } = req.params as { runId: string };

    const [runRows] = await db.execute<RowDataPacket[]>(
      `SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1`,
      [runId],
    );
    const run = (runRows as RowDataPacket[])[0];
    if (!run) {
      return res.status(404).json({ success: false, error: "Payroll run not found" });
    }

    const [aggRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*)                AS employee_count,
              SUM(gross_salary)       AS total_gross,
              SUM(net_salary)         AS total_net,
              SUM(tds)                AS total_tds,
              SUM(pf_employee)        AS total_pf_employee,
              SUM(pf_employer)        AS total_pf_employer,
              SUM(esic_employee)      AS total_esic_employee,
              SUM(esic_employer)      AS total_esic_employer,
              SUM(professional_tax)   AS total_professional_tax,
              SUM(lwp_deduction)      AS total_lwp_deduction,
              SUM(advance_recovery)   AS total_advance_recovery,
              SUM(total_deductions)   AS total_deductions
         FROM salary_prep_line
        WHERE run_id = ?`,
      [runId],
    );

    const agg = (aggRows as RowDataPacket[])[0] ?? {};
    return res.json({
      success: true,
      run_id: runId,
      run_month: run.run_month,
      status: run.status,
      summary: {
        employee_count:       Number(agg.employee_count ?? 0),
        total_gross:          Math.round(Number(agg.total_gross ?? 0) * 100) / 100,
        total_net:            Math.round(Number(agg.total_net ?? 0) * 100) / 100,
        total_tds:            Math.round(Number(agg.total_tds ?? 0) * 100) / 100,
        total_pf_employee:    Math.round(Number(agg.total_pf_employee ?? 0) * 100) / 100,
        total_pf_employer:    Math.round(Number(agg.total_pf_employer ?? 0) * 100) / 100,
        total_esic_employee:  Math.round(Number(agg.total_esic_employee ?? 0) * 100) / 100,
        total_esic_employer:  Math.round(Number(agg.total_esic_employer ?? 0) * 100) / 100,
        total_professional_tax: Math.round(Number(agg.total_professional_tax ?? 0) * 100) / 100,
        total_lwp_deduction:  Math.round(Number(agg.total_lwp_deduction ?? 0) * 100) / 100,
        total_advance_recovery: Math.round(Number(agg.total_advance_recovery ?? 0) * 100) / 100,
        total_deductions:     Math.round(Number(agg.total_deductions ?? 0) * 100) / 100,
      },
    });
  },
);
