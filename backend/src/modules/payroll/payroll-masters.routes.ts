import { Router } from "express";
import type { Request, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/requireAuth.js";
import { requireRole } from "../../middleware/requireRole.js";
import type { AuthenticatedRequest } from "../../middleware/requireAuth.js";
import { randomUUID } from "crypto";

const router = Router();
const h = (fn: (req: Request, res: Response) => Promise<any>) => (req: Request, res: Response, next: any) => fn(req, res).catch(next);

// ── GET /bands — All active salary bands ─────────────────────────────────────
router.get("/bands", requireAuth, h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, band_code, band_name, slab_from, slab_to, active_status
       FROM salary_band_master WHERE active_status = 1 ORDER BY slab_from ASC`
  );
  return res.json({ success: true, data: rows });
}));

// ── GET /cost-centres?branch=X — Active cost centres filtered by branch ──────
router.get("/cost-centres", requireAuth, h(async (req, res) => {
  const branch = String(req.query.branch ?? "").trim();
  let rows: RowDataPacket[];
  if (branch) {
    [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, cost_centre_code, display_name, branch_name, category, client_name, process_name
         FROM salary_cost_centre
        WHERE branch_name = ? AND active_status = 1
        ORDER BY cost_centre_code`,
      [branch]
    );
  } else {
    [rows] = await db.execute<RowDataPacket[]>(
      `SELECT id, cost_centre_code, display_name, branch_name, category, client_name, process_name
         FROM salary_cost_centre WHERE active_status = 1 ORDER BY branch_name, cost_centre_code`
    );
  }
  return res.json({ success: true, data: rows });
}));

// ── GET /packages?branch=X&costCentre=Y&band=Z — Filtered salary packages ───
router.get("/packages", requireAuth, h(async (req, res) => {
  const branch = String(req.query.branch ?? "").trim();
  const cc = String(req.query.costCentre ?? req.query.cost_centre ?? "").trim();
  const band = String(req.query.band ?? "").trim();

  const conditions: string[] = ["active_status = 1"];
  const params: string[] = [];

  if (branch) { conditions.push("branch_name = ?"); params.push(branch); }
  if (cc) { conditions.push("(cost_centre_code = ? OR cost_centre_code IS NULL)"); params.push(cc); }
  if (band) { conditions.push("band_code = ?"); params.push(band); }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, branch_name, cost_centre_code, band_code, package_amount,
            basic, hra, conveyance, portfolio, medical, special_allowance, other_allowance,
            bonus, pli, gross, epf_employee, esic_employee, professional_tax,
            net_in_hand, epf_employer, esic_employer, admin_charges, ctc
       FROM salary_package_master
      WHERE ${conditions.join(" AND ")}
      ORDER BY package_amount ASC`,
    params
  );
  return res.json({ success: true, data: rows });
}));

// ── GET /salary-bands — Legacy alias (used by earlier frontend code) ─────────
router.get("/salary-bands", requireAuth, h(async (_req, res) => {
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT id, band_code, band_name, slab_from AS min_ctc, slab_to AS max_ctc,
            40 AS basic_pct, 40 AS hra_pct, active_status
       FROM salary_band_master WHERE active_status = 1 ORDER BY slab_from ASC`
  );
  return res.json({ success: true, data: rows });
}));

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN ROUTES — Super Admin / Payroll Head only
// ══════════════════════════════════════════════════════════════════════════════

// ── POST /bands — Create new band ────────────────────────────────────────────
router.post("/bands", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  const { band_code, band_name, slab_from, slab_to } = req.body;
  if (!band_code || slab_from == null || slab_to == null) return res.status(400).json({ success: false, message: "band_code, slab_from, slab_to required" });

  const id = randomUUID();
  await db.execute(
    `INSERT INTO salary_band_master (id, band_code, band_name, slab_from, slab_to) VALUES (?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE band_name = VALUES(band_name), slab_from = VALUES(slab_from), slab_to = VALUES(slab_to), active_status = 1`,
    [id, band_code, band_name || `Band ${band_code}`, slab_from, slab_to]
  );
  await db.execute(
    `INSERT INTO salary_package_audit_log (id, table_name, record_id, action, changed_by, change_summary) VALUES (?, 'salary_band_master', ?, 'create', ?, ?)`,
    [randomUUID(), id, req.authUser?.id ?? null, JSON.stringify({ band_code, slab_from, slab_to })]
  );
  return res.json({ success: true, id });
}));

// ── PUT /bands/:id — Update band ────────────────────────────────────────────
router.put("/bands/:id", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  const { band_name, slab_from, slab_to, active_status } = req.body;
  await db.execute(
    `UPDATE salary_band_master SET band_name = COALESCE(?, band_name), slab_from = COALESCE(?, slab_from),
     slab_to = COALESCE(?, slab_to), active_status = COALESCE(?, active_status) WHERE id = ?`,
    [band_name, slab_from, slab_to, active_status, req.params.id]
  );
  await db.execute(
    `INSERT INTO salary_package_audit_log (id, table_name, record_id, action, changed_by, change_summary) VALUES (?, 'salary_band_master', ?, 'update', ?, ?)`,
    [randomUUID(), req.params.id, req.authUser?.id ?? null, JSON.stringify(req.body)]
  );
  return res.json({ success: true });
}));

// ── POST /packages — Create new package ──────────────────────────────────────
router.post("/packages", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  const { branch_name, cost_centre_code, band_code, package_amount, basic, hra, conveyance,
    portfolio, medical, special_allowance, other_allowance, bonus, pli, gross,
    epf_employee, esic_employee, professional_tax, net_in_hand, epf_employer,
    esic_employer, admin_charges, ctc } = req.body;

  if (!branch_name || !band_code || !package_amount) {
    return res.status(400).json({ success: false, message: "branch_name, band_code, package_amount required" });
  }

  const id = randomUUID();
  await db.execute(
    `INSERT INTO salary_package_master
       (id, branch_name, cost_centre_code, band_code, package_amount, basic, hra, conveyance,
        portfolio, medical, special_allowance, other_allowance, bonus, pli, gross,
        epf_employee, esic_employee, professional_tax, net_in_hand, epf_employer,
        esic_employer, admin_charges, ctc, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, branch_name, cost_centre_code || null, band_code, package_amount,
     basic || 0, hra || 0, conveyance || 0, portfolio || 0, medical || 0,
     special_allowance || 0, other_allowance || 0, bonus || 0, pli || 0, gross || 0,
     epf_employee || 0, esic_employee || 0, professional_tax || 0, net_in_hand || 0,
     epf_employer || 0, esic_employer || 0, admin_charges || 0, ctc || 0,
     req.authUser?.id ?? null]
  );
  await db.execute(
    `INSERT INTO salary_package_audit_log (id, table_name, record_id, action, changed_by, change_summary) VALUES (?, 'salary_package_master', ?, 'create', ?, ?)`,
    [randomUUID(), id, req.authUser?.id ?? null, JSON.stringify({ branch_name, band_code, package_amount })]
  );
  return res.json({ success: true, id });
}));

// ── PUT /packages/:id — Update package ───────────────────────────────────────
router.put("/packages/:id", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  const fields = ['branch_name', 'cost_centre_code', 'band_code', 'package_amount', 'basic', 'hra',
    'conveyance', 'portfolio', 'medical', 'special_allowance', 'other_allowance', 'bonus', 'pli',
    'gross', 'epf_employee', 'esic_employee', 'professional_tax', 'net_in_hand', 'epf_employer',
    'esic_employer', 'admin_charges', 'ctc', 'active_status'];
  const sets: string[] = [];
  const vals: any[] = [];
  for (const f of fields) {
    if (req.body[f] !== undefined) { sets.push(`${f} = ?`); vals.push(req.body[f]); }
  }
  if (!sets.length) return res.status(400).json({ success: false, message: "No fields to update" });
  vals.push(req.params.id);
  await db.execute(`UPDATE salary_package_master SET ${sets.join(", ")} WHERE id = ?`, vals);
  await db.execute(
    `INSERT INTO salary_package_audit_log (id, table_name, record_id, action, changed_by, change_summary) VALUES (?, 'salary_package_master', ?, 'update', ?, ?)`,
    [randomUUID(), req.params.id, req.authUser?.id ?? null, JSON.stringify(req.body)]
  );
  return res.json({ success: true });
}));

// ── DELETE /packages/:id — Soft-delete package ───────────────────────────────
router.delete("/packages/:id", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  await db.execute(`UPDATE salary_package_master SET active_status = 0 WHERE id = ?`, [req.params.id]);
  await db.execute(
    `INSERT INTO salary_package_audit_log (id, table_name, record_id, action, changed_by, change_summary) VALUES (?, 'salary_package_master', ?, 'delete', ?, ?)`,
    [randomUUID(), req.params.id, req.authUser?.id ?? null, JSON.stringify({ soft_deleted: true })]
  );
  return res.json({ success: true });
}));

// ── POST /cost-centres — Create new cost centre ──────────────────────────────
router.post("/cost-centres", requireAuth, requireRole("admin", "super_admin", "payroll"), h(async (req: AuthenticatedRequest, res) => {
  const { cost_centre_code, display_name, branch_name, category, client_name, process_name } = req.body;
  if (!cost_centre_code || !branch_name) return res.status(400).json({ success: false, message: "cost_centre_code and branch_name required" });

  const id = randomUUID();
  await db.execute(
    `INSERT INTO salary_cost_centre (id, cost_centre_code, display_name, branch_name, category, client_name, process_name)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON DUPLICATE KEY UPDATE display_name = COALESCE(VALUES(display_name), display_name), active_status = 1`,
    [id, cost_centre_code, display_name || null, branch_name, category || null, client_name || null, process_name || null]
  );
  return res.json({ success: true, id });
}));

// ── POST /sync-from-bill — Sync from db_bill (Super Admin only) ──────────────
router.post("/sync-from-bill", requireAuth, requireRole("admin", "super_admin"), h(async (req: AuthenticatedRequest, res) => {
  // This endpoint would connect to db_bill and pull latest data
  // For now, return instruction — actual sync done via migration
  return res.json({
    success: true,
    message: "Use migration 326_salary_package_master_sync.sql to seed initial data. Live sync connector coming in Phase 9.",
  });
}));

export default router;
