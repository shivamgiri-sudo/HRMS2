import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { payrollController as c } from "./payroll.controller.js";
import { calculatePayrollRun } from "./payrollCalculate.service.js";
import { payslipService } from "./payslip.service.js";
import { taxDeclarationService } from "./taxDeclaration.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ─── Structures ───────────────────────────────────────────────────────────────

router.get("/structures", h(c.listStructures));
router.post("/structures", requireRole("admin", "hr", "finance", "payroll"), h(c.createStructure));

// ─── Components ───────────────────────────────────────────────────────────────

router.get("/components", h(c.listComponents));
router.post("/components", requireRole("admin", "hr", "finance", "payroll"), h(c.createComponent));

// ─── Salary Assignments ───────────────────────────────────────────────────────

router.post("/salary-assignments", requireRole("admin", "hr", "finance", "payroll"), h(c.assignSalary));
router.post("/salary-assignments/bulk", requireRole("admin", "hr", "finance", "payroll"), h(c.bulkAssignSalary));
router.get("/salary-assignments/:employeeId", requireRole("admin", "hr", "finance", "payroll"), h(c.getEmployeeSalary));

// ─── Payroll Runs — static paths before :id ───────────────────────────────────

router.get("/runs", h(c.listRuns));
router.post("/runs", requireRole("admin", "finance", "payroll"), h(c.createRun));
router.get("/runs/:id", h(c.getRun));
router.patch("/runs/:id/status", requireRole("admin", "finance", "payroll"), h(c.updateRunStatus));
router.get("/runs/:id/lines", h(c.listLines));
router.post("/runs/:id/calculate", requireRole("admin", "finance", "payroll"), async (req: any, res: any, next: any) => {
  try {
    const actorId = req.authUser?.id ?? "system";
    const result = await calculatePayrollRun(req.params.id, actorId);
    void logSensitiveAction({
      actor_user_id: actorId,
      action_type: "PAYROLL_RUN_CALCULATED",
      module_key: "payroll",
      entity_type: "salary_prep_run",
      entity_id: req.params.id,
      change_summary: { run_id: req.params.id },
      req,
    });
    return res.json({ success: true, data: result, message: "Payroll calculated" });
  } catch (err) { next(err); }
});

// ─── Run Lines ────────────────────────────────────────────────────────────────

router.patch("/lines/:id", requireRole("admin", "finance", "payroll"), h(c.updateLine));

// ─── Advances ─────────────────────────────────────────────────────────────────

router.post("/advances", requireRole("admin", "hr", "finance", "payroll"), h(c.createAdvance));
router.get("/advances/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own advances" });
    }
  }
  return c.listAdvances(req as any, res);
}));

// ─── Statutory Config ─────────────────────────────────────────────────────────

router.get("/statutory-config", requireRole("admin", "finance", "payroll"), h(c.getStatutoryConfig));

// ─── Payslip ──────────────────────────────────────────────────────────────────

// GET /api/payroll/payslip/:runId/:employeeId — admin/hr/finance/payroll or employee own
router.get("/payslip/:runId/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { runId, employeeId } = req.params;

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }

  const data = await payslipService.getPayslip(employeeId, runId);
  return res.json({ success: true, data });
}));

// POST /api/payroll/payslip/:runId/generate — admin/hr/finance/payroll only
router.post(
  "/payslip/:runId/generate",
  requireRole("admin", "hr", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { employeeId } = req.body as { employeeId?: string };
    if (!employeeId) {
      return res.status(400).json({ success: false, message: "employeeId is required" });
    }

    const data = await payslipService.generatePayslip(req.params.runId, employeeId, req.authUser!.id, req);
    return res.status(201).json({ success: true, data, message: "Payslip generated" });
  })
);

// POST /api/payroll/payslip/:payslipId/acknowledge — employee self (server-mapped)
router.post("/payslip/:payslipId/acknowledge", h(async (req: AuthenticatedRequest, res: Response) => {
  const callerEmp = await getEmployeeForUser(req.authUser!.id);
  if (!callerEmp) {
    return res.status(403).json({ success: false, message: "No employee record" });
  }
  const data = await payslipService.acknowledgePayslip(req.params.payslipId, callerEmp.id);
  return res.json({ success: true, data, message: "Payslip acknowledged" });
}));

// ─── Tax Declaration ──────────────────────────────────────────────────────────

// GET /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.get("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId, year } = req.params;

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only view your own tax declaration" });
    }
  }

  const data = await taxDeclarationService.get(employeeId, year);
  return res.json({ success: true, data });
}));

// POST /api/payroll/tax-declaration/:employeeId/:year — admin/hr/finance/payroll or employee own
router.post("/tax-declaration/:employeeId/:year", h(async (req: AuthenticatedRequest, res: Response) => {
  const { year } = req.params;

  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== req.params.employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden: you may only submit your own tax declaration" });
    }
    const data = await taxDeclarationService.upsert(callerEmp.id, year, req.body, req.authUser!.id);
    return res.json({ success: true, data, message: "Tax declaration saved" });
  }

  const data = await taxDeclarationService.upsert(req.params.employeeId, year, req.body, req.authUser!.id);
  return res.json({ success: true, data, message: "Tax declaration saved" });
}));

// ─── UAN ─────────────────────────────────────────────────────────────────────

// GET /api/payroll/uan/:employeeId — admin/hr/finance/payroll or self
router.get("/uan/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const isPrivileged = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPrivileged) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.json({ success: true, data: (rows as RowDataPacket[])[0] ?? null });
}));

// POST /api/payroll/uan/:employeeId — upsert UAN (admin/hr/finance)
router.post("/uan/:employeeId", requireRole("admin", "hr", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employeeId } = req.params;
  const { uan, member_id, epf_join_date } = req.body as {
    uan: string;
    member_id?: string;
    epf_join_date?: string;
  };
  if (!uan) return res.status(400).json({ success: false, message: "uan is required" });

  await db.execute(
    `INSERT INTO employee_uan (id, employee_id, uan, member_id, epf_join_date)
       VALUES (UUID(), ?, ?, ?, ?)
       ON DUPLICATE KEY UPDATE
         uan = VALUES(uan),
         member_id = VALUES(member_id),
         epf_join_date = VALUES(epf_join_date),
         updated_at = NOW()`,
    [employeeId, uan, member_id ?? null, epf_join_date ?? null]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM employee_uan WHERE employee_id = ? LIMIT 1",
    [employeeId]
  );
  return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// ─── Disbursements ────────────────────────────────────────────────────────────

// POST /api/payroll/disbursements — record a bank disbursement
router.post(
  "/disbursements",
  requireRole("admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { run_id, bank_ref, total_amount, employee_count } = req.body as {
      run_id: string;
      bank_ref?: string;
      total_amount: number;
      employee_count: number;
    };

    if (!run_id || total_amount === undefined || employee_count === undefined) {
      return res.status(400).json({ success: false, message: "run_id, total_amount, employee_count are required" });
    }

    const [runCheck] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM salary_prep_run WHERE id = ? LIMIT 1",
      [run_id]
    );
    if (!(runCheck as RowDataPacket[]).length) {
      return res.status(404).json({ success: false, message: "Payroll run not found" });
    }

    const id = (await import("crypto")).randomUUID();
    const actorId = req.authUser?.id ?? null;
    await db.execute(
      `INSERT INTO payroll_disbursement (id, run_id, bank_ref, total_amount, employee_count, disbursed_by)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [id, run_id, bank_ref ?? null, total_amount, employee_count, actorId]
    );

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// GET /api/payroll/disbursements/:runId — get disbursement for a run
router.get(
  "/disbursements/:runId",
  requireRole("admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE run_id = ? ORDER BY created_at DESC",
      [req.params.runId]
    );
    return res.json({ success: true, data: rows });
  })
);

// PATCH /api/payroll/disbursements/:id — update disbursement status
router.patch(
  "/disbursements/:id",
  requireRole("admin", "finance", "payroll"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { status, disbursed_at } = req.body as {
      status?: "completed" | "failed";
      disbursed_at?: string;
    };

    const allowed = new Set(["completed", "failed"]);
    if (status && !allowed.has(status)) {
      return res.status(400).json({ success: false, message: "status must be 'completed' or 'failed'" });
    }

    const sets: string[] = [];
    const params: unknown[] = [];
    if (status)       { sets.push("status = ?");       params.push(status); }
    if (disbursed_at) { sets.push("disbursed_at = ?"); params.push(disbursed_at); }
    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(req.params.id);
    const [result] = await db.execute(
      `UPDATE payroll_disbursement SET ${sets.join(", ")} WHERE id = ?`,
      params
    ) as unknown as [{ affectedRows: number }, unknown];

    if ((result as { affectedRows: number }).affectedRows === 0) {
      return res.status(404).json({ success: false, message: "Disbursement not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM payroll_disbursement WHERE id = ? LIMIT 1",
      [req.params.id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Form 16 Data ─────────────────────────────────────────────────────────────

// GET /api/payroll/form16-data/:runId/:employeeId — Form 16 Part B structured data
router.get(
  "/form16-data/:runId/:employeeId",
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { runId, employeeId } = req.params;

    const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
    if (!isPayrollRole) {
      const callerEmp = await getEmployeeForUser(req.authUser!.id);
      if (!callerEmp || callerEmp.id !== employeeId) {
        return res.status(403).json({ success: false, message: "Forbidden" });
      }
    }

    // Load run
    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
      [runId]
    );
    const run = (runRows as Array<{ run_month: string }>)[0];
    if (!run) return res.status(404).json({ success: false, message: "Run not found" });

    // Load prep line for gross / TDS
    const [lineRows] = await db.execute<RowDataPacket[]>(
      `SELECT spl.gross_salary, spl.tds_amount, spl.tds
         FROM salary_prep_line spl
        WHERE spl.run_id = ? AND spl.employee_id = ? LIMIT 1`,
      [runId, employeeId]
    );
    const line = (lineRows as Array<{ gross_salary: number; tds_amount: number; tds: number }>)[0];
    if (!line) return res.status(404).json({ success: false, message: "Payroll line not found for employee" });

    // Load employee details
    const [empRows] = await db.execute<RowDataPacket[]>(
      `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
              ed.pan_number AS pan,
              dm.designation_name AS designation,
              e.date_of_joining
         FROM employees e
         LEFT JOIN employee_documents ed  ON ed.employee_id = e.id
         LEFT JOIN designation_master dm  ON dm.id = e.designation_id
        WHERE e.id = ? LIMIT 1`,
      [employeeId]
    );
    const emp = (empRows as Array<{
      name: string; pan: string | null; designation: string | null; date_of_joining: string | null;
    }>)[0];

    // Derive financial year for declaration lookup
    const [yr, mo] = run.run_month.split("-").map(Number);
    const fyStart = mo >= 4 ? yr : yr - 1;
    const financialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

    // Load tax declaration
    const [declRows] = await db.execute<RowDataPacket[]>(
      "SELECT declared_hra, declared_80c, declared_80d, regime FROM tax_declaration WHERE employee_id = ? AND financial_year = ? LIMIT 1",
      [employeeId, financialYear]
    );
    const decl = (declRows as Array<{
      declared_hra: number; declared_80c: number; declared_80d: number; regime: string;
    }>)[0] ?? null;

    const grossSalary = Number(line.gross_salary);
    const standardDeduction = 75000;
    const tdsDeducted = Number(line.tds_amount) || Number(line.tds) || 0;
    const totalDeductions = standardDeduction
      + (decl ? Number(decl.declared_hra) + Number(decl.declared_80c) + Number(decl.declared_80d) : 0);
    const netTaxableIncome = Math.max(0, (grossSalary * 12) - totalDeductions);

    return res.json({
      success: true,
      data: {
        financial_year: financialYear,
        period: run.run_month,
        employee: {
          name: emp?.name ?? "",
          pan: emp?.pan ?? null,
          designation: emp?.designation ?? null,
          period: `Apr ${fyStart} – Mar ${fyStart + 1}`,
        },
        gross_salary: grossSalary,
        standard_deduction: standardDeduction,
        tds_deducted: tdsDeducted,
        net_taxable_income: netTaxableIncome,
        declaration: decl
          ? {
              hra: Number(decl.declared_hra),
              "80c": Number(decl.declared_80c),
              "80d": Number(decl.declared_80d),
              regime: decl.regime,
            }
          : null,
      },
    });
  })
);

// ─── PT Slabs ─────────────────────────────────────────────────────────────────

// GET /api/payroll/pt-slabs — list PT slabs; optional ?state_code=
router.get("/pt-slabs", h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM pt_slab_master ${where} ORDER BY state_code, income_from`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// POST /api/payroll/pt-slabs — create slab (admin/finance)
router.post(
  "/pt-slabs",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from } =
      req.body as {
        state_code: string;
        state_name: string;
        income_from: number;
        income_to?: number | null;
        pt_amount: number;
        frequency: string;
        effective_from: string;
      };

    if (!state_code || !state_name || income_from === undefined || pt_amount === undefined || !frequency || !effective_from) {
      return res.status(400).json({ success: false, message: "state_code, state_name, income_from, pt_amount, frequency, effective_from are required" });
    }

    const id = (await import("crypto")).randomUUID();
    await db.execute(
      `INSERT INTO pt_slab_master (id, state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from, is_active)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [id, state_code, state_name, income_from, income_to ?? null, pt_amount, frequency, effective_from]
    );
    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.status(201).json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// PATCH /api/payroll/pt-slabs/:id — update slab (admin/finance)
router.patch(
  "/pt-slabs/:id",
  requireRole("admin", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id } = req.params;
    const { pt_amount, income_to, is_active } = req.body as {
      pt_amount?: number;
      income_to?: number | null;
      is_active?: number;
    };

    const sets: string[] = [];
    const params: unknown[] = [];

    if (pt_amount !== undefined) { sets.push("pt_amount = ?");  params.push(pt_amount); }
    if (income_to !== undefined) { sets.push("income_to = ?");  params.push(income_to ?? null); }
    if (is_active !== undefined) { sets.push("is_active = ?");  params.push(is_active); }

    if (sets.length === 0) {
      return res.status(400).json({ success: false, message: "No fields to update" });
    }

    params.push(id);
    const patchResult = await db.execute(
      `UPDATE pt_slab_master SET ${sets.join(", ")} WHERE id = ?`,
      params
    );
    const result = (patchResult as unknown as [{ affectedRows: number }, unknown])[0];

    if (result.affectedRows === 0) {
      return res.status(404).json({ success: false, message: "PT slab not found" });
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1",
      [id]
    );
    return res.json({ success: true, data: (rows as RowDataPacket[])[0] });
  })
);

// ─── Minimum Wages ────────────────────────────────────────────────────────────

// GET /api/payroll/minimum-wages — list minimum wages; optional ?state_code=
router.get("/minimum-wages", h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code } = req.query as { state_code?: string };
  const params: unknown[] = [];
  let where = "WHERE is_active = 1";
  if (state_code) {
    where += " AND state_code = ?";
    params.push(state_code);
  }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM minimum_wage_master ${where} ORDER BY state_code, category`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ─── NEFT Export ─────────────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/neft-summary — count of employees with/without bank details
router.get("/runs/:id/neft-summary", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       COUNT(*)                                                                          AS total,
       SUM(CASE WHEN ebd.id IS NOT NULL AND ebd.ifsc_code IS NOT NULL THEN 1 ELSE 0 END) AS with_bank,
       SUM(CASE WHEN ebd.id IS NULL OR ebd.ifsc_code IS NULL THEN 1 ELSE 0 END)          AS missing_bank,
       SUM(spl.net_salary)                                                               AS total_net
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.net_salary > 0`,
    [req.params.id]
  );
  res.json({ success: true, data: (rows as RowDataPacket[])[0] });
}));

// GET /api/payroll/runs/:id/neft-export — generate NEFT disbursement CSV
router.get("/runs/:id/neft-export", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as RowDataPacket[])[0];
  if (!run) return res.status(404).json({ error: "Run not found" });
  if (!["locked", "disbursed"].includes(run.status as string)) {
    return res.status(400).json({ error: "Run must be locked or disbursed to generate NEFT export" });
  }

  const [lines] = await db.execute<RowDataPacket[]>(
    `SELECT spl.employee_id, spl.net_salary, spl.gross_salary, spl.total_deductions,
            e.employee_code, e.full_name, e.email,
            ebd.bank_name, ebd.ifsc_code,
            AES_DECRYPT(ebd.account_number, 'hrms-bank-key') AS account_number
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     LEFT JOIN employee_bank_detail ebd ON ebd.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.net_salary > 0
     ORDER BY e.employee_code`,
    [runId]
  );

  // Standard Indian bank NEFT format
  // Columns: Sr No, Employee Code, Employee Name, Bank Name, IFSC Code, Account Number, Net Amount, Remarks
  const csvRows = ["Sr No,Employee Code,Employee Name,Bank Name,IFSC Code,Account Number,Net Amount,Remarks"];
  let srNo = 1;
  let totalAmount = 0;

  for (const line of lines as RowDataPacket[]) {
    const accountNo = line.account_number ? String(line.account_number) : "NOT_LINKED";
    const ifsc = (line.ifsc_code as string | null) ?? "NOT_LINKED";
    const bank = ((line.bank_name as string | null) ?? "").replace(/,/g, " ");
    const name = ((line.full_name as string | null) ?? "").replace(/,/g, " ");
    const amount = Number(line.net_salary).toFixed(2);
    const remarks = `SALARY ${run.run_month as string}`;
    csvRows.push(`${srNo},${line.employee_code as string},${name},${bank},${ifsc},${accountNo},${amount},${remarks}`);
    srNo++;
    totalAmount += Number(line.net_salary);
  }

  csvRows.push(`TOTAL,,,,,,${totalAmount.toFixed(2)},`);

  const csv = csvRows.join("\n");
  const filename = `NEFT_${run.run_month as string}_${runId.slice(0, 8)}.csv`;

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(csv);
}));

// ─── ECR / ESIC Challan ───────────────────────────────────────────────────────

// GET /api/payroll/runs/:id/ecr — ECR-format data for a run
router.get("/runs/:id/ecr", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  // Verify run exists
  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  if (!(runRows as RowDataPacket[]).length) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       eu.uan,
       eu.member_id,
       CONCAT_WS(' ', e.first_name, e.last_name) AS member_name,
       spl.gross_salary                           AS wages,
       spl.pf_employee                            AS epf_contribution,
       (spl.pf_employer - ROUND(spl.pf_employer * 3.67 / 12, 2)) AS eps_contribution
     FROM salary_prep_line spl
     JOIN employees e        ON e.id  = spl.employee_id
     LEFT JOIN employee_uan eu ON eu.employee_id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  return res.json({ success: true, run_id: runId, data: rows });
}));

// GET /api/payroll/runs/:id/esic-challan — ESIC challan data for a run
router.get("/runs/:id/esic-challan", requireRole("admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const runId = req.params.id;

  const [runRows] = await db.execute<RowDataPacket[]>(
    "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1",
    [runId]
  );
  const run = (runRows as Array<{ id: string; run_month: string }>)[0];
  if (!run) {
    return res.status(404).json({ success: false, message: "Run not found" });
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.employee_code,
       CONCAT_WS(' ', e.first_name, e.last_name) AS employee_name,
       spl.gross_salary                           AS wages,
       spl.esic_employee                          AS employee_contribution,
       spl.esic_employer                          AS employer_contribution
     FROM salary_prep_line spl
     JOIN employees e ON e.id = spl.employee_id
     WHERE spl.run_id = ? AND spl.status != 'cancelled'
     ORDER BY e.employee_code`,
    [runId]
  );

  const lines = rows as Array<{
    employee_code: string;
    employee_name: string;
    wages: number;
    employee_contribution: number;
    employer_contribution: number;
  }>;

  const totals = lines.reduce(
    (acc, l) => {
      acc.total_wages        += Number(l.wages);
      acc.employee_total     += Number(l.employee_contribution);
      acc.employer_total     += Number(l.employer_contribution);
      return acc;
    },
    { total_wages: 0, employee_total: 0, employer_total: 0 }
  );

  return res.json({
    success: true,
    run_id: runId,
    period: run.run_month,
    employee_count: lines.length,
    ...totals,
    data: lines,
  });
}));

export { router as payrollRouter };
