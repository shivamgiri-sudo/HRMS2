import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db } from "../../db/mysql.js";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { portalAuthService } from "./portal.auth.service.js";

const router = Router();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const h = (fn: (req: any, res: any) => Promise<unknown>) => (req: any, res: any, next: any) => fn(req, res).catch(next);

/**
 * Super-admin impersonation: mint a real client-portal session for any active
 * client_user, without needing their email OTP.
 *
 * Every previous version of this route was broken end-to-end and could never have worked:
 *   1. It signed { portal_user_id, client_id, impersonated_by }, but requireClientAuth
 *      (portal.auth.service.ts's verifyToken + the role/jti checks in requireClientAuth.ts)
 *      expects { clientUserId, clientId, processIds, role: "client", jti }. A token from
 *      the old code would fail `payload.role !== "client"` immediately.
 *   2. It never issued a jti or wrote a matching portal_user_sessions row, so even a
 *      correctly-shaped token would 401 the moment requireClientAuth's per-session
 *      revocation check ran (jti not found -> table lookup finds nothing -> rejected).
 *   3. The audit table it wrote to (portal_admin_impersonation_log) declared
 *      admin_user_id/portal_user_id as INT UNSIGNED while both auth_user.id and
 *      client_user.id are CHAR(36) UUIDs — the INSERT itself has always thrown a SQL
 *      error (see migration 1808_portal_admin_impersonation_log_uuid_fix.sql).
 *   4. It also inserted into `portal_sessions`, a completely different (and until
 *      migration 1765, nonexistent) table that nothing in requireClientAuth reads at all.
 *
 * This version reuses portalAuthService.issueToken() — the exact same function a real
 * client OTP login calls — so an impersonation session is byte-for-byte indistinguishable
 * from a real one to every downstream dashboard endpoint, and is tracked in the same
 * portal_user_sessions table so it can be revoked the same way.
 */
router.post(
  "/impersonate",
  requireAuth,
  requireRole("super_admin", "admin"),
  h(async (req, res) => {
    const { client_email, client_user_id, reason } = req.body as {
      client_email?: string;
      client_user_id?: string;
      reason?: string;
    };
    if (!client_email?.trim() && !client_user_id?.trim()) {
      return res.status(400).json({ error: "client_email or client_user_id is required" });
    }
    if (!reason?.trim()) return res.status(400).json({ error: "reason is required for audit" });

    const [rows] = client_user_id?.trim()
      ? await db.execute<RowDataPacket[]>(
          "SELECT id, client_id, email, process_ids FROM client_user WHERE id = ? AND is_active = 1 LIMIT 1",
          [client_user_id.trim()]
        )
      : await db.execute<RowDataPacket[]>(
          "SELECT id, client_id, email, process_ids FROM client_user WHERE email = ? AND is_active = 1 LIMIT 1",
          [client_email!.trim()]
        );
    const portalUser = (rows as RowDataPacket[])[0];
    if (!portalUser) {
      return res.status(404).json({ error: "No active portal user found" });
    }

    let processIds: string[];
    try {
      processIds = typeof portalUser.process_ids === "string"
        ? JSON.parse(portalUser.process_ids)
        : (portalUser.process_ids as string[]);
    } catch {
      return res.status(500).json({ error: "Portal user has invalid process_ids data" });
    }

    // Same function real OTP login uses (portal.auth.service.ts's verifyOtp calls this
    // exact method) -- signs { clientUserId, clientId, processIds, role: "client", jti,
    // impersonatedBy } and writes the matching portal_user_sessions row requireClientAuth
    // checks. impersonatedBy shortens the token to 2h (vs a real login's 7d) and is what
    // the frontend's persistent "you are viewing as X" banner keys off of.
    const { token, jti } = await portalAuthService.issueToken({
      clientUserId: portalUser.id,
      clientId: portalUser.client_id,
      processIds,
      impersonatedBy: req.authUser?.id,
    });

    // jti links this audit row to its exact portal_user_sessions row (migration 1808
    // added the column for this) -- without it, an auditor can see THAT an admin
    // impersonated a client but can't tell which session that was, whether it's still
    // live, or revoke it directly from the audit log.
    await db.execute(
      `INSERT INTO portal_admin_impersonation_log
         (admin_user_id, portal_user_id, client_email, reason, jti, created_at)
       VALUES (?, ?, ?, ?, ?, NOW())`,
      [req.authUser?.id, portalUser.id, portalUser.email, reason.trim(), jti]
    );

    return res.json({
      token,
      clientUserId: portalUser.id,
      clientEmail: portalUser.email,
      expiresIn: 2 * 60 * 60,
      message: "Impersonation session created — expires in 2 hours, shorter than a real client login.",
    });
  })
);

/**
 * List active client_user accounts, so the super-admin picker (frontend) can offer a
 * searchable list instead of requiring the admin to already know an exact email or id.
 * Scoped to the same admin-only roles as /impersonate.
 */
router.get(
  "/client-users",
  requireAuth,
  requireRole("super_admin", "admin"),
  h(async (req, res) => {
    const search = typeof req.query.search === "string" ? req.query.search.trim() : "";
    const params: unknown[] = [];
    let where = "cu.is_active = 1";
    if (search) {
      where += " AND (cu.email LIKE ? OR cu.name LIKE ? OR cm.client_name LIKE ?)";
      const like = `%${search}%`;
      params.push(like, like, like);
    }
    const [rows] = await db.execute<RowDataPacket[]>(
      `SELECT cu.id, cu.email, cu.name, cu.client_id, cm.client_name
       FROM client_user cu
       JOIN client_master cm ON cm.id = cu.client_id
       WHERE ${where}
       ORDER BY cm.client_name
       LIMIT 200`,
      params
    );
    return res.json({ data: rows });
  })
);

export default router;
