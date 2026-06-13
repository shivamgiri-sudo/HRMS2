import type { Request, Response } from "express";
import { createEmployeeSchema, employeeFiltersSchema, updateEmployeeSchema } from "./employee.validation.js";
import { employeeService } from "./employee.service.js";
import { db } from "../../db/mysql.js";

export const employeeController = {
  async createEmployee(req: Request, res: Response) {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.createEmployee(parsed.data, (req as any).userId ?? "system");
    res.status(201).json({ data });
  },

  async listEmployees(req: Request, res: Response) {
    const parsed = employeeFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await employeeService.listEmployees(parsed.data);
    res.json({ data: result.data, total: result.total, page: result.page, limit: result.limit });
  },

  async getEmployee(req: Request, res: Response) {
    const data = await employeeService.getEmployee(req.params.id);
    res.json({ data });
  },

  async updateEmployee(req: Request, res: Response) {
    const parsed = updateEmployeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.updateEmployee(req.params.id, parsed.data, (req as any).userId ?? "system");
    res.json({ data });
  },

  async deactivateEmployee(req: Request, res: Response) {
    await employeeService.deactivateEmployee(req.params.id, (req as any).userId ?? "system");
    res.status(204).send();
  },

  async updateMyProfile(req: any, res: any): Promise<unknown> {
    const userId = req.authUser?.id;
    if (!userId) return res.status(401).json({ success: false, error: 'Unauthorized' });
    const [rows] = await db.execute(
      'SELECT id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1',
      [userId]
    ) as any[];
    if (!rows.length) return res.status(404).json({ success: false, error: 'No employee record' });
    const empId = rows[0].id;

    // Map frontend field names to database column names
    const fieldMapping: Record<string, string> = {
      phone: 'mobile',
      address: 'address1',
      country: 'country', // Now using the actual country column
    };

    // Whitelist: only these DB fields may be self-edited
    const allowed = ['mobile', 'address1', 'address2', 'city', 'state', 'country', 'pincode',
                     'date_of_birth', 'gender', 'blood_group', 'nominee_name', 'nominee_relation',
                     'working_hours_start', 'working_hours_end', 'working_days'];
    const updates: Record<string, unknown> = {};

    // Map frontend field names to DB column names and validate against whitelist
    for (const [frontendKey, value] of Object.entries(req.body)) {
      const dbKey = fieldMapping[frontendKey] || frontendKey;
      if (allowed.includes(dbKey)) {
        updates[dbKey] = value;
      }
    }

    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No editable fields provided' });
    }

    // Handle working_days separately - it needs JSON serialization
    if ('working_days' in updates && Array.isArray(updates.working_days)) {
      updates.working_days = JSON.stringify(updates.working_days);
    }

    const sets = Object.keys(updates).map(k => `${k} = ?`).join(', ');
    const vals = [...Object.values(updates), empId];
    await db.execute(`UPDATE employees SET ${sets}, updated_at = NOW() WHERE id = ?`, vals);

    const [updated] = await db.execute(
      'SELECT * FROM employees WHERE id = ? LIMIT 1', [empId]
    ) as any[];
    return res.json({ success: true, data: updated[0] });
  },
};
