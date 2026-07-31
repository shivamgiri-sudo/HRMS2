/**
 * Deduction Entry routes — mounted at /api/payroll
 *
 * Covers: deduction type CRUD and individual employee deduction entry
 * management. The payroll engine reads active entries from
 * employee_deduction_entries and applies them as salary components.
 */

import { Router } from "express";
import type { Response } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";
import { db } from "../../db/mysql.js";
import {
  listDeductionTypes,
  createDeductionType,
  updateDeductionType,
  toggleDeductionType,
  listDeductionEntries,
  createDeductionEntry,
  deactivateDeductionEntry,
  bulkCreateDeductionEntries,
} from "./deductionEntry.service.js";

export const deductionEntryRouter = Router();

// ---------------------------------------------------------------------------
// Typed error-catching wrapper
// ---------------------------------------------------------------------------
type RouteHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;

const h =
  (fn: RouteHandler) =>
  (req: AuthenticatedRequest, res: Response, next: (err?: unknown) => void): void => {
    void fn(req, res).catch(next);
  };

const WRITE_ROLES = ["super_admin", "hr_admin", "payroll", "payroll_head", "finance"] as const;
const READ_ROLES = [...WRITE_ROLES, "branch_head"] as const;

// ---------------------------------------------------------------------------
// GET /deduction-types?active=1
// ---------------------------------------------------------------------------
deductionEntryRouter.get(
  "/deduction-types",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...READ_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const activeOnly = req.query.active === "1" || req.query.active === "true";
    const data = await listDeductionTypes(activeOnly);
    return res.json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// POST /deduction-types
// ---------------------------------------------------------------------------
deductionEntryRouter.post(
  "/deduction-types",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const data = await createDeductionType(req.body);
    return res.status(201).json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// PATCH /deduction-types/:id
// Handles field updates AND active toggle (body.active present → toggle)
// ---------------------------------------------------------------------------
deductionEntryRouter.patch(
  "/deduction-types/:id",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { id } = req.params;
    const body = req.body as Record<string, unknown>;

    if ("active" in body) {
      const data = await toggleDeductionType(id, Boolean(body.active));
      return res.json({ success: true, data });
    }

    const data = await updateDeductionType(id, body);
    return res.json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// GET /deductions?search&branch_id&process_id&type&month&status&limit&offset
// ---------------------------------------------------------------------------
deductionEntryRouter.get(
  "/deductions",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const isRead = await hasAnyRole(userId, ...READ_ROLES);
    if (!isRead) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    // Branch head row scope
    let scopedBranchId: string | null = null;
    const isBranchHead = await hasAnyRole(userId, "branch_head");
    if (isBranchHead && !(await hasAnyRole(userId, ...WRITE_ROLES))) {
      // Resolve branch_id from the user's employee record
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT branch_id FROM employees WHERE user_id = ? AND active_status = 1 LIMIT 1",
        [userId]
      );
      scopedBranchId = (empRows as RowDataPacket[])[0]?.branch_id ?? null;
    }

    const q = req.query as Record<string, string | undefined>;
    const { entries, total } = await listDeductionEntries(
      {
        search: q.search,
        branch_id: q.branch_id,
        process_id: q.process_id,
        type: q.type,
        month: q.month,
        status: q.status,
        limit: q.limit ? parseInt(q.limit, 10) : undefined,
        offset: q.offset ? parseInt(q.offset, 10) : undefined,
      },
      scopedBranchId
    );

    return res.json({ success: true, entries, total });
  })
);

// ---------------------------------------------------------------------------
// POST /deductions
// ---------------------------------------------------------------------------
deductionEntryRouter.post(
  "/deductions",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const data = await createDeductionEntry(req.body, userId);
    return res.status(201).json({ success: true, data });
  })
);

// ---------------------------------------------------------------------------
// PATCH /deductions/:id/deactivate
// ---------------------------------------------------------------------------
deductionEntryRouter.patch(
  "/deductions/:id/deactivate",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { reason } = req.body as { reason?: string };
    if (!reason || String(reason).trim().length < 5) {
      return res.status(400).json({ success: false, message: "reason must be at least 5 characters" });
    }
    await deactivateDeductionEntry(req.params.id, String(reason), userId);
    return res.json({ success: true, message: "Deduction entry deactivated" });
  })
);

// ---------------------------------------------------------------------------
// POST /deductions/bulk
// ---------------------------------------------------------------------------
deductionEntryRouter.post(
  "/deductions/bulk",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }
    const { rows } = req.body as { rows?: unknown[] };
    if (!Array.isArray(rows) || rows.length === 0) {
      return res.status(400).json({ success: false, message: "rows array is required and must not be empty" });
    }
    if (rows.length > 500) {
      return res.status(400).json({ success: false, message: "Maximum 500 rows per bulk request" });
    }
    const result = await bulkCreateDeductionEntries(rows as Parameters<typeof bulkCreateDeductionEntries>[0], userId);
    return res.status(201).json({ success: true, ...result });
  })
);

// ---------------------------------------------------------------------------
// GET /deductions/template — CSV download
// ---------------------------------------------------------------------------
deductionEntryRouter.get(
  "/deductions/template",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    if (!(await hasAnyRole(userId, ...WRITE_ROLES))) {
      return res.status(403).json({ success: false, message: "Access denied" });
    }

    const month =
      (req.query.month as string) ||
      (() => {
        const now = new Date();
        return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
      })();

    const [types] = await db.execute<RowDataPacket[]>(
      "SELECT deduction_code FROM payroll_deduction_type WHERE active_status = 1 ORDER BY deduction_name"
    );
    const typeCodes = (types as RowDataPacket[]).map((t) => String(t.deduction_code));

    const [employees] = await db.execute<RowDataPacket[]>(
      `SELECT e.employee_code, b.branch_name, cc.cost_centre_code
         FROM employees e
         LEFT JOIN branch_master b ON b.id = e.branch_id
         LEFT JOIN cost_centre_master cc ON cc.id = e.cost_centre_id
        WHERE e.employment_status IN ('active','on_leave')
        ORDER BY e.employee_code
        LIMIT 5000`
    );

    const headers = ["employee_code", "month", "branch", "cost_centre", ...typeCodes, "description"];
    const csvRows = (employees as RowDataPacket[]).map((emp) => [
      emp.employee_code,
      month,
      emp.branch_name ?? "",
      emp.cost_centre_code ?? "",
      ...typeCodes.map(() => 0),
      "",
    ]);

    const csv = [headers.join(","), ...csvRows.map((r) => r.join(","))].join("\n");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", `attachment; filename="deduction_template_${month}.csv"`);
    return res.send(csv);
  })
);

// ---------------------------------------------------------------------------
// GET /deductions/history/:employeeId
// ---------------------------------------------------------------------------
deductionEntryRouter.get(
  "/deductions/history/:employeeId",
  requireAuth,
  h(async (req, res) => {
    const userId = req.authUser!.id;
    const { employeeId } = req.params;

    const isPrivileged = await hasAnyRole(userId, ...READ_ROLES);

    if (!isPrivileged) {
      // Allow employee to see their own history
      const [empRows] = await db.execute<RowDataPacket[]>(
        "SELECT id FROM employees WHERE id = ? AND user_id = ? AND active_status = 1 LIMIT 1",
        [employeeId, userId]
      );
      if (!(empRows as RowDataPacket[])[0]) {
        return res.status(403).json({ success: false, message: "Access denied" });
      }
    }

    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT
         ede.id,
         ede.deduction_type_code,
         pdt.deduction_name AS deduction_type_name,
         ede.amount,
         ede.description,
         ede.is_prorated,
         ede.run_month,
         ede.status,
         ede.deactivate_reason,
         ede.created_at
       FROM employee_deduction_entries ede
       JOIN payroll_deduction_type pdt ON pdt.deduction_code = ede.deduction_type_code
      WHERE ede.employee_id = ?
      ORDER BY ede.created_at DESC`,
      [employeeId]
    );

    return res.json({ success: true, data: rows });
  })
);
