import { Router } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const loginInfoRouter = Router();

// ── GET /api/public/login-info ────────────────────────────────────────────────
// Unauthenticated by design — shown on the login page before the user signs in.
// Returns only safe aggregate counts and non-PII text. Rate-limited at mount.
loginInfoRouter.get("/", async (_req, res) => {
  try {
    const [statsResult, branchesResult, announcementsResult] = await Promise.all([
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS active_employees
         FROM employees
         WHERE active_status = 1
           AND employment_status NOT IN
             ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT branch_code, branch_name
         FROM branch_master
         WHERE active_status = 1
         ORDER BY branch_name ASC`
      ),
      db.execute<RowDataPacket[]>(
        `SELECT id, message, pinned
         FROM login_announcement
         WHERE active_status = 1
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY pinned DESC, created_at DESC
         LIMIT 10`
      ).catch(() => [[] as RowDataPacket[]]),   // graceful — table may not exist yet
    ]);

    const stats        = statsResult[0]        as RowDataPacket[];
    const branches     = branchesResult[0]     as RowDataPacket[];
    const announcements = announcementsResult[0] as RowDataPacket[];

    res.json({
      active_employees: stats[0]?.active_employees ?? 0,
      branches: branches.map(b => (b.branch_code || b.branch_name) as string),
      announcements: Array.isArray(announcements) ? announcements.map(a => ({
        id:      a.id      as string,
        message: a.message as string,
        pinned:  !!a.pinned,
      })) : [],
    });
  } catch (err) {
    // Never block login page load — return safe empty state on any error
    res.json({ active_employees: 0, branches: [], announcements: [] });
  }
});
