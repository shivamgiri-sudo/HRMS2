import { Router } from "express";
import { randomUUID } from "crypto";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { payrollService } from "./payroll.service.js";
import { logSensitiveAction } from "../../shared/auditLog.js";

export const payrollStatutoryConfigCompatRouter = Router();

payrollStatutoryConfigCompatRouter.use(requireAuth);

payrollStatutoryConfigCompatRouter.get(
  "/statutory-config",
  requireRole("admin", "finance", "payroll"),
  async (_req, res, next) => {
    try {
      const data = await payrollService.getStatutoryConfig();
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT config_key,
                CAST(config_value AS CHAR) AS config_value,
                COALESCE(description, '') AS description,
                updated_at
           FROM statutory_config
          ORDER BY config_key ASC`,
      );
      return res.json({ success: true, data, details: rows });
    } catch (error) {
      next(error);
    }
  },
);

// PATCH /api/payroll/statutory-config/:key — update a single config value
payrollStatutoryConfigCompatRouter.patch(
  "/statutory-config/:key",
  requireRole("admin", "super_admin", "finance", "payroll"),
  async (req: any, res, next) => {
    try {
      const { key } = req.params;
      const { value, reason } = req.body as { value: string | number; reason?: string };
      if (value === undefined || value === null) {
        return res.status(400).json({ success: false, message: "value is required" });
      }

      const [existing] = await db.execute<RowDataPacket[]>(
        `SELECT config_value FROM statutory_config WHERE config_key = ? LIMIT 1`,
        [key]
      );
      const oldValue = (existing as RowDataPacket[])[0]?.config_value ?? null;

      if (oldValue === null) {
        return res.status(404).json({ success: false, message: `Config key '${key}' not found` });
      }

      await db.execute(
        `UPDATE statutory_config SET config_value = ?, updated_at = NOW() WHERE config_key = ?`,
        [String(value), key]
      );

      // Record history
      await db.execute(
        `INSERT INTO statutory_config_history (id, config_key, old_value, new_value, reason, changed_by, changed_at)
         VALUES (?, ?, ?, ?, ?, ?, NOW())`,
        [randomUUID(), key, oldValue, String(value), reason ?? null, req.authUser?.id ?? null]
      ).catch(() => {
        // Table may not exist yet — gracefully ignore
      });

      void logSensitiveAction({
        actor_user_id: req.authUser?.id ?? "",
        action_type: "statutory_config_update",
        module_key: "payroll",
        entity_type: "statutory_config",
        entity_id: key,
        change_summary: { config_key: key, old_value: oldValue, new_value: String(value), reason },
        req,
      });

      return res.json({ success: true, message: `Config '${key}' updated`, data: { config_key: key, config_value: String(value) } });
    } catch (error) {
      next(error);
    }
  },
);

// GET /api/payroll/statutory-config/history/:key — audit history for a config key
payrollStatutoryConfigCompatRouter.get(
  "/statutory-config/history/:key",
  requireRole("admin", "super_admin", "finance", "payroll"),
  async (req, res, next) => {
    try {
      const { key } = req.params;
      const [rows] = await db.execute<RowDataPacket[]>(
        `SELECT id, config_key, old_value, new_value, reason, changed_by, changed_at
           FROM statutory_config_history
          WHERE config_key = ?
          ORDER BY changed_at DESC
          LIMIT 50`,
        [key]
      ).catch(() => [[] as RowDataPacket[]]);
      return res.json({ success: true, data: rows });
    } catch (error) {
      next(error);
    }
  },
);
