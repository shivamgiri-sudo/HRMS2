import { Router } from "express";
import type { RowDataPacket } from "mysql2";
import { db as pool } from "../../db/mysql.js";
import { requireAuth, type AuthenticatedRequest } from "../../middleware/authMiddleware.js";
import { requireRole } from "../../middleware/requireRole.js";
import { canViewEmployee } from "../../shared/enterpriseScope.js";
import { buildDossier } from "./rehire/dossier/dossierService.js";

export const rejoinDossierRouter = Router();

rejoinDossierRouter.use(requireAuth);

// The branch head decides on this page, so it is theirs first; HR and admins may read it to follow a
// request. Row scope is the same mechanism as every other reactivation route: a branch head only
// sees employees inside their own branch.
rejoinDossierRouter.get(
  "/reactivation/:id/dossier",
  requireRole("branch_head", "hr", "admin", "super_admin"),
  async (req: AuthenticatedRequest, res) => {
    try {
      const { id } = req.params;
      const [rows] = await pool.execute<RowDataPacket[]>(
        "SELECT employee_id FROM employee_reactivation_requests WHERE id = ?",
        [id],
      );
      if (!rows.length) return res.status(404).json({ success: false, message: "Request not found" });

      if (!(await canViewEmployee(req.authUser!.id, String(rows[0]!.employee_id)))) {
        return res.status(403).json({ success: false, message: "This request is not in your assigned scope" });
      }

      const dossier = await buildDossier(pool, String(id));
      if (!dossier) return res.status(404).json({ success: false, message: "Request not found" });
      return res.json({ success: true, data: dossier });
    } catch (err: any) {
      console.error("[RejoinDossier] failed:", err);
      return res.status(500).json({ success: false, message: err.message ?? "Failed to build dossier" });
    }
  },
);
