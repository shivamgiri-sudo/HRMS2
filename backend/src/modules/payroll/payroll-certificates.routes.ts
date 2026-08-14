/**
 * Salary / Employment / CTC Certificate Generator routes.
 * Mounted at /api/payroll/certificates
 */

import { Router } from "express";
import { sqlLimitOffset } from "../../db/pagination.js";
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
       -- employees holds designation_id / department_id / branch_id; the names
       -- live on their masters. Selecting the names directly raised
       -- ER_BAD_FIELD_ERROR, so every salary and employment certificate failed
       -- to generate. Aliases keep the downstream shape unchanged.
       dm.designation_name AS designation,
       dept.dept_name      AS department_name,
       bm.branch_name      AS branch_name,
       e.date_of_joining,
       e.employment_status,
       e.user_id
     FROM employees e
     LEFT JOIN designation_master dm  ON dm.id   = e.designation_id
     LEFT JOIN department_master  dept ON dept.id = e.department_id
     LEFT JOIN branch_master      bm   ON bm.id   = e.branch_id
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

/**
 * Salary figures for a certificate.
 *
 * ⚠️ FIXED 2026-08-14. This previously read
 *   SELECT basic_salary, gross_salary, net_salary FROM employee_salary_assignment
 * and NONE of those three columns exists on that table — it carries ctc_annual, structure_id,
 * effective_from and active_status, and nothing else monetary. Every call therefore threw
 * ER_BAD_FIELD_ERROR straight into the route's .catch(next), so /api/payroll/salary-certificates
 * /generate has returned 500 for every salary and CTC certificate since it shipped. Confirmed by
 * the data: salary_certificate_request holds 0 rows — not one certificate has ever been issued.
 * The page is live, in the nav, and reachable by the 'employee' role.
 *
 * WHERE EACH FIGURE NOW COMES FROM, AND WHY
 *   Annual CTC   — employee_salary_assignment.ctc_annual, used directly. Verified live against
 *                  302 full-month employees in the 2026-07 run: mean ctc_annual 273,023 against a
 *                  mean monthly gross of 20,239, i.e. 13.5x — genuinely ANNUAL, and slightly over
 *                  12x because it includes employer PF. (The "CTC is monthly" trap recorded for
 *                  this estate is about db_bill's ctc_offered, a different column on a different
 *                  system. Checked rather than assumed, because a 12x error on a document a bank
 *                  reads is not a rounding problem.)
 *   Monthly gross and net take-home — the employee's most recent CALCULATED payroll line. That is
 *                  the only place a real net exists: net is gross less PF, ESI, PT and TDS, and
 *                  none of that is derivable from an assignment row. Deriving it here would mean
 *                  inventing a number and printing it on a certificate.
 *   Basic        — the payroll line's own basic for the same reason.
 *
 * The month the figures come from is returned alongside them so the certificate can say which
 * period it describes instead of implying a contractual constant.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO
 *   It does not fall back to zero. A certificate reading "monthly gross ₹0" is worse than no
 *   certificate — the caller refuses to issue instead (see the generate route). Whether a salary
 *   certificate ought to state contracted salary or actual last-paid salary is an HR/Payroll
 *   decision, not one to settle inside a bug fix; actual-and-traceable is the conservative
 *   reading and is what a bank is normally asking for.
 */
async function getCertificateSalaryFigures(employeeId: string) {
  const [ctcRows] = await db.execute<RowDataPacket[]>(
    `SELECT esa.ctc_annual, esa.effective_from,
            ssm.basic_pct, ssm.hra_pct
       FROM employee_salary_assignment esa
       LEFT JOIN salary_structure_master ssm ON ssm.id = esa.structure_id
      WHERE esa.employee_id = ?
        AND esa.active_status = 1
      ORDER BY esa.effective_from DESC
      LIMIT 1`,
    [employeeId]
  );
  const ctc = (ctcRows as Array<RowDataPacket & {
    ctc_annual: string | number | null; effective_from: string | null;
    basic_pct: number | null; hra_pct: number | null;
  }>)[0] ?? null;

  // Most recent line that the engine actually calculated. Draft and cancelled runs are excluded
  // because nothing was paid from them, as are excluded/blocked lines.
  const [payRows] = await db.execute<RowDataPacket[]>(
    `SELECT spl.gross_salary, spl.net_salary, spl.basic, spr.run_month
       FROM salary_prep_line spl
       JOIN salary_prep_run spr ON spr.id = spl.run_id
      WHERE spl.employee_id = ?
        AND spl.gross_salary > 0
        AND LOWER(COALESCE(spl.status, '')) NOT IN ('excluded', 'blocked')
        AND LOWER(COALESCE(spr.status, '')) NOT IN ('draft', 'cancelled')
      ORDER BY spr.run_month DESC
      LIMIT 1`,
    [employeeId]
  );
  const paid = (payRows as Array<RowDataPacket & {
    gross_salary: string | number; net_salary: string | number;
    basic: string | number | null; run_month: string;
  }>)[0] ?? null;

  if (!ctc && !paid) return null;
  return {
    annual_ctc: ctc?.ctc_annual != null ? Number(ctc.ctc_annual) : null,
    effective_from: ctc?.effective_from ?? null,
    basic_pct: ctc?.basic_pct ?? null,
    gross_salary: paid ? Number(paid.gross_salary) : null,
    net_salary: paid ? Number(paid.net_salary) : null,
    basic_salary: paid?.basic != null ? Number(paid.basic) : null,
    figures_from_month: paid?.run_month ?? null,
  };
}

export type CertificateSalaryFigures = NonNullable<Awaited<ReturnType<typeof getCertificateSalaryFigures>>>;

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
  sal: CertificateSalaryFigures | null,
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
    // Non-null by contract: the generate route refuses a salary certificate without these
    // rather than letting a zero reach the document.
    const gross = Number(sal?.gross_salary ?? 0);
    const net = Number(sal?.net_salary ?? 0);
    // Naming the month is the difference between a true statement and a misleading one: these
    // are the figures for a specific payroll, not a standing contractual amount.
    const period = sal?.figures_from_month ? ` for the payroll month of ${sal.figures_from_month}` : "";
    body = `This is to certify that ${emp.employee_name}, ${emp.designation ?? "Employee"} is employed with MAS Callnet Private Limited since ${doJ}. ` +
      `Their gross salary${period} is ${formatINR(gross)} and net take-home salary is ${formatINR(net)}.` +
      (purpose ? ` This certificate is issued for the purpose of ${purpose}.` : "");
  } else if (template === "employment") {
    body = `This is to certify that ${emp.employee_name} is employed as ${emp.designation ?? "Employee"} at our ${emp.branch_name ?? "office"} branch since ${doJ} ` +
      `and their employment status is currently ${emp.employment_status ?? "Active"}.` +
      (purpose ? ` This certificate is issued for the purpose of ${purpose}.` : "");
  } else {
    // ctc — use the contracted annual CTC directly rather than reconstructing it.
    //
    // This used to compute gross*12 + basic*0.12*12, rebuilding CTC out of one month's payroll.
    // That is both unnecessary (employee_salary_assignment.ctc_annual is the contracted figure)
    // and wrong in the common case, because a month with any LWP or a mid-month join makes gross
    // smaller than the contractual monthly rate — understating the CTC on the certificate by
    // whatever that month happened to be. Verified live: ctc_annual averages 13.5x monthly gross
    // across full-month employees, so it already includes employer PF and needs no addition.
    annualCtc = sal?.annual_ctc ?? null;
    const ctcLakhs = ((annualCtc ?? 0) / 100000).toFixed(2);
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
         ${sqlLimitOffset(limit, offset)}`,
      []
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

    const sal = template !== "employment" ? await getCertificateSalaryFigures(body.employee_id) : null;

    // Refuse rather than issue a certificate with a fabricated or zero figure on it. A document
    // stating someone's income to a bank or landlord is the last place a silent default belongs,
    // and the previous code would happily have printed ₹0 had the query not been throwing.
    if (template === "salary" && (sal?.gross_salary == null || sal?.net_salary == null)) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot issue a salary certificate for this employee: no calculated payroll line exists for them, so " +
          "their gross and net take-home cannot be stated from an authoritative source. Run payroll for this " +
          "employee first, or issue an employment certificate instead.",
      });
    }
    if (template === "ctc" && sal?.annual_ctc == null) {
      return res.status(409).json({
        success: false,
        message:
          "Cannot issue a CTC certificate for this employee: no active salary assignment with an annual CTC exists, " +
          "so the figure cannot be stated from an authoritative source.",
      });
    }

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
