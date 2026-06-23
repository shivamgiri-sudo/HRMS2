import { Router } from "express";
import type { Request, Response } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { getEmployeeForUser, hasRole } from "../../shared/accessGuard.js";
import { lettersService } from "./letters.service.js";
import { renderLetterHtml } from "./letters-render.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

const router = Router();
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

router.use(requireAuth);

// ── Build logo URL from request origin ────────────────────────────────────────
function logoUrl(req: Request): string {
  const proto = req.headers["x-forwarded-proto"] ?? req.protocol ?? "http";
  const host = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost:5055";
  return `${proto}://${host}/mcn-logo.png`;
}

// ── List templates ─────────────────────────────────────────────────────────────
router.get("/templates", requireRole("admin", "hr", "super_admin"), h(async (_req, res) => {
  res.json({ data: await lettersService.listTemplates() });
}));

// ── Generate letter ────────────────────────────────────────────────────────────
// Fetches real employee + payroll data, merges with override_vars, then generates.
router.post("/generate", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res) => {
  const { employee_id, template_code, issued_date, override_vars } = req.body as {
    employee_id: string;
    template_code: string;
    issued_date?: string;
    override_vars?: Record<string, string>;
  };
  if (!employee_id || !template_code) {
    return res.status(400).json({ error: "employee_id and template_code required" });
  }

  const letter = await lettersService.generateLetter({
    employee_id, template_code, issued_date, override_vars,
    generated_by: req.authUser!.id,
  });

  await logSensitiveAction({
    actor_user_id: req.authUser!.id,
    action_type: "LETTER_GENERATED",
    module_key: "letters",
    entity_type: "generated_letter",
    entity_id: letter.id,
    employee_id,
    new_value_json: { template_code, issued_date: issued_date ?? null },
  });

  res.status(201).json({ data: letter });
}));

// ── List generated letters for an employee ────────────────────────────────────
router.get("/employee/:employeeId", requireRole("admin", "hr", "super_admin"), h(async (req, res) => {
  res.json({ data: await lettersService.listGenerated(req.params.employeeId) });
}));

// ── Render letter as HTML (for preview in iframe or headless PDF) ──────────────
// Returns full self-contained HTML with inline CSS and logo.
// Accessible to admin/hr viewing any letter, or the employee for their own.
router.get("/:letterId/html", h(async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const letter = await lettersService.getById(req.params.letterId);
  if (!letter) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr", "super_admin");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== letter.employee_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  // Fetch full generated_letter row including stored JSON data
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT gl.*, lt.letter_type, lt.template_name
     FROM generated_letter gl
     JOIN letter_template lt ON lt.id = gl.template_id
     WHERE gl.id = ? LIMIT 1`,
    [req.params.letterId]
  );
  const row = (rows as RowDataPacket[])[0] as any;
  if (!row) return res.status(404).json({ error: "Not found" });

  // Parse data from generated_text (stored as JSON payload)
  let data: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.generated_text as string);
    data = parsed?.data ?? {};
  } catch {
    // generated_text might be legacy plain text — serve as-is
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.send(`<html><body><pre>${row.generated_text}</pre></body></html>`);
  }

  const html = renderLetterHtml(row.letter_type as string, data, logoUrl(req));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
}));

// ── Download letter as HTML attachment ────────────────────────────────────────
router.get("/:letterId/download", h(async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const letter = await lettersService.getById(req.params.letterId);
  if (!letter) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr", "super_admin");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== letter.employee_id) {
      return res.status(403).json({ error: "Forbidden" });
    }
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT gl.*, lt.letter_type, lt.template_name
     FROM generated_letter gl
     JOIN letter_template lt ON lt.id = gl.template_id
     WHERE gl.id = ? LIMIT 1`,
    [req.params.letterId]
  );
  const row = (rows as RowDataPacket[])[0] as any;
  if (!row) return res.status(404).json({ error: "Not found" });

  let data: Record<string, string> = {};
  try {
    const parsed = JSON.parse(row.generated_text as string);
    data = parsed?.data ?? {};
  } catch {
    data = {};
  }

  const filename = `${(row.letter_type as string).replace(/_/g, "-")}_${data.employee_code ?? "letter"}_${(row.issued_date ?? "").toString().slice(0, 10)}.html`;
  const html = renderLetterHtml(row.letter_type as string, data, logoUrl(req));

  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.send(html);
}));

// ── Quick-generate and return HTML in one shot (for pre-issue preview) ─────────
// Does NOT save to DB. Used for preview-before-issue workflow.
router.post("/preview-html", requireRole("admin", "hr", "super_admin"), h(async (req: AuthenticatedRequest, res) => {
  const { employee_id, template_code, issued_date, override_vars } = req.body as {
    employee_id: string;
    template_code: string;
    issued_date?: string;
    override_vars?: Record<string, string>;
  };
  if (!employee_id || !template_code) {
    return res.status(400).json({ error: "employee_id and template_code required" });
  }

  // Fetch employee data
  const [empRows] = await db.execute<RowDataPacket[]>(
    `SELECT e.*, d.designation_name, dept.dept_name,
            bm.branch_name,
            pm.process_name,
            CONCAT(e.first_name,' ',COALESCE(e.last_name,'')) AS full_name
     FROM employees e
     LEFT JOIN designation_master d ON d.id = e.designation_id
     LEFT JOIN department_master dept ON dept.id = e.department_id
     LEFT JOIN branch_master bm ON bm.id = e.branch_id
     LEFT JOIN process_master pm ON pm.id = e.process_id
     WHERE e.id = ? LIMIT 1`,
    [employee_id]
  );
  const emp = (empRows as RowDataPacket[])[0] as any;
  if (!emp) return res.status(404).json({ error: "Employee not found" });

  // Fetch latest salary assignment for salary components
  const [salRows] = await db.execute<RowDataPacket[]>(
    `SELECT * FROM employee_salary_assignment WHERE employee_id = ? AND active_status = 1 ORDER BY effective_date DESC LIMIT 1`,
    [employee_id]
  );
  const sal = (salRows as RowDataPacket[])[0] as any ?? {};

  const data: Record<string, string> = {
    full_name:         emp.full_name ?? "",
    employee_code:     emp.employee_code ?? "",
    designation:       emp.designation_name ?? "",
    department:        emp.dept_name ?? "",
    location:          emp.branch_name ?? "",
    date_of_joining:   emp.date_of_joining?.toString().slice(0, 10) ?? "",
    date_of_exit:      emp.date_of_exit?.toString().slice(0, 10) ?? "",
    issued_date:       issued_date ?? new Date().toISOString().slice(0, 10),
    epf_no:            emp.epf_number ?? "",
    esi_no:            emp.esic_number ?? "",
    basic:             String(sal.basic_salary ?? "0.00"),
    hra:               String(sal.hra ?? "0.00"),
    conveyance:        String(sal.conveyance ?? "0.00"),
    other_allowance:   String(sal.other_allowance ?? "0.00"),
    special_allowance: String(sal.special_allowance ?? "0.00"),
    bonus:             String(sal.bonus ?? "0.00"),
    medical_allowance: String(sal.medical_allowance ?? "0.00"),
    portfolio:         String(sal.portfolio ?? "0.00"),
    pli:               String(sal.pli ?? "0.00"),
    gross_salary:      String(sal.gross_salary ?? "0.00"),
    esic:              String(sal.esic_employee ?? "0.00"),
    epf:               String(sal.epf_employee ?? "0.00"),
    net_salary:        String(sal.net_salary ?? "0.00"),
    employer_esic:     String(sal.esic_employer ?? "0.00"),
    employer_epf:      String(sal.epf_employer ?? "0.00"),
    admin_charges:     String(sal.admin_charges ?? "0.00"),
    ctc:               String(sal.ctc_monthly ? Number(sal.ctc_monthly) * 12 : (sal.ctc_annual ?? "0.00")),
    ...(override_vars ?? {}),
  };

  // Fetch template letter_type
  const [tplRows] = await db.execute<RowDataPacket[]>(
    "SELECT letter_type FROM letter_template WHERE template_code = ? AND active_status = 1 LIMIT 1",
    [template_code]
  );
  const tpl = (tplRows as RowDataPacket[])[0] as any;
  if (!tpl) return res.status(404).json({ error: `Template not found: ${template_code}` });

  const html = renderLetterHtml(tpl.letter_type as string, data, logoUrl(req));
  res.setHeader("Content-Type", "text/html; charset=utf-8");
  res.setHeader("Cache-Control", "no-store");
  res.send(html);
}));

// ── Acknowledge letter ─────────────────────────────────────────────────────────
router.post("/:letterId/acknowledge", h(async (req: AuthenticatedRequest, res) => {
  const userId = req.authUser!.id;
  const letter = await lettersService.getById(req.params.letterId);
  if (!letter) return res.status(404).json({ error: "Not found" });

  const isAdminHr = await hasRole(userId, "admin", "hr", "super_admin");
  if (!isAdminHr) {
    const emp = await getEmployeeForUser(userId);
    if (!emp || emp.id !== letter.employee_id) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }
  } else {
    await logSensitiveAction({
      actor_user_id: userId, action_type: "LETTER_ACK_ADMIN_OVERRIDE",
      module_key: "letters", entity_type: "generated_letter", entity_id: req.params.letterId,
      req,
    });
  }

  await lettersService.acknowledge(req.params.letterId);
  res.json({ ok: true });
}));

export { router as lettersRouter };
