/**
 * Company policies with acknowledgement. HR publishes a policy (a new version deactivates the previous one),
 * every employee sees the active policies on their profile and acknowledges each version once; HR sees how
 * many employees have acknowledged. The wording is HR's - nothing is seeded.
 */
import { Router, type NextFunction, type Response } from "express";
import type { RowDataPacket } from "mysql2";
import { z } from "zod";
import { db } from "../../db/mysql.js";
import {
  requireAuth,
  requireWriteAccess,
  type AuthenticatedRequest,
} from "../../middleware/authMiddleware.js";
import { getEmployeeForUser } from "../../shared/accessGuard.js";
import { hasAnyRole } from "../../shared/scopeAccess.js";

export const policiesRouter = Router();
policiesRouter.use(requireAuth);

export const POLICY_CATEGORIES = [
  "posh",
  "emergency",
  "integrity",
  "dress_code",
  "dos_donts",
  "other",
] as const;
const HR_ROLES = ["super_admin", "admin", "hr", "hr_admin"] as const;

const publishSchema = z.object({
  policyKey: z
    .string()
    .trim()
    .min(2)
    .max(60)
    .regex(/^[a-z0-9_-]+$/, "use lowercase letters, numbers, - and _"),
  category: z.enum(POLICY_CATEGORIES),
  title: z.string().trim().min(3).max(200),
  body: z.string().trim().min(20).max(20000),
  effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD"),
});

type Handler = (req: AuthenticatedRequest, res: Response) => Promise<unknown>;
const wrap =
  (fn: Handler) =>
  (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    void fn(req, res).catch(next);
  };

const POLICY_COLUMNS = `p.id, p.policy_key, p.version, p.category, p.title, p.body,
  DATE_FORMAT(p.effective_from, '%Y-%m-%d') AS effective_from`;

/** The caller's active policies, each with whether they have acknowledged this version. */
policiesRouter.get(
  "/mine",
  wrap(async (req, res) => {
    const employee = await getEmployeeForUser(req.authUser.id);
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${POLICY_COLUMNS}, DATE_FORMAT(a.acknowledged_at, '%Y-%m-%d %H:%i') AS acknowledged_at
         FROM company_policy p
         LEFT JOIN company_policy_acknowledgement a ON a.policy_id = p.id AND a.employee_id = ?
        WHERE p.is_active = 1 AND p.effective_from <= CURDATE()
        ORDER BY FIELD(p.category, 'posh', 'integrity', 'emergency', 'dress_code', 'dos_donts', 'other'), p.title`,
      [employee?.id ?? ""],
    );
    return res.json({
      success: true,
      data: {
        canAcknowledge: Boolean(employee?.id),
        policies: rows.map((r) => ({
          id: String(r.id),
          policyKey: String(r.policy_key),
          version: Number(r.version),
          category: String(r.category),
          title: String(r.title),
          body: String(r.body),
          effectiveFrom: String(r.effective_from),
          acknowledgedAt: (r.acknowledged_at as string | null) ?? null,
        })),
      },
    });
  }),
);

policiesRouter.post(
  "/:id/acknowledge",
  requireWriteAccess,
  wrap(async (req, res) => {
    const employee = await getEmployeeForUser(req.authUser.id);
    if (!employee?.id)
      return res
        .status(403)
        .json({
          success: false,
          message: "Only employees can acknowledge a policy.",
        });
    const id = String(req.params.id).slice(0, 36);
    const [policy] = await db.execute<RowDataPacket[]>(
      "SELECT id FROM company_policy WHERE id = ? AND is_active = 1 LIMIT 1",
      [id],
    );
    if (policy.length === 0)
      return res
        .status(404)
        .json({
          success: false,
          message:
            "This policy is no longer current. Refresh to see the latest version.",
        });
    await db.execute(
      "INSERT IGNORE INTO company_policy_acknowledgement (id, policy_id, employee_id) VALUES (UUID(), ?, ?)",
      [id, employee.id],
    );
    return res.json({ success: true });
  }),
);

/** HR: every active policy with how many employees have acknowledged it. */
policiesRouter.get(
  "/admin/summary",
  wrap(async (req, res) => {
    if (!(await hasAnyRole(req.authUser.id, ...HR_ROLES)))
      return res
        .status(403)
        .json({ success: false, message: "HR access required." });
    const [[headcount]] = (await db.execute<RowDataPacket[]>(
      "SELECT COUNT(*) AS n FROM employees WHERE active_status = 1",
    )) as unknown as [RowDataPacket[]];
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT ${POLICY_COLUMNS}, COUNT(a.id) AS acknowledged
         FROM company_policy p LEFT JOIN company_policy_acknowledgement a ON a.policy_id = p.id
        WHERE p.is_active = 1 GROUP BY p.id ORDER BY p.category, p.title`,
    );
    return res.json({
      success: true,
      data: {
        activeEmployees: Number(headcount?.n ?? 0),
        policies: rows.map((r) => ({
          id: String(r.id),
          policyKey: String(r.policy_key),
          version: Number(r.version),
          category: String(r.category),
          title: String(r.title),
          effectiveFrom: String(r.effective_from),
          acknowledged: Number(r.acknowledged ?? 0),
        })),
      },
    });
  }),
);

/** HR: publish a policy. Publishing an existing key creates the next version and retires the previous one. */
policiesRouter.post(
  "/",
  requireWriteAccess,
  wrap(async (req, res) => {
    if (!(await hasAnyRole(req.authUser.id, ...HR_ROLES)))
      return res
        .status(403)
        .json({ success: false, message: "HR access required." });
    const parsed = publishSchema.safeParse(req.body);
    if (!parsed.success)
      return res
        .status(400)
        .json({
          success: false,
          message: parsed.error.issues[0]?.message ?? "Invalid policy",
        });
    const input = parsed.data;
    const [latest] = await db.execute<RowDataPacket[]>(
      "SELECT COALESCE(MAX(version), 0) AS v FROM company_policy WHERE policy_key = ?",
      [input.policyKey],
    );
    const version = Number(latest[0]?.v ?? 0) + 1;
    await db.execute(
      "UPDATE company_policy SET is_active = 0 WHERE policy_key = ?",
      [input.policyKey],
    );
    await db.execute(
      `INSERT INTO company_policy (id, policy_key, version, category, title, body, effective_from, published_by, published_by_name)
       VALUES (UUID(), ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        input.policyKey,
        version,
        input.category,
        input.title,
        input.body,
        input.effectiveFrom,
        req.authUser.id,
        req.authUser.email ?? req.authUser.id,
      ],
    );
    return res
      .status(201)
      .json({ success: true, data: { policyKey: input.policyKey, version } });
  }),
);
