import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";

/**
 * Thin read-only endpoint that exposes distinct billing client names to finance
 * roles so the Record Client Receipt form can offer a searchable dropdown.
 *
 * Source: cost_centre_master.billing_client_name — the legal entity name
 * frozen on every invoice at creation time. Adding a new cost centre with a
 * new billing_client_name automatically surfaces it here with no manual sync.
 */
const READ_ROLES = ["finance_head", "accounts_head", "super_admin", "ceo", "branch_head", "admin", "hr", "finance"] as const;

export const financeClientsRouter = Router();

const h =
  (fn: (req: AuthenticatedRequest, res: any) => Promise<unknown>) =>
  (req: AuthenticatedRequest, res: any, next: any) =>
    fn(req, res).catch(next);

financeClientsRouter.use(requireAuth);

financeClientsRouter.get(
  "/",
  requireRole(...READ_ROLES),
  h(async (_req, res) => {
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT DISTINCT billing_client_name AS client_name
         FROM cost_centre_master
        WHERE active_status = 1
          AND billing_client_name IS NOT NULL
          AND billing_client_name != ''
          AND billing_client_name NOT LIKE 'LEGACY-%'
        ORDER BY billing_client_name`,
    );
    res.json({ success: true, data: rows });
  }),
);
