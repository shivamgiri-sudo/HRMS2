import { Router } from "express";
import { db } from "../../db/mysql.js";
import type { RowDataPacket } from "mysql2";

export const loginInfoRouter = Router();

// ── GET /api/public/login-info ────────────────────────────────────────────────
// Unauthenticated by design — shown on the login page before the user signs in.
// Returns only safe aggregate counts and non-PII text. Rate-limited at mount.
loginInfoRouter.get("/", async (_req, res) => {
  try {
    const [[stats], [branches], [announcements]] = await Promise.all([
      // Active employee count — aggregate only, no PII
      db.execute<RowDataPacket[]>(
        `SELECT COUNT(*) AS active_employees
         FROM employees
         WHERE active_status = 1
           AND employment_status NOT IN
             ('inactive','terminated','offboarded','absconded','resigned','left','separated')`
      ),

      // Branch names — structural org data, no employee or payroll info
      db.execute<RowDataPacket[]>(
        `SELECT branch_name, city
         FROM branch_master
         WHERE active_status = 1
         ORDER BY branch_name ASC`
      ),

      // Active login announcements
      db.execute<RowDataPacket[]>(
        `SELECT id, message, pinned
         FROM login_announcement
         WHERE active_status = 1
           AND (expires_at IS NULL OR expires_at > NOW())
         ORDER BY pinned DESC, created_at DESC
         LIMIT 10`
      ).catch(() => [[]] as [RowDataPacket[], any]),   // graceful — table may not exist yet
    ]);

    res.json({
      active_employees: (stats as RowDataPacket[])[0]?.active_employees ?? 0,
      branches: (branches as RowDataPacket[]).map(b => b.branch_name as string),
      announcements: (announcements as RowDataPacket[]).map(a => ({
        id: a.id as string,
        message: a.message as string,
        pinned: !!a.pinned,
      })),
    });
  } catch (err) {
    // Never block login page load — return safe empty state on any error
    res.json({ active_employees: 0, branches: [], announcements: [] });
  }
});
