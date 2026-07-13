/**
 * Salary / Employment / CTC Certificate Generator routes.
 * Mounted at /api/payroll/certificates
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket, ResultSetHeader } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";

export const payrollCertificatesRouter = Router();

// ---------------------------------------------------------------------------
// Handler wrapper — keeps route bodies free of try/catch boilerplate
// ---------------------------------------------------------------------------
const h =
  (fn: (req: AuthenticatedRequest, res: Response) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    void fn(req, res).catch(next);
  };

// ---------------------------------------------------------------------------
// Ensure table exists on module load
// ---------------------------------------------------------------------------
async function ensureTable(): Promise<void> {
  await db.execute(`
    CREATE TABLE IF NOT EXISTS salary_certificate_request (
      id           CHAR(36)                             NOT NULL,
      employee_id  VARCHAR(36)                          NOT NULL,
      template     ENUM('salary','employment','ctc')    NOT NULL DEFAULT 'salary',
      period_from  VARCHAR(7)                           NULL,
      period_to    VARCHAR(7)                           NULL,
      addressee    VARCHAR(255)                         NULL,
      purpose      VARCHAR(255)                         NULL,
      generated_by VARCHAR(36)                          NOT NULL,
      generated_at DATETIME                             NOT NULL DEFAULT CURRENT_TIMESTAMP,
      certificate_data_json MEDIUMTEXT                  NULL,
      PRIMARY KEY (id),
      KEY idx_scr_emp (employee_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
  `);
}

// Fire-and-forget at startup
void ensureTable().catch((err) =>
  console.error("[payroll-certificates] Table ensure failed:", err)
);

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
const PAYROLL_ROLES = ["admin", "hr", "payroll_head", "finance", "super_admin"] as const;

async function getEmployeeRecord(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT
       e.id,
       e.employee_code,
       COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
       e.designation,
       e.department_name,
       e.branch_name,
       e.date_of_joining,
       e.employment_status,
       e.user_id
     FROM employees e
     WHERE e.id = ?
     LIMIT 1`,
    [employeeId]
  );
  type EmpRow = RowDataPacket & {
    id: string; employee_code: string; employee_name: string;
    designation: string | null; department_name: string | null; branch_name: string | null;
    date_of_joining: string | null; employment_status: string | null; user_id: string | null;
  };
  return (rows as EmpRow[])[0] ?? null;
}

async function getLatestSalaryAssignment(employeeId: string) {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT basic_salary, gross_salary, net_salary, effective_from
       FROM employee_salary_assignment
      WHERE employee_id = ?
      ORDER BY effective_from DESC
      LIMIT 1`,
    [employeeId]
  );
  type SalRow = RowDataPacket & {
    basic_salary: string | number; gross_salary: string | number; net_salary: string | number;
    effective_from: string;
  };
  return (rows as SalRow[])[0] ?? null;
}

function formatINR(val: string | number | null | undefined): string {
  const n = Number(val ?? 0);
  return new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(n);
}

function todayStr(): string {
  return new Date().toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" });
}

function buildCertificateData(
  template: "salary" | "employment" | "ctc",
  emp: { employee_name: string; designation: string | null; branch_name: string | null; department_name: string | null; date_of_joining: string | null; employment_status: string | null },
  sal: { basic_salary: string | number; gross_salary: string | number; net_salary: string | number } | null,
  addressee: string | null,
  purpose: string | null,
  periodFrom: string | null,
  periodTo: string | null,
) {
  const doJ = emp.date_of_joining
    ? new Date(emp.date_of_joining).toLocaleDateString("en-IN", { day: "2-digit", month: "long", year: "numeric" })
    : "N/A";

  let body = "";
  let annualCtc: number | null = null;

  if (template === "salary") {
    const gross = Number(sal?.gross_salary ?? 0);
    const net = Number(sal?.net_salary ?? 0);
    body = `This is to certify that ${emp.employee_name}, ${emp.designation ?? "Employee"} is employed with MAS Callnet Private Limited since ${doJ}. ` +
      `Their monthly gross salary is ${formatINR(gross)} and net take-home salary is ${formatINR(net)}.` +
      (purpose ? ` This certificate is issued for the purpose of ${purpose}.` : "");
  } else if (template === "employment") {
    body = `This is to certify that ${emp.employee_name} is employed as ${emp.designation ?? "Employee"} at our ${emp.branch_name ?? "office"} branch since ${doJ} ` +
      `and their employment status is currently ${emp.employment_status ?? "Active"}.` +
      (purpose ? ` This certificate is issued for the purpose of ${purpose}.` : "");
  } else {
    // ctc
    const gross = Number(sal?.gross_salary ?? 0);
    const basic = Number(sal?.basic_salary ?? 0);
    const pfEmployerAnnual = basic * 0.12 * 12;
    annualCtc = gross * 12 + pfEmployerAnnual;
    const ctcLakhs = (annualCtc / 100000).toFixed(2);
    body = `This is to certify that ${emp.employee_name}, ${emp.designation ?? "Employee"} is employed with MAS Callnet Private Limited since ${doJ}. ` +
      `Their annual Cost to Company (CTC) is ${formatINR(annualCtc)} (INR ${ctcLakhs} lakhs), inclusive of employer PF contribution.` +
      (purpose ? ` This certificate is issued for the purpose of ${purpose}.` : "");
  }

  return {
    template,
    employee_name: emp.employee_name,
    designation: emp.designation,
    branch_name: emp.branch_name,
    department_name: emp.department_name,
    date_of_joining: doJ,
    employment_status: emp.employment_status,
    gross_salary: sal ? Number(sal.gross_salary) : null,
    net_salary: sal ? Number(sal.net_salary) : null,
    basic_salary: sal ? Number(sal.basic_salary) : null,
    annual_ctc: annualCtc,
    period_from: periodFrom,
    period_to: periodTo,
    addressee: addressee ?? "To Whom It May Concern",
    purpose: purpose ?? "",
    body_text: body,
    issue_date: todayStr(),
    company_name: "MAS Callnet Private Limited",
  };
}

// ---------------------------------------------------------------------------
// GET / — list recent certificate requests (paginated, limit 50)
// ---------------------------------------------------------------------------
payrollCertificatesRouter.get(
  "/",
  requireAuth,
  requireRole(...PAYROLL_ROLES),
  h(async (req, res) => {
    const page = Math.max(1, parseInt(String(req.query.page ?? "1"), 10) || 1);
    const limit = 50;
    const offset = (page - 1) * limit;

    const [countRows] = await db.execute<RowDataPacket[]>(
      `SELECT COUNT(*) AS total FROM salary_certificate_request`
    );
    const total = Number((countRows as RowDataPacket[])[0]?.total ?? 0);

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT scr.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.employee_code
         FROM salary_certificate_request scr
         LEFT JOIN employees e ON e.id = scr.employee_id
         ORDER BY scr.generated_at DESC
         LIMIT ? OFFSET ?`,
      [limit, offset]
    );

    return res.json({ success: true, data: rows, total });
  })
);

// ---------------------------------------------------------------------------
// GET /employee/:employeeId — all requests for one employee
// ---------------------------------------------------------------------------
payrollCertificatesRouter.get(
  "/employee/:employeeId",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { employeeId } = req.params;

    // payroll roles may view any employee; otherwise verify own record
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    const userRoleKeys = (roleRows as { role_key: string }[]).map((r) => r.role_key);
    const isPayrollRole = PAYROLL_ROLES.some((pr) => userRoleKeys.includes(pr));

    if (!isPayrollRole) {
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? AND user_id = ? AND active_status = 1 LIMIT 1",
        [employeeId, userId]
      );
      if (!(empRows as RowDataPacket[])[0]) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT scr.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.employee_code
         FROM salary_certificate_request scr
         LEFT JOIN employees e ON e.id = scr.employee_id
        WHERE scr.employee_id = ?
        ORDER BY scr.generated_at DESC`,
      [employeeId]
    );

    return res.json({ success: true, data: rows });
  })
);

// ---------------------------------------------------------------------------
// GET /:id — fetch one request by id with full certificate_data
// ---------------------------------------------------------------------------
payrollCertificatesRouter.get(
  "/:id",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT scr.*,
              COALESCE(NULLIF(TRIM(e.full_name),''), CONCAT(e.first_name,' ',COALESCE(e.last_name,''))) AS employee_name,
              e.employee_code,
              e.user_id AS emp_user_id
         FROM salary_certificate_request scr
         LEFT JOIN employees e ON e.id = scr.employee_id
        WHERE scr.id = ?
        LIMIT 1`,
      [id]
    );
    type CertRow = RowDataPacket & { certificate_data_json: string | null; emp_user_id: string | null; generated_by: string };
    const row = (rows as CertRow[])[0];
    if (!row) return res.status(404).json({ success: false, message: "Certificate request not found" });

    // Access: must be the employee or a payroll role
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    const userRoleKeys = (roleRows as { role_key: string }[]).map((r) => r.role_key);
    const isPayrollRole = PAYROLL_ROLES.some((pr) => userRoleKeys.includes(pr));
    if (!isPayrollRole && String(row.emp_user_id) !== userId) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const certificate_data = row.certificate_data_json
      ? JSON.parse(row.certificate_data_json)
      : null;

    return res.json({ success: true, data: { ...row, certificate_data } });
  })
);

// ---------------------------------------------------------------------------
// POST /generate — generate and store a certificate
// ---------------------------------------------------------------------------
payrollCertificatesRouter.post(
  "/generate",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const body = req.body as {
      employee_id?: string;
      template?: string;
      period_from?: string;
      period_to?: string;
      addressee?: string;
      purpose?: string;
    };

    if (!body.employee_id) {
      return res.status(400).json({ success: false, message: "employee_id is required" });
    }
    const template = (["salary", "employment", "ctc"].includes(String(body.template ?? ""))
      ? body.template
      : "salary") as "salary" | "employment" | "ctc";

    // Role check: payroll roles may generate for anyone; employees only for themselves
    const [roleRows] = await db.execute<RowDataPacket[]>(
      `SELECT role_key FROM user_roles WHERE user_id = ? AND active_status = 1`,
      [userId]
    );
    const userRoleKeys = (roleRows as { role_key: string }[]).map((r) => r.role_key);
    const isPayrollRole = PAYROLL_ROLES.some((pr) => userRoleKeys.includes(pr));

    if (!isPayrollRole) {
      // Employee can only generate for their own employee record
      const [empCheck] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? AND user_id = ? AND active_status = 1 LIMIT 1",
        [body.employee_id, userId]
      );
      if (!(empCheck as RowDataPacket[])[0]) {
        return res.status(403).json({ success: false, message: "You can only generate a certificate for yourself" });
      }
    }

    const emp = await getEmployeeRecord(body.employee_id);
    if (!emp) {
      return res.status(404).json({ success: false, message: "Employee not found" });
    }

    const sal = template !== "employment" ? await getLatestSalaryAssignment(body.employee_id) : null;

    const certData = buildCertificateData(
      template,
      emp,
      sal,
      body.addressee ?? null,
      body.purpose ?? null,
      body.period_from ?? null,
      body.period_to ?? null,
    );

    const id = randomUUID();
    await db.execute<ResultSetHeader>(
      `INSERT INTO salary_certificate_request
         (id, employee_id, template, period_from, period_to, addressee, purpose, generated_by, certificate_data_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        body.employee_id,
        template,
        body.period_from ?? null,
        body.period_to ?? null,
        body.addressee ?? null,
        body.purpose ?? null,
        userId,
        JSON.stringify(certData),
      ]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "salary_certificate_generated",
      module_key: "payroll_certificates",
      entity_type: "salary_certificate_request",
      entity_id: id,
      new_value_json: {
        employee_id: body.employee_id,
        template,
        employee_name: emp.employee_name,
      },
      req,
    });

    return res.status(201).json({
      success: true,
      data: {
        id,
        employee_name: emp.employee_name,
        template,
        certificate_data: certData,
      },
    });
  })
);

// ---------------------------------------------------------------------------
// DELETE /:id — hard delete (super_admin only)
// ---------------------------------------------------------------------------
payrollCertificatesRouter.delete(
  "/:id",
  requireAuth,
  requireRole("super_admin"),
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { id } = req.params;

    const [rows] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM salary_certificate_request WHERE id = ? LIMIT 1",
      [id]
    );
    if (!(rows as RowDataPacket[])[0]) {
      return res.status(404).json({ success: false, message: "Certificate request not found" });
    }

    await db.execute<ResultSetHeader>(
      "DELETE FROM salary_certificate_request WHERE id = ?",
      [id]
    );

    void logSensitiveAction({
      actor_user_id: userId,
      actor_role: req.authUser!.role,
      action_type: "salary_certificate_deleted",
      module_key: "payroll_certificates",
      entity_type: "salary_certificate_request",
      entity_id: id,
      req,
    });

    return res.json({ success: true, message: "Certificate request deleted" });
  })
);
