// backend/src/modules/wfm/attendance-source-sheet.routes.ts
// Read-only. Mounted at /api/wfm/attendance-source-sheet.
//   GET /         one page of employees for a month, each day = status + COSEC + APR duration
//   GET /export   the same sheet as an .xlsx (Status / Cosec / APR per date)
// Row scope is the same as the Attendance Ledger: resolveUserBusinessScope +
// buildEmployeeScopeCondition on the employees row, so a branch-scoped viewer only ever sees
// their own branches. The role list is the gate, not the data boundary.

import { Router } from "express";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import {
  resolveUserBusinessScope,
  buildEmployeeScopeCondition,
} from "../../shared/enterpriseScope.js";
import {
  countSheetEmployees,
  fetchSheet,
  parseMonth,
  type ScopeSql,
  type SheetFilters,
} from "./attendance-source-sheet.service.js";
import { buildAttendanceSourceWorkbook } from "./attendance-source-sheet.xlsx.js";

export const attendanceSourceSheetRouter = Router();

const VIEW_ROLES = [
  "wfm",
  "branch_wfm",
  "hr",
  "admin",
  "super_admin",
  "ceo",
  "payroll",
  "payroll_head",
  "manager",
  "process_manager",
  "branch_head",
  "payroll_admin",
] as const;

const DEFAULT_PAGE_LIMIT = 50;
const MAX_PAGE_LIMIT = 200;
const MAX_EXPORT_EMPLOYEES = 5000;
const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;

class HttpError extends Error {
  constructor(
    public statusCode: number,
    message: string,
  ) {
    super(message);
  }
}

const h =
  (fn: (req: any, res: any) => Promise<unknown>) =>
  (req: any, res: any, next: any) =>
    fn(req, res).catch(next);

attendanceSourceSheetRouter.use(requireAuth);

function optId(value: unknown, what: string): string | undefined {
  if (value === undefined || value === null || value === "") return undefined;
  if (typeof value !== "string" || !ID_RE.test(value))
    throw new HttpError(400, `Invalid ${what}.`);
  return value;
}

function readFilters(query: Record<string, unknown>): SheetFilters {
  if (!parseMonth(query.month))
    throw new HttpError(400, "month is required as YYYY-MM.");
  const search =
    typeof query.search === "string" ? query.search.trim().slice(0, 60) : "";
  return {
    month: String(query.month),
    branchId: optId(query.branchId, "branchId"),
    processId: optId(query.processId, "processId"),
    costCentreId: optId(query.costCentreId, "costCentreId"),
    search: search || undefined,
  };
}

async function loadScope(req: any): Promise<ScopeSql> {
  const scope = await resolveUserBusinessScope(req.authUser);
  return buildEmployeeScopeCondition(scope, {
    employeeId: "e.id",
    branchId: "e.branch_id",
    processId: "e.process_id",
    departmentId: "e.department_id",
    managerEmployeeId: "e.reporting_manager_id",
  });
}

attendanceSourceSheetRouter.get(
  "/",
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const filters = readFilters(req.query);
    const range = parseMonth(filters.month)!;
    const page = Math.max(1, Number(req.query.page) || 1);
    const limit = Math.min(
      MAX_PAGE_LIMIT,
      Math.max(1, Number(req.query.limit) || DEFAULT_PAGE_LIMIT),
    );
    const scope = await loadScope(req);
    const [total, employees] = await Promise.all([
      countSheetEmployees(filters, scope),
      fetchSheet(filters, scope, { limit, offset: (page - 1) * limit }),
    ]);
    res.json({
      success: true,
      data: { month: filters.month, days: range.days, employees },
      total,
      page,
      limit,
    });
  }),
);

attendanceSourceSheetRouter.get(
  "/export",
  requireRole(...VIEW_ROLES),
  h(async (req, res) => {
    const filters = readFilters(req.query);
    const range = parseMonth(filters.month)!;
    const scope = await loadScope(req);
    const total = await countSheetEmployees(filters, scope);
    if (total > MAX_EXPORT_EMPLOYEES) {
      throw new HttpError(
        400,
        `${total} employees match; the export is limited to ${MAX_EXPORT_EMPLOYEES}. Narrow by branch, process or cost centre.`,
      );
    }
    const employees = await fetchSheet(filters, scope, {
      limit: MAX_EXPORT_EMPLOYEES,
      offset: 0,
    });
    const wb = buildAttendanceSourceWorkbook(
      filters.month,
      range.days,
      employees,
    );
    res.setHeader(
      "Content-Type",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    );
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="attendance-source-sheet-${filters.month}.xlsx"`,
    );
    await wb.xlsx.write(res);
    res.end();
  }),
);

// Same pattern as the ledger: surface HttpError as its status instead of a generic 500.
attendanceSourceSheetRouter.use((err: any, _req: any, res: any, next: any) => {
  if (err instanceof HttpError)
    return res
      .status(err.statusCode)
      .json({ success: false, message: err.message });
  return next(err);
});
