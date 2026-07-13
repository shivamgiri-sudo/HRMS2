import { Router } from "express";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { db } from "../../db/mysql.js";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import multer from "multer";
import { randomUUID } from "crypto";

export const payrollMoreRouter = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
payrollMoreRouter.use(requireAuth);

payrollMoreRouter.get("/form16-data/:runId/:employeeId", h(async (req: AuthenticatedRequest, res: Response) => {
  const { runId, employeeId } = req.params;
  const isPayrollRole = await hasRole(req.authUser!.id, "admin", "hr", "finance", "payroll");
  if (!isPayrollRole) {
    const callerEmp = await getEmployeeForUser(req.authUser!.id);
    if (!callerEmp || callerEmp.id !== employeeId) return res.status(403).json({ success: false, message: "Forbidden" });
  }

  const [runRows] = await db.execute<RowDataPacket[]>("SELECT run_month FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]);
  const run = runRows[0] as { run_month: string } | undefined;
  if (!run) return res.status(404).json({ success: false, message: "Run not found" });

  const [lineRows] = await db.execute<RowDataPacket[]>(
    `SELECT gross_salary, tds_amount, tds FROM salary_prep_line WHERE run_id = ? AND employee_id = ? LIMIT 1`,
    [runId, employeeId],
  );
  const line = lineRows[0] as { gross_salary: number; tds_amount: number; tds: number } | undefined;
  if (!line) return res.status(404).json({ success: false, message: "Payroll line not found for employee" });

  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT CONCAT_WS(' ', e.first_name, e.last_name) AS name,
            e.pan_number AS pan,
            dm.designation_name AS designation,
            e.date_of_joining
       FROM employees e
       LEFT JOIN designation_master dm ON dm.id = e.designation_id
      WHERE e.id = ? LIMIT 1`,
    [employeeId],
  );
  const emp = empRows[0] as { name: string; pan: string | null; designation: string | null; date_of_joining: string | null } | undefined;

  const [yr, mo] = run.run_month.split("-").map(Number);
  const fyStart = mo >= 4 ? yr : yr - 1;
  const financialYear = `${fyStart}-${fyStart + 1}`;
  const legacyFinancialYear = `${fyStart}-${String(fyStart + 1).slice(2)}`;

  const [declRows] = await db.execute<RowDataPacket[]>(
    `SELECT declared_hra, declared_80c, declared_80d, regime
       FROM tax_declaration
      WHERE employee_id = ? AND financial_year IN (?, ?)
      ORDER BY financial_year = ? DESC
      LIMIT 1`,
    [employeeId, financialYear, legacyFinancialYear, financialYear],
  );
  const decl = declRows[0] as { declared_hra: number; declared_80c: number; declared_80d: number; regime: string } | undefined;

  const grossSalary = Number(line.gross_salary);
  const standardDeduction = 75000;
  const tdsDeducted = Number(line.tds_amount) || Number(line.tds) || 0;
  const totalDeductions = standardDeduction + (decl ? Number(decl.declared_hra) + Number(decl.declared_80c) + Number(decl.declared_80d) : 0);
  const netTaxableIncome = Math.max(0, grossSalary * 12 - totalDeductions);

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
      declaration: decl ? { hra: Number(decl.declared_hra), "80c": Number(decl.declared_80c), "80d": Number(decl.declared_80d), regime: decl.regime } : null,
    },
  });
}));

payrollMoreRouter.post("/pt-slabs", requireRole("admin", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { state_code, state_name, income_from, income_to, pt_amount, frequency, effective_from } = req.body as {
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
    [id, state_code, state_name, income_from, income_to ?? null, pt_amount, frequency, effective_from],
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1", [id]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollMoreRouter.patch("/pt-slabs/:id", requireRole("admin", "finance"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { pt_amount, income_to, is_active } = req.body as { pt_amount?: number; income_to?: number | null; is_active?: number };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (pt_amount !== undefined) { sets.push("pt_amount = ?"); params.push(pt_amount); }
  if (income_to !== undefined) { sets.push("income_to = ?"); params.push(income_to ?? null); }
  if (is_active !== undefined) { sets.push("is_active = ?"); params.push(is_active); }
  if (sets.length === 0) return res.status(400).json({ success: false, message: "No fields to update" });
  params.push(id);
  const [result] = await db.execute<any>(`UPDATE pt_slab_master SET ${sets.join(", ")} WHERE id = ?`, params);
  if (result.affectedRows === 0) return res.status(404).json({ success: false, message: "PT slab not found" });
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM pt_slab_master WHERE id = ? LIMIT 1", [id]);
  return res.json({ success: true, data: rows[0] });
}));

// ─── Payroll Config Flags ─────────────────────────────────────────────────────

payrollMoreRouter.get("/config-flags", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { branch_id, process_id } = req.query as { branch_id?: string; process_id?: string };
  const conds: string[] = [];
  const params: unknown[] = [];
  if (branch_id)  { conds.push("branch_id = ?");  params.push(branch_id); }
  if (process_id) { conds.push("process_id = ?"); params.push(process_id); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_config_flags ${where} ORDER BY config_key ASC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

payrollMoreRouter.put("/config-flags", requireRole("admin", "super_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { branch_id, process_id, config_key, config_value, description } = req.body as {
    branch_id?: string | null; process_id?: string | null;
    config_key: string; config_value: string; description?: string;
  };
  if (!config_key || config_value === undefined) {
    return res.status(400).json({ success: false, message: "config_key and config_value are required" });
  }
  const { randomUUID } = await import("crypto");
  const id = randomUUID();
  const actor = req.authUser?.id ?? "system";
  await db.execute(
    `INSERT INTO payroll_config_flags (id, branch_id, process_id, config_key, config_value, description, updated_by)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), description = COALESCE(VALUES(description), description), updated_by = VALUES(updated_by), updated_at = NOW()`,
    [id, branch_id ?? null, process_id ?? null, config_key, config_value, description ?? null, actor]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_config_flags WHERE config_key = ? AND (branch_id <=> ?) AND (process_id <=> ?) LIMIT 1`,
    [config_key, branch_id ?? null, process_id ?? null]
  );
  return res.json({ success: true, data: rows[0] });
}));

// ─── Recalculation Queue ─────────────────────────────────────────────────────

payrollMoreRouter.get("/recalculation-queue", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "payroll_branch"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status, payrollMonth, page: rawPage, limit: rawLimit } = req.query as {
    status?: string; payrollMonth?: string; page?: string; limit?: string;
  };
  const page  = Math.max(1, parseInt(rawPage ?? "1", 10));
  const limit = Math.min(200, parseInt(rawLimit ?? "50", 10));
  const offset = (page - 1) * limit;
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status)        { conds.push("rq.status = ?");               params.push(status); }
  if (payrollMonth)  { conds.push("DATE_FORMAT(rq.payroll_month, '%Y-%m') = ?"); params.push(payrollMonth); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rq.*,
            COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            e.employee_code
       FROM payroll_recalculation_queue rq
       LEFT JOIN employees e ON e.id = rq.employee_id
       ${where}
       ORDER BY rq.requested_at DESC
       LIMIT ${limit} OFFSET ${offset}`,
    params
  );
  const [countRow] = await db.execute<RowDataPacket[]>(
    `SELECT COUNT(*) AS total FROM payroll_recalculation_queue rq ${where}`,
    params
  );
  return res.json({ success: true, data: rows, total: (countRow[0] as any).total, page, limit });
}));

payrollMoreRouter.post("/recalculation-queue", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { employee_id, payroll_month, reason } = req.body as {
    employee_id: string; payroll_month: string; reason?: string;
  };
  if (!employee_id || !payroll_month) {
    return res.status(400).json({ success: false, message: "employee_id and payroll_month (YYYY-MM) are required" });
  }
  if (!/^\d{4}-\d{2}$/.test(payroll_month)) {
    return res.status(400).json({ success: false, message: "payroll_month must be YYYY-MM format" });
  }
  const monthDate = `${payroll_month}-01`;
  const [empRows] = await db.execute<RowDataPacket[]>("SELECT id FROM employees WHERE id = ? LIMIT 1", [employee_id]);
  if (!(empRows as any[]).length) return res.status(404).json({ success: false, message: "Employee not found" });
  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();
  await db.execute(
    `INSERT INTO payroll_recalculation_queue
       (id, employee_id, payroll_month, source_event_type, reason, status, requested_by, requested_at)
     VALUES (?, ?, ?, 'manual_override', ?, 'pending', ?, NOW())`,
    [id, employee_id, monthDate, reason ?? "Manual recalculation request", req.authUser!.id]
  );
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT rq.*,
            COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
            e.employee_code
       FROM payroll_recalculation_queue rq
       LEFT JOIN employees e ON e.id = rq.employee_id
      WHERE rq.id = ? LIMIT 1`,
    [id]
  );
  return res.status(201).json({ success: true, data: rows[0] });
}));

// ─── Holiday Master ───────────────────────────────────────────────────────────

payrollMoreRouter.get("/holiday-master", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "payroll_branch"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { year, includeInactive } = req.query as { year?: string; includeInactive?: string };
  const params: unknown[] = [];
  let sql = `SELECT lhm.*,
                    hcc.cost_centre_ids,
                    hdm.designation_ids
               FROM leave_holiday_master lhm
               LEFT JOIN (
                 SELECT holiday_id, JSON_ARRAYAGG(cost_centre_id) AS cost_centre_ids
                   FROM holiday_cost_centre_mapping GROUP BY holiday_id
               ) hcc ON hcc.holiday_id = lhm.id
               LEFT JOIN (
                 SELECT holiday_id, JSON_ARRAYAGG(designation_id) AS designation_ids
                   FROM holiday_designation_mapping GROUP BY holiday_id
               ) hdm ON hdm.holiday_id = lhm.id
              WHERE 1=1`;
  if (!includeInactive || includeInactive === "0" || includeInactive === "false") {
    sql += " AND lhm.active_status = 1";
  }
  if (year) { sql += " AND YEAR(lhm.holiday_date) = ?"; params.push(year); }
  sql += " ORDER BY lhm.holiday_date ASC";
  const [rows] = await db.execute<RowDataPacket[]>(sql, params);
  return res.json({ success: true, data: rows });
}));

payrollMoreRouter.post("/holiday-master", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { holiday_name, holiday_date, holiday_type, branch_id, active_status } = req.body as {
    holiday_name: string; holiday_date: string; holiday_type: string;
    branch_id?: string; active_status?: number;
  };
  if (!holiday_name || !holiday_date || !holiday_type) {
    return res.status(400).json({ success: false, message: "holiday_name, holiday_date and holiday_type are required" });
  }
  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();
  await db.execute(
    `INSERT INTO leave_holiday_master (id, holiday_name, holiday_date, holiday_type, branch_id, active_status)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, holiday_name, holiday_date, holiday_type, branch_id ?? null, active_status ?? 1]
  );
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM leave_holiday_master WHERE id = ? LIMIT 1", [id]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollMoreRouter.put("/holiday-master/:id", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { holiday_name, holiday_date, holiday_type, branch_id, active_status } = req.body as {
    holiday_name?: string; holiday_date?: string; holiday_type?: string;
    branch_id?: string | null; active_status?: number;
  };
  const sets: string[] = [];
  const params: unknown[] = [];
  if (holiday_name !== undefined)  { sets.push("holiday_name = ?");  params.push(holiday_name); }
  if (holiday_date !== undefined)  { sets.push("holiday_date = ?");  params.push(holiday_date); }
  if (holiday_type !== undefined)  { sets.push("holiday_type = ?");  params.push(holiday_type); }
  if (branch_id !== undefined)     { sets.push("branch_id = ?");     params.push(branch_id); }
  if (active_status !== undefined) { sets.push("active_status = ?"); params.push(active_status); }
  if (sets.length === 0) return res.status(400).json({ success: false, message: "No fields to update" });
  params.push(id);
  await db.execute(`UPDATE leave_holiday_master SET ${sets.join(", ")} WHERE id = ?`, params);
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM leave_holiday_master WHERE id = ? LIMIT 1", [id]);
  if (!(rows as any[]).length) return res.status(404).json({ success: false, message: "Holiday not found" });
  return res.json({ success: true, data: rows[0] });
}));

payrollMoreRouter.patch("/holiday-master/:id/toggle", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const [rows] = await db.execute<RowDataPacket[]>("SELECT active_status FROM leave_holiday_master WHERE id = ? LIMIT 1", [id]);
  if (!(rows as any[]).length) return res.status(404).json({ success: false, message: "Holiday not found" });
  const newStatus = (rows[0] as any).active_status ? 0 : 1;
  await db.execute("UPDATE leave_holiday_master SET active_status = ? WHERE id = ?", [newStatus, id]);
  return res.json({ success: true, active_status: newStatus });
}));

payrollMoreRouter.post("/holiday-master/cc-mapping", requireRole("admin", "super_admin", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { holiday_id, cost_centre_ids, branch_id, process_id, department_id } = req.body as {
    holiday_id: string; cost_centre_ids: string[];
    branch_id?: string; process_id?: string; department_id?: string;
  };
  if (!holiday_id || !Array.isArray(cost_centre_ids)) return res.status(400).json({ success: false, message: "holiday_id and cost_centre_ids required" });
  await db.execute("DELETE FROM holiday_cost_centre_mapping WHERE holiday_id = ?", [holiday_id]);
  const { v4: uuidv4 } = await import("uuid");
  for (const cc of cost_centre_ids) {
    await db.execute(
      "INSERT INTO holiday_cost_centre_mapping (id, holiday_id, cost_centre_id, branch_id, process_id, department_id) VALUES (?, ?, ?, ?, ?, ?)",
      [uuidv4(), holiday_id, cc, branch_id ?? null, process_id ?? null, department_id ?? null]
    );
  }
  return res.json({ success: true });
}));

payrollMoreRouter.post("/holiday-master/designation-mapping", requireRole("admin", "super_admin", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { holiday_id, designation_ids } = req.body as { holiday_id: string; designation_ids: string[] };
  if (!holiday_id || !Array.isArray(designation_ids)) return res.status(400).json({ success: false, message: "holiday_id and designation_ids required" });
  await db.execute("DELETE FROM holiday_designation_mapping WHERE holiday_id = ?", [holiday_id]);
  for (const did of designation_ids) {
    const { v4: uuidv4 } = await import("uuid");
    await db.execute("INSERT INTO holiday_designation_mapping (id, holiday_id, designation_id) VALUES (?, ?, ?)", [uuidv4(), holiday_id, did]);
  }
  return res.json({ success: true });
}));

payrollMoreRouter.delete("/holiday-master/:id", requireRole("super_admin", "admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  if (!id) return res.status(400).json({ success: false, message: "id required" });
  await db.execute("DELETE FROM holiday_cost_centre_mapping WHERE holiday_id = ?", [id]);
  await db.execute("DELETE FROM holiday_designation_mapping WHERE holiday_id = ?", [id]);
  await db.execute("DELETE FROM leave_holiday_master WHERE id = ?", [id]);
  return res.json({ success: true });
}));

// ─── Holiday Work Policies & Requests ────────────────────────────────────────

payrollMoreRouter.get("/holiday-work/policies", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "payroll_branch"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    "SELECT * FROM holiday_work_policy_master WHERE is_active = 1 ORDER BY payout_type ASC"
  );
  return res.json({ success: true, data: rows });
}));

payrollMoreRouter.get("/holiday-work/requests", requireRole("admin", "super_admin", "finance", "payroll", "payroll_head", "payroll_branch"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status, month } = req.query as { status?: string; month?: string };
  const conds: string[] = [];
  const params: unknown[] = [];
  if (status) { conds.push("hwr.status = ?"); params.push(status); }
  if (month)  { conds.push("DATE_FORMAT(hwr.request_month, '%Y-%m') = ?"); params.push(month); }
  const where = conds.length ? `WHERE ${conds.join(" AND ")}` : "";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT hwr.*,
            lhm.holiday_name, lhm.holiday_type,
            hwp.payout_type, hwp.extra_multiplier AS payout_rate_multiplier,
            COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS requested_by_name
       FROM holiday_work_request hwr
       LEFT JOIN leave_holiday_master lhm ON lhm.id = hwr.holiday_id
       LEFT JOIN holiday_work_policy_master hwp ON hwp.id = hwr.payout_policy_id
       LEFT JOIN employees e ON e.id = hwr.requested_by
       ${where}
       ORDER BY hwr.created_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

payrollMoreRouter.post("/holiday-work/requests", requireRole("admin", "super_admin", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { holiday_id, request_month, branch_id, process_id, cost_centre_id, payout_policy_id, designation_ids, request_reason, remarks } = req.body as {
    holiday_id: string; request_month: string; branch_id: string; process_id: string;
    cost_centre_id?: string; payout_policy_id: string; designation_ids?: string[];
    request_reason?: string; remarks?: string;
  };
  if (!holiday_id || !payout_policy_id) return res.status(400).json({ success: false, message: "holiday_id and payout_policy_id required" });
  const month = request_month ?? new Date().toISOString().slice(0, 7) + "-01";
  const { v4: uuidv4 } = await import("uuid");
  const id = uuidv4();
  await db.execute(
    `INSERT INTO holiday_work_request (id, holiday_id, request_month, branch_id, process_id, cost_centre_id, payout_policy_id, request_reason, remarks, status, requested_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted', ?)`,
    [id, holiday_id, month, branch_id ?? null, process_id ?? null, cost_centre_id ?? null,
     payout_policy_id, request_reason ?? remarks ?? "", remarks ?? null, req.authUser!.id]
  );
  if (Array.isArray(designation_ids) && designation_ids.length > 0) {
    for (const did of designation_ids) {
      await db.execute("INSERT INTO holiday_work_request_designation (id, request_id, designation_id) VALUES (?, ?, ?)", [uuidv4(), id, did]);
    }
  }
  const [rows] = await db.execute<RowDataPacket[]>("SELECT * FROM holiday_work_request WHERE id = ? LIMIT 1", [id]);
  return res.status(201).json({ success: true, data: rows[0] });
}));

payrollMoreRouter.patch("/holiday-work/requests/:id/approve", requireRole("admin", "super_admin", "payroll", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { id } = req.params;
  const { action, remarks } = req.body as { action: "approve" | "reject"; remarks?: string };
  if (!["approve", "reject"].includes(action)) return res.status(400).json({ success: false, message: "action must be approve or reject" });
  const [existing] = await db.execute<RowDataPacket[]>("SELECT status FROM holiday_work_request WHERE id = ? LIMIT 1", [id]);
  const fromStatus = (existing[0] as any)?.status ?? "";
  const newStatus = action === "approve" ? "payroll_head_approved" : "rejected";
  await db.execute("UPDATE holiday_work_request SET status = ? WHERE id = ?", [newStatus, id]);
  const { v4: uuidv4 } = await import("uuid");
  await db.execute(
    "INSERT INTO holiday_work_approval_log (id, request_id, approver_id, approver_role, action, from_status, to_status, remarks) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    [uuidv4(), id, req.authUser!.id, "payroll_head", action === "approve" ? "approved" : "rejected", fromStatus, newStatus, remarks ?? null]
  );
  return res.json({ success: true, status: newStatus });
}));

// ══════════════════════════════════════════════════════════════════════════════
// DEDUCTION TYPE MASTER — CRUD + TOGGLE
// ══════════════════════════════════════════════════════════════════════════════
const dedCsvUpload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

// GET /deductions/types — list all deduction types
payrollMoreRouter.get("/deductions/types", h(async (req: AuthenticatedRequest, res: Response) => {
  const includeInactive = (req.query as any).all === "true";
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM payroll_deduction_type ${includeInactive ? "" : "WHERE active_status = 1"} ORDER BY deduction_name`
  );
  return res.json({ success: true, data: rows });
}));

// POST /deductions/types — create new deduction type
payrollMoreRouter.post("/deductions/types", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { deduction_code, deduction_name, description, is_prorated } = req.body as any;
  if (!deduction_code || !deduction_name) return res.status(400).json({ success: false, message: "deduction_code and deduction_name are required" });
  const code = String(deduction_code).toUpperCase().replace(/\s+/g, "_");
  const id = randomUUID();
  await db.execute(
    "INSERT INTO payroll_deduction_type (id, deduction_code, deduction_name, description, is_prorated, active_status, created_by) VALUES (?, ?, ?, ?, ?, 1, ?)",
    [id, code, deduction_name, description ?? null, is_prorated ? 1 : 0, req.authUser!.id]
  );
  return res.status(201).json({ success: true, data: { id, deduction_code: code, deduction_name } });
}));

// PUT /deductions/types/:id — update deduction type
payrollMoreRouter.put("/deductions/types/:id", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { deduction_name, description, is_prorated } = req.body as any;
  if (!deduction_name) return res.status(400).json({ success: false, message: "deduction_name is required" });
  await db.execute(
    "UPDATE payroll_deduction_type SET deduction_name=?, description=?, is_prorated=? WHERE id=?",
    [deduction_name, description ?? null, is_prorated ? 1 : 0, req.params.id]
  );
  return res.json({ success: true });
}));

// PATCH /deductions/types/:id/toggle — activate / deactivate
payrollMoreRouter.patch("/deductions/types/:id/toggle", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const [rows] = await db.execute<RowDataPacket[]>("SELECT active_status FROM payroll_deduction_type WHERE id=?", [req.params.id]);
  if (!(rows as any[]).length) return res.status(404).json({ success: false, message: "Deduction type not found" });
  const current = (rows[0] as any).active_status;
  await db.execute("UPDATE payroll_deduction_type SET active_status=? WHERE id=?", [current ? 0 : 1, req.params.id]);
  return res.json({ success: true, data: { active_status: current ? 0 : 1 } });
}));

// ── DEDUCTION UPLOAD TEMPLATE ─────────────────────────────────────────────────
// GET /deductions/upload-template?month=YYYY-MM
payrollMoreRouter.get("/deductions/upload-template", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const month = ((req.query as any).month as string) || new Date().toISOString().slice(0, 7);

  const [types] = await db.execute<RowDataPacket[]>(
    "SELECT deduction_code FROM payroll_deduction_type WHERE active_status = 1 ORDER BY deduction_name"
  );
  const typeCodes = (types as any[]).map((t: any) => t.deduction_code as string);

  const [employees] = await db.execute<RowDataPacket[]>(
    `SELECT e.employee_code, b.branch_name, cc.cost_centre_code
     FROM employees e
     LEFT JOIN branch_master b ON b.id = e.branch_id
     LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
     WHERE e.employment_status IN ('active','on_leave')
     ORDER BY e.employee_code
     LIMIT 5000`
  );

  const headers = ["employee_code", "month", "branch", "cost_centre", ...typeCodes, "total_deduction"];
  const rows = (employees as any[]).map((emp: any) => [
    emp.employee_code, month,
    emp.branch_name ?? "", emp.cost_centre_code ?? "",
    ...typeCodes.map(() => 0), 0,
  ]);

  const csv = [headers.join(","), ...rows.map((r: any[]) => r.join(","))].join("\n");
  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", `attachment; filename="deduction_upload_${month}.csv"`);
  return res.send(csv);
}));

// ── DEDUCTION BULK UPLOAD ─────────────────────────────────────────────────────
// POST /deductions/bulk-upload — multipart CSV
payrollMoreRouter.post("/deductions/bulk-upload",
  requireRole("admin", "hr_admin", "finance", "payroll"),
  dedCsvUpload.single("file"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    if (!req.file) return res.status(400).json({ success: false, message: 'No file uploaded. Send CSV as multipart field "file".' });

    const csvText = req.file.buffer.toString("utf-8");
    const lines = csvText.split(/\r?\n/).filter((l: string) => l.trim());
    if (lines.length < 2) return res.status(400).json({ success: false, message: "CSV has no data rows" });

    const headers = lines[0].split(",").map((h: string) => h.trim().toLowerCase());
    const FIXED = new Set(["employee_code", "month", "branch", "cost_centre", "total_deduction"]);
    const typeCols = headers.filter((h: string) => !FIXED.has(h));

    if (!typeCols.length) return res.status(400).json({ success: false, message: "No deduction type columns found in CSV" });

    // Validate type columns exist in master
    const [dedTypes] = await db.execute<RowDataPacket[]>(
      "SELECT deduction_code, is_prorated FROM payroll_deduction_type WHERE active_status = 1"
    );
    const typeMap = new Map((dedTypes as any[]).map((t: any) => [t.deduction_code.toLowerCase(), t.is_prorated as number]));

    const [branches] = await db.execute<RowDataPacket[]>("SELECT id, branch_name FROM branch_master");
    const branchMap = new Map((branches as any[]).map((b: any) => [b.branch_name?.toLowerCase(), b.id]));

    const [costCentres] = await db.execute<RowDataPacket[]>("SELECT id, cost_centre_code FROM cost_centre_master");
    const ccMap = new Map((costCentres as any[]).map((c: any) => [c.cost_centre_code?.toLowerCase(), c.id]));

    const [empRows] = await db.execute<RowDataPacket[]>("SELECT id, employee_code FROM employees WHERE employment_status IN ('active','on_leave')");
    const empMap = new Map((empRows as any[]).map((e: any) => [e.employee_code?.toLowerCase(), e.id]));

    let inserted = 0;
    const errors: string[] = [];

    for (let i = 1; i < lines.length; i++) {
      const cols = lines[i].split(",").map((c: string) => c.trim());
      const row: Record<string, string> = {};
      headers.forEach((h: string, idx: number) => { row[h] = cols[idx] ?? ""; });

      const empCode = row["employee_code"]?.toLowerCase();
      const empId = empMap.get(empCode);
      if (!empId) { errors.push(`Row ${i + 1}: employee_code "${row["employee_code"]}" not found`); continue; }

      const runMonth = row["month"] || null;
      const branchId = branchMap.get(row["branch"]?.toLowerCase()) ?? null;
      const ccId = ccMap.get(row["cost_centre"]?.toLowerCase()) ?? null;

      for (const typeCode of typeCols) {
        const amount = parseFloat(row[typeCode]);
        if (!amount || amount <= 0) continue;
        if (!typeMap.has(typeCode.toLowerCase())) { errors.push(`Unknown deduction type: ${typeCode}`); continue; }

        const isProrated = typeMap.get(typeCode.toLowerCase()) ?? 0;
        await db.execute(
          `INSERT INTO employee_deduction_entries
             (id, employee_id, description, deduction_type_code, amount, is_prorated, run_month, status, branch_id, cost_centre_id, created_by)
           VALUES (?, ?, ?, ?, ?, ?, ?, 'active', ?, ?, ?)
           ON DUPLICATE KEY UPDATE amount=VALUES(amount), is_prorated=VALUES(is_prorated), status='active'`,
          [randomUUID(), empId, typeCode.toUpperCase(), typeCode.toUpperCase(),
           amount, isProrated, runMonth, branchId, ccId, req.authUser!.id]
        );
        inserted++;
      }
    }

    return res.status(201).json({
      success: true,
      data: { lines_inserted: inserted, errors: errors.slice(0, 20) },
    });
  })
);

// GET /deductions/employee/:employeeId — list deduction entries for one employee
payrollMoreRouter.get("/deductions/employee/:employeeId", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { runMonth } = req.query as any;
  const params: unknown[] = [req.params.employeeId];
  let extra = "";
  if (runMonth) { extra = " AND (run_month IS NULL OR run_month = ?)"; params.push(runMonth); }
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT ede.*, pdt.deduction_name FROM employee_deduction_entries ede
     LEFT JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
     WHERE ede.employee_id = ?${extra}
     ORDER BY ede.created_at DESC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// PATCH /deductions/entry/:id — activate / deactivate one entry
payrollMoreRouter.patch("/deductions/entry/:id", requireRole("admin", "hr_admin", "finance", "payroll"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { status } = req.body as { status: "active" | "inactive" };
  if (!["active", "inactive"].includes(status)) return res.status(400).json({ success: false, message: 'status must be "active" or "inactive"' });
  await db.execute("UPDATE employee_deduction_entries SET status=? WHERE id=?", [status, req.params.id]);
  return res.json({ success: true });
}));

// ─── Holiday Work Auto-Generation Config ──────────────────────────────────────

// GET /api/payroll/holiday-work/config/processes
// List all processes with their auto-gen status
payrollMoreRouter.get("/holiday-work/config/processes", requireRole("admin", "super_admin", "payroll_head"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [processes] = await db.execute<RowDataPacket[]>(`
    SELECT p.id, p.process_name,
           COALESCE(pcf.config_value, 'false') AS auto_gen_enabled
    FROM process_master p
    LEFT JOIN payroll_config_flags pcf
      ON pcf.process_id = p.id
     AND pcf.config_key = 'holiday_work_extra_pay_enabled'
    WHERE p.active_status = 1
    ORDER BY p.process_name
  `);
  return res.json({ success: true, data: processes });
}));

// PATCH /api/payroll/holiday-work/config/process/:processId
// Enable/disable auto-generation for a process
payrollMoreRouter.patch("/holiday-work/config/process/:processId", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { processId } = req.params;
  const { enabled } = req.body as { enabled: boolean };

  await db.execute(`
    INSERT INTO payroll_config_flags (id, process_id, config_key, config_value)
    VALUES (UUID(), ?, 'holiday_work_extra_pay_enabled', ?)
    ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
  `, [processId, enabled ? 'true' : 'false']);

  return res.json({ success: true, message: 'Process configuration updated' });
}));

// PATCH /api/payroll/holidays/:holidayId/extra-pay-eligible
// Mark holiday as eligible/ineligible for extra pay
payrollMoreRouter.patch("/holidays/:holidayId/extra-pay-eligible", requireRole("admin", "super_admin", "hr_admin"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { holidayId } = req.params;
  const { eligible } = req.body as { eligible: boolean };

  await db.execute(`
    UPDATE leave_holiday_master
    SET extra_pay_eligible = ?
    WHERE id = ?
  `, [eligible ? 1 : 0, holidayId]);

  return res.json({ success: true, message: 'Holiday extra pay eligibility updated' });
}));

// ─── Overtime Process Configuration ──────────────────────────────────────────

// GET /api/payroll/overtime/config/processes
// List all processes with their overtime eligibility status + rate/cap
payrollMoreRouter.get("/overtime/config/processes", requireRole("admin", "super_admin", "payroll_head", "wfm"), h(async (_req: AuthenticatedRequest, res: Response) => {
  const [processes] = await db.execute<RowDataPacket[]>(`
    SELECT p.id, p.process_code, p.process_name,
           COALESCE(pcf_allowed.config_value, 'false') AS overtime_allowed,
           COALESCE(pcf_rate.config_value, '1.5') AS overtime_rate_multiplier,
           COALESCE(pcf_cap.config_value, '0') AS overtime_monthly_cap_hours,
           COALESCE(pcf_min.config_value, '1') AS overtime_minimum_hours,
           COALESCE(pcf_round.config_value, '1') AS overtime_rounding_unit
    FROM process_master p
    LEFT JOIN payroll_config_flags pcf_allowed
      ON pcf_allowed.process_id = p.id
     AND pcf_allowed.branch_id IS NULL
     AND pcf_allowed.config_key = 'overtime_allowed'
    LEFT JOIN payroll_config_flags pcf_rate
      ON pcf_rate.process_id = p.id
     AND pcf_rate.branch_id IS NULL
     AND pcf_rate.config_key = 'overtime_rate_multiplier'
    LEFT JOIN payroll_config_flags pcf_cap
      ON pcf_cap.process_id = p.id
     AND pcf_cap.branch_id IS NULL
     AND pcf_cap.config_key = 'overtime_monthly_cap_hours'
    LEFT JOIN payroll_config_flags pcf_min
      ON pcf_min.process_id = p.id
     AND pcf_min.branch_id IS NULL
     AND pcf_min.config_key = 'overtime_minimum_hours'
    LEFT JOIN payroll_config_flags pcf_round
      ON pcf_round.process_id = p.id
     AND pcf_round.branch_id IS NULL
     AND pcf_round.config_key = 'overtime_rounding_unit'
    WHERE p.active_status = 1
    ORDER BY p.process_name
  `);
  return res.json({ success: true, data: processes });
}));

// PATCH /api/payroll/overtime/config/process/:processId
// Enable/disable overtime + set rate/cap for a process
payrollMoreRouter.patch("/overtime/config/process/:processId", requireRole("admin", "super_admin", "payroll_head"), h(async (req: AuthenticatedRequest, res: Response) => {
  const { processId } = req.params;
  const { overtime_allowed, overtime_rate_multiplier, overtime_monthly_cap_hours, overtime_minimum_hours, overtime_rounding_unit } = req.body as {
    overtime_allowed?: boolean;
    overtime_rate_multiplier?: number;
    overtime_monthly_cap_hours?: number;
    overtime_minimum_hours?: number;
    overtime_rounding_unit?: number;
  };

  if (overtime_allowed !== undefined) {
    await db.execute(`
      INSERT INTO payroll_config_flags (id, process_id, config_key, config_value, description)
      VALUES (UUID(), ?, 'overtime_allowed', ?, 'Whether overtime is allowed for this process')
      ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
    `, [processId, overtime_allowed ? 'true' : 'false']);
  }

  if (overtime_rate_multiplier !== undefined) {
    await db.execute(`
      INSERT INTO payroll_config_flags (id, process_id, config_key, config_value, description)
      VALUES (UUID(), ?, 'overtime_rate_multiplier', ?, 'OT rate multiplier for this process')
      ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
    `, [processId, String(overtime_rate_multiplier)]);
  }

  if (overtime_monthly_cap_hours !== undefined) {
    await db.execute(`
      INSERT INTO payroll_config_flags (id, process_id, config_key, config_value, description)
      VALUES (UUID(), ?, 'overtime_monthly_cap_hours', ?, 'Monthly OT cap hours for this process')
      ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
    `, [processId, String(overtime_monthly_cap_hours)]);
  }

  if (overtime_minimum_hours !== undefined) {
    await db.execute(`
      INSERT INTO payroll_config_flags (id, process_id, config_key, config_value, description)
      VALUES (UUID(), ?, 'overtime_minimum_hours', ?, 'Minimum OT hours threshold for this process')
      ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
    `, [processId, String(overtime_minimum_hours)]);
  }

  if (overtime_rounding_unit !== undefined) {
    await db.execute(`
      INSERT INTO payroll_config_flags (id, process_id, config_key, config_value, description)
      VALUES (UUID(), ?, 'overtime_rounding_unit', ?, 'OT rounding granularity (floor) for this process')
      ON DUPLICATE KEY UPDATE config_value = VALUES(config_value), updated_at = NOW()
    `, [processId, String(overtime_rounding_unit)]);
  }

  return res.json({ success: true, message: 'Overtime configuration updated for process' });
}));

// ══════════════════════════════════════════════════════════════════════════════
// M5 — BULK PAYSLIP OUTPUTS
// ══════════════════════════════════════════════════════════════════════════════

type BulkJobStatus = "pending" | "running" | "done" | "error";
interface BulkJob {
  runId: string;
  status: BulkJobStatus;
  total: number;
  done: number;
  failed: number;
  startedAt: string;
  finishedAt?: string;
  error?: string;
}
// In-memory job tracker (per-process; resets on server restart — acceptable for bulk ops)
const bulkJobs = new Map<string, BulkJob>();

function createBulkJob(runId: string, total: number): BulkJob {
  return {
    runId,
    status: "running",
    total,
    done: 0,
    failed: 0,
    startedAt: new Date().toISOString(),
  };
}

// POST /api/payroll/runs/:id/bulk-generate-payslips
// Enqueue a bulk payslip generation job
payrollMoreRouter.post("/runs/:id/bulk-generate-payslips",
  requireRole("admin", "super_admin", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: runId } = req.params;

    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, run_month, status FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
    );
    if (!(runRows as any[]).length) return res.status(404).json({ success: false, message: "Run not found" });

    const run = (runRows as any[])[0];

    const [countRow] = await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS cnt FROM salary_prep_line WHERE run_id = ?", [runId]
    );
    const total = Number((countRow as any[])[0]?.cnt ?? 0);
    if (total === 0) return res.status(400).json({ success: false, message: "No payroll lines in this run" });

    const job = createBulkJob(runId, total);
    bulkJobs.set(runId, job);

    // Fire-and-forget — mark each line as payslip_generated
    setImmediate(async () => {
      try {
        const [lines] = await db.execute<RowDataPacket[]>(
          "SELECT id, employee_id FROM salary_prep_line WHERE run_id = ?", [runId]
        );
        for (const line of lines as any[]) {
          try {
            await db.execute(
              "UPDATE salary_prep_line SET payslip_generated = 1, payslip_generated_at = NOW() WHERE id = ?",
              [line.id]
            );
            job.done++;
          } catch {
            job.failed++;
          }
        }
        job.status = "done";
        job.finishedAt = new Date().toISOString();
      } catch (e: any) {
        job.status = "error";
        job.error = e?.message ?? "Unknown error";
        job.finishedAt = new Date().toISOString();
      }
    });

    return res.json({ success: true, data: { runId, total, message: "Bulk generation started" } });
  })
);

// GET /api/payroll/runs/:id/bulk-generate-status
payrollMoreRouter.get("/runs/:id/bulk-generate-status",
  requireRole("admin", "super_admin", "payroll_head", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: runId } = req.params;
    const job = bulkJobs.get(runId);
    if (!job) {
      // Check DB — if all lines have payslip_generated=1 treat as done
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT
           COUNT(*) AS total,
           SUM(CASE WHEN payslip_generated = 1 THEN 1 ELSE 0 END) AS done
         FROM salary_prep_line WHERE run_id = ?`, [runId]
      );
      const r = (rows as any[])[0];
      return res.json({ success: true, data: { runId, status: "unknown", total: Number(r?.total ?? 0), done: Number(r?.done ?? 0), failed: 0 } });
    }
    return res.json({ success: true, data: job });
  })
);

// POST /api/payroll/runs/:id/email-payslips
// Mark payslips as emailed (actual email delivery is handled by notification service)
payrollMoreRouter.post("/runs/:id/email-payslips",
  requireRole("admin", "super_admin", "payroll_head"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: runId } = req.params;

    const [runRows] = await db.execute<RowDataPacket[]>(
      "SELECT id, run_month FROM salary_prep_run WHERE id = ? LIMIT 1", [runId]
    );
    if (!(runRows as any[]).length) return res.status(404).json({ success: false, message: "Run not found" });

    const [result] = await db.execute(
      `UPDATE salary_prep_line
          SET payslip_emailed = 1, payslip_emailed_at = NOW()
        WHERE run_id = ? AND payslip_generated = 1`,
      [runId]
    );
    const affected = (result as any).affectedRows ?? 0;

    return res.json({ success: true, data: { runId, emailed: affected } });
  })
);

// GET /api/payroll/runs/:id/bulk-payslip-summary
// Aggregated status: generated count, emailed count, pending count
payrollMoreRouter.get("/runs/:id/bulk-payslip-summary",
  requireRole("admin", "super_admin", "payroll_head", "finance"),
  h(async (req: AuthenticatedRequest, res: Response) => {
    const { id: runId } = req.params;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         COUNT(*) AS total,
         SUM(CASE WHEN COALESCE(payslip_generated,0) = 1 THEN 1 ELSE 0 END) AS generated,
         SUM(CASE WHEN COALESCE(payslip_emailed,0)   = 1 THEN 1 ELSE 0 END) AS emailed,
         MIN(payslip_generated_at) AS first_generated_at,
         MAX(payslip_generated_at) AS last_generated_at
       FROM salary_prep_line
       WHERE run_id = ?`, [runId]
    );
    const r = (rows as any[])[0];
    return res.json({
      success: true,
      data: {
        runId,
        total:     Number(r?.total ?? 0),
        generated: Number(r?.generated ?? 0),
        emailed:   Number(r?.emailed ?? 0),
        pending:   Number(r?.total ?? 0) - Number(r?.generated ?? 0),
        first_generated_at: r?.first_generated_at ?? null,
        last_generated_at:  r?.last_generated_at  ?? null,
      },
    });
  })
);
