import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { randomUUID } from "crypto";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { db } from "../../db/mysql.js";
import { getEmployeeForUser, hasProcessScope, hasRole } from "../../shared/accessGuard.js";
import { buildScopeWhereClause } from "../../shared/scopeAccess.js";

export const weekoffPreferenceRouter = Router();
weekoffPreferenceRouter.use(requireAuth);

const h = (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);
const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function dayName(value: unknown) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0 || n > 6) return null;
  return DAY_NAMES[n];
}

function dayNumber(value: unknown) {
  const s = String(value ?? "");
  const idx = DAY_NAMES.findIndex((d) => d.toLowerCase() === s.toLowerCase());
  return idx >= 0 ? idx : null;
}

function apiStatus(dbStatus: string | null | undefined) {
  if (dbStatus === "approved") return "accepted";
  if (dbStatus === "manager_approved") return "manager_approved";
  if (dbStatus === "rejected") return "rejected";
  return "submitted";
}

function dbStatus(apiStatusValue: unknown) {
  const status = String(apiStatusValue ?? "accepted");
  if (status === "rejected") return "rejected";
  if (status === "manager_approved") return "manager_approved";
  if (["accepted", "applied", "approved"].includes(status)) return "approved";
  return "pending";
}

async function loadWeekoffPreference(id: string) {
  const [prefRows] = await db.execute<RowDataPacket[]>(
    `SELECT p.*, e.process_id, e.branch_id, e.reporting_manager_id, e.manager_id
       FROM employee_roster_preference p
       LEFT JOIN employees e ON e.id = p.employee_id
      WHERE p.id = ?
      LIMIT 1`,
    [id],
  );
  return prefRows[0];
}

async function weekoffReviewRole(userId: string, pref: RowDataPacket): Promise<"super_admin" | "manager" | "wfm" | null> {
  if (await hasRole(userId, "super_admin")) return "super_admin";
  const callerEmp = await getEmployeeForUser(userId);
  if (callerEmp?.id && callerEmp.id === pref.employee_id) return null;
  if (callerEmp?.id && (callerEmp.id === pref.reporting_manager_id || callerEmp.id === pref.manager_id)) {
    return "manager";
  }
  const scopedWfm = await hasProcessScope(
    userId,
    String(pref.process_id ?? ""),
    pref.branch_id as string | null,
    "wfm",
  );
  return scopedWfm ? "wfm" : null;
}

function nextWeekoffStatus(role: "super_admin" | "manager" | "wfm", currentStatus: string, requestedStatus: string): string | null {
  const desired = dbStatus(requestedStatus);
  if (!["approved", "rejected", "manager_approved"].includes(desired)) return null;
  if (role === "super_admin") return desired === "manager_approved" ? "approved" : desired;
  if (role === "manager") {
    if (currentStatus !== "pending") return null;
    return desired === "rejected" ? "rejected" : "manager_approved";
  }
  if (currentStatus !== "manager_approved") return null;
  return desired === "manager_approved" ? null : desired;
}

async function reviewWeekoffPreference(req: AuthenticatedRequest, res: any, preferenceId: string) {
  const pref = await loadWeekoffPreference(preferenceId);
  if (!pref) return res.status(404).json({ success: false, message: "Preference not found" });

  const role = await weekoffReviewRole(req.authUser!.id, pref);
  if (!role) return res.status(403).json({ success: false, message: "Forbidden" });

  const status = nextWeekoffStatus(role, String(pref.status ?? "pending"), String(req.body?.status ?? ""));
  if (!status) {
    return res.status(400).json({ success: false, message: "Invalid approval step for current week-off preference status" });
  }

  await db.execute(
    `UPDATE employee_roster_preference
        SET status = ?, rejection_reason = ?, approved_by = ?, approved_at = NOW()
      WHERE id = ?`,
    [status, req.body?.remarks ?? null, req.authUser!.id, preferenceId],
  );

  return res.json({ success: true, message: "Week-off preference updated", data: { id: preferenceId, status } });
}

weekoffPreferenceRouter.post("/weekoff-preferences", h(async (req, res) => {
  const emp = await getEmployeeForUser(req.authUser!.id);
  if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });

  const weekStartDate = String(req.body?.weekStartDate ?? req.body?.week_start_date ?? "").slice(0, 10);
  const preferred = dayName(req.body?.preferredDay1 ?? req.body?.preferred_day_1);
  const alternate = dayName(req.body?.preferredDay2 ?? req.body?.preferred_day_2);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(weekStartDate)) return res.status(400).json({ success: false, message: "weekStartDate is required in YYYY-MM-DD format" });
  if (!preferred) return res.status(400).json({ success: false, message: "preferredDay1 must be 0-6" });

  const notes = req.body?.reason ?? (alternate ? `Alternate: ${alternate}` : null);
  const [existing] = await db.execute<RowDataPacket[]>(
    `SELECT id FROM employee_roster_preference WHERE employee_id = ? AND effective_from = ? LIMIT 1`,
    [emp.id, weekStartDate],
  );

  if (existing[0]?.id) {
    await db.execute(
      `UPDATE employee_roster_preference
          SET preferred_week_off = ?, notes = ?, status = 'pending', approved_by = NULL, approved_at = NULL, rejection_reason = NULL
        WHERE id = ?`,
      [preferred, notes, existing[0].id],
    );
  } else {
    await db.execute(
      `INSERT INTO employee_roster_preference
         (id, employee_id, preferred_shift_id, preferred_week_off, flexibility, notes, effective_from, status, created_by)
       VALUES (?, ?, NULL, ?, 'fixed', ?, ?, 'pending', ?)`,
      [randomUUID(), emp.id, preferred, notes, weekStartDate, req.authUser!.id],
    );
  }

  return res.status(201).json({ success: true, message: "Week-off preference submitted" });
}));

weekoffPreferenceRouter.get("/weekoff-preferences", h(async (req, res) => {
  const userId = req.authUser!.id;
  const processId = String(req.query.processId ?? req.query.process_id ?? "");
  const weekStartDate = String(req.query.weekStartDate ?? req.query.week_start_date ?? "").slice(0, 10);
  const own = String(req.query.own ?? "") === "1";

  const params: unknown[] = [];
  const where: string[] = [];

  if (own) {
    const emp = await getEmployeeForUser(userId);
    if (!emp?.id) return res.status(403).json({ success: false, message: "No employee record" });
    where.push("p.employee_id = ?");
    params.push(emp.id);
  } else {
    if (!processId) return res.status(400).json({ success: false, message: "processId is required" });

    // All-access roles: super_admin, ceo, payroll, finance
    const isAllAccess = await hasRole(userId, "super_admin", "ceo", "payroll", "finance");
    // Branch-scoped roles: admin, hr, wfm, branch_manager see their branch only
    const isBranchScope = await hasRole(userId, "admin", "hr", "wfm", "branch_manager", "manager", "assistant_manager", "tl");
    if (!isAllAccess && !isBranchScope) {
      return res.status(403).json({ success: false, message: "Forbidden" });
    }

    where.push("e.process_id = ?");
    params.push(processId);

    // Non-all-access users get branch-scoped filtering
    if (!isAllAccess) {
      const scopeClause = await buildScopeWhereClause(
        userId,
        ["admin", "hr", "wfm", "branch_manager", "manager"],
        { branchId: "e.branch_id", processId: "e.process_id" },
        { allowAdminBypass: false, allowCeoAllRead: false }
      );
      if (scopeClause.sql) {
        const cleaned = scopeClause.sql.replace(/^WHERE\s+/i, "").trim();
        if (cleaned) {
          where.push(`(${cleaned})`);
          params.push(...scopeClause.params);
        }
      }
    }
  }

  if (weekStartDate) {
    where.push("p.effective_from = ?");
    params.push(weekStartDate);
  }

  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT p.id,
            p.employee_id,
            e.process_id,
            e.branch_id,
            e.employee_code,
            COALESCE(NULLIF(e.full_name, ''), CONCAT_WS(' ', e.first_name, e.last_name)) AS employee_name,
            b.branch_name,
            pm.process_name,
            DATE_FORMAT(p.effective_from, '%Y-%m-%d') AS week_start_date,
            p.preferred_week_off,
            p.notes AS reason,
            p.status AS db_status,
            p.rejection_reason AS manager_remarks,
            p.approved_at AS reviewed_at,
            p.created_at
       FROM employee_roster_preference p
       LEFT JOIN employees e ON e.id = p.employee_id
       LEFT JOIN branch_master b ON b.id = e.branch_id
       LEFT JOIN process_master pm ON pm.id = e.process_id
      WHERE ${where.join(" AND ")}
      ORDER BY p.created_at DESC
      LIMIT 500`,
    params,
  );

  const data = rows.map((row: any) => ({
    ...row,
    preferred_day_1: dayNumber(row.preferred_week_off),
    preferred_day_2: null,
    status: apiStatus(row.db_status),
  }));
  return res.json({ success: true, data });
}));

weekoffPreferenceRouter.patch("/weekoff-preferences/bulk-review", h(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String).filter(Boolean) : [];
  if (!ids.length) return res.status(400).json({ success: false, message: "ids array is required" });

  const results: Array<{ id: string; success: boolean; message?: string }> = [];
  for (const id of ids) {
    const localRes = {
      statusCode: 200,
      payload: null as any,
      status(code: number) { this.statusCode = code; return this; },
      json(payload: any) { this.payload = payload; return this; },
    };
    await reviewWeekoffPreference(req, localRes, id);
    results.push({
      id,
      success: localRes.statusCode >= 200 && localRes.statusCode < 300 && localRes.payload?.success !== false,
      message: localRes.payload?.message,
    });
  }

  return res.json({ success: true, data: results });
}));

weekoffPreferenceRouter.patch("/weekoff-preferences/:id", h(async (req, res) => {
  return reviewWeekoffPreference(req, res, req.params.id);
}));
