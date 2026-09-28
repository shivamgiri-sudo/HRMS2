import { Router } from "express";
import type { NextFunction, Response } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { TPZ_COMPANIES } from "./tpz-access.catalog.js";
import { canTpz, hasAnyTpzAccess } from "./tpz-access.resolver.js";
import { accessOf } from "./tpz-access.middleware.js";
import {
  getUserTpzAccessView, loadBranchCompanies, replaceUserTpzAccess, validateGrantInputs, type TpzGrantInput,
} from "./tpz-access.service.js";

const router = Router();
type AsyncHandler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const h = (fn: AsyncHandler) => (req: AuthenticatedRequest, res: Response, next: NextFunction) => { void fn(req, res).catch(next); };

router.use(requireAuth);

/**
 * GET /api/tpz-access/me -- what the signed-in user may do in TPZ Process. The page uses it to show only the processes and
 * sections the user is entitled to; the API enforces the same rules independently (tpz-access.middleware.ts).
 */
router.get("/me", h(async (req, res) => {
  const access = await accessOf(req);
  const companies = TPZ_COMPANIES
    .map((c) => ({
      key: c.key, label: c.label,
      dashboards: canTpz(access, c.key, "dashboards"), upload: canTpz(access, c.key, "upload") && Object.keys(c.uploads).length > 0,
      mis: canTpz(access, c.key, "mis"),
    }))
    .filter((c) => c.dashboards || c.upload || c.mis);
  res.json({
    success: true,
    data: {
      hasAccess: hasAnyTpzAccess(access),
      /** Role-based user, not narrowed: the page keeps its existing role + page-permission checks for them. */
      roleBased: access.roleFullView,
      restricted: access.restricted,
      companies,
    },
  });
}));

/* -------------------------------- administration -------------------------------- */

const adminOnly = requireRole("admin", "super_admin");

router.get("/options", adminOnly, h(async (_req, res) => {
  const [branches] = await db.execute<RowDataPacket[]>(`SELECT id, branch_name FROM branch_master WHERE active_status = 1 ORDER BY branch_name`);
  const branchIds = branches.map((b) => String(b.id));
  const byBranch = await loadBranchCompanies(branchIds);
  res.json({
    success: true,
    data: {
      companies: TPZ_COMPANIES.map((c) => ({ key: c.key, label: c.label, hasUploaders: Object.keys(c.uploads).length > 0, hasMis: true })),
      branches: branches.map((b) => ({
        id: String(b.id), name: String(b.branch_name),
        companies: (byBranch.get(String(b.id)) ?? []).map((k) => TPZ_COMPANIES.find((c) => c.key === k)?.label ?? k),
      })),
    },
  });
}));

/** Search for a user to grant access to (name, e-mail or employee code). */
router.get("/users", adminOnly, h(async (req, res) => {
  const q = String(req.query.search ?? "").trim();
  const limit = Math.min(50, Math.max(1, Number(req.query.limit ?? 25) || 25));
  const like = `%${q}%`;
  const [rows] = await db.execute<RowDataPacket[]>(
    `SELECT u.id, u.email, e.employee_code, e.full_name,
            (SELECT GROUP_CONCAT(ur.role_key ORDER BY ur.role_key SEPARATOR ',') FROM user_roles ur WHERE ur.user_id = u.id AND ur.active_status = 1) AS roles
       FROM auth_user u
       LEFT JOIN employees e ON e.user_id = u.id AND e.active_status = 1
      WHERE u.is_blocked = 0
        ${q ? "AND (u.email LIKE ? OR e.employee_code LIKE ? OR e.full_name LIKE ?)" : ""}
      ORDER BY e.full_name IS NULL, e.full_name, u.email
      LIMIT ${limit}`,
    q ? [like, like, like] : [],
  );
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: String(r.id), email: r.email ?? null, employee_code: r.employee_code ?? null, full_name: r.full_name ?? null,
      roles: r.roles ? String(r.roles).split(",") : [],
    })),
  });
}));

/** Everyone who currently has TPZ settings, with a one-line summary. */
router.get("/overview", adminOnly, h(async (_req, res) => {
  let rows: RowDataPacket[] = [];
  try {
    [rows] = await db.execute<RowDataPacket[]>(
      `SELECT u.id, u.email, e.employee_code, e.full_name, ua.restrict_to_grants,
              (SELECT COUNT(*) FROM tpz_access_grant g WHERE g.user_id = u.id AND g.active_status = 1) AS grant_count
         FROM tpz_user_access ua
         JOIN auth_user u ON u.id = ua.user_id
         LEFT JOIN employees e ON e.user_id = u.id AND e.active_status = 1
        WHERE ua.active_status = 1 AND (ua.restrict_to_grants = 1 OR EXISTS (SELECT 1 FROM tpz_access_grant g WHERE g.user_id = u.id AND g.active_status = 1))
        ORDER BY e.full_name IS NULL, e.full_name, u.email LIMIT 500`,
    );
  } catch (err) {
    const code = String((err as { code?: unknown })?.code ?? "");
    if (code !== "ER_NO_SUCH_TABLE") throw err;
  }
  res.json({
    success: true,
    data: rows.map((r) => ({
      id: String(r.id), email: r.email ?? null, employee_code: r.employee_code ?? null, full_name: r.full_name ?? null,
      restrict_to_grants: Number(r.restrict_to_grants) === 1, grant_count: Number(r.grant_count ?? 0),
    })),
  });
}));

router.get("/users/:userId", adminOnly, h(async (req, res) => {
  const [users] = await db.execute<RowDataPacket[]>(
    `SELECT u.id, u.email, e.employee_code, e.full_name,
            (SELECT GROUP_CONCAT(ur.role_key ORDER BY ur.role_key SEPARATOR ',') FROM user_roles ur WHERE ur.user_id = u.id AND ur.active_status = 1) AS roles
       FROM auth_user u LEFT JOIN employees e ON e.user_id = u.id AND e.active_status = 1 WHERE u.id = ? LIMIT 1`,
    [req.params.userId],
  );
  const u = users[0];
  if (!u) return res.status(404).json({ success: false, message: "User not found" });
  const view = await getUserTpzAccessView(String(u.id));
  res.json({
    success: true,
    data: {
      user: { id: String(u.id), email: u.email ?? null, employee_code: u.employee_code ?? null, full_name: u.full_name ?? null, roles: u.roles ? String(u.roles).split(",") : [] },
      ...view,
    },
  });
}));

/** Replaces the user's whole TPZ setup: { restrict_to_grants, notes, grants: [{ scope_type, company_key | branch_id, can_dashboards, can_upload, can_mis }] }. */
router.put("/users/:userId", adminOnly, h(async (req, res) => {
  const body = (req.body ?? {}) as { restrict_to_grants?: unknown; notes?: unknown; grants?: unknown };
  if (!Array.isArray(body.grants)) return res.status(400).json({ success: false, message: "grants must be an array" });
  const grants = (body.grants as Array<Record<string, unknown>>).map((g): TpzGrantInput => ({
    scope_type: g.scope_type as TpzGrantInput["scope_type"],
    company_key: typeof g.company_key === "string" ? g.company_key : null,
    branch_id: typeof g.branch_id === "string" ? g.branch_id : null,
    can_dashboards: g.can_dashboards === true, can_upload: g.can_upload === true, can_mis: g.can_mis === true,
  }));
  const problem = await validateGrantInputs(grants);
  if (problem) return res.status(400).json({ success: false, message: problem });

  const [users] = await db.execute<RowDataPacket[]>(`SELECT id FROM auth_user WHERE id = ? LIMIT 1`, [req.params.userId]);
  if (!users[0]) return res.status(404).json({ success: false, message: "User not found" });

  const notes = typeof body.notes === "string" && body.notes.trim() ? body.notes.trim().slice(0, 255) : null;
  const view = await replaceUserTpzAccess({
    userId: req.params.userId, restrictToGrants: body.restrict_to_grants === true, notes, grants, actorId: req.authUser.id, req,
  });
  res.json({ success: true, data: view });
}));

export const tpzAccessRouter = router;
