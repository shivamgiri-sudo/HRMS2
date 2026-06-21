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
    const result = await employeeService.listEmployees({
      ...parsed.data,
      scopeFilter: (req as any).scopeFilter,
    });
    res.json({ data: result.data, total: result.total, page: result.page, limit: result.limit, stats: result.stats, process_breakdown: result.process_breakdown });
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

    // Whitelist: only these fields may be self-edited.
    // Maps frontend field name -> DB column name where they differ.
    const fieldMap: Record<string, string> = {
      phone:               'mobile',
      mobile:              'mobile',
      address:             'address1',
      address1:            'address1',
      city:                'city',
      country:             'country',
      date_of_birth:       'date_of_birth',
      gender:              'gender',
      blood_group:         'blood_group',
      nominee_name:        'nominee_name',
      nominee_relation:    'nominee_relation',
    };
    const updates: Record<string, unknown> = {};
    for (const [bodyKey, dbCol] of Object.entries(fieldMap)) {
      if (bodyKey in req.body) {
        // Normalize date_of_birth to YYYY-MM-DD, reject invalid/future dates
        if (bodyKey === 'date_of_birth' && req.body[bodyKey]) {
          const raw = String(req.body[bodyKey]).slice(0, 10);
          if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
            return res.status(400).json({ success: false, error: 'Invalid date_of_birth format, expected YYYY-MM-DD' });
          }
          const dob = new Date(raw);
          if (isNaN(dob.getTime()) || dob > new Date()) {
            return res.status(400).json({ success: false, error: 'date_of_birth must be a valid past date' });
          }
          updates[dbCol] = raw;
        } else if (bodyKey === 'working_days') {
          updates[dbCol] = JSON.stringify(req.body[bodyKey]);
        } else {
          updates[dbCol] = req.body[bodyKey];
        }
      }
    }
    if (Object.keys(updates).length === 0) {
      return res.status(400).json({ success: false, error: 'No editable fields provided' });
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
