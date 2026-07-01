import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { requireAuth } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { db } from "../../db/mysql.js";
import { payrollService } from "./payroll.service.js";

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
