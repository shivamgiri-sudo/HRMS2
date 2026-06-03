import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { logSensitiveAction } from "../../shared/auditLog.js";
import type { Request } from "express";

export const assetsService = {
  async list(filters: { status?: string; branch_id?: string; category?: string }) {
    const conds = ["a.active_status = 1"];
    const params: unknown[] = [];
    if (filters.status)    { conds.push("a.status = ?");          params.push(filters.status); }
    if (filters.branch_id) { conds.push("a.branch_id = ?");       params.push(filters.branch_id); }
    if (filters.category)  { conds.push("a.asset_category = ?");  params.push(filters.category); }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*, b.branch_name,
              IF(aa.employee_id IS NOT NULL,
                 JSON_OBJECT('employee_id', aa.employee_id,
                             'employee_name', CONCAT(COALESCE(e.first_name,''), ' ', COALESCE(e.last_name,'')),
                             'assigned_date', aa.assigned_date),
                 NULL) AS current_assignment
       FROM asset_master a
       LEFT JOIN branch_master b ON b.id = a.branch_id
       LEFT JOIN asset_assignment aa ON aa.asset_id = a.id AND aa.returned_date IS NULL
       LEFT JOIN employees e ON e.id = aa.employee_id
       WHERE ${conds.join(" AND ")} ORDER BY a.asset_code`,
      params
    );
    return rows as RowDataPacket[];
  },

  async getById(id: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT a.*, b.branch_name FROM asset_master a
       LEFT JOIN branch_master b ON b.id = a.branch_id WHERE a.id = ? LIMIT 1`,
      [id]
    );
    return (rows as RowDataPacket[])[0] ?? null;
  },

  async create(data: Record<string, unknown>) {
    const id = randomUUID();
    const code = (data.asset_code as string) || `AST-${Date.now()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
    await db.execute(
      `INSERT INTO asset_master (id, asset_code, asset_name, asset_category, asset_type, serial_number,
         purchase_date, purchase_cost, vendor, warranty_expiry, branch_id, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id, code, data.asset_name, data.asset_category, data.asset_type ?? null,
       data.serial_number ?? null, data.purchase_date ?? null, data.purchase_cost ?? null,
       data.vendor ?? null, data.warranty_expiry ?? null, data.branch_id ?? null, data.notes ?? null]
    );
    return this.getById(id);
  },

  async update(id: string, data: Record<string, unknown>) {
    await db.execute(
      `UPDATE asset_master SET asset_name = COALESCE(?, asset_name), status = COALESCE(?, status),
         notes = COALESCE(?, notes), branch_id = COALESCE(?, branch_id),
         serial_number = COALESCE(?, serial_number), asset_category = COALESCE(?, asset_category),
         purchase_cost = COALESCE(?, purchase_cost), vendor = COALESCE(?, vendor),
         warranty_expiry = COALESCE(?, warranty_expiry), updated_at = NOW() WHERE id = ?`,
      [data.asset_name ?? null, data.status ?? null, data.notes ?? null, data.branch_id ?? null,
       data.serial_number ?? null, data.asset_category ?? null, data.purchase_cost ?? null,
       data.vendor ?? null, data.warranty_expiry ?? null, id]
    );
    return this.getById(id);
  },

  async assign(assetId: string, employeeId: string, assignedBy: string, notes?: string, req?: Request) {
    // Mark any open assignment as returned
    await db.execute(
      "UPDATE asset_assignment SET returned_date = CURDATE() WHERE asset_id = ? AND returned_date IS NULL",
      [assetId]
    );
    const id = randomUUID();
    await db.execute(
      "INSERT INTO asset_assignment (id, asset_id, employee_id, assigned_date, assigned_by, notes) VALUES (?, ?, ?, CURDATE(), ?, ?)",
      [id, assetId, employeeId, assignedBy, notes ?? null]
    );
    await db.execute("UPDATE asset_master SET status = 'assigned', updated_at = NOW() WHERE id = ?", [assetId]);
    await logSensitiveAction({
      actor_user_id: assignedBy, action_type: "ASSET_ASSIGNED", module_key: "ASSETS",
      entity_type: "asset", entity_id: assetId,
      change_summary: { employee_id: employeeId },
      req,
    });
    return db.execute<RowDataPacket[]>("SELECT * FROM asset_assignment WHERE id = ? LIMIT 1", [id])
      .then(([rows]) => (rows as RowDataPacket[])[0]);
  },

  async returnAsset(assetId: string, condition: string, returnedBy: string, req?: Request) {
    await db.execute(
      "UPDATE asset_assignment SET returned_date = CURDATE(), return_condition = ? WHERE asset_id = ? AND returned_date IS NULL",
      [condition, assetId]
    );
    await db.execute("UPDATE asset_master SET status = 'available', updated_at = NOW() WHERE id = ?", [assetId]);
    await logSensitiveAction({
      actor_user_id: returnedBy, action_type: "ASSET_RETURNED", module_key: "ASSETS",
      entity_type: "asset", entity_id: assetId,
      change_summary: { condition },
      req,
    });
  },

  async addServiceLog(assetId: string, data: Record<string, unknown>) {
    const id = randomUUID();
    await db.execute(
      "INSERT INTO asset_service_log (id, asset_id, service_type, service_date, service_notes, cost, performed_by) VALUES (?, ?, ?, ?, ?, ?, ?)",
      [id, assetId, data.service_type, data.service_date, data.service_notes ?? null, data.cost ?? null, data.performed_by ?? null]
    );
    if (data.service_type === "repair" || data.service_type === "maintenance") {
      await db.execute("UPDATE asset_master SET status = ?, updated_at = NOW() WHERE id = ?", [data.service_type, assetId]);
    }
    return id;
  },

  async listByEmployee(employeeId: string) {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT aa.*, a.asset_name, a.asset_category, a.asset_code, a.serial_number
       FROM asset_assignment aa JOIN asset_master a ON a.id = aa.asset_id
       WHERE aa.employee_id = ? ORDER BY aa.assigned_date DESC`,
      [employeeId]
    );
    return rows as RowDataPacket[];
  },
};
