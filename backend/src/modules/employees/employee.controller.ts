import type { Request, Response } from "express";
import { createEmployeeSchema, employeeFiltersSchema, updateEmployeeSchema } from "./employee.validation.js";
import { employeeService } from "./employee.service.js";

function normalizeDate(value: unknown): unknown {
  if (typeof value !== "string") return value;
  return value.match(/^\d{4}-\d{2}-\d{2}/)?.[0] ?? value;
}

function normalizeEmploymentStatus(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const statuses: Record<string, string> = {
    active: "Active",
    inactive: "Inactive",
    onboarding: "Onboarding",
    offboarded: "Terminated",
    terminated: "Terminated",
    absconded: "Absconded",
    "on notice": "On Notice",
    on_notice: "On Notice",
  };
  return statuses[value.trim().toLowerCase()] ?? value;
}

function normalizeGender(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const genders: Record<string, string> = {
    male: "Male",
    female: "Female",
    other: "Other",
    prefer_not_to_say: "Other",
  };
  return genders[value.trim().toLowerCase()] ?? value;
}

function normalizeUpdateBody(body: Record<string, unknown>): Record<string, unknown> {
  const normalized = { ...body };
  const aliases: Record<string, string> = {
    employee_code: "employeeCode",
    first_name: "firstName",
    last_name: "lastName",
    phone: "mobile",
    date_of_birth: "dateOfBirth",
    hire_date: "dateOfJoining",
    date_of_joining: "dateOfJoining",
    salary_start_date: "salaryStartDate",
    date_of_exit: "dateOfExit",
    employment_type: "employmentType",
    employment_status: "employmentStatus",
    status: "employmentStatus",
    branch_id: "branchId",
    department_id: "departmentId",
    process_id: "processId",
    designation_id: "designationId",
    designation: "designationName",
    manager_id: "reportingManagerId",
    reporting_manager_id: "reportingManagerId",
    photo_url: "photoUrl",
    user_id: "userId",
    address: "address1",
    working_hours_start: "workingHoursStart",
    working_hours_end: "workingHoursEnd",
    working_days: "workingDays",
  };

  for (const [legacyKey, canonicalKey] of Object.entries(aliases)) {
    if (normalized[canonicalKey] === undefined && body[legacyKey] !== undefined) {
      normalized[canonicalKey] = body[legacyKey];
    }
  }

  normalized.dateOfBirth = normalizeDate(normalized.dateOfBirth);
  normalized.dateOfJoining = normalizeDate(normalized.dateOfJoining);
  normalized.salaryStartDate = normalizeDate(normalized.salaryStartDate);
  normalized.dateOfExit = normalizeDate(normalized.dateOfExit);
  normalized.employmentStatus = normalizeEmploymentStatus(normalized.employmentStatus);
  normalized.gender = normalizeGender(normalized.gender);
  return normalized;
}

export const employeeController = {
  async createEmployee(req: Request, res: Response) {
    const parsed = createEmployeeSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.createEmployee(parsed.data, (req as any).authUser?.id ?? "system");
    res.status(201).json({ data });
  },

  async listEmployees(req: Request, res: Response) {
    const parsed = employeeFiltersSchema.safeParse(req.query);
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const result = await employeeService.listEmployees({
      ...parsed.data,
      scopeFilter: (req as any).scopeFilter,
    });
    res.json({ data: result.data, total: result.total, page: result.page, limit: result.limit });
  },

  async getEmployee(req: Request, res: Response) {
    const data = await employeeService.getEmployee(req.params.id);
    res.json({ data });
  },

  async updateEmployee(req: Request, res: Response) {
    const parsed = updateEmployeeSchema.safeParse(normalizeUpdateBody(req.body ?? {}));
    if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
    const data = await employeeService.updateEmployee(req.params.id, parsed.data, (req as any).authUser?.id ?? "system");
    res.json({ data });
  },

  async deactivateEmployee(req: Request, res: Response) {
    await employeeService.deactivateEmployee(req.params.id, (req as any).authUser?.id ?? "system");
    res.status(204).send();
  },
};
